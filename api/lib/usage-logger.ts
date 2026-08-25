import { supabaseAdmin as supabase } from './supabase-admin.js'
import {
  GROK_TEXT_MODEL,
  GROK_TEXT_MODEL_BEST,
  GROK_TEXT_MODEL_EFFICIENT,
} from './grok-models.js'

// Cost per 1M tokens (in USD) - update these based on actual pricing.
const MODEL_COSTS = {
  // Script generation models
  'grok': { input: 3.00, output: 15.00 },
  'grok-4.3': { input: 2.00, output: 6.00 },
  [GROK_TEXT_MODEL]: { input: 2.00, output: 6.00 },
  [GROK_TEXT_MODEL_BEST]: { input: 2.00, output: 6.00 },
  [GROK_TEXT_MODEL_EFFICIENT]: { input: 2.00, output: 6.00 },
  'gemini': { input: 0.15, output: 0.60 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60, thinking: 3.50 },

  // Image generation models
  'nano-banana': { perImage: 0.0315, inputPer1M: 0.10, thinkingPer1M: 1.25 },
  'nano-banana-pro': { imageOutputPer1M: 120.00, fallback1K2K: 0.134, fallback4K: 0.24, inputPer1M: 2.00, thinkingPer1M: 12.00 },
  // App id `grok-imagine` → provider grok-imagine-image-2.0 ($0.04 per output image; edits also bill each input).
  'grok-imagine': { perImage: 0.04 },

  // Voice transcription
  'whisper-1': { perMinute: 0.006 },
}

export type FeatureType =
  | 'script'
  | 'description'
  | 'image'
  | 'edit'
  | 'enhance'
  | 'paste_organize'
  | 'prompt_enhance'
  | 'pdf_extract'
  | 'url_fetch'
  | 'prompt_condense'
  | 'voice_transcription'
  | 'style_analysis'
  | 'memory_reflection'
  | 'memory_synthesis'
  | 'brand_extraction'
  | 'reply'
  | 'ocr'
  | 'logo'
  | 'script_edit'
  | 'script_enhance'
  | 'script_hook'
  | 'script_consciousness'

export type UsageSource = 'mcp' | 'web' | 'cron'

interface UsageLogParams {
  userId?: string
  userEmail?: string
  feature: FeatureType
  model: string
  inputTokens?: number
  outputTokens?: number
  thinkingTokens?: number
  generationId?: string
  costOverrideUsd?: number
  costSource?: string
  success?: boolean
  errorMessage?: string
  metadata?: Record<string, unknown>
  /** Origin of the call. Defaults to web; falls back to metadata.source when omitted. */
  source?: UsageSource | string
}

export function resolveUsageSource(params: {
  source?: string
  metadata?: Record<string, unknown>
}): string {
  if (typeof params.source === 'string' && params.source.trim()) {
    return params.source.trim()
  }
  const metaSource = params.metadata?.source
  if (typeof metaSource === 'string' && metaSource.trim()) {
    return metaSource.trim()
  }
  return 'web'
}

export async function logApiUsage(params: UsageLogParams): Promise<void> {
  if (!supabase) {
    console.warn('Supabase not configured, skipping usage log')
    return
  }

  try {
    const {
      userId,
      userEmail,
      feature,
      model,
      inputTokens = 0,
      outputTokens = 0,
      thinkingTokens = 0,
      generationId,
      costOverrideUsd,
      costSource,
      success = true,
      errorMessage,
      metadata = {},
      source,
    } = params

    let estimatedCostUsd = 0
    const modelCosts = MODEL_COSTS[model as keyof typeof MODEL_COSTS]

    if (typeof costOverrideUsd === 'number' && Number.isFinite(costOverrideUsd)) {
      estimatedCostUsd = costOverrideUsd
    } else if (modelCosts) {
      if ('perMinute' in modelCosts) {
        const durationSec = (metadata?.estimatedDurationSec as number) || 10
        estimatedCostUsd = (modelCosts.perMinute as number) * (durationSec / 60)
      } else if ('imageOutputPer1M' in modelCosts) {
        if ('inputPer1M' in modelCosts && inputTokens > 0) {
          estimatedCostUsd += (inputTokens / 1_000_000) * (modelCosts.inputPer1M as number)
        }
        if (outputTokens > 0) {
          estimatedCostUsd += (outputTokens / 1_000_000) * (modelCosts.imageOutputPer1M as number)
        } else {
          const imageSize = metadata?.imageSize === '4K' ? '4K' : '1K/2K'
          estimatedCostUsd += imageSize === '4K'
            ? (modelCosts.fallback4K as number)
            : (modelCosts.fallback1K2K as number)
        }
        if ('thinkingPer1M' in modelCosts && thinkingTokens > 0) {
          estimatedCostUsd += (thinkingTokens / 1_000_000) * (modelCosts.thinkingPer1M as number)
        }
      } else if ('perImage' in modelCosts) {
        estimatedCostUsd = modelCosts.perImage as number
        if ('inputPer1M' in modelCosts && inputTokens > 0) {
          estimatedCostUsd += (inputTokens / 1_000_000) * (modelCosts.inputPer1M as number)
        }
        if ('thinkingPer1M' in modelCosts && thinkingTokens > 0) {
          estimatedCostUsd += (thinkingTokens / 1_000_000) * (modelCosts.thinkingPer1M as number)
        }
      } else if ('input' in modelCosts && 'output' in modelCosts) {
        const inputCost = (inputTokens / 1_000_000) * (modelCosts.input as number)
        const outputCost = (outputTokens / 1_000_000) * (modelCosts.output as number)
        estimatedCostUsd = inputCost + outputCost
        if ('thinking' in modelCosts && thinkingTokens > 0) {
          estimatedCostUsd += (thinkingTokens / 1_000_000) * (modelCosts.thinking as number)
        }
      }
    }

    const inferredCostSource = costSource
      || (typeof costOverrideUsd === 'number' ? 'provider_usage' : undefined)
      || (model === 'nano-banana-pro'
        ? (outputTokens > 0 ? 'provider_usage' : 'documented_image_size_fallback')
        : undefined)

    const enrichedMetadata = {
      ...metadata,
      ...(thinkingTokens > 0 ? { thinkingTokens } : {}),
      ...(inferredCostSource ? { costSource: inferredCostSource } : {})
    }

    const resolvedSource = resolveUsageSource({ source, metadata: enrichedMetadata })

    const insertPayload = {
      user_id: userId,
      user_email: userEmail,
      feature,
      model,
      generation_id: generationId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens + thinkingTokens,
      estimated_cost_usd: estimatedCostUsd,
      success,
      error_message: errorMessage,
      metadata: enrichedMetadata,
      source: resolvedSource,
    }

    let { error } = await supabase.from('api_usage_logs').insert(insertPayload)

    if (error && generationId && /generation_id/i.test(error.message || '')) {
      const { generation_id: _generationId, ...fallbackPayload } = insertPayload
      const retry = await supabase.from('api_usage_logs').insert(fallbackPayload)
      error = retry.error
    }

    if (error && /source/i.test(error.message || '')) {
      const { source: _source, ...fallbackPayload } = insertPayload
      const retry = await supabase.from('api_usage_logs').insert(fallbackPayload)
      error = retry.error
    }

    if (error) {
      console.error('Failed to log API usage:', error)
    }
  } catch (err) {
    console.error('Error logging API usage:', err)
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
