/**
 * MCP EXECUTE — script + image generation behind web approval, auto-saved to library.
 */

import { checkUsageLimit, incrementUsage, deductBonusImage } from '../auth.js'
import { logApiUsage, estimateTokens } from '../usage-logger.js'
import { runGuionesStructuredPipeline } from '../guiones/script-pipeline.js'
import { GROK_TEXT_MODEL } from '../grok-models.js'
import { runGrokImageGenerate } from '../grok-image-generate.js'
import {
  consumeMcpApprovalRequest,
  issueMcpApprovalRequest,
  replayMcpApprovalResult,
  storeMcpApprovalResult,
  type McpApprovalStore,
} from './approval.js'
import { mcpGetBrandContext, type McpAuthUser, type McpDbClient } from './user-tools.js'
import { mcpGuideImage } from './guide-packs.js'
import type { McpArtifactStore } from './artifact-store.js'
import type { ProductType, SalesChannel, ScriptSettings } from '../guiones/types.js'

function xaiKey(): string {
  const key = process.env.XAI_API_KEY || process.env.GROK_API_KEY || ''
  if (!key) throw new Error('XAI_API_KEY not configured')
  return key
}

function resolveOfferId(
  ctx: Awaited<ReturnType<typeof mcpGetBrandContext>>,
  offerId?: string
): string {
  if (offerId) {
    const found = ctx.offers.find((o) => o.id === offerId)
    if (!found) throw new Error('Offer not found on this brand')
    return found.id
  }
  if (!ctx.offers[0]) {
    throw new Error('Brand has no offers — create an offer in Advance before EXECUTE')
  }
  return ctx.offers[0].id
}

export async function mcpExecuteScriptGenerate(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const approvalRequestId = typeof options.args.approvalRequestId === 'string'
    ? options.args.approvalRequestId
    : ''
  const language = options.args.language === 'en' ? 'en' : 'es'
  const sessionIdArg = typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    language,
    goal: typeof options.args.goal === 'string' ? options.args.goal : undefined,
    sessionId: sessionIdArg,
  }

  // Validate brand/offer before issuing or consuming approval
  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const boundWithOffer = { ...boundInput, offerId }

  if (!approvalRequestId) {
    const quote = 3
    const req = await issueMcpApprovalRequest(options.approvalStore, {
      userId: options.user.id,
      toolName: 'execute_script_generate',
      input: boundWithOffer,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
    })
    return {
      ...req,
      toolName: 'execute_script_generate',
      quotedCreditCost: quote,
      creditUnit: 'credits',
      message: 'Open deepLink, Approve, then retry this tool with the same arguments plus approvalRequestId.',
      boundInput: boundWithOffer,
    }
  }

  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_script_generate',
    input: boundWithOffer,
  })
  if (replay.ok) {
    return {
      ...(replay.result as Record<string, unknown>),
      replayed: true,
    }
  }

  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_script_generate',
    input: boundWithOffer,
  })
  if (!consumed.ok) throw new Error(consumed.reason)

  const limit = await checkUsageLimit(options.user.id, 'script')
  if (!limit.allowed) throw new Error('Script credit limit reached')

  const ctx = ctxPreview
  const offer = ctx.offers.find((o) => o.id === offerId)!

  const pipeline = await runGuionesStructuredPipeline({
    apiKey: xaiKey(),
    language,
    businessContext: {
      name: ctx.brand.name,
      location: ctx.brand.location || undefined,
      sales_channels: (ctx.brand.salesChannels || undefined) as SalesChannel[] | undefined,
      icp_description: ctx.brand.icpDescription || ctx.brandKit?.targetAudience || undefined,
    },
    productContext: {
      name: offer.name,
      type: (offer.type as ProductType | undefined) || undefined,
      product_description: ctx.brandKit?.tagline || undefined,
    },
    scriptSettings: {
      framework: 'venta_directa',
      variations: 1,
      useStructuredPipeline: true,
    } satisfies ScriptSettings,
  })

  const text = pipeline.content || JSON.stringify(pipeline.scripts || [], null, 2)
  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId: sessionIdArg,
    title: `MCP script — ${offer.name}`,
  })
  const saved = await options.artifactStore.saveScriptArtifact({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId,
    title: `${offer.name} script`,
    content: text,
    approvalRequestId,
  })

  await logApiUsage({
    userId: options.user.id,
    userEmail: options.user.email || undefined,
    feature: 'script',
    model: GROK_TEXT_MODEL,
    inputTokens: estimateTokens(text),
    outputTokens: estimateTokens(text),
    success: true,
    metadata: { action: 'mcp_execute_script_generate', brandId, approvalRequestId, sessionId },
  })
  await incrementUsage(options.user.id, 'script')

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  const result = {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged: 1,
    brandId,
    offerId,
    sessionId,
    messageId: saved.messageId,
    scriptId: saved.scriptId,
    scripts: pipeline.scripts || null,
    content: text,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
  }
  await storeMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    result,
  })
  return result
}

export async function mcpExecuteImageGenerate(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const approvalRequestId = typeof options.args.approvalRequestId === 'string'
    ? options.args.approvalRequestId
    : ''
  const sessionIdArg = typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    scene: typeof options.args.scene === 'string' ? options.args.scene : undefined,
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '9:16',
    sessionId: sessionIdArg,
  }

  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const boundWithOffer = { ...boundInput, offerId }

  if (!approvalRequestId) {
    const quote = 6
    const req = await issueMcpApprovalRequest(options.approvalStore, {
      userId: options.user.id,
      toolName: 'execute_image_generate',
      input: boundWithOffer,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
    })
    return {
      ...req,
      toolName: 'execute_image_generate',
      quotedCreditCost: quote,
      creditUnit: 'credits',
      message: 'Open deepLink, Approve, then retry this tool with the same arguments plus approvalRequestId.',
      boundInput: boundWithOffer,
    }
  }

  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_generate',
    input: boundWithOffer,
  })
  if (replay.ok) {
    return {
      ...(replay.result as Record<string, unknown>),
      replayed: true,
    }
  }

  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_generate',
    input: boundWithOffer,
  })
  if (!consumed.ok) throw new Error(consumed.reason)

  const limit = await checkUsageLimit(options.user.id, 'image')
  if (!limit.allowed) throw new Error('Image credit limit reached')

  const guide = await mcpGuideImage(options.db, options.user, {
    brandId,
    offerId,
    scene: boundWithOffer.scene,
    aspectRatio: boundWithOffer.aspectRatio,
  })
  const prompt = String(guide.prompt || '')
  const refs = Array.isArray(guide.referenceUrls)
    ? guide.referenceUrls.filter((u): u is string => typeof u === 'string')
    : []

  const generated = await runGrokImageGenerate({
    apiKey: xaiKey(),
    prompt,
    aspectRatio: boundWithOffer.aspectRatio,
    referenceImageUrls: refs,
  })

  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId: sessionIdArg,
    title: `MCP image — ${ctxPreview.offers.find((o) => o.id === offerId)?.name || offerId}`,
  })
  const saved = await options.artifactStore.saveImageArtifact({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId,
    imageDataUrl: generated.imageDataUrl,
    label: 'MCP generate',
    approvalRequestId,
    metadata: {
      resolution: generated.resolution,
      quality: generated.quality,
      providerModel: generated.providerModel,
      aspectRatio: generated.aspectRatio,
    },
  })

  await logApiUsage({
    userId: options.user.id,
    userEmail: options.user.email || undefined,
    feature: 'image',
    model: generated.providerModel,
    success: true,
    costOverrideUsd: generated.estimatedCostUsd,
    metadata: {
      action: 'mcp_execute_image_generate',
      brandId,
      approvalRequestId,
      sessionId,
      resolution: generated.resolution,
      quality: generated.quality,
    },
  })
  await incrementUsage(options.user.id, 'image')
  await deductBonusImage(options.user.id)

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  const result = {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged: 1,
    brandId,
    offerId,
    sessionId,
    messageId: saved.messageId,
    productImageId: saved.productImageId,
    imageUrl: saved.imageUrl,
    providerModel: generated.providerModel,
    aspectRatio: generated.aspectRatio,
    resolution: generated.resolution,
    quality: generated.quality,
    estimatedCostUsd: generated.estimatedCostUsd,
    prompt,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
    note: 'Image saved to Advance library at max Grok quality (2k/medium). Open deepLink to view in chat.',
  }
  await storeMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    result,
  })
  return result
}
