import { supabaseAdmin as supabase } from './supabase-admin.js'
import { estimateApiCostUsd } from './model-pricing.js'

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
  | 'mcp_tool'

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

    const estimatedCostUsd = typeof costOverrideUsd === 'number' && Number.isFinite(costOverrideUsd)
      ? costOverrideUsd
      : estimateApiCostUsd({
          model,
          inputTokens,
          outputTokens,
          thinkingTokens,
          estimatedCostUsd: 0,
          metadata,
        })

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
