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

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_script_generate',
    input: boundWithOffer,
  })

  const limit = await checkUsageLimit(options.user.id, 'script')
  if (!limit.allowed) throw new Error('Script credit limit reached')

  const scriptGenerationId = generationIdFromApproval(approvalRequestId, 'script')

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
    generationId: scriptGenerationId,
    source: 'mcp',
    metadata: {
      action: 'mcp_execute_script_generate',
      source: 'mcp',
      brandId,
      approvalRequestId,
      sessionId,
    },
  })
  const charged = await chargeMcpCredits({
    userId: options.user.id,
    action: 'script',
    generationId: scriptGenerationId,
  })

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  const result = {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged,
    brandId,
    offerId,
    sessionId,
    messageId: saved.messageId,
    scriptId: saved.scriptId,
    scripts: pipeline.scripts || null,
    content: text,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
  }
  await finalizeMcpApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_script_generate',
    input: boundWithOffer,
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

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_generate',
    input: boundWithOffer,
  })

  const limit = await checkUsageLimit(options.user.id, 'image', { imageModel: 'grok-imagine' })
  if (!limit.allowed) throw new Error('Image credit limit reached')

  const imageGenerationId = generationIdFromApproval(approvalRequestId, 'image')

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
    generationId: imageGenerationId,
    source: 'mcp',
    metadata: {
      action: 'mcp_execute_image_generate',
      source: 'mcp',
      brandId,
      approvalRequestId,
      sessionId,
      resolution: generated.resolution,
      quality: generated.quality,
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
  const result = {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged,
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
  await finalizeMcpApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_generate',
    input: boundWithOffer,
    result,
  })
  return result
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
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '9:16',
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
  if (replay.ok) return { ...(replay.result as Record<string, unknown>), replayed: true }

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_edit',
    input: boundWithOffer,
  })

  const source = await resolveMcpSourceImage({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId,
    offerId,
    productImageId,
    imageUrl: imageUrlArg,
  })

  const limit = await checkUsageLimit(options.user.id, 'edit', { imageModel: 'grok-imagine' })
  if (!limit.allowed) throw new Error('Image edit credit limit reached')

  const generationId = generationIdFromApproval(approvalRequestId, 'edit')
  const kit = ctxPreview.brandKit
  const brandRules = [
    kit?.primaryColor ? `Primary ${kit.primaryColor}` : null,
    kit?.secondaryColor ? `Secondary ${kit.secondaryColor}` : null,
    kit?.visualStyleNotes || null,
    kit?.logoUrl ? `Official logo: ${kit.logoUrl}` : null,
  ].filter(Boolean).join('\n')
  const prompt = buildImageEditSystemPrompt({
    editPrompt,
    brandRules,
  })
  const generated = await runGrokImageEdit({
    apiKey: xaiKey(),
    prompt,
    baseImageUrl: source.imageUrl,
    aspectRatio: boundWithOffer.aspectRatio,
  })

  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId: sessionIdArg,
    title: `MCP edit — ${ctxPreview.offers.find((o) => o.id === offerId)?.name || offerId}`,
  })
  const saved = await options.artifactStore.saveImageArtifact({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId,
    imageDataUrl: generated.imageDataUrl,
    label: 'MCP edit',
    approvalRequestId,
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
      brandId,
      approvalRequestId,
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
  const result = {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged,
    brandId,
    offerId,
    sessionId,
    messageId: saved.messageId,
    productImageId: saved.productImageId,
    imageUrl: saved.imageUrl,
    providerModel: generated.providerModel,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
  }
  await finalizeMcpApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_edit',
    input: boundWithOffer,
    result,
  })
  return result
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
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '9:16',
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
  if (replay.ok) return { ...(replay.result as Record<string, unknown>), replayed: true }

  await requireApprovedMcpRequest({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_enhance',
    input: boundWithOffer,
  })

  const source = await resolveMcpSourceImage({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId,
    offerId,
    productImageId,
    imageUrl: imageUrlArg,
  })

  const limit = await checkUsageLimit(options.user.id, 'enhance', { imageModel: 'grok-imagine' })
  if (!limit.allowed) throw new Error('Image enhance credit limit reached')

  const generationId = generationIdFromApproval(approvalRequestId, 'enhance')
  const kit = ctxPreview.brandKit
  const brandPrefix = [
    kit?.primaryColor ? `USA SOLO ESTOS COLORES DE MARCA: ${[kit.primaryColor, kit.secondaryColor, kit.accentColor].filter(Boolean).join(', ')}` : null,
    kit?.visualStyleNotes || null,
  ].filter(Boolean).join('\n')
  const prompt = buildEnhanceSystemPrompt({
    language,
    tier: enhanceTier,
    hasProductRef: false,
    brandPrefix,
    userDirection: resolveEnhanceUserDirection(boundWithOffer.instruction, null),
  })
  const generated = await runGrokImageEdit({
    apiKey: xaiKey(),
    prompt,
    baseImageUrl: source.imageUrl,
    aspectRatio: boundWithOffer.aspectRatio,
  })

  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId: sessionIdArg,
    title: `MCP enhance — ${ctxPreview.offers.find((o) => o.id === offerId)?.name || offerId}`,
  })
  const saved = await options.artifactStore.saveImageArtifact({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId,
    imageDataUrl: generated.imageDataUrl,
    label: `MCP enhance (${enhanceTier})`,
    approvalRequestId,
    actionType: 'enhance',
    metadata: {
      enhanceTier,
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
      brandId,
      approvalRequestId,
      sessionId,
      enhanceTier,
    },
  })
  const charged = await chargeMcpCredits({
    userId: options.user.id,
    action: 'enhance',
    generationId,
    imageModel: 'grok-imagine',
  })

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  const result = {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged,
    brandId,
    offerId,
    sessionId,
    messageId: saved.messageId,
    productImageId: saved.productImageId,
    imageUrl: saved.imageUrl,
    enhanceTier,
    providerModel: generated.providerModel,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
  }
  await finalizeMcpApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_image_enhance',
    input: boundWithOffer,
    result,
  })
  return result
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
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.user.id,
      toolName: 'execute_carousel_generate',
      input: boundWithOffer,
      quotedCreditCost: quote,
      appOrigin: options.appOrigin,
      language: boundInput.language === 'en' ? 'en' : 'es',
      extra: {
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
  if (replay.ok) return { ...(replay.result as Record<string, unknown>), replayed: true }

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

  const offer = ctxPreview.offers.find((o) => o.id === offerId)
  const generated = await runOrganicCarouselGenerate({
    userId: options.user.id,
    subtype,
    slideCount,
    scriptContent,
    aspectRatio,
    language,
    brandKitId: ctxPreview.brandKit?.id,
    designDirection: boundWithOffer.designDirection,
    slideDetails: boundWithOffer.slideDetails,
    previewFirstSlideOnly,
    productContext: { name: offer?.name, type: offer?.type || undefined },
  })
  if (generated.succeeded < 1) {
    throw new Error('Carousel generation failed — no slides rendered. Approval was not consumed.')
  }

  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId: sessionIdArg,
    title: `MCP carousel — ${offer?.name || offerId}`,
  })
  const savedSlides = await options.artifactStore.saveCarouselSlides({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId,
    carouselGroupId: generated.carouselGroupId,
    subtype,
    approvalRequestId,
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
      brandId,
      approvalRequestId,
      sessionId,
      subtype,
      slideCount,
      succeeded: generated.succeeded,
    },
  })

  let charged = 0
  for (let i = 0; i < generated.succeeded; i++) {
    const slideGenerationId = globalThis.crypto?.randomUUID?.() || `${generationIdFromApproval(approvalRequestId, 'carousel')}-${i}`
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
  const result = {
    status: 'completed',
    consumesAdvanceCredits: true,
    charged,
    quotedCreditCost: quote,
    brandId,
    offerId,
    sessionId,
    carouselGroupId: generated.carouselGroupId,
    subtype,
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
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
  }
  await finalizeMcpApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_carousel_generate',
    input: boundWithOffer,
    result,
  })
  return result
}
