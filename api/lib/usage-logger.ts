import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey) 
  : null

// Cost per 1M tokens (in USD) - Update these based on actual pricing
export const MODEL_COSTS = {
  // Script generation models (per 1M tokens)
  'grok': { input: 3.00, output: 15.00 },
  'grok-3-mini': { input: 0.30, output: 0.50 },
  'gemini': { input: 0.15, output: 0.60 },
  
  // Image generation models (per image)
  'flux': { perImage: 0.003 },
  'nano-banana': { perImage: 0.02 },
  'nano-banana-pro': { perImage: 0.05 },
  'grok-imagine': { perImage: 0.07 },
  
  // Video generation models (per second of output)
  // Grok Imagine Video: $0.07/sec (including audio)
  'grok-imagine-video-480p': { perSecond: 0.05 },
  'grok-imagine-video-720p': { perSecond: 0.07 },
  // Kling via fal.ai v2.6 Pro: $0.07/sec (no audio), $0.14/sec (with audio)
  'fal-ai/kling-video/v2.6/pro/text-to-video': { perSecond: 0.07 },
  'fal-ai/kling-video/v2.6/pro/image-to-video': { perSecond: 0.07 },
}

// Feature types for tracking
export type FeatureType = 
  | 'script'           // Script generation
  | 'image'            // Image generation
  | 'video'            // Video generation
  | 'paste_organize'   // Auto-fill/paste organize
  | 'prompt_enhance'   // Prompt enhancement
  | 'pdf_extract'      // PDF text extraction
  | 'url_fetch'        // URL content fetching
  | 'ad_prompt_build'  // Ad video prompt pipeline (Module A+B+C)
  | 'kling_video'      // Kling AI video generation (fal.ai)
  | 'prompt_condense'  // Prompt condensing for video APIs

interface UsageLogParams {
  userId?: string
  userEmail?: string
  feature: FeatureType
  model: string
  inputTokens?: number
  outputTokens?: number
  success?: boolean
  errorMessage?: string
  metadata?: Record<string, unknown>
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
      success = true,
      errorMessage,
      metadata = {}
    } = params

    // Calculate estimated cost
    let estimatedCostUsd = 0
    const modelCosts = MODEL_COSTS[model as keyof typeof MODEL_COSTS]
    
    if (modelCosts) {
      if ('perImage' in modelCosts) {
        // Image model - fixed cost per image
        estimatedCostUsd = modelCosts.perImage as number
      } else if ('perSecond' in modelCosts) {
        // Video model - cost per second (duration passed in metadata)
        const duration = (metadata?.duration as number) || 5
        estimatedCostUsd = (modelCosts.perSecond as number) * duration
      } else if ('input' in modelCosts && 'output' in modelCosts) {
        // Text model - cost based on tokens
        const inputCost = (inputTokens / 1_000_000) * (modelCosts.input as number)
        const outputCost = (outputTokens / 1_000_000) * (modelCosts.output as number)
        estimatedCostUsd = inputCost + outputCost
      }
    }

    const { error } = await supabase.from('api_usage_logs').insert({
      user_id: userId,
      user_email: userEmail,
      feature,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: estimatedCostUsd,
      success,
      error_message: errorMessage,
      metadata
    })

    if (error) {
      console.error('Failed to log API usage:', error)
    }
  } catch (err) {
    console.error('Error logging API usage:', err)
  }
}

// Helper to estimate token count from text (rough approximation)
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for English
  return Math.ceil(text.length / 4)
}
