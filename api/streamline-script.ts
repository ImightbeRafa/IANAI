import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions'

// Product context sent from the frontend to anchor the output to THIS specific product
interface ProductContext {
  name?: string
  description?: string
  niche?: string
  differentiation?: string
}

// Post-type-aware condensation rules
function getSystemPrompt(postStyle: string, language: string, productContext?: ProductContext): string {
  const lang = language === 'en' ? 'English' : 'Spanish'

  const baseRules = `You are a senior copywriter condensing advertising scripts into short, punchy image copy for social media posts.

YOUR JOB: Distill the user's script into image-ready copy. The output must feel like a distilled version of THIS SPECIFIC script — not a generic ad and not a copy of other outputs you've produced before.

NON-NEGOTIABLE RULES:
- Output ONLY the condensed copy. No explanations, no labels, no markdown, no commentary, no quotation marks around the whole thing.
- Keep the SAME language as the input (${lang}). Do NOT translate.
- SPECIFICITY OVER GENERICNESS: Lift the script's own distinctive words, numbers, product names, claims, and angles — verbatim or lightly reworded. If the script contains a stat, a unique phrase, a specific ingredient, a time frame, or a named benefit, it MUST appear in the output.
- The output must read like copy someone wrote AFTER reading this particular script, not copy that could apply to any product in the category.
- Remove filler, transitions, repetition, and verbose phrasing — but preserve the script's unique angle.
- Use short lines, separated by line breaks. The total output should be ~40-60 words, feeling natural and readable (not robotic slot-fills).
- The result should be ready to paste directly into an image generation prompt.`

  const contextBlock = productContext && (productContext.name || productContext.description || productContext.niche)
    ? `

PRODUCT CONTEXT (anchor the output on THIS product — do not drift into generic category copy):
${productContext.name ? `- Product: ${productContext.name}` : ''}
${productContext.niche ? `- Niche / category: ${productContext.niche}` : ''}
${productContext.description ? `- Description: ${productContext.description}` : ''}
${productContext.differentiation ? `- Differentiation: ${productContext.differentiation}` : ''}`
    : ''

  // Style-specific INTENT (shape + purpose), not rigid line counts. Lets the model
  // choose natural line lengths while preserving the post style's communicative goal.
  const styleRules: Record<string, string> = {
    'venta-directa': `

STYLE INTENT — VENTA DIRECTA (direct-sale ad):
Shape the output as: a hook headline, 3 key selling points pulled from THIS script's development, and a CTA. Aim for ~50 words total. Each element on its own line. The 3 selling points must be script-specific claims — not generic benefits like "better quality" or "save time".`,

    'features-benefits': `

STYLE INTENT — FEATURES & BENEFITS:
Shape the output as: a headline with the product name or hook, followed by 3-4 feature→benefit pairs lifted from the script. Each feature→benefit pair should be short enough to fit as a label on an image. Every feature must come from the script, not invented.`,

    'product-showcase': `

STYLE INTENT — PRODUCT SHOWCASE:
Shape the output as: a bold headline (hook from the script), followed by 3 product highlights lifted from the script's key arguments, closing with a CTA. Keep each element terse and visual-ready. ~45 words total.`,

    'social-proof': `

STYLE INTENT — SOCIAL PROOF:
Shape the output as: a testimonial-style quote that paraphrases THIS script's main promise as if a real customer said it, followed by a customer name (invent a realistic one if the script doesn't name anyone), the script's key benefit as a short headline, and a star rating line (★★★★★). The quote must reflect the script's actual argument, not a generic "great product, highly recommend".`,

    'comparison': `

STYLE INTENT — COMPARISON:
Shape the output as: two option names (A = without the product / competitor / old way; B = the product from the script), followed by 3 comparison points lifted from the script. Mark each point with ✓ (for B) or ✗ (for A). The differences must come from the script, not generic "faster / cheaper / better" contrasts.`,

    'before-after': `

STYLE INTENT — BEFORE / AFTER:
Shape the output as: a "Before" line (problem/pain from the script's hook), an "After" line (transformation/result from the script), a specific metric or proof point from the script (percentage, time, measurable result), and a closing headline that captures the promise.`,

    'collage': `

STYLE INTENT — COLLAGE:
Shape the output as: a main headline (from the script's hook), 3-4 panel captions each representing a different key point from the script's development, and a CTA. Panels should feel like distinct moments/angles of the same product story.`,

    'deals-discounts': `

STYLE INTENT — DEALS & DISCOUNTS:
Shape the output as: the offer amount (e.g. "30% OFF", "$10 OFF", "2x1" — lift from the script if mentioned, otherwise pick a believable one), the product/offer name, an urgency phrase from the script's CTA (e.g. "hasta agotar stock", "solo hoy"), and a short CTA button text.`,

    'testimonial': `

STYLE INTENT — TESTIMONIAL:
Shape the output as: a customer quote that distills THIS script's main argument in a real-person voice (not marketing-speak), followed by a realistic customer name, a short tagline capturing the key benefit, and a star rating line (★★★★★). The quote must sound like a genuine user reflecting the script's specific claims, not a generic endorsement.`,
  }

  // Default generic condensation for custom types, organic, etc.
  const defaultStyleRules = `

STYLE INTENT — GENERAL:
Distill the script into ~40-60 words, preserving its unique angle:
- Open with the script's hook idea (condensed, keeping its specific phrasing).
- Include the 2-3 strongest, most specific arguments or proof points from the development.
- End with the script's CTA (keep any urgency/incentive).
Short lines, separated by breaks. Specificity over genericness.`

  return baseRules + contextBlock + (styleRules[postStyle] || defaultStyleRules)
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
    const { script, postStyle = 'venta-directa', language = 'es', productContext } = req.body

    if (!script || typeof script !== 'string' || script.trim().length === 0) {
      return res.status(400).json({ error: 'Script text is required' })
    }

    const xaiApiKey = process.env.GROK_API_KEY
    if (!xaiApiKey) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    // Sanitize productContext: only accept known string fields, trim, cap length
    const safeContext: ProductContext | undefined = productContext && typeof productContext === 'object'
      ? {
          name: typeof productContext.name === 'string' ? productContext.name.trim().slice(0, 200) : undefined,
          description: typeof productContext.description === 'string' ? productContext.description.trim().slice(0, 800) : undefined,
          niche: typeof productContext.niche === 'string' ? productContext.niche.trim().slice(0, 200) : undefined,
          differentiation: typeof productContext.differentiation === 'string' ? productContext.differentiation.trim().slice(0, 400) : undefined,
        }
      : undefined

    const systemPrompt = getSystemPrompt(postStyle, language, safeContext)

    const response = await fetch(XAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiApiKey}`
      },
      body: JSON.stringify({
        model: 'grok-4-fast-non-reasoning',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: script.trim() }
        ],
        temperature: 0.85,
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
      model: 'grok-4-fast-non-reasoning',
      inputTokens,
      outputTokens,
      success: true,
      metadata: { action: 'streamline_script', postStyle, language, hasProductContext: !!safeContext }
    })

    return res.status(200).json({ streamlined })

  } catch (error) {
    console.error('Streamline script error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'prompt_condense',
      model: 'grok-4-fast-non-reasoning',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
