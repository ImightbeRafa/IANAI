/**
 * MCP EXECUTE — script + image generation behind in-chat approval, auto-saved to library.
 *
 * Charge order: check limit → generate → save → incrementUsage (fail closed)
 * → storeMcpApprovalResult → consumeMcpApprovalRequest.
 * If generate fails, the approval stays approved and reusable.
 */

import {
  checkUsageLimit,
  incrementUsage,
  deductBonusImage,
  quoteLegacyActionCredits,
} from '../auth.js'
import { isCreditsV1Enabled } from '../credits/catalog.js'
import { logApiUsage, estimateTokens } from '../usage-logger.js'
import { runGuionesStructuredPipeline } from '../guiones/script-pipeline.js'
import { GROK_TEXT_MODEL } from '../grok-models.js'
import { runGrokImageGenerate } from '../grok-image-generate.js'
import { buildImageEditSystemPrompt, runGrokImageEdit } from '../grok-image-edit.js'
import {
  buildEnhanceSystemPrompt,
  resolveEnhanceTier,
  resolveEnhanceUserDirection,
} from '../image-enhance.js'
import { assertPublicHttpUrl } from '../url-safety.js'
import {
  GEMINI_CAROUSEL_IMAGE_MODEL,
  MCP_HOST_MAX_DURATION_SEC,
  VALID_CAROUSEL_ASPECT_RATIOS,
  normalizeCarouselSubtype,
  quoteCarouselCredits,
  runOrganicCarouselGenerate,
  sanitizeCarouselText,
} from '../organic-carousel.js'
import {
  assertMcpApprovalReady,
  consumeMcpApprovalRequest,
  replayMcpApprovalResult,
  storeMcpApprovalResult,
  type McpApprovalStore,
} from './approval.js'
import { issueMcpChatApproval } from './approval-prompt.js'
import {
  asJobHandleFromStored,
  buildFailedJobResult,
  claimMcpExecuteJob,
  scheduleMcpExecuteWork,
  shouldReplayStoredExecuteResult,
  withChargedCredits,
} from './execute-job.js'
import { assertMcpCarouselSlideCount } from './limits.js'
import { mcpGetBrandContext, type McpAuthUser, type McpDbClient } from './user-tools.js'
import { mcpGuideImage } from './guide-packs.js'
import type { McpArtifactStore } from './artifact-store.js'
import type { ProductType, SalesChannel, ScriptSettings } from '../guiones/types.js'

const APPROVAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function generationIdFromApproval(approvalRequestId: string, fallbackSuffix: string): string {
  if (APPROVAL_UUID_RE.test(approvalRequestId)) return approvalRequestId
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${fallbackSuffix}`
}

async function chargeMcpCredits(options: {
  userId: string
  action: 'script' | 'image' | 'enhance' | 'edit'
  generationId: string
  imageModel?: string | null
}): Promise<number> {
  const incrementResult = await incrementUsage(options.userId, options.action, {
    generationId: options.generationId,
    imageModel: options.imageModel,
  })
  if (incrementResult?.creditsError) {
    throw new Error(`Credit charge failed: ${incrementResult.creditsError}`)
  }
  return incrementResult?.creditsCharged ?? 0
}

async function requireApprovedMcpRequest(options: {
  approvalStore: McpApprovalStore
  approvalRequestId: string
  userId: string
  toolName: string
  input: unknown
}): Promise<void> {
  const ready = await assertMcpApprovalReady(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.userId,
    toolName: options.toolName,
    input: options.input,
  })
  if (!ready.ok) throw new Error(ready.reason)
}

async function finalizeMcpApproval(options: {
  approvalStore: McpApprovalStore
  approvalRequestId: string
  userId: string
  toolName: string
  input: unknown
  result: Record<string, unknown>
}): Promise<void> {
  await storeMcpApprovalResult(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    result: options.result,
  })
  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.userId,
    toolName: options.toolName,
    input: options.input,
  })
  if (!consumed.ok) throw new Error(consumed.reason)
}

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

  // Validate brand/offer before issuing approval or running generate
  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const boundWithOffer = { ...boundInput, offerId }

  if (!approvalRequestId) {
    const quote = quoteLegacyActionCredits('script')
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.user.id,
      toolName: 'execute_script_generate',
      input: boundWithOffer,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
      language,
    })
  }

  const quote = quoteLegacyActionCredits('script')
  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_script_generate',
    input: boundWithOffer,
  })
  if (replay.ok) {
    const formatted = asJobHandleFromStored(approvalRequestId, replay.result, 'execute_script_generate')
    const payload = formatted || replay.result
    // Stale running / failed must fall through to reclaim (replay runs before claim)
    if (shouldReplayStoredExecuteResult(payload)) {
      return {
        ...(payload as Record<string, unknown>),
        replayed: true,
      }
    }
  }

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_script_generate',
    input: boundWithOffer,
  })

  const limit = await checkUsageLimit(options.user.id, 'script')
  if (!limit.allowed) throw new Error('Script credit limit reached')

  const claim = await claimMcpExecuteJob(options.approvalStore, {
    approvalRequestId,
    toolName: 'execute_script_generate',
    quotedCreditCost: quote,
  })
  if (!claim.claimed) {
    const formatted = asJobHandleFromStored(approvalRequestId, claim.existing, 'execute_script_generate')
    return (formatted || { status: 'running', jobId: approvalRequestId, approvalRequestId, chargedCredits: 0 }) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const result = await runScriptGenerateBody({
        db: options.db,
        artifactStore: options.artifactStore,
        user: options.user,
        brandId,
        offerId,
        language,
        sessionIdArg,
        approvalRequestId,
        appOrigin: options.appOrigin,
        ctxPreview,
        quote,
      })
      await finalizeMcpApproval({
        approvalStore: options.approvalStore,
        approvalRequestId,
        userId: options.user.id,
        toolName: 'execute_script_generate',
        input: boundWithOffer,
        result,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Script generate failed'
      await storeMcpApprovalResult(options.approvalStore, {
        approvalRequestId,
        result: buildFailedJobResult({
          approvalRequestId,
          toolName: 'execute_script_generate',
          error: message,
          quotedCreditCost: quote,
        }),
      })
      console.error('mcp execute_script_generate job', message)
    }
  }
  scheduleMcpExecuteWork(work)
  return claim.handle as unknown as Record<string, unknown>
}

async function runScriptGenerateBody(options: {
  db: McpDbClient
  artifactStore: McpArtifactStore
  user: McpAuthUser
  brandId: string
  offerId: string
  language: 'es' | 'en'
  sessionIdArg?: string
  approvalRequestId: string
  appOrigin?: string
  ctxPreview: Awaited<ReturnType<typeof mcpGetBrandContext>>
  quote: number
}): Promise<Record<string, unknown>> {
  const scriptGenerationId = generationIdFromApproval(options.approvalRequestId, 'script')
  const ctx = options.ctxPreview
  const offer = ctx.offers.find((o) => o.id === options.offerId)!

  const pipeline = await runGuionesStructuredPipeline({
    apiKey: xaiKey(),
    language: options.language,
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
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId: options.sessionIdArg,
    title: `MCP script — ${offer.name}`,
  })
  const saved = await options.artifactStore.saveScriptArtifact({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    title: `${offer.name} script`,
    content: text,
    approvalRequestId: options.approvalRequestId,
  })

  await logApiUsage({
    userId: options.user.id,
    userEmail: options.user.email || undefined,
    feature: 'script',
    model: GROK_TEXT_MODEL,
    inputTokens: estimateTokens(text),
    outputTokens: estimateTokens(text),
    success: true,
    generationId: scriptGenerationId,
    source: 'mcp',
    metadata: {
      action: 'mcp_execute_script_generate',
      source: 'mcp',
      brandId: options.brandId,
      approvalRequestId: options.approvalRequestId,
      sessionId,
      chargedCredits: options.quote,
    },
  })
  const charged = await chargeMcpCredits({
    userId: options.user.id,
    action: 'script',
    generationId: scriptGenerationId,
  })

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return withChargedCredits({
    status: 'completed',
    jobId: options.approvalRequestId,
    approvalRequestId: options.approvalRequestId,
    toolName: 'execute_script_generate',
    consumesAdvanceCredits: true,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    messageId: saved.messageId,
    scriptId: saved.scriptId,
    scripts: pipeline.scripts || null,
    content: text,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}&session=${encodeURIComponent(sessionId)}`,
  }, charged, options.quote, 'execute_script_generate')
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
    const quote = quoteLegacyActionCredits('image', 'grok-imagine')
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.user.id,
      toolName: 'execute_image_generate',
      input: boundWithOffer,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
    })
  }

  const quote = quoteLegacyActionCredits('image', 'grok-imagine')
  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_generate',
    input: boundWithOffer,
  })
  if (replay.ok) {
    const formatted = asJobHandleFromStored(approvalRequestId, replay.result, 'execute_image_generate')
    const payload = formatted || replay.result
    // Stale running / failed must fall through to reclaim (replay runs before claim)
    if (shouldReplayStoredExecuteResult(payload)) {
      return {
        ...(payload as Record<string, unknown>),
        replayed: true,
      }
    }
  }

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_generate',
    input: boundWithOffer,
  })

  const limit = await checkUsageLimit(options.user.id, 'image', { imageModel: 'grok-imagine' })
  if (!limit.allowed) throw new Error('Image credit limit reached')

  const claim = await claimMcpExecuteJob(options.approvalStore, {
    approvalRequestId,
    toolName: 'execute_image_generate',
    quotedCreditCost: quote,
  })
  if (!claim.claimed) {
    const formatted = asJobHandleFromStored(approvalRequestId, claim.existing, 'execute_image_generate')
    return (formatted || { status: 'running', jobId: approvalRequestId, approvalRequestId, chargedCredits: 0 }) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const result = await runImageGenerateBody({
        db: options.db,
        artifactStore: options.artifactStore,
        user: options.user,
        brandId,
        offerId,
        scene: boundWithOffer.scene,
        aspectRatio: boundWithOffer.aspectRatio,
        sessionIdArg,
        approvalRequestId,
        appOrigin: options.appOrigin,
        ctxPreview,
        quote,
      })
      await finalizeMcpApproval({
        approvalStore: options.approvalStore,
        approvalRequestId,
        userId: options.user.id,
        toolName: 'execute_image_generate',
        input: boundWithOffer,
        result,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image generate failed'
      await storeMcpApprovalResult(options.approvalStore, {
        approvalRequestId,
        result: buildFailedJobResult({
          approvalRequestId,
          toolName: 'execute_image_generate',
          error: message,
          quotedCreditCost: quote,
        }),
      })
      console.error('mcp execute_image_generate job', message)
    }
  }
  scheduleMcpExecuteWork(work)
  return claim.handle as unknown as Record<string, unknown>
}

async function runImageGenerateBody(options: {
  db: McpDbClient
  artifactStore: McpArtifactStore
  user: McpAuthUser
  brandId: string
  offerId: string
  scene?: string
  aspectRatio: string
  sessionIdArg?: string
  approvalRequestId: string
  appOrigin?: string
  ctxPreview: Awaited<ReturnType<typeof mcpGetBrandContext>>
  quote: number
}): Promise<Record<string, unknown>> {
  const imageGenerationId = generationIdFromApproval(options.approvalRequestId, 'image')

  const guide = await mcpGuideImage(options.db, options.user, {
    brandId: options.brandId,
    offerId: options.offerId,
    scene: options.scene,
    aspectRatio: options.aspectRatio,
  })
  const prompt = String(guide.prompt || '')
  const refs = Array.isArray(guide.referenceUrls)
    ? guide.referenceUrls.filter((u): u is string => typeof u === 'string')
    : []

  const generated = await runGrokImageGenerate({
    apiKey: xaiKey(),
    prompt,
    aspectRatio: options.aspectRatio,
    referenceImageUrls: refs,
  })

  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId: options.sessionIdArg,
    title: `MCP image — ${options.ctxPreview.offers.find((o) => o.id === options.offerId)?.name || options.offerId}`,
  })
  const saved = await options.artifactStore.saveImageArtifact({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    imageDataUrl: generated.imageDataUrl,
    label: 'MCP generate',
    approvalRequestId: options.approvalRequestId,
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
    generationId: imageGenerationId,
    source: 'mcp',
    metadata: {
      action: 'mcp_execute_image_generate',
      source: 'mcp',
      brandId: options.brandId,
      approvalRequestId: options.approvalRequestId,
      sessionId,
      resolution: generated.resolution,
      quality: generated.quality,
      chargedCredits: options.quote,
    },
  })
  const charged = await chargeMcpCredits({
    userId: options.user.id,
    action: 'image',
    generationId: imageGenerationId,
    imageModel: 'grok-imagine',
  })
  if (!isCreditsV1Enabled()) {
    await deductBonusImage(options.user.id)
  }

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return withChargedCredits({
    status: 'completed',
    jobId: options.approvalRequestId,
    approvalRequestId: options.approvalRequestId,
    toolName: 'execute_image_generate',
    consumesAdvanceCredits: true,
    brandId: options.brandId,
    offerId: options.offerId,
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
    deepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}&session=${encodeURIComponent(sessionId)}`,
    note: 'Image saved to Advance library as high-quality JPEG (HTTPS URL only — no blob in job result). Open deepLink to view in chat.',
  }, charged, options.quote, 'execute_image_generate')
}

function rejectHugeBase64(label: string, value?: string): void {
  if (!value) return
  if (/^data:/i.test(value) || value.length > 8_000) {
    throw new Error(`${label}: pass an https URL or productImageId already in the workspace (no base64).`)
  }
}

async function resolveMcpSourceImage(options: {
  artifactStore: McpArtifactStore
  userId: string
  brandId: string
  offerId?: string
  productImageId?: string
  imageUrl?: string
}): Promise<{ imageUrl: string; productImageId?: string }> {
  if (options.productImageId) {
    const owned = await options.artifactStore.getOwnedProductImage({
      userId: options.userId,
      brandId: options.brandId,
      imageId: options.productImageId,
      offerId: options.offerId,
    })
    if (!owned) throw new Error('productImageId not found for this brand/user')
    return { imageUrl: owned.imageUrl, productImageId: owned.id }
  }
  if (options.imageUrl) {
    rejectHugeBase64('imageUrl', options.imageUrl)
    const parsed = assertPublicHttpUrl(options.imageUrl)
    if (parsed.protocol !== 'https:') throw new Error('Only https imageUrl is allowed')
    return { imageUrl: parsed.toString() }
  }
  throw new Error('productImageId or https imageUrl is required')
}

export async function mcpExecuteImageEdit(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const editPrompt = typeof options.args.editPrompt === 'string' ? options.args.editPrompt.trim() : ''
  if (!editPrompt) throw new Error('editPrompt is required')
  const approvalRequestId = typeof options.args.approvalRequestId === 'string' ? options.args.approvalRequestId : ''
  const sessionIdArg = typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined
  const productImageId = typeof options.args.productImageId === 'string' ? options.args.productImageId : undefined
  const imageUrlArg = typeof options.args.imageUrl === 'string' ? options.args.imageUrl : undefined
  rejectHugeBase64('imageUrl', imageUrlArg)
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    productImageId,
    imageUrl: imageUrlArg,
    editPrompt,
    // Do not silently force 9:16 — omitted aspect defaults to 1:1
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '1:1',
    sessionId: sessionIdArg,
  }

  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const boundWithOffer = { ...boundInput, offerId }
  const quote = quoteLegacyActionCredits('edit')

  if (!approvalRequestId) {
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.user.id,
      toolName: 'execute_image_edit',
      input: boundWithOffer,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
    })
  }

  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_edit',
    input: boundWithOffer,
  })
  if (replay.ok) {
    const formatted = asJobHandleFromStored(approvalRequestId, replay.result, 'execute_image_edit')
    const payload = formatted || replay.result
    if (shouldReplayStoredExecuteResult(payload)) {
      return {
        ...(payload as Record<string, unknown>),
        replayed: true,
      }
    }
  }

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_edit',
    input: boundWithOffer,
  })

  const limit = await checkUsageLimit(options.user.id, 'edit', { imageModel: 'grok-imagine' })
  if (!limit.allowed) throw new Error('Image edit credit limit reached')

  const claim = await claimMcpExecuteJob(options.approvalStore, {
    approvalRequestId,
    toolName: 'execute_image_edit',
    quotedCreditCost: quote,
  })
  if (!claim.claimed) {
    const formatted = asJobHandleFromStored(approvalRequestId, claim.existing, 'execute_image_edit')
    return (formatted || {
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName: 'execute_image_edit',
      chargedCredits: 0,
    }) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const result = await runImageEditBody({
        artifactStore: options.artifactStore,
        user: options.user,
        brandId,
        offerId,
        productImageId,
        imageUrlArg,
        editPrompt,
        aspectRatio: boundWithOffer.aspectRatio,
        sessionIdArg,
        approvalRequestId,
        appOrigin: options.appOrigin,
        ctxPreview,
        quote,
      })
      await finalizeMcpApproval({
        approvalStore: options.approvalStore,
        approvalRequestId,
        userId: options.user.id,
        toolName: 'execute_image_edit',
        input: boundWithOffer,
        result,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image edit failed'
      await storeMcpApprovalResult(options.approvalStore, {
        approvalRequestId,
        result: buildFailedJobResult({
          approvalRequestId,
          toolName: 'execute_image_edit',
          error: message,
          quotedCreditCost: quote,
        }),
      })
      console.error('mcp execute_image_edit job', message)
    }
  }
  scheduleMcpExecuteWork(work)
  return claim.handle as unknown as Record<string, unknown>
}

async function runImageEditBody(options: {
  artifactStore: McpArtifactStore
  user: McpAuthUser
  brandId: string
  offerId: string
  productImageId?: string
  imageUrlArg?: string
  editPrompt: string
  aspectRatio: string
  sessionIdArg?: string
  approvalRequestId: string
  appOrigin?: string
  ctxPreview: Awaited<ReturnType<typeof mcpGetBrandContext>>
  quote: number
}): Promise<Record<string, unknown>> {
  const source = await resolveMcpSourceImage({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    productImageId: options.productImageId,
    imageUrl: options.imageUrlArg,
  })

  const generationId = generationIdFromApproval(options.approvalRequestId, 'edit')
  const kit = options.ctxPreview.brandKit
  const brandRules = [
    kit?.primaryColor ? `Primary ${kit.primaryColor}` : null,
    kit?.secondaryColor ? `Secondary ${kit.secondaryColor}` : null,
    kit?.visualStyleNotes || null,
    kit?.logoUrl ? `Official logo: ${kit.logoUrl}` : null,
  ].filter(Boolean).join('\n')
  const prompt = buildImageEditSystemPrompt({
    editPrompt: options.editPrompt,
    brandRules,
  })
  const generated = await runGrokImageEdit({
    apiKey: xaiKey(),
    prompt,
    baseImageUrl: source.imageUrl,
    aspectRatio: options.aspectRatio,
  })

  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId: options.sessionIdArg,
    title: `MCP edit — ${options.ctxPreview.offers.find((o) => o.id === options.offerId)?.name || options.offerId}`,
  })
  const saved = await options.artifactStore.saveImageArtifact({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    imageDataUrl: generated.imageDataUrl,
    label: 'MCP edit',
    approvalRequestId: options.approvalRequestId,
    actionType: 'edit',
    metadata: {
      resolution: generated.resolution,
      quality: generated.quality,
      providerModel: generated.providerModel,
      sourceProductImageId: source.productImageId || null,
    },
  })

  await logApiUsage({
    userId: options.user.id,
    userEmail: options.user.email || undefined,
    feature: 'edit',
    model: generated.providerModel,
    success: true,
    costOverrideUsd: generated.estimatedCostUsd,
    generationId,
    source: 'mcp',
    metadata: {
      action: 'mcp_execute_image_edit',
      source: 'mcp',
      brandId: options.brandId,
      approvalRequestId: options.approvalRequestId,
      sessionId,
    },
  })
  const charged = await chargeMcpCredits({
    userId: options.user.id,
    action: 'edit',
    generationId,
    imageModel: 'grok-imagine',
  })
  if (!isCreditsV1Enabled()) {
    await deductBonusImage(options.user.id)
  }

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return withChargedCredits({
    status: 'completed',
    jobId: options.approvalRequestId,
    approvalRequestId: options.approvalRequestId,
    toolName: 'execute_image_edit',
    consumesAdvanceCredits: true,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    messageId: saved.messageId,
    productImageId: saved.productImageId,
    imageUrl: saved.imageUrl,
    providerModel: generated.providerModel,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}&session=${encodeURIComponent(sessionId)}`,
  }, charged, options.quote, 'execute_image_edit')
}

export async function mcpExecuteImageEnhance(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const approvalRequestId = typeof options.args.approvalRequestId === 'string' ? options.args.approvalRequestId : ''
  const sessionIdArg = typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined
  const productImageId = typeof options.args.productImageId === 'string' ? options.args.productImageId : undefined
  const imageUrlArg = typeof options.args.imageUrl === 'string' ? options.args.imageUrl : undefined
  rejectHugeBase64('imageUrl', imageUrlArg)
  const enhanceTier = resolveEnhanceTier(options.args.enhanceTier)
  const language = options.args.language === 'en' ? 'en' : 'es'
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    productImageId,
    imageUrl: imageUrlArg,
    enhanceTier,
    instruction: typeof options.args.instruction === 'string' ? options.args.instruction : undefined,
    // Do not silently force 9:16 — omitted aspect defaults to 1:1
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '1:1',
    language,
    sessionId: sessionIdArg,
  }

  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const boundWithOffer = { ...boundInput, offerId }
  const quote = quoteLegacyActionCredits('enhance')

  if (!approvalRequestId) {
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.user.id,
      toolName: 'execute_image_enhance',
      input: boundWithOffer,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
      language: boundInput.language,
    })
  }

  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_enhance',
    input: boundWithOffer,
  })
  if (replay.ok) {
    const formatted = asJobHandleFromStored(approvalRequestId, replay.result, 'execute_image_enhance')
    const payload = formatted || replay.result
    if (shouldReplayStoredExecuteResult(payload)) {
      return {
        ...(payload as Record<string, unknown>),
        replayed: true,
      }
    }
  }

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_enhance',
    input: boundWithOffer,
  })

  const limit = await checkUsageLimit(options.user.id, 'enhance', { imageModel: 'grok-imagine' })
  if (!limit.allowed) throw new Error('Image enhance credit limit reached')

  const claim = await claimMcpExecuteJob(options.approvalStore, {
    approvalRequestId,
    toolName: 'execute_image_enhance',
    quotedCreditCost: quote,
  })
  if (!claim.claimed) {
    const formatted = asJobHandleFromStored(approvalRequestId, claim.existing, 'execute_image_enhance')
    return (formatted || {
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName: 'execute_image_enhance',
      chargedCredits: 0,
    }) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const result = await runImageEnhanceBody({
        artifactStore: options.artifactStore,
        user: options.user,
        brandId,
        offerId,
        productImageId,
        imageUrlArg,
        enhanceTier,
        instruction: boundWithOffer.instruction,
        aspectRatio: boundWithOffer.aspectRatio,
        language,
        sessionIdArg,
        approvalRequestId,
        appOrigin: options.appOrigin,
        ctxPreview,
        quote,
      })
      await finalizeMcpApproval({
        approvalStore: options.approvalStore,
        approvalRequestId,
        userId: options.user.id,
        toolName: 'execute_image_enhance',
        input: boundWithOffer,
        result,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image enhance failed'
      await storeMcpApprovalResult(options.approvalStore, {
        approvalRequestId,
        result: buildFailedJobResult({
          approvalRequestId,
          toolName: 'execute_image_enhance',
          error: message,
          quotedCreditCost: quote,
        }),
      })
      console.error('mcp execute_image_enhance job', message)
    }
  }
  scheduleMcpExecuteWork(work)
  return claim.handle as unknown as Record<string, unknown>
}

async function runImageEnhanceBody(options: {
  artifactStore: McpArtifactStore
  user: McpAuthUser
  brandId: string
  offerId: string
  productImageId?: string
  imageUrlArg?: string
  enhanceTier: ReturnType<typeof resolveEnhanceTier>
  instruction?: string
  aspectRatio: string
  language: 'es' | 'en'
  sessionIdArg?: string
  approvalRequestId: string
  appOrigin?: string
  ctxPreview: Awaited<ReturnType<typeof mcpGetBrandContext>>
  quote: number
}): Promise<Record<string, unknown>> {
  const source = await resolveMcpSourceImage({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    productImageId: options.productImageId,
    imageUrl: options.imageUrlArg,
  })

  const generationId = generationIdFromApproval(options.approvalRequestId, 'enhance')
  const kit = options.ctxPreview.brandKit
  const brandPrefix = [
    kit?.primaryColor ? `USA SOLO ESTOS COLORES DE MARCA: ${[kit.primaryColor, kit.secondaryColor, kit.accentColor].filter(Boolean).join(', ')}` : null,
    kit?.visualStyleNotes || null,
  ].filter(Boolean).join('\n')
  const prompt = buildEnhanceSystemPrompt({
    language: options.language,
    tier: options.enhanceTier,
    hasProductRef: false,
    brandPrefix,
    userDirection: resolveEnhanceUserDirection(options.instruction, null),
  })
  const generated = await runGrokImageEdit({
    apiKey: xaiKey(),
    prompt,
    baseImageUrl: source.imageUrl,
    aspectRatio: options.aspectRatio,
  })

  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId: options.sessionIdArg,
    title: `MCP enhance — ${options.ctxPreview.offers.find((o) => o.id === options.offerId)?.name || options.offerId}`,
  })
  const saved = await options.artifactStore.saveImageArtifact({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    imageDataUrl: generated.imageDataUrl,
    label: `MCP enhance (${options.enhanceTier})`,
    approvalRequestId: options.approvalRequestId,
    actionType: 'enhance',
    metadata: {
      enhanceTier: options.enhanceTier,
      resolution: generated.resolution,
      quality: generated.quality,
      providerModel: generated.providerModel,
      sourceProductImageId: source.productImageId || null,
    },
  })

  await logApiUsage({
    userId: options.user.id,
    userEmail: options.user.email || undefined,
    feature: 'enhance',
    model: generated.providerModel,
    success: true,
    costOverrideUsd: generated.estimatedCostUsd,
    generationId,
    source: 'mcp',
    metadata: {
      action: 'mcp_execute_image_enhance',
      source: 'mcp',
      brandId: options.brandId,
      approvalRequestId: options.approvalRequestId,
      sessionId,
      enhanceTier: options.enhanceTier,
    },
  })
  const charged = await chargeMcpCredits({
    userId: options.user.id,
    action: 'enhance',
    generationId,
    imageModel: 'grok-imagine',
  })

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return withChargedCredits({
    status: 'completed',
    jobId: options.approvalRequestId,
    approvalRequestId: options.approvalRequestId,
    toolName: 'execute_image_enhance',
    consumesAdvanceCredits: true,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    messageId: saved.messageId,
    productImageId: saved.productImageId,
    imageUrl: saved.imageUrl,
    enhanceTier: options.enhanceTier,
    providerModel: generated.providerModel,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}&session=${encodeURIComponent(sessionId)}`,
  }, charged, options.quote, 'execute_image_enhance')
}

export async function mcpExecuteCarouselGenerate(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const scriptContent = typeof options.args.scriptContent === 'string' ? options.args.scriptContent.trim() : ''
  if (!scriptContent) throw new Error('scriptContent is required')
  const slideCount = typeof options.args.slideCount === 'number' || typeof options.args.slideCount === 'string'
    ? assertMcpCarouselSlideCount(Number(options.args.slideCount), 10)
    : 5
  const subtype = options.args.subtype
    ? normalizeCarouselSubtype(options.args.subtype)
    : 'educational-list'
  const aspectRatio = VALID_CAROUSEL_ASPECT_RATIOS.includes(options.args.aspectRatio as typeof VALID_CAROUSEL_ASPECT_RATIOS[number])
    ? options.args.aspectRatio as typeof VALID_CAROUSEL_ASPECT_RATIOS[number]
    : '1:1'
  const language = options.args.language === 'en' ? 'en' : 'es'
  const previewFirstSlideOnly = options.args.previewFirstSlideOnly === true
  const requiredSlides = previewFirstSlideOnly ? 1 : slideCount
  const quote = quoteCarouselCredits(requiredSlides)
  const approvalRequestId = typeof options.args.approvalRequestId === 'string' ? options.args.approvalRequestId : ''
  const sessionIdArg = typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined

  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    scriptContent,
    subtype,
    slideCount,
    aspectRatio,
    language,
    designDirection: sanitizeCarouselText(options.args.designDirection, 1500),
    slideDetails: sanitizeCarouselText(options.args.slideDetails, 3000),
    previewFirstSlideOnly,
    sessionId: sessionIdArg,
  }

  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const boundWithOffer = { ...boundInput, offerId }

  if (!approvalRequestId) {
    const slideLabelEs = previewFirstSlideOnly
      ? `1 slide preview / ${quote} créditos`
      : `${requiredSlides} slides / ${quote} créditos`
    const slideLabelEn = previewFirstSlideOnly
      ? `1-slide preview / ${quote} credits`
      : `${requiredSlides} slides / ${quote} credits`
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.user.id,
      toolName: 'execute_carousel_generate',
      input: boundWithOffer,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
      language: boundInput.language === 'en' ? 'en' : 'es',
      summaryEs: `Generar carrusel (${slideLabelEs})`,
      summaryEn: `Generate carousel (${slideLabelEn})`,
      extra: {
        billedSlideCount: requiredSlides,
        previewFirstSlideOnly,
        durationNote: `MCP host maxDuration is ${MCP_HOST_MAX_DURATION_SEC}s; carousel API allows 240s. Prefer slideCount ≤ 5 if the host times out.`,
      },
    })
  }

  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_carousel_generate',
    input: boundWithOffer,
  })
  if (replay.ok) {
    const formatted = asJobHandleFromStored(approvalRequestId, replay.result, 'execute_carousel_generate')
    const payload = formatted || replay.result
    if (shouldReplayStoredExecuteResult(payload)) {
      return {
        ...(payload as Record<string, unknown>),
        replayed: true,
      }
    }
  }

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_carousel_generate',
    input: boundWithOffer,
  })

  const limit = await checkUsageLimit(options.user.id, 'image', {
    imageModel: GEMINI_CAROUSEL_IMAGE_MODEL,
    units: requiredSlides,
  })
  if (!limit.allowed) {
    throw new Error(
      limit.creditsRequired
        ? `Need ${limit.creditsRequired} AI credits for this carousel (${requiredSlides} slides).`
        : 'Carousel credit limit reached'
    )
  }

  const claim = await claimMcpExecuteJob(options.approvalStore, {
    approvalRequestId,
    toolName: 'execute_carousel_generate',
    quotedCreditCost: quote,
  })
  if (!claim.claimed) {
    const formatted = asJobHandleFromStored(approvalRequestId, claim.existing, 'execute_carousel_generate')
    return (formatted || {
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName: 'execute_carousel_generate',
      chargedCredits: 0,
    }) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const result = await runCarouselGenerateBody({
        artifactStore: options.artifactStore,
        user: options.user,
        brandId,
        offerId,
        subtype,
        slideCount,
        scriptContent,
        aspectRatio,
        language,
        designDirection: boundWithOffer.designDirection,
        slideDetails: boundWithOffer.slideDetails,
        previewFirstSlideOnly,
        sessionIdArg,
        approvalRequestId,
        appOrigin: options.appOrigin,
        ctxPreview,
        quote,
      })
      await finalizeMcpApproval({
        approvalStore: options.approvalStore,
        approvalRequestId,
        userId: options.user.id,
        toolName: 'execute_carousel_generate',
        input: boundWithOffer,
        result,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Carousel generation failed'
      await storeMcpApprovalResult(options.approvalStore, {
        approvalRequestId,
        result: buildFailedJobResult({
          approvalRequestId,
          toolName: 'execute_carousel_generate',
          error: message,
          quotedCreditCost: quote,
        }),
      })
      console.error('mcp execute_carousel_generate job', message)
    }
  }
  scheduleMcpExecuteWork(work)
  return claim.handle as unknown as Record<string, unknown>
}

async function runCarouselGenerateBody(options: {
  artifactStore: McpArtifactStore
  user: McpAuthUser
  brandId: string
  offerId: string
  subtype: ReturnType<typeof normalizeCarouselSubtype>
  slideCount: number
  scriptContent: string
  aspectRatio: typeof VALID_CAROUSEL_ASPECT_RATIOS[number]
  language: 'es' | 'en'
  designDirection?: string
  slideDetails?: string
  previewFirstSlideOnly: boolean
  sessionIdArg?: string
  approvalRequestId: string
  appOrigin?: string
  ctxPreview: Awaited<ReturnType<typeof mcpGetBrandContext>>
  quote: number
}): Promise<Record<string, unknown>> {
  const offer = options.ctxPreview.offers.find((o) => o.id === options.offerId)
  const generated = await runOrganicCarouselGenerate({
    userId: options.user.id,
    subtype: options.subtype,
    slideCount: options.slideCount,
    scriptContent: options.scriptContent,
    aspectRatio: options.aspectRatio,
    language: options.language,
    brandKitId: options.ctxPreview.brandKit?.id,
    designDirection: options.designDirection,
    slideDetails: options.slideDetails,
    previewFirstSlideOnly: options.previewFirstSlideOnly,
    productContext: { name: offer?.name, type: offer?.type || undefined },
  })
  if (generated.succeeded < 1) {
    throw new Error('Carousel generation failed — no slides rendered. Approval was not consumed.')
  }

  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId: options.sessionIdArg,
    title: `MCP carousel — ${offer?.name || options.offerId}`,
  })
  const savedSlides = await options.artifactStore.saveCarouselSlides({
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    carouselGroupId: generated.carouselGroupId,
    subtype: options.subtype,
    approvalRequestId: options.approvalRequestId,
    slides: generated.slides
      .filter((s): s is typeof s & { imageUrl: string } => Boolean(s.imageUrl))
      .map((s) => ({
        index: s.index,
        imageDataUrl: s.imageUrl,
        headline: s.headline,
        role: s.role,
      })),
  })

  await logApiUsage({
    userId: options.user.id,
    userEmail: options.user.email || undefined,
    feature: 'image',
    model: 'nano-banana-pro',
    success: true,
    inputTokens: generated.usageTokens.input,
    outputTokens: generated.usageTokens.output,
    thinkingTokens: generated.usageTokens.thinking,
    source: 'mcp',
    metadata: {
      action: 'mcp_execute_carousel_generate',
      source: 'mcp',
      brandId: options.brandId,
      approvalRequestId: options.approvalRequestId,
      sessionId,
      subtype: options.subtype,
      slideCount: options.slideCount,
      succeeded: generated.succeeded,
    },
  })

  let charged = 0
  for (let i = 0; i < generated.succeeded; i++) {
    const slideGenerationId = `${options.approvalRequestId}-carousel-${i}`
    charged += await chargeMcpCredits({
      userId: options.user.id,
      action: 'image',
      generationId: slideGenerationId,
      imageModel: GEMINI_CAROUSEL_IMAGE_MODEL,
    })
    if (!isCreditsV1Enabled()) {
      await deductBonusImage(options.user.id)
    }
  }

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return withChargedCredits({
    status: 'completed',
    jobId: options.approvalRequestId,
    approvalRequestId: options.approvalRequestId,
    toolName: 'execute_carousel_generate',
    consumesAdvanceCredits: true,
    quotedCreditCost: options.quote,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    carouselGroupId: generated.carouselGroupId,
    subtype: options.subtype,
    totalSlides: generated.totalSlides,
    succeeded: generated.succeeded,
    slides: savedSlides.map((s) => ({
      index: s.index,
      productImageId: s.productImageId,
      imageUrl: s.imageUrl,
      postId: s.postId || null,
    })),
    failed: generated.slides.filter((s) => !s.imageUrl).map((s) => ({ index: s.index, error: s.error })),
    durationNote: `MCP host maxDuration is ${MCP_HOST_MAX_DURATION_SEC}s; large carousels may time out.`,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}&session=${encodeURIComponent(sessionId)}`,
  }, charged, options.quote, 'execute_carousel_generate')
}
