/**
 * `create_brand` — start a brand from zero through MCP (same `businesses` row the web brand form
 * creates) and, by default, its primary brand kit in the same call. Free sync write.
 *
 * Duplicate guard (B4): a non-archived brand whose name normalizes to the same key is returned
 * instead of creating another one (`status: "exists"`), unless `allowDuplicate: true`.
 */
import { isPlaceholderValue } from '../placeholder-guard.js'
import { mcpCreateBrandKit, type McpBrandKitStore } from './brand-kit-tools.js'
import type { RehostFn } from './asset-rehost.js'
import type { McpOfferStore } from './offer-tools.js'
import { normalizeBrandName, type McpAuthUser, type McpDbClient } from './user-tools.js'
import { resolveMcpBrandKit } from './brand-kit-tools.js'
import { readBrandProfile, type BrandProfile } from '../brand-profile.js'
import type { IgnoredPlaceholder } from '../placeholder-guard.js'

type Row = Record<string, unknown>

export const SALES_CHANNELS = ['website', 'messages', 'physical'] as const
const asString = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

class BrandInputError extends Error {
  readonly code = 'BAD_INPUT'
}

function optText(args: Row, key: string, max: number): string | null | undefined {
  const raw = args[key]
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== 'string') throw new BrandInputError(`${key} must be a string`)
  const v = raw.trim()
  if (!v || isPlaceholderValue(v)) return null
  if (v.length > max) throw new BrandInputError(`${key} must be at most ${max} characters`)
  return v
}

export async function mcpCreateBrand(options: {
  db: McpDbClient
  store: McpOfferStore
  kitStore?: McpBrandKitStore | null
  user: McpAuthUser
  args: Row
  rehost?: RehostFn | null
}): Promise<Row> {
  const { args, user } = options
  if (!options.store.insertBusiness) throw new Error('Brand store not configured')
  const name = asString(args.name)
  if (!name) throw new BrandInputError('name is required (the real brand name)')
  if (name.length > 120) throw new BrandInputError('name must be at most 120 characters')
  if (isPlaceholderValue(name)) throw new BrandInputError('name looks like a placeholder: send the real brand name')

  const row: Row = { name }
  const location = optText(args, 'location', 200)
  if (location) row.location = location
  const shippingMethod = optText(args, 'shippingMethod', 200)
  if (shippingMethod) row.shipping_method = shippingMethod
  const icp = optText(args, 'icpDescription', 1000)
  if (icp) row.icp_description = icp
  if (args.doesShipping !== undefined) {
    if (typeof args.doesShipping !== 'boolean') throw new BrandInputError('doesShipping must be a boolean')
    row.does_shipping = args.doesShipping
  } else row.does_shipping = false
  if (args.salesChannels !== undefined) {
    if (!Array.isArray(args.salesChannels) || args.salesChannels.some((c) => !(SALES_CHANNELS as readonly string[]).includes(String(c)))) {
      throw new BrandInputError(`salesChannels must be an array of ${SALES_CHANNELS.join(', ')}`)
    }
    row.sales_channels = [...new Set(args.salesChannels as string[])]
  } else row.sales_channels = []
  if (args.createKit !== undefined && typeof args.createKit !== 'boolean') throw new BrandInputError('createKit must be a boolean')
  if (args.kit !== undefined && (args.kit === null || typeof args.kit !== 'object' || Array.isArray(args.kit))) throw new BrandInputError('kit must be an object with update_brand_kit fields')

  const key = normalizeBrandName(name)
  if (args.allowDuplicate !== true) {
    const existing = (await options.db.listBusinessesForUser(user.id, { includeArchived: false })).find((b) => normalizeBrandName(b.name) === key)
    if (existing) {
      return {
        status: 'exists',
        brand: { brandId: existing.id, name: existing.name },
        message: `A brand named "${existing.name}" already exists (${existing.id}). Use that brandId (nothing was created). Pass allowDuplicate: true only if the user really wants a second brand with the same name.`,
        nextStep: 'get_brand_context { brandId } to see its offers and kit.',
        creditsNote: 'Free — no Advance credits.',
      }
    }
  }

  const inserted = await options.store.insertBusiness({ userId: user.id, row })
  const brandId = String(inserted.id)
  const out: Row = {
    status: 'created',
    brand: { brandId, name: String(inserted.name ?? name), ...(row.location ? { location: row.location } : {}), salesChannels: row.sales_channels },
    creditsNote: 'Free sync write — no Advance credits.',
  }
  const wantsKit = args.createKit !== false
  if (wantsKit) {
    if (!options.kitStore) {
      out.warnings = ['Brand kit store not configured: call create_brand_kit { brandId } next.']
    } else {
      const kitArgs = { ...((args.kit as Row | undefined) ?? {}) }
      delete kitArgs.brandId
      const kit = await mcpCreateBrandKit({
        store: options.kitStore,
        db: options.db,
        user,
        rehost: options.rehost,
        args: { name: `${name}`, ...kitArgs, brandId, setAsPrimary: true },
      })
      const k = kit.kit as Row | undefined
      out.brandKit = { brandKitId: k?.id ?? null, name: k?.name ?? null, isPrimary: true }
      for (const extra of ['ignoredPlaceholders', 'warnings', 'rehosted', 'migrationPending'] as const) if (kit[extra] !== undefined) out[`brandKit_${extra}`] = kit[extra]
    }
  }
  out.nextSteps = [
    wantsKit ? 'update_brand_kit { brandId, kitId, fonts, colors, locale, register, forbiddenPhrases… }' : 'create_brand_kit { brandId, … }',
    'import_image { brandId, kind: "logo", url } (Drive/Dropbox/https; background removed automatically)',
    'create_offer { brandId, name, price, bundles, includes, excludes, verifiedClaims, ageMin, immutableAttributes, allowedProps… }',
    'import_images { brandId, offerId, items: [{ url, kind: "product_photo", role: "hero" }, …] }',
    'create_ads { brandId, offerId, count, ratios: ["4:5","9:16"] }',
  ]
  return out
}

// ---------------------------------------------------------------------------
// #22 update_brand / set_default_offer
// ---------------------------------------------------------------------------

/** Text field for update_brand: null/"" clears; a placeholder ("country", "N/A"…) is never stored (reported). */
function updText(args: Row, key: string, max: number, ignored: IgnoredPlaceholder[]): string | null | undefined {
  const raw = args[key]
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== 'string') throw new BrandInputError(`${key} must be a string`)
  const v = raw.replace(/\s+/g, ' ').trim()
  if (!v) return null
  if (v.length > max) throw new BrandInputError(`${key} is ${v.length} characters; the maximum is ${max} (nothing was saved)`)
  if (isPlaceholderValue(v)) {
    ignored.push({ field: key, value: v })
    return undefined
  }
  return v
}

/** Edit the brand record (same fields as create_brand / the web brand form). Free sync write. */
export async function mcpUpdateBrand(options: { db: McpDbClient; store: McpOfferStore; user: McpAuthUser; args: Row }): Promise<Row> {
  const { args, user } = options
  if (!options.store.updateBusiness) throw new Error('Brand store not configured')
  const brandId = asString(args.brandId)
  if (!brandId) throw new BrandInputError('brandId is required (list_brands)')
  const brand = await options.db.getBusinessForUser(user.id, brandId)
  if (!brand) throw Object.assign(new Error('Brand not found'), { code: 'NOT_FOUND' })
  const ignored: IgnoredPlaceholder[] = []
  const patch: Row = {}
  if (args.name !== undefined) {
    const name = asString(args.name)
    if (!name) throw new BrandInputError('name cannot be empty')
    if (name.length > 120) throw new BrandInputError(`name is ${name.length} characters; the maximum is 120 (nothing was saved)`)
    if (isPlaceholderValue(name)) throw new BrandInputError('name looks like a placeholder: send the real brand name')
    patch.name = name
  }
  const location = updText(args, 'location', 200, ignored)
  if (location !== undefined) patch.location = location
  const shippingMethod = updText(args, 'shippingMethod', 200, ignored)
  if (shippingMethod !== undefined) patch.shipping_method = shippingMethod
  const icp = updText(args, 'icpDescription', 1000, ignored)
  if (icp !== undefined) patch.icp_description = icp
  if (args.doesShipping !== undefined) {
    if (typeof args.doesShipping !== 'boolean') throw new BrandInputError('doesShipping must be a boolean')
    patch.does_shipping = args.doesShipping
  }
  if (args.salesChannels !== undefined) {
    if (!Array.isArray(args.salesChannels) || args.salesChannels.some((c) => !(SALES_CHANNELS as readonly string[]).includes(String(c)))) {
      throw new BrandInputError(`salesChannels must be an array of ${SALES_CHANNELS.join(', ')}`)
    }
    patch.sales_channels = [...new Set(args.salesChannels as string[])]
  }
  const out: Row = { brandId, creditsNote: 'Free sync write — no Advance credits.' }
  if (ignored.length) {
    out.ignoredPlaceholders = ignored
    out.placeholderNote = 'Placeholder values were not stored (they would leak into ads, e.g. "Hecho para country"). Send the real value, or null to clear the field.'
  }
  if (!Object.keys(patch).length) return { ...out, status: 'unchanged', message: 'Nothing to update (send name, location, salesChannels, doesShipping, shippingMethod or icpDescription).' }
  if (typeof patch.name === 'string' && normalizeBrandName(patch.name) !== normalizeBrandName(brand.name)) {
    const clash = (await options.db.listBusinessesForUser(user.id, { includeArchived: false })).find((b) => b.id !== brandId && normalizeBrandName(b.name) === normalizeBrandName(patch.name as string))
    if (clash) out.warnings = [`Another brand is also named "${clash.name}" (${clash.id}); select brands by brandId.`]
  }
  const saved = await options.store.updateBusiness({ userId: user.id, brandId, patch })
  if (!saved) throw Object.assign(new Error('Brand not found'), { code: 'NOT_FOUND' })
  return {
    ...out,
    status: 'updated',
    updated: Object.keys(patch),
    brand: {
      brandId,
      name: saved.name ?? brand.name,
      location: saved.location ?? null,
      salesChannels: saved.sales_channels ?? null,
      doesShipping: saved.does_shipping ?? null,
      shippingMethod: saved.shipping_method ?? null,
      icpDescription: saved.icp_description ?? null,
    },
  }
}

/**
 * Pick the offer tools use when offerId is omitted (adpack_start / create_ads / adpack_from_brand).
 * Stored on the brand's primary kit profile (brand_kits.brand_profile.defaultOfferId; 085, no new migration).
 */
export async function mcpSetDefaultOffer(options: { db: McpDbClient; kitStore: McpBrandKitStore; user: McpAuthUser; args: Row }): Promise<Row> {
  const { args, user } = options
  const brandId = asString(args.brandId)
  const offerId = asString(args.offerId)
  if (!brandId) throw new BrandInputError('brandId is required (list_brands)')
  if (!offerId) throw new BrandInputError('offerId is required (list_offers)')
  const brand = await options.db.getBusinessForUser(user.id, brandId)
  if (!brand) throw Object.assign(new Error('Brand not found'), { code: 'NOT_FOUND' })
  const offers = await options.db.listOffersForBrand(user.id, brandId)
  const offer = offers.find((o) => o.id === offerId)
  if (!offer) throw Object.assign(new Error('Offer not found for this brand (list_offers)'), { code: 'NOT_FOUND' })
  const resolved = await resolveMcpBrandKit({ store: options.kitStore, userId: user.id, brandId })
  const kitId = resolved.brandKit?.id
  if (!kitId) throw Object.assign(new Error('This brand has no primary brand kit: create_brand_kit first (the default offer is stored on it)'), { code: 'NOT_READY' })
  if (!(options.kitStore.hasBrandProfile ? await options.kitStore.hasBrandProfile() : false)) {
    throw Object.assign(new Error('Migration 085 is not applied: the default offer cannot be saved yet'), { code: 'UNAVAILABLE' })
  }
  const kit = await options.kitStore.getKit({ userId: user.id, kitId })
  const profile: BrandProfile = { ...(readBrandProfile(kit?.brand_profile) ?? {}), defaultOfferId: offerId, updatedAt: new Date().toISOString() }
  await options.kitStore.updateKit({ userId: user.id, kitId, patch: { brand_profile: profile, updated_at: new Date().toISOString() } })
  return {
    status: 'updated',
    brandId,
    defaultOfferId: offerId,
    offerName: offer.name,
    brandKitId: kitId,
    message: `"${offer.name}" is now the default offer: tools that omit offerId (create_ads, adpack_start, adpack_from_brand) use it.`,
    creditsNote: 'Free sync write — no Advance credits.',
  }
}
