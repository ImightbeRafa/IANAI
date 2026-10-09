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
