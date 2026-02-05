import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'

const GROK_VIDEO_API_URL = 'https://api.x.ai/v1/videos/generations'
const GROK_VIDEO_RESULT_URL = 'https://api.x.ai/v1/videos'

type AspectRatio = '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '3:2' | '2:3'
type VideoResolution = '720p' | '480p'

interface VideoGenerationRequest {
  prompt: string
  model: string
  duration?: number
  aspect_ratio?: AspectRatio
  resolution?: VideoResolution
  image_url?: string
  video_url?: string
}

interface VideoStartResponse {
  request_id: string
}

interface VideoResultResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  url?: string
  duration?: number
  error?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify user authentication
  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const { 
      action, 
      requestId,
      prompt,
      duration = 5,
      aspect_ratio = '16:9',
      resolution = '720p',
      image_url,
      video_url
    } = req.body

    const xaiApiKey = process.env.GROK_API_KEY
    if (!xaiApiKey) {
      return res.status(500).json({ error: 'xAI API key not configured' })
    }

    // Poll for video result
    if (action === 'poll' && requestId) {
      const pollStartTime = Date.now()
      console.log('Polling Grok Video result:', { requestId, timestamp: new Date().toISOString() })
      
      const pollResponse = await fetch(`${GROK_VIDEO_RESULT_URL}/${requestId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${xaiApiKey}`,
          'Accept': 'application/json'
        }
      })

      const pollLatency = Date.now() - pollStartTime

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text()
        console.error('Grok Video poll error:', { 
          requestId, 
          status: pollResponse.status, 
          error: errorText,
          latency: pollLatency
        })
        return res.status(pollResponse.status).json({ 
          error: 'Failed to check video status',
          details: errorText,
          debug: { requestId, httpStatus: pollResponse.status, latency: pollLatency }
        })
      }

      const pollResult = await pollResponse.json()
      
      // Log full response for debugging
      console.log('Grok Video poll response:', { 
        requestId,
        rawStatus: pollResult.status,
        hasUrl: !!pollResult.url,
        latency: pollLatency,
        fullResponse: JSON.stringify(pollResult).substring(0, 500)
      })
      
      // Extract video URL - API returns it in video.url
      const videoUrl = pollResult.video?.url || pollResult.url
      const videoDuration = pollResult.video?.duration || pollResult.duration
      
      // Map status to our format - check for various possible status values
      let status: 'Pending' | 'Ready' | 'Error' | 'Failed' = 'Pending'
      const rawStatus = (pollResult.status || '').toLowerCase()
      
      if (rawStatus === 'completed' || rawStatus === 'complete' || rawStatus === 'succeeded' || videoUrl) {
        status = 'Ready'
      } else if (rawStatus === 'failed' || rawStatus === 'error' || rawStatus === 'cancelled') {
        status = 'Failed'
      } else if (rawStatus === 'processing' || rawStatus === 'pending' || rawStatus === 'in_progress' || rawStatus === 'queued') {
        status = 'Pending'
      }

      return res.status(200).json({
        status,
        result: videoUrl ? { sample: videoUrl, duration: videoDuration } : undefined,
        error: pollResult.error || pollResult.message,
        debug: {
          requestId,
          rawStatus: pollResult.status,
          videoUrl: !!videoUrl,
          latency: pollLatency,
          timestamp: new Date().toISOString()
        }
      })
    }

    // Check usage limits for new generation requests
    const { allowed, remaining, limit } = await checkUsageLimit(user.id, 'video')
    if (!allowed) {
      return res.status(429).json({ 
        error: 'Límite de videos alcanzado',
        message: `Has alcanzado el límite de ${limit} videos este mes. Actualiza tu plan para continuar.`,
        limit,
        remaining: 0
      })
    }

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    // Validate duration (1-15 seconds for generation, editing keeps original)
    const validDuration = Math.max(1, Math.min(15, duration))

    // Check if this is a structured ad video prompt (from build-ad-prompt pipeline)
    // or a legacy B-Roll free-form prompt
    const { motherPrompt } = req.body
    const MAX_PROMPT_LENGTH = 3900 // Grok Video API limit is 4096, leave margin
    
    let systemPrompt: string

    if (motherPrompt) {
      // If mother prompt fits, use it directly
      if (motherPrompt.length <= MAX_PROMPT_LENGTH) {
        systemPrompt = motherPrompt
      } else {
        // Condense the mother prompt to fit the video API limit
        console.log(`Mother prompt too long (${motherPrompt.length} chars), condensing...`)
        try {
          const condenseResponse = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${xaiApiKey}`
            },
            body: JSON.stringify({
              model: 'grok-3-mini',
              messages: [
                { role: 'system', content: `You are a video prompt engineer. Condense the following structured video prompt into a SINGLE dense paragraph under 3500 characters. Keep ALL visual details, shot descriptions, product appearance, and timing. Remove markdown formatting, section headers, and redundancy. Output ONLY the condensed prompt, nothing else.` },
                { role: 'user', content: motherPrompt }
              ],
              temperature: 0.2,
              max_tokens: 1000
            })
          })
          const condenseResult = await condenseResponse.json()
          const condensed = condenseResult.choices?.[0]?.message?.content?.trim()
          if (condensed && condensed.length <= MAX_PROMPT_LENGTH) {
            systemPrompt = condensed
            console.log(`Condensed to ${condensed.length} chars`)
          } else {
            // Fallback: hard truncate
            systemPrompt = (condensed || motherPrompt).substring(0, MAX_PROMPT_LENGTH)
            console.log(`Truncated to ${MAX_PROMPT_LENGTH} chars`)
          }
        } catch (condenseErr) {
          console.error('Condense failed, truncating:', condenseErr)
          systemPrompt = motherPrompt.substring(0, MAX_PROMPT_LENGTH)
        }
      }
    } else {
      systemPrompt = `Create a professional B-Roll video clip for social media marketing.
Focus on: smooth motion, cinematic quality, professional lighting, engaging visuals.
Style: Modern, clean, commercial-quality footage suitable for ads and social media content.

User request: ${prompt}`
    }

    console.log('Submitting to Grok Video API:', { 
      prompt: systemPrompt.substring(0, 100) + '...',
      duration: validDuration,
      aspect_ratio,
      resolution,
      hasImageUrl: !!image_url,
      hasVideoUrl: !!video_url
    })

    // Build request with official model name
    // Model: grok-imagine-video ($0.05/sec at 480p, $0.07/sec at 720p)
    const videoRequest: VideoGenerationRequest = {
      prompt: systemPrompt,
      model: 'grok-imagine-video',
      duration: validDuration,
      aspect_ratio,
      resolution
    }

    // Add image or video URL if provided
    if (image_url) {
      videoRequest.image_url = image_url
    }
    if (video_url) {
      videoRequest.video_url = video_url
    }

    // Send generation request
    const response = await fetch(GROK_VIDEO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiApiKey}`
      },
      body: JSON.stringify(videoRequest)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Grok Video API error:', errorText)
      
      await logApiUsage({
        userId: user.id,
        userEmail: user.email,
        feature: 'video',
        model: 'grok-imagine-video',
        success: false,
        errorMessage: errorText,
        metadata: { duration: validDuration, aspect_ratio, resolution }
      })

      return res.status(response.status).json({ 
        error: 'Video generation failed',
        details: errorText
      })
    }

    const result: VideoStartResponse = await response.json()
    
    // Increment usage counter after successful submission
    await incrementUsage(user.id, 'video')

    // Log usage with resolution-based pricing model
    // grok-imagine-video-480p: $0.05/sec, grok-imagine-video-720p: $0.07/sec
    const pricingModel = resolution === '720p' ? 'grok-imagine-video-720p' : 'grok-imagine-video-480p'
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'video',
      model: pricingModel,
      success: true,
      metadata: { 
        requestId: result.request_id,
        duration: validDuration, 
        aspect_ratio, 
        resolution,
        hasImageUrl: !!image_url,
        hasVideoUrl: !!video_url
      }
    })

    return res.status(200).json({
      requestId: result.request_id,
      model: 'grok-imagine-video',
      duration: validDuration,
      aspect_ratio,
      resolution
    })

  } catch (error) {
    console.error('Video generation error:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
