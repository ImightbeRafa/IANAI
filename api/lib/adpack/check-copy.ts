/**
 * Ad Pack engine — deterministic copy checker + one-shot targeted repair.
 *
 * checkAdCopy: facts (numbers/prices/percentages/timings must match confirmed
 * values; "gratis"/"garantía" need backing facts), lengths, greetings,
 * placeholders, forbidden phrases, compliance pack, near-duplicates.
 * repairAdCopy: ONE LLM rewrite of only the failing fields, then re-check.
 */
import type { AdAngle, AdCopy, AdLanguage, BrandDna, CopyCheckIssue, CopyCheckResult, FactKey, ModelGateway, OfferInput } from './types.js'
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
import { HARD_REGISTER_MARKERS, IAN_CORE_RULES, isHardRegister, REGISTER_DRIFT_MARKERS, registerInstruction } from './ian-rules.js'
import { COPY_LIMITS, FORMAT_PATTERNS, headlineMaxWords } from './patterns.js'
import { contentWordCount, normalizeText, textSimilarity, wordCount } from './util.js'

export interface CheckAdCopyOptions {
  dna: BrandDna
  offer: OfferInput
  angle: AdAngle
  language: AdLanguage
  /** Other copies in the same pack, for near-duplicate detection. */
  otherCopies?: AdCopy[]
  /**
   * The owner typed this copy (adpack_edit_text / web edit_text): chips get a little more room
   * (EDIT_BULLET_LIMITS) and a hand-written offer line is accepted when every part of it is a
   * confirmed fact or a stated exclusion.
   */
  userEdit?: boolean
}

/** Chip limits for owner edits ("Kit ₡14.900 · Papel no incluido" is a legit chip). */
export const EDIT_BULLET_LIMITS = { words: 6, chars: 34 } as const

type Field = CopyCheckIssue['field']

interface TextField {
  field: Field
  /** "bullets[2]", "script.hook", … */
  path: string
  text: string
}

interface IssueExtra {
  path?: string
  limit?: number
  actual?: number
  token?: string
}

type Push = (code: CopyCheckIssue['code'], field: Field, detail: string, extra?: IssueExtra) => void

function textFields(copy: AdCopy): TextField[] {
  const out: TextField[] = [{ field: 'headline', path: 'headline', text: copy.headline ?? '' }]
  if (copy.subline) out.push({ field: 'subline', path: 'subline', text: copy.subline })
  ;(copy.bullets ?? []).forEach((b, i) => out.push({ field: 'bullets', path: `bullets[${i}]`, text: b }))
  if (copy.offerLine) out.push({ field: 'offerLine', path: 'offerLine', text: copy.offerLine })
  out.push({ field: 'cta', path: 'cta', text: copy.cta ?? '' })
  out.push({ field: 'caption', path: 'caption', text: copy.caption ?? '' })
  if (copy.script) {
    out.push({ field: 'script', path: 'script.hook', text: copy.script.hook ?? '' })
    out.push({ field: 'script', path: 'script.development', text: copy.script.development ?? '' })
    out.push({ field: 'script', path: 'script.cta', text: copy.script.cta ?? '' })
  }
  return out
}

/** Stating a limitation ("Papel no incluido") is not a promise. */
const EXCLUSION_RE = /\b(?:no incluid[oa]s?|no incluye|no viene(?:n)? incluid[oa]s?|no trae|sin incluir|se vende por separado|not included|does not include|doesn't include|sold separately|excluded?)\b/

export function isExclusionStatement(text: string): boolean {
  return EXCLUSION_RE.test(normalizeText(text))
}

/** Segments of a chip / line split on the usual separators ("Kit ₡14.900 · Papel no incluido"). */
function segments(text: string): string[] {
  return text.split(/\s*[·•|;]\s*|\s+[-–—]\s+/).map((t) => t.trim()).filter(Boolean)
}

export interface ForbiddenHit {
  /** The brand's phrase / claim as written in the kit. */
  phrase: string
  kind: 'phrase' | 'claim'
  /** Exact location: "headline", "bullets[1]", "caption", "script.hook", "sceneBrief"… */
  field: string
  baseField: Field
}

function forbiddenList(dna: BrandDna): string[] {
  return [...(dna.forbiddenPhrases ?? []), ...(dna.forbiddenClaims ?? [])].map((p) => p.trim()).filter(Boolean)
}

/**
 * Brand forbidden phrases + forbidden claims found in the ad: on-image text (headline, subline,
 * chips, offer line, CTA), caption, script and scene brief. Accent/case-insensitive. Pure.
 */
export function findForbiddenHits(copy: AdCopy | undefined, dna: Pick<BrandDna, 'forbiddenPhrases' | 'forbiddenClaims'>): ForbiddenHit[] {
  if (!copy) return []
  const lists: Array<[ForbiddenHit['kind'], string[]]> = [['phrase', dna.forbiddenPhrases ?? []], ['claim', dna.forbiddenClaims ?? []]]
  const where = [...textFields(copy), { field: 'sceneBrief' as Field, path: 'sceneBrief', text: copy.sceneBrief ?? '' }]
  const out: ForbiddenHit[] = []
  for (const [kind, list] of lists) {
    for (const phrase of list) {
      const p = normalizeText(phrase)
      if (!p) continue
      for (const { field, path, text } of where) {
        if (normalizeText(text).includes(p) && !out.some((h) => h.field === path && normalizeText(h.phrase) === p)) {
          out.push({ phrase, kind, field: path, baseField: field })
        }
      }
    }
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
  const push: Push = (code, field, detail, extra = {}) => {
    const path = extra.path ?? field
    if (issues.some((i) => i.code === code && (i.path ?? i.field) === path && i.detail === detail)) return
    issues.push({
      code,
      field,
      detail,
      ...(path !== field ? { path } : {}),
      ...(extra.limit !== undefined ? { limit: extra.limit } : {}),
      ...(extra.actual !== undefined ? { actual: extra.actual } : {}),
      ...(extra.token !== undefined ? { token: extra.token } : {}),
    })
  }

  checkEmptyAndLength(copy, options.angle, push, options.userEdit === true)
  const fields = textFields(copy)

  // Greetings + placeholders
  for (const { field, path, text } of fields) {
    const n = normalizeText(text)
    if (GREETING_START_RE.test(n) || GREETING_ANY_RE.test(n)) push('greeting', field, `Greeting in "${text.slice(0, 60)}"`, { path })
    for (const re of PLACEHOLDER_RES) {
      const m = text.match(re)
      if (m) {
        push('placeholder', field, `Placeholder "${m[0]}"`, { path, token: m[0] })
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

  checkFacts(copy, ctx, fields, push, options)

  // Spanish register. With a locale (es-CR + voseo…) the register is a HARD rule: any form of
  // another register is blocking ('locale_register', repaired once, else the ad fails). Without
  // a locale it stays a soft drift note ('register'). Customer quotes in quotation marks are the
  // customer's own words and are not checked.
  if (options.language === 'es') {
    const own = options.dna.register ?? 'tuteo'
    const hard = isHardRegister(options.dna)
    for (const { field, path, text } of fields) {
      if (field === 'offerLine') continue
      const unquoted = text.replace(/["“”«»][^"“”«»]*["“”«»]/g, ' ')
      for (const other of Object.keys(REGISTER_DRIFT_MARKERS) as Array<keyof typeof REGISTER_DRIFT_MARKERS>) {
        if (other === own) continue
        const m = unquoted.match(hard ? HARD_REGISTER_MARKERS[other] : REGISTER_DRIFT_MARKERS[other])
        if (!m) continue
        if (hard) push('locale_register', field, `"${m[0]}" is ${other}; locale ${options.dna.locale} requires ${own}`, { path, token: m[0] })
        else push('register', field, `"${m[0]}" is ${other}; this brand writes in ${own}`, { path, token: m[0] })
      }
    }
  }

  // Forbidden phrases + forbidden claims (brand lists) on every on-image field, caption, script and scene brief.
  for (const hit of findForbiddenHits(copy, options.dna)) {
    push('forbidden_phrase', hit.baseField, `Forbidden ${hit.kind} "${hit.phrase}"`, { path: hit.field, token: hit.phrase })
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

function checkEmptyAndLength(copy: AdCopy, angle: AdAngle, push: Push, userEdit: boolean): void {
  const L = COPY_LIMITS
  const bulletWords = userEdit ? EDIT_BULLET_LIMITS.words : L.bulletWords
  const bulletChars = userEdit ? EDIT_BULLET_LIMITS.chars : L.bulletChars
  if (!copy.headline?.trim()) push('empty_field', 'headline', 'Headline is empty')
  if (!copy.cta?.trim()) push('empty_field', 'cta', 'CTA is empty')
  if (!copy.caption?.trim()) push('empty_field', 'caption', 'Caption is empty')
  else if (copy.caption.trim().length < L.captionMinChars) {
    push('empty_field', 'caption', `Caption shorter than ${L.captionMinChars} chars`, { limit: L.captionMinChars, actual: copy.caption.trim().length })
  }
  if (!copy.sceneBrief?.trim()) push('empty_field', 'sceneBrief', 'Scene brief is empty')

  const hMax = headlineMaxWords(angle.format)
  const hWords = wordCount(copy.headline)
  if (hWords > hMax) push('too_long', 'headline', `Headline has ${hWords} words (max ${hMax})`, { limit: hMax, actual: hWords })
  if ((copy.headline ?? '').length > L.headlineChars) {
    push('too_long', 'headline', `Headline has ${copy.headline.length} chars (max ${L.headlineChars})`, { limit: L.headlineChars, actual: copy.headline.length })
  }
  const sWords = wordCount(copy.subline)
  if (sWords > L.sublineWords) push('too_long', 'subline', `Subline has ${sWords} words (max ${L.sublineWords})`, { limit: L.sublineWords, actual: sWords })
  if ((copy.bullets ?? []).length > L.maxBullets) {
    push('too_long', 'bullets', `${copy.bullets.length} bullets (max ${L.maxBullets})`, { limit: L.maxBullets, actual: copy.bullets.length })
  }
  ;(copy.bullets ?? []).forEach((b, i) => {
    const path = `bullets[${i}]`
    if (!b.trim()) {
      push('empty_field', 'bullets', 'Empty bullet', { path })
      return
    }
    // Separator glyphs ("·") are not words.
    const w = contentWordCount(b.replace(/(^|\s)[·•|]+(?=\s|$)/g, ' '))
    if (w > bulletWords) push('too_long', 'bullets', `Bullet "${b}" has ${w} words (max ${bulletWords})`, { path, limit: bulletWords, actual: w })
    else if (b.length > bulletChars) push('too_long', 'bullets', `Bullet "${b}" has ${b.length} chars (max ${bulletChars})`, { path, limit: bulletChars, actual: b.length })
  })
  const minBullets = FORMAT_PATTERNS[angle.format].bulletsAreSteps ? 2 : 0
  if ((copy.bullets ?? []).length < minBullets) {
    push('empty_field', 'bullets', `Format ${angle.format} needs at least ${minBullets} steps`, { limit: minBullets, actual: (copy.bullets ?? []).length })
  }
  const ctaWords = contentWordCount(copy.cta)
  if (ctaWords > L.ctaWords) push('too_long', 'cta', `CTA has ${ctaWords} words (max ${L.ctaWords})`, { limit: L.ctaWords, actual: ctaWords })
  else if ((copy.cta ?? '').length > L.ctaChars) push('too_long', 'cta', `CTA has ${copy.cta.length} chars (max ${L.ctaChars})`, { limit: L.ctaChars, actual: copy.cta.length })
  if ((copy.caption ?? '').length > L.captionMaxChars) {
    push('too_long', 'caption', `Caption has ${copy.caption.length} chars (max ${L.captionMaxChars})`, { limit: L.captionMaxChars, actual: copy.caption.length })
  }
  if ((copy.offerLine ?? '').length > L.offerLineChars) {
    push('too_long', 'offerLine', `Offer line has ${copy.offerLine!.length} chars (max ${L.offerLineChars})`, { limit: L.offerLineChars, actual: copy.offerLine!.length })
  }
  if ((copy.sceneBrief ?? '').length > L.sceneBriefMaxChars) {
    push('too_long', 'sceneBrief', `Scene brief has ${copy.sceneBrief.length} chars (max ${L.sceneBriefMaxChars})`, { limit: L.sceneBriefMaxChars, actual: copy.sceneBrief.length })
  }
  if (copy.script) {
    if (!copy.script.hook?.trim() || !copy.script.development?.trim() || !copy.script.cta?.trim()) push('empty_field', 'script', 'Script part is empty')
    const parts: Array<['hook' | 'development' | 'cta', number]> = [['hook', L.scriptHookWords], ['development', L.scriptDevelopmentWords], ['cta', L.scriptCtaWords]]
    for (const [part, max] of parts) {
      const n = wordCount(copy.script[part])
      if (n > max) push('too_long', 'script', `Script ${part === 'cta' ? 'CTA' : part} over ${max} words`, { path: `script.${part}`, limit: max, actual: n })
    }
  }
}

function checkFacts(copy: AdCopy, ctx: CopyContext, fields: TextField[], push: Push, options: CheckAdCopyOptions): void {
  const confirmedNums = numbersInFacts(ctx.confirmed)
  const unconfirmedNums = numbersInFacts(ctx.unconfirmed)
  const confirmedText = ctx.confirmed.map((f) => normalizeText(f.value)).join(' | ')
  const allFactText = [...ctx.confirmed, ...ctx.unconfirmed].map((f) => normalizeText(f.value)).join(' | ')
  const confirmedKeys = new Set<FactKey>(ctx.confirmed.map((f) => f.key))
  /** An exclusion the facts state ("Papel no incluido") is allowed anywhere: it limits, never promises. */
  const statedExclusion = (segment: string) => isExclusionStatement(segment) && allFactText.includes(normalizeText(segment).replace(/[.!]+$/, ''))

  for (const { field, path, text } of fields) {
    if (field === 'offerLine') continue
    const bulletIndex = field === 'bullets' ? Number(path.slice(8, -1)) : -1
    const masked = maskStructural(text, bulletIndex, FORMAT_PATTERNS[options.angle.format].bulletsAreSteps)
    for (const claim of extractNumericClaims(masked)) {
      if (confirmedNums.has(claim.value)) continue
      const token = claim.raw.trim()
      if (unconfirmedNums.has(claim.value)) push('unconfirmed_fact', field, `"${token}" comes from an unconfirmed fact`, { path, token })
      else push('number_mismatch', field, `"${token}" does not match any confirmed fact`, { path, token })
    }
    // Claims are judged without the stated exclusions ("Garantía no incluida" is not a guarantee claim).
    const claimText = segments(text).filter((seg) => !statedExclusion(seg)).join(' · ')
    const n = normalizeText(claimText)
    const free = n.match(FREE_RE)
    if (free && !FREE_FACT_RE.test(confirmedText)) push('unconfirmed_fact', field, '"Free/gratis" claim without a confirmed fact', { path, token: free[0] })
    const guarantee = n.match(GUARANTEE_RE)
    if (guarantee && !confirmedKeys.has('guarantee') && !confirmedKeys.has('returns')) {
      push('unconfirmed_fact', field, 'Guarantee claim without a confirmed guarantee/returns fact', { path, token: guarantee[0] })
    }
    for (const f of ctx.unconfirmed) {
      const v = normalizeText(f.value)
      if (v.length >= 4 && n.includes(v) && !isExclusionStatement(f.value)) push('unconfirmed_fact', field, `Uses unconfirmed ${f.key}: "${f.value}"`, { path, token: f.value })
    }
  }

  checkNotIncluded(ctx, fields, push)
  if (ctx.offer.strictClaims) checkTraceableClaims(ctx, fields, push, statedExclusion)

  // Offer line: the deterministic one, or (owner edit) a line whose every part is a confirmed fact / stated exclusion.
  const line = copy.offerLine ?? ''
  if (line !== (ctx.offerLine ?? '')) {
    const problem = options.userEdit && line ? offerLineProblem(line, confirmedNums, confirmedText, statedExclusion) : line || '(empty)'
    if (problem) {
      const detail = options.userEdit && line
        ? `Offer line part "${problem}" is not a confirmed fact`
        : ctx.offerLine ? `Offer line must be "${ctx.offerLine}"` : 'No confirmed price/bundle: offer line must be empty'
      push('number_mismatch', 'offerLine', detail, { token: problem })
    }
  }
  for (const k of copy.usedFactKeys ?? []) {
    if (!confirmedKeys.has(k)) push('unconfirmed_fact', 'usedFactKeys', `Fact key "${k}" is not confirmed`, { token: k })
  }
}

// ---------------------------------------------------------------------------
// Negative facts + verified-claims bank (owner feedback B5 / H7)
// ---------------------------------------------------------------------------

const INCLUSION_RE = /\b(?:incluye|incluyen|incluido|incluida|incluidos|incluidas|viene con|vienen con|trae|traen|con todo|includes|included|comes with|come with)\b/
const NEGATION_NEAR_RE = /\b(?:no|sin|not|without|excluye|excluded|aparte|separately|separado)\b/

/** Sentence-ish chunks of a field (claims are judged per sentence). */
export function claimSentences(text: string): string[] {
  return String(text ?? '')
    .split(/(?<=[.!?¡¿;:])\s+|\n+|\s+[·•|]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** "Papel no incluido" on the offer → copy may never say paper is included. */
function checkNotIncluded(ctx: CopyContext, fields: TextField[], push: Push): void {
  const items = (ctx.offer.notIncluded ?? []).map((i) => ({ raw: i, n: normalizeText(i) })).filter((i) => i.n.length >= 3)
  if (!items.length) return
  for (const { field, path, text } of fields) {
    for (const sentence of claimSentences(text)) {
      const n = normalizeText(sentence)
      for (const item of items) {
        if (!new RegExp(`\\b${item.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(n)) continue
        if (INCLUSION_RE.test(n) && !NEGATION_NEAR_RE.test(n)) {
          push('unconfirmed_fact', field, `not_included: "${sentence.slice(0, 80)}" says ${item.raw} is included, but the offer says it is not`, { path, token: item.raw })
        }
      }
    }
  }
}

/**
 * Claim-like sentence markers (normalized text). Plain persuasion ("Ideal para tus
 * tardes") is not a claim; promises about price, shipping, contents, age, assembly,
 * results, certifications and superlatives are.
 */
const CLAIM_MARKER_RE = new RegExp([
  '\\b(?:gratis|gratuit[oa]s?|free)\\b',
  '\\b(?:envio|envios|enviamos|shipping|ships|delivery|entrega|entregamos)\\b',
  '\\b(?:garantia|garantizad[oa]s?|guarantee[ds]?|warranty)\\b',
  '\\b(?:incluye|incluyen|incluido|incluida|incluidos|incluidas|viene con|vienen con|trae|traen|includes|included|comes with)\\b',
  '\\b(?:edad|anos|ages?|years old)\\b|\\d+\\s*\\+',
  '\\b(?:armas|arma|armado|armada|armalo|armala|ensambla\\w*|assembl\\w*|montas|listo en|lista en|ready in|en minutos|in minutes)\\b',
  '\\b(?:certificad[oa]s?|certified|aprobad[oa]s?|approved|clinicamente|clinically|dermatologicamente|probado|tested)\\b',
  '%',
  '#1(?!\\d)',
  '\\b(?:el mejor|la mejor|los mejores|las mejores|the best|numero 1|number one|unico|unica|only one)\\b',
  '\\b(?:dura|duran|lasts|bateria|battery|autonomia)\\b',
  '\\b(?:descuento|discount|ahorr\\w*|save|rebaja|oferta|2x1|promo)\\b',
  '\\b(?:dos|tres|cuatro|cinco|two|three|four|five)\\s+(?:o mas|or more|kits?|unidades|units|piezas|pieces|paquetes|packs?)\\b',
].join('|'))

/** Facts that can back a claim (not the brand/offer names). */
function tracingValues(ctx: CopyContext): string[] {
  return ctx.confirmed
    .filter((f) => f.key !== 'brand_name' && f.key !== 'offer_name')
    .map((f) => normalizeText(f.value).replace(/[.!?]+$/g, '').trim())
    .filter((v) => v.length >= 3)
}

/**
 * Verified-claims bank: every claim-like sentence must contain (verbatim, accent- and
 * case-insensitive) a confirmed fact or verified claim — "gratis con dos kits" fails
 * when the fact is "Envío gratis desde 2 kits".
 */
function checkTraceableClaims(ctx: CopyContext, fields: TextField[], push: Push, statedExclusion: (s: string) => boolean): void {
  const values = tracingValues(ctx)
  for (const { field, path, text } of fields) {
    if (field === 'offerLine' || field === 'cta') continue
    for (const sentence of claimSentences(text)) {
      // A stated exclusion ("Papel no incluido") limits, never promises.
      if (statedExclusion(sentence)) continue
      const n = normalizeText(sentence)
      if (!CLAIM_MARKER_RE.test(n)) continue
      if (values.some((v) => n.includes(v))) continue
      push('unconfirmed_fact', field, `untraceable_claim: "${sentence.slice(0, 90)}" is not one of the confirmed facts or verified claims (copy them exactly)`, { path, token: sentence.slice(0, 90) })
    }
  }
}

/** First part of an owner-written offer line that no confirmed fact backs, or null when every part is backed. */
function offerLineProblem(line: string, confirmedNums: Set<string>, confirmedText: string, statedExclusion: (s: string) => boolean): string | null {
  for (const seg of segments(line)) {
    if (statedExclusion(seg)) continue
    const nums = extractNumericClaims(seg)
    if (nums.some((c) => !confirmedNums.has(c.value))) return seg
    // Labels around a confirmed number ("Kit ₡14.900", "Antes ₡19.900") are fine; a part with no number must be a confirmed fact.
    if (!nums.length && !confirmedText.includes(normalizeText(seg))) return seg
  }
  return null
}

/**
 * Neutralize structural numbers so they are not read as claims: counts ("3 pasos"), labels
 * ("Paso 2", "1. "), zero-padded step indices ("01", "02/03") and, in a chip, a leading number
 * equal to its position ("1 Doblá el papel" as the first chip) or any leading index in a steps format.
 */
function maskStructural(text: string, bulletIndex = -1, stepsFormat = false): string {
  let out = text
    .replace(/(^|\s)(paso|step|opci[oó]n|option|#)\s*\d+\b/gi, '$1$2 N')
    .replace(/\b\d+(\s+)(pasos|steps|razones|reasons|motivos|formas|ways|opciones|options|tips|claves|keys|preguntas|questions)\b/gi, 'N$1$2')
    .replace(/^\s*\d+[.)-]\s/, 'N. ')
    // "01" · "02/03": nobody writes a price or a quantity zero-padded.
    .replace(/(^|[^\d.,₡¢$€£%])0[1-9](?![\d.,%])/g, '$1N')
  if (bulletIndex >= 0) {
    const lead = out.match(/^\s*(\d{1,2})(?=\s*[.):·\-–/]?\s*\p{L})/u)
    if (lead && (stepsFormat || Number(lead[1]) === bulletIndex + 1)) out = out.replace(lead[1], 'N')
  }
  return out
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
    registerInstruction(dna.register, language, dna.locale),
    language === 'es'
      ? `Corrige SOLO los campos indicados de este anuncio. No toques los demás. Límites: headline ≤ ${headlineMaxWords(angle.format)} palabras; subline ≤ ${L.sublineWords}; bullets ≤ ${L.maxBullets} de ≤ ${L.bulletWords} palabras y ≤ ${L.bulletChars} caracteres; cta ≤ ${L.ctaWords} palabras y ≤ ${L.ctaChars} caracteres; nada se repite entre titular, subtítulo, chips y caption; mantené el trato de la marca; caption ${L.captionMinChars}–${L.captionMaxChars} caracteres; sceneBrief solo visual, sin pedir texto/letras/logos. Responde SOLO JSON con los campos corregidos.`
      : `Fix ONLY the listed fields of this ad. Do not touch the rest. Limits: headline ≤ ${headlineMaxWords(angle.format)} words; subline ≤ ${L.sublineWords}; bullets ≤ ${L.maxBullets} of ≤ ${L.bulletWords} words and ≤ ${L.bulletChars} chars; cta ≤ ${L.ctaWords} words and ≤ ${L.ctaChars} chars; nothing repeats across headline, subline, chips and caption; caption ${L.captionMinChars}–${L.captionMaxChars} chars; sceneBrief visual only, never ask for text/letters/logos. Reply with JSON only containing the fixed fields.`,
  ].join('\n\n')
  const user = [
    factsAllowlistBlock(ctx),
    forbiddenList(dna).length ? `${language === 'es' ? 'Frases y claims prohibidos' : 'Forbidden phrases and claims'}: ${forbiddenList(dna).join(' | ')}` : '',
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
