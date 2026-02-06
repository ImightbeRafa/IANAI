import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions'

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
    const { prompt, type = 'image', productContext } = req.body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    const xaiApiKey = process.env.GROK_API_KEY
    if (!xaiApiKey) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    // Build system prompt based on type (image or video)
    const systemPrompt = type === 'video' 
      ? `Eres un experto en creación de prompts para generación de videos B-Roll con IA.
Tu tarea es mejorar el prompt del usuario para obtener videos de alta calidad para marketing en redes sociales.

Reglas:
- Responde SOLO con el prompt mejorado, sin explicaciones
- El prompt debe estar en español
- Enfócate en: movimiento de cámara, iluminación cinematográfica, composición visual, ambiente
- El video es para contenido de redes sociales (TikTok, Instagram Reels, YouTube Shorts)
- Mantén la esencia de lo que el usuario quiere
- Agrega detalles técnicos que mejoren la calidad del video
- Máximo 150 palabras`
      : `Eres un experto en creación de prompts para generación de imágenes con IA.
Tu tarea es mejorar el prompt del usuario para obtener imágenes de alta calidad para marketing en redes sociales.

Reglas:
- Responde SOLO con el prompt mejorado, sin explicaciones
- El prompt debe estar en español
- Enfócate en: composición, iluminación, estilo visual, colores, ambiente
- La imagen es para posts de redes sociales (Instagram, Facebook, etc.)
- Mantén la esencia de lo que el usuario quiere
- Agrega detalles técnicos que mejoren la calidad de la imagen
- Máximo 100 palabras
- NO incluyas texto en la imagen a menos que el usuario lo pida explícitamente`

    // Add product context if provided
    let userMessage = `Prompt original del usuario: "${prompt.trim()}"`
    if (productContext) {
      userMessage += `\n\nContexto del producto/servicio: ${productContext}`
    }

    const response = await fetch(XAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiApiKey}`
      },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Prompt enhancement API error:', errorText)
      
      await logApiUsage({
        userId: user.id,
        userEmail: user.email,
        feature: 'prompt_enhance',
        model: 'grok-3-mini',
        success: false,
        errorMessage: errorText,
        metadata: { type }
      })

      return res.status(response.status).json({ 
        error: 'Failed to enhance prompt',
        details: errorText
      })
    }

    const result = await response.json()
    const enhancedPrompt = result.choices?.[0]?.message?.content?.trim()

    if (!enhancedPrompt) {
      throw new Error('No enhanced prompt in response')
    }

    // Calculate token usage for logging
    const inputTokens = estimateTokens(systemPrompt + userMessage)
    const outputTokens = estimateTokens(enhancedPrompt)

    // Log usage
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'prompt_enhance',
      model: 'grok-3-mini',
      inputTokens,
      outputTokens,
      success: true,
      metadata: { type }
    })

    return res.status(200).json({
      enhancedPrompt,
      originalPrompt: prompt.trim()
    })

  } catch (error) {
    console.error('Prompt enhancement error:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
