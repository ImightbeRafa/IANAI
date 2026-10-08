/**
 * Website → DnaPart. Reuses the shared crawler + Brand Kit synthesis in
 * `api/lib/site-analysis.ts` and adds a deterministic commerce scan (price,
 * payment, shipping, delivery time, guarantee, returns, proof numbers) over
 * the crawled HTML so those facts carry exact evidence.
 */

import {
  extractPageSignals,
  fetchSiteText,
  pickOfficialLogo,
  runSiteAnalysis,
  type SiteAnalysisResult,
  type SiteFetchText,
  type SiteFieldEvidence,
  type SiteSynthesize,
} from '../../site-analysis.js'
import type { AdLanguage, DnaFact, DnaVisual, FactKey, FactSource, ModelGateway } from '../types.js'
import { cleanText, isHexColor, makeFact, stringArray, uniqStrings, type DnaPart } from './part.js'

// ---------------------------------------------------------------------------
// Deterministic commerce scan
// ---------------------------------------------------------------------------

function snippetAround(text: string, index: number, length: number, max = 160): string {
  let start = index
  let end = index + length
  const stopBefore = /[.!?\n|•]/
  while (start > 0 && index - start < max / 2 && !stopBefore.test(text[start - 1])) start -= 1
  while (end < text.length && end - index < max && !/[.!?\n|•]/.test(text[end])) end += 1
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

const PRICE_RE = /(?:₡|CRC\s?|US\$\s?|USD\s?|\$|€|MXN\s?|COP\s?|S\/\.?\s?)\s?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{2})?|(?:₡|US\$|\$|€)\s?\d{1,6}(?:[.,]\d{2})?(?!\d)/g

const PAYMENT_TERMS: Array<{ re: RegExp; es: string; en: string }> = [
  { re: /\bsinpe(?:\s*m[oó]vil)?\b/i, es: 'SINPE Móvil', en: 'SINPE Móvil' },
  { re: /\btarjetas?\s+(?:de\s+)?(?:cr[eé]dito|d[eé]bito)|\bpago\s+con\s+tarjeta|\bvisa\b|\bmastercard\b|\bcredit\s+cards?\b|\bdebit\s+cards?\b/i, es: 'tarjeta', en: 'card' },
  { re: /\btransferencias?(?:\s+bancarias?)?\b|\bbank\s+transfer\b/i, es: 'transferencia', en: 'bank transfer' },
  { re: /\bcontra\s*entrega\b|\bcash\s+on\s+delivery\b/i, es: 'pago contra entrega', en: 'cash on delivery' },
  { re: /\befectivo\b|\bcash\b/i, es: 'efectivo', en: 'cash' },
  { re: /\bpaypal\b/i, es: 'PayPal', en: 'PayPal' },
  { re: /\bmercado\s*pago\b/i, es: 'Mercado Pago', en: 'Mercado Pago' },
  { re: /\btasa\s*cero\b|\bcuotas\s+sin\s+inter[eé]s\b/i, es: 'cuotas sin interés', en: 'interest-free installments' },
]

const SHIPPING_RE = /env[ií]os?\s+gratis|env[ií]o\s+gratuito|free\s+shipping|env[ií]os?\s+a\s+todo\s+(?:el\s+)?pa[ií]s|ships?\s+nationwide|env[ií]os?\s+express|env[ií]os?\s+(?:a\s+domicilio|nacionales|internacionales)|hacemos\s+env[ií]os|delivery\s+(?:a\s+domicilio|gratis)/i
const DELIVERY_RE = /(?:entrega|env[ií]o|recib[ií]s|recibes|recibe|llega|deliver(?:y|ed)?|ship(?:s|ping)?)[^.!?\n]{0,60}?(\d+\s*(?:a|al|-|–|to)\s*\d+|\d+)\s*(d[ií]as(?:\s+h[aá]biles)?|horas|hrs?|business\s+days|days|hours)\b/i
const GUARANTEE_RE = /garant[ií]a[^.!?\n|•]{0,100}|money[-\s]back[^.!?\n|•]{0,80}|satisfaction\s+guarantee[^.!?\n|•]{0,60}/i
const RETURNS_RE = /devoluci[oó]n(?:es)?[^.!?\n|•]{0,100}|(?:free\s+returns|return\s+policy|returns\s+within)[^.!?\n|•]{0,80}/i
const PROOF_NUMBER_RE = /(\+?\d[\d.,]*\+?)\s*(clientes(?:\s+felices)?|rese[ñn]as|opiniones|reviews|customers|vendidos|ventas|sold|pedidos\s+entregados)/i
const RATING_RE = /(\d(?:[.,]\d)?)\s*(?:\/\s*5|de\s+5\s+estrellas|estrellas|stars|★)/i

/** Pure: scan page texts for commerce facts with evidence snippets (never confirmed). */
export function scanCommerceFacts(pages: Array<{ url: string; text: string }>, language: AdLanguage = 'es'): DnaFact[] {
  const facts: DnaFact[] = []
  const seen = new Set<FactKey>()
  const push = (key: FactKey, value: string, evidence: string, url: string) => {
    if (seen.has(key) || !value.trim()) return
    seen.add(key)
    facts.push(makeFact(key, value.slice(0, 160), 'website', `${evidence.slice(0, 220)} — ${url}`))
  }

  // Price: most frequent symbol price across pages (ties → first seen).
  const priceCounts = new Map<string, { count: number; evidence: string; url: string; order: number }>()
  let order = 0
  for (const page of pages) {
    const text = page.text.split('STRUCTURED DATA:')[0]
    for (const match of text.matchAll(PRICE_RE)) {
      const value = match[0].replace(/\s+/g, ' ').trim()
      const digits = value.replace(/\D/g, '')
      if (!digits || Number(digits) === 0) continue
      const row = priceCounts.get(value)
      if (row) row.count += 1
      else priceCounts.set(value, { count: 1, evidence: snippetAround(text, match.index ?? 0, value.length), url: page.url, order: order++ })
    }
  }
  const bestPrice = [...priceCounts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)[0]
  if (bestPrice) push('price', bestPrice[0], bestPrice[1].evidence, bestPrice[1].url)

  const payments: string[] = []
  let paymentEvidence = ''
  let paymentUrl = ''
  for (const page of pages) {
    for (const term of PAYMENT_TERMS) {
      const match = term.re.exec(page.text)
      if (!match) continue
      const label = language === 'en' ? term.en : term.es
      if (!payments.includes(label)) payments.push(label)
      if (!paymentEvidence) {
        paymentEvidence = snippetAround(page.text, match.index, match[0].length)
        paymentUrl = page.url
      }
    }
  }
  if (payments.length) push('payment_methods', payments.join(', '), paymentEvidence, paymentUrl)

  for (const page of pages) {
    const text = page.text
    const ship = SHIPPING_RE.exec(text)
    if (ship) {
      const snip = snippetAround(text, ship.index, ship[0].length, 120)
      push('shipping', snip, snip, page.url)
    }
    const delivery = DELIVERY_RE.exec(text)
    if (delivery) {
      push('delivery_time', `${delivery[1].replace(/\s+/g, ' ')} ${delivery[2]}`.trim(), snippetAround(text, delivery.index, delivery[0].length), page.url)
    }
    const guarantee = GUARANTEE_RE.exec(text)
    if (guarantee) push('guarantee', guarantee[0].trim(), snippetAround(text, guarantee.index, guarantee[0].length), page.url)
    const returns = RETURNS_RE.exec(text)
    if (returns) push('returns', returns[0].trim(), snippetAround(text, returns.index, returns[0].length), page.url)
    const proof = PROOF_NUMBER_RE.exec(text)
    if (proof) push('proof_number', proof[0].trim(), snippetAround(text, proof.index, proof[0].length), page.url)
    const rating = RATING_RE.exec(text)
    if (rating && Number(rating[1].replace(',', '.')) <= 5) push('custom:rating', rating[0].trim(), snippetAround(text, rating.index, rating[0].length), page.url)
  }
  return facts
}

// ---------------------------------------------------------------------------
// SiteAnalysisResult → DnaPart
// ---------------------------------------------------------------------------

const FACT_MAP: Array<{ field: string; key: FactKey }> = [
  { field: 'businessName', key: 'brand_name' },
  { field: 'offerName', key: 'offer_name' },
  { field: 'location', key: 'location' },
  { field: 're_location', key: 'location' },
  { field: 'shippingMethod', key: 'shipping' },
  { field: 're_price', key: 'price' },
  { field: 'differentiation', key: 'differentiator' },
  { field: 'utility', key: 'how_it_works' },
  { field: 'result', key: 'result_claim' },
  { field: 'expected_result', key: 'result_claim' },
  { field: 'ind_main_material', key: 'ingredients_materials' },
  { field: 'ind_variations_description', key: 'variants' },
  { field: 'schedule', key: 'custom:schedule' },
  { field: 'menu_text', key: 'custom:menu' },
]

function fieldSource(evidence: SiteFieldEvidence | undefined): FactSource | null {
  if (!evidence) return 'inferred'
  if (evidence.origin === 'web') return 'website'
  if (evidence.origin === 'inferred') return 'inferred'
  return null
}

function evidenceText(evidence: SiteFieldEvidence | undefined): string | undefined {
  if (!evidence) return undefined
  const parts = [evidence.evidence[0], evidence.sourceUrls[0]].filter(Boolean)
  return parts.length ? parts.join(' — ') : undefined
}

export function mapSiteAnalysis(input: {
  analysis: SiteAnalysisResult
  url: string
  fetchedAt: string
  commerceFacts?: DnaFact[]
  pageText?: string
  costUsd?: number
}): DnaPart {
  const { analysis } = input
  const f = analysis.facts || {}
  const ev = analysis.evidence || {}
  const facts: DnaFact[] = []
  const usedSingle = new Set<FactKey>()

  for (const { field, key } of FACT_MAP) {
    const value = cleanText(f[field], 240)
    if (!value) continue
    const source = fieldSource(ev[field])
    if (!source) continue
    if (key !== 'result_claim' && usedSingle.has(key)) continue
    usedSingle.add(key)
    // Brand name read verbatim from the site is trivially exact → pre-confirmed.
    const confirmed = key === 'brand_name' && source === 'website'
    facts.push(makeFact(key, value, source, evidenceText(ev[field]), confirmed))
  }
  if (!usedSingle.has('shipping') && f.doesShipping === true && fieldSource(ev.doesShipping) === 'website') {
    facts.push(makeFact('shipping', 'Envíos disponibles', 'website', evidenceText(ev.doesShipping)))
  }
  // Deterministic commerce facts fill keys the model did not cover.
  const present = new Set(facts.map((fact) => fact.key))
  for (const fact of input.commerceFacts || []) {
    if (!present.has(fact.key)) facts.push(fact)
  }

  const assets = analysis.assets || { logoCandidates: [], faviconCandidates: [], imageCandidates: [], colors: [], fonts: [] }
  const colors = assets.colors.filter(isHexColor)
  const fonts = assets.fonts || []
  const visual: DnaVisual = {}
  const primary = isHexColor(f.primary_color) ? f.primary_color : colors[0]
  const secondary = isHexColor(f.secondary_color) ? f.secondary_color : colors.find((c) => c !== primary)
  const accent = isHexColor(f.accent_color) ? f.accent_color : colors.find((c) => c !== primary && c !== secondary)
  if (primary) visual.primaryColor = primary.toLowerCase()
  if (secondary) visual.secondaryColor = secondary.toLowerCase()
  if (accent) visual.accentColor = accent.toLowerCase()
  const heading = cleanText(f.font_primary, 60) || fonts[0]
  if (heading) visual.headingFont = heading
  const body = fonts.find((font) => font !== heading)
  if (body) visual.bodyFont = body
  const logo = cleanText(f.logo_url, 600) || pickOfficialLogo(assets.logoCandidates, assets.faviconCandidates)
  if (logo) visual.logoUrl = logo
  const style = cleanText(f.brand_visual, 300)
  if (style) visual.styleNotes = style

  const toneKeywords = stringArray(f.tone_keywords, 6, 40)
  const voice = [cleanText(f.brand_voice, 200), toneKeywords.length ? toneKeywords.join(', ') : '']
    .filter(Boolean)
    .join(' · ')
  const brandName = cleanText(f.businessName, 120)
  const oneLiner = cleanText(f.tagline, 160) || cleanText(f.product_description, 200)
  const textSample = [
    brandName, oneLiner, cleanText(f.product_description, 400), cleanText(f.utility, 300),
    cleanText(f.offerName, 120), cleanText(f.icp, 200), cleanText(f.storageType, 40),
    analysis.pages.map((p) => p.title).join(' · '), (input.pageText || '').slice(0, 3_000),
  ].filter(Boolean).join('\n')

  const warnings = analysis.warnings || []
  return {
    source: 'website',
    sourceEntry: {
      kind: 'website',
      url: input.url,
      fetchedAt: input.fetchedAt,
      ok: true,
      note: warnings.length ? warnings.slice(0, 3).join(' | ').slice(0, 400) : `${analysis.pages.filter((p) => p.ok).length} páginas leídas`,
    },
    brandName: brandName || undefined,
    oneLiner: oneLiner || undefined,
    voice: voice || undefined,
    audience: uniqStrings([cleanText(f.icp, 240)]),
    pains: uniqStrings([cleanText(f.main_problem, 240)]),
    desires: uniqStrings([cleanText(f.expected_result, 240), cleanText(f.result, 240)]),
    objections: uniqStrings([cleanText(f.key_objection, 240)]),
    forbiddenPhrases: stringArray(f.forbidden_phrases, 12, 120),
    facts,
    visual,
    referenceImageUrls: stringArray(f.reference_images, 8, 600),
    textSample,
    costUsd: input.costUsd || 0,
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface IngestWebsiteOptions {
  url: string
  /** When set, the synthesis call goes through the gateway (cost recorded); else direct Gemini. */
  gateway?: ModelGateway
  language?: AdLanguage
  notes?: string
  /** Seam for tests / alternate runtimes. Default: SSRF-guarded fetch from site-analysis. */
  fetchText?: SiteFetchText
  /** Seam: replace `runSiteAnalysis` entirely (tests). */
  analyze?: typeof runSiteAnalysis
  now?: () => Date
}

function looksLikeHtml(body: string): boolean {
  return /<(?:html|head|body|title|meta|div)\b/i.test(body.slice(0, 4_000))
}

export async function ingestWebsite(options: IngestWebsiteOptions): Promise<DnaPart> {
  const language: AdLanguage = options.language === 'en' ? 'en' : 'es'
  const baseFetch = options.fetchText || fetchSiteText
  const captured = new Map<string, string>()
  const fetchText: SiteFetchText = async (url, timeoutMs) => {
    const body = await baseFetch(url, timeoutMs)
    if (!url.startsWith('https://r.jina.ai/') && captured.size < 8 && looksLikeHtml(body)) captured.set(url, body)
    return body
  }
  let costUsd = 0
  const synthesize: SiteSynthesize | undefined = options.gateway
    ? async ({ system, user, temperature, maxTokens }) => {
      const result = await options.gateway!.json<Record<string, unknown>>({ system, user, temperature, maxTokens })
      costUsd += result.costUsd || 0
      const raw = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : {}
      return { raw }
    }
    : undefined

  const analyze = options.analyze || runSiteAnalysis
  const { analysis, normalizedUrl } = await analyze({
    url: options.url,
    language,
    notes: options.notes,
    fetchText,
    synthesize,
  })
  const pages = [...captured.entries()].map(([url, html]) => {
    const signals = extractPageSignals(html, url)
    return { url, text: [signals.title, signals.description, signals.text].filter(Boolean).join('\n') }
  })
  const commerceFacts = scanCommerceFacts(pages, language)
  return mapSiteAnalysis({
    analysis,
    url: normalizedUrl,
    fetchedAt: (options.now ? options.now() : new Date()).toISOString(),
    commerceFacts,
    pageText: pages.map((p) => p.text).join('\n').slice(0, 6_000),
    costUsd,
  })
}
