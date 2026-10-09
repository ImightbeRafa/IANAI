/**
 * Ad Pack engine — deterministic copy checker + one-shot targeted repair.
 *
 * checkAdCopy: facts (numbers/prices/percentages/timings must match confirmed
 * values; "gratis"/"garantía" need backing facts), lengths, greetings,
 * placeholders, forbidden phrases, compliance pack, near-duplicates.
 * repairAdCopy: ONE LLM rewrite of only the failing fields, then re-check.
 */
import type { AdAngle, AdCopy, AdLanguage, BrandDna, CopyCheckIssue, CopyCheckResult, FactKey, ModelGateway, OfferInput } from './types.js'
import { clicheExamples, findCliches } from './cliches.js'
import { checkCompliance } from './compliance.js'
import {
  ADPACK_COPY_MODEL,
  buildCopyContext,
  defaultSceneFallback,
  factsAllowlistBlock,
  normalizeModelCopy,
  sceneBriefRequestsText,
  type CopyContext,
  type RawModelCopy,
} from './copy-shared.js'
import { extractNumericClaims, numbersInFacts } from './facts.js'
import { IAN_CORE_RULES, REGISTER_DRIFT_MARKERS, registerInstruction } from './ian-rules.js'
import { COPY_LIMITS, FORMAT_PATTERNS, headlineMaxWords } from './patterns.js'
import { contentWordCount, normalizeText, textSimilarity, wordCount } from './util.js'

export interface CheckAdCopyOptions {
  dna: BrandDna
  offer: OfferInput
  angle: AdAngle
  language: AdLanguage
  /** Other copies in the same pack, for near-duplicate detection. */
  otherCopies?: AdCopy[]
}

type Field = CopyCheckIssue['field']

interface TextField {
  field: Field
  text: string
}

function textFields(copy: AdCopy): TextField[] {
  const out: TextField[] = [{ field: 'headline', text: copy.headline ?? '' }]
  if (copy.subline) out.push({ field: 'subline', text: copy.subline })
  for (const b of copy.bullets ?? []) out.push({ field: 'bullets', text: b })
  if (copy.offerLine) out.push({ field: 'offerLine', text: copy.offerLine })
  out.push({ field: 'cta', text: copy.cta ?? '' })
  out.push({ field: 'caption', text: copy.caption ?? '' })
  if (copy.script) {
    out.push({ field: 'script', text: copy.script.hook ?? '' })
    out.push({ field: 'script', text: copy.script.development ?? '' })
    out.push({ field: 'script', text: copy.script.cta ?? '' })
  }
  return out
}

// ---------------------------------------------------------------------------
// Pattern sets
// ---------------------------------------------------------------------------

const GREETING_START_RE =
  /^\s*[¡!¿]?\s*(?:hola|holi|holis|buen(?:os|as)\s+(?:dias|tardes|noches)|bienvenid[oa]s?|saludos|que tal|hey|hi|hello|welcome|greetings|good (?:morning|afternoon|evening))\b/
const GREETING_ANY_RE = /\b(?:hola|bienvenid[oa]s|como estan|como esta usted|como estas|how are you)\b/

const PLACEHOLDER_RES: RegExp[] = [
  /\[[^\]]*\]/,
  /\{[^}]*\}/,
  /\bX{3,}\b/i,
  /_{2,}/,
  /\b(?:TBD|TODO|FIXME)\b/,
  /\blorem ipsum\b/i,
  /[₡¢$€]\s?X+\b/i,
  /\((?:cantidad|precio|nombre|ubicacion|ubicación|horario|quantity|price|name|location)\)/i,
  /<[^>]{1,40}>/,
]

const FREE_RE = /\b(?:gratis|gratuit[oa]s?|sin costo|free of charge|for free|free shipping|free delivery|ships free|free consultation|free trial|free gift)\b/
const FREE_FACT_RE = /\b(?:gratis|gratuit[oa]s?|sin costo|free)\b/
const GUARANTEE_RE = /\b(?:garantia|garantizad[oa]s?|guarantee[ds]?|warranty|devolucion de (?:tu|su) dinero|money[- ]back)\b/

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export function checkAdCopy(copy: AdCopy, options: CheckAdCopyOptions): CopyCheckResult {
  const ctx = buildCopyContext(options.dna, options.offer, options.angle, options.language)
  const issues: CopyCheckIssue[] = []
  const push = (code: CopyCheckIssue['code'], field: Field, detail: string) => {
    if (!issues.some((i) => i.code === code && i.field === field && i.detail === detail)) issues.push({ code, field, detail })
  }

  checkEmptyAndLength(copy, options.angle, push)
  const fields = textFields(copy)

  // Greetings + placeholders
  for (const { field, text } of fields) {
    const n = normalizeText(text)
    if (GREETING_START_RE.test(n) || GREETING_ANY_RE.test(n)) push('greeting', field, `Greeting in "${text.slice(0, 60)}"`)
    for (const re of PLACEHOLDER_RES) {
      const m = text.match(re)
      if (m) {
        push('placeholder', field, `Placeholder "${m[0]}"`)
        break
      }
    }
  }
  for (const re of PLACEHOLDER_RES) {
    const m = copy.sceneBrief?.match(re)
    if (m) {
      push('placeholder', 'sceneBrief', `Placeholder "${m[0]}"`)
      break
    }
  }

  checkFacts(copy, ctx, fields, push)

  // Spanish register drift (e.g. voseo "Escribinos" in an usted brand). Customer quotes in
  // quotation marks are the customer's own words and are not checked.
  if (options.language === 'es') {
    const own = options.dna.register ?? 'tuteo'
    for (const { field, text } of fields) {
      if (field === 'offerLine') continue
      const unquoted = text.replace(/["“”«»][^"“”«»]*["“”«»]/g, ' ')
      for (const other of Object.keys(REGISTER_DRIFT_MARKERS) as Array<keyof typeof REGISTER_DRIFT_MARKERS>) {
        if (other === own) continue
        const m = unquoted.match(REGISTER_DRIFT_MARKERS[other])
        if (m) push('register', field, `"${m[0]}" is ${other}; this brand writes in ${own}`)
      }
    }
  }

  // Generic clichés (deterministic blocklist): repairable, the one targeted rewrite replaces them.
  for (const { field, text } of fields) {
    if (field === 'offerLine') continue
    const unquoted = text.replace(/["“”«»][^"“”«»]*["“”«»]/g, ' ')
    for (const hit of findCliches(unquoted)) push('cliche', field, `Generic cliché "${hit.match}" (${hit.example}); say the specific benefit, situation or fact instead`)
  }

  // Forbidden phrases (brand list)
  for (const phrase of options.dna.forbiddenPhrases ?? []) {
    const p = normalizeText(phrase)
    if (!p) continue
    for (const { field, text } of [...fields, { field: 'sceneBrief' as Field, text: copy.sceneBrief ?? '' }]) {
      if (normalizeText(text).includes(p)) push('forbidden_phrase', field, `Forbidden phrase "${phrase}"`)
    }
  }
  if (copy.sceneBrief && sceneBriefRequestsText(copy.sceneBrief)) {
    push('forbidden_phrase', 'sceneBrief', 'Scene brief asks for on-image text/letters/logos')
  }

  // Compliance (per field so issues point at the right place) + format-level rules.
  for (const { field, text } of fields) {
    for (const hit of checkCompliance(text, options.dna.category, options.language, { facts: ctx.facts })) {
      if (hit.severity === 'block') push('compliance', field, `${hit.ruleId}: ${hit.detail} ("${hit.match}")`)
    }
  }
  const allText = fields.map((f) => f.text).join('\n')
  for (const hit of checkCompliance(allText, options.dna.category, options.language, { facts: ctx.facts, format: options.angle.format })) {
    if (hit.severity !== 'block') continue
    if (hit.ruleId === 'missing_disclaimer' || hit.ruleId === 'format_not_allowed') push('compliance', 'caption', `${hit.ruleId}: ${hit.detail}`)
  }

  // Repetition inside the ad: the caption sits under the image, so restating a chip or the
  // subline word for word adds nothing (judge's lowest criterion in the live benchmark).
  const cap = normalizeText(copy.caption ?? '')
  for (const piece of [...(copy.bullets ?? []), copy.subline ?? '']) {
    const p = normalizeText(piece).replace(/[.!?¡¿]+$/g, '').trim()
    if (p && contentWordCount(piece) >= 2 && cap.includes(p)) push('duplicate_message', 'caption', `Caption repeats "${piece}" from the image`)
  }

  // Near-duplicates vs other copies in the pack
  for (const other of options.otherCopies ?? []) {
    if (!other || other === copy) continue
    if (copy.headline && other.headline && (normalizeText(copy.headline) === normalizeText(other.headline) || textSimilarity(copy.headline, other.headline) >= 0.6)) {
      push('duplicate_message', 'headline', `Headline too similar to "${other.headline}"`)
    } else if (copy.headline && other.headline && sameOpener(copy.headline, other.headline)) {
      // Live benchmark: 3 of 10 headlines in a pack opened with "No compres…".
      push('duplicate_message', 'headline', `Headline opens like "${other.headline}"; use a different structure`)
    }
    const a = `${copy.headline} ${copy.subline ?? ''}`
    const b = `${other.headline} ${other.subline ?? ''}`
    if (copy.subline && other.subline && textSimilarity(a, b) >= 0.7) push('duplicate_message', 'subline', `Message too similar to "${b.trim()}"`)
    if (copy.caption && other.caption && textSimilarity(copy.caption, other.caption) >= 0.75) {
      push('duplicate_message', 'caption', 'Caption nearly identical to another ad in the pack')
    }
  }

  return { ok: issues.length === 0, issues }
}

/** Same first two words (ignoring punctuation/case/accents), e.g. "No compres sérum…" vs "No compres café…". */
export function sameOpener(a: string, b: string): boolean {
  const words = (s: string) => normalizeText(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const wa = words(a)
  const wb = words(b)
  if (wa.length < 3 || wb.length < 3) return false
  return wa[0] === wb[0] && wa[1] === wb[1]
}

function checkEmptyAndLength(
  copy: AdCopy,
  angle: AdAngle,
  push: (code: CopyCheckIssue['code'], field: Field, detail: string) => void
): void {
  const L = COPY_LIMITS
  if (!copy.headline?.trim()) push('empty_field', 'headline', 'Headline is empty')
  if (!copy.cta?.trim()) push('empty_field', 'cta', 'CTA is empty')
  if (!copy.caption?.trim()) push('empty_field', 'caption', 'Caption is empty')
  else if (copy.caption.trim().length < L.captionMinChars) push('empty_field', 'caption', `Caption shorter than ${L.captionMinChars} chars`)
  if (!copy.sceneBrief?.trim()) push('empty_field', 'sceneBrief', 'Scene brief is empty')

  const hMax = headlineMaxWords(angle.format)
  if (wordCount(copy.headline) > hMax) push('too_long', 'headline', `Headline has ${wordCount(copy.headline)} words (max ${hMax})`)
  if ((copy.headline ?? '').length > L.headlineChars) push('too_long', 'headline', `Headline has ${copy.headline.length} chars (max ${L.headlineChars})`)
  if (wordCount(copy.subline) > L.sublineWords) push('too_long', 'subline', `Subline has ${wordCount(copy.subline)} words (max ${L.sublineWords})`)
  if ((copy.bullets ?? []).length > L.maxBullets) push('too_long', 'bullets', `${copy.bullets.length} bullets (max ${L.maxBullets})`)
  for (const b of copy.bullets ?? []) {
    if (!b.trim()) push('empty_field', 'bullets', 'Empty bullet')
    else if (contentWordCount(b) > L.bulletWords) push('too_long', 'bullets', `Bullet "${b}" has ${contentWordCount(b)} words (max ${L.bulletWords})`)
    else if (b.length > L.bulletChars) push('too_long', 'bullets', `Bullet "${b}" has ${b.length} chars (max ${L.bulletChars})`)
  }
  const minBullets = FORMAT_PATTERNS[angle.format].bulletsAreSteps ? 2 : 0
  if ((copy.bullets ?? []).length < minBullets) push('empty_field', 'bullets', `Format ${angle.format} needs at least ${minBullets} steps`)
  if (contentWordCount(copy.cta) > L.ctaWords) push('too_long', 'cta', `CTA has ${contentWordCount(copy.cta)} words (max ${L.ctaWords})`)
  else if ((copy.cta ?? '').length > L.ctaChars) push('too_long', 'cta', `CTA has ${copy.cta.length} chars (max ${L.ctaChars})`)
  if ((copy.caption ?? '').length > L.captionMaxChars) push('too_long', 'caption', `Caption has ${copy.caption.length} chars (max ${L.captionMaxChars})`)
  if ((copy.offerLine ?? '').length > L.offerLineChars) push('too_long', 'offerLine', `Offer line has ${copy.offerLine!.length} chars (max ${L.offerLineChars})`)
  if ((copy.sceneBrief ?? '').length > L.sceneBriefMaxChars) push('too_long', 'sceneBrief', `Scene brief has ${copy.sceneBrief.length} chars (max ${L.sceneBriefMaxChars})`)
  if (copy.script) {
    if (!copy.script.hook?.trim() || !copy.script.development?.trim() || !copy.script.cta?.trim()) push('empty_field', 'script', 'Script part is empty')
    if (wordCount(copy.script.hook) > L.scriptHookWords) push('too_long', 'script', `Script hook over ${L.scriptHookWords} words`)
    if (wordCount(copy.script.development) > L.scriptDevelopmentWords) push('too_long', 'script', `Script development over ${L.scriptDevelopmentWords} words`)
    if (wordCount(copy.script.cta) > L.scriptCtaWords) push('too_long', 'script', `Script CTA over ${L.scriptCtaWords} words`)
  }
}

function checkFacts(
  copy: AdCopy,
  ctx: CopyContext,
  fields: TextField[],
  push: (code: CopyCheckIssue['code'], field: Field, detail: string) => void
): void {
  const confirmedNums = numbersInFacts(ctx.confirmed)
  const unconfirmedNums = numbersInFacts(ctx.unconfirmed)
  const confirmedText = ctx.confirmed.map((f) => normalizeText(f.value)).join(' | ')
  const confirmedKeys = new Set<FactKey>(ctx.confirmed.map((f) => f.key))

  for (const { field, text } of fields) {
    if (field === 'offerLine') continue
    const masked = maskStructural(text)
    for (const claim of extractNumericClaims(masked)) {
      if (confirmedNums.has(claim.value)) continue
      if (unconfirmedNums.has(claim.value)) push('unconfirmed_fact', field, `"${claim.raw.trim()}" comes from an unconfirmed fact`)
      else push('number_mismatch', field, `"${claim.raw.trim()}" does not match any confirmed fact`)
    }
    const n = normalizeText(text)
    if (FREE_RE.test(n) && !FREE_FACT_RE.test(confirmedText)) push('unconfirmed_fact', field, '"Free/gratis" claim without a confirmed fact')
    if (GUARANTEE_RE.test(n) && !confirmedKeys.has('guarantee') && !confirmedKeys.has('returns')) {
      push('unconfirmed_fact', field, 'Guarantee claim without a confirmed guarantee/returns fact')
    }
    for (const f of ctx.unconfirmed) {
      const v = normalizeText(f.value)
      if (v.length >= 4 && n.includes(v)) push('unconfirmed_fact', field, `Uses unconfirmed ${f.key}: "${f.value}"`)
    }
  }

  // Offer line must be exactly the deterministic one.
  if ((copy.offerLine ?? '') !== (ctx.offerLine ?? '')) {
    push('number_mismatch', 'offerLine', ctx.offerLine ? `Offer line must be "${ctx.offerLine}"` : 'No confirmed price/bundle: offer line must be empty')
  }
  for (const k of copy.usedFactKeys ?? []) {
    if (!confirmedKeys.has(k)) push('unconfirmed_fact', 'usedFactKeys', `Fact key "${k}" is not confirmed`)
  }
}

/** Neutralize structural counts ("3 pasos", "Paso 2", "1. ") so they are not read as claims. */
function maskStructural(text: string): string {
  return text
    .replace(/(^|\s)(paso|step|opci[oó]n|option|#)\s*\d+\b/gi, '$1$2 N')
    .replace(/\b\d+(\s+)(pasos|steps|razones|reasons|motivos|formas|ways|opciones|options|tips|claves|keys|preguntas|questions)\b/gi, 'N$1$2')
    .replace(/^\s*\d+[.)-]\s/, 'N. ')
}

// ---------------------------------------------------------------------------
// Repair (one targeted rewrite)
// ---------------------------------------------------------------------------

export interface RepairAdCopyInput {
  gateway: ModelGateway
  copy: AdCopy
  issues: CopyCheckIssue[]
  dna: BrandDna
  offer: OfferInput
  angle: AdAngle
  language: AdLanguage
  otherCopies?: AdCopy[]
  model?: string
}

export interface RepairAdCopyResult {
  copy: AdCopy
  check: CopyCheckResult
  costUsd: number
  repaired: boolean
  error?: string
}

/** Fields the model may rewrite. offerLine/usedFactKeys are code-owned. */
const REPAIRABLE: Array<keyof AdCopy> = ['headline', 'subline', 'bullets', 'cta', 'caption', 'script', 'sceneBrief']

export async function repairAdCopy(input: RepairAdCopyInput): Promise<RepairAdCopyResult> {
  const { gateway, copy, issues, dna, offer, angle, language } = input
  const recheck = (c: AdCopy) => checkAdCopy(c, { dna, offer, angle, language, otherCopies: input.otherCopies })
  const failing = [...new Set(issues.map((i) => i.field))].filter((f): f is keyof AdCopy => REPAIRABLE.includes(f as keyof AdCopy))
  if (!issues.length || !failing.length) {
    // Code-owned fields (offerLine, usedFactKeys) are fixed deterministically.
    const ctx = buildCopyContext(dna, offer, angle, language)
    const fixed = normalizeModelCopy({ ...copy, usedFactKeys: copy.usedFactKeys }, ctx, copy.sceneBrief)
    return { copy: fixed, check: recheck(fixed), costUsd: 0, repaired: false }
  }
  const ctx = buildCopyContext(dna, offer, angle, language)
  const L = COPY_LIMITS
  const system = [
    IAN_CORE_RULES[language],
    registerInstruction(dna.register, language),
    language === 'es'
      ? `Corrige SOLO los campos indicados de este anuncio. No toques los demás. Nada de frases hechas genéricas (${clicheExamples().slice(0, 8).join(' / ')}): decí la situación o el dato concreto. Límites: headline ≤ ${headlineMaxWords(angle.format)} palabras; subline ≤ ${L.sublineWords}; bullets ≤ ${L.maxBullets} de ≤ ${L.bulletWords} palabras y ≤ ${L.bulletChars} caracteres; cta ≤ ${L.ctaWords} palabras y ≤ ${L.ctaChars} caracteres; nada se repite entre titular, subtítulo, chips y caption; mantené el trato de la marca; caption ${L.captionMinChars}–${L.captionMaxChars} caracteres; sceneBrief solo visual, sin pedir texto/letras/logos. Responde SOLO JSON con los campos corregidos.`
      : `Fix ONLY the listed fields of this ad. Do not touch the rest. No generic stock phrases (${clicheExamples().slice(15).join(' / ')}): state the concrete situation or fact. Limits: headline ≤ ${headlineMaxWords(angle.format)} words; subline ≤ ${L.sublineWords}; bullets ≤ ${L.maxBullets} of ≤ ${L.bulletWords} words and ≤ ${L.bulletChars} chars; cta ≤ ${L.ctaWords} words and ≤ ${L.ctaChars} chars; nothing repeats across headline, subline, chips and caption; caption ${L.captionMinChars}–${L.captionMaxChars} chars; sceneBrief visual only, never ask for text/letters/logos. Reply with JSON only containing the fixed fields.`,
  ].join('\n\n')
  const user = [
    factsAllowlistBlock(ctx),
    (dna.forbiddenPhrases ?? []).length ? `${language === 'es' ? 'Frases prohibidas' : 'Forbidden phrases'}: ${dna.forbiddenPhrases!.join(' | ')}` : '',
    `${language === 'es' ? 'Mensaje del anuncio' : 'Ad message'}: ${angle.message}`,
    `${language === 'es' ? 'Campos a corregir' : 'Fields to fix'}: ${failing.join(', ')}`,
    `${language === 'es' ? 'Problemas' : 'Issues'}:\n${issues.map((i) => `- [${i.field}] ${i.code}: ${i.detail}`).join('\n')}`,
    `${language === 'es' ? 'Copy actual' : 'Current copy'}: ${JSON.stringify(pickFields(copy, failing))}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  try {
    const res = await gateway.json<RawModelCopy>({ system, user, model: input.model ?? ADPACK_COPY_MODEL, temperature: 0.3, maxTokens: 900 })
    const patch = (res.data ?? {}) as Record<string, unknown>
    const merged: RawModelCopy = { ...copy }
    for (const f of failing) if (patch[f] !== undefined) (merged as Record<string, unknown>)[f] = patch[f]
    const next = normalizeModelCopy(merged, ctx, defaultSceneFallback(ctx, FORMAT_PATTERNS[angle.format].sceneIntent))
    return { copy: next, check: recheck(next), costUsd: res.costUsd, repaired: true }
  } catch (error) {
    return { copy, check: recheck(copy), costUsd: 0, repaired: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function pickFields(copy: AdCopy, fields: Array<keyof AdCopy>): Partial<AdCopy> {
  const out: Partial<AdCopy> = {}
  for (const f of fields) (out as Record<string, unknown>)[f] = copy[f]
  return out
}
