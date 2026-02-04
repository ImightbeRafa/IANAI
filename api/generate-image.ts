import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'
import { GoogleGenAI } from '@google/genai'

const FLUX_API_URL = 'https://api.bfl.ai/v1/flux-2-klein-9b'
const GROK_IMAGINE_API_URL = 'https://api.x.ai/v1/images/generations'

// Gemini Image Generation Models (from official SDK documentation)
const GEMINI_IMAGE_MODELS: Record<string, string> = {
  'nano-banana': 'gemini-2.5-flash-image',          // Fast, efficient (1K resolution)
  'nano-banana-pro': 'gemini-3-pro-image-preview'   // High quality, reasoning (up to 4K)
}

type ImageModel = 'flux' | 'nano-banana' | 'nano-banana-pro' | 'grok-imagine'

// System prompt for Flux (no text support)
const FLUX_PROMPT_PREFIX = `Crea una fotografía profesional de alta calidad para marketing en redes sociales.
NO crees una captura de pantalla o mockup de Instagram u otra red social.
NO incluyas texto, letras, palabras, marcas de agua ni logos en la imagen.
Enfócate en: composición limpia, iluminación profesional, colores vibrantes, atractivo comercial.
Estilo: Fotografía de producto moderna, imágenes lifestyle, contenido promocional.

Solicitud del usuario: `

// System prompt for Gemini (CAN render text in images)
const GEMINI_PROMPT_PREFIX = `Crea una imagen profesional de alta calidad para marketing en redes sociales.
NO crees una captura de pantalla o mockup de Instagram u otra red social.
Enfócate en: composición limpia, iluminación profesional, colores vibrantes, atractivo comercial.
Estilo: Fotografía de producto moderna, imágenes lifestyle, contenido promocional.
Puedes incluir texto legible si el usuario lo solicita.

Solicitud del usuario: `

// Detect if user is asking for text in the image
function containsTextRequest(prompt: string): boolean {
  const textIndicators = [
    /que diga/i,
    /con texto/i,
    /with text/i,
    /that says/i,
    /saying/i,
    /write/i,
    /escrib/i,
    /font/i,
    /tipograf/i,
    /letter/i,
    /palabra/i,
    /frase/i,
  ]
  return textIndicators.some(pattern => pattern.test(prompt))
}

// Remove text-related instructions from prompt
function cleanPromptForImageGen(prompt: string): string {
  // Remove common text request patterns
  let cleaned = prompt
    .replace(/que diga[^,.]*/gi, '')
    .replace(/con texto[^,.]*/gi, '')
    .replace(/with text[^,.]*/gi, '')
    .replace(/that says[^,.]*/gi, '')
    .replace(/saying[^,.]*/gi, '')
    .replace(/en font[^,.]*/gi, '')
    .replace(/in font[^,.]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  
  return cleaned
}

interface FluxRequest {
  prompt: string
  input_image?: string
  input_image_2?: string
  input_image_3?: string
  input_image_4?: string
  width?: number
  height?: number
  seed?: number
  output_format?: 'jpeg' | 'png'
  safety_tolerance?: number
}

interface FluxSubmitResponse {
  id: string
  polling_url: string
  cost?: number
}

interface FluxPollResponse {
  status: 'Pending' | 'Ready' | 'Error' | 'Failed'
  result?: {
    sample: string
  }
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
  if (!user) return // Response already sent by requireAuth

  try {
    const { action, taskId, model = 'nano-banana', ...imageParams } = req.body
    const selectedModel: ImageModel = model

    // For polling requests, skip usage check (already counted on initial request)
    if (action !== 'poll') {
      // Check usage limits for new generation requests
      const { allowed, remaining, limit } = await checkUsageLimit(user.id, 'image')
      if (!allowed) {
        return res.status(429).json({ 
          error: 'Límite de imágenes alcanzado',
          message: `Has alcanzado el límite de ${limit} imágenes este mes. Actualiza tu plan para continuar.`,
          limit,
          remaining: 0
        })
      }
    }

    // Poll for Flux result (Gemini is synchronous, no polling needed)
    if (action === 'poll' && taskId) {
      const bflApiKey = process.env.BFL_API_KEY
      if (!bflApiKey) {
        return res.status(500).json({ error: 'Flux API key not configured' })
      }
      
      const pollResponse = await fetch(`https://api.bfl.ai/v1/get_result?id=${taskId}`, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'x-key': bflApiKey
        }
      })

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text()
        console.error('Flux poll error:', errorText)
        return res.status(pollResponse.status).json({ error: 'Failed to check generation status' })
      }

      const pollResult: FluxPollResponse = await pollResponse.json()
      return res.status(200).json(pollResult)
    }

    // Submit new generation request
    let userPrompt = imageParams.prompt || ''
    const isGeminiModel = selectedModel === 'nano-banana' || selectedModel === 'nano-banana-pro'
    
    // Check if user is requesting text in the image
    const hasTextRequest = containsTextRequest(userPrompt)
    
    // Only strip text for Flux models - Gemini CAN render text in images
    if (hasTextRequest && !isGeminiModel) {
      userPrompt = cleanPromptForImageGen(userPrompt)
    }
    
    // Use appropriate prompt prefix based on model
    const promptPrefix = isGeminiModel ? GEMINI_PROMPT_PREFIX : FLUX_PROMPT_PREFIX
    const enhancedPrompt = promptPrefix + userPrompt

    // =============================================
    // GEMINI IMAGE GENERATION (Nano Banana models)
    // =============================================
    if (selectedModel === 'nano-banana' || selectedModel === 'nano-banana-pro') {
      const geminiApiKey = process.env.GEMINI_API_KEY
      if (!geminiApiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured' })
      }

      const geminiModelId = GEMINI_IMAGE_MODELS[selectedModel]

      console.log('Submitting to Gemini Image API:', { 
        model: geminiModelId,
        prompt: enhancedPrompt.substring(0, 100) + '...',
        hasInputImage: !!imageParams.input_image
      })

      try {
        // Initialize Google GenAI SDK
        const ai = new GoogleGenAI({ apiKey: geminiApiKey })

        // Build the prompt parts
        type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } }
        const promptParts: PromptPart[] = [{ text: enhancedPrompt }]

        // Add input image if provided (for image-to-image generation)
        if (imageParams.input_image) {
          // Extract base64 data from data URL if present
          const base64Match = imageParams.input_image.match(/^data:([^;]+);base64,(.+)$/)
          if (base64Match) {
            promptParts.push({
              inlineData: {
                mimeType: base64Match[1],
                data: base64Match[2]
              }
            })
          }
        }

        // Generate image using SDK (format from official docs)
        const response = await ai.models.generateContent({
          model: geminiModelId,
          contents: promptParts,
          config: {
            responseModalities: ['TEXT', 'IMAGE']
          }
        })

        // Extract image from response
        const candidates = response.candidates || []
        const parts = candidates[0]?.content?.parts || []
        
        let imageUrl: string | null = null
        
        for (const part of parts) {
          if ('inlineData' in part && part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || 'image/png'
            imageUrl = `data:${mimeType};base64,${part.inlineData.data}`
            break
          }
        }

        if (!imageUrl) {
          console.error('No image in Gemini response:', JSON.stringify(response, null, 2))
          return res.status(500).json({ error: 'No image generated by Gemini' })
        }

        // Increment usage counter after successful generation
        await incrementUsage(user.id, 'image')

        // Log Gemini image usage
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: selectedModel,
          success: true,
          metadata: { width: imageParams.width, height: imageParams.height, hasInputImage: !!imageParams.input_image }
        })

        // Return immediately (no polling needed for Gemini)
        // No textWarning for Gemini - it CAN render text in images
        return res.status(200).json({
          status: 'Ready',
          result: { sample: imageUrl },
          model: selectedModel,
          textWarning: false
        })

      } catch (geminiError) {
        console.error('Gemini SDK error:', geminiError)
        
        // Log failed attempt
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: selectedModel,
          success: false,
          errorMessage: geminiError instanceof Error ? geminiError.message : 'Unknown error',
          metadata: { hasInputImage: !!imageParams.input_image }
        })

        return res.status(500).json({ 
          error: 'Gemini image generation failed',
          details: geminiError instanceof Error ? geminiError.message : 'Unknown error'
        })
      }
    }

    // =============================================
    // GROK IMAGINE IMAGE GENERATION
    // =============================================
    if (selectedModel === 'grok-imagine') {
      const xaiApiKey = process.env.GROK_API_KEY
      if (!xaiApiKey) {
        return res.status(500).json({ error: 'xAI API key not configured' })
      }

      console.log('Submitting to Grok Imagine API:', { 
        prompt: enhancedPrompt.substring(0, 100) + '...',
        hasInputImage: !!imageParams.input_image
      })

      try {
        // Use b64_json to avoid CORS issues with xAI's image hosting
        const grokRequest: Record<string, unknown> = {
          model: 'grok-2-image-1212',
          prompt: enhancedPrompt,
          n: 1,
          response_format: 'b64_json'
        }

        const response = await fetch(GROK_IMAGINE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${xaiApiKey}`
          },
          body: JSON.stringify(grokRequest)
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error('Grok Imagine API error:', errorText)
          
          await logApiUsage({
            userId: user.id,
            userEmail: user.email,
            feature: 'image',
            model: 'grok-imagine',
            success: false,
            errorMessage: errorText,
            metadata: { hasInputImage: !!imageParams.input_image }
          })

          return res.status(response.status).json({ 
            error: 'Grok Imagine generation failed',
            details: errorText
          })
        }

        const result = await response.json()
        
        // Handle base64 response format
        const b64Data = result.data?.[0]?.b64_json
        if (!b64Data) {
          throw new Error('No image data in response')
        }
        
        // Convert to data URL for client consumption
        const imageUrl = `data:image/jpeg;base64,${b64Data}`

        // Increment usage counter
        await incrementUsage(user.id, 'image')

        // Log usage
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: 'grok-imagine',
          success: true,
          metadata: { width: imageParams.width, height: imageParams.height }
        })

        // Return immediately (Grok Imagine is synchronous)
        return res.status(200).json({
          status: 'Ready',
          result: { sample: imageUrl },
          model: selectedModel,
          textWarning: false
        })

      } catch (grokError) {
        console.error('Grok Imagine error:', grokError)
        
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: 'grok-imagine',
          success: false,
          errorMessage: grokError instanceof Error ? grokError.message : 'Unknown error',
          metadata: { hasInputImage: !!imageParams.input_image }
        })

        return res.status(500).json({ 
          error: 'Grok Imagine generation failed',
          details: grokError instanceof Error ? grokError.message : 'Unknown error'
        })
      }
    }

    // =============================================
    // FLUX IMAGE GENERATION (default/legacy)
    // =============================================
    const bflApiKey = process.env.BFL_API_KEY
    if (!bflApiKey) {
      return res.status(500).json({ error: 'Flux API key not configured' })
    }
    
    const fluxRequest: FluxRequest = {
      prompt: enhancedPrompt,
      width: imageParams.width || 1080,
      height: imageParams.height || 1080,
      output_format: imageParams.output_format || 'jpeg',
      safety_tolerance: 2
    }

    // Add input images if provided (for img2img)
    if (imageParams.input_image) {
      fluxRequest.input_image = imageParams.input_image
    }
    if (imageParams.input_image_2) {
      fluxRequest.input_image_2 = imageParams.input_image_2
    }
    if (imageParams.input_image_3) {
      fluxRequest.input_image_3 = imageParams.input_image_3
    }
    if (imageParams.input_image_4) {
      fluxRequest.input_image_4 = imageParams.input_image_4
    }

    // Add seed if provided
    if (imageParams.seed) {
      fluxRequest.seed = imageParams.seed
    }

    console.log('Submitting to Flux API:', { 
      prompt: fluxRequest.prompt.substring(0, 100) + '...',
      hasInputImage: !!fluxRequest.input_image,
      width: fluxRequest.width,
      height: fluxRequest.height
    })

    const response = await fetch(FLUX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-key': bflApiKey
      },
      body: JSON.stringify(fluxRequest)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Flux API error:', errorText)
      return res.status(response.status).json({ error: 'Image generation failed', details: errorText })
    }

    const result: FluxSubmitResponse = await response.json()
    
    // Increment usage counter after successful submission
    await incrementUsage(user.id, 'image')

    // Log Flux usage
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'image',
      model: 'flux',
      success: true,
      metadata: { 
        width: fluxRequest.width, 
        height: fluxRequest.height, 
        hasInputImage: !!fluxRequest.input_image,
        taskId: result.id,
        cost: result.cost
      }
    })

    return res.status(200).json({
      taskId: result.id,
      pollingUrl: result.polling_url,
      cost: result.cost,
      model: selectedModel,
      textWarning: hasTextRequest
    })

  } catch (error) {
    console.error('Image generation error:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
