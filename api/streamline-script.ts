import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions'

// Post-type-aware condensation rules
function getSystemPrompt(postStyle: string, language: string): string {
  const lang = language === 'en' ? 'English' : 'Spanish'

  const baseRules = `You are an expert at condensing advertising scripts into ultra-short copy for social media image posts.
The user will give you a full script (Hook / Development / CTA). Your job is to extract ONLY the essential text that should appear ON the image.

CRITICAL RULES:
- Output ONLY the condensed text. No explanations, no labels, no markdown.
- Keep the SAME language as the input script (${lang}). Do NOT translate.
- Be extremely concise — images get cluttered with too much text.
- Preserve the core selling message and key differentiator.
- Output must be ready to paste directly into an image generation prompt.`

  const styleRules: Record<string, string> = {
    'venta-directa': `
OUTPUT FORMAT (strictly):
- 1 punchy headline (max 8 words)
- 3 ultra-short bullets (max 5 words each) — tangible facts only
- 1 CTA (max 4 words)

Separate each element with a line break. Nothing else.`,

    'features-benefits': `
OUTPUT FORMAT (strictly):
- 1 product name/headline (max 6 words)
- 3-4 feature labels (2-3 words each) — these go on callout labels pointing to the product

Separate each element with a line break. Nothing else.`,

    'product-showcase': `
OUTPUT FORMAT (strictly):
- 1 bold headline (max 8 words)
- 3 short callout labels (max 4 words each)
- 1 CTA button text (max 3 words)

Separate each element with a line break. Nothing else.`,

    'social-proof': `
OUTPUT FORMAT (strictly):
- 1 short customer quote (max 15 words)
- 1 customer name (can be invented if not in script)
- 1 product benefit headline (max 6 words)
- Star rating (e.g. ★★★★★)

Separate each element with a line break. Nothing else.`,

    'comparison': `
OUTPUT FORMAT (strictly):
- Option A name (max 3 words)
- Option B name (max 3 words)
- 3 comparison points for each (max 4 words each), marked with ✓ or ✗

Separate each element with a line break. Nothing else.`,

    'before-after': `
OUTPUT FORMAT (strictly):
- "Before" state description (max 6 words)
- "After" state description (max 6 words)
- 1 key metric or result (e.g. percentage, time saved)
- 1 short headline (max 8 words)

Separate each element with a line break. Nothing else.`,

    'collage': `
OUTPUT FORMAT (strictly):
- 1 main headline (max 8 words)
- 3-4 short captions for panels (max 5 words each)
- 1 CTA (max 3 words)

Separate each element with a line break. Nothing else.`,

    'deals-discounts': `
OUTPUT FORMAT (strictly):
- Discount amount (e.g. "30% OFF" or "$10 OFF")
- Product/offer name (max 5 words)
- 1 urgency phrase (max 5 words)
- 1 CTA button text (max 3 words)

Separate each element with a line break. Nothing else.`,

    'testimonial': `
OUTPUT FORMAT (strictly):
- 1 short testimonial quote (max 20 words)
- Customer name
- 1 product benefit (max 5 words)
- Star rating (e.g. ★★★★★)

Separate each element with a line break. Nothing else.`,
  }

  // Default generic condensation for custom types, organic, etc.
  const defaultStyleRules = `
OUTPUT FORMAT:
Condense the entire script into max 50 words total.
Keep: the main headline, 2-3 key points, and the CTA.
Remove: all filler, transitions, repetition, and verbose explanations.
Output as short lines separated by line breaks. Nothing else.`

  return baseRules + (styleRules[postStyle] || defaultStyleRules)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const { script, postStyle = 'venta-directa', language = 'es' } = req.body

    if (!script || typeof script !== 'string' || script.trim().length === 0) {
      return res.status(400).json({ error: 'Script text is required' })
    }

    const xaiApiKey = process.env.GROK_API_KEY
    if (!xaiApiKey) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const systemPrompt = getSystemPrompt(postStyle, language)

    const response = await fetch(XAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiApiKey}`
      },
      body: JSON.stringify({
        model: 'grok-3-fast',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: script.trim() }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Grok API error:', response.status, errText)
      return res.status(502).json({ error: 'AI service error' })
    }

    const data = await response.json()
    const streamlined = data.choices?.[0]?.message?.content?.trim() || ''

    if (!streamlined) {
      return res.status(500).json({ error: 'Empty response from AI' })
    }

    // Log usage
    const inputTokens = estimateTokens(systemPrompt + script)
    const outputTokens = estimateTokens(streamlined)
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'prompt_condense',
      model: 'grok-3-fast',
      inputTokens,
      outputTokens,
      success: true,
      metadata: { action: 'streamline_script', postStyle, language }
    })

    return res.status(200).json({ streamlined })

  } catch (error) {
    console.error('Streamline script error:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
