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
import { buildImageEditSystemPrompt, resolveGrokAspectRatio, runGrokImageEdit } from '../grok-image-edit.js'
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
  withStatusMessage,
} from './execute-job.js'
import { assertMcpCarouselSlideCount } from './limits.js'
import { assertProductReferenceGate, parseReferenceMode } from './reference-gate.js'
import { mcpGetBrandContext, type McpAuthUser, type McpDbClient } from './user-tools.js'
import { mcpGuideImage } from './guide-packs.js'
import type { McpArtifactStore } from './artifact-store.js'
import type {
  CTAStrength,
  GenerationMode,
  ProductType,
  SalesChannel,
  ScriptFramework,
  ScriptSettings,
  ScriptTypeConfig,
} from '../guiones/types.js'

const APPROVAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SCRIPT_FRAMEWORKS: readonly ScriptFramework[] = [
  'venta_directa',
  'desvalidar_alternativas',
  'mostrar_servicio',
  'variedad_productos',
  'paso_a_paso',
  'reconocimiento',
  'educativo',
  'storytelling',
  'tendencia',
  'engagement',
]
const CTA_STRENGTHS: readonly CTAStrength[] = ['none', 'soft', 'brand_mention', 'sales']
const SCRIPT_GENERATION_MODES: readonly GenerationMode[] = ['mixed', 'by_type']

function optionalTrimmedString(value: unknown, maxLength = 4_000): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

function scriptSettingsFromArgs(args: Record<string, unknown>): ScriptSettings {
  const framework = SCRIPT_FRAMEWORKS.includes(args.framework as ScriptFramework)
    ? args.framework as ScriptFramework
    : 'venta_directa'
  const variations = typeof args.variations === 'number'
    ? Math.max(1, Math.min(10, Math.floor(args.variations)))
    : 1
  const generationMode = SCRIPT_GENERATION_MODES.includes(args.generationMode as GenerationMode)
    ? args.generationMode as GenerationMode
    : 'mixed'
  const ctaStrength = CTA_STRENGTHS.includes(args.ctaStrength as CTAStrength)
    ? args.ctaStrength as CTAStrength
    : undefined
  const rawConfig = args.scriptTypeConfig && typeof args.scriptTypeConfig === 'object'
    ? args.scriptTypeConfig as Record<string, unknown>
    : null
  const scriptTypeConfig = rawConfig
    ? Object.fromEntries(SCRIPT_FRAMEWORKS.map((type) => [
        type,
        Math.max(0, Math.min(10, Math.floor(Number(rawConfig[type]) || 0))),
      ])) as unknown as ScriptTypeConfig
    : undefined
  return {
    framework,
    variations,
    generationMode,
    scriptTypeConfig,
    ctaStrength,
    useStructuredPipeline: true,
    forceFreshAngles: args.forceFreshAngles === true,
  }
}

function referenceImageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim()))].slice(0, 4)
}

async function resolveOwnedReferenceUrls(options: {
  artifactStore: McpArtifactStore
  userId: string
  brandId: string
  offerId: string
  imageIds: string[]
}): Promise<string[]> {
  const urls: string[] = []
  for (const imageId of options.imageIds) {
    const image = await options.artifactStore.getOwnedProductImage({
      userId: options.userId,
      brandId: options.brandId,
      offerId: options.offerId,
      imageId,
    })
    if (!image) throw new Error(`Reference image ${imageId} not found for this brand/offer`)
    urls.push(image.imageUrl)
  }
  return urls
}

async function publicImageUrlToDataUrl(imageUrl: string): Promise<string> {
  const parsed = assertPublicHttpUrl(imageUrl)
  if (parsed.protocol !== 'https:') throw new Error('Reference images must use https URLs')
  const response = await fetch(parsed)
  if (!response.ok) throw new Error(`Could not load reference image (${response.status})`)
  const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('Reference URL must return JPEG, PNG, or WebP')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 2_500_000) throw new Error('Reference image exceeds 2.5 MB')
  return `data:${contentType};base64,${bytes.toString('base64')}`
}

function generationIdFromApproval(approvalRequestId: string, fallbackSuffix: string): string {
  if (APPROVAL_UUID_RE.test(approvalRequestId)) return approvalRequestId
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${fallbackSuffix}`
}

async function chargeMcpCredits(options: {
  userId: string
  action: 'script' | 'image' | 'enhance' | 'edit'
  generationId: string
  imageModel?: string | null
  units?: number
}): Promise<number> {
  const incrementResult = await incrementUsage(options.userId, options.action, {
    generationId: options.generationId,
    imageModel: options.imageModel,
    units: options.units,
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
  const scriptSettings = scriptSettingsFromArgs(options.args)
  const buyerStage = options.args.buyerStage === 'cold'
    || options.args.buyerStage === 'warm'
    || options.args.buyerStage === 'hot'
    ? options.args.buyerStage
    : undefined
  const guidePrompt = optionalTrimmedString(options.args.guidePrompt)
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    language,
    goal: typeof options.args.goal === 'string' ? options.args.goal : undefined,
    ...scriptSettings,
    buyerStage,
    guidePrompt,
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
        scriptSettings,
        goal: boundWithOffer.goal,
        buyerStage,
        guidePrompt,
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
  scriptSettings: ScriptSettings
  goal?: string
  buyerStage?: 'cold' | 'warm' | 'hot'
  guidePrompt?: string
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
      product_description: offer.productDescription || ctx.brandKit?.tagline || undefined,
      differentiation: offer.differentiation || undefined,
      main_problem: offer.mainProblem || undefined,
      result: offer.result || undefined,
      utility: offer.utility || undefined,
      technical_specs: offer.technicalSpecs || undefined,
      price_range: offer.priceRange || undefined,
      exact_price: offer.price || undefined,
      re_price: offer.price || undefined,
    },
    forbiddenPhrases: [
      ...(offer.doNotClaim || []),
      ...(ctx.brandKit?.forbiddenPhrases || []),
    ],
    scriptSettings: options.scriptSettings,
    styleMemoryPrompt: [
      options.goal ? `Generation goal: ${options.goal}` : '',
      options.buyerStage ? `Target buyer stage: ${options.buyerStage}` : '',
      options.guidePrompt ? `Additional user direction: ${options.guidePrompt}` : '',
      ctx.brandKit?.brandVoice ? `Brand voice: ${ctx.brandKit.brandVoice}` : '',
      ctx.brandKit?.mustUsePhrases?.length
        ? `Must use phrases: ${ctx.brandKit.mustUsePhrases.join('; ')}`
        : '',
      offer.price ? `Exact price fact: ${offer.price}` : '',
    ].filter(Boolean).join('\n'),
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
  const imageModel = typeof options.args.imageModel === 'string' ? options.args.imageModel : 'grok-imagine'
  if (imageModel !== 'grok-imagine') {
    throw new Error('execute_image_generate currently supports imageModel "grok-imagine"')
  }
  const selectedReferenceIds = referenceImageIds(options.args.referenceImageIds)
  const productImageId = optionalTrimmedString(options.args.productImageId, 200)
  if (productImageId && !selectedReferenceIds.includes(productImageId)) {
    selectedReferenceIds.unshift(productImageId)
  }
  const guidePrompt = optionalTrimmedString(options.args.guidePrompt)
  const referenceMode = parseReferenceMode(options.args.referenceMode) || 'use'
  const aspectRatioFallback = options.args.aspectRatioFallback === true
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    scene: typeof options.args.scene === 'string' ? options.args.scene : undefined,
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '9:16',
    aspectRatioFallback,
    imageModel,
    productImageId,
    referenceImageIds: selectedReferenceIds,
    referenceMode,
    guidePrompt,
    sessionId: sessionIdArg,
  }

  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const productAssets = await options.artifactStore.listOwnedAssets({
    userId: options.user.id,
    brandId,
    offerId,
    kind: 'product',
  })
  assertProductReferenceGate({
    toolName: 'execute_image_generate',
    productRefCount: productAssets.length,
    referenceMode,
    referenceImageIds: selectedReferenceIds,
    productImageId,
  })
  // Validate aspect early (fail before approval if unsupported).
  resolveGrokAspectRatio(boundInput.aspectRatio, { allowFallback: aspectRatioFallback })
  await resolveOwnedReferenceUrls({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId,
    offerId,
    imageIds: selectedReferenceIds,
  })
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
        aspectRatioFallback: boundWithOffer.aspectRatioFallback,
        referenceImageIds: selectedReferenceIds,
        guidePrompt,
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
  aspectRatioFallback?: boolean
  referenceImageIds: string[]
  guidePrompt?: string
  sessionIdArg?: string
  approvalRequestId: string
  appOrigin?: string
  ctxPreview: Awaited<ReturnType<typeof mcpGetBrandContext>>
  quote: number
}): Promise<Record<string, unknown>> {
  const imageGenerationId = generationIdFromApproval(options.approvalRequestId, 'image')
  const appliedAspectRatio = resolveGrokAspectRatio(options.aspectRatio, {
    allowFallback: options.aspectRatioFallback === true,
  })

  const guide = await mcpGuideImage(options.db, options.user, {
    brandId: options.brandId,
    offerId: options.offerId,
    scene: options.scene,
    aspectRatio: options.aspectRatio,
  }, options.artifactStore)
  const kit = options.ctxPreview.brandKit
  const prompt = [
    String(guide.prompt || ''),
    options.guidePrompt ? `Additional user direction: ${options.guidePrompt}` : '',
    kit?.primaryColor || kit?.secondaryColor || kit?.accentColor
      ? `Brand palette: ${[kit.primaryColor, kit.secondaryColor, kit.accentColor].filter(Boolean).join(' / ')}`
      : '',
    kit?.visualStyleNotes ? `Visual rules: ${kit.visualStyleNotes}` : '',
  ].filter(Boolean).join('. ')
  // Confirmed IDs only — never silent-union kit/guide refs after user confirm.
  const refs = await resolveOwnedReferenceUrls({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    imageIds: options.referenceImageIds,
  })

  const generated = await runGrokImageGenerate({
    apiKey: xaiKey(),
    prompt,
    aspectRatio: appliedAspectRatio,
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
    requestedAspectRatio: options.aspectRatio,
    appliedAspectRatio: appliedAspectRatio,
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

export async function resolveMcpSourceImage(options: {
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
  if (!options.offerId) {
    throw new Error('offerId is required to default to the latest generated image')
  }
  const latest = await options.artifactStore.listLatestGeneratedImage({
    userId: options.userId,
    brandId: options.brandId,
    offerId: options.offerId,
  })
  if (!latest) {
    throw new Error('No generated image found for this offer; pass productImageId or https imageUrl')
  }
  return { imageUrl: latest.imageUrl, productImageId: latest.id }
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
  const guidePrompt = optionalTrimmedString(options.args.guidePrompt)
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    productImageId,
    imageUrl: imageUrlArg,
    editPrompt,
    guidePrompt,
    // Do not silently force 9:16 — omitted aspect defaults to 1:1
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '1:1',
    sessionId: sessionIdArg,
  }

  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const source = await resolveMcpSourceImage({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId,
    offerId,
    productImageId,
    imageUrl: imageUrlArg,
  })
  const boundWithOffer = {
    ...boundInput,
    offerId,
    productImageId: source.productImageId,
    imageUrl: source.productImageId ? undefined : source.imageUrl,
  }
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
    return (formatted || withStatusMessage({
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName: 'execute_image_edit',
      chargedCredits: 0,
    }, 'execute_image_edit')) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const result = await runImageEditBody({
        artifactStore: options.artifactStore,
        user: options.user,
        brandId,
        offerId,
        productImageId: boundWithOffer.productImageId,
        imageUrlArg: boundWithOffer.imageUrl,
        editPrompt,
        guidePrompt,
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
  guidePrompt?: string
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
    editPrompt: [
      options.editPrompt,
      options.guidePrompt ? `Additional user direction: ${options.guidePrompt}` : '',
    ].filter(Boolean).join('\n'),
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
  const guidePrompt = optionalTrimmedString(options.args.guidePrompt)
  const boundInput = {
    brandId,
    offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
    productImageId,
    imageUrl: imageUrlArg,
    enhanceTier,
    instruction: typeof options.args.instruction === 'string' ? options.args.instruction : undefined,
    guidePrompt,
    // Do not silently force 9:16 — omitted aspect defaults to 1:1
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : '1:1',
    language,
    sessionId: sessionIdArg,
  }

  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctxPreview, boundInput.offerId)
  const source = await resolveMcpSourceImage({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId,
    offerId,
    productImageId,
    imageUrl: imageUrlArg,
  })
  const boundWithOffer = {
    ...boundInput,
    offerId,
    productImageId: source.productImageId,
    imageUrl: source.productImageId ? undefined : source.imageUrl,
  }
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
    return (formatted || withStatusMessage({
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName: 'execute_image_enhance',
      chargedCredits: 0,
    }, 'execute_image_enhance')) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const result = await runImageEnhanceBody({
        artifactStore: options.artifactStore,
        user: options.user,
        brandId,
        offerId,
        productImageId: boundWithOffer.productImageId,
        imageUrlArg: boundWithOffer.imageUrl,
        enhanceTier,
        instruction: boundWithOffer.instruction,
        guidePrompt,
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
  guidePrompt?: string
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
    userDirection: resolveEnhanceUserDirection(
      [options.instruction, options.guidePrompt].filter(Boolean).join('\n'),
      null
    ),
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
  const scriptId = optionalTrimmedString(options.args.scriptId, 200)
  let scriptContent = optionalTrimmedString(options.args.scriptContent, 80_000) || ''
  if (!scriptId && !scriptContent) throw new Error('scriptId or scriptContent is required')
  const ctxPreview = await mcpGetBrandContext(options.db, options.user, brandId)
  let ownedScript: Awaited<ReturnType<McpArtifactStore['getOwnedScript']>> = null
  if (scriptId) {
    ownedScript = await options.artifactStore.getOwnedScript({
      userId: options.user.id,
      brandId,
      scriptId,
    })
    if (!ownedScript) throw new Error('scriptId not found for this brand/user')
    scriptContent = ownedScript.content.trim()
    if (!scriptContent) throw new Error('scriptId has no content')
  }
  const slideCount = typeof options.args.slideCount === 'number' || typeof options.args.slideCount === 'string'
    ? assertMcpCarouselSlideCount(Number(options.args.slideCount), 5)
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
  const selectedReferenceIds = referenceImageIds(options.args.referenceImageIds)
  const productImageId = optionalTrimmedString(options.args.productImageId, 200)
  if (productImageId && !selectedReferenceIds.includes(productImageId)) {
    selectedReferenceIds.unshift(productImageId)
  }
  const guidePrompt = optionalTrimmedString(options.args.guidePrompt)
  const offerId = resolveOfferId(
    ctxPreview,
    typeof options.args.offerId === 'string'
      ? options.args.offerId
      : ownedScript?.offerId || undefined
  )
  const productAssets = await options.artifactStore.listOwnedAssets({
    userId: options.user.id,
    brandId,
    offerId,
    kind: 'product',
  })
  assertProductReferenceGate({
    toolName: 'execute_carousel_generate',
    productRefCount: productAssets.length,
    referenceMode: parseReferenceMode(options.args.referenceMode) || 'use',
    referenceImageIds: selectedReferenceIds,
    productImageId,
  })
  await resolveOwnedReferenceUrls({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId,
    offerId,
    imageIds: selectedReferenceIds,
  })

  const boundInput = {
    brandId,
    offerId,
    scriptId: scriptId || undefined,
    scriptContent: scriptContent.slice(0, 2_000),
    // Preview bills/runs exactly requiredSlides — never bind a larger slideCount silently.
    slideCount: requiredSlides,
    requestedSlideCount: slideCount,
    subtype,
    aspectRatio,
    language,
    designDirection: sanitizeCarouselText(options.args.designDirection, 1500),
    slideDetails: sanitizeCarouselText(options.args.slideDetails, 3000),
    previewFirstSlideOnly,
    productImageId,
    referenceImageIds: selectedReferenceIds,
    referenceMode: parseReferenceMode(options.args.referenceMode) || 'use',
    guidePrompt,
    sessionId: sessionIdArg,
  }
  const boundWithOffer = boundInput

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
    return (formatted || withStatusMessage({
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName: 'execute_carousel_generate',
      chargedCredits: 0,
    }, 'execute_carousel_generate')) as Record<string, unknown>
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
        referenceImageIds: selectedReferenceIds,
        guidePrompt,
        previewFirstSlideOnly,
        sessionIdArg,
        approvalRequestId,
        appOrigin: options.appOrigin,
        ctxPreview,
        quote,
      })
      if (result.status === 'failed') {
        await storeMcpApprovalResult(options.approvalStore, {
          approvalRequestId,
          result,
        })
        return
      }
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
  referenceImageIds: string[]
  guidePrompt?: string
  previewFirstSlideOnly: boolean
  sessionIdArg?: string
  approvalRequestId: string
  appOrigin?: string
  ctxPreview: Awaited<ReturnType<typeof mcpGetBrandContext>>
  quote: number
}): Promise<Record<string, unknown>> {
  const offer = options.ctxPreview.offers.find((o) => o.id === options.offerId)
  const referenceUrls = await resolveOwnedReferenceUrls({
    artifactStore: options.artifactStore,
    userId: options.user.id,
    brandId: options.brandId,
    offerId: options.offerId,
    imageIds: options.referenceImageIds,
  })
  const productReferenceImages = await Promise.all(referenceUrls.map(publicImageUrlToDataUrl))
  const generated = await runOrganicCarouselGenerate({
    userId: options.user.id,
    subtype: options.subtype,
    slideCount: options.slideCount,
    scriptContent: options.scriptContent,
    aspectRatio: options.aspectRatio,
    language: options.language,
    brandKitId: options.ctxPreview.brandKit?.id,
    designDirection: [
      options.designDirection,
      options.guidePrompt ? `Additional user direction: ${options.guidePrompt}` : '',
    ].filter(Boolean).join('\n'),
    slideDetails: options.slideDetails,
    previewFirstSlideOnly: options.previewFirstSlideOnly,
    productContext: { name: offer?.name, type: offer?.type || undefined },
    productReferenceImages,
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
  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  const slides = savedSlides.map((s) => {
    const planned = generated.slides.find((g) => g.index === s.index)
    return {
      index: s.index,
      productImageId: s.productImageId,
      imageUrl: s.imageUrl,
      postId: s.postId || null,
      headline: planned?.headline || null,
      body: planned?.body || null,
      role: planned?.role || null,
      copy: [planned?.headline, planned?.body].filter(Boolean).join('\n') || null,
    }
  })
  const baseCompleted = {
    jobId: options.approvalRequestId,
    approvalRequestId: options.approvalRequestId,
    toolName: 'execute_carousel_generate' as const,
    consumesAdvanceCredits: true,
    quotedCreditCost: options.quote,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId,
    carouselGroupId: generated.carouselGroupId,
    subtype: options.subtype,
    totalSlides: generated.totalSlides,
    succeeded: generated.succeeded,
    slides,
    failed: generated.slides.filter((s) => !s.imageUrl).map((s) => ({ index: s.index, error: s.error })),
    durationNote: `MCP host maxDuration is ${MCP_HOST_MAX_DURATION_SEC}s; large carousels may time out.`,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}&session=${encodeURIComponent(sessionId)}`,
  }

  // One UUID charge for all succeeded slides (same path as single image).
  // Composite `${approvalId}-carousel-N` is NOT a valid credit_ledger UUID.
  try {
    if (generated.succeeded > 0) {
      charged = await chargeMcpCredits({
        userId: options.user.id,
        action: 'image',
        generationId: options.approvalRequestId,
        imageModel: GEMINI_CAROUSEL_IMAGE_MODEL,
        units: generated.succeeded,
      })
      if (!isCreditsV1Enabled()) {
        for (let i = 0; i < generated.succeeded; i++) {
          await deductBonusImage(options.user.id)
        }
      }
    }
  } catch (chargeErr) {
    const message = chargeErr instanceof Error ? chargeErr.message : 'Credit charge failed'
    return withStatusMessage({
      ...baseCompleted,
      status: 'failed',
      failureStage: 'charge',
      artifactsSaved: true,
      resumeMode: 'charge_only',
      charged: 0,
      chargedCredits: 0,
      usage: { quotedCredits: options.quote, chargedCredits: 0 },
      error: message,
      message:
        'Carousel slides were saved to Advance, but billing was temporarily unavailable. Artifacts are kept; retry the same approval to charge without regenerating once billing is back.',
    }, 'execute_carousel_generate')
  }

  return withChargedCredits({
    ...baseCompleted,
    status: 'completed',
  }, charged, options.quote, 'execute_carousel_generate')
}
