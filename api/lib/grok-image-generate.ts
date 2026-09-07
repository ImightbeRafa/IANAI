/**
 * Grok Imagine 2.0 text-to-image generations + product-lock scene routing.
 *
 * With a real product photo: use /images/edits (product_lock_scene) so the SKU
 * stays pixel-faithful while SCENE RECIPE replaces the packshot void.
 * Without product photos: /images/generations compose (silhouette / typography).
 * User edit + enhance stay on /edits.
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

export type GrokImageGenerateResult = {
  imageDataUrl: string
  providerModel: string
  estimatedCostUsd: number
  resolution: typeof GROK_IMAGE_DEFAULT_RESOLUTION
  quality: typeof GROK_IMAGE_DEFAULT_QUALITY
  aspectRatio: string
}

export type GrokImageApiMode = 'compose' | 'edit' | 'product_lock_scene'

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

export async function runGrokImageGenerate(options: {
  apiKey: string
  prompt: string
  aspectRatio?: string | null
  /** Opt-in closest-ratio map (e.g. 4:5→3:4). Default false = fail closed. */
  aspectRatioFallback?: boolean
  referenceImageUrls?: string[]
}): Promise<GrokImageGenerateResult> {
  const aspectRatio = resolveGrokAspectRatio(options.aspectRatio, {
    allowFallback: options.aspectRatioFallback === true,
  })
  const prepared = prepareGrokImagePrompt(options.prompt)
  const incomingRefs = (options.referenceImageUrls || []).filter(Boolean).slice(0, 3)
  const refs = await resolveReferenceImageDataUrls(incomingRefs)
  if (incomingRefs.length > 0 && refs.length === 0) {
    throw new Error(
      'Could not load product or logo reference images. Re-upload kit photos and try again.'
    )
  }
  const body: Record<string, unknown> = {
    model: GROK_IMAGE_PROVIDER_MODEL,
    prompt: prepared.prompt,
    n: 1,
    response_format: 'b64_json',
    aspect_ratio: aspectRatio,
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
  }
  if (refs.length === 1) {
    body.image = { url: refs[0], type: 'image_url' }
  } else if (refs.length > 1) {
    body.images = refs.map((url) => ({ url, type: 'image_url' }))
  }

  const response = await fetch(GROK_IMAGE_GENERATIONS_URL, {
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
  }
}
