/**
 * Web post image — the ONE Grok Imagine request builder shared by the web app
 * (`api/generate-image.ts`, chat-shell "generar imagen") and the MCP image tools
 * (`execute_image_generate`, `execute_bulk_posts`, `execute_campaign_pack`).
 *
 * Everything that decides what Grok receives lives here: slim post prompt
 * (`buildSlimGrokPostPrompt`), logo stamp rules, CTA guardrails, the 3-reference budget
 * (product first, brand logo as style ref, scene last), product-lock routing
 * (/images/edits vs /images/generations), ratio fallback, request body, and the
 * prompt-too-long clamp retry. The web route calls the pure builders below with the same
 * inputs it always used, so its request is unchanged; the MCP calls `runWebPostGrokImage`.
 */
import type { CTAStrength } from '../data/organic-script-prompts.js'
import { fetchPublicImageAsDataUrl, resolveReferenceImageDataUrls } from './fetch-image-data-url.js'
import {
  estimateGrokImageCostUsd,
  GROK_IMAGE_DEFAULT_QUALITY,
  GROK_IMAGE_DEFAULT_RESOLUTION,
  GROK_IMAGE_PROVIDER_MODEL,
} from './grok-models.js'
import { resolveGrokImageApiMode } from './grok-image-generate.js'
import {
  buildSlimGrokPostPrompt,
  GROK_IMAGE_RETRY_PROMPT_BYTES,
  isGrokPromptLengthError,
  isShellMetaImagePrompt,
  prepareGrokImagePrompt,
} from './grok-image-prompt.js'
import { selectGrokReferenceBudget } from './image-prompt-context.js'
import {
  buildLogoStampRules,
  buildPostCtaGuardrails,
  isBloomDermalPatchSku,
  resolveLockedOfferPrice,
  resolveProductSilhouette,
  type BloomSkuScope,
  type ProductCreativeRow,
} from './product-creative-rules.js'

/** Grok Imagine 2.0 ratios (plus common social fallbacks). */
export const WEB_GROK_SUPPORTED_RATIOS = [
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2',
  '19.5:9', '9:19.5', '20:9', '9:20', 'auto',
] as const
const WEB_GROK_RATIO_FALLBACK: Record<string, string> = { '4:5': '3:4', '5:4': '4:3' }

/** Same pixel-size → ratio table the web route uses. */
export function getAspectRatio(width: number, height: number): string {
  const ratio = width / height
  if (Math.abs(ratio - 1) < 0.01) return '1:1'
  if (Math.abs(ratio - 4 / 5) < 0.01) return '4:5'
  if (Math.abs(ratio - 9 / 16) < 0.01) return '9:16'
  if (Math.abs(ratio - 16 / 9) < 0.01) return '16:9'
  if (Math.abs(ratio - 4 / 3) < 0.01) return '4:3'
  if (Math.abs(ratio - 3 / 4) < 0.01) return '3:4'
  if (Math.abs(ratio - 3 / 2) < 0.01) return '3:2'
  if (Math.abs(ratio - 2 / 3) < 0.01) return '2:3'
  return '1:1'
}

/** Ratio Grok is actually called with (4:5 → 3:4, unknown → 1:1). */
export function toWebGrokAspectRatio(aspect: string): string {
  if ((WEB_GROK_SUPPORTED_RATIOS as readonly string[]).includes(aspect)) return aspect
  return WEB_GROK_RATIO_FALLBACK[aspect] || '1:1'
}

export function normalizeWebCtaStrength(raw: unknown): CTAStrength {
  const v = typeof raw === 'string' ? raw : 'sales'
  return (['none', 'soft', 'brand_mention', 'sales'] as CTAStrength[]).includes(v as CTAStrength)
    ? (v as CTAStrength)
    : 'sales'
}

export type WebPostPromptInput = {
  language?: string | null
  postStyle?: string | null
  productSubStyle?: string | null
  textDensity?: string | null
  /** The guion / on-image copy (already stripped of shell meta prompts). */
  userCopy: string
  palette: string
  brandVoice?: string | null
  brandVisual?: string | null
  businessContext?: string | null
  hasProductRefs: boolean
  hasSceneRef: boolean
  productSilhouette?: string | null
  lockedOfferPrice?: string | null
  bloomSku?: boolean
  hasBrandLogo: boolean
  ctaStrength?: unknown
  productRow?: ProductCreativeRow | null
}

/** The slim post prompt exactly as the web route assembles it. */
export function buildWebPostSourcePrompt(input: WebPostPromptInput): string {
  const langCode = input.language === 'en' ? 'en' : 'es'
  return buildSlimGrokPostPrompt({
    language: typeof input.language === 'string' ? input.language : 'es',
    postStyle: typeof input.postStyle === 'string' ? input.postStyle : 'venta-directa',
    productSubStyle: typeof input.productSubStyle === 'string' ? input.productSubStyle : null,
    textDensity: typeof input.textDensity === 'string' ? input.textDensity : 'hard',
    userCopy: input.userCopy,
    palette: input.palette,
    brandVoice: input.brandVoice || null,
    brandVisual: input.brandVisual || null,
    businessContext: typeof input.businessContext === 'string' ? input.businessContext : null,
    hasProductRefs: input.hasProductRefs,
    hasSceneRef: input.hasSceneRef,
    productSilhouette: input.productSilhouette,
    lockedOfferPrice: input.lockedOfferPrice,
    logoStampRules: buildLogoStampRules(langCode, input.hasBrandLogo, { bloomSku: input.bloomSku }),
    ctaGuardrails: buildPostCtaGuardrails(langCode, normalizeWebCtaStrength(input.ctaStrength)),
    hasBrandLogo: input.hasBrandLogo,
    category: input.productRow?.product_category_custom || input.productRow?.product_category || null,
    offerName: input.productRow?.name || null,
    scriptContext: input.userCopy,
  })
}

/** Product refs first, brand logo as style ref, scene refs last; capped at 3. */
export function selectWebPostReferenceUrls(input: {
  productUrls: string[]
  logoDataUrl?: string | null
  supportUrls?: string[]
}): string[] {
  return selectGrokReferenceBudget(
    [
      ...input.productUrls.map((url) => ({ url, role: 'product' as const })),
      ...(input.logoDataUrl ? [{ url: input.logoDataUrl, role: 'style' as const }] : []),
      ...(input.supportUrls || []).map((url) => ({ url, role: 'scene' as const })),
    ],
    3
  ).map((row) => row.url)
}

export type WebGrokApi = ReturnType<typeof resolveGrokImageApiMode>

export function resolveWebGrokApi(productReferenceCount: number, referenceCount: number): WebGrokApi {
  return resolveGrokImageApiMode({ action: 'generate', productReferenceCount, referenceCount })
}

/** The JSON body POSTed to xAI. */
export function buildWebGrokRequest(input: {
  prompt: string
  aspectRatio: string
  referenceUrls: string[]
  logoDataUrl?: string | null
  api: WebGrokApi
}): Record<string, unknown> {
  const grokRequest: Record<string, unknown> = {
    model: GROK_IMAGE_PROVIDER_MODEL,
    prompt: input.prompt,
    n: 1,
    response_format: 'b64_json',
    aspect_ratio: input.aspectRatio,
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
  }
  // Product refs → /edits product_lock_scene (pixel-faithful SKU + scene replace).
  // No product refs → /generations compose. Never attach logo as the only edit base when product photos exist.
  if (input.referenceUrls.length === 1) {
    grokRequest.image = { url: input.referenceUrls[0], type: 'image_url' }
  } else if (input.referenceUrls.length > 1) {
    grokRequest.images = input.referenceUrls.map((url) => ({ url, type: 'image_url' }))
  } else if (input.logoDataUrl && input.api.mode === 'compose') {
    grokRequest.image = { url: input.logoDataUrl, type: 'image_url' }
  }
  return grokRequest
}

/** preferTail is the user copy unless the prompt is a shell meta prompt / product / logo mode. */
export function webGrokPreferTail(userPrompt: unknown, options: { productOrLogoMode?: boolean } = {}): string {
  if (options.productOrLogoMode || isShellMetaImagePrompt(userPrompt as string)) return ''
  return typeof userPrompt === 'string' ? userPrompt : ''
}

/**
 * POST to xAI; on a prompt-length rejection re-prepare with the aggressive clamp and POST once more
 * (never ask the user to shorten the guion). `onRetry` lets the web route keep its log line.
 */
export async function postWebGrokWithClampRetry(input: {
  endpoint: string
  apiKey: string
  sourcePrompt: string
  preferTail: string
  buildRequest: (prompt: string) => Record<string, unknown>
  prepared?: ReturnType<typeof prepareGrokImagePrompt>
  onRetry?: (prepared: ReturnType<typeof prepareGrokImagePrompt>) => void
}): Promise<{
  response: Response
  errorText: string
  prepared: ReturnType<typeof prepareGrokImagePrompt>
  retried: boolean
}> {
  let prepared = input.prepared || prepareGrokImagePrompt(input.sourcePrompt, { preferTail: input.preferTail })
  const post = async (prompt: string) => {
    const response = await fetch(input.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(input.buildRequest(prompt)),
    })
    const errorText = response.ok ? '' : await response.text()
    return { response, errorText }
  }
  let { response, errorText } = await post(prepared.prompt)
  let retried = false
  if (!response.ok && isGrokPromptLengthError(errorText)) {
    prepared = prepareGrokImagePrompt(input.sourcePrompt, {
      preferTail: input.preferTail,
      maxBytes: GROK_IMAGE_RETRY_PROMPT_BYTES,
    })
    input.onRetry?.(prepared)
    retried = true
    ;({ response, errorText } = await post(prepared.prompt))
  }
  return { response, errorText, prepared, retried }
}

// ---------------------------------------------------------------------------
// MCP entry point
// ---------------------------------------------------------------------------

export type WebPostGrokImageOptions = {
  apiKey: string
  /** Ratio to generate at (already a Grok-native one, e.g. '3:4' for 4:5). */
  aspectRatio: string
  language?: 'es' | 'en'
  postStyle?: string
  textDensity?: string
  ctaStrength?: unknown
  /** On-image copy / guion. */
  copy?: string
  businessContext?: string | null
  palette?: string[]
  brandVoice?: string | null
  brandVisual?: string | null
  brandName?: string | null
  brandKitId?: string | null
  offerId?: string | null
  productRow?: ProductCreativeRow | null
  /** https (or data:) product photos, confirmed ones first. */
  productUrls: string[]
  /** Brand-kit product reference photos auto-appended as product refs (web `appendKitProductReferenceImages`). */
  kitReferenceUrls?: string[]
  /** Scene / style refs the user confirmed. */
  supportUrls?: string[]
  logoUrl?: string | null
  /** Offer lock (ad_profile) — appended as an extra immutable-attributes rule when present. */
  lockProductAppearance?: boolean
  immutableAttributes?: string[]
}

export type WebPostGrokImageResult = {
  imageDataUrl: string
  providerModel: string
  estimatedCostUsd: number
  resolution: string
  quality: string
  aspectRatio: string
  mode: string
  endpoint: string
  lockApplied: boolean
  referenceCount: number
  retriedWithClamp: boolean
  /** Product reference photos (data URLs) the request carried — for the local fidelity post-check. */
  productReferenceDataUrls: string[]
  /** The request exactly as POSTed (images omitted → lengths only) — for parity evidence. */
  request: Record<string, unknown>
  prompt: string
}

const MAX_INPUT_SLOTS = 4

function uniqueUrls(urls: Array<string | null | undefined>, max: number): string[] {
  const out: string[] = []
  for (const raw of urls) {
    const u = typeof raw === 'string' ? raw.trim() : ''
    if (u && !out.includes(u)) out.push(u)
    if (out.length >= max) break
  }
  return out
}

export function lockRulesBlock(
  language: 'es' | 'en',
  lock: { lockProductAppearance?: boolean; immutableAttributes?: string[] }
): string {
  const attrs = (lock.immutableAttributes || []).map((a) => a.trim()).filter(Boolean)
  if (!lock.lockProductAppearance && attrs.length === 0) return ''
  const es = language !== 'en'
  const list = attrs.length ? ` ${es ? 'Atributos inmutables' : 'Immutable attributes'}: ${attrs.join('; ')}.` : ''
  return es
    ? `PRODUCTO BLOQUEADO por la oferta: forma, color, partes y marca idénticas a la foto de referencia; no inventes variantes.${list}`
    : `PRODUCT LOCKED by the offer: shape, colour, parts and branding identical to the reference photo; do not invent variants.${list}`
}

/** Shared xAI call for the MCP tools: same prompt/refs/request/retry as the web post flow. */
export async function runWebPostGrokImage(options: WebPostGrokImageOptions): Promise<WebPostGrokImageResult> {
  const language = options.language === 'en' ? 'en' : 'es'
  const aspectRatio = toWebGrokAspectRatio(options.aspectRatio)
  const scope: BloomSkuScope = { productId: options.offerId ?? null, brandKitId: options.brandKitId ?? null }
  const row = options.productRow || null

  // Reference hydration — confirmed product photos first, then kit refs (web appends them as product refs, 4 slots max).
  const confirmed = uniqueUrls(options.productUrls, MAX_INPUT_SLOTS)
  const supportUrls = uniqueUrls(options.supportUrls || [], MAX_INPUT_SLOTS)
  const slotsLeft = Math.max(0, MAX_INPUT_SLOTS - confirmed.length - supportUrls.length)
  const kitUrls = uniqueUrls(options.kitReferenceUrls || [], slotsLeft).filter((u) => !confirmed.includes(u))
  const productUrls = [...confirmed, ...kitUrls]
  const productData = await resolveReferenceImageDataUrls(productUrls)
  if (productUrls.length > 0 && productData.length === 0) {
    throw new Error('Could not load product reference images. Re-upload kit photos and try again.')
  }
  const supportData = await resolveReferenceImageDataUrls(supportUrls)

  let logoDataUrl: string | null = null
  const logoSource = (options.logoUrl || '').trim()
  if (logoSource) {
    logoDataUrl = logoSource.startsWith('data:') ? logoSource : await fetchPublicImageAsDataUrl(logoSource)
    if (!logoDataUrl) throw new Error('Could not load the brand logo. Re-upload it and try again.')
  }

  const referenceUrls = selectWebPostReferenceUrls({ productUrls: productData, logoDataUrl, supportUrls: supportData })
  const lockBlock = lockRulesBlock(language, options)
  const rawCopy = (options.copy || '').trim()
  const userCopy = rawCopy && !isShellMetaImagePrompt(rawCopy) ? rawCopy : ''
  const sourcePrompt = [
    buildWebPostSourcePrompt({
      language,
      postStyle: options.postStyle || 'venta-directa',
      textDensity: options.textDensity || 'hard',
      userCopy,
      palette: (options.palette || []).filter(Boolean).slice(0, 3).join(', '),
      brandVoice: options.brandVoice,
      brandVisual: options.brandVisual,
      businessContext: options.businessContext ?? null,
      hasProductRefs: productData.length > 0,
      hasSceneRef: supportData.length > 0,
      productSilhouette: row ? resolveProductSilhouette(row, language, options.brandName, scope) : null,
      lockedOfferPrice: row ? resolveLockedOfferPrice(row, options.brandName, scope) : null,
      bloomSku: isBloomDermalPatchSku(scope),
      hasBrandLogo: Boolean(logoDataUrl),
      ctaStrength: options.ctaStrength,
      productRow: row,
    }),
    lockBlock,
  ].filter(Boolean).join('\n\n')

  const api = resolveWebGrokApi(productData.length, referenceUrls.length)
  const buildRequest = (prompt: string) => buildWebGrokRequest({ prompt, aspectRatio, referenceUrls, logoDataUrl, api })
  const { response, errorText, prepared, retried } = await postWebGrokWithClampRetry({
    endpoint: api.endpoint,
    apiKey: options.apiKey,
    sourcePrompt,
    preferTail: userCopy,
    buildRequest,
  })
  if (!response.ok) {
    let message = errorText
    try {
      const parsed = JSON.parse(errorText) as { error?: { message?: string } | string }
      message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message || errorText
    } catch { /* keep raw */ }
    throw new Error(message || `Grok image generate failed (${response.status})`)
  }
  const json = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
  const b64 = json.data?.[0]?.b64_json
  const url = json.data?.[0]?.url
  const imageDataUrl = b64 ? `data:image/jpeg;base64,${b64}` : url || ''
  if (!imageDataUrl) throw new Error('Grok image generate returned no image')
  return {
    imageDataUrl,
    providerModel: GROK_IMAGE_PROVIDER_MODEL,
    estimatedCostUsd: estimateGrokImageCostUsd({ outputImages: 1, referenceCount: referenceUrls.length }),
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
    aspectRatio,
    mode: api.mode,
    endpoint: api.endpoint,
    lockApplied: api.mode === 'product_lock_scene',
    referenceCount: referenceUrls.length,
    retriedWithClamp: retried,
    productReferenceDataUrls: productData,
    request: buildRequest(prepared.prompt),
    prompt: prepared.prompt,
  }
}
