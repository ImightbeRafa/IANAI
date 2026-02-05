import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey) 
  : null

// Cost per 1M tokens (in USD) - Update these based on actual pricing
export const MODEL_COSTS = {
  // Script generation models
  'grok': { input: 3.00, output: 15.00 }, // Grok pricing per 1M tokens
  'gemini': { input: 0.15, output: 0.60 }, // Gemini 3 Pro pricing
  
  // Image generation models (per image, not tokens)
  'flux': { perImage: 0.003 }, // Flux Klein ~$0.003/image
  'nano-banana': { perImage: 0.02 }, // Gemini 2.5 Flash Image estimate
  'nano-banana-pro': { perImage: 0.05 }, // Gemini 3 Pro Image estimate
  'grok-imagine': { perImage: 0.07 }, // grok-2-image-1212: $0.07/image
  
  // Video generation models (per second of output)
  // grok-imagine-video: $0.05/sec at 480p, $0.07/sec at 720p
  'grok-imagine-video-480p': { perSecond: 0.05 },
  'grok-imagine-video-720p': { perSecond: 0.07 },
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
  | 'kling_video'      // Kling AI video generation

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
