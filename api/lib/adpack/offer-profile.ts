/**
 * Structured offer "ad profile" (products.ad_profile, migration 085) — owner feedback B1/B5/H7/A2.
 *
 * The owner (or an agent through create_offer / update_offer) types exact commercial
 * facts once: price, bundles, shipping rule, what is (not) included, age, CTA,
 * verified claims. They become CONFIRMED Ad Pack facts with the exact strings, so
 * copy says "Envío gratis desde 2 kits" and never "gratis con dos kits".
 *
 * Pure + deterministic (no I/O). Validation is strict: bad input throws
 * OfferProfileError with the offending field.
 */
import { isPlaceholderValue, type IgnoredPlaceholder } from '../placeholder-guard.js'
import type { AdLanguage, BrandDna, DnaFact, FactKey, MustAppearKey } from './types.js'

export type OfferCurrency = 'CRC' | 'USD'
export type OfferCtaChannel = 'web' | 'whatsapp' | 'dm'

export interface OfferMoney {
  amount: number
  currency: OfferCurrency
}

export interface OfferBundle {
  qty: number
  amount: number
  currency: OfferCurrency
  /** Unit phrase shown before the price, e.g. "2 kits" → "2 kits por ₡29.800". */
  label?: string
}

export interface OfferShipping {
  /** Exact shipping sentence, e.g. "Envío gratis desde 2 kits" or "Envíos a todo Costa Rica por Correos". */
  text?: string
  freeFromQty?: number
  freeFromAmount?: number
}

export interface OfferVerifiedClaim {
  claim: string
  /** Where it was verified: URL, document, test, owner statement. */
  source: string
}

/** How buyers reach the shop (P3 #21). Become confirmed facts + the contact CTA. */
export interface OfferContact {
  /** WhatsApp number as the owner writes it, e.g. "7000-0000" or "+506 7000 0000". */
  whatsapp?: string
  phone?: string
  /** Shop URL, stored as https://host/path; shown without the scheme ("tienda.example"). */
  url?: string
  /** "@handle". */
  instagram?: string
}

/** Recommended age (+ adult supervision) → "Desde 8 años, con supervisión de un adulto". */
export interface OfferAgeRule {
  min: number
  supervision?: boolean
  /** Exact owner sentence (wins over the generated one). */
  text?: string
}

/** Fact groups that can be required on every ad (owner feedback P0 #5). */
export const MUST_APPEAR_KEYS: readonly MustAppearKey[] = ['price', 'bundle', 'shipping', 'age', 'not_included', 'contact', 'payment_methods', 'compare_at_price']
/** Saved offers require these by default (a group the offer has no fact for is skipped). */
export const DEFAULT_MUST_APPEAR: readonly MustAppearKey[] = ['price', 'bundle', 'shipping', 'age', 'not_included', 'contact']

export interface OfferAdProfile {
  price?: OfferMoney
  compareAtPrice?: OfferMoney
  bundles?: OfferBundle[]
  shipping?: OfferShipping
  includes?: string[]
  excludes?: string[]
  allowedClaims?: string[]
  forbiddenClaims?: string[]
  verifiedClaims?: OfferVerifiedClaim[]
  cta?: { text?: string; channels?: OfferCtaChannel[] }
  ageMin?: number
  /** Age rule with adult supervision; wins over `ageMin`. */
  ageRule?: OfferAgeRule
  contact?: OfferContact
  /** e.g. ["SINPE Móvil", "tarjeta", "efectivo"] → fact "Aceptamos SINPE Móvil, tarjeta y efectivo". */
  paymentMethods?: string[]
  /** Fact groups required on every ad. Absent → DEFAULT_MUST_APPEAR; [] → none. */
  mustAppear?: MustAppearKey[]
  /** A2: attributes the image tools must never change (e.g. "ala de papel blanca"). */
  immutableAttributes?: string[]
  /** A2: never redraw the product; image tools must respect it. */
  lockProductAppearance?: boolean
  /** A3: kit parts/props allowed in scenes besides what is in the reference photo. */
  allowedProps?: string[]
  /** e.g. "es-CR". */
  locale?: string
  updatedAt?: string
}

export class OfferProfileError extends Error {
  readonly code = 'BAD_INPUT'
  readonly field: string
  constructor(field: string, message: string) {
    super(`${field}: ${message}`)
    this.name = 'OfferProfileError'
    this.field = field
  }
}

export const OFFER_PROFILE_LIMITS = {
  textChars: 160,
  claimChars: 200,
  sourceChars: 300,
  ctaChars: 40,
  listItems: 20,
  bundles: 6,
  maxAmount: 1_000_000_000,
} as const

const CURRENCIES: ReadonlySet<string> = new Set(['CRC', 'USD'])
const CHANNELS: ReadonlySet<string> = new Set(['web', 'whatsapp', 'dm'])
const LOCALE_RE = /^[a-z]{2}(?:-[A-Z]{2})?$/

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

function text(field: string, raw: unknown, max: number, ignored: IgnoredPlaceholder[]): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new OfferProfileError(field, 'must be a string')
  const value = raw.replace(/\s+/g, ' ').trim()
  if (!value) return undefined
  if (value.length > max) throw new OfferProfileError(field, `must be at most ${max} characters (got ${value.length})`)
  if (isPlaceholderValue(value)) {
    ignored.push({ field, value })
    return undefined
  }
  return value
}

function list(field: string, raw: unknown, max: number, ignored: IgnoredPlaceholder[]): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new OfferProfileError(field, 'must be an array of strings')
  if (raw.length > OFFER_PROFILE_LIMITS.listItems) throw new OfferProfileError(field, `at most ${OFFER_PROFILE_LIMITS.listItems} items`)
  const out: string[] = []
  raw.forEach((item, i) => {
    const v = text(`${field}[${i}]`, item, max, ignored)
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v)
  })
  return out
}

function amount(field: string, raw: unknown, currency: OfferCurrency): number {
  const n = raw
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new OfferProfileError(field, 'must be a number (e.g. 14900), not text')
  if (n <= 0) throw new OfferProfileError(field, 'must be greater than 0')
  if (n > OFFER_PROFILE_LIMITS.maxAmount) throw new OfferProfileError(field, 'is too large')
  if (currency === 'CRC' && !Number.isInteger(n)) throw new OfferProfileError(field, 'CRC amounts must be whole colones')
  if (currency === 'USD' && Math.round(n * 100) !== n * 100) throw new OfferProfileError(field, 'USD amounts allow at most 2 decimals')
  return n
}

function currencyOf(field: string, raw: unknown, fallback?: OfferCurrency): OfferCurrency {
  if (raw === undefined || raw === null || raw === '') {
    if (fallback) return fallback
    throw new OfferProfileError(field, 'currency is required (CRC or USD)')
  }
  if (typeof raw !== 'string' || !CURRENCIES.has(raw.toUpperCase())) throw new OfferProfileError(field, 'currency must be CRC or USD')
  return raw.toUpperCase() as OfferCurrency
}

function money(field: string, raw: unknown, fallbackCurrency?: OfferCurrency): OfferMoney | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number') {
    const currency = currencyOf(`${field}.currency`, undefined, fallbackCurrency)
    return { amount: amount(`${field}.amount`, raw, currency), currency }
  }
  if (!isObj(raw)) throw new OfferProfileError(field, 'must be { amount, currency }')
  const currency = currencyOf(`${field}.currency`, raw.currency, fallbackCurrency)
  return { amount: amount(`${field}.amount`, raw.amount, currency), currency }
}

function int(field: string, raw: unknown, min: number, max: number): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw)) throw new OfferProfileError(field, 'must be a whole number')
  if (raw < min || raw > max) throw new OfferProfileError(field, `must be between ${min} and ${max}`)
  return raw
}

const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/

/** "7000-0000" / "+506 7000 0000": digits, spaces, dashes, dots, parentheses and a leading +; 7–15 digits. */
function phoneNumber(field: string, raw: unknown, ignored: IgnoredPlaceholder[]): string | undefined {
  const v = text(field, raw, 30, ignored)
  if (!v) return undefined
  if (!PHONE_CHARS_RE.test(v)) throw new OfferProfileError(field, 'must be a phone number like "7000-0000" or "+506 7000 0000"')
  const digits = v.replace(/\D/g, '').length
  if (digits < 7 || digits > 15) throw new OfferProfileError(field, `must have 7 to 15 digits (got ${digits})`)
  return v
}

/** "tienda.example" or "https://tienda.example/kits" → "https://tienda.example/kits" (http(s), a real host). */
function shopUrl(field: string, raw: unknown, ignored: IgnoredPlaceholder[]): string | undefined {
  const v = text(field, raw, 200, ignored)
  if (!v) return undefined
  if (/\s/.test(v)) throw new OfferProfileError(field, 'must be a URL without spaces')
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    throw new OfferProfileError(field, 'is not a valid URL')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new OfferProfileError(field, 'must be an http(s) URL')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) throw new OfferProfileError(field, 'must have a real domain (e.g. tienda.example)')
  return `https://${u.hostname.toLowerCase()}${u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')}${u.search}`
}

/** Display form of a stored shop URL: no scheme, no "www.". */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
}

/** "@handle", "handle" or an instagram.com/handle URL → "@handle". */
function instagramHandle(field: string, raw: unknown, ignored: IgnoredPlaceholder[]): string | undefined {
  const v = text(field, raw, 120, ignored)
  if (!v) return undefined
  const m = v.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?$/i) ?? v.match(/^@?([A-Za-z0-9._]+)$/)
  if (!m || m[1].length > 30) throw new OfferProfileError(field, 'must be an Instagram handle like "@tienda" (letters, digits, . and _)')
  return `@${m[1]}`
}

/**
 * Validate an ad-profile patch and merge it over `existing`.
 * Top-level keys replace; `null` removes a key; absent keys are kept.
 */
export function parseOfferAdProfile(
  raw: unknown,
  existing?: OfferAdProfile | null,
  opts: { now?: () => Date } = {},
): { profile: OfferAdProfile; ignoredPlaceholders: IgnoredPlaceholder[]; changedKeys: string[] } {
  if (raw === undefined || raw === null) return { profile: { ...(existing ?? {}) }, ignoredPlaceholders: [], changedKeys: [] }
  if (!isObj(raw)) throw new OfferProfileError('adProfile', 'must be an object')
  const ignored: IgnoredPlaceholder[] = []
  const L = OFFER_PROFILE_LIMITS
  const next: OfferAdProfile = { ...(existing ?? {}) }
  const changed: string[] = []
  const set = <K extends keyof OfferAdProfile>(key: K, value: OfferAdProfile[K] | undefined) => {
    changed.push(key)
    if (value === undefined || (Array.isArray(value) && !value.length)) delete next[key]
    else next[key] = value
  }
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key)

  if (has('price')) set('price', money('price', raw.price))
  const mainCurrency = next.price?.currency
  if (has('compareAtPrice')) set('compareAtPrice', money('compareAtPrice', raw.compareAtPrice, mainCurrency))
  if (next.compareAtPrice && next.price && next.compareAtPrice.currency !== next.price.currency) {
    throw new OfferProfileError('compareAtPrice.currency', 'must match price.currency')
  }
  if (next.compareAtPrice && next.price && next.compareAtPrice.amount <= next.price.amount) {
    throw new OfferProfileError('compareAtPrice', 'must be higher than price (it is the "before" price)')
  }
  if (has('bundles')) {
    if (raw.bundles === null) set('bundles', undefined)
    else {
      if (!Array.isArray(raw.bundles)) throw new OfferProfileError('bundles', 'must be an array of { qty, price, label? }')
      if (raw.bundles.length > L.bundles) throw new OfferProfileError('bundles', `at most ${L.bundles} bundles`)
      const bundles = raw.bundles.map((b, i): OfferBundle => {
        if (!isObj(b)) throw new OfferProfileError(`bundles[${i}]`, 'must be { qty, price, label? }')
        const qty = int(`bundles[${i}].qty`, b.qty, 2, 100)
        if (qty === undefined) throw new OfferProfileError(`bundles[${i}].qty`, 'is required')
        // Input shape { qty, price, label } or the stored shape { qty, amount, currency, label }.
        const priceRaw = b.price !== undefined ? b.price : b.amount !== undefined ? { amount: b.amount, currency: b.currency } : undefined
        const m = money(`bundles[${i}].price`, priceRaw, mainCurrency)
        if (!m) throw new OfferProfileError(`bundles[${i}].price`, 'is required')
        const label = text(`bundles[${i}].label`, b.label, 40, ignored)
        return { qty, amount: m.amount, currency: m.currency, ...(label ? { label } : {}) }
      })
      set('bundles', bundles)
    }
  }
  if (has('shipping')) {
    if (raw.shipping === null) set('shipping', undefined)
    else {
      if (!isObj(raw.shipping)) throw new OfferProfileError('shipping', 'must be { text?, freeFromQty?, freeFromAmount? }')
      const s = raw.shipping
      const shipping: OfferShipping = {}
      const t = text('shipping.text', s.text, L.textChars, ignored)
      if (t) shipping.text = t
      const q = int('shipping.freeFromQty', s.freeFromQty, 1, 100)
      if (q !== undefined) shipping.freeFromQty = q
      if (s.freeFromAmount !== undefined && s.freeFromAmount !== null) {
        shipping.freeFromAmount = amount('shipping.freeFromAmount', s.freeFromAmount, mainCurrency ?? 'CRC')
      }
      set('shipping', Object.keys(shipping).length ? shipping : undefined)
    }
  }
  for (const key of ['includes', 'excludes', 'allowedClaims', 'forbiddenClaims', 'immutableAttributes', 'allowedProps'] as const) {
    if (has(key)) set(key, list(key, raw[key], key.endsWith('Claims') ? L.claimChars : L.textChars, ignored))
  }
  if (has('verifiedClaims')) {
    if (raw.verifiedClaims === null) set('verifiedClaims', undefined)
    else {
      if (!Array.isArray(raw.verifiedClaims)) throw new OfferProfileError('verifiedClaims', 'must be an array of { claim, source }')
      if (raw.verifiedClaims.length > L.listItems) throw new OfferProfileError('verifiedClaims', `at most ${L.listItems} items`)
      const claims: OfferVerifiedClaim[] = []
      raw.verifiedClaims.forEach((c, i) => {
        if (!isObj(c)) throw new OfferProfileError(`verifiedClaims[${i}]`, 'must be { claim, source }')
        const claim = text(`verifiedClaims[${i}].claim`, c.claim, L.claimChars, ignored)
        const source = text(`verifiedClaims[${i}].source`, c.source, L.sourceChars, ignored)
        if (!claim) return
        if (!source) throw new OfferProfileError(`verifiedClaims[${i}].source`, 'is required (where the claim was verified)')
        claims.push({ claim, source })
      })
      set('verifiedClaims', claims)
    }
  }
  if (has('cta')) {
    if (raw.cta === null) set('cta', undefined)
    else {
      if (!isObj(raw.cta)) throw new OfferProfileError('cta', 'must be { text?, channels? }')
      const cta: NonNullable<OfferAdProfile['cta']> = {}
      const t = text('cta.text', raw.cta.text, L.ctaChars, ignored)
      if (t) cta.text = t
      if (raw.cta.channels !== undefined && raw.cta.channels !== null) {
        if (!Array.isArray(raw.cta.channels)) throw new OfferProfileError('cta.channels', 'must be an array')
        const channels: OfferCtaChannel[] = []
        for (const c of raw.cta.channels) {
          if (typeof c !== 'string' || !CHANNELS.has(c)) throw new OfferProfileError('cta.channels', 'items must be web, whatsapp or dm')
          if (!channels.includes(c as OfferCtaChannel)) channels.push(c as OfferCtaChannel)
        }
        if (channels.length) cta.channels = channels
      }
      set('cta', Object.keys(cta).length ? cta : undefined)
    }
  }
  if (has('ageMin')) set('ageMin', int('ageMin', raw.ageMin, 0, 99))
  if (has('ageRule')) {
    if (raw.ageRule === null) set('ageRule', undefined)
    else {
      if (!isObj(raw.ageRule)) throw new OfferProfileError('ageRule', 'must be { min, supervision?, text? }')
      const min = int('ageRule.min', raw.ageRule.min, 0, 99)
      if (min === undefined) throw new OfferProfileError('ageRule.min', 'is required (whole number of years)')
      const sup = raw.ageRule.supervision
      if (sup !== undefined && sup !== null && typeof sup !== 'boolean') throw new OfferProfileError('ageRule.supervision', 'must be a boolean')
      const t = text('ageRule.text', raw.ageRule.text, L.textChars, ignored)
      set('ageRule', { min, ...(sup === true ? { supervision: true } : {}), ...(t ? { text: t } : {}) })
    }
  }
  if (has('contact')) {
    if (raw.contact === null) set('contact', undefined)
    else {
      if (!isObj(raw.contact)) throw new OfferProfileError('contact', 'must be { whatsapp?, phone?, url?, instagram? }')
      const c = raw.contact
      const contact: OfferContact = {}
      const wa = phoneNumber('contact.whatsapp', c.whatsapp, ignored)
      if (wa) contact.whatsapp = wa
      const ph = phoneNumber('contact.phone', c.phone, ignored)
      if (ph) contact.phone = ph
      const url = shopUrl('contact.url', c.url, ignored)
      if (url) contact.url = url
      const ig = instagramHandle('contact.instagram', c.instagram, ignored)
      if (ig) contact.instagram = ig
      set('contact', Object.keys(contact).length ? contact : undefined)
    }
  }
  if (has('paymentMethods')) set('paymentMethods', list('paymentMethods', raw.paymentMethods, 60, ignored))
  if (has('mustAppear')) {
    if (raw.mustAppear === null) set('mustAppear', undefined)
    else {
      if (!Array.isArray(raw.mustAppear)) throw new OfferProfileError('mustAppear', `must be an array of: ${MUST_APPEAR_KEYS.join(', ')}`)
      const keys: MustAppearKey[] = []
      for (const k of raw.mustAppear) {
        if (typeof k !== 'string' || !(MUST_APPEAR_KEYS as readonly string[]).includes(k)) throw new OfferProfileError('mustAppear', `unknown key ${JSON.stringify(k)} (use ${MUST_APPEAR_KEYS.join(', ')})`)
        if (!keys.includes(k as MustAppearKey)) keys.push(k as MustAppearKey)
      }
      // An explicit [] is kept: "no required facts" is not the same as "defaults".
      changed.push('mustAppear')
      next.mustAppear = keys
    }
  }
  if (has('lockProductAppearance')) {
    if (raw.lockProductAppearance !== null && typeof raw.lockProductAppearance !== 'boolean') throw new OfferProfileError('lockProductAppearance', 'must be a boolean')
    set('lockProductAppearance', raw.lockProductAppearance === true ? true : undefined)
  }
  if (has('locale')) {
    if (raw.locale !== null && (typeof raw.locale !== 'string' || !LOCALE_RE.test(raw.locale))) throw new OfferProfileError('locale', 'must look like "es-CR" or "en"')
    set('locale', (raw.locale as string | null) ?? undefined)
  }
  if (changed.length) next.updatedAt = (opts.now ?? (() => new Date()))().toISOString()
  return { profile: next, ignoredPlaceholders: ignored, changedKeys: changed }
}

/** Read a stored ad_profile tolerantly (never throws; drops invalid parts). */
export function readOfferAdProfile(raw: unknown): OfferAdProfile | null {
  if (!isObj(raw) || !Object.keys(raw).length) return null
  const out: OfferAdProfile = {}
  for (const key of Object.keys(raw)) {
    try {
      Object.assign(out, parseOfferAdProfile({ [key]: (raw as Record<string, unknown>)[key] }, out).profile)
    } catch {
      // ignore a corrupt key; the rest of the profile still applies
    }
  }
  if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt
  else delete out.updatedAt
  return Object.keys(out).length ? out : null
}

// ---------------------------------------------------------------------------
// Formatting + facts
// ---------------------------------------------------------------------------

function groupThousands(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}

/** "₡29.800" (CRC, dot thousands) · "$25" / "$1,250.50" (USD). */
export function formatMoney(m: { amount: number; currency: OfferCurrency }): string {
  if (m.currency === 'CRC') return `₡${groupThousands(String(Math.round(m.amount)), '.')}`
  const fixed = Number.isInteger(m.amount) ? String(m.amount) : m.amount.toFixed(2)
  const [i, d] = fixed.split('.')
  return `$${groupThousands(i, ',')}${d ? `.${d}` : ''}`
}

const CHANNEL_LABEL: Record<OfferCtaChannel, Record<AdLanguage, string>> = {
  web: { es: 'Tienda online', en: 'Online store' },
  whatsapp: { es: 'WhatsApp', en: 'WhatsApp' },
  dm: { es: 'Mensaje directo', en: 'Direct message' },
}

const NOT_INCLUDED_RE = /\b(?:no\s+incluid[oa]s?|no\s+se\s+incluye[n]?|no\s+viene[n]?(?:\s+incluid[oa]s?)?|not\s+included|excluded|excluye|se\s+vende\s+aparte|sold\s+separately)\b/gi

/** "Papel no incluido" → "Papel"; "Sin baterías" → "baterías". */
export function excludedItem(value: string): string {
  return value
    .replace(NOT_INCLUDED_RE, ' ')
    .replace(/^\s*(?:sin|without|no)\s+/i, ' ')
    .replace(/[.:;,!¡¿?()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface OfferProfileFacts {
  facts: DnaFact[]
  /** Fact groups every ad must carry (profile.mustAppear ?? DEFAULT_MUST_APPEAR). */
  mustAppear: MustAppearKey[]
  /** forbiddenClaims → brand forbidden phrases for the copy checker. */
  forbiddenPhrases: string[]
  /** Items the offer does NOT include ("Papel"); copy may never say they are included. */
  notIncluded: string[]
  /** True when the owner keeps a verified-claims bank: only traceable claims may ship. */
  strictClaims: boolean
  productLock?: { lockProductAppearance: boolean; immutableAttributes: string[]; allowedProps: string[] }
}

/** Ad profile → confirmed offer facts with the owner's exact strings. */
export function offerProfileFacts(profile: OfferAdProfile | null | undefined, language: AdLanguage, register?: BrandDna['register']): OfferProfileFacts {
  const out: OfferProfileFacts = { facts: [], mustAppear: [...DEFAULT_MUST_APPEAR], forbiddenPhrases: [], notIncluded: [], strictClaims: false }
  if (!profile) return out
  const es = language === 'es'
  const add = (key: FactKey, value: string, evidence: string) => {
    const v = value.trim()
    if (v) out.facts.push({ key, value: v, source: 'offer_form', confirmed: true, evidence: `saved ${evidence}` })
  }
  if (profile.price) add('price', formatMoney(profile.price), 'offer.adProfile.price')
  if (profile.compareAtPrice) add('compare_at_price', formatMoney(profile.compareAtPrice), 'offer.adProfile.compareAtPrice')
  for (const b of profile.bundles ?? []) {
    const unit = b.label || String(b.qty)
    add('bundle', `${unit} ${es ? 'por' : 'for'} ${formatMoney(b)}`, 'offer.adProfile.bundles')
  }
  const ship = profile.shipping
  if (ship?.text) add('shipping', ship.text, 'offer.adProfile.shipping.text')
  const shipText = (ship?.text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const shipSaysFree = /\b(?:gratis|gratuit|free)\b/.test(shipText)
  if (ship?.freeFromQty && !shipSaysFree) {
    add('custom:free_shipping_rule', es ? `Envío gratis desde ${ship.freeFromQty} unidades` : `Free shipping from ${ship.freeFromQty} units`, 'offer.adProfile.shipping.freeFromQty')
  }
  if (ship?.freeFromAmount && !shipSaysFree) {
    const m = formatMoney({ amount: ship.freeFromAmount, currency: profile.price?.currency ?? 'CRC' })
    add('custom:free_shipping_rule', es ? `Envío gratis en compras desde ${m}` : `Free shipping on orders from ${m}`, 'offer.adProfile.shipping.freeFromAmount')
  }
  for (const v of profile.includes ?? []) add('custom:includes', v, 'offer.adProfile.includes')
  for (const v of profile.excludes ?? []) {
    add('custom:not_included', v, 'offer.adProfile.excludes')
    const item = excludedItem(v)
    if (item.length >= 3 && !out.notIncluded.includes(item)) out.notIncluded.push(item)
  }
  for (const v of profile.allowedClaims ?? []) add('custom:allowed_claim', v, 'offer.adProfile.allowedClaims')
  for (const c of profile.verifiedClaims ?? []) {
    out.facts.push({ key: 'custom:verified_claim', value: c.claim, source: 'offer_form', confirmed: true, evidence: `verified: ${c.source}`.slice(0, 300) })
  }
  if (profile.cta?.text) add('custom:cta', profile.cta.text, 'offer.adProfile.cta.text')
  for (const ch of profile.cta?.channels ?? []) add('contact_channel', CHANNEL_LABEL[ch][language], 'offer.adProfile.cta.channels')
  if (profile.ageRule) add('custom:age', ageRuleText(profile.ageRule, language), 'offer.adProfile.ageRule')
  else if (typeof profile.ageMin === 'number' && profile.ageMin > 0) add('custom:age', es ? `Edad ${profile.ageMin}+` : `Ages ${profile.ageMin}+`, 'offer.adProfile.ageMin')
  const contact = profile.contact
  if (contact?.whatsapp) add('custom:whatsapp', `WhatsApp ${contact.whatsapp}`, 'offer.adProfile.contact.whatsapp')
  if (contact?.phone) add('custom:phone', `${es ? 'Tel.' : 'Phone'} ${contact.phone}`, 'offer.adProfile.contact.phone')
  if (contact?.instagram) add('custom:instagram', contact.instagram, 'offer.adProfile.contact.instagram')
  if (contact?.url) add('custom:url', displayUrl(contact.url), 'offer.adProfile.contact.url')
  const contactCta = contactCtaText(contact, language, register)
  if (contactCta) add('custom:contact_cta', contactCta, 'offer.adProfile.contact')
  if (profile.paymentMethods?.length) add('payment_methods', paymentMethodsText(profile.paymentMethods, language), 'offer.adProfile.paymentMethods')
  if (profile.mustAppear) out.mustAppear = [...profile.mustAppear]
  out.forbiddenPhrases = [...(profile.forbiddenClaims ?? [])]
  out.strictClaims = (profile.verifiedClaims?.length ?? 0) > 0
  if (profile.lockProductAppearance || profile.immutableAttributes?.length || profile.allowedProps?.length) {
    out.productLock = {
      lockProductAppearance: profile.lockProductAppearance === true,
      immutableAttributes: [...(profile.immutableAttributes ?? [])],
      allowedProps: [...(profile.allowedProps ?? [])],
    }
  }
  return out
}

/** "Desde 8 años, con supervisión de un adulto" (the owner's text wins). */
export function ageRuleText(rule: OfferAgeRule, language: AdLanguage): string {
  if (rule.text) return rule.text
  if (language === 'en') return `Ages ${rule.min}+${rule.supervision ? ', with adult supervision' : ''}`
  return `Desde ${rule.min} años${rule.supervision ? ', con supervisión de un adulto' : ''}`
}

/** "Aceptamos SINPE Móvil, tarjeta y efectivo" (register-neutral). */
export function paymentMethodsText(methods: string[], language: AdLanguage): string {
  const and = language === 'en' ? 'and' : 'y'
  const joined = methods.length > 1 ? `${methods.slice(0, -1).join(', ')} ${and} ${methods[methods.length - 1]}` : methods[0]
  return language === 'en' ? `We accept ${joined}` : `Aceptamos ${joined}`
}

const CONTACT_VERBS: Record<BrandDna['register'], { write: string; call: string; order: string }> = {
  voseo: { write: 'Escribinos', call: 'Llamanos', order: 'Pedilo' },
  tuteo: { write: 'Escríbenos', call: 'Llámanos', order: 'Pídelo' },
  usted: { write: 'Escríbanos', call: 'Llámenos', order: 'Pídalo' },
}

/** Contact CTA from the confirmed channels: WhatsApp > phone > Instagram > shop URL. */
export function contactCtaText(contact: OfferContact | undefined, language: AdLanguage, register: BrandDna['register'] = 'tuteo'): string | undefined {
  if (!contact) return undefined
  if (language === 'en') {
    if (contact.whatsapp) return `Message us on WhatsApp ${contact.whatsapp}`
    if (contact.phone) return `Call us at ${contact.phone}`
    if (contact.instagram) return `DM us on Instagram ${contact.instagram}`
    if (contact.url) return `Order at ${displayUrl(contact.url)}`
    return undefined
  }
  const v = CONTACT_VERBS[register] ?? CONTACT_VERBS.tuteo
  if (contact.whatsapp) return `${v.write} al WhatsApp ${contact.whatsapp}`
  if (contact.phone) return `${v.call} al ${contact.phone}`
  if (contact.instagram) return `${v.write} por Instagram a ${contact.instagram}`
  if (contact.url) return `${v.order} en ${displayUrl(contact.url)}`
  return undefined
}

/** Language hint from a locale ("es-CR" → es). */
export function languageFromLocale(locale: string | undefined | null): AdLanguage | undefined {
  if (!locale) return undefined
  const l = locale.slice(0, 2).toLowerCase()
  return l === 'es' ? 'es' : l === 'en' ? 'en' : undefined
}
