/**
 * Ad Pack engine — pieces shared by copy generation and copy repair:
 * fact allowlist, DNA redaction, scene-brief sanitizing, model-output normalizing.
 */
import type { AdAngle, AdCopy, AdLanguage, BrandDna, DnaFact, FactKey, OfferInput } from './types.js'
import { buildOfferLine, confirmedFacts, extractNumericClaims, mergeFacts, numbersInFacts, unconfirmedFacts } from './facts.js'
import { COPY_LIMITS, FORMAT_PATTERNS } from './patterns.js'
import { cleanString, escapeRegExp, normalizeText } from './util.js'

/**
 * Default text model for ad copy + repair. Live benchmark (2026-10): the gateway
 * default (grok-4.5) spent ~3.2k reasoning tokens and ~50 s per ad (~$0.035/ad),
 * which alone breaks the ≤3 min / ≤$0.60 pack gates; the fast reasoning model
 * takes ~9 s and ~$0.001 per ad with the same deterministic checks behind it.
 */
export const ADPACK_COPY_MODEL = 'grok-4-1-fast-reasoning'

export interface CopyContext {
  dna: BrandDna
  offer: OfferInput
  angle: AdAngle
  language: AdLanguage
  facts: DnaFact[]
  confirmed: DnaFact[]
  unconfirmed: DnaFact[]
  offerLine?: string
}

export function buildCopyContext(dna: BrandDna, offer: OfferInput, angle: AdAngle, language: AdLanguage): CopyContext {
  const facts = mergeFacts(dna, offer)
  return {
    dna,
    offer,
    angle,
    language,
    facts,
    confirmed: confirmedFacts(facts),
    unconfirmed: unconfirmedFacts(facts),
    offerLine: buildOfferLine(facts, language),
  }
}

/** Exact confirmed facts, one per line. The only claims the model may use. */
export function factsAllowlistBlock(ctx: CopyContext): string {
  const head =
    ctx.language === 'es'
      ? 'HECHOS CONFIRMADOS (ALLOWLIST — únicos datos, cifras, precios, plazos y promesas permitidos; cópialos EXACTOS):'
      : 'CONFIRMED FACTS (ALLOWLIST — the only data, figures, prices, timings and promises allowed; copy them EXACTLY):'
  const focus = new Set(ctx.angle.factKeys)
  const lines = ctx.confirmed.map((f) => `- ${f.key}${focus.has(f.key) ? ' *' : ''}: "${f.value}"`)
  const tail =
    ctx.language === 'es'
      ? '(* = hechos foco de este anuncio). Cualquier número, precio, porcentaje, plazo, garantía, envío gratis, reseña o resultado que NO esté arriba está PROHIBIDO.'
      : '(* = focus facts for this ad). Any number, price, percentage, timing, guarantee, free shipping, review or result NOT listed above is FORBIDDEN.'
  return [head, ...lines, tail].join('\n')
}

/** Remove unconfirmed fact values (and their stray numbers) from free DNA text. */
export function redactUnconfirmed(text: string | undefined, ctx: CopyContext): string {
  let out = cleanString(text ?? '')
  if (!out) return ''
  for (const f of ctx.unconfirmed) {
    const v = f.value.trim()
    if (v.length < 2) continue
    out = out.replace(new RegExp(escapeRegExp(v), 'gi'), '…')
  }
  const confirmedNums = numbersInFacts(ctx.confirmed)
  const badNums = new Set([...numbersInFacts(ctx.unconfirmed)].filter((n) => !confirmedNums.has(n)))
  if (badNums.size) {
    const claims = extractNumericClaims(out)
      .filter((c) => badNums.has(c.value) && /\d/.test(c.raw))
      .sort((a, b) => b.index - a.index)
    for (const c of claims) out = out.slice(0, c.index) + '…' + out.slice(c.index + c.raw.length)
  }
  return out
}

export function redactList(items: string[] | undefined, ctx: CopyContext, max = 6): string[] {
  return (items ?? []).map((t) => redactUnconfirmed(t, ctx)).filter((t) => t && t !== '…').slice(0, max)
}

// ---------------------------------------------------------------------------
// Scene brief
// ---------------------------------------------------------------------------

const TEXT_REQUEST_RE =
  /\b(?:text|texts|texto|textos|letras?|letters?|lettering|logos?|logotipos?|tipograf\w*|typograph\w*|fonts?|words?|palabras?|captions?|titulos?|headlines?|titulares?|watermarks?|marca de agua|letreros?|carteles?|signage|signs?|subtitulos?|subtitles?|numeros?|numbers?|precios?|prices?|price tags?|banners?|stickers? (?:with|con)|callout text|labels? (?:that|with|reading)|escrito|written|says|dice)\b/
const NEGATION_RE = /\b(?:no|sin|without|avoid|evita[r]?|nunca|never|ningun[oa]?|zero)\b/

export const SCENE_NO_TEXT_CLAUSE =
  'Leave clean empty space for the overlay. No added text, letters, numbers, logos, signs or watermarks anywhere in the scene (the product packaging may appear as it really is).'

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Keep visual-only clauses, cap length, append the no-text clause. Works per clause
 * (comma/semicolon), not per sentence: the live benchmark showed most briefs ended in
 * "…, empty space for text" and the whole sentence was dropped, so 70% of scenes fell
 * back to the generic format intent and lost the setting the copy model described.
 */
export function sanitizeSceneBrief(brief: string, fallback: string): string {
  const kept = sentences(cleanString(brief))
    .map((s) =>
      s
        .split(/\s*[,;]\s*/)
        .filter((c) => c && !TEXT_REQUEST_RE.test(normalizeText(c)))
        .join(', ')
        .replace(/[\s,]+$/, '')
    )
    .filter((s) => s.replace(/[.!?\s]/g, '').length > 0)
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
  let body = kept.join(' ').trim()
  if (!body) body = fallback
  const max = COPY_LIMITS.sceneBriefMaxChars - SCENE_NO_TEXT_CLAUSE.length - 1
  if (body.length > max) body = truncateAtBoundary(body, max)
  return `${body} ${SCENE_NO_TEXT_CLAUSE}`.trim()
}

/** True when the brief asks for on-image text (ignores negated sentences like "no text"). */
export function sceneBriefRequestsText(brief: string): boolean {
  const withoutClause = brief.replace(SCENE_NO_TEXT_CLAUSE, '')
  return sentences(withoutClause).some((s) => {
    const n = normalizeText(s)
    return TEXT_REQUEST_RE.test(n) && !NEGATION_RE.test(n)
  })
}

/** Cut at the last sentence end (or word boundary) before `max`. Never mid-word. */
export function truncateAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.\n'))
  if (sentenceEnd >= max * 0.5) return cut.slice(0, sentenceEnd + 1).trim()
  const space = cut.lastIndexOf(' ')
  const base = space > 0 ? cut.slice(0, space) : text.slice(0, max)
  return base.replace(/[\s,;:·–—-]+$/, '').trim()
}

// ---------------------------------------------------------------------------
// Model output → AdCopy
// ---------------------------------------------------------------------------

export interface RawModelCopy {
  headline?: unknown
  subline?: unknown
  bullets?: unknown
  cta?: unknown
  caption?: unknown
  script?: unknown
  sceneBrief?: unknown
  usedFactKeys?: unknown
}

/** "1. Limpiá", "Paso 2: Aplicá", "3) Listo" → bare step text (the template numbers steps). */
export function stripStepNumber(text: string): string {
  const out = text.replace(/^\s*(?:(?:paso|step)\s*)?\d{1,2}\s*[.):\-–—](?!\d)\s*/i, '').replace(/^\s*(?:paso|step)\s*\d{1,2}\s+/i, '').trim()
  return out || text
}

export function defaultSceneFallback(ctx: CopyContext, sceneIntent: string): string {
  return `${sceneIntent} Product: ${ctx.offer.name}.`
}

/**
 * Normalize model JSON into AdCopy. The offer line is ALWAYS the deterministic
 * one from confirmed facts; usedFactKeys is filtered to confirmed keys and
 * extended with keys whose values appear verbatim in the copy.
 */
export function normalizeModelCopy(raw: RawModelCopy | null | undefined, ctx: CopyContext, sceneFallback: string): AdCopy {
  const r = raw ?? {}
  // Step formats draw their own numbered badges: "1. Limpiá" would render as "① 1. Limpiá".
  const isSteps = Boolean(FORMAT_PATTERNS[ctx.angle.format]?.bulletsAreSteps)
  const bullets = (Array.isArray(r.bullets) ? r.bullets : [])
    .map((b) => cleanString(b))
    .map((b) => (isSteps ? stripStepNumber(b) : b))
    .filter(Boolean)
    .slice(0, COPY_LIMITS.maxBullets)
  const scriptRaw = (r.script && typeof r.script === 'object' ? r.script : {}) as Record<string, unknown>
  const script = {
    hook: cleanString(scriptRaw.hook),
    development: cleanString(scriptRaw.development),
    cta: cleanString(scriptRaw.cta),
  }
  const copy: AdCopy = {
    headline: cleanString(r.headline),
    bullets,
    cta: cleanString(r.cta),
    caption: truncateAtBoundary(String(typeof r.caption === 'string' ? r.caption : '').trim(), COPY_LIMITS.captionMaxChars),
    sceneBrief: sanitizeSceneBrief(cleanString(r.sceneBrief), sceneFallback),
    usedFactKeys: [],
  }
  const subline = cleanString(r.subline)
  if (subline) copy.subline = subline
  if (ctx.offerLine) copy.offerLine = ctx.offerLine
  if (script.hook && script.development && script.cta) copy.script = script
  copy.usedFactKeys = resolveUsedFactKeys(copy, ctx, Array.isArray(r.usedFactKeys) ? r.usedFactKeys : [])
  return copy
}

export function copyText(copy: AdCopy, opts: { includeOfferLine?: boolean } = {}): string {
  return [
    copy.headline,
    copy.subline ?? '',
    ...copy.bullets,
    opts.includeOfferLine ? copy.offerLine ?? '' : '',
    copy.cta,
    copy.caption,
    copy.script?.hook ?? '',
    copy.script?.development ?? '',
    copy.script?.cta ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function resolveUsedFactKeys(copy: AdCopy, ctx: CopyContext, claimed: unknown[]): FactKey[] {
  const confirmedKeySet = new Set(ctx.confirmed.map((f) => f.key))
  const out: FactKey[] = []
  const add = (k: FactKey) => {
    if (confirmedKeySet.has(k) && !out.includes(k)) out.push(k)
  }
  for (const k of claimed) if (typeof k === 'string') add(k as FactKey)
  const text = normalizeText(copyText(copy, { includeOfferLine: true }))
  for (const f of ctx.confirmed) if (f.value.trim().length >= 3 && text.includes(normalizeText(f.value))) add(f.key)
  return out
}
