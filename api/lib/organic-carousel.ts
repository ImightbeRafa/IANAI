/**
 * Shared organic carousel generate (Grok plan + Gemini Pro slides).
 * HTTP `/api/generate-carousel` and MCP `execute_carousel_generate` both call this.
 * Does not check credits or charge — callers do that per succeeded slide.
 */

import { GoogleGenAI } from '@google/genai'
import {
  resolveBrandKit,
  buildBrandColorOverride,
  buildBrandVisualPrompt,
  buildBrandLogoPrompt,
  fetchBrandLogoAsBase64,
} from './brand-kit.js'
import {
  buildOrganicCarouselPrompt,
  type OrganicAspectRatio,
  type OrganicCarouselSubtype,
  type SlideRole,
  type CarouselSlidePlan,
} from '../data/organic-post-prompts.js'
import type { CTAStrength } from '../data/organic-script-prompts.js'
import { GROK_API_URL, GROK_TEXT_MODEL_EFFICIENT } from './grok-models.js'
import { quoteCredits } from './credits/catalog.js'

export const GEMINI_CAROUSEL_IMAGE_MODEL = 'gemini-3-pro-image-preview'
export const GEMINI_CAROUSEL_SLIDE_TIMEOUT_MS = 120_000
/** MCP host maxDuration is 180s; the dedicated carousel API is 240s. */
export const MCP_HOST_MAX_DURATION_SEC = 180
export const CAROUSEL_API_MAX_DURATION_SEC = 240

export const VALID_CAROUSEL_SUBTYPES: OrganicCarouselSubtype[] = [
  'educational-list',
  'how-to-steps',
  'before-after',
  'myth-vs-fact',
]
export const VALID_CAROUSEL_ASPECT_RATIOS: OrganicAspectRatio[] = ['1:1', '4:5', '9:16', '3:4']
export const VALID_CAROUSEL_CTA: CTAStrength[] = ['none', 'soft', 'brand_mention', 'sales']

export type CarouselProductContext = {
  name?: string
  type?: string
  category?: string
  description?: string
  audience?: string
  differentiation?: string
  result?: string
  objection?: string
  logistics?: string
}

type InlineImage = { mimeType: string; data: string }

export type OrganicCarouselSlide = {
  index: number
  role: SlideRole
  headline: string
  body?: string
  note?: string
  imageUrl: string | null
  error: string | null
}

export type OrganicCarouselResult = {
  carouselGroupId: string
  subtype: OrganicCarouselSubtype
  totalSlides: number
  aspectRatio: OrganicAspectRatio
  language: 'en' | 'es'
  ctaStrength: CTAStrength
  plan: CarouselSlidePlan[]
  slides: OrganicCarouselSlide[]
  previewFirstSlideOnly: boolean
  succeeded: number
  requiredSlides: number
  usageTokens: { input: number; output: number; thinking: number }
}

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

export function quoteCarouselCredits(slideCount: number): number {
  return quoteCredits('carousel_slide_pro', slideCount)
}

export function normalizeCarouselSlideCount(raw: unknown): number {
  const slideCount = Math.floor(Number(raw))
  if (!Number.isFinite(slideCount) || slideCount < 2 || slideCount > 10) {
    throw new Error('slideCount must be an integer between 2 and 10')
  }
  return slideCount
}

export function normalizeCarouselSubtype(raw: unknown): OrganicCarouselSubtype {
  if (typeof raw === 'string' && (VALID_CAROUSEL_SUBTYPES as string[]).includes(raw)) {
    return raw as OrganicCarouselSubtype
  }
  throw new Error('Invalid or missing subtype. Allowed: ' + VALID_CAROUSEL_SUBTYPES.join(', '))
}

export function sanitizeCarouselText(value: unknown, maxLength = 700): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, maxLength) : undefined
}

export function sanitizeProductContext(raw: unknown): CarouselProductContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const context: CarouselProductContext = {
    name: sanitizeCarouselText(obj.name, 160),
    type: sanitizeCarouselText(obj.type, 120),
    category: sanitizeCarouselText(obj.category, 180),
    description: sanitizeCarouselText(obj.description, 700),
    audience: sanitizeCarouselText(obj.audience, 500),
    differentiation: sanitizeCarouselText(obj.differentiation, 500),
    result: sanitizeCarouselText(obj.result, 400),
    objection: sanitizeCarouselText(obj.objection, 400),
    logistics: sanitizeCarouselText(obj.logistics, 400),
  }
  return Object.values(context).some(Boolean) ? context : undefined
}

function productContextToText(context: CarouselProductContext | undefined, language: 'en' | 'es'): string {
  if (!context) return ''
  const isEs = language === 'es'
  const lines = [
    context.name ? (isEs ? `Producto/marca: ${context.name}` : `Product/brand: ${context.name}`) : '',
    context.type ? (isEs ? `Tipo: ${context.type}` : `Type: ${context.type}`) : '',
    context.category ? (isEs ? `Categoria: ${context.category}` : `Category: ${context.category}`) : '',
    context.description ? (isEs ? `Descripcion: ${context.description}` : `Description: ${context.description}`) : '',
    context.audience ? (isEs ? `Audiencia: ${context.audience}` : `Audience: ${context.audience}`) : '',
    context.differentiation ? (isEs ? `Diferencial: ${context.differentiation}` : `Differentiation: ${context.differentiation}`) : '',
    context.result ? (isEs ? `Resultado: ${context.result}` : `Result: ${context.result}`) : '',
    context.objection ? (isEs ? `Objecion clave: ${context.objection}` : `Key objection: ${context.objection}`) : '',
    context.logistics ? (isEs ? `Logistica/oferta: ${context.logistics}` : `Logistics/offer: ${context.logistics}`) : '',
  ].filter(Boolean)
  return lines.join('\n')
}

export function parseInlineImages(raw: unknown, maxImages = 4): InlineImage[] {
  if (!Array.isArray(raw)) return []
  const images: InlineImage[] = []
  for (const item of raw.slice(0, maxImages)) {
    if (typeof item !== 'string') continue
    if (item.length > 2_500_000) continue
    const match = item.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/)
    if (!match) continue
    const mimeType = match[1].toLowerCase()
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mimeType)) continue
    images.push({ mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, data: match[2] })
  }
  return images
}

async function planCarouselSlides(opts: {
  grokApiKey: string
  subtype: OrganicCarouselSubtype
  slideCount: number
  scriptContent: string
  productContext?: CarouselProductContext
  language: 'en' | 'es'
  brandName?: string | null
  designDirection?: string
  slideDetails?: string
}): Promise<CarouselSlidePlan[]> {
  const { grokApiKey, subtype, slideCount, scriptContent, productContext, language, brandName, designDirection, slideDetails } = opts
  const isEs = language === 'es'
  const productFacts = productContextToText(productContext, language)

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
\nCONTEXTO REAL DEL PRODUCTO:\n${productFacts || '(sin contexto adicional)'}\n
\nIDEA / GUIÓN FUENTE del usuario:\n"""\n${scriptContent.slice(0, 3000)}\n"""\n
\nDevolvé SOLO el array JSON con ${slideCount} slides. Nada más.`
    : `Brand context: ${brandName || '(no name)'}\n
Carousel type: ${subtype}\n
Subtype structural guide:\n${subtypeGuide[subtype]}\n
Slide count: ${slideCount}\n
\nREAL PRODUCT CONTEXT:\n${productFacts || '(no additional context)'}\n
\nUSER'S SOURCE IDEA / SCRIPT:\n"""\n${scriptContent.slice(0, 3000)}\n"""\n
\nReturn ONLY the JSON array with ${slideCount} slides. Nothing else.`

  const directionBlock = isEs
    ? `\n\nDIRECCION DE DISENO DEL USUARIO:\n${designDirection || '(sin direccion adicional)'}\n\nDETALLE SLIDE POR SLIDE DEL USUARIO:\n${slideDetails || '(sin detalle slide por slide)'}\n\nSi el usuario dio detalle slide por slide, respetalo por encima de la guia estructural.`
    : `\n\nUSER DESIGN DIRECTION:\n${designDirection || '(no additional direction)'}\n\nUSER SLIDE-BY-SLIDE DETAIL:\n${slideDetails || '(no slide-by-slide detail)'}\n\nIf the user gave slide-by-slide detail, follow it over the structural guide.`

  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${grokApiKey}`,
    },
    body: JSON.stringify({
      model: GROK_TEXT_MODEL_EFFICIENT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt + directionBlock },
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
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('Slide planner did not return valid JSON')
    parsed = JSON.parse(match[0])
  }
  if (!Array.isArray(parsed)) throw new Error('Slide planner did not return an array')

  const validRoles: SlideRole[] = ['hook', 'body', 'cta', 'recap']
  const normalized: CarouselSlidePlan[] = []
  for (let i = 0; i < slideCount; i++) {
    const rawSlide = parsed[i] as Partial<CarouselSlidePlan> | undefined
    const fallbackRole: SlideRole = i === 0 ? 'hook' : i === slideCount - 1 ? 'cta' : 'body'
    const role: SlideRole = rawSlide && typeof rawSlide.role === 'string' && (validRoles as string[]).includes(rawSlide.role)
      ? (rawSlide.role as SlideRole) : fallbackRole
    normalized.push({
      index: i + 1,
      role,
      headline: rawSlide?.headline?.toString().slice(0, 160) || `Slide ${i + 1}`,
      body: rawSlide?.body?.toString().slice(0, 400) || undefined,
      note: rawSlide?.note?.toString().slice(0, 200) || undefined,
    })
  }
  return normalized
}

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
  designDirection?: string
  productContext?: CarouselProductContext
  productReferenceImages: InlineImage[]
  contextReferenceImages: InlineImage[]
  carouselReferenceImages: InlineImage[]
  referenceSlide1?: { mimeType: string; data: string } | null
  prefixes: { color: string; brandVisual: string; brandLogo: string; logoInline: { mimeType: string; data: string } | null }
}): Promise<{ imageUrl: string; usage: { input: number; output: number; thinking: number } }> {
  const {
    geminiApiKey, aspectRatio, subtype, slide, totalSlides, language,
    hasProductImages, brandVoice, ctaStrength, scriptContext, designDirection, productContext,
    productReferenceImages, contextReferenceImages, carouselReferenceImages, referenceSlide1, prefixes,
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
    productContext,
  })

  const designDirectionPrefix = designDirection
    ? (language === 'es'
      ? `DIRECCION DE DISENO DEL USUARIO (OBLIGATORIA): ${designDirection}\n\n`
      : `USER DESIGN DIRECTION (REQUIRED): ${designDirection}\n\n`)
    : ''
  const fullPromptText = prefixes.color + prefixes.brandVisual + prefixes.brandLogo + designDirectionPrefix + basePrompt

  type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } }
  const parts: PromptPart[] = [{ text: fullPromptText }]

  if (prefixes.logoInline) {
    parts.push({ text: `══ LOGO OFICIAL DE LA MARCA (NO NEGOCIABLE) ══\nIncluí este logo EXACTO en el slide si el subtipo lo contempla. NO lo rediseñes ni cambies sus proporciones.` })
    parts.push({ inlineData: prefixes.logoInline })
  }

  if (productReferenceImages.length > 0) {
    const count = productReferenceImages.length
    parts.push({ text: language === 'es'
      ? `REFERENCIAS DEL PRODUCTO REAL (${count}) - OBLIGATORIO: estas imagenes son la fuente de verdad del producto. Usa TODAS para copiar forma, color, silueta, textura y detalles. No inventes otro producto ni copies el producto desde imagenes de contexto.`
      : `REAL PRODUCT REFERENCES (${count}) - REQUIRED: these images are the source of truth for the product. Use ALL of them to copy shape, color, silhouette, texture, and details. Do not invent another product or copy the product from context images.` })
    productReferenceImages.forEach((img, idx) => {
      parts.push({ text: language === 'es'
        ? `REFERENCIA DE PRODUCTO ${idx + 1} de ${count}`
        : `PRODUCT REFERENCE ${idx + 1} of ${count}` })
      parts.push({ inlineData: img })
    })
  }

  if (contextReferenceImages.length > 0) {
    const count = contextReferenceImages.length
    parts.push({ text: language === 'es'
      ? `IMAGENES DE CONTEXTO / MOODBOARD (${count}): NO son producto. Usalas solo para ambiente, audiencia, escena, lifestyle, iluminacion o energia. Prohibido copiar objetos como si fueran el producto.`
      : `CONTEXT / MOODBOARD IMAGES (${count}): these are NOT the product. Use them only for environment, audience, scene, lifestyle, lighting, or mood. Do not copy objects from them as the product.` })
    contextReferenceImages.forEach((img, idx) => {
      parts.push({ text: language === 'es'
        ? `CONTEXTO ${idx + 1} de ${count}`
        : `CONTEXT ${idx + 1} of ${count}` })
      parts.push({ inlineData: img })
    })
  }

  if (carouselReferenceImages.length > 0) {
    const count = carouselReferenceImages.length
    parts.push({ text: language === 'es'
      ? `IMAGENES DE REFERENCIA ESPECIFICAS PARA ESTE CARRUSEL (${count}): el usuario las subio dentro del modal del carrusel. Pueden ser referencias de estilo, layouts, fotos que quiere usar, assets visuales, ejemplos de posts o mood. Usalas segun la DIRECCION DE DISENO y el DETALLE SLIDE POR SLIDE. Si el usuario pide que una imagen aparezca en un slide, incorporala. Si son ejemplos de estilo, copia el sistema visual (composicion, paleta, jerarquia, energia) sin copiar texto accidental. No reemplaces la verdad del producto si tambien hay referencias de producto reales.`
      : `CAROUSEL-SPECIFIC REFERENCE IMAGES (${count}): the user uploaded these inside the carousel modal. They may be style references, layouts, photos to use, visual assets, post examples, or mood. Use them according to the DESIGN DIRECTION and SLIDE-BY-SLIDE DETAIL. If the user asks for an image to appear on a slide, incorporate it. If they are style examples, copy the visual system (composition, palette, hierarchy, energy) without accidentally copying text. Do not override real product truth if product references are also provided.` })
    carouselReferenceImages.forEach((img, idx) => {
      parts.push({ text: language === 'es'
        ? `REFERENCIA DEL CARRUSEL ${idx + 1} de ${count}`
        : `CAROUSEL REFERENCE ${idx + 1} of ${count}` })
      parts.push({ inlineData: img })
    })
  }

  if (referenceSlide1) {
    parts.push({ text: language === 'es'
      ? `REFERENCIA VISUAL DEL CARRUSEL (slide 1): copiá el mismo sistema visual — tipografía, paleta, grid, jerarquía, estilo — y cambiá solo el contenido textual.`
      : `CAROUSEL VISUAL REFERENCE (slide 1): copy the same visual system — typography, palette, grid, hierarchy, style — and only change the textual content.` })
    parts.push({ inlineData: referenceSlide1 })
  }

  const geminiAspectRatio: '1:1' | '4:5' | '9:16' | '3:4' = aspectRatio
  const response = await withTimeout(ai.models.generateContent({
    model: GEMINI_CAROUSEL_IMAGE_MODEL,
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

export async function runOrganicCarouselGenerate(options: {
  userId: string
  subtype: OrganicCarouselSubtype
  slideCount: number
  scriptContent: string
  aspectRatio: OrganicAspectRatio
  language: 'en' | 'es'
  brandKitId?: string
  ctaStrength?: CTAStrength
  designDirection?: string
  slideDetails?: string
  previewFirstSlideOnly?: boolean
  productContext?: CarouselProductContext
  productReferenceImages?: unknown
  contextReferenceImages?: unknown
  carouselReferenceImages?: unknown
}): Promise<OrganicCarouselResult> {
  const grokApiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || ''
  if (!grokApiKey) throw new Error('Grok API key not configured')
  const geminiApiKey = process.env.GEMINI_API_KEY || ''
  if (!geminiApiKey) throw new Error('Gemini API key not configured')

  const previewFirstSlideOnly = options.previewFirstSlideOnly === true
  const requiredSlides = previewFirstSlideOnly ? 1 : options.slideCount
  const ctaStrength: CTAStrength = options.ctaStrength && (VALID_CAROUSEL_CTA as string[]).includes(options.ctaStrength)
    ? options.ctaStrength
    : 'soft'
  const productReferenceImages = parseInlineImages(options.productReferenceImages, 4)
  const contextReferenceImages = parseInlineImages(options.contextReferenceImages, 4)
  const carouselReferenceImages = parseInlineImages(options.carouselReferenceImages, 8)

  let brandKit: Awaited<ReturnType<typeof resolveBrandKit>> = null
  try { brandKit = await resolveBrandKit(options.userId, options.brandKitId) } catch { /* ignore */ }

  const plan = await planCarouselSlides({
    grokApiKey,
    subtype: options.subtype,
    slideCount: options.slideCount,
    scriptContent: options.scriptContent,
    productContext: options.productContext,
    language: options.language,
    brandName: brandKit?.name,
    designDirection: options.designDirection,
    slideDetails: options.slideDetails,
  })

  const colorPrefix = brandKit ? (buildBrandColorOverride(brandKit) || '') : ''
  const brandVisualPrefix = brandKit ? (buildBrandVisualPrompt(brandKit) || '') : ''
  const brandLogoPrefix = brandKit ? (buildBrandLogoPrompt(brandKit) || '') : ''

  let logoInline: { mimeType: string; data: string } | null = null
  if (brandKit?.logo_url) {
    try {
      logoInline = await fetchBrandLogoAsBase64(brandKit)
    } catch { logoInline = null }
  }

  const sharedPrefixes = { color: colorPrefix, brandVisual: brandVisualPrefix, brandLogo: brandLogoPrefix, logoInline }
  const renderOptsBase = {
    geminiApiKey,
    aspectRatio: options.aspectRatio,
    subtype: options.subtype,
    totalSlides: options.slideCount,
    language: options.language,
    hasProductImages: productReferenceImages.length > 0,
    brandVoice: brandKit?.brand_voice ?? null,
    ctaStrength,
    scriptContext: options.scriptContent,
    designDirection: options.designDirection,
    productContext: options.productContext,
    productReferenceImages,
    contextReferenceImages,
    carouselReferenceImages,
    prefixes: sharedPrefixes,
  } as const

  const slide1 = await renderCarouselSlide({ ...renderOptsBase, slide: plan[0], referenceSlide1: null })
  const slide1DataMatch = slide1.imageUrl.match(/^data:([^;]+);base64,(.+)$/)
  const slide1Reference = slide1DataMatch ? { mimeType: slide1DataMatch[1], data: slide1DataMatch[2] } : null

  const restPromises = previewFirstSlideOnly ? [] : plan.slice(1).map((slide) =>
    renderCarouselSlide({ ...renderOptsBase, slide, referenceSlide1: slide1Reference })
      .then((r) => ({ slide, result: r, error: null as null | string }))
      .catch((err) => ({
        slide,
        result: null as null | { imageUrl: string; usage: { input: number; output: number; thinking: number } },
        error: (err as Error).message,
      }))
  )
  const restResults = await Promise.all(restPromises)

  const slides: OrganicCarouselSlide[] = [
    {
      index: 1,
      role: plan[0].role,
      headline: plan[0].headline,
      body: plan[0].body,
      note: plan[0].note,
      imageUrl: slide1.imageUrl,
      error: null,
    },
    ...restResults.map((r) => ({
      index: r.slide.index,
      role: r.slide.role,
      headline: r.slide.headline,
      body: r.slide.body,
      note: r.slide.note,
      imageUrl: r.result?.imageUrl ?? null,
      error: r.error,
    })),
  ]

  const succeeded = slides.filter((s) => !!s.imageUrl).length
  const carouselGroupId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)

  return {
    carouselGroupId,
    subtype: options.subtype,
    totalSlides: options.slideCount,
    aspectRatio: options.aspectRatio,
    language: options.language,
    ctaStrength,
    plan,
    slides,
    previewFirstSlideOnly,
    succeeded,
    requiredSlides,
    usageTokens: {
      input: slide1.usage.input + restResults.reduce((s, r) => s + (r.result?.usage.input ?? 0), 0),
      output: slide1.usage.output + restResults.reduce((s, r) => s + (r.result?.usage.output ?? 0), 0),
      thinking: slide1.usage.thinking + restResults.reduce((s, r) => s + (r.result?.usage.thinking ?? 0), 0),
    },
  }
}
