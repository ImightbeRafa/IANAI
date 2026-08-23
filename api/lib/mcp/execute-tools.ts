/**
 * MCP EXECUTE — script + image generation behind web approval.
 */

import { checkUsageLimit, incrementUsage, deductBonusImage } from '../auth.js'
import { logApiUsage, estimateTokens } from '../usage-logger.js'
import { runGuionesStructuredPipeline } from '../guiones/script-pipeline.js'
import { GROK_TEXT_MODEL } from '../grok-models.js'
import { runGrokImageGenerate } from '../grok-image-generate.js'
import {
  consumeMcpApprovalRequest,
  issueMcpApprovalRequest,
  type McpApprovalStore,
} from './approval.js'
import { mcpGetBrandContext, type McpAuthUser, type McpDbClient } from './user-tools.js'
import { mcpGuideImage } from './guide-packs.js'
import type { ProductType, SalesChannel, ScriptSettings } from '../guiones/types.js'

function xaiKey(): string {
  const key = process.env.XAI_API_KEY || process.env.GROK_API_KEY || ''
  if (!key) throw new Error('XAI_API_KEY not configured')
  return key
}

export async function mcpExecuteScriptGenerate(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
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
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    language,
    goal: typeof options.args.goal === 'string' ? options.args.goal : undefined,
  }

  if (!approvalRequestId) {
    const quote = 1
    const req = await issueMcpApprovalRequest(options.approvalStore, {
      userId: options.user.id,
      toolName: 'execute_script_generate',
      input: boundInput,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
    })
    return {
      ...req,
      toolName: 'execute_script_generate',
      quotedCreditCost: quote,
      creditUnit: 'script',
      message: 'Open deepLink, Approve, then retry this tool with the same arguments plus approvalRequestId.',
      boundInput,
    }
  }

  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_script_generate',
    input: boundInput,
  })
  if (!consumed.ok) throw new Error(consumed.reason)

  const limit = await checkUsageLimit(options.user.id, 'script')
  if (!limit.allowed) throw new Error('Script credit limit reached')

  const ctx = await mcpGetBrandContext(options.db, options.user, brandId)
  const offer = boundInput.offerId
    ? ctx.offers.find((o) => o.id === boundInput.offerId)
    : ctx.offers[0]

  const pipeline = await runGuionesStructuredPipeline({
    apiKey: xaiKey(),
    language,
    businessContext: {
      name: ctx.brand.name,
      location: ctx.brand.location || undefined,
      sales_channels: (ctx.brand.salesChannels || undefined) as SalesChannel[] | undefined,
      icp_description: ctx.brand.icpDescription || ctx.brandKit?.targetAudience || undefined,
    },
    productContext: offer
      ? {
          name: offer.name,
          type: (offer.type as ProductType | undefined) || undefined,
          product_description: ctx.brandKit?.tagline || undefined,
        }
      : {
          name: ctx.brand.name,
          type: 'product',
        },
    scriptSettings: {
      framework: 'venta_directa',
      variations: 1,
      useStructuredPipeline: true,
    } satisfies ScriptSettings,
  })

  const text = pipeline.content || JSON.stringify(pipeline.scripts || [], null, 2)
  await logApiUsage({
    userId: options.user.id,
    userEmail: options.user.email || undefined,
    feature: 'script',
    model: GROK_TEXT_MODEL,
    inputTokens: estimateTokens(text) ,
    outputTokens: estimateTokens(text),
    success: true,
    metadata: { action: 'mcp_execute_script_generate', brandId, approvalRequestId },
  })
  await incrementUsage(options.user.id, 'script')

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged: 1,
    brandId,
    offerId: offer?.id || null,
    scripts: pipeline.scripts || null,
    content: text,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}`,
  }
}

export async function mcpExecuteImageGenerate(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const approvalRequestId = typeof options.args.approvalRequestId === 'string'
    ? options.args.approvalRequestId
    : ''
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    scene: typeof options.args.scene === 'string' ? options.args.scene : undefined,
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '9:16',
  }

  if (!approvalRequestId) {
    const quote = 1
    const req = await issueMcpApprovalRequest(options.approvalStore, {
      userId: options.user.id,
      toolName: 'execute_image_generate',
      input: boundInput,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
    })
    return {
      ...req,
      toolName: 'execute_image_generate',
      quotedCreditCost: quote,
      creditUnit: 'image',
      message: 'Open deepLink, Approve, then retry this tool with the same arguments plus approvalRequestId.',
      boundInput,
    }
  }

  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_generate',
    input: boundInput,
  })
  if (!consumed.ok) throw new Error(consumed.reason)

  const limit = await checkUsageLimit(options.user.id, 'image')
  if (!limit.allowed) throw new Error('Image credit limit reached')

  const guide = await mcpGuideImage(options.db, options.user, {
    brandId,
    offerId: boundInput.offerId,
    scene: boundInput.scene,
    aspectRatio: boundInput.aspectRatio,
  })
  const prompt = String(guide.prompt || '')
  const refs = Array.isArray(guide.referenceUrls)
    ? guide.referenceUrls.filter((u): u is string => typeof u === 'string')
    : []

  const generated = await runGrokImageGenerate({
    apiKey: xaiKey(),
    prompt,
    aspectRatio: boundInput.aspectRatio,
    referenceImageUrls: refs,
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
      resolution: generated.resolution,
      quality: generated.quality,
    },
  })
  await incrementUsage(options.user.id, 'image')
  await deductBonusImage(options.user.id)

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged: 1,
    brandId,
    providerModel: generated.providerModel,
    aspectRatio: generated.aspectRatio,
    resolution: generated.resolution,
    quality: generated.quality,
    estimatedCostUsd: generated.estimatedCostUsd,
    // Data URL so Grok can display; also point user to chat for library persistence later
    imageDataUrl: generated.imageDataUrl,
    prompt,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}`,
    note: 'Image generated on Advance credits. Library auto-save via workspace_save_artifact comes next if needed.',
  }
}
