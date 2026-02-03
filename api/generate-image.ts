import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth'

const FLUX_API_URL = 'https://api.bfl.ai/v1/flux-2-klein-9b'

// System prompt to enhance user prompts for better Instagram content images (Spanish primary)
const SYSTEM_PROMPT_PREFIX = `Crea una fotografía profesional de alta calidad para marketing en redes sociales.
NO crees una captura de pantalla o mockup de Instagram u otra red social.
NO incluyas texto, letras, palabras, marcas de agua ni logos en la imagen.
Enfócate en: composición limpia, iluminación profesional, colores vibrantes, atractivo comercial.
Estilo: Fotografía de producto moderna, imágenes lifestyle, contenido promocional.

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

  const apiKey = process.env.BFL_API_KEY
  if (!apiKey) {
    console.error('BFL_API_KEY not configured')
    return res.status(500).json({ error: 'Image generation service not configured' })
  }

  try {
    const { action, taskId, ...imageParams } = req.body

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

    // Poll for result
    if (action === 'poll' && taskId) {
      const pollResponse = await fetch(`https://api.bfl.ai/v1/get_result?id=${taskId}`, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'x-key': apiKey
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
    
    // Check if user is requesting text in the image
    const hasTextRequest = containsTextRequest(userPrompt)
    if (hasTextRequest) {
      // Clean the prompt to remove text instructions (AI models can't render text well)
      userPrompt = cleanPromptForImageGen(userPrompt)
    }
    
    // Enhance prompt with system instructions
    const enhancedPrompt = SYSTEM_PROMPT_PREFIX + userPrompt
    
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
        'x-key': apiKey
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

    return res.status(200).json({
      taskId: result.id,
      pollingUrl: result.polling_url,
      cost: result.cost,
      textWarning: hasTextRequest // Let frontend know text was requested but filtered
    })

  } catch (error) {
    console.error('Image generation error:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
