/**
 * Ad Pack engine — fact citation + normalized claim matching (owner feedback P0 #2 / #5).
 *
 * - The copy writer gets the confirmed facts as a CLOSED list with stable ids (F1, F2…) and cites
 *   them: inline `[[F3]]` markers (replaced here by the canonical fact text) and/or a structured
 *   `claims: [{field, sentenceIndex, factIds}]` list.
 * - The strict checker (verified-claims bank) no longer needs a verbatim copy: a claim sentence
 *   passes when it maps to ≥ 1 confirmed fact (cited, or the nearest facts) and its numbers,
 *   units and claim markers equal the fact's (accent/case/stopword-insensitive token matching);
 *   non-numeric wording may be paraphrased.
 * - mustAppear: which required offer facts a copy carries, and where (image offer line or caption).
 *
 * Pure, no I/O.
 */
import type { AdCopy, CopyClaim, DnaFact, FactKey, MustAppearKey } from './types.js'
import { extractNumericClaims } from './facts.js'
import { normalizeText } from './util.js'

// ---------------------------------------------------------------------------
// Fact ids
// ---------------------------------------------------------------------------

export interface IdFact {
  /** "F1", "F2"… (order of the confirmed facts; brand/offer names excluded). */
  id: string
  key: FactKey
  value: string
}

/** Closed, id'd list of confirmed facts the writer may cite. Stable for the same facts. */
export function factIdList(confirmed: DnaFact[]): IdFact[] {
  const out: IdFact[] = []
  const seen = new Set<string>()
  for (const f of confirmed) {
    if (f.key === 'brand_name' || f.key === 'offer_name') continue
    const v = f.value.trim()
    const sig = `${f.key}|${normalizeText(v)}`
    if (!v || seen.has(sig)) continue
    seen.add(sig)
    out.push({ id: `F${out.length + 1}`, key: f.key, value: v })
  }
  return out
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

export interface SentenceSpan {
  text: string
  start: number
  end: number
}

/**
 * Sentence-ish chunks with offsets (claims are judged per sentence): split after . ! ? ; : when
 * followed by whitespace, on new lines and on " · " / " • " / " | " separators.
 */
export function claimSentenceSpans(text: string): SentenceSpan[] {
  const src = String(text ?? '')
  const out: SentenceSpan[] = []
  const re = /(?<=[.!?¡¿;:])\s+|\n+|\s+[·•|]\s+/g
  let last = 0
  const push = (a: number, b: number) => {
    const raw = src.slice(a, b)
    const lead = raw.length - raw.trimStart().length
    const t = raw.trim()
    if (t) out.push({ text: t, start: a + lead, end: a + lead + t.length })
  }
  for (const m of src.matchAll(re)) {
    push(last, m.index ?? 0)
    last = (m.index ?? 0) + m[0].length
  }
  push(last, src.length)
  return out
}

export function claimSentences(text: string): string[] {
  return claimSentenceSpans(text).map((s) => s.text)
}

// ---------------------------------------------------------------------------
// Inline citation markers: [[F3]] → canonical fact text
// ---------------------------------------------------------------------------

const MARKER_RE = /\[\[\s*(F\d{1,3}(?:\s*,\s*F\d{1,3})*)\s*\]\]/gi

/** Lowercase the first letter of an inserted fact mid-sentence ("y envío gratis…"), never "WhatsApp" / "SINPE". */
function midSentenceCase(value: string): string {
  const first = value.match(/^\p{L}+/u)?.[0]
  if (!first) return value
  const uppers = [...first].filter((c) => c !== c.toLowerCase()).length
  if (uppers !== 1 || first[0] === first[0].toLowerCase()) return value
  return value[0].toLowerCase() + value.slice(1)
}

export interface CitationResult {
  text: string
  /** Claims recorded for this field (sentence index after replacement). */
  claims: CopyClaim[]
  /** Fact keys cited. */
  keys: FactKey[]
  /** Marker ids that are not in the closed list (left in the text; the checker flags them). */
  unknownIds: string[]
}

/** Replace `[[F3]]` / `[[F2, F5]]` markers with the canonical fact text and record the citations. */
export function applyCitations(text: string, field: string, facts: IdFact[]): CitationResult {
  const byId = new Map(facts.map((f) => [f.id.toUpperCase(), f]))
  const src = String(text ?? '')
  const inserted: Array<{ start: number; ids: string[] }> = []
  const unknownIds: string[] = []
  let out = ''
  let last = 0
  for (const m of src.matchAll(MARKER_RE)) {
    const idx = m.index ?? 0
    const ids = m[1].split(',').map((s) => s.trim().toUpperCase())
    const known = ids.map((id) => byId.get(id)).filter((f): f is IdFact => Boolean(f))
    const unknown = ids.filter((id) => !byId.has(id))
    out += src.slice(last, idx)
    last = idx + m[0].length
    if (unknown.length || !known.length) {
      unknownIds.push(...unknown)
      out += m[0]
      continue
    }
    const before = out.replace(/\s+$/, '')
    const atStart = !before || /[.!?¡¿:\n·•|]$/.test(before)
    const value = known.map((f) => f.value).join(' · ')
    inserted.push({ start: out.length, ids: known.map((f) => f.id) })
    out += atStart ? value : midSentenceCase(value)
  }
  out += src.slice(last)
  const spans = claimSentenceSpans(out)
  const claims: CopyClaim[] = []
  for (const ins of inserted) {
    const sentenceIndex = spans.findIndex((s) => ins.start >= s.start && ins.start < s.end + 1)
    if (sentenceIndex < 0) continue
    const prev = claims.find((c) => c.sentenceIndex === sentenceIndex)
    if (prev) prev.factIds = [...new Set([...prev.factIds, ...ins.ids])]
    else claims.push({ field, sentenceIndex, factIds: ins.ids })
  }
  const keys = [...new Set(inserted.flatMap((i) => i.ids.map((id) => byId.get(id)!.key)))]
  return { text: out.replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim(), claims, keys, unknownIds }
}

/** Writer-declared claims `[{field, sentenceIndex, factIds}]` (unknown ids / bad shapes dropped). */
export function parseClaims(raw: unknown, facts: IdFact[]): CopyClaim[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set(facts.map((f) => f.id))
  const out: CopyClaim[] = []
  for (const c of raw.slice(0, 40)) {
    if (!c || typeof c !== 'object') continue
    const r = c as Record<string, unknown>
    const field = typeof r.field === 'string' ? r.field.trim().slice(0, 40) : ''
    const sentenceIndex = Number(r.sentenceIndex ?? r.sentence ?? 0)
    const factIds = (Array.isArray(r.factIds) ? r.factIds : []).map((x) => String(x).trim().toUpperCase()).filter((x) => ids.has(x))
    if (!field || !Number.isInteger(sentenceIndex) || sentenceIndex < 0 || !factIds.length) continue
    out.push({ field, sentenceIndex, factIds: [...new Set(factIds)] })
  }
  return out
}

// ---------------------------------------------------------------------------
// Normalized token matching
// ---------------------------------------------------------------------------

const STOP = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'con', 'por', 'para',
  'que', 'tu', 'tus', 'su', 'sus', 'mi', 'mis', 'es', 'son', 'lo', 'le', 'les', 'se', 'te', 'me', 'nos', 'sin', 'mas', 'muy', 'ya',
  'the', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'your', 'you', 'is', 'are', 'it', 'at', 'by', 'from', 'our', 'we',
])

/** Persuasion / glue words that never carry a claim on their own. */
const GENERIC = new Set([
  'trae', 'traen', 'incluye', 'incluyen', 'incluido', 'incluida', 'incluidos', 'incluidas', 'viene', 'vienen', 'tiene', 'tienen',
  'tenes', 'tienes', 'tiene', 'queres', 'quieres', 'pedi', 'pedilo', 'pedila', 'pide', 'pidelo', 'escribinos', 'escribenos', 'escribanos',
  'llevalo', 'llevala', 'lleva', 'llevate', 'regala', 'regalale', 'compra', 'compralo', 'listo', 'lista', 'listos', 'todo', 'toda',
  'todos', 'todas', 'cada', 'solo', 'menos', 'bien', 'ideal', 'perfecto', 'perfecta', 'hoy', 'ahora', 'desde', 'hasta', 'cuando',
  'donde', 'como', 'porque', 'este', 'esta', 'estos', 'estas', 'eso', 'esto', 'ese', 'esa', 'vos', 'usted', 'ustedes', 'tuyo', 'tuya',
  'nuestro', 'nuestra', 'nuestros', 'nuestras', 'aca', 'aqui', 'casa', 'puerta', 'hacemos', 'tambien', 'otra', 'otro', 'mismo',
  'misma', 'caja', 'kit', 'kits', 'pack', 'combo', 'producto', 'precio', 'unidad', 'unidades', 'pieza', 'piezas',
  'includes', 'include', 'comes', 'come', 'with', 'get', 'order', 'yours', 'every', 'each', 'all', 'just', 'only', 'today', 'now',
  'sale', 'salen', 'queda', 'quedan', 'cuesta', 'cuestan', 'vale', 'valen', 'llega', 'llegan', 'recibis', 'recibes', 'pagas', 'llevando',
  'llevas', 'llevar', 'comprando', 'compras', 'pidiendo', 'pedis', 'pides', 'usar', 'usalo', 'usa', 'lado', 'junto', 'juntos',
])

/** Words after a number that are not its unit ("₡14.900 cada uno", "2 o más"). */
const NON_UNIT = new Set(['cada', 'solo', 'nada', 'mas', 'menos', 'hoy', 'todo', 'total', 'colones', 'crc', 'usd', 'dolares', 'each', 'only', 'per', 'plus'])

/** Simple Spanish/English plural stem: "kits" → "kit", "baterias" → "bateria", "anos" → "ano". */
export function stem(token: string): string {
  if (token.length > 5 && token.endsWith('es') && !/[aeiou]es$/.test(token)) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function tokens(text: string): string[] {
  return normalizeText(text)
    .replace(/[₡$€%]/g, ' ')
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t && !/^\d+$/.test(t))
}

/** Content tokens (stemmed) that can carry a claim: no stopwords, glue words or spelled numbers, ≥ 3 letters. */
export function keyTokens(text: string): string[] {
  return [...new Set(tokens(text).filter((t) => t.length >= 3 && !STOP.has(t) && !GENERIC.has(t) && !Object.prototype.hasOwnProperty.call(SPELLED_QTY, t) && !markerWord(t)).map(stem))]
}

/** Claim marker classes: a sentence that uses one must be backed by a fact that carries it too. */
export const MARKER_CLASSES: Array<{ id: string; re: RegExp; keys: FactKey[] }> = [
  { id: 'free', re: /\b(?:gratis|gratuit[oa]s?|free|sin costo)\b/, keys: ['custom:free_shipping_rule'] },
  { id: 'shipping', re: /\b(?:envio|envios|enviamos|shipping|ships|delivery|entrega|entregamos|correos)\b/, keys: ['shipping', 'delivery_time', 'custom:free_shipping_rule'] },
  { id: 'guarantee', re: /\b(?:garantia|garantizad[oa]s?|guarantee[ds]?|warranty)\b/, keys: ['guarantee', 'returns'] },
  { id: 'age', re: /\b(?:edad|anos|ages?|years old|supervision|adulto)\b|\d+\s*\+/, keys: ['custom:age'] },
  { id: 'assembly', re: /\b(?:armas|arma|armado|armada|armalo|armala|ensambla\w*|assembl\w*|montas)\b/, keys: [] },
  { id: 'speed', re: /\b(?:listo en|lista en|ready in|en minutos|in minutes|en segundos|in seconds|al instante|instantly)\b/, keys: [] },
  { id: 'certified', re: /\b(?:certificad[oa]s?|certified|aprobad[oa]s?|approved|clinicamente|clinically|dermatologicamente|probado|tested)\b/, keys: ['certification'] },
  { id: 'superlative', re: /\b(?:el mejor|la mejor|los mejores|las mejores|the best|numero 1|number one|unico|unica|only one)\b|#1(?!\d)/, keys: [] },
  { id: 'battery', re: /\b(?:dura|duran|lasts|bateria|baterias|battery|batteries|autonomia)\b/, keys: [] },
  { id: 'discount', re: /\b(?:descuento|discount|ahorr\w*|save|rebaja|2x1|promo)\b|%/, keys: ['compare_at_price', 'bundle'] },
  { id: 'payment', re: /\b(?:sinpe|tarjeta|efectivo|pago|pagos|pagas|paga|transferencia|card|cash)\b/, keys: ['payment_methods'] },
]

function markerWord(t: string): boolean {
  return MARKER_CLASSES.some((m) => m.id !== 'battery' && m.id !== 'payment' && m.re.test(t))
}

export function markerClassesOf(text: string): string[] {
  const n = normalizeText(text)
  return MARKER_CLASSES.filter((m) => m.re.test(n)).map((m) => m.id)
}

/** Numbers of a text (canonical values), with the word that follows each one (its unit). */
export function numbersWithUnits(text: string): Array<{ value: string; raw: string; unit?: string }> {
  const src = String(text ?? '')
  const out: Array<{ value: string; raw: string; unit?: string }> = extractNumericClaims(src)
    .filter((c) => /\d/.test(c.raw))
    .map((c) => {
      const after = normalizeText(src.slice(c.index + c.raw.length, c.index + c.raw.length + 40)).replace(/^[\s+x×-]+/, '')
      const word = after.match(/^([a-zñ]{2,})/)?.[1]
      const unit = word && !STOP.has(word) && !NON_UNIT.has(word) ? stem(word) : undefined
      return { value: c.value, raw: c.raw.trim(), ...(unit ? { unit } : {}) }
    })
  // Spelled quantities before a noun ("dos kits", "tres baterías") are numbers too ("un/una" are articles).
  for (const m of normalizeText(src).matchAll(SPELLED_QTY_RE)) {
    const word = m[2]
    if (STOP.has(word) || NON_UNIT.has(word)) continue
    out.push({ value: String(SPELLED_QTY[m[1]]), raw: m[0], unit: stem(word) })
  }
  return out
}

const SPELLED_QTY: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const SPELLED_QTY_RE = new RegExp(`\\b(${Object.keys(SPELLED_QTY).join('|')})\\s+([a-zñ]{2,})`, 'g')

export interface ClaimMatch {
  ok: boolean
  /** Why it failed (rule), e.g. "number 3 not in the facts". */
  reason?: string
  offendingTokens: string[]
  nearest?: IdFact
}

function factProfile(f: IdFact) {
  const n = normalizeText(f.value)
  return {
    f,
    nums: new Set([...extractNumericClaims(f.value).map((c) => c.value), ...numbersWithUnits(f.value).map((c) => c.value)]),
    toks: new Set([...tokens(f.value).map(stem), ...keyTokens(f.value)]),
    markers: new Set([...MARKER_CLASSES.filter((m) => m.re.test(n)).map((m) => m.id), ...MARKER_CLASSES.filter((m) => m.keys.includes(f.key)).map((m) => m.id)]),
  }
}

type Profile = ReturnType<typeof factProfile>

function evaluate(sentence: string, set: Profile[], extraTokens: Set<string>): ClaimMatch {
  const nums = new Set<string>()
  const toks = new Set<string>(extraTokens)
  const markers = new Set<string>()
  for (const p of set) {
    p.nums.forEach((v) => nums.add(v))
    p.toks.forEach((v) => toks.add(v))
    p.markers.forEach((v) => markers.add(v))
  }
  const offending: string[] = []
  const reasons: string[] = []
  for (const n of numbersWithUnits(sentence)) {
    if (!nums.has(n.value)) {
      offending.push(n.raw)
      reasons.push(`number ${n.raw} is not in the cited facts`)
      continue
    }
    // The number and its unit must come from the SAME fact ("3 kits" is not backed by "3 baterías").
    if (n.unit && !set.some((p) => p.nums.has(n.value) && p.toks.has(n.unit!)) && !extraTokens.has(n.unit)) {
      offending.push(`${n.raw} ${n.unit}`)
      reasons.push(`"${n.raw} ${n.unit}": no fact has ${n.raw} with that unit`)
    }
  }
  const sMarkers = markerClassesOf(sentence)
  for (const m of sMarkers) {
    if (m === 'battery' || m === 'payment') continue
    if (!markers.has(m)) {
      offending.push(m)
      reasons.push(`"${m}" claim has no backing fact`)
    }
  }
  // "Gratis con dos kits" is not "Envío gratis desde 2 kits": when the backing fact's free thing is
  // the shipping, the sentence must say it is the shipping that is free.
  if (sMarkers.includes('free') && !sMarkers.includes('shipping')) {
    const free = set.filter((p) => p.markers.has('free'))
    if (free.length && free.every((p) => p.markers.has('shipping'))) {
      offending.push('gratis')
      reasons.push('the fact makes the SHIPPING free ("envío gratis…"), not the product')
    }
  }
  const key = keyTokens(sentence)
  const uncovered = key.filter((t) => !toks.has(t))
  if (uncovered.length >= 2 && uncovered.length / key.length >= 0.5) {
    offending.push(...uncovered.slice(0, 6))
    reasons.push(`wording not backed by the facts: ${uncovered.slice(0, 4).join(', ')}`)
  }
  return { ok: offending.length === 0, ...(reasons.length ? { reason: reasons.join('; ') } : {}), offendingTokens: [...new Set(offending)] }
}

/**
 * Does a claim sentence trace to the confirmed facts? Cited facts first; when the citation is
 * missing or does not hold, the facts that share a number / claim marker / ≥ 2 key words with the
 * sentence are tried together (nearest-fact mapping). Paraphrase is fine for non-numeric wording.
 */
export function matchClaim(sentence: string, facts: IdFact[], opts: { cited?: string[]; nameTokens?: string[] } = {}): ClaimMatch {
  const profiles = facts.map(factProfile)
  const names = new Set((opts.nameTokens ?? []).flatMap((t) => keyTokens(t)))
  const nearest = nearestFact(sentence, facts)
  if (opts.cited?.length) {
    const cited = profiles.filter((p) => opts.cited!.includes(p.f.id))
    if (cited.length) {
      const r = evaluate(sentence, cited, names)
      if (r.ok) return { ...r, nearest: cited[0].f }
    }
  }
  const sNums = new Set(numbersWithUnits(sentence).map((n) => n.value))
  const sMarkers = new Set(markerClassesOf(sentence))
  const sKey = new Set(keyTokens(sentence))
  const related = profiles.filter((p) => {
    const sharedKey = [...sKey].filter((t) => p.toks.has(t)).length
    return [...sNums].some((v) => p.nums.has(v)) || [...sMarkers].some((m) => p.markers.has(m) && m !== 'battery') || sharedKey >= Math.min(2, sKey.size)
  })
  if (!related.length) {
    const r = evaluate(sentence, [], names)
    return { ok: false, reason: r.reason ?? 'no confirmed fact says this', offendingTokens: r.offendingTokens.length ? r.offendingTokens : [...sKey].slice(0, 6), ...(nearest ? { nearest } : {}) }
  }
  const r = evaluate(sentence, related, names)
  return { ...r, ...(nearest ? { nearest } : {}) }
}

/** Fact closest to a sentence (shared numbers weigh most, then key words). */
export function nearestFact(sentence: string, facts: IdFact[]): IdFact | undefined {
  const sNums = new Set(numbersWithUnits(sentence).map((n) => n.value))
  const sKey = new Set([...keyTokens(sentence), ...tokens(sentence).map(stem)])
  const sMarkers = new Set(markerClassesOf(sentence))
  let best: IdFact | undefined
  let bestScore = 0
  for (const p of facts.map(factProfile)) {
    const score =
      3 * [...sNums].filter((v) => p.nums.has(v)).length +
      [...sKey].filter((t) => p.toks.has(t)).length +
      1.5 * [...sMarkers].filter((m) => p.markers.has(m)).length
    if (score > bestScore) {
      bestScore = score
      best = p.f
    }
  }
  return best
}

const NEGATION_RE = /\b(?:no|sin|not|without|excluye|excluded)\b/

/** True when `text` carries the fact: verbatim (normalized) or every number + ≥ 70% of its key words in one sentence. */
export function textCarriesFact(text: string, fact: { value: string }): boolean {
  const n = normalizeText(text)
  const v = normalizeText(fact.value).replace(/[.!?]+$/g, '').trim()
  if (!v) return true
  if (n.includes(v)) return true
  const fNums = new Set(extractNumericClaims(fact.value).map((c) => c.value))
  const fKey = keyTokens(fact.value)
  for (const s of claimSentences(text)) {
    const sNums = new Set(extractNumericClaims(s).map((c) => c.value))
    if (![...fNums].every((x) => sNums.has(x))) continue
    const sTok = new Set([...tokens(s).map(stem), ...keyTokens(s)])
    const fMarkers = markerClassesOf(fact.value)
    const sMarkers = new Set(markerClassesOf(s))
    if (!fMarkers.every((m) => sMarkers.has(m))) continue
    // "Papel no incluido" is not carried by "un avión de papel": a negated fact needs the negation.
    if (NEGATION_RE.test(normalizeText(fact.value)) && !NEGATION_RE.test(normalizeText(s))) continue
    const covered = fKey.filter((t) => sTok.has(t)).length
    if (!fKey.length || covered / fKey.length >= 0.7) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// mustAppear
// ---------------------------------------------------------------------------

/** Fact keys behind each mustAppear group. */
export const MUST_APPEAR_FACT_KEYS: Record<MustAppearKey, FactKey[]> = {
  price: ['price'],
  compare_at_price: ['compare_at_price'],
  bundle: ['bundle'],
  shipping: ['shipping', 'custom:free_shipping_rule'],
  age: ['custom:age'],
  not_included: ['custom:not_included'],
  contact: ['custom:contact_cta', 'custom:whatsapp'],
  payment_methods: ['payment_methods'],
}

/** Groups that may sit on the image offer line; the rest always go in the caption. */
const OFFER_LINE_GROUPS: ReadonlySet<MustAppearKey> = new Set(['price', 'bundle', 'shipping', 'compare_at_price'])

export interface MustAppearItem {
  group: MustAppearKey
  fact: DnaFact
  /** 'line_or_caption' = the image offer line (or any on-image text) or the caption; 'caption' = caption only. */
  where: 'line_or_caption' | 'caption'
}

/** Required facts for an offer (confirmed facts of the requested groups; groups without a fact are skipped). */
export function mustAppearItems(confirmed: DnaFact[], groups: readonly MustAppearKey[] | undefined): MustAppearItem[] {
  if (!groups?.length) return []
  const out: MustAppearItem[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const key of MUST_APPEAR_FACT_KEYS[group] ?? []) {
      for (const fact of confirmed.filter((f) => f.key === key)) {
        const sig = normalizeText(fact.value)
        if (seen.has(sig)) continue
        seen.add(sig)
        out.push({ group, fact, where: OFFER_LINE_GROUPS.has(group) ? 'line_or_caption' : 'caption' })
      }
      // One contact line is enough: the composed CTA wins over the bare WhatsApp number.
      if (group === 'contact' && out.some((o) => o.group === 'contact')) break
    }
    if (group === 'contact' && !out.some((o) => o.group === 'contact')) {
      const fact = contactFallbackFact(confirmed)
      if (fact && !seen.has(normalizeText(fact.value))) {
        seen.add(normalizeText(fact.value))
        out.push({ group, fact, where: 'caption' })
      }
    }
  }
  return out
}

/** A confirmed line that names a reachable channel with its handle/number ("WhatsApp 7113-3720"). */
const CONTACT_LINE_RE = /\b(?:whats\s?app|wa\.me|tel\.?|telefono|phone|llam\w*|escrib\w*)\b[^\n]{0,24}\d{4}[-\s]?\d{3,4}/

/**
 * Round-1 feedback P5: offers saved without `contact` (no custom:contact_cta) still carry the
 * owner's channel in a confirmed claim ("WhatsApp 7113-3720") or a CTA ("Escribinos por DM").
 * Prefer the line with a number, then the owner's CTA text.
 */
export function contactFallbackFact(confirmed: DnaFact[]): DnaFact | undefined {
  const withNumber = confirmed.find((f) => (f.key === 'custom:allowed_claim' || f.key === 'custom:verified_claim' || f.key === 'custom:phone') && CONTACT_LINE_RE.test(normalizeText(f.value)))
  return withNumber ?? confirmed.find((f) => f.key === 'custom:cta')
}

/** On-image text of a copy (where price/bundle/shipping may live instead of the caption). */
export function onImageText(copy: Pick<AdCopy, 'headline' | 'subline' | 'bullets' | 'offerLine'>): string {
  return [copy.offerLine ?? '', copy.headline ?? '', copy.subline ?? '', ...(copy.bullets ?? [])].filter(Boolean).join('\n')
}

/**
 * Required facts the copy does not carry where they must be. `captionOnly`: every required fact
 * must be in the caption itself (generated captions are complete, P1 #11); otherwise price /
 * bundle / shipping may live on the image instead (owner edits).
 */
export function missingMustAppear(copy: AdCopy, items: MustAppearItem[], opts: { captionOnly?: boolean } = {}): MustAppearItem[] {
  const image = onImageText(copy)
  return items.filter((it) => {
    if (textCarriesFact(copy.caption ?? '', it.fact)) return false
    if (!opts.captionOnly && it.where === 'line_or_caption' && textCarriesFact(image, it.fact)) return false
    return true
  })
}

/** A closing call to action ("Escribinos y pedí el tuyo.", "Message us to order."). */
const CTA_SENTENCE_RE = /^(?:escrib\w*|ped\w*|pid\w*|mand\w*|envian\w*|llam\w*|reserv\w*|compr\w*|consegu\w*|hace tu pedido|order|message|dm|call|text|shop|get yours|buy)\b/

const GROUP_ORDER: MustAppearKey[] = ['price', 'compare_at_price', 'bundle', 'shipping', 'not_included', 'age', 'payment_methods', 'contact']

/**
 * The caption with every missing required fact appended as canonical text (deterministic, never
 * model-written): offer facts first ("₡14.900 · 2 kits por ₡29.800 · Envío gratis desde 2 kits."),
 * then not-included, age, payment and the contact CTA last. The model part is trimmed at a
 * sentence/word boundary when the result would pass `maxChars`.
 */
export function captionWithRequiredFacts(caption: string, missing: MustAppearItem[], maxChars: number, truncate: (t: string, max: number) => string): string {
  if (!missing.length) return caption
  const sorted = [...missing].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  const end = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`)
  const offerParts = sorted.filter((m) => OFFER_LINE_GROUPS.has(m.group)).map((m) => m.fact.value.trim())
  const rest = sorted.filter((m) => !OFFER_LINE_GROUPS.has(m.group)).map((m) => end(m.fact.value.trim()))
  const footer = [offerParts.length ? end(offerParts.join(' · ')) : '', ...rest].filter(Boolean).join(' ')
  let body = String(caption ?? '').trim()
  // The CTA closes the caption: facts go before the model's closing CTA, and the confirmed contact
  // CTA (when it is appended) replaces a generic one ("Escribinos y pedí el tuyo.").
  const spans = claimSentenceSpans(body)
  const lastSpan = spans[spans.length - 1]
  let tail = ''
  if (spans.length > 1 && lastSpan && CTA_SENTENCE_RE.test(normalizeText(lastSpan.text))) {
    const hasContact = sorted.some((m) => m.group === 'contact')
    tail = hasContact ? '' : lastSpan.text
    body = body.slice(0, lastSpan.start).trim()
  }
  if (tail) {
    const withTail = captionWithRequiredFacts(body, missing, maxChars - tail.length - 1, truncate)
    return `${withTail} ${tail}`.trim()
  }
  const room = maxChars - footer.length - 1
  const head = room <= 0 ? '' : body.length > room ? truncate(body, room) : body
  return [head ? end(head) : '', footer].filter(Boolean).join(' ').slice(0, Math.max(maxChars, footer.length))
}
