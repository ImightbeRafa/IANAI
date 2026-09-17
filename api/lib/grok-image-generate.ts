/**
 * Grok Imagine 2.0 text-to-image generations + product-lock scene routing.
 *
 * With a real product photo: use /images/edits (product_lock_scene) so the SKU
 * stays pixel-faithful while SCENE RECIPE replaces the packshot void.
 * Without product photos: /images/generations compose (silhouette / typography).
 * User edit + enhance stay on /edits.
 *
 * Shared first-gen helper for website bulk, MCP execute_image_generate, and
 * MCP/web runBulkPosts. Website /api/generate-image already routes the same
 * contract inline (PR #33); this module is the MCP/bulk source of truth.
 */

import {
  GROK_IMAGE_DEFAULT_QUALITY,
  GROK_IMAGE_DEFAULT_RESOLUTION,
  GROK_IMAGE_EDITS_URL,
  GROK_IMAGE_GENERATIONS_URL,
  GROK_IMAGE_PROVIDER_MODEL,
  estimateGrokImageCostUsd,
} from './grok-models.js'
import { resolveGrokAspectRatio } from './grok-image-edit.js'
import { prepareGrokImagePrompt } from './grok-image-prompt.js'
import { resolveReferenceImageDataUrls } from './fetch-image-data-url.js'
import {
  buildProductPixelLockContract,
  hasProductPixelLockLanguage,
} from './product-pixel-lock.js'

export type GrokImageGenerateResult = {
  imageDataUrl: string
  providerModel: string
  estimatedCostUsd: number
  resolution: typeof GROK_IMAGE_DEFAULT_RESOLUTION
  quality: typeof GROK_IMAGE_DEFAULT_QUALITY
  aspectRatio: string
  mode: GrokImageApiMode
  endpoint: typeof GROK_IMAGE_GENERATIONS_URL | typeof GROK_IMAGE_EDITS_URL
  lockApplied: boolean
}

export type GrokImageApiMode = 'compose' | 'edit' | 'product_lock_scene'

export type GrokPostFirstGenOptions = {
  apiKey: string
  prompt: string
  aspectRatio?: string | null
  /** Opt-in closest-ratio map (e.g. 4:5→3:4). Default false = fail closed. */
  aspectRatioFallback?: boolean
  /** Role=product URLs. First is the edits API base. Never put logo here. */
  productReferenceUrls?: string[]
  /** Scene / style / logo URLs. Attached after product; never the sole edit base. */
  supportReferenceUrls?: string[]
  /**
   * Legacy mixed list. Used as product refs only when `productReferenceUrls`
   * is omitted. Prefer the explicit product/support split.
   */
  referenceImageUrls?: string[]
  language?: string | null
}

/**
 * Route Grok first-gen:
 * - product refs → /edits product_lock_scene (pixel lock + scene replace)
 * - no product refs → /generations compose
 * - enhance/user edit → /edits
 */
export function resolveGrokImageApiMode(options: {
  action: 'generate' | 'edit' | 'enhance'
  /** Count of product-role references (not scene/style alone). */
  productReferenceCount: number
  /** Total attached refs (product + scene + style). */
  referenceCount?: number
}): {
  endpoint: typeof GROK_IMAGE_GENERATIONS_URL | typeof GROK_IMAGE_EDITS_URL
  mode: GrokImageApiMode
  attachReferences: boolean
} {
  const refs = options.referenceCount ?? options.productReferenceCount
  if (options.action === 'edit' || options.action === 'enhance') {
    return {
      endpoint: GROK_IMAGE_EDITS_URL,
      mode: 'edit',
      attachReferences: refs > 0,
    }
  }
  if (options.productReferenceCount > 0) {
    return {
      endpoint: GROK_IMAGE_EDITS_URL,
      mode: 'product_lock_scene',
      attachReferences: true,
    }
  }
  return {
    endpoint: GROK_IMAGE_GENERATIONS_URL,
    mode: 'compose',
    attachReferences: refs > 0,
  }
}

export function partitionGrokFirstGenRefs(options: {
  productReferenceUrls?: string[]
  supportReferenceUrls?: string[]
  referenceImageUrls?: string[]
}): { productUrls: string[]; supportUrls: string[] } {
  const explicitProduct = options.productReferenceUrls
  const support = (options.supportReferenceUrls || []).filter(Boolean)
  if (explicitProduct) {
    return {
      productUrls: explicitProduct.filter(Boolean),
      supportUrls: support,
    }
  }
  return {
    productUrls: (options.referenceImageUrls || []).filter(Boolean),
    supportUrls: support,
  }
}

/** Prepend PRODUCT LOCK when a product photo is attached and the caller omitted it. */
export function ensureProductLockPrompt(
  prompt: string,
  options?: { language?: string | null; hasProductRefs?: boolean }
): string {
  if (options?.hasProductRefs !== true) return prompt
  if (hasProductPixelLockLanguage(prompt)) return prompt
  return `${buildProductPixelLockContract({
    language: options.language,
    sceneReplace: true,
  })}\n\n${prompt}`
}

function attachGrokImageRefs(
  body: Record<string, unknown>,
  refs: string[]
): void {
  if (refs.length === 1) {
    body.image = { url: refs[0], type: 'image_url' }
    return
  }
  if (refs.length > 1) {
    body.images = refs.map((url) => ({ url, type: 'image_url' }))
  }
}

/**
 * Shared Grok first-gen: product photos → /images/edits + PRODUCT LOCK;
 * no product photo → /images/generations compose.
 */
export async function runGrokPostFirstGen(
  options: GrokPostFirstGenOptions
): Promise<GrokImageGenerateResult> {
  const { productUrls, supportUrls } = partitionGrokFirstGenRefs(options)
  const grokApi = resolveGrokImageApiMode({
    action: 'generate',
    productReferenceCount: productUrls.length,
    referenceCount: productUrls.length + supportUrls.length,
  })

  const aspectRatio = resolveGrokAspectRatio(options.aspectRatio, {
    allowFallback: options.aspectRatioFallback === true,
  })
  const lockedPrompt = ensureProductLockPrompt(options.prompt, {
    language: options.language,
    hasProductRefs: productUrls.length > 0,
  })
  let prepared = prepareGrokImagePrompt(lockedPrompt)
  if (productUrls.length > 0 && !hasProductPixelLockLanguage(prepared.prompt)) {
    const contract = buildProductPixelLockContract({
      language: options.language,
      sceneReplace: true,
    })
    prepared = prepareGrokImagePrompt(`${contract}\n\n${prepared.prompt}`)
  }
  if (productUrls.length > 0 && !hasProductPixelLockLanguage(prepared.prompt)) {
    throw new Error('PRODUCT LOCK contract missing from Grok first-gen prompt')
  }

  const productData = await resolveReferenceImageDataUrls(productUrls)
  if (productUrls.length > 0 && productData.length === 0) {
    throw new Error(
      'Could not load product reference images. Re-upload kit photos and try again.'
    )
  }
  const supportBudget = Math.max(0, 3 - productData.length)
  const supportData = grokApi.attachReferences
    ? await resolveReferenceImageDataUrls(supportUrls.slice(0, supportBudget))
    : []
  if (productUrls.length === 0 && supportUrls.length > 0 && supportData.length === 0) {
    throw new Error(
      'Could not load product or logo reference images. Re-upload kit photos and try again.'
    )
  }
  // Product first so /edits treats the SKU as the edit base — never logo-only.
  const refs = [...productData, ...supportData].slice(0, 3)

  const body: Record<string, unknown> = {
    model: GROK_IMAGE_PROVIDER_MODEL,
    prompt: prepared.prompt,
    n: 1,
    response_format: 'b64_json',
    aspect_ratio: aspectRatio,
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
  }
  if (grokApi.attachReferences) {
    attachGrokImageRefs(body, refs)
  }

  const response = await fetch(grokApi.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({})) as {
    data?: Array<{ b64_json?: string; url?: string }>
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(json.error?.message || `Grok image generate failed (${response.status})`)
  }
  const b64 = json.data?.[0]?.b64_json
  const url = json.data?.[0]?.url
  const imageDataUrl = b64
    ? `data:image/png;base64,${b64}`
    : url || ''
  if (!imageDataUrl) throw new Error('Grok image generate returned no image')

  return {
    imageDataUrl,
    providerModel: GROK_IMAGE_PROVIDER_MODEL,
    estimatedCostUsd: estimateGrokImageCostUsd({
      referenceCount: refs.length,
    }),
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
    aspectRatio,
    mode: grokApi.mode,
    endpoint: grokApi.endpoint,
    lockApplied: grokApi.mode === 'product_lock_scene',
  }
}

/** Same lock routing as runGrokPostFirstGen (MCP + bulk first-gen). */
export async function runGrokImageGenerate(
  options: GrokPostFirstGenOptions
): Promise<GrokImageGenerateResult> {
  return runGrokPostFirstGen(options)
}
