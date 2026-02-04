import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'

const GROK_VIDEO_API_URL = 'https://api.x.ai/v1/video/generations'
const GROK_VIDEO_RESULT_URL = 'https://api.x.ai/v1/video/generations'

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
      console.log('Polling Grok Video result:', requestId)
      
      const pollResponse = await fetch(`${GROK_VIDEO_RESULT_URL}/${requestId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${xaiApiKey}`,
          'Accept': 'application/json'
        }
      })

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text()
        console.error('Grok Video poll error:', errorText)
        return res.status(pollResponse.status).json({ error: 'Failed to check video status' })
      }

      const pollResult: VideoResultResponse = await pollResponse.json()
      
      // Map status to our format
      let status: 'Pending' | 'Ready' | 'Error' | 'Failed' = 'Pending'
      if (pollResult.status === 'completed') status = 'Ready'
      else if (pollResult.status === 'failed') status = 'Failed'
      else if (pollResult.status === 'processing' || pollResult.status === 'pending') status = 'Pending'

      return res.status(200).json({
        status,
        result: pollResult.url ? { sample: pollResult.url, duration: pollResult.duration } : undefined,
        error: pollResult.error
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

    // Build system prompt for B-Roll
    const systemPrompt = `Create a professional B-Roll video clip for social media marketing.
Focus on: smooth motion, cinematic quality, professional lighting, engaging visuals.
Style: Modern, clean, commercial-quality footage suitable for ads and social media content.

User request: ${prompt}`

    console.log('Submitting to Grok Video API:', { 
      prompt: systemPrompt.substring(0, 100) + '...',
      duration: validDuration,
      aspect_ratio,
      resolution,
      hasImageUrl: !!image_url,
      hasVideoUrl: !!video_url
    })

    // Build request
    const videoRequest: VideoGenerationRequest = {
      prompt: systemPrompt,
      model: 'grok-2-video',
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

    // Log usage
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'video',
      model: 'grok-imagine-video',
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
