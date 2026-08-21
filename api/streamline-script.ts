import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { GROK_API_URL, GROK_TEXT_MODEL } from './lib/grok-models.js'
import {
  DENSITY_CONFIG,
  getStreamlineSystemPrompt,
  normalizeTextDensity,
} from './lib/streamline-copy.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const { script, postStyle = 'venta-directa', language = 'es', productContext } = req.body
    const textDensity = normalizeTextDensity(req.body?.textDensity)

    if (!script || typeof script !== 'string' || script.trim().length === 0) {
      return res.status(400).json({ error: 'Script text is required' })
    }

    const xaiApiKey = process.env.GROK_API_KEY
    if (!xaiApiKey) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const safeContext = productContext && typeof productContext === 'object'
      ? {
          name: typeof productContext.name === 'string' ? productContext.name.trim().slice(0, 200) : undefined,
          description: typeof productContext.description === 'string' ? productContext.description.trim().slice(0, 800) : undefined,
          niche: typeof productContext.niche === 'string' ? productContext.niche.trim().slice(0, 200) : undefined,
          differentiation: typeof productContext.differentiation === 'string' ? productContext.differentiation.trim().slice(0, 400) : undefined,
        }
      : undefined

    const densityConfig = DENSITY_CONFIG[textDensity]
    const systemPrompt = getStreamlineSystemPrompt(postStyle, language, safeContext, textDensity)

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiApiKey}`
      },
      body: JSON.stringify({
        model: GROK_TEXT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: script.trim() }
        ],
        temperature: densityConfig.temperature,
        max_tokens: densityConfig.maxTokens
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Grok API error:', response.status, errText)
      return res.status(502).json({ error: 'AI service error' })
    }

    const data = await response.json()
    const rawStreamlined = data.choices?.[0]?.message?.content?.trim() || ''
    const streamlined = rawStreamlined
      .replace(/\[[^\]\n]{2,80}\]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (!streamlined) {
      return res.status(500).json({ error: 'Empty response from AI' })
    }

    const inputTokens = estimateTokens(systemPrompt + script)
    const outputTokens = estimateTokens(streamlined)
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'prompt_condense',
      model: GROK_TEXT_MODEL,
      inputTokens,
      outputTokens,
      success: true,
      metadata: { action: 'streamline_script', postStyle, language, textDensity, hasProductContext: !!safeContext }
    })

    return res.status(200).json({ streamlined, textDensity })

  } catch (error) {
    console.error('Streamline script error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'prompt_condense',
      model: GROK_TEXT_MODEL,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
