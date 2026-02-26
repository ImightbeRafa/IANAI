import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions'

// Post-type-aware condensation rules
function getSystemPrompt(postStyle: string, language: string): string {
  const lang = language === 'en' ? 'English' : 'Spanish'

  const baseRules = `You are a senior copywriter specializing in condensing advertising scripts for social media image posts.
The user will give you a full script that follows a persuasion structure (Hook → Development → CTA).

YOUR JOB: Distill it into short, punchy image copy — BUT you MUST preserve the script's core persuasion arc:
1. THE HOOK — the attention-grabbing opening idea. Keep its essence; don't genericize it.
2. THE KEY ARGUMENT — the unique selling point, differentiator, or proof from the development section. This is the "why buy" — never lose it.
3. THE CTA — the closing push to action. Keep the urgency/incentive if present.

CRITICAL RULES:
- Output ONLY the condensed text. No explanations, no labels, no markdown, no commentary.
- Keep the SAME language as the input (${lang}). Do NOT translate.
- Condense ≠ rewrite from scratch. The output must feel like a distilled version of THIS specific script, not a generic ad.
- Remove filler, transitions, repetition, and verbose phrasing — but KEEP specific claims, numbers, product names, and unique angles.
- If the script mentions a specific benefit, stat, or differentiator, it MUST appear in the output.
- The result should read as a coherent mini-pitch, not disconnected fragments.
- Output must be ready to paste directly into an image generation prompt.`

  const styleRules: Record<string, string> = {
    'venta-directa': `

OUTPUT FORMAT:
Line 1: Hook headline — the script's opening idea condensed into one punchy line (max 10 words)
Lines 2-4: 3 key selling points from the script's development — each a short, specific claim (max 6 words each). Use the script's own arguments, not generic benefits.
Line 5: CTA — the script's call to action, condensed (max 5 words). Keep any urgency/offer.

Separate each element with a line break. Nothing else.`,

    'features-benefits': `

OUTPUT FORMAT:
Line 1: Product name or hook headline from the script (max 8 words)
Lines 2-5: 3-4 feature→benefit labels extracted from the script's development (3-4 words each). Each should be a SPECIFIC feature or benefit mentioned in the script, not invented.

Separate each element with a line break. Nothing else.`,

    'product-showcase': `

OUTPUT FORMAT:
Line 1: The script's hook idea as a bold headline (max 10 words)
Lines 2-4: 3 product highlights from the script's key arguments (max 5 words each)
Line 5: CTA from the script (max 4 words)

Separate each element with a line break. Nothing else.`,

    'social-proof': `

OUTPUT FORMAT:
Line 1: A testimonial-style quote that captures the script's main promise (max 18 words) — paraphrase the script's hook/development as if a customer said it
Line 2: Customer name (can be invented if not in script)
Line 3: The script's key benefit as a headline (max 8 words)
Line 4: Star rating (e.g. ★★★★★)

Separate each element with a line break. Nothing else.`,

    'comparison': `

OUTPUT FORMAT:
Line 1: Option A name — the "without" or competitor (max 4 words)
Line 2: Option B name — the product/solution from the script (max 4 words)
Lines 3-8: 3 comparison points extracted from the script's arguments, each with ✓ or ✗ (max 5 words each)

Separate each element with a line break. Nothing else.`,

    'before-after': `

OUTPUT FORMAT:
Line 1: "Before" — the problem/pain from the script's hook (max 8 words)
Line 2: "After" — the transformation/result from the script's development (max 8 words)
Line 3: Key metric or proof from the script (e.g. percentage, time saved, specific result)
Line 4: Headline that captures the script's core promise (max 10 words)

Separate each element with a line break. Nothing else.`,

    'collage': `

OUTPUT FORMAT:
Line 1: Main headline from the script's hook (max 10 words)
Lines 2-5: 3-4 panel captions — each one a key point from the script's development (max 6 words each)
Line 6: CTA from the script (max 4 words)

Separate each element with a line break. Nothing else.`,

    'deals-discounts': `

OUTPUT FORMAT:
Line 1: Discount/offer amount from the script (e.g. "30% OFF", "$10 OFF", "2x1")
Line 2: Product/offer name (max 6 words)
Line 3: Urgency phrase from the script's CTA (max 6 words)
Line 4: CTA button text (max 4 words)

Separate each element with a line break. Nothing else.`,

    'testimonial': `

OUTPUT FORMAT:
Line 1: Testimonial quote — distill the script's main argument as if a real customer said it (max 22 words)
Line 2: Customer name (use from script or invent a realistic one)
Line 3: The script's key benefit as a short tagline (max 6 words)
Line 4: Star rating (e.g. ★★★★★)

Separate each element with a line break. Nothing else.`,
  }

  // Default generic condensation for custom types, organic, etc.
  const defaultStyleRules = `

OUTPUT FORMAT:
Distill the script into max 60 words total, preserving its persuasion arc:
- Start with the hook idea (condensed)
- Include the 2-3 strongest arguments or proof points from the development
- End with the CTA
Remove filler and repetition, but keep specific claims, numbers, and the script's unique angle.
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

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'prompt_condense',
      model: 'grok-3-fast',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
