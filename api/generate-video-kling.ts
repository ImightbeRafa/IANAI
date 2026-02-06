import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fal } from '@fal-ai/client'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'

/**
 * KLING AI VIDEO GENERATION via fal.ai
 * Supports: text-to-video, image-to-video
 * Uses the same Module A+B+C pipeline output (motherPrompt) as Grok
 * 
 * fal.ai handles Kling API auth, queuing, and billing internally.
 * We use fal.queue.submit + fal.queue.status + fal.queue.result for polling.
 * 
 * Models:
 *   Image-to-video: fal-ai/kling-video/v2.6/pro/image-to-video
 *   Text-to-video:  fal-ai/kling-video/v2.6/pro/text-to-video
 * 
 * Pricing: ~$0.07/sec (no audio), ~$0.14/sec (with audio)
 * Duration: 5-30s in 5s increments (fal handles billing per second)
 */

// Model IDs on fal.ai
const FAL_KLING_IMAGE_TO_VIDEO = 'fal-ai/kling-video/v2.6/pro/image-to-video'
const FAL_KLING_TEXT_TO_VIDEO = 'fal-ai/kling-video/v2.6/pro/text-to-video'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const {
      action,
      taskId: reqTaskId,
      prompt,
      motherPrompt,
      duration = 5,
      aspect_ratio = '9:16',
      generate_audio = false,
      cfg_scale = 0.5,
      image_url,
      image_urls,
      negative_prompt
    } = req.body

    const falKey = process.env.FAL_KEY
    if (!falKey) {
      return res.status(500).json({ error: 'FAL_KEY not configured' })
    }

    // Configure fal client for this request
    fal.config({ credentials: falKey })

    // ─── POLL FOR RESULT ──────────────────────────────────────────────
    if (action === 'poll' && reqTaskId) {
      const pollStartTime = Date.now()

      // taskId format: "modelId:request_id"
      const separatorIdx = reqTaskId.indexOf('::')
      const modelId = separatorIdx !== -1 ? reqTaskId.substring(0, separatorIdx) : FAL_KLING_TEXT_TO_VIDEO
      const requestId = separatorIdx !== -1 ? reqTaskId.substring(separatorIdx + 2) : reqTaskId

      console.log('Polling fal.ai Kling:', { modelId, requestId, timestamp: new Date().toISOString() })

      try {
        const queueStatus = await fal.queue.status(modelId, { requestId, logs: true })
        const pollLatency = Date.now() - pollStartTime

        console.log('fal.ai poll response:', {
          requestId,
          status: queueStatus.status,
          latency: pollLatency
        })

        // Map fal.ai status to our unified format
        const falStatus = queueStatus.status as string

        if (falStatus === 'COMPLETED') {
          // Use response_url from status if available, otherwise construct it
          const statusAny = queueStatus as unknown as Record<string, unknown>
          const responseUrl = (statusAny.response_url as string) 
            || `https://queue.fal.run/${modelId}/requests/${requestId}/response`

          console.log('fal.ai fetching result:', { responseUrl, requestId })

          // Fetch result via REST to avoid SDK fal.queue.result() 422 ValidationError
          const resultResponse = await fetch(responseUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Key ${falKey}`
            }
          })

          if (!resultResponse.ok) {
            const errText = await resultResponse.text()
            console.error('fal.ai result fetch error:', {
              status: resultResponse.status,
              body: errText,
              requestId,
              responseUrl
            })
            return res.status(200).json({
              status: 'Pending',
              debug: {
                requestId,
                rawStatus: 'result_fetch_error',
                httpStatus: resultResponse.status,
                timestamp: new Date().toISOString()
              }
            })
          }

          const data = await resultResponse.json() as Record<string, unknown>
          const video = data?.video as Record<string, unknown> | undefined
          const videoUrl = video?.url as string | undefined

          return res.status(200).json({
            status: 'Ready',
            result: videoUrl ? { sample: videoUrl, duration: duration } : undefined,
            debug: {
              requestId,
              rawStatus: 'COMPLETED',
              videoUrl: !!videoUrl,
              latency: pollLatency,
              timestamp: new Date().toISOString()
            }
          })
        } else if (falStatus === 'FAILED') {
          return res.status(200).json({
            status: 'Failed',
            error: 'Video generation failed on fal.ai',
            debug: {
              requestId,
              rawStatus: 'FAILED',
              latency: pollLatency,
              timestamp: new Date().toISOString()
            }
          })
        } else {
          // IN_QUEUE or IN_PROGRESS
          return res.status(200).json({
            status: 'Pending',
            debug: {
              requestId,
              rawStatus: falStatus,
              latency: pollLatency,
              timestamp: new Date().toISOString()
            }
          })
        }
      } catch (pollErr) {
        const errBody = (pollErr as Record<string, unknown>)?.body
        const errStatus = (pollErr as Record<string, unknown>)?.status
        console.error('fal.ai poll error:', {
          message: pollErr instanceof Error ? pollErr.message : 'Unknown',
          status: errStatus,
          body: JSON.stringify(errBody),
          requestId
        })
        return res.status(200).json({
          status: 'Pending',
          debug: {
            requestId,
            rawStatus: 'poll_error',
            error: pollErr instanceof Error ? pollErr.message : 'Unknown',
            errorBody: errBody,
            timestamp: new Date().toISOString()
          }
        })
      }
    }

    // ─── NEW GENERATION REQUEST ───────────────────────────────────────
    const { allowed, remaining, limit } = await checkUsageLimit(user.id, 'video')
    if (!allowed) {
      return res.status(429).json({
        error: 'Límite de videos alcanzado',
        message: `Has alcanzado el límite de ${limit} videos este mes. Actualiza tu plan para continuar.`,
        limit,
        remaining: 0
      })
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    // Build the prompt — use motherPrompt if available
    // fal.ai/Kling handles longer prompts well, but keep condenser as safety net
    const MAX_PROMPT_LENGTH = 3000
    let finalPrompt: string

    if (motherPrompt) {
      if (motherPrompt.length <= MAX_PROMPT_LENGTH) {
        finalPrompt = motherPrompt
      } else {
        // Condense using Grok (we still have the Grok key for text tasks)
        const grokApiKey = process.env.GROK_API_KEY
        if (grokApiKey) {
          console.log(`fal/Kling: Mother prompt too long (${motherPrompt.length} chars), condensing...`)
          try {
            const condenseResponse = await fetch('https://api.x.ai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${grokApiKey}`
              },
              body: JSON.stringify({
                model: 'grok-3-mini',
                messages: [
                  { role: 'system', content: `You are a video prompt engineer. Condense the following structured video prompt into a SINGLE dense paragraph under 2800 characters. Keep ALL visual details, shot descriptions, product appearance, and timing. Remove markdown formatting, section headers, and redundancy. Output ONLY the condensed prompt, nothing else.` },
                  { role: 'user', content: motherPrompt }
                ],
                temperature: 0.2,
                max_tokens: 900
              })
            })
            const condenseResult = await condenseResponse.json()
            const condensed = condenseResult.choices?.[0]?.message?.content?.trim()
            if (condensed && condensed.length <= MAX_PROMPT_LENGTH) {
              finalPrompt = condensed
              console.log(`Condensed to ${condensed.length} chars for fal/Kling`)
            } else {
              finalPrompt = (condensed || motherPrompt).substring(0, MAX_PROMPT_LENGTH)
            }

            // Log the condense call usage
            await logApiUsage({
              userId: user.id,
              userEmail: user.email,
              feature: 'prompt_condense',
              model: 'grok-3-mini',
              inputTokens: estimateTokens(motherPrompt),
              outputTokens: estimateTokens(condensed || ''),
              success: true,
              metadata: { source: 'kling_video', originalLength: motherPrompt.length, condensedLength: (condensed || '').length }
            })
          } catch {
            finalPrompt = motherPrompt.substring(0, MAX_PROMPT_LENGTH)
          }
        } else {
          finalPrompt = motherPrompt.substring(0, MAX_PROMPT_LENGTH)
        }
      }
    } else {
      finalPrompt = prompt.trim().substring(0, MAX_PROMPT_LENGTH)
    }

    // Determine generation type: image-to-video (if images provided) or text-to-video
    const hasImages = image_url || (image_urls && image_urls.length > 0)
    const imageRef = image_url || (image_urls && image_urls[0])
    const modelId = hasImages ? FAL_KLING_IMAGE_TO_VIDEO : FAL_KLING_TEXT_TO_VIDEO

    // Kling via fal.ai: snap to nearest 5s increment (5, 10, 15, 20, 25, 30)
    const validDuration = Math.max(5, Math.min(30, Math.round(duration / 5) * 5))

    // Validate aspect_ratio for Kling (only 16:9, 9:16, 1:1 supported)
    const validAspectRatios = ['16:9', '9:16', '1:1']
    const validAspectRatio = validAspectRatios.includes(aspect_ratio) ? aspect_ratio : '9:16'

    // Clamp cfg_scale to 0-1 range
    const validCfgScale = Math.max(0, Math.min(1, Number(cfg_scale) || 0.5))

    // Build fal.ai input
    const falInput: Record<string, unknown> = {
      prompt: finalPrompt,
      duration: String(validDuration),
      aspect_ratio: validAspectRatio,
      cfg_scale: validCfgScale,
      generate_audio: !!generate_audio
    }

    if (negative_prompt) {
      falInput.negative_prompt = negative_prompt
    }

    // Image-to-video: attach image reference
    if (hasImages && imageRef) {
      falInput.image_url = imageRef
    }

    console.log('Submitting to fal.ai Kling:', {
      modelId,
      promptLength: finalPrompt.length,
      duration: validDuration,
      aspect_ratio: validAspectRatio,
      generate_audio,
      cfg_scale: validCfgScale,
      hasImage: !!hasImages
    })

    // Submit to fal queue (non-blocking, returns request_id for polling)
    const submitResult = await fal.queue.submit(modelId, { input: falInput })
    const falRequestId = submitResult.request_id

    if (!falRequestId) {
      return res.status(500).json({ error: 'No request ID returned from fal.ai' })
    }

    await incrementUsage(user.id, 'video')

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'kling_video',
      model: modelId,
      success: true,
      metadata: {
        falRequestId,
        duration: validDuration,
        aspect_ratio: validAspectRatio,
        generate_audio: !!generate_audio,
        cfg_scale: validCfgScale,
        genType: hasImages ? 'image2video' : 'text2video',
        hasImage: !!hasImages
      }
    })

    // Return composite ID: "modelId::request_id" so polling knows which model to query
    return res.status(200).json({
      requestId: `${modelId}::${falRequestId}`,
      model: modelId,
      duration: validDuration,
      aspect_ratio: validAspectRatio,
      generate_audio: !!generate_audio,
      cfg_scale: validCfgScale
    })

  } catch (error) {
    console.error('fal.ai Kling video generation error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'kling_video',
      model: FAL_KLING_TEXT_TO_VIDEO,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
