import type { VercelRequest, VercelResponse } from '@vercel/node'

const FLUX_API_URL = 'https://api.bfl.ai/v1/flux-2-klein-9b'

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

  const apiKey = process.env.BFL_API_KEY
  if (!apiKey) {
    console.error('BFL_API_KEY not configured')
    return res.status(500).json({ error: 'Image generation service not configured' })
  }

  try {
    const { action, taskId, ...imageParams } = req.body

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
    const fluxRequest: FluxRequest = {
      prompt: imageParams.prompt || '',
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
    
    return res.status(200).json({
      taskId: result.id,
      pollingUrl: result.polling_url,
      cost: result.cost
    })

  } catch (error) {
    console.error('Image generation error:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
