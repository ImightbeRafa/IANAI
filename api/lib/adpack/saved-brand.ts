/**
 * Ad Pack — Brand DNA + offer from data the owner ALREADY saved in AdvanceAI
 * (business, linked brand kit, product/offer form, product photos, stored URL
 * analysis). No URLs, uploads or model calls needed: Grok can go
 * `adpack_start { brandId, offerId }` in one call.
 *
 * Truth rules:
 * - Values the owner typed (business + offer form fields) become `offer_form`
 *   facts → `confirmed: true`.
 * - Stored site analysis (GUIDE URL intake) is inferred → `website` facts,
 *   never confirmed (the owner can confirm them with dna_confirm).
 * - Price only when the product holds a concrete amount (a price-range bucket
 *   like "medio" never becomes a price).
 * - Brand kit voice / phrases / colors / fonts / logo / references shape style,
 *   not facts.
 *
 * All reads go through an injected, owner-scoped `SavedBrandDb`
 * (Supabase impl: `saved-brand-supabase.ts`; tests use fakes).
 */
import { resolveBrandKitForBusiness, type BrandKitRowLike } from '../brand-kit-resolve.js'
import { parseStyleDnas } from '../bulk/style-dna.js'
import type { StyleDna } from '../bulk/types.js'
import { isReusableProductReference } from '../product-image-refs.js'
import type { SiteAnalysisResult } from '../site-analysis.js'
import { detectLanguage } from './dna/classify.js'
import { buildBrandDna, computeGaps } from './dna/merge.js'
import { cleanText, isHexColor, makeFact, uniqStrings, type DnaPart } from './dna/part.js'
import { mapSiteAnalysis } from './dna/website.js'
import { hasRolePrefix, roleFromImageRow, roleFromLabel, stripRolePrefix } from './fidelity/photos.js'
import type { AdLanguage, BrandDna, BusinessCategory, DnaFact, DnaVisual, FactKey, OfferInput } from './types.js'
import { isPlaceholderValue, stripPlaceholderParts } from '../placeholder-guard.js'
import { audienceLines, readBrandProfile, type BrandProfile } from '../brand-profile.js'
import { orderProductImages } from '../product-image-order.js'
import { contactCtaText, languageFromLocale, offerProfileFacts, readOfferAdProfile, type OfferProfileFacts } from './offer-profile.js'

type Row = Record<string, unknown>

export interface StoredSiteAnalysis {
  sourceUrl: string
  analysis: SiteAnalysisResult
  completedAt?: string | null
}

/** Owner-scoped reads. Every method MUST filter by `userId` (owner) — another user's id → null / []. */
export interface SavedBrandDb {
  /** `businesses` row owned by userId (+ `target_audiences` array when available). */
  getBusiness(userId: string, businessId: string): Promise<Row | null>
  /** `brand_kits` rows linked to the business (business_id = businessId) and owned by userId. */
  listBrandKits(userId: string, businessId: string): Promise<Row[]>
  /** `products` row owned by userId inside businessId; productId omitted → the most recent product. */
  getProduct(userId: string, businessId: string, productId?: string): Promise<Row | null>
  /** `product_images` rows of an owned product (any kind; generated rows are skipped here). */
  listProductImages(userId: string, productId: string): Promise<Row[]>
  /** Latest finished GUIDE URL analysis for the business (mcp_url_intakes.analysis_result), if any. */
  getLatestSiteAnalysis?(userId: string, businessId: string): Promise<StoredSiteAnalysis | null>
}

export type SavedBrandErrorCode = 'NOT_FOUND' | 'BAD_INPUT'

export class SavedBrandError extends Error {
  readonly code: SavedBrandErrorCode
  constructor(code: SavedBrandErrorCode, message: string) {
    super(message)
    this.name = 'SavedBrandError'
    this.code = code
  }
}

export interface SavedBrandResult {
  dna: BrandDna
  offer: OfferInput
  /** Missing facts computed on CONFIRMED facts only (inferred website values do not close a gap). */
  gaps: FactKey[]
  /** Human-readable notes for the owner / Grok (missing photos, price not concrete, kit resolution…). */
  notes: string[]
  brandId: string
  offerId?: string
  brandKitId?: string
  /** Website URL known for the brand (stored analysis / offer context link). */
  websiteUrl?: string
  /** Model cost (only with refresh). */
  costUsd: number
  /** Style DNAs saved on the resolved brand kit (`style_dnas`), for adpack_start {styleDnaId}. */
  styleDnas?: StyleDna[]
}

export interface BuildDnaFromSavedBrandInput {
  db: SavedBrandDb
  userId: string
  brandId: string
  offerId?: string
  brandKitId?: string
  /** Re-read the stored website live (model + network). Default false: stored analysis only. */
  refresh?: boolean
  /** Required when `refresh` is true; returns a fresh website part. */
  refreshWebsite?: (url: string, language: AdLanguage) => Promise<DnaPart>
  now?: () => Date
  /** C3: photo pool (product_images ids of the offer, first = hero). */
  productImageIds?: string[]
  /** C3: per-ad photos (ad index → product_images ids). */
  productImageIdsByAd?: Record<string, string[]>
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Saved text, or '' for placeholders ("country", "N/A", "Personas 18–65"…) so they never reach an ad (B3). */
const s = (row: Row | null | undefined, key: string, max = 300): string => {
  const v = cleanText(row?.[key], max)
  return isPlaceholderValue(v) ? '' : v
}
const bool = (row: Row | null | undefined, key: string): boolean | undefined => (typeof row?.[key] === 'boolean' ? (row[key] as boolean) : undefined)
const strings = (raw: unknown, max = 200, limit = 12): string[] =>
  Array.isArray(raw) ? uniqStrings(raw.map((v) => cleanText(v, max)).filter((v) => !isPlaceholderValue(v)), limit) : []
const httpsOnly = (urls: string[]): string[] => urls.filter((u) => /^https:\/\//i.test(u))

const PRICE_BUCKET_RE = /^(econ[oó]mico|medio|premium|low|mid|medium|high|bajo|alto)$/i

/**
 * A concrete price the owner typed, or undefined. Accepts "₡9.900", "$25", "9900 CRC",
 * "25 USD". Rejects buckets ("medio"), ranges ("₡5.000–₡10.000") and digit-free text.
 */
export function concretePrice(raw: unknown): string | undefined {
  const value = cleanText(raw, 80)
  if (!value || PRICE_BUCKET_RE.test(value) || !/\d/.test(value)) return undefined
  const numbers = value.match(/\d+(?:[.,]\d+)*/g) || []
  if (numbers.length !== 1) return undefined
  if (/\b(desde|from|hasta|up to|aprox|approx|entre|between)\b/i.test(value)) return undefined
  return value
}

const CHANNEL_LABELS: Record<string, Record<AdLanguage, string>> = {
  website: { es: 'Tienda online', en: 'Online store' },
  messages: { es: 'Pedidos por mensaje', en: 'Orders by message' },
  physical: { es: 'Tienda física', en: 'Physical store' },
}

function audienceLine(raw: unknown, language: AdLanguage): string {
  if (!raw || typeof raw !== 'object') return ''
  const a = raw as Row
  const es = language === 'es'
  const sex = a.sex === 'male' ? (es ? 'Hombres' : 'Men') : a.sex === 'female' ? (es ? 'Mujeres' : 'Women') : (es ? 'Personas' : 'People')
  const ages = typeof a.age_min === 'number' && typeof a.age_max === 'number' ? ` ${a.age_min}–${a.age_max}` : ''
  const scope = s(a, 'geographic_scope_custom', 80) || (
    a.geographic_scope === 'local' ? (es ? 'local' : 'local')
      : a.geographic_scope === 'country' ? (es ? 'todo el país' : 'nationwide')
        : a.geographic_scope === 'world' ? (es ? 'internacional' : 'international')
          : ''
  )
  const profession = a.has_specific_profession ? s(a, 'profession_description', 120) : ''
  // "Personas 18–65, todo el país" says nothing: placeholder parts are dropped (B3).
  return stripPlaceholderParts([`${sex}${ages}`, scope, profession].filter(Boolean).join(', '))
}

/** Offer types that pin the category; everything else uses the text heuristics in buildBrandDna. */
function categoryFor(product: Row | null): BusinessCategory | undefined {
  const type = s(product, 'type', 40)
  if (type === 'restaurant') return 'food_beverage'
  if (type === 'indumentaria') return 'fashion_apparel'
  return undefined
}

// ---------------------------------------------------------------------------
// Facts the owner typed (confirmed)
// ---------------------------------------------------------------------------

/** Product form → offer facts. Single-valued keys take the first non-empty field only (no fake conflicts). */
export function productFacts(
  product: Row,
  business: Row | null,
  language: AdLanguage,
  profileFacts?: OfferProfileFacts | null,
): { facts: DnaFact[]; notes: string[] } {
  const facts: DnaFact[] = [...(profileFacts?.facts ?? [])]
  const notes: string[] = []
  const fromProfile = new Set(facts.map((f) => f.key))
  const es = language === 'es'
  const add = (key: FactKey, value: string, evidence: string) => {
    const v = cleanText(value, 300)
    if (v) facts.push(makeFact(key, v, 'offer_form', `saved ${evidence}`, true))
  }
  const first = (key: FactKey, fields: string[], gate?: (field: string) => boolean) => {
    for (const field of fields) {
      if (gate && !gate(field)) continue
      const v = s(product, field)
      if (v) return add(key, v, `products.${field}`)
    }
  }
  const all = (key: FactKey, fields: string[]) => {
    for (const field of fields) {
      const v = s(product, field)
      if (v) add(key, v, `products.${field}`)
    }
  }

  // Price: the structured ad profile wins (exact formatted amount); else only a concrete amount.
  const priceField = ['price', 're_price', 'price_range'].find((f) => concretePrice(product[f]))
  if (fromProfile.has('price')) {
    // already added from offer.adProfile.price
  } else if (priceField) add('price', concretePrice(product[priceField]) as string, `products.${priceField}`)
  else {
    const bucket = s(product, 'price_range', 40) || s(product, 're_price', 40)
    notes.push(bucket
      ? `price: "${bucket}" is not a concrete amount — ads will not mention a price (add the exact price to the offer to use it)`
      : 'price: no concrete price saved on the offer — ads will not mention a price')
  }

  // Logistics / risk reversal.
  if (fromProfile.has('shipping')) {
    // exact shipping sentence from offer.adProfile.shipping.text
  } else if (s(product, 'shipping_info')) add('shipping', s(product, 'shipping_info'), 'products.shipping_info')
  else if (business && bool(business, 'does_shipping') === true) {
    const method = s(business, 'shipping_method', 160)
    add('shipping', method ? (es ? `Envíos: ${method}` : `Shipping: ${method}`) : (es ? 'Hacemos envíos' : 'We ship'), method ? 'businesses.shipping_method' : 'businesses.does_shipping')
  }
  first('guarantee', ['guarantee_details', 'svc_guarantee_details'], (f) =>
    f === 'guarantee_details' ? bool(product, 'has_guarantee') !== false : bool(product, 'svc_has_guarantee') !== false)
  if (bool(product, 'ind_accepts_changes') !== false) first('returns', ['ind_change_policy'])
  first('location', ['re_location', 'location'])
  if (!facts.some((f) => f.key === 'location') && s(business, 'location')) add('location', s(business, 'location'), 'businesses.location')

  // Multi-valued product truths.
  all('differentiator', ['differentiation', 'svc_differentiation', 'unique_value', 're_highlights'])
  all('result_claim', ['expected_result', 'result', 'svc_concrete_result'])
  first('how_it_works', ['utility'])
  first('usage_steps', ['svc_process_steps'])
  first('ingredients_materials', ['ind_main_material'])
  for (const v of strings(product.product_variations, 80, 8)) add('variants', v, 'products.product_variations')
  all('variants', ['ind_variations_description'])
  const sizes = s(product, 'ind_sizes', 160)
  if (sizes) add('custom:sizes', sizes, 'products.ind_sizes')
  const custom: Array<[string, string]> = [
    ['technical_specs', 'technical_specs'],
    ['quality', 'ind_quality_description'],
    ['result_timeline', 'svc_result_timeline'],
    ['service_duration', 'svc_service_duration'],
    ['service_format', 'svc_service_format'],
    ['schedule', 'schedule'],
    ['construction_size', 're_construction_size'],
    ['bedrooms', 're_bedrooms'],
    ['bathrooms', 're_bathrooms'],
    ['capacity', 're_capacity'],
    ['parking', 're_parking'],
    ['offer_details', 'offer'],
  ]
  for (const [slug, field] of custom) {
    const v = s(product, field, 240)
    if (v) add(`custom:${slug}`, v, `products.${field}`)
  }
  if (bool(product, 'ind_customizable') === true) {
    const v = s(product, 'ind_customization_description', 200)
    add('custom:customization', v || (es ? 'Personalizable' : 'Customizable'), 'products.ind_customizable')
  }
  if (bool(product, 'svc_has_own_method') === true && s(product, 'svc_method_name')) add('custom:method', s(product, 'svc_method_name'), 'products.svc_method_name')
  if (bool(product, 'stock_limited') === true) add('custom:stock_limited', es ? 'Stock limitado' : 'Limited stock', 'products.stock_limited')
  if (!fromProfile.has('contact_channel')) for (const channel of strings(business?.sales_channels, 40, 3)) {
    const label = CHANNEL_LABELS[channel]?.[language]
    if (label) add('custom:sales_channel', label, 'businesses.sales_channels')
  }
  return { facts, notes }
}

// ---------------------------------------------------------------------------
// Narrative part (voice, audience, pains…) — shapes copy, never a claim
// ---------------------------------------------------------------------------

function savedPart(input: {
  business: Row
  kit: Row | null
  product: Row | null
  language: AdLanguage
  fetchedAt: string
  brandProfile?: BrandProfile | null
  profileFacts?: OfferProfileFacts | null
}): DnaPart {
  const { business, kit, product, language, brandProfile } = input
  const tone = strings(kit?.tone_keywords, 40, 6)
  const doList = (brandProfile?.do ?? []).slice(0, 6)
  const voice = [
    s(kit, 'brand_voice', 240),
    tone.length ? tone.join(', ') : '',
    doList.length ? `${language === 'es' ? 'Hacer' : 'Do'}: ${doList.join('; ')}` : '',
  ].filter(Boolean).join(' · ')
  const styleDnas = parseStyleDnas(kit?.style_dnas)
  const visual: DnaVisual = {}
  const color = (key: string) => {
    const v = s(kit, key, 20)
    return isHexColor(v) ? v.toLowerCase() : undefined
  }
  const primary = color('primary_color')
  const secondary = color('secondary_color')
  const accent = color('accent_color')
  if (primary) visual.primaryColor = primary
  if (secondary) visual.secondaryColor = secondary
  if (accent) visual.accentColor = accent
  if (s(kit, 'font_primary', 60)) visual.headingFont = s(kit, 'font_primary', 60)
  if (s(kit, 'font_secondary', 60)) visual.bodyFont = s(kit, 'font_secondary', 60)
  const logo = s(kit, 'logo_url', 1000)
  if (/^https:\/\//i.test(logo)) visual.logoUrl = logo
  const styleNotes = [s(kit, 'visual_style_notes', 300), ...styleDnas.map((d) => cleanText(d.notes, 160))].filter(Boolean).join(' · ').slice(0, 400)
  if (styleNotes) visual.styleNotes = styleNotes

  const audiences = Array.isArray(business.target_audiences) ? business.target_audiences.map((a) => audienceLine(a, language)) : []
  const textSample = [
    s(business, 'name', 120), s(kit, 'tagline', 200), s(kit, 'industry', 80), s(product, 'name', 160), s(product, 'type', 40),
    s(product, 'product_category', 80), s(product, 'product_category_custom', 80), s(product, 'ind_article_type', 80), s(product, 'svc_service_type', 80),
    s(product, 'product_description', 600), s(product, 'description', 400), s(product, 'utility', 300), s(product, 'main_problem', 300),
    s(product, 'menu_text', 400), s(business, 'location', 120), s(product, 'context_links_content', 2000),
  ].filter(Boolean).join('\n')

  return {
    source: 'offer_form',
    sourceEntry: { kind: 'offer_form', fetchedAt: input.fetchedAt, ok: true, note: 'saved brand, brand kit and offer in AdvanceAI' },
    oneLiner: s(kit, 'tagline', 160) || s(product, 'product_description', 200) || s(product, 'description', 200) || undefined,
    voice: voice || undefined,
    audience: uniqStrings([
      ...audienceLines(brandProfile),
      s(product, 'best_customers', 240), s(product, 'target_audience', 240), s(kit, 'target_audience', 240),
      s(business, 'icp_description', 240), ...audiences,
    ].filter((a) => a && !isPlaceholderValue(a)), 6),
    pains: uniqStrings([
      s(product, 'main_problem', 240), s(product, 'real_pain', 240), s(product, 'pain_consequences', 240),
      s(product, 'svc_problem', 240), s(product, 'svc_current_pain', 240), s(product, 'failed_attempts', 240),
      s(product, 'svc_alternatives_failures', 240), s(product, 'alternatives_disadvantages', 240),
    ], 10),
    desires: uniqStrings([
      s(product, 'expected_result', 240), s(product, 'result', 240), s(product, 'svc_concrete_result', 240),
      s(product, 'svc_life_change', 240), s(product, 'customer_values', 240), s(product, 'purchase_reason', 240),
    ], 10),
    objections: uniqStrings([s(product, 'key_objection', 240), s(product, 'svc_main_objection', 240)], 10),
    forbiddenPhrases: uniqStrings([
      ...strings(kit?.forbidden_phrases, 120, 20),
      ...(brandProfile?.dont ?? []),
      ...(input.profileFacts?.forbiddenPhrases ?? []),
    ], 30),
    facts: [],
    visual,
    referenceImageUrls: httpsOnly(uniqStrings([
      ...strings(kit?.reference_images, 1000, 12),
      ...styleDnas.flatMap((d) => d.referenceUrls),
    ], 16)),
    textSample,
    costUsd: 0,
  }
}

// ---------------------------------------------------------------------------
// Pure mapping (tested without a DB)
// ---------------------------------------------------------------------------

export interface MapSavedBrandInput {
  business: Row
  kit: Row | null
  product: Row | null
  images: Row[]
  /** Website part from stored analysis (or a refresh). Inferred: never confirmed. */
  website?: DnaPart | null
  fetchedAt: string
  extraNotes?: string[]
  /** C3: product_images ids to use as the photo pool, in order (first = hero). Must belong to the offer. */
  productImageIds?: string[]
  /** C3: per-ad photos (1-based ad number → product_images ids). */
  productImageIdsByAd?: Record<string, string[]>
}

export function mapSavedBrand(input: MapSavedBrandInput): { dna: BrandDna; offer: OfferInput; gaps: FactKey[]; notes: string[] } {
  const { business, kit, product } = input
  const brandName = s(business, 'name', 120) || s(kit, 'name', 120)
  const notes: string[] = [...(input.extraNotes || [])]

  // Language first (labels for synthetic values like "Hacemos envíos").
  const probe = [brandName, s(kit, 'tagline'), s(kit, 'brand_voice'), s(product, 'name'), s(product, 'product_description', 600),
    s(product, 'main_problem'), s(product, 'expected_result'), s(product, 'differentiation'), s(business, 'icp_description')].filter(Boolean).join('\n')
  // Structured profiles (migration 085): brand kit locale/register are HARD rules; offer facts are exact strings.
  const brandProfile = readBrandProfile(kit?.brand_profile)
  const adProfile = readOfferAdProfile(product?.ad_profile)
  const language: AdLanguage = languageFromLocale(brandProfile?.locale) || languageFromLocale(adProfile?.locale)
    || (probe.trim() ? detectLanguage(probe) : 'es')
  const profileFacts = adProfile ? offerProfileFacts(adProfile, language) : null

  const { facts, notes: factNotes } = product ? productFacts(product, business, language, profileFacts) : productFacts({}, business, language)
  notes.push(...factNotes.filter((n) => product || !n.startsWith('price')))

  // Product photos: real product refs first (primary → hero tag → sharpest → newest; then legacy refs), never generated; context → style refs.
  const usable = orderProductImages(input.images.filter((row) => isReusableProductReference(row as { kind?: string | null; message_id?: string | null })))
  const urlOf = (r: Row) => s(r, 'image_url', 1000)
  const byId = (ids: string[], label: string): string[] => ids.map((id) => {
    const row = usable.find((r) => r.id === id && r.kind !== 'context')
    if (!row) throw new SavedBrandError('NOT_FOUND', `${label}: product image ${id} not found on this offer (use list_assets ids of kind product)`)
    return urlOf(row)
  })
  const productUrls = input.productImageIds?.length
    ? httpsOnly(uniqStrings(byId(input.productImageIds, 'productImageIds'), 8))
    : httpsOnly(uniqStrings([
      ...usable.filter((r) => r.kind === 'product').map(urlOf),
      ...usable.filter((r) => r.kind !== 'product' && r.kind !== 'context').map(urlOf),
      ...strings(product?.ind_product_images, 1000, 8),
    ], 8))
  const byAd: Record<string, string[]> = {}
  for (const [index, ids] of Object.entries(input.productImageIdsByAd ?? {})) {
    const urls = httpsOnly(uniqStrings(byId(ids, `productImageIdsByAd.${index}`), 4))
    // Keys are 1-based ad numbers (as shown to the user); pack items are 0-based.
    if (urls.length && Number(index) >= 1) byAd[String(Number(index) - 1)] = urls
  }
  const contextUrls = httpsOnly(usable.filter((r) => r.kind === 'context').map(urlOf))
  if (!productUrls.length) notes.push('missing:product_photo — no real product photo saved on this offer; scenes will not be product-locked (upload one in the offer for best results)')

  const part = savedPart({ business, kit, product, language, fetchedAt: input.fetchedAt, brandProfile, profileFacts })
  if (contextUrls.length) part.referenceImageUrls = uniqStrings([...(part.referenceImageUrls || []), ...contextUrls], 16)

  const offerName = s(product, 'name', 200) || brandName
  const dna = buildBrandDna({
    uploads: part,
    website: input.website ?? null,
    offerForm: { name: offerName, brandName, facts, productImageUrls: productUrls },
    language,
    category: categoryFor(product),
    ...(brandProfile?.register ? { register: brandProfile.register } : {}),
  })
  const mustUse = strings(kit?.must_use_phrases, 120, 12)
  if (mustUse.length) dna.mustUsePhrases = mustUse
  if (brandProfile?.toneRules?.allowUrgency === true) dna.allowUrgency = true
  // The kit locale (e.g. "es-CR") makes the register a hard rule and drives the es-CR style rules.
  if (brandProfile?.locale && /^es(?:-|$)/i.test(brandProfile.locale) && language === 'es') dna.locale = brandProfile.locale
  // The contact CTA is register-aware ("Escribinos" in voseo): rebuilt once the DNA register is known.
  const cta = adProfile?.contact ? contactCtaText(adProfile.contact, language, dna.register) : undefined
  if (cta) {
    for (const list of [facts, dna.facts]) for (const f of list) if (f.key === 'custom:contact_cta') f.value = cta
  }
  // Gaps from what the owner confirmed; inferred website values do not close a gap.
  dna.gaps = computeGaps({ ...dna, facts: dna.facts.filter((f) => f.confirmed) })
  dna.notes = uniqStrings([...(dna.notes || []), ...notes], 30)

  const offer: OfferInput = {
    name: offerName,
    facts: facts.filter((f) => f.key !== 'brand_name'),
    productImageUrls: productUrls,
  }
  const productId = s(product, 'id', 64)
  if (productId) offer.productId = productId
  if (profileFacts?.notIncluded.length) offer.notIncluded = profileFacts.notIncluded
  if (profileFacts?.strictClaims) offer.strictClaims = true
  // P0 #5: saved offers carry their required facts (defaults unless the owner changed them).
  if (profileFacts) offer.mustAppear = [...profileFacts.mustAppear]
  if (profileFacts?.productLock) {
    // WS2 ad_profile → WS1 fidelity options: lock forces exact mode (resolveRenderOptions).
    const lock = profileFacts.productLock
    offer.productLock = lock
    if (lock.lockProductAppearance) offer.lockProductAppearance = true
    if (lock.immutableAttributes.length) offer.immutableAttributes = [...lock.immutableAttributes]
    if (lock.allowedProps.length) offer.allowedProps = [...lock.allowedProps]
  }
  if (Object.keys(byAd).length) offer.productImageUrlsByAd = byAd
  // Role per photo: 085 tags / primary first, then the free role ("control") or label; first untagged = hero.
  const rowOf = new Map(usable.map((r) => [urlOf(r), r]))
  const tagged = productUrls.map((url) => {
    const row = rowOf.get(url)
    const fromTags = row ? roleFromImageRow(row) : undefined
    const freeRole = s(row ?? null, 'role', 80)
    const rawLabel = s(row ?? null, 'label', 80)
    // import_image before 085 stores the role as an explicit "[part] …" label prefix.
    const label = stripRolePrefix(freeRole || rawLabel)
    const role = fromTags ?? roleFromLabel(freeRole) ?? roleFromLabel(rawLabel)
    return { url, label, id: s(row ?? null, 'id', 64), role, explicit: fromTags !== undefined || hasRolePrefix(rawLabel) }
  })
  if (tagged.some((t) => t.explicit || (t.role && t.role !== 'detail' && t.role !== 'hero'))) {
    let heroSet = tagged.some((t) => t.role === 'hero')
    offer.productPhotos = tagged.map((t) => {
      const role = t.role ?? (heroSet ? 'detail' : ((heroSet = true), 'hero'))
      return { url: t.url, role, ...(t.label ? { label: t.label } : {}), ...(t.id ? { id: t.id } : {}) }
    })
  }
  return { dna, offer, gaps: dna.gaps, notes }
}

// ---------------------------------------------------------------------------
// Service-level loader
// ---------------------------------------------------------------------------

export async function buildDnaFromSavedBrand(input: BuildDnaFromSavedBrandInput): Promise<SavedBrandResult> {
  const now = input.now ?? (() => new Date())
  const { db, userId, brandId } = input
  const business = await db.getBusiness(userId, brandId)
  if (!business) throw new SavedBrandError('NOT_FOUND', 'Brand not found')

  const notes: string[] = []
  const kits = await db.listBrandKits(userId, brandId)
  const resolved = resolveBrandKitForBusiness({
    linkedKits: kits.map((k) => ({ ...k, business_id: (k.business_id as string | null | undefined) ?? brandId }) as unknown as BrandKitRowLike),
    brandKitId: input.brandKitId,
  })
  if (input.brandKitId && !resolved.kit) throw new SavedBrandError('NOT_FOUND', 'Brand kit not found for this brand')
  const kit = (resolved.kit as unknown as Row | null) ?? null
  if (!kit) notes.push(`brand_kit: ${resolved.resolution} — using brand and offer data only (no colors/logo/voice from a kit)`)
  else if (resolved.resolution === 'inactive') notes.push('brand_kit: the selected kit is inactive; using it anyway')

  const product = await db.getProduct(userId, brandId, input.offerId)
  if (input.offerId && !product) throw new SavedBrandError('NOT_FOUND', 'Offer not found for this brand')
  if (!product) notes.push('offer: this brand has no saved offer/product — the pack will sell the brand itself (add an offer for product-locked images)')
  const images = product ? await db.listProductImages(userId, String(product.id)) : []

  const stored = db.getLatestSiteAnalysis ? await db.getLatestSiteAnalysis(userId, brandId).catch(() => null) : null
  const contextLinks = strings(product?.context_links, 1000, 4).filter((u) => /^https?:\/\//i.test(u))
  const websiteUrl = stored?.sourceUrl || contextLinks[0] || undefined

  let website: DnaPart | null = null
  let costUsd = 0
  if (input.refresh && websiteUrl && input.refreshWebsite) {
    try {
      website = await input.refreshWebsite(websiteUrl, 'es')
      costUsd += website.costUsd || 0
    } catch (err) {
      notes.push(`refresh: website re-read failed (${err instanceof Error ? err.message : String(err)}); using stored analysis`.slice(0, 300))
    }
  } else if (input.refresh && !websiteUrl) {
    notes.push('refresh: no website URL stored for this brand')
  }
  if (!website && stored?.analysis) {
    try {
      website = mapSiteAnalysis({ analysis: stored.analysis, url: stored.sourceUrl, fetchedAt: stored.completedAt || now().toISOString() })
      notes.push('website: reused the stored site analysis (inferred facts stay unconfirmed until the owner confirms them)')
    } catch {
      website = null
    }
  }

  // "As of" = the newest saved row (deterministic for unchanged data), else now.
  const stamps = [business, kit, product]
    .map((row) => (typeof row?.updated_at === 'string' ? Date.parse(row.updated_at) : NaN))
    .filter((t) => Number.isFinite(t))
  const fetchedAt = stamps.length ? new Date(Math.max(...stamps)).toISOString() : now().toISOString()
  if ((input.productImageIds?.length || Object.keys(input.productImageIdsByAd ?? {}).length) && !product) {
    throw new SavedBrandError('BAD_INPUT', 'productImageIds need an offer with saved product photos')
  }
  const mapped = mapSavedBrand({
    business, kit, product, images, website, fetchedAt, extraNotes: notes,
    productImageIds: input.productImageIds,
    productImageIdsByAd: input.productImageIdsByAd,
  })
  return {
    ...mapped,
    brandId,
    ...(product?.id ? { offerId: String(product.id) } : {}),
    ...(kit?.id ? { brandKitId: String(kit.id) } : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
    costUsd,
    styleDnas: parseStyleDnas(kit?.style_dnas),
  }
}
