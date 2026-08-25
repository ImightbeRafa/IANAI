/**
 * Shared Grok Imagine 2.0 edit/enhance caller (xAI /v1/images/edits).
 */

import {
  GROK_IMAGE_DEFAULT_QUALITY,
  GROK_IMAGE_DEFAULT_RESOLUTION,
  GROK_IMAGE_EDITS_URL,
  GROK_IMAGE_PROVIDER_MODEL,
  estimateGrokImageCostUsd,
} from './grok-models.js'

export type GrokImageEditResult = {
  imageDataUrl: string
  providerModel: string
  referenceCount: number
  estimatedCostUsd: number
  resolution: typeof GROK_IMAGE_DEFAULT_RESOLUTION
  quality: typeof GROK_IMAGE_DEFAULT_QUALITY
}

const GROK_SUPPORTED_RATIOS = new Set([
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2',
  '19.5:9', '9:19.5', '20:9', '9:20', 'auto',
])

const GROK_RATIO_FALLBACK: Record<string, string> = { '4:5': '3:4', '5:4': '4:3' }

export function resolveGrokAspectRatio(aspectRatio: string | null | undefined): string {
  const raw = (aspectRatio || '9:16').trim()
  if (GROK_SUPPORTED_RATIOS.has(raw)) return raw
  return GROK_RATIO_FALLBACK[raw] || '9:16'
}

/** Cap refs for edits: base image + up to 2 supporting refs (API budget ~3). */
export function selectGrokEditReferenceUrls(options: {
  baseImageUrl: string
  supportUrls?: string[]
  maxTotal?: number
}): string[] {
  const maxTotal = options.maxTotal ?? 3
  const support = (options.supportUrls || []).filter((url) => typeof url === 'string' && url.length > 0)
  const picked = [options.baseImageUrl, ...support].filter(Boolean)
  return picked.slice(0, maxTotal)
}

export function buildImageEditSystemPrompt(options: {
  editPrompt: string
  hasRefs?: boolean
  brandRules?: string | null
}): string {
  const hasRefs = options.hasRefs === true
  const brandBlock = options.brandRules?.trim()
    ? `\nBRAND KIT (non-negotiable unless the edit instruction explicitly overrides a specific element):\n${options.brandRules}\n`
    : ''
  return `You are an expert image editor. You will receive an image to edit and an edit instruction.${hasRefs ? ' You will also receive reference images - use them as visual guidance for the requested change.' : ''}
Your task: Apply ONLY the requested change to the image while preserving everything else exactly as-is.
Keep the same composition, layout, colors, style, typography, and overall look.
Make the minimum change necessary to fulfill the user's request.${hasRefs ? '\nUse the reference images to understand what the user wants - match their style, colors, elements, or content as needed.' : ''}
${brandBlock}
TEXT LOCK (non-negotiable):
- Copy every visible word, accent, currency symbol (including ₡), price, and CTA exactly unless the edit instruction explicitly replaces that specific string.
- Do not translate, paraphrase, invent, duplicate, autocorrect, or "fix" copy by guessing.
- If a glyph is unreadable, leave that region unchanged rather than regenerating nearby text.
- Never add extra headlines, bullets, or watermarks.

Return the edited image.

Edit instruction: ${options.editPrompt}`
}

export async function runGrokImageEdit(options: {
  apiKey: string
  prompt: string
  baseImageUrl: string
  supportImageUrls?: string[]
  aspectRatio?: string | null
}): Promise<GrokImageEditResult> {
  const providerModel = GROK_IMAGE_PROVIDER_MODEL
  const referenceUrls = selectGrokEditReferenceUrls({
    baseImageUrl: options.baseImageUrl,
    supportUrls: options.supportImageUrls,
  })
  const aspectRatio = resolveGrokAspectRatio(options.aspectRatio)

  const grokRequest: Record<string, unknown> = {
    model: providerModel,
    prompt: options.prompt,
    n: 1,
    response_format: 'b64_json',
    aspect_ratio: aspectRatio,
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
  }

  if (referenceUrls.length === 1) {
    grokRequest.image = { url: referenceUrls[0], type: 'image_url' }
  } else {
    grokRequest.images = referenceUrls.map((url) => ({ url, type: 'image_url' }))
  }

  const response = await fetch(GROK_IMAGE_EDITS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(grokRequest),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Grok Imagine edit failed (${response.status}): ${errorText.slice(0, 400)}`)
  }

  const result = await response.json() as { data?: Array<{ b64_json?: string }> }
  const b64Data = result.data?.[0]?.b64_json
  if (!b64Data) throw new Error('No image data in Grok Imagine edit response')

  return {
    imageDataUrl: `data:image/jpeg;base64,${b64Data}`,
    providerModel,
    referenceCount: referenceUrls.length,
    estimatedCostUsd: estimateGrokImageCostUsd({
      outputImages: 1,
      referenceCount: referenceUrls.length,
    }),
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
  }
}
