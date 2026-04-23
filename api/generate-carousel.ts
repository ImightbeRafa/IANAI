// =============================================
// POST /api/generate-carousel
// Organic carousel (2–10 slides) generator.
// Flow:
//   1. Grok plans slide content (role + headline + body + note) from user script/idea.
//   2. Gemini generates slide 1 (establishes visual language).
//   3. Gemini generates slides 2..N in parallel, each with slide 1 inlineData as a
//      style anchor — uses nano-banana's documented "character & style consistency"
//      strength to keep the carousel visually coherent without fine-tuning.
//   4. Returns { carouselGroupId, subtype, totalSlides, slides[], plan }.
//   The frontend is responsible for persisting the slides as linked `posts` rows.
// =============================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage, deductBonusImage } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { GoogleGenAI } from '@google/genai'
import { resolveBrandKit, buildBrandColorOverride, buildBrandVisualPrompt, buildBrandLogoPrompt, fetchBrandLogoAsBase64 } from './lib/brand-kit.js'
import {
  buildOrganicCarouselPrompt,
  type OrganicAspectRatio,
  type OrganicCarouselSubtype,
  type SlideRole,
  type CarouselSlidePlan,
} from './data/organic-post-prompts.js'
import type { CTAStrength } from './data/organic-script-prompts.js'

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'
const GEMINI_IMAGE_MODEL = 'gemini-3-pro-image-preview'
const GEMINI_CAROUSEL_SLIDE_TIMEOUT_MS = 120_000

const VALID_SUBTYPES: OrganicCarouselSubtype[] = ['educational-list', 'how-to-steps', 'before-after', 'myth-vs-fact']
const VALID_ASPECT_RATIOS: OrganicAspectRatio[] = ['1:1', '4:5', '9:16', '3:4']
const VALID_CTA: CTAStrength[] = ['none', 'soft', 'brand_mention', 'sales']

class UpstreamTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out after ${Math.round(GEMINI_CAROUSEL_SLIDE_TIMEOUT_MS / 1000)} seconds`)
    this.name = 'UpstreamTimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new UpstreamTimeoutError(label)), GEMINI_CAROUSEL_SLIDE_TIMEOUT_MS)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

interface CarouselRequestBody {
  productId: string
  subtype: OrganicCarouselSubtype
  slideCount: number
  scriptContent: string // user's script, idea, or raw text to turn into a carousel
  aspectRatio: OrganicAspectRatio
  language: 'en' | 'es'
  brandKitId?: string
  ctaStrength?: CTAStrength
  hasProductImages?: boolean // currently unused — product refs can be added later
}

// =============================================
// SLIDE PLANNING (via Grok)
// Produces a structured plan: [{ index, role, headline, body?, note? }, ...]
// =============================================
async function planCarouselSlides(opts: {
  grokApiKey: string
  subtype: OrganicCarouselSubtype
  slideCount: number
  scriptContent: string
  language: 'en' | 'es'
  brandName?: string | null
}): Promise<CarouselSlidePlan[]> {
  const { grokApiKey, subtype, slideCount, scriptContent, language, brandName } = opts
  const isEs = language === 'es'

  const subtypeGuide: Record<OrganicCarouselSubtype, string> = {
    'educational-list': isEs
      ? `Carrusel de LISTA EDUCATIVA. Slide 1 = gancho con número en el headline ("N cosas que..."). Slides 2..${slideCount - 1} = un punto cada uno (headline corto + 1–2 líneas de cuerpo). Slide ${slideCount} = síntesis + CTA suave.`
      : `EDUCATIONAL LIST carousel. Slide 1 = hook with number in the headline ("N things that..."). Slides 2..${slideCount - 1} = one point each (short headline + 1–2 lines of body). Slide ${slideCount} = synthesis + soft CTA.`,
    'how-to-steps': isEs
      ? `Carrusel HOW-TO. Slide 1 = problema o promesa. Slides 2..${slideCount - 1} = un paso cada uno, con verbo de acción. Slide ${slideCount} = resultado + CTA suave.`
      : `HOW-TO carousel. Slide 1 = problem or promise. Slides 2..${slideCount - 1} = one step each, with action verb. Slide ${slideCount} = result + soft CTA.`,
    'before-after': isEs
      ? `Carrusel ANTES/DESPUÉS. Slide 1 = ANTES (problema). Slide intermedio opcional = transición. Slide final - 1 = DESPUÉS (solución). Slide final = CTA. Ajustá a ${slideCount} slides manteniendo este arco.`
      : `BEFORE/AFTER carousel. Slide 1 = BEFORE (problem). Optional middle = transition. Second-to-last = AFTER (solution). Last = CTA. Fit to ${slideCount} slides keeping this arc.`,
    'myth-vs-fact': isEs
      ? `Carrusel MITO vs REALIDAD. Slide 1 = hook. Slides intermedios = pares mito/realidad (un par por slide, o separados según cantidad). Slide final = takeaway + CTA suave.`
      : `MYTH vs FACT carousel. Slide 1 = hook. Middle slides = myth/fact pairs (one pair per slide, or split by count). Last slide = takeaway + soft CTA.`,
  }

  const systemPrompt = isEs
    ? `Sos un director creativo experto en carousels orgánicos de Instagram.
Devolvés SOLO JSON válido (sin explicaciones, sin markdown, sin texto extra antes o después).
El JSON debe ser un array de ${slideCount} objetos con esta forma:
[{"index": 1, "role": "hook"|"body"|"cta"|"recap", "headline": "string corto", "body": "string 1-2 líneas opcional", "note": "string opcional"}]

Reglas:
- Exactamente ${slideCount} elementos. index va de 1 a ${slideCount}.
- Slide 1 SIEMPRE tiene role="hook".
- Slide ${slideCount} tiene role="cta" o "recap" según corresponda.
- Slides intermedios tienen role="body".
- Los headlines son cortos y punchy (máximo 8 palabras).
- body es opcional, 1-2 líneas concretas.
- note es opcional y contiene instrucciones de diseño (ej: "myth side", "after state").
- Idioma: ESPAÑOL.`
    : `You are a creative director expert in organic Instagram carousels.
Return ONLY valid JSON (no explanations, no markdown, no extra text before or after).
The JSON must be an array of ${slideCount} objects in this shape:
[{"index": 1, "role": "hook"|"body"|"cta"|"recap", "headline": "short string", "body": "optional 1-2 line string", "note": "optional string"}]

Rules:
- Exactly ${slideCount} elements. index goes 1 to ${slideCount}.
- Slide 1 ALWAYS has role="hook".
- Slide ${slideCount} has role="cta" or "recap" as appropriate.
- Middle slides have role="body".
- Headlines are short and punchy (max 8 words).
- body is optional, 1-2 concrete lines.
- note is optional and contains design directives (e.g. "myth side", "after state").
- Language: ENGLISH.`

  const userPrompt = isEs
    ? `Contexto de la marca: ${brandName || '(sin nombre)'}\n
Tipo de carousel: ${subtype}\n
Guía estructural del subtipo:\n${subtypeGuide[subtype]}\n
Cantidad de slides: ${slideCount}\n
\nIDEA / GUIÓN FUENTE del usuario:\n"""\n${scriptContent.slice(0, 3000)}\n"""\n
\nDevolvé SOLO el array JSON con ${slideCount} slides. Nada más.`
    : `Brand context: ${brandName || '(no name)'}\n
Carousel type: ${subtype}\n
Subtype structural guide:\n${subtypeGuide[subtype]}\n
Slide count: ${slideCount}\n
\nUSER'S SOURCE IDEA / SCRIPT:\n"""\n${scriptContent.slice(0, 3000)}\n"""\n
\nReturn ONLY the JSON array with ${slideCount} slides. Nothing else.`

  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${grokApiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-4-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Grok planning failed (${response.status}): ${text.slice(0, 300)}`)
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content ?? ''
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Try to extract the first JSON array from the text
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('Slide planner did not return valid JSON')
    parsed = JSON.parse(match[0])
  }
  if (!Array.isArray(parsed)) throw new Error('Slide planner did not return an array')

  const validRoles: SlideRole[] = ['hook', 'body', 'cta', 'recap']
  const normalized: CarouselSlidePlan[] = []
  for (let i = 0; i < slideCount; i++) {
    const raw = parsed[i] as Partial<CarouselSlidePlan> | undefined
    const fallbackRole: SlideRole = i === 0 ? 'hook' : i === slideCount - 1 ? 'cta' : 'body'
    const role: SlideRole = raw && typeof raw.role === 'string' && (validRoles as string[]).includes(raw.role)
      ? (raw.role as SlideRole) : fallbackRole
    normalized.push({
      index: i + 1,
      role,
      headline: raw?.headline?.toString().slice(0, 160) || (isEs ? `Slide ${i + 1}` : `Slide ${i + 1}`),
      body: raw?.body?.toString().slice(0, 400) || undefined,
      note: raw?.note?.toString().slice(0, 200) || undefined,
    })
  }
  return normalized
}

// =============================================
// SLIDE RENDER (via Gemini)
// Generates ONE slide's image. Optionally accepts the slide-1 reference image for style anchoring.
// =============================================
async function renderCarouselSlide(opts: {
  geminiApiKey: string
  aspectRatio: OrganicAspectRatio
  subtype: OrganicCarouselSubtype
  slide: CarouselSlidePlan
  totalSlides: number
  language: 'en' | 'es'
  hasProductImages: boolean
  brandVoice: string | null | undefined
  ctaStrength: CTAStrength
  scriptContext: string
  referenceSlide1?: { mimeType: string; data: string } | null
  prefixes: { color: string; brandVisual: string; brandLogo: string; logoInline: { mimeType: string; data: string } | null }
}): Promise<{ imageUrl: string; usage: { input: number; output: number; thinking: number } }> {
  const {
    geminiApiKey, aspectRatio, subtype, slide, totalSlides, language,
    hasProductImages, brandVoice, ctaStrength, scriptContext, referenceSlide1, prefixes,
  } = opts

  const ai = new GoogleGenAI({ apiKey: geminiApiKey })

  const basePrompt = buildOrganicCarouselPrompt({
    subtype,
    slideIndex: slide.index,
    totalSlides,
    slideRole: slide.role,
    slideContent: { headline: slide.headline, body: slide.body, note: slide.note },
    scriptContext,
    aspectRatio,
    language,
    hasProductImages,
    brandVoice,
    ctaStrength,
    hasReferenceSlide: !!referenceSlide1,
  })

  const fullPromptText = prefixes.color + prefixes.brandVisual + prefixes.brandLogo + basePrompt

  type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } }
  const parts: PromptPart[] = [{ text: fullPromptText }]

  // Inject brand logo FIRST so Gemini prioritizes it (same convention as generate-image.ts).
  if (prefixes.logoInline) {
    parts.push({ text: `══ LOGO OFICIAL DE LA MARCA (NO NEGOCIABLE) ══\nIncluí este logo EXACTO en el slide si el subtipo lo contempla. NO lo rediseñes ni cambies sus proporciones.` })
    parts.push({ inlineData: prefixes.logoInline })
  }

  // Slide-1 reference for consistency
  if (referenceSlide1) {
    parts.push({ text: language === 'es'
      ? `REFERENCIA VISUAL DEL CARRUSEL (slide 1): copiá el mismo sistema visual — tipografía, paleta, grid, jerarquía, estilo — y cambiá solo el contenido textual.`
      : `CAROUSEL VISUAL REFERENCE (slide 1): copy the same visual system — typography, palette, grid, hierarchy, style — and only change the textual content.` })
    parts.push({ inlineData: referenceSlide1 })
  }

  const geminiAspectRatio: '1:1' | '4:5' | '9:16' | '3:4' = aspectRatio
  const response = await withTimeout(ai.models.generateContent({
    model: GEMINI_IMAGE_MODEL,
    contents: parts,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: geminiAspectRatio, imageSize: '2K' },
    },
  }), `Gemini carousel slide ${slide.index}`)

  const candidates = response.candidates || []
  const responseParts = candidates[0]?.content?.parts || []
  let imageUrl: string | null = null
  for (const p of responseParts) {
    if ('inlineData' in p && p.inlineData?.data) {
      const mt = p.inlineData.mimeType || 'image/png'
      imageUrl = `data:${mt};base64,${p.inlineData.data}`
      break
    }
  }
  if (!imageUrl) throw new Error(`Gemini returned no image for slide ${slide.index}`)

  const u = response.usageMetadata
  return {
    imageUrl,
    usage: {
      input: u?.promptTokenCount || 0,
      output: u?.candidatesTokenCount || 0,
      thinking: u?.thoughtsTokenCount || 0,
    },
  }
}

// =============================================
// HANDLER
// =============================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const user = await requireAuth(req, res)
    if (!user) return // requireAuth already sent the response

    // Rate limit (shared generation bucket, defaults are fine for carousels since each call renders N slides)
    const rateLimit = checkRateLimit(user.id)
    if (!rateLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' })
    }

    const body = (req.body || {}) as Partial<CarouselRequestBody>

    // Validation
    const subtype = body.subtype
    if (!subtype || !(VALID_SUBTYPES as string[]).includes(subtype)) {
      return res.status(400).json({ error: 'Invalid or missing subtype. Allowed: ' + VALID_SUBTYPES.join(', ') })
    }
    const slideCount = Math.floor(Number(body.slideCount))
    if (!Number.isFinite(slideCount) || slideCount < 2 || slideCount > 10) {
      return res.status(400).json({ error: 'slideCount must be an integer between 2 and 10.' })
    }
    const scriptContent = typeof body.scriptContent === 'string' ? body.scriptContent.trim() : ''
    if (!scriptContent) {
      return res.status(400).json({ error: 'scriptContent is required.' })
    }
    const aspectRatio: OrganicAspectRatio = VALID_ASPECT_RATIOS.includes(body.aspectRatio as OrganicAspectRatio)
      ? (body.aspectRatio as OrganicAspectRatio) : '1:1'
    const language: 'en' | 'es' = body.language === 'en' ? 'en' : 'es'
    const ctaStrength: CTAStrength = VALID_CTA.includes(body.ctaStrength as CTAStrength)
      ? (body.ctaStrength as CTAStrength) : 'soft'

    // Upfront usage check: carousel requires slideCount generations.
    const usage = await checkUsageLimit(user.id, 'image')
    if (!usage.allowed) {
      return res.status(429).json({ error: 'Image limit reached. Upgrade for more.', limit: usage.limit, remaining: usage.remaining })
    }
    if (usage.remaining !== -1 && usage.remaining < slideCount) {
      return res.status(429).json({
        error: `A ${slideCount}-slide carousel requires ${slideCount} image credits, but you only have ${usage.remaining} remaining.`,
        limit: usage.limit,
        remaining: usage.remaining,
        required: slideCount,
      })
    }

    // API keys
    const grokApiKey = process.env.GROK_API_KEY
    if (!grokApiKey) return res.status(500).json({ error: 'Grok API key not configured' })
    const geminiApiKey = process.env.GEMINI_API_KEY
    if (!geminiApiKey) return res.status(500).json({ error: 'Gemini API key not configured' })

    // Brand kit
    let brandKit: Awaited<ReturnType<typeof resolveBrandKit>> = null
    try { brandKit = await resolveBrandKit(user.id, body.brandKitId) } catch { /* ignore */ }

    // 1. PLAN
    const plan = await planCarouselSlides({
      grokApiKey,
      subtype,
      slideCount,
      scriptContent,
      language,
      brandName: brandKit?.name,
    })

    // Build shared prefixes (color palette override, brand visual prompt, brand logo prompt).
    const colorPrefix = brandKit ? (buildBrandColorOverride(brandKit) || '') : ''
    const brandVisualPrefix = brandKit ? (buildBrandVisualPrompt(brandKit) || '') : ''
    const brandLogoPrefix = brandKit ? (buildBrandLogoPrompt(brandKit) || '') : ''

    // Brand logo inline data (only for slides that might render it — mostly CTA slide, but safe to attach always).
    let logoInline: { mimeType: string; data: string } | null = null
    if (brandKit?.logo_url) {
      try {
        logoInline = await fetchBrandLogoAsBase64(brandKit)
      } catch { logoInline = null }
    }

    const sharedPrefixes = { color: colorPrefix, brandVisual: brandVisualPrefix, brandLogo: brandLogoPrefix, logoInline }
    const renderOptsBase = {
      geminiApiKey, aspectRatio, subtype, totalSlides: slideCount, language,
      hasProductImages: false, // carousels v1 don't accept product refs (can be added later)
      brandVoice: brandKit?.brand_voice ?? null,
      ctaStrength,
      scriptContext: scriptContent,
      prefixes: sharedPrefixes,
    } as const

    // 2. RENDER SLIDE 1
    const slide1 = await renderCarouselSlide({ ...renderOptsBase, slide: plan[0], referenceSlide1: null })

    // Extract slide-1 inline data (strip the "data:mime;base64," prefix) so it can be passed as reference.
    const slide1DataMatch = slide1.imageUrl.match(/^data:([^;]+);base64,(.+)$/)
    const slide1Reference = slide1DataMatch ? { mimeType: slide1DataMatch[1], data: slide1DataMatch[2] } : null

    // 3. RENDER SLIDES 2..N IN PARALLEL
    const restPromises = plan.slice(1).map(slide =>
      renderCarouselSlide({ ...renderOptsBase, slide, referenceSlide1: slide1Reference })
        .then(r => ({ slide, result: r, error: null as null | string }))
        .catch(err => ({ slide, result: null as null | { imageUrl: string; usage: { input: number; output: number; thinking: number } }, error: (err as Error).message }))
    )
    const restResults = await Promise.all(restPromises)

    // Assemble results
    const slides = [
      { index: 1, role: plan[0].role, headline: plan[0].headline, body: plan[0].body, note: plan[0].note, imageUrl: slide1.imageUrl, error: null as string | null },
      ...restResults.map(r => ({
        index: r.slide.index,
        role: r.slide.role,
        headline: r.slide.headline,
        body: r.slide.body,
        note: r.slide.note,
        imageUrl: r.result?.imageUrl ?? null,
        error: r.error,
      })),
    ]

    // 4. USAGE + LOGGING
    const succeeded = slides.filter(s => !!s.imageUrl).length
    // Charge only for succeeded slides (fair-fail behavior).
    for (let i = 0; i < succeeded; i++) {
      try {
        await incrementUsage(user.id, 'image')
        await deductBonusImage(user.id)
      } catch (e) { console.warn('increment usage failed on slide', i, e) }
    }

    // Token accounting (rough — sum of all slides)
    const totalInput = slide1.usage.input + restResults.reduce((s, r) => s + (r.result?.usage.input ?? 0), 0)
    const totalOutput = slide1.usage.output + restResults.reduce((s, r) => s + (r.result?.usage.output ?? 0), 0)
    const totalThinking = slide1.usage.thinking + restResults.reduce((s, r) => s + (r.result?.usage.thinking ?? 0), 0)

    await logApiUsage({
      userId: user.id,
      feature: 'image',
      model: 'nano-banana-pro',
      success: succeeded > 0,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      thinkingTokens: totalThinking,
      metadata: {
        kind: 'organic-carousel',
        subtype,
        slideCount,
        succeeded,
        aspectRatio,
        brandKitId: brandKit?.id,
        brandKitName: brandKit?.name,
      },
    })

    // Generate a pseudo carousel_group_id — the client can accept this or generate its own.
    const carouselGroupId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)

    return res.status(200).json({
      carouselGroupId,
      subtype,
      totalSlides: slideCount,
      aspectRatio,
      language,
      ctaStrength,
      plan,
      slides,
      usage: { charged: succeeded, total: slideCount },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Carousel generation failed'
    console.error('generate-carousel error:', err)
    return res.status(500).json({ error: message })
  }
}
