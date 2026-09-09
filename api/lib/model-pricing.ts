/**
 * Official provider list prices used for logging and admin cost display.
 * Verified 2026-09-09 from xAI / Gemini / OpenAI public docs.
 * Estimates only — not a provider invoice.
 */

import { estimateGrokImageCostUsd } from './grok-models.js'

export const MODEL_PRICING_AS_OF = '2026-09-09'
export const GROK_LONG_CONTEXT_TOKENS = 200_000

export const GROK_46_INPUT_PER_1M = 2.0
export const GROK_46_OUTPUT_PER_1M = 6.0
export const GROK_46_CACHED_PER_1M = 0.5
export const GROK_46_LONG_INPUT_PER_1M = 4.0
export const GROK_46_LONG_OUTPUT_PER_1M = 12.0
export const GROK_46_LONG_CACHED_PER_1M = 1.0

export const GROK_45_INPUT_PER_1M = 2.0
export const GROK_45_OUTPUT_PER_1M = 6.0
export const GROK_45_CACHED_PER_1M = 0.3
export const GROK_45_LONG_INPUT_PER_1M = 4.0
export const GROK_45_LONG_OUTPUT_PER_1M = 12.0
export const GROK_45_LONG_CACHED_PER_1M = 0.6

export const GROK_43_INPUT_PER_1M = 1.25
export const GROK_43_OUTPUT_PER_1M = 2.5
export const GROK_43_CACHED_PER_1M = 0.2
export const GROK_43_LONG_INPUT_PER_1M = 2.5
export const GROK_43_LONG_OUTPUT_PER_1M = 5.0
export const GROK_43_LONG_CACHED_PER_1M = 0.4

export const GEMINI_25_FLASH_INPUT_PER_1M = 0.3
export const GEMINI_25_FLASH_OUTPUT_PER_1M = 2.5

export const NANO_BANANA_PER_IMAGE = 0.039
export const NANO_BANANA_INPUT_PER_1M = 0.3

export const BANANA_PRO_INPUT_PER_1M = 2.0
export const BANANA_PRO_TEXT_OUTPUT_PER_1M = 12.0
export const BANANA_PRO_IMAGE_OUTPUT_PER_1M = 120.0
export const BANANA_PRO_FALLBACK_1K2K_USD = 0.134
export const BANANA_PRO_FALLBACK_4K_USD = 0.24

export const GPT_IMAGE_TEXT_IN_PER_1M = 5.0
export const GPT_IMAGE_IMAGE_IN_PER_1M = 8.0
export const GPT_IMAGE_IMAGE_OUT_PER_1M = 30.0

export const WHISPER_PER_MINUTE = 0.006

export const MODEL_PRICE_LABELS: Record<string, string> = {
  grok: '$2/1M in, $6/1M out (≥200k: $4/$12)',
  'grok-4.3': '$1.25/1M in, $2.50/1M out (≥200k: $2.50/$5)',
  'grok-4.5': '$2/1M in, $6/1M out (≥200k: $4/$12)',
  'grok-4.6': '$2/1M in, $6/1M out (≥200k: $4/$12)',
  'whisper-1': '$0.006/min',
  gemini: '$0.30/1M in, $2.50/1M out (thinking in output)',
  'nano-banana': '$0.039/image + $0.30/1M in',
  'nano-banana-pro': '$0.134 (1K/2K) · $0.24 (4K) + $2/$12/$120 per 1M',
  'gpt-image-2': '$5/1M text in, $8/1M image in, $30/1M image out',
  'grok-imagine': '$0.04/output · +$0.01/input image',
  'pdf-parse': 'Free (local)',
  'web-scraper': 'Free (local)',
  'gemini-2.5-flash': '$0.30/1M in, $2.50/1M out (thinking in output)',
}

export const ESTIMATE_DISCLAIMER =
  `Estimated API $ from official list prices as of ${MODEL_PRICING_AS_OF} (xAI / Gemini / OpenAI). Not a provider invoice.`

export type ApiCostInput = {
  model: string
  inputTokens?: number
  outputTokens?: number
  thinkingTokens?: number
  cachedTokens?: number
  estimatedCostUsd?: number | string | null
  metadata?: Record<string, unknown> | null
}

function num(value: number | string | null | undefined): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

export function roundCost(value: number): number {
  return Number(value.toFixed(6))
}

export function metaNum(meta: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  if (!meta) return null
  for (const key of keys) {
    const raw = meta[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) return Number(raw)
  }
  return null
}

function normalizeModel(model: string): string {
  return (model || '').trim().toLowerCase()
}

function resolveThinkingTokens(input: ApiCostInput): number {
  if (num(input.thinkingTokens) > 0) return num(input.thinkingTokens)
  return Math.max(0, metaNum(input.metadata, 'thinkingTokens', 'thinking_tokens', 'thoughtsTokenCount') ?? 0)
}

function resolveCachedTokens(input: ApiCostInput): number {
  if (num(input.cachedTokens) > 0) return num(input.cachedTokens)
  return Math.max(0, metaNum(input.metadata, 'cachedTokens', 'cached_tokens', 'cachedInputTokens') ?? 0)
}

type GrokTextRates = {
  input: number
  output: number
  cached: number
  longInput: number
  longOutput: number
  longCached: number
}

function grokTextCost(inputTokens: number, outputTokens: number, cachedTokens: number, rates: GrokTextRates): number {
  const long = inputTokens >= GROK_LONG_CONTEXT_TOKENS
  const billedCached = Math.min(Math.max(0, cachedTokens), Math.max(0, inputTokens))
  const billedInput = Math.max(0, inputTokens - billedCached)
  const inputRate = long ? rates.longInput : rates.input
  const outputRate = long ? rates.longOutput : rates.output
  const cachedRate = long ? rates.longCached : rates.cached
  return (billedInput / 1_000_000) * inputRate
    + (billedCached / 1_000_000) * cachedRate
    + (outputTokens / 1_000_000) * outputRate
}

export function estimateGptImageCostUsd(options: {
  textInputTokens?: number
  imageInputTokens?: number
  imageOutputTokens?: number
}): number | undefined {
  const textInputTokens = num(options.textInputTokens)
  const imageInputTokens = num(options.imageInputTokens)
  const imageOutputTokens = num(options.imageOutputTokens)
  if (textInputTokens === 0 && imageInputTokens === 0 && imageOutputTokens === 0) return undefined
  return roundCost(
    (textInputTokens / 1_000_000) * GPT_IMAGE_TEXT_IN_PER_1M
    + (imageInputTokens / 1_000_000) * GPT_IMAGE_IMAGE_IN_PER_1M
    + (imageOutputTokens / 1_000_000) * GPT_IMAGE_IMAGE_OUT_PER_1M
  )
}

export function modelPriceLabel(model: string): string {
  const key = normalizeModel(model)
  if (key.startsWith('grok-imagine')) return MODEL_PRICE_LABELS['grok-imagine']
  if (key.includes('banana-pro')) return MODEL_PRICE_LABELS['nano-banana-pro']
  return MODEL_PRICE_LABELS[key] || '-'
}

/**
 * Recompute estimated API $ from official list prices.
 * Prefers token/image math over stored logger values so old rows stay comparable.
 */
export function estimateApiCostUsd(input: ApiCostInput): number {
  const model = normalizeModel(input.model)
  const meta = input.metadata || {}
  const stored = num(input.estimatedCostUsd)
  const inputTokens = num(input.inputTokens)
  const outputTokens = num(input.outputTokens)
  const thinkingTokens = resolveThinkingTokens(input)
  const cachedTokens = resolveCachedTokens(input)

  if (model === 'pdf-parse' || model === 'web-scraper' || model === 'mcp') {
    return 0
  }

  if (model === 'grok-imagine' || model.startsWith('grok-imagine')) {
    const refs = Math.max(0, metaNum(meta, 'referenceCount', 'reference_count') ?? 0)
    const outputs = Math.max(1, metaNum(meta, 'outputImages', 'output_images', 'n') ?? 1)
    return roundCost(estimateGrokImageCostUsd({ outputImages: outputs, referenceCount: refs }))
  }

  if (model === 'grok-4.6' || model === 'grok') {
    if (inputTokens === 0 && outputTokens === 0 && thinkingTokens === 0) return roundCost(stored)
    return roundCost(grokTextCost(inputTokens, outputTokens + thinkingTokens, cachedTokens, {
      input: GROK_46_INPUT_PER_1M,
      output: GROK_46_OUTPUT_PER_1M,
      cached: GROK_46_CACHED_PER_1M,
      longInput: GROK_46_LONG_INPUT_PER_1M,
      longOutput: GROK_46_LONG_OUTPUT_PER_1M,
      longCached: GROK_46_LONG_CACHED_PER_1M,
    }))
  }

  if (model === 'grok-4.5') {
    if (inputTokens === 0 && outputTokens === 0 && thinkingTokens === 0) return roundCost(stored)
    return roundCost(grokTextCost(inputTokens, outputTokens + thinkingTokens, cachedTokens, {
      input: GROK_45_INPUT_PER_1M,
      output: GROK_45_OUTPUT_PER_1M,
      cached: GROK_45_CACHED_PER_1M,
      longInput: GROK_45_LONG_INPUT_PER_1M,
      longOutput: GROK_45_LONG_OUTPUT_PER_1M,
      longCached: GROK_45_LONG_CACHED_PER_1M,
    }))
  }

  if (model === 'grok-4.3') {
    if (inputTokens === 0 && outputTokens === 0 && thinkingTokens === 0) return roundCost(stored)
    return roundCost(grokTextCost(inputTokens, outputTokens + thinkingTokens, cachedTokens, {
      input: GROK_43_INPUT_PER_1M,
      output: GROK_43_OUTPUT_PER_1M,
      cached: GROK_43_CACHED_PER_1M,
      longInput: GROK_43_LONG_INPUT_PER_1M,
      longOutput: GROK_43_LONG_OUTPUT_PER_1M,
      longCached: GROK_43_LONG_CACHED_PER_1M,
    }))
  }

  if (model === 'gemini-2.5-flash' || model === 'gemini') {
    if (inputTokens === 0 && outputTokens === 0 && thinkingTokens === 0) return roundCost(stored)
    return roundCost(
      (inputTokens / 1_000_000) * GEMINI_25_FLASH_INPUT_PER_1M
      + ((outputTokens + thinkingTokens) / 1_000_000) * GEMINI_25_FLASH_OUTPUT_PER_1M
    )
  }

  if (model === 'nano-banana') {
    const images = Math.max(1, metaNum(meta, 'outputImages', 'output_images', 'n') ?? 1)
    return roundCost(
      NANO_BANANA_PER_IMAGE * images
      + (inputTokens / 1_000_000) * NANO_BANANA_INPUT_PER_1M
    )
  }

  if (model === 'nano-banana-pro' || model.includes('banana-pro')) {
    if (inputTokens > 0 || outputTokens > 0 || thinkingTokens > 0) {
      return roundCost(
        (inputTokens / 1_000_000) * BANANA_PRO_INPUT_PER_1M
        + (outputTokens / 1_000_000) * BANANA_PRO_IMAGE_OUTPUT_PER_1M
        + (thinkingTokens / 1_000_000) * BANANA_PRO_TEXT_OUTPUT_PER_1M
      )
    }
    if (stored > 0) return roundCost(stored)
    const imageSize = String(meta.imageSize || meta.image_size || '').toUpperCase()
    return imageSize === '4K' ? BANANA_PRO_FALLBACK_4K_USD : BANANA_PRO_FALLBACK_1K2K_USD
  }

  if (model === 'gpt-image-2' || model.includes('gpt-image')) {
    const fromMeta = estimateGptImageCostUsd({
      textInputTokens: metaNum(meta, 'textInputTokens', 'text_tokens') ?? 0,
      imageInputTokens: metaNum(meta, 'imageInputTokens', 'image_tokens') ?? 0,
      imageOutputTokens: metaNum(meta, 'imageOutputTokens', 'image_output_tokens') ?? outputTokens,
    })
    if (fromMeta != null) return fromMeta
    return roundCost(stored)
  }

  if (model === 'whisper-1') {
    const durationSec = Math.max(0, metaNum(meta, 'estimatedDurationSec', 'durationSec', 'duration_sec') ?? 10)
    return roundCost(WHISPER_PER_MINUTE * (durationSec / 60))
  }

  return roundCost(stored)
}
