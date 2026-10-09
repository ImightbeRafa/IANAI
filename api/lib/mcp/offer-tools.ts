/**
 * MCP offer CRUD + product photo management (owner feedback B1, B5, C3, A2).
 *
 * create_offer / update_offer map onto the existing `products` table (same rows
 * the web offer form edits) plus the structured `products.ad_profile` jsonb
 * (migration 085). set_primary_product_image / tag_product_image write the 085
 * product_images columns. All sync writes: owner-scoped, no Advance credits.
 *
 * Migration 085 not applied yet → classic columns still save (price mirrored
 * into re_price, shipping text into shipping_info) and the response says what
 * is pending; image tools fail with MIGRATION_PENDING. Nothing crashes.
 */
import { MigrationPendingError, isMissingColumnError, MIGRATION_085 } from '../db-missing-column.js'
import { isPlaceholderValue, type IgnoredPlaceholder } from '../placeholder-guard.js'
import { PRODUCT_IMAGE_TAGS, type ProductImageTag } from '../product-image-order.js'
import {
  OfferProfileError,
  formatMoney,
  offerProfileFacts,
  parseOfferAdProfile,
  readOfferAdProfile,
  type OfferAdProfile,
} from '../adpack/offer-profile.js'
import type { McpAuthUser, McpDbClient } from './user-tools.js'

type Row = Record<string, unknown>

export interface McpStoreCapabilities {
  /** products.ad_profile */
  adProfile: boolean
  /** product_images.is_primary / tags / role / quality / source_url */
  imageMeta: boolean
  /** businesses.archived_at */
  archive: boolean
  /** brand_kits.brand_profile */
  brandProfile: boolean
}

export type McpOfferStore = {
  /** Feature detection for migration 085 columns (cached per store). */
  capabilities: () => Promise<McpStoreCapabilities>
  /** products row (select *) owned by userId inside brandId. */
  getOffer: (o: { userId: string; brandId: string; offerId: string }) => Promise<Row | null>
  /** products row owned by userId (any brand). */
  getOfferById: (o: { userId: string; offerId: string }) => Promise<Row | null>
  insertOffer: (o: { userId: string; brandId: string; row: Row }) => Promise<Row>
  updateOffer: (o: { userId: string; brandId: string; offerId: string; patch: Row }) => Promise<Row>
  /** product_images row owned by userId. */
  getProductImage: (o: { userId: string; imageId: string }) => Promise<Row | null>
  updateProductImage: (o: { userId: string; imageId: string; patch: Row }) => Promise<Row>
  clearPrimaryImages: (o: { userId: string; offerId: string; exceptImageId?: string }) => Promise<void>
  insertProductImage: (o: { userId: string; offerId: string; row: Row }) => Promise<Row>
  // Storage + upload records (create_upload_url / finalize_upload / rehost)
  createSignedUpload: (o: { path: string }) => Promise<{ signedUrl: string; token?: string; path: string }>
  statObject: (o: { path: string }) => Promise<{ size: number; contentType: string | null } | null>
  removeObject: (o: { path: string }) => Promise<void>
  publicUrl: (path: string) => string
  uploadBytes: (o: { path: string; bytes: Uint8Array; contentType: string }) => Promise<string>
  insertUploadRecord: (o: { userId: string; brandId: string; metadata: Row }) => Promise<{ id: string }>
  getUploadRecord: (o: { userId: string; uploadId: string }) => Promise<{ id: string; brandId: string; metadata: Row } | null>
  updateUploadRecord: (o: { userId: string; uploadId: string; metadata: Row }) => Promise<void>
  /** create_brand: insert an owned `businesses` row (same columns as the web brand form). */
  insertBusiness?: (o: { userId: string; row: Row }) => Promise<Row>
}

export const PRODUCT_TYPES = ['product', 'service', 'restaurant', 'real_estate', 'indumentaria'] as const

/** Offer form fields (web parity) → products columns. */
export const OFFER_TEXT_FIELDS: Array<[string, string]> = [
  ['description', 'product_description'],
  ['differentiation', 'differentiation'],
  ['keyObjection', 'key_objection'],
  ['guarantee', 'guarantee_details'],
  ['mainProblem', 'main_problem'],
  ['realPain', 'real_pain'],
  ['expectedResult', 'expected_result'],
  ['result', 'result'],
  ['bestCustomers', 'best_customers'],
  ['targetAudience', 'target_audience'],
  ['purchaseReason', 'purchase_reason'],
  ['shippingInfo', 'shipping_info'],
  ['technicalSpecs', 'technical_specs'],
  ['utility', 'utility'],
  ['offerText', 'offer'],
  ['callToAction', 'call_to_action'],
  ['productCategory', 'product_category'],
]

/** Structured ad-profile keys accepted at the top level of create_offer / update_offer. */
export const OFFER_PROFILE_KEYS = [
  'price', 'compareAtPrice', 'bundles', 'shipping', 'includes', 'excludes', 'allowedClaims', 'forbiddenClaims',
  'verifiedClaims', 'cta', 'ageMin', 'immutableAttributes', 'lockProductAppearance', 'allowedProps', 'locale',
] as const

const TEXT_MAX = 2_000
const asString = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

class OfferInputError extends Error {
  readonly code = 'BAD_INPUT'
}

function textField(field: string, raw: unknown, ignored: IgnoredPlaceholder[]): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== 'string') throw new OfferInputError(`${field} must be a string or null`)
  const v = raw.trim()
  if (!v) return null
  if (v.length > TEXT_MAX) throw new OfferInputError(`${field} must be at most ${TEXT_MAX} characters`)
  if (isPlaceholderValue(v)) {
    ignored.push({ field, value: v })
    return null
  }
  return v
}

export interface OfferPatchPlan {
  columns: Row
  /** null = no structured change requested. */
  adProfile: OfferAdProfile | null
  adProfileChangedKeys: string[]
  ignoredPlaceholders: IgnoredPlaceholder[]
}

/** Validate tool args into a products patch + merged ad profile. Throws BAD_INPUT on bad values. */
export function planOfferPatch(args: Row, mode: 'create' | 'update', existing: Row | null): OfferPatchPlan {
  const ignored: IgnoredPlaceholder[] = []
  const columns: Row = {}
  const name = textField('name', args.name, ignored)
  if (mode === 'create' && !name) throw new OfferInputError('name is required (the real product name, e.g. "Avión RC de papel")')
  if (name === null && mode === 'update' && args.name !== undefined) throw new OfferInputError('name cannot be empty or a placeholder')
  if (name) {
    if (name.length > 200) throw new OfferInputError('name must be at most 200 characters')
    columns.name = name
  }
  if (args.type !== undefined) {
    if (typeof args.type !== 'string' || !(PRODUCT_TYPES as readonly string[]).includes(args.type)) {
      throw new OfferInputError(`type must be one of ${PRODUCT_TYPES.join(', ')}`)
    }
    columns.type = args.type
  } else if (mode === 'create') columns.type = 'product'
  for (const [argKey, col] of OFFER_TEXT_FIELDS) {
    const v = textField(argKey, args[argKey], ignored)
    if (v !== undefined) columns[col] = v
  }
  if ('guarantee' in args) columns.has_guarantee = Boolean(columns.guarantee_details)

  const profileArgs: Row = {}
  for (const key of OFFER_PROFILE_KEYS) if (key in args) profileArgs[key] = args[key]
  const existingProfile = readOfferAdProfile(existing?.ad_profile)
  let adProfile: OfferAdProfile | null = null
  let changedKeys: string[] = []
  if (Object.keys(profileArgs).length) {
    try {
      const parsed = parseOfferAdProfile(profileArgs, existingProfile)
      adProfile = parsed.profile
      changedKeys = parsed.changedKeys
      ignored.push(...parsed.ignoredPlaceholders)
    } catch (err) {
      if (err instanceof OfferProfileError) throw new OfferInputError(err.message)
      throw err
    }
    // Mirrors into classic columns: the web offer form and pre-085 databases still see the price / shipping.
    if (changedKeys.includes('price')) columns.re_price = adProfile.price ? formatMoney(adProfile.price) : null
    if (changedKeys.includes('shipping') && !('shippingInfo' in args) && adProfile.shipping?.text) columns.shipping_info = adProfile.shipping.text
  }
  return { columns, adProfile, adProfileChangedKeys: changedKeys, ignoredPlaceholders: ignored }
}

/** Compact offer view (never the whole products row). */
export function offerView(row: Row, adProfile?: OfferAdProfile | null): Row {
  const profile = adProfile ?? readOfferAdProfile(row.ad_profile)
  const facts = offerProfileFacts(profile, 'es').facts
  return {
    offerId: row.id,
    brandId: row.business_id ?? null,
    name: row.name,
    type: row.type ?? null,
    price: profile?.price ? formatMoney(profile.price) : (typeof row.re_price === 'string' ? row.re_price : null),
    description: row.product_description ?? null,
    differentiation: row.differentiation ?? null,
    keyObjection: row.key_objection ?? null,
    guarantee: row.guarantee_details ?? null,
    shippingInfo: row.shipping_info ?? null,
    adProfile: profile ?? null,
    /** Exactly how ads will state these facts (confirmed). */
    confirmedFacts: facts.map((f) => ({ key: f.key, value: f.value })),
  }
}

function pendingNote(): string {
  return `Migration ${MIGRATION_085} is not applied yet: the structured ad profile (bundles, claims, includes/excludes, age, CTA, product lock) was NOT saved. Classic fields were saved; price and shipping text were mirrored into the offer form fields.`
}

async function writeOffer(options: {
  store: McpOfferStore
  userId: string
  brandId: string
  offerId?: string
  plan: OfferPatchPlan
}): Promise<{ row: Row; adProfileSaved: boolean; warnings: string[] }> {
  const { store, userId, brandId, plan } = options
  const caps = await store.capabilities()
  const warnings: string[] = []
  const columns: Row = { ...plan.columns }
  let adProfileSaved = false
  if (plan.adProfile && plan.adProfileChangedKeys.length) {
    if (caps.adProfile) {
      columns.ad_profile = plan.adProfile
      adProfileSaved = true
    } else warnings.push(pendingNote())
  }
  const write = (patch: Row) => options.offerId
    ? store.updateOffer({ userId, brandId, offerId: options.offerId, patch: { ...patch, updated_at: new Date().toISOString() } })
    : store.insertOffer({ userId, brandId, row: patch })
  try {
    return { row: await write(columns), adProfileSaved, warnings }
  } catch (err) {
    // Capabilities cache was stale (or another 085 column is missing): degrade once.
    if ('ad_profile' in columns && isMissingColumnError(err, 'ad_profile')) {
      delete columns.ad_profile
      warnings.push(pendingNote())
      return { row: await write(columns), adProfileSaved: false, warnings }
    }
    throw err
  }
}

function result(status: 'created' | 'updated', row: Row, plan: OfferPatchPlan, saved: { adProfileSaved: boolean; warnings: string[] }): Row {
  return {
    status,
    offer: offerView(row, saved.adProfileSaved ? plan.adProfile : undefined),
    adProfileSaved: saved.adProfileSaved,
    ...(saved.adProfileSaved ? {} : plan.adProfileChangedKeys.length ? { migrationPending: MIGRATION_085 } : {}),
    ...(plan.ignoredPlaceholders.length
      ? { ignoredPlaceholders: plan.ignoredPlaceholders, placeholderNote: 'Placeholder values were not saved (they would leak into ads). Send the real value.' }
      : {}),
    ...(saved.warnings.length ? { warnings: saved.warnings } : {}),
    creditsNote: 'Free sync write — no Advance credits.',
    nextStep: 'Ads use these exact facts. Run adpack_from_brand {brandId, offerId} to review, or adpack_start {brandId, offerId, size}.',
  }
}

async function assertBrand(db: McpDbClient, user: McpAuthUser, brandId: string): Promise<void> {
  if (!brandId) throw new OfferInputError('brandId is required')
  const brand = await db.getBusinessForUser(user.id, brandId)
  if (!brand) throw new Error('Brand not found')
}

export async function mcpCreateOffer(options: { db: McpDbClient; store: McpOfferStore; user: McpAuthUser; args: Row }): Promise<Row> {
  const brandId = asString(options.args.brandId)
  await assertBrand(options.db, options.user, brandId)
  const plan = planOfferPatch(options.args, 'create', null)
  const saved = await writeOffer({ store: options.store, userId: options.user.id, brandId, plan })
  return result('created', saved.row, plan, saved)
}

export async function mcpUpdateOffer(options: { db: McpDbClient; store: McpOfferStore; user: McpAuthUser; args: Row }): Promise<Row> {
  const brandId = asString(options.args.brandId)
  const offerId = asString(options.args.offerId)
  if (!offerId) throw new OfferInputError('offerId is required')
  await assertBrand(options.db, options.user, brandId)
  const existing = await options.store.getOffer({ userId: options.user.id, brandId, offerId })
  if (!existing) throw new Error('Offer not found for this brand')
  const plan = planOfferPatch(options.args, 'update', existing)
  if (!Object.keys(plan.columns).length && !plan.adProfileChangedKeys.length) {
    if (plan.ignoredPlaceholders.length) return { ...result('updated', existing, plan, { adProfileSaved: false, warnings: [] }), status: 'unchanged' }
    throw new OfferInputError('Nothing to update: pass at least one offer field')
  }
  const saved = await writeOffer({ store: options.store, userId: options.user.id, brandId, offerId, plan })
  return result('updated', saved.row, plan, saved)
}

// ---------------------------------------------------------------------------
// Product photos (C3)
// ---------------------------------------------------------------------------

async function ownedOfferImage(store: McpOfferStore, user: McpAuthUser, args: Row): Promise<{ image: Row; offer: Row }> {
  const imageId = asString(args.productImageId)
  if (!imageId) throw new OfferInputError('productImageId is required (from list_assets)')
  const image = await store.getProductImage({ userId: user.id, imageId })
  if (!image) throw new Error('Product image not found')
  const offerId = asString(args.offerId) || String(image.product_id || '')
  if (String(image.product_id) !== offerId) throw new Error('Product image does not belong to this offer')
  const offer = await store.getOfferById({ userId: user.id, offerId })
  if (!offer) throw new Error('Offer not found')
  if (args.brandId !== undefined && asString(args.brandId) !== String(offer.business_id)) throw new Error('Offer not found for this brand')
  return { image, offer }
}

function imageView(row: Row): Row {
  return {
    productImageId: row.id,
    offerId: row.product_id,
    imageUrl: row.image_url,
    kind: row.kind ?? null,
    isPrimary: row.is_primary === true,
    tags: Array.isArray(row.tags) ? row.tags : [],
    role: row.role ?? null,
    quality: row.quality ?? null,
  }
}

export async function mcpSetPrimaryProductImage(options: { store: McpOfferStore; user: McpAuthUser; args: Row }): Promise<Row> {
  const caps = await options.store.capabilities()
  if (!caps.imageMeta) throw new MigrationPendingError('set_primary_product_image')
  const { image, offer } = await ownedOfferImage(options.store, options.user, options.args)
  if (image.kind === 'generated' || image.kind === 'context') {
    throw new OfferInputError(`Only real product photos can be primary (this image is kind "${String(image.kind)}")`)
  }
  await options.store.clearPrimaryImages({ userId: options.user.id, offerId: String(offer.id), exceptImageId: String(image.id) })
  const updated = await options.store.updateProductImage({ userId: options.user.id, imageId: String(image.id), patch: { is_primary: true } })
  return {
    status: 'updated',
    image: imageView(updated),
    message: 'This photo is now the hero product photo for the offer (ads and bulk posts use it first).',
    creditsNote: 'Free sync write — no Advance credits.',
  }
}

export async function mcpTagProductImage(options: { store: McpOfferStore; user: McpAuthUser; args: Row }): Promise<Row> {
  const caps = await options.store.capabilities()
  if (!caps.imageMeta) throw new MigrationPendingError('tag_product_image')
  const raw = options.args.tags
  if (!Array.isArray(raw) || raw.length > PRODUCT_IMAGE_TAGS.length) {
    throw new OfferInputError(`tags must be an array of: ${PRODUCT_IMAGE_TAGS.join(', ')}`)
  }
  const tags: ProductImageTag[] = []
  for (const t of raw) {
    if (typeof t !== 'string' || !(PRODUCT_IMAGE_TAGS as readonly string[]).includes(t)) {
      throw new OfferInputError(`Unknown tag "${String(t)}". Allowed: ${PRODUCT_IMAGE_TAGS.join(', ')}`)
    }
    if (!tags.includes(t as ProductImageTag)) tags.push(t as ProductImageTag)
  }
  const patch: Row = { tags }
  if ('role' in options.args) {
    const role = options.args.role
    if (role !== null && (typeof role !== 'string' || role.trim().length > 60)) throw new OfferInputError('role must be a string of at most 60 characters, or null')
    patch.role = typeof role === 'string' && role.trim() && !isPlaceholderValue(role) ? role.trim() : null
  }
  const { image } = await ownedOfferImage(options.store, options.user, options.args)
  const updated = await options.store.updateProductImage({ userId: options.user.id, imageId: String(image.id), patch })
  return { status: 'updated', image: imageView(updated), creditsNote: 'Free sync write — no Advance credits.' }
}
