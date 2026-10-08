/**
 * Ad Pack engine — fact sheet helpers.
 *
 * Merge DNA + offer facts, split confirmed vs unconfirmed, extract numeric claims
 * (₡/$, dots/commas, ranges, "mil", spelled time numbers) and build the
 * deterministic offer line. Pure, no I/O.
 */
import type { AdLanguage, BrandDna, DnaFact, FactKey, OfferInput } from './types.js'
import { normalizeText } from './util.js'

/**
 * DNA facts overridden by offer facts (same key → offer wins). `brand_name` and
 * `offer_name` are synthesized as confirmed when absent: the user typed them.
 */
export function mergeFacts(dna: BrandDna, offer: OfferInput): DnaFact[] {
  const byKey = new Map<string, DnaFact[]>()
  for (const fact of dna.facts ?? []) {
    if (!fact || !fact.key || typeof fact.value !== 'string') continue
    const list = byKey.get(fact.key) ?? []
    list.push(fact)
    byKey.set(fact.key, list)
  }
  const offerKeys = new Set<string>()
  for (const fact of offer.facts ?? []) {
    if (!fact || !fact.key || typeof fact.value !== 'string') continue
    if (!offerKeys.has(fact.key)) byKey.set(fact.key, [])
    offerKeys.add(fact.key)
    byKey.get(fact.key)!.push(fact)
  }
  const out: DnaFact[] = []
  for (const list of byKey.values()) out.push(...list)
  if (!out.some((f) => f.key === 'brand_name' && f.confirmed) && dna.brandName?.trim()) {
    out.unshift({ key: 'brand_name', value: dna.brandName.trim(), source: 'user', confirmed: true })
  }
  if (!out.some((f) => f.key === 'offer_name' && f.confirmed) && offer.name?.trim()) {
    out.unshift({ key: 'offer_name', value: offer.name.trim(), source: 'offer_form', confirmed: true })
  }
  return out.filter((f) => f.value.trim().length > 0)
}

export function confirmedFacts(facts: DnaFact[]): DnaFact[] {
  return facts.filter((f) => f.confirmed)
}

export function unconfirmedFacts(facts: DnaFact[]): DnaFact[] {
  const confirmedValues = confirmedFacts(facts).map((f) => normalizeText(f.value))
  return facts.filter((f) => !f.confirmed && !confirmedValues.includes(normalizeText(f.value)))
}

export function confirmedKeys(facts: DnaFact[]): Set<FactKey> {
  return new Set(confirmedFacts(facts).map((f) => f.key))
}

export function getConfirmed(facts: DnaFact[], key: FactKey): DnaFact | undefined {
  return facts.find((f) => f.key === key && f.confirmed)
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const SPELLED: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}
const TIME_UNITS = '(?:dias?|horas?|semanas?|mes|meses|minutos?|days?|hours?|weeks?|months?|minutes?)'
const SPELLED_TIME_RE = new RegExp(`\\b(${Object.keys(SPELLED).join('|')})\\s+(?:${TIME_UNITS})\\b`, 'g')

/** Canonical numeric string: thousands separators removed, decimals with '.', no trailing zeros. */
export function canonicalNumber(token: string): string {
  const t = token.replace(/\s/g, '')
  const seps = [...t.matchAll(/[.,]/g)].map((m) => m.index!)
  if (!seps.length) return String(Number(t))
  const last = seps[seps.length - 1]
  const after = t.slice(last + 1)
  if (after.length === 3 && /^\d{1,3}([.,]\d{3})+$/.test(t)) return String(Number(t.replace(/[.,]/g, '')))
  const intPart = t.slice(0, last).replace(/[.,]/g, '')
  const n = Number(`${intPart}.${after}`)
  return Number.isFinite(n) ? String(n) : t
}

export interface NumericClaim {
  /** Raw matched text, e.g. "₡9.900" or "dos días". */
  raw: string
  value: string
  index: number
}

/**
 * Every number in a text: digits (with ₡/$/%, separators, "mil"/"k" multipliers)
 * and spelled numbers 1–10 next to time units ("dos días").
 */
export function extractNumericClaims(text: string): NumericClaim[] {
  const out: NumericClaim[] = []
  const src = String(text ?? '')
  const re = /\d+(?:[.,]\d+)*(\s*(?:mil\b|k\b))?/gi
  for (const m of src.matchAll(re)) {
    const base = m[0].replace(/\s*(mil|k)$/i, '')
    let value = canonicalNumber(base)
    if (m[1]) value = String(Number(value) * 1000)
    out.push({ raw: m[0], value, index: m.index ?? 0 })
  }
  const norm = normalizeText(src)
  for (const m of norm.matchAll(SPELLED_TIME_RE)) {
    out.push({ raw: m[0], value: String(SPELLED[m[1]]), index: m.index ?? 0 })
  }
  return out
}

/** All canonical numbers that appear in the given facts' values. */
export function numbersInFacts(facts: DnaFact[]): Set<string> {
  const out = new Set<string>()
  for (const f of facts) for (const c of extractNumericClaims(f.value)) out.add(c.value)
  return out
}

// ---------------------------------------------------------------------------
// Offer line (deterministic, never model-written)
// ---------------------------------------------------------------------------

export const OFFER_LINE_MAX_CHARS = 70

/**
 * Budget for the on-image offer badge. Live benchmark (2026-10): 3-part lines like
 * "₡12.900 · 2 por ₡22.000 · Envíos a todo Costa Rica por Correos" rendered as a
 * two-line slab over the product; long logistics belong in the caption.
 */
export const OFFER_BADGE_TARGET_CHARS = 40

const FREE_SHIPPING_RE = /\b(?:gratis|gratuit[oa]s?|free)\b/

/**
 * Exact offer/price line from confirmed facts only, e.g. "₡9.900 · Antes ₡12.900 · Envío gratis GAM".
 * Returns undefined when there is no confirmed price and no confirmed bundle.
 * Parts are dropped, least persuasive first, until the line fits the badge budget:
 * plain shipping → compare-at → free shipping → bundle. The price always stays.
 */
export function buildOfferLine(facts: DnaFact[], language: AdLanguage): string | undefined {
  const price = getConfirmed(facts, 'price')?.value.trim()
  const bundle = getConfirmed(facts, 'bundle')?.value.trim()
  if (!price && !bundle) return undefined
  const compare = getConfirmed(facts, 'compare_at_price')?.value.trim()
  const shipping = getConfirmed(facts, 'shipping')?.value.trim()
  const freeShipping = Boolean(shipping && FREE_SHIPPING_RE.test(normalizeText(shipping)))
  const KEEP = 99
  const parts: Array<{ text: string; drop: number }> = []
  if (price) parts.push({ text: price, drop: KEEP })
  if (compare && price) parts.push({ text: `${language === 'es' ? 'Antes' : 'Was'} ${compare}`, drop: 2 })
  if (bundle && normalizeText(bundle) !== normalizeText(price ?? '')) parts.push({ text: bundle, drop: price ? 4 : KEEP })
  // Short free shipping sells; long logistics text does not fit a badge.
  if (shipping) parts.push({ text: shipping, drop: freeShipping && shipping.length <= 24 ? 3 : 1 })
  const join = () => parts.map((p) => p.text).join(' · ')
  while (join().length > OFFER_BADGE_TARGET_CHARS && parts.length > 1) {
    const victim = parts.reduce((min, p) => (p.drop < min.drop ? p : min))
    if (victim.drop >= KEEP) break
    parts.splice(parts.indexOf(victim), 1)
  }
  const line = join()
  return line.length > OFFER_LINE_MAX_CHARS ? parts[0].text.slice(0, OFFER_LINE_MAX_CHARS) : line
}
