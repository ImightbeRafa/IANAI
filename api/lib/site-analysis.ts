/**
 * Shared public-site crawl + Gemini Brand Kit extraction.
 * Used by POST /api/analyze-site and MCP GUIDE URL analysis worker.
 */

import { GoogleGenAI } from '@google/genai'
import { rehostBrandLogo } from './brand-kit.js'
import { assertPublicHttpUrl, fetchPublicUrl } from './url-safety.js'

export const SITE_ANALYSIS_MODEL = 'gemini-2.5-flash'
const MAX_PAGES = 5
const MAX_PAGE_CHARS = 12_000
const MAX_TOTAL_CONTENT = 34_000
const MAX_CSS_FILES = 3
const MAX_CSS_CHARS = 180_000

export type SiteFieldOrigin = 'web' | 'inferred' | 'missing'

export interface SiteFieldEvidence {
  origin: SiteFieldOrigin
  confidence: number
  evidence: string[]
  sourceUrls: string[]
}

export interface SiteAnalysisResult {
  facts: Record<string, unknown>
  evidence: Record<string, SiteFieldEvidence>
  pages: Array<{ url: string; title: string; ok: boolean }>
  assets: {
    logoCandidates: string[]
    faviconCandidates: string[]
    imageCandidates: string[]
    colors: string[]
    fonts: string[]
  }
  warnings: string[]
}

export type SiteAnalysisUsage = {
  input: number
  output: number
  thinking: number
}

interface PageSignals {
  url: string
  title: string
  description: string
  text: string
  links: Array<{ url: string; label: string }>
  stylesheets: string[]
  logoCandidates: string[]
  faviconCandidates: string[]
  imageCandidates: string[]
  colors: string[]
  fonts: string[]
}

const RELEVANT_LINK_TERMS = [
  'product', 'producto', 'shop', 'tienda', 'service', 'servicio', 'about', 'nosotros',
  'historia', 'story', 'faq', 'preguntas', 'shipping', 'envio', 'envíos', 'delivery',
  'returns', 'devoluciones', 'contact', 'contacto', 'sizes', 'tallas', 'pricing', 'precio',
  'collections', 'colecciones', 'catalog', 'catalogo', 'catálogo', 'menu', 'menú',
]

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)))
}

function absoluteUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(decodeHtml(raw.trim()), base)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function unique(values: Array<string | null | undefined>, limit = 50): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].slice(0, limit)
}

const RASTER_LOGO = /\.(?:png|jpe?g|webp|gif)(?:$|\?)/i
const SVG_LOGO = /\.svg(?:$|\?)/i

function assetPath(url: string): string {
  return url.split('#')[0]
}

/** Prefer a real mark over a favicon. Raster beats SVG so image models can ingest it. */
export function pickOfficialLogo(logoCandidates: string[], faviconCandidates: string[] = []): string {
  const favicons = new Set(faviconCandidates)
  const logos = unique(logoCandidates.filter((url) => !favicons.has(url)))
  const raster = logos.find((url) => RASTER_LOGO.test(assetPath(url)))
  if (raster) return raster
  const svg = logos.find((url) => SVG_LOGO.test(assetPath(url)))
  if (svg) return svg
  return logos[0] || ''
}

function firstSrcsetUrl(srcset: string, pageUrl: string): string | null {
  const first = srcset.split(',')[0]?.trim().split(/\s+/)[0]
  return first ? absoluteUrl(first, pageUrl) : null
}

function jsonLdLogoUrls(node: unknown, pageUrl: string, out: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) jsonLdLogoUrls(item, pageUrl, out)
    return
  }
  const rec = node as Record<string, unknown>
  const typeRaw = rec['@type']
  const type = (Array.isArray(typeRaw) ? typeRaw.map(String).join(' ') : String(typeRaw || '')).toLowerCase()
  if (/(organization|brand|localbusiness|store|website)/.test(type)) {
    const logo = rec.logo
    if (typeof logo === 'string') {
      const url = absoluteUrl(logo, pageUrl)
      if (url) out.push(url)
    } else if (logo && typeof logo === 'object' && !Array.isArray(logo)) {
      const href = (logo as { url?: unknown }).url
      if (typeof href === 'string') {
        const url = absoluteUrl(href, pageUrl)
        if (url) out.push(url)
      }
    }
  }
  for (const value of Object.values(rec)) jsonLdLogoUrls(value, pageUrl, out)
}

function extractJsonLdLogos(html: string, pageUrl: string): string[] {
  const logos: string[] = []
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      jsonLdLogoUrls(JSON.parse(decodeHtml(match[1])), pageUrl, logos)
    } catch {
      // Ignore malformed JSON-LD; visible HTML still feeds logoCandidates.
    }
  }
  return unique(logos)
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return match?.[1]?.trim() || ''
}

function metaContent(html: string, names: string[]): string {
  const tags = html.match(/<meta\b[^>]*>/gi) || []
  for (const tag of tags) {
    const key = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase()
    if (names.includes(key)) return decodeHtml(attr(tag, 'content'))
  }
  return ''
}

function extractColors(text: string): string[] {
  const ignored = new Set(['#fff', '#ffffff', '#000', '#000000', '#333', '#333333', '#666', '#666666', '#999', '#999999', '#ccc', '#cccccc', '#eee', '#eeeeee'])
  const colors = (text.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi) || [])
    .map((color) => color.toLowerCase())
    .filter((color) => !ignored.has(color))
  return unique(colors, 30)
}

function extractFonts(text: string): string[] {
  const fonts: string[] = []
  for (const match of text.matchAll(/font-family\s*:\s*["']?([^;"'}\n]+)/gi)) {
    const first = match[1].split(',')[0]?.replace(/["']/g, '').trim()
    if (first && first.length < 70 && !first.startsWith('var(') && first !== 'inherit') fonts.push(first)
  }
  for (const match of text.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*family=([^&"']+)/gi)) {
    const family = decodeURIComponent(match[1]).split(':')[0]?.replace(/\+/g, ' ').trim()
    if (family) fonts.push(family)
  }
  return unique(fonts, 16)
}

function stripHtml(html: string): string {
  return decodeHtml(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function extractStructuredData(html: string): string {
  const blocks: string[] = []
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = decodeHtml(match[1]).trim()
    if (!raw) continue
    try {
      blocks.push(JSON.stringify(JSON.parse(raw)))
    } catch {
      blocks.push(raw)
    }
  }
  return blocks.join('\n').slice(0, 8_000)
}

export function extractPageSignals(html: string, pageUrl: string): PageSignals {
  const title = decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
  const description = metaContent(html, ['description', 'og:description', 'twitter:description'])
  const links: Array<{ url: string; label: string }> = []
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absoluteUrl(match[1], pageUrl)
    if (!url) continue
    links.push({ url, label: stripHtml(match[2]).slice(0, 120) })
  }

  const stylesheets: string[] = []
  const faviconCandidates: string[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, 'rel').toLowerCase()
    const href = absoluteUrl(attr(tag, 'href'), pageUrl)
    if (!href) continue
    if (rel.includes('stylesheet')) stylesheets.push(href)
    if (rel.includes('icon')) faviconCandidates.push(href)
  }

  const logoCandidates: string[] = []
  const imageCandidates: string[] = []
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = absoluteUrl(attr(tag, 'src') || attr(tag, 'data-src'), pageUrl)
    const srcset = firstSrcsetUrl(attr(tag, 'srcset') || attr(tag, 'data-srcset'), pageUrl)
    const href = (src && !src.startsWith('data:') ? src : srcset) || srcset
    if (!href) continue
    const descriptor = `${attr(tag, 'alt')} ${attr(tag, 'class')} ${attr(tag, 'id')} ${href}`.toLowerCase()
    if (/logo|brand-mark|wordmark|header__heading/.test(descriptor)) logoCandidates.push(href)
    if (/product|producto|hero|gallery|galeria|lifestyle|detail|detalle|benefit|beneficio|offer|oferta|menu|property|propiedad/.test(descriptor)) {
      imageCandidates.push(href)
    }
  }
  logoCandidates.push(...extractJsonLdLogos(html, pageUrl))
  const ogImage = absoluteUrl(metaContent(html, ['og:image', 'twitter:image']), pageUrl)
  if (ogImage) imageCandidates.unshift(ogImage)

  const visibleText = stripHtml(html)
  const structuredData = extractStructuredData(html)
  return {
    url: pageUrl,
    title,
    description,
    text: [visibleText, structuredData && `STRUCTURED DATA: ${structuredData}`]
      .filter(Boolean)
      .join('\n')
      .slice(0, MAX_PAGE_CHARS),
    links: links.slice(0, 160),
    stylesheets: unique(stylesheets, 12),
    logoCandidates: unique(logoCandidates, 8),
    faviconCandidates: unique(faviconCandidates, 8),
    imageCandidates: unique(imageCandidates, 24),
    colors: extractColors(html),
    fonts: extractFonts(html),
  }
}

export function selectCrawlLinks(
  homeUrl: string,
  links: Array<{ url: string; label: string }>,
  limit = MAX_PAGES - 1
): string[] {
  const home = new URL(homeUrl)
  const scored = links
    .map((link) => {
      let parsed: URL
      try { parsed = new URL(link.url) } catch { return null }
      if (parsed.origin !== home.origin) return null
      if (/\.(?:pdf|jpg|jpeg|png|webp|gif|svg|zip)(?:$|\?)/i.test(parsed.pathname)) return null
      parsed.hash = ''
      const haystack = `${parsed.pathname} ${link.label}`.toLowerCase()
      const termScore = RELEVANT_LINK_TERMS.reduce((score, term) => score + (haystack.includes(term) ? 4 : 0), 0)
      const depth = parsed.pathname.split('/').filter(Boolean).length
      const score = termScore - depth - (parsed.search ? 2 : 0)
      return { url: parsed.href, score }
    })
    .filter((item): item is { url: string; score: number } => Boolean(item) && item.score > 0)
    .sort((a, b) => b.score - a.score)
  return unique(scored.map((item) => item.url).filter((url) => url !== home.href), limit)
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const response = await fetchPublicUrl(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AdvanceAI-SiteAnalyzer/1.0)',
      'Accept': 'text/html,application/xhtml+xml,text/css;q=0.9,*/*;q=0.5',
      'Accept-Encoding': 'identity',
      'Accept-Language': 'es,en;q=0.8',
    },
    timeoutMs,
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.text()
}

async function fetchPageSignals(url: string): Promise<{ page: PageSignals; usedReader: boolean }> {
  const html = await fetchText(url)
  const page = extractPageSignals(html, url)
  if (page.text.length >= 400) return { page, usedReader: false }

  try {
    const readerText = await fetchText(`https://r.jina.ai/${url}`, 12_000)
    if (readerText.trim().length > page.text.length) {
      page.text = [page.text, `RENDERED PAGE CONTENT: ${readerText.trim()}`]
        .filter(Boolean)
        .join('\n')
        .slice(0, MAX_PAGE_CHARS)
      return { page, usedReader: true }
    }
  } catch {
    // The direct page remains usable; the reader is only a best-effort fallback.
  }
  return { page, usedReader: false }
}

async function crawlSite(url: string): Promise<{
  pages: PageSignals[]
  attempted: Array<{ url: string; title: string; ok: boolean }>
  cssText: string
  warnings: string[]
}> {
  const warnings: string[] = []
  const homeHtml = await fetchText(url, 15_000)
  const home = extractPageSignals(homeHtml, url)
  if (home.text.length < 400) {
    try {
      const readerText = await fetchText(`https://r.jina.ai/${url}`, 12_000)
      if (readerText.trim().length > home.text.length) {
        home.text = [home.text, `RENDERED PAGE CONTENT: ${readerText.trim()}`]
          .filter(Boolean)
          .join('\n')
          .slice(0, MAX_PAGE_CHARS)
        warnings.push('La página principal requirió el lector de respaldo para recuperar su contenido.')
      }
    } catch {
      warnings.push('El sitio contiene poco texto visible y no respondió el lector de respaldo.')
    }
  }
  const childUrls = selectCrawlLinks(home.url, home.links)
  const childResults = await Promise.allSettled(childUrls.map(async (childUrl) => {
    return fetchPageSignals(childUrl)
  }))
  const pages = [home]
  const attempted = [{ url: home.url, title: home.title, ok: true }]
  childResults.forEach((result, index) => {
    const childUrl = childUrls[index]
    if (result.status === 'fulfilled') {
      pages.push(result.value.page)
      attempted.push({ url: childUrl, title: result.value.page.title, ok: true })
      if (result.value.usedReader) warnings.push(`Se usó el lector de respaldo para ${childUrl}`)
    } else {
      warnings.push(`No se pudo leer ${childUrl}`)
      attempted.push({ url: childUrl, title: '', ok: false })
    }
  })

  const cssUrls = unique(pages.flatMap((page) => page.stylesheets), MAX_CSS_FILES)
  const cssResults = await Promise.allSettled(cssUrls.map((cssUrl) => fetchText(cssUrl, 8_000)))
  const cssText = cssResults
    .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
    .map((result) => result.value.slice(0, MAX_CSS_CHARS / Math.max(1, cssUrls.length)))
    .join('\n')
    .slice(0, MAX_CSS_CHARS)
  if (cssUrls.length && !cssText) warnings.push('No se pudieron leer las hojas de estilo del sitio.')
  return { pages, attempted, cssText, warnings }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI response did not contain JSON')
  return JSON.parse(match[0]) as Record<string, unknown>
}

function normalizeEvidence(raw: unknown): Record<string, SiteFieldEvidence> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, SiteFieldEvidence> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const row = value as Record<string, unknown>
    const origin: SiteFieldOrigin = row.origin === 'web' || row.origin === 'inferred' ? row.origin : 'missing'
    const confidence = typeof row.confidence === 'number'
      ? Math.min(1, Math.max(0, row.confidence))
      : origin === 'web' ? 0.9 : origin === 'inferred' ? 0.55 : 0
    out[key] = {
      origin,
      confidence,
      evidence: Array.isArray(row.evidence)
        ? row.evidence.filter((item): item is string => typeof item === 'string').slice(0, 3)
        : [],
      sourceUrls: Array.isArray(row.sourceUrls)
        ? row.sourceUrls.filter((item): item is string => typeof item === 'string').slice(0, 3)
        : [],
    }
  }
  return out
}

function safeAssetUrls(raw: unknown, candidates: string[], limit: number): string[] {
  const allowed = new Set(candidates)
  if (!Array.isArray(raw)) return []
  return unique(raw.filter((item): item is string => typeof item === 'string' && allowed.has(item)), limit)
}

async function synthesizeSite(
  url: string,
  language: string,
  notes: string,
  pages: PageSignals[],
  cssText: string
): Promise<{ facts: Record<string, unknown>; evidence: Record<string, SiteFieldEvidence>; usage: SiteAnalysisUsage }> {
  const colors = unique([...pages.flatMap((page) => page.colors), ...extractColors(cssText)], 30)
  const fonts = unique([...pages.flatMap((page) => page.fonts), ...extractFonts(cssText)], 16)
  const logos = unique(pages.flatMap((page) => page.logoCandidates), 12)
  const images = unique(pages.flatMap((page) => page.imageCandidates), 36)
  let pageContent = pages.map((page, index) => [
    `=== PAGE ${index + 1} ===`,
    `URL: ${page.url}`,
    `TITLE: ${page.title}`,
    `DESCRIPTION: ${page.description}`,
    page.text,
  ].join('\n')).join('\n\n')
  if (pageContent.length > MAX_TOTAL_CONTENT) pageContent = pageContent.slice(0, MAX_TOTAL_CONTENT)

  const systemInstruction = `Eres un analista senior de ecommerce, oferta y branding. Convierte un sitio web en un Brand Kit útil para generar guiones, posts e imágenes.

REGLAS:
- Maximiza la extracción de hechos presentes en todas las páginas suministradas.
- Diferencia estrictamente entre un hecho de la web, una inferencia razonable y un dato ausente.
- No presentes inferencias como hechos. No inventes garantías, precios, ubicaciones, pruebas, competidores ni afirmaciones médicas.
- Para cada campo de facts incluye una entrada con la misma clave en evidence.
- evidence.origin debe ser "web", "inferred" o "missing".
- Para "web", agrega hasta 3 fragmentos breves y sus URLs. Para "inferred", explica brevemente la inferencia. Para "missing", usa evidencia vacía.
- logo_url solo puede ser una URL de LOGO CANDIDATES. Un favicon no es automáticamente el logo oficial.
- reference_images solo puede usar URLs de IMAGE CANDIDATES.
- forbidden_phrases normalmente debe quedar vacío/missing salvo que el sitio indique expresamente qué lenguaje evitar.
- current_alternatives puede ser inferred si el problema/producto permite una hipótesis clara, pero debe marcarse como inferred.
- Responde únicamente JSON válido.

FORMATO:
{
  "facts": {
    "businessName": "", "salesChannels": ["website|messages|physical"], "location": "",
    "doesShipping": false, "shippingMethod": "", "icp": "",
    "storageType": "product|service|restaurant|real_estate|indumentaria", "customLabel": "",
    "offerName": "", "product_description": "", "utility": "", "result": "",
    "current_alternatives": "", "key_objection": "", "main_problem": "",
    "expected_result": "", "differentiation": "", "menu_text": "", "schedule": "",
    "re_price": "", "re_location": "", "re_highlights": "", "re_cta": "",
    "ind_article_type": "", "ind_variations_description": "", "ind_main_material": "",
    "brand_voice": "", "tone_keywords": [], "must_use_phrases": [], "forbidden_phrases": [],
    "brand_visual": "", "primary_color": "", "secondary_color": "", "accent_color": "",
    "logo_url": "", "reference_images": [], "tagline": "", "font_primary": ""
  },
  "evidence": {
    "businessName": { "origin": "web", "confidence": 0.98, "evidence": ["fragmento"], "sourceUrls": ["https://..."] }
  }
}`

  const userContent = `SITIO PRINCIPAL: ${url}
IDIOMA: ${language}
NOTAS DEL USUARIO: ${notes || 'ninguna'}
COLORES DETECTADOS: ${colors.join(', ') || 'ninguno'}
FUENTES DETECTADAS: ${fonts.join(', ') || 'ninguna'}
LOGO CANDIDATES: ${logos.join(', ') || 'ninguno'}
IMAGE CANDIDATES: ${images.join(', ') || 'ninguna'}

${pageContent}`

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('AI service not configured')
  const ai = new GoogleGenAI({ apiKey })
  const result = await ai.models.generateContent({
    model: SITE_ANALYSIS_MODEL,
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    config: {
      systemInstruction,
      temperature: 0.15,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  })
  const text = result.candidates?.[0]?.content?.parts?.map((part) => 'text' in part ? part.text || '' : '').join('') || ''
  const parsed = parseJsonObject(text)
  const facts = parsed.facts && typeof parsed.facts === 'object' && !Array.isArray(parsed.facts)
    ? parsed.facts as Record<string, unknown>
    : {}
  const chosen = String(facts.logo_url || '').trim()
  facts.logo_url = logos.includes(chosen)
    ? chosen
    : pickOfficialLogo(logos, pages.flatMap((page) => page.faviconCandidates))
  facts.reference_images = safeAssetUrls(facts.reference_images, images, 8)
  return {
    facts,
    evidence: normalizeEvidence(parsed.evidence),
    usage: {
      input: result.usageMetadata?.promptTokenCount || 0,
      output: result.usageMetadata?.candidatesTokenCount || 0,
      thinking: result.usageMetadata?.thoughtsTokenCount || 0,
    },
  }
}

export async function runSiteAnalysis(options: {
  url: string
  language?: string
  notes?: string
  /** When set, attempt to rehost extracted logo into Advance storage. */
  rehostLogoForUserId?: string
}): Promise<{ analysis: SiteAnalysisResult; usage: SiteAnalysisUsage; normalizedUrl: string }> {
  const normalizedUrl = assertPublicHttpUrl(options.url.trim()).href
  if (!normalizedUrl.startsWith('https:')) {
    throw new Error('Only https URLs are allowed')
  }
  const language = options.language === 'en' ? 'en' : 'es'
  const notes = typeof options.notes === 'string' ? options.notes.slice(0, 4_000) : ''

  const crawled = await crawlSite(normalizedUrl)
  const synthesized = await synthesizeSite(
    normalizedUrl,
    language,
    notes,
    crawled.pages,
    crawled.cssText
  )
  const assets = {
    logoCandidates: unique(crawled.pages.flatMap((page) => page.logoCandidates), 12),
    faviconCandidates: unique(crawled.pages.flatMap((page) => page.faviconCandidates), 12),
    imageCandidates: unique(crawled.pages.flatMap((page) => page.imageCandidates), 36),
    colors: unique([...crawled.pages.flatMap((page) => page.colors), ...extractColors(crawled.cssText)], 30),
    fonts: unique([...crawled.pages.flatMap((page) => page.fonts), ...extractFonts(crawled.cssText)], 16),
  }
  const warnings = [...crawled.warnings]
  const extractedLogo = String(synthesized.facts.logo_url || '').trim()
  if (extractedLogo && options.rehostLogoForUserId) {
    try {
      const hosted = await rehostBrandLogo(options.rehostLogoForUserId, extractedLogo)
      if (hosted?.url) synthesized.facts.logo_url = hosted.url
      if (hosted?.skipped === 'svg') {
        warnings.push(language === 'en'
          ? 'The extracted logo is SVG/ICO. Upload a PNG or WebP so posts can include it.'
          : 'El logo extraído es SVG/ICO. Subí un PNG o WebP para que los posts lo puedan usar.')
      } else if (hosted?.skipped === 'fetch') {
        warnings.push(language === 'en'
          ? 'Could not copy the logo into storage. Posts will try the original URL.'
          : 'No pude copiar el logo al almacenamiento. Los posts intentarán la URL original.')
      }
    } catch (logoErr) {
      console.warn('logo rehost failed', logoErr)
    }
  }

  return {
    normalizedUrl,
    usage: synthesized.usage,
    analysis: {
      facts: synthesized.facts,
      evidence: synthesized.evidence,
      pages: crawled.attempted,
      assets,
      warnings,
    },
  }
}
