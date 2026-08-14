import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { GROK_API_URL, GROK_TEXT_MODEL } from './lib/grok-models.js'

// Product context sent from the frontend to anchor the output to THIS specific product
interface ProductContext {
  name?: string
  description?: string
  niche?: string
  differentiation?: string
}

type TextDensity = 'hard' | 'medium' | 'standard'

const DENSITY_CONFIG: Record<TextDensity, {
  label: string
  targetWords: string
  maxWords: number
  maxTokens: number
  temperature: number
  lineRule: string
  detailRule: string
  directSaleShape: string
  featureCount: string
}> = {
  hard: {
    label: 'HARD / SHORTEST',
    targetWords: '18-30',
    maxWords: 36,
    maxTokens: 130,
    temperature: 0.65,
    lineRule: 'Use 3-4 very short lines total. No line should exceed 8 words.',
    detailRule: 'Keep only the hook idea, the single strongest proof/benefit, and the shortest possible CTA. Drop almost everything else.',
    directSaleShape: 'a hook headline, 1-2 ultra-specific selling points, and a CTA',
    featureCount: '2'
  },
  medium: {
    label: 'MEDIUM / TIGHT SWEET SPOT',
    targetWords: '28-45',
    maxWords: 52,
    maxTokens: 190,
    temperature: 0.75,
    lineRule: 'Use 4-6 short lines total. No line should exceed 10 words.',
    detailRule: 'Keep the core angle and the 2 most distinctive claims. Cut supporting explanations and repeated proof.',
    directSaleShape: 'a hook headline, 2-3 specific selling points, and a CTA',
    featureCount: '2-3'
  },
  standard: {
    label: 'STANDARD / CURRENT FULLER VERSION',
    targetWords: '40-60',
    maxWords: 70,
    maxTokens: 300,
    temperature: 0.85,
    lineRule: 'Use short lines separated by line breaks. Natural, readable, easy to scan.',
    detailRule: 'Keep the script core angle and the 1-2 most distinctive claims. Drop everything else.',
    directSaleShape: 'a hook headline, 3 key selling points, and a CTA',
    featureCount: '3-4'
  }
}

function normalizeTextDensity(value: unknown): TextDensity {
  return value === 'hard' || value === 'medium' || value === 'standard' ? value : 'medium'
}

function highlightsFor(textDensity: TextDensity): string {
  if (textDensity === 'hard') return '1-2'
  if (textDensity === 'medium') return '2'
  return '3'
}

function comparisonPointsFor(textDensity: TextDensity): string {
  if (textDensity === 'hard') return '1-2'
  if (textDensity === 'medium') return '2'
  return '3'
}

function proofCountFor(textDensity: TextDensity): string {
  if (textDensity === 'hard') return 'the single strongest'
  if (textDensity === 'medium') return 'the 2 strongest'
  return 'the 2-3 strongest'
}

// Post-type-aware condensation rules
function getSystemPrompt(
  postStyle: string,
  language: string,
  productContext?: ProductContext,
  textDensity: TextDensity = 'medium'
): string {
  const lang = language === 'en' ? 'English' : 'Spanish'
  const density = DENSITY_CONFIG[textDensity]

  const baseRules = `You are a senior copywriter adapting long advertising scripts into short, punchy post copy.

YOUR JOB: The input is a full advertising script, typically 150 to 500+ words of persuasion copy. Your job is to extract its CORE IDEA and ADAPT it into concise post copy that still keeps the script's three-beat structure: GANCHO (hook) → DESARROLLO (1-2 proof lines) → CIERRE (CTA). You are NOT copying the script sentence by sentence. You ARE keeping that structure with far fewer words.

SIZE CONTRACT (HARD LIMIT):
- TEXT DENSITY MODE: ${density.label}.
- Output MUST be significantly shorter than the input. Target ${density.targetWords} words total. Absolute maximum: ${density.maxWords} words.
- If your output is longer than 25% of the input's word count, you have failed.
- The input is a SCRIPT (spoken/read at length). The output is POST COPY (scanned in 2 seconds).
- ${density.lineRule}
- ${density.detailRule}
- Delete unresolved placeholders such as [TIEMPO DE ENTREGA], [PRECIO], or any [BRACKET TOKEN]. Omit unknown facts. Never invent them. Never leave brackets in the output.

TONE PRESERVATION (CRITICAL):
- Match the script's voice and register EXACTLY. If the script is casual, stay casual. If it is urgent, stay urgent. If it is witty, stay witty. If it is warm, stay warm. If it is direct/aggressive, stay direct/aggressive. If it is educational, stay educational.
- The reader should feel the SAME brand is speaking, just in far fewer words.
- Do NOT flatten the tone into generic "marketing voice". Do NOT make a casual script sound corporate, or a witty script sound dry.

IDEA OVER WORDING:
- Keep the script's CORE ANGLE (what makes this script compelling) and the 1-2 MOST distinctive claims. Drop everything else.
- Do NOT try to include every specific claim, feature, or number from the script. Pick the strongest 1-2 and let the rest go.
- The output is not a shortened copy of the script. It is the script's IDEA rewritten as post copy.

SPECIFICITY:
- The output must clearly be about the script's specific product/offer, not interchangeable category copy. Reference the product's actual angle, not generic benefits like "better quality" or "save time".
- You do NOT need to preserve specific claims verbatim. Reword freely to fit the shorter format.

OUTPUT FORMAT:
- Output ONLY the adapted post copy. No explanations, no labels, no markdown, no headers, no commentary, no quotation marks around the whole thing.
- Keep the SAME language as the input (${lang}). Do NOT translate.
- ${density.lineRule}`

  const contextBlock = productContext && (productContext.name || productContext.description || productContext.niche)
    ? `

PRODUCT CONTEXT (anchor the output on THIS product; do not drift into generic category copy):
${productContext.name ? `- Product: ${productContext.name}` : ''}
${productContext.niche ? `- Niche / category: ${productContext.niche}` : ''}
${productContext.description ? `- Description: ${productContext.description}` : ''}
${productContext.differentiation ? `- Differentiation: ${productContext.differentiation}` : ''}`
    : ''

  // Style-specific intent: shape + purpose, with text-density-aware limits.
  const styleRules: Record<string, string> = {
    'venta-directa': `

STYLE INTENT - VENTA DIRECTA (direct-sale ad):
Shape the output as: ${density.directSaleShape} pulled from THIS script's development. Each element on its own line. Every selling point must be script-specific, not generic benefits like "better quality" or "save time".`,

    'features-benefits': `

STYLE INTENT - FEATURES & BENEFITS:
Shape the output as: a headline with the product name or hook, followed by ${density.featureCount} feature-to-benefit pairs lifted from the script. Each pair should be short enough to fit as a label on an image. Every feature must come from the script, not invented.`,

    'product-showcase': `

STYLE INTENT - PRODUCT SHOWCASE:
Shape the output as: a bold headline (hook from the script), followed by ${highlightsFor(textDensity)} product highlights lifted from the script's key arguments, closing with a CTA. Keep each element terse and visual-ready.`,

    'social-proof': `

STYLE INTENT - SOCIAL PROOF:
Shape the output as: a testimonial-style quote that paraphrases THIS script's main promise as if a real customer said it, followed by a customer name and a star rating line (*****). Keep the quote ${textDensity === 'standard' ? 'specific and concise' : 'to one short sentence'}. The quote must reflect the script's actual argument, not a generic endorsement.`,

    'comparison': `

STYLE INTENT - COMPARISON:
Shape the output as: two option names (A = without the product / competitor / old way; B = the product from the script), followed by ${comparisonPointsFor(textDensity)} comparison points lifted from the script. The differences must come from the script, not generic "faster / cheaper / better" contrasts.`,

    'before-after': `

STYLE INTENT - BEFORE / AFTER:
Shape the output as: a "Before" line, an "After" line, ${textDensity === 'hard' ? 'and' : 'one proof point if available, plus'} a closing promise. Keep every line short enough to be read at a glance.`,

    'collage': `

STYLE INTENT - COLLAGE:
Shape the output as: a main headline, ${density.featureCount} panel captions representing distinct key points from the script, and a CTA. Panels should feel like distinct moments/angles of the same product story.`,

    'deals-discounts': `

STYLE INTENT - DEALS & DISCOUNTS:
Shape the output as: the offer amount (e.g. "30% OFF", "$10 OFF", "2x1" - lift from the script if mentioned, otherwise pick a believable one), the product/offer name, an urgency phrase from the script's CTA (e.g. "hasta agotar stock", "solo hoy"), and a short CTA button text.`,

    'testimonial': `

STYLE INTENT - TESTIMONIAL:
Shape the output as: a customer quote that distills THIS script's main argument in a real-person voice (not marketing-speak), followed by a realistic customer name and a star rating line (*****). Keep the quote ${textDensity === 'standard' ? 'specific and concise' : 'to one short sentence'}.`,
  }

  // Default generic condensation for custom types, organic, etc.
  const defaultStyleRules = `

STYLE INTENT - GENERAL:
Distill the script into ${density.targetWords} words, preserving its unique angle:
- Open with the script's hook idea (condensed, keeping its specific phrasing).
- Include ${proofCountFor(textDensity)} specific arguments or proof points from the development.
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
    const textDensity = normalizeTextDensity(req.body?.textDensity)

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

    const densityConfig = DENSITY_CONFIG[textDensity]
    const systemPrompt = getSystemPrompt(postStyle, language, safeContext, textDensity)

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

    // Log usage
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
