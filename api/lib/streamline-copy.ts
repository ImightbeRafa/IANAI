export interface StreamlineProductContext {
  name?: string
  description?: string
  niche?: string
  differentiation?: string
}

export type TextDensity = 'hard' | 'medium' | 'standard'

export const DENSITY_CONFIG: Record<TextDensity, {
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
    label: 'SHORT / READABLE BEATS',
    targetWords: '28-36',
    maxWords: 40,
    maxTokens: 120,
    temperature: 0.4,
    lineRule: 'Use exactly 4 readable lines: hook, benefit or problem, specific proof, CTA. Each line is a complete phrase, not a fragment. No line should exceed 12 words.',
    detailRule: 'Keep the hook understandable on its own, one development beat with a concrete proof or benefit, and a clear CTA. Do not collapse the script into telegraphic scraps.',
    directSaleShape: 'a hook line, one benefit/problem line, one specific proof line, and a CTA',
    featureCount: '1-2',
  },
  medium: {
    label: 'MEDIUM / TIGHT DEVELOPMENT',
    targetWords: '34-44',
    maxWords: 48,
    maxTokens: 145,
    temperature: 0.5,
    lineRule: 'Use 5-6 short lines: hook, 2-3 concise development lines, CTA. No extra paragraphs. No line should exceed 14 words.',
    detailRule: 'Keep the hook, a short desarrollo with 2-3 specific claims, and a CTA. Cut repetition and extra paragraphs, not the structure.',
    directSaleShape: 'a hook line, 2-3 concise development lines, and a CTA',
    featureCount: '2-3',
  },
  standard: {
    label: 'STANDARD / CURRENT FULLER VERSION',
    targetWords: '40-60',
    maxWords: 70,
    maxTokens: 220,
    temperature: 0.7,
    lineRule: 'Use short lines separated by line breaks. Natural, readable, easy to scan.',
    detailRule: 'Keep the script core angle and the 1-2 most distinctive claims. Drop everything else.',
    directSaleShape: 'a hook headline, 3 key selling points, and a CTA',
    featureCount: '3-4',
  },
}

export function normalizeTextDensity(value: unknown): TextDensity {
  return value === 'hard' || value === 'medium' || value === 'standard' ? value : 'medium'
}

function highlightsFor(textDensity: TextDensity): string {
  if (textDensity === 'hard') return '1'
  if (textDensity === 'medium') return '2-3'
  return '3'
}

function comparisonPointsFor(textDensity: TextDensity): string {
  if (textDensity === 'hard') return '1-2'
  if (textDensity === 'medium') return '2'
  return '3'
}

function proofCountFor(textDensity: TextDensity): string {
  if (textDensity === 'hard') return 'one specific'
  if (textDensity === 'medium') return 'the 2-3 strongest'
  return 'the 2-3 strongest'
}

export function getStreamlineSystemPrompt(
  postStyle: string,
  language: string,
  productContext?: StreamlineProductContext,
  textDensity: TextDensity = 'medium'
): string {
  const lang = language === 'en' ? 'English' : 'Spanish'
  const density = DENSITY_CONFIG[textDensity]

  const baseRules = `You are a senior copywriter adapting long advertising scripts into short, punchy post copy.

YOUR JOB: The input is a full advertising script, typically 150 to 500+ words of persuasion copy. Your job is to extract its CORE IDEA and ADAPT it into concise post copy that still keeps the script's three-beat structure: GANCHO (hook) → DESARROLLO (development) → CIERRE (CTA). You are NOT copying the script sentence by sentence. You ARE keeping that structure with far fewer words.

Each beat must stay independently understandable:
- GANCHO: a complete opening the reader can grasp without the rest.
- DESARROLLO: the proof, benefit, or problem the hook set up. Do not skip this beat.
- CTA: a complete closing action. Do not glue it onto the last proof line.

SIZE CONTRACT:
- TEXT DENSITY MODE: ${density.label}.
- Target ${density.targetWords} words total. Absolute maximum: ${density.maxWords} words.
- The input is a SCRIPT (spoken/read at length). The output is POST COPY (scanned quickly).
- ${density.lineRule}
- ${density.detailRule}
- Delete unresolved placeholders such as [TIEMPO DE ENTREGA], [PRECIO], or any [BRACKET TOKEN]. Omit unknown facts. Never invent them. Never leave brackets in the output.

TONE PRESERVATION (CRITICAL):
- Match the script's voice and register EXACTLY. If the script is casual, stay casual. If it is urgent, stay urgent. If it is witty, stay witty. If it is warm, stay warm. If it is direct/aggressive, stay direct/aggressive. If it is educational, stay educational.
- The reader should feel the SAME brand is speaking, just in far fewer words.
- Do NOT flatten the tone into generic "marketing voice". Do NOT make a casual script sound corporate, or a witty script sound dry.

IDEA OVER WORDING:
- Keep the script's CORE ANGLE (what makes this script compelling) and the most distinctive claims that still fit the beat structure.
- Do NOT try to include every specific claim, feature, or number from the script.
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

  const defaultStyleRules = `

STYLE INTENT - GENERAL:
Distill the script into ${density.targetWords} words, preserving its unique angle:
- Open with the script's hook idea (condensed, keeping its specific phrasing).
- Include ${proofCountFor(textDensity)} specific arguments or proof points from the development.
- End with the script's CTA (keep any urgency/incentive).
Short lines, separated by breaks. Specificity over genericness.`

  return baseRules + contextBlock + (styleRules[postStyle] || defaultStyleRules)
}
