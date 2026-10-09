/**
 * MCP Brand Kit CRUD — sync_write (no Advance credits). Explicit business_id linking.
 */

import { assertPublicHttpsUrl } from '../brand-kit-resolve.js'
import {
  resolveBrandKitForBusiness,
  type BrandKitResolution,
  type BrandKitRowLike,
} from '../brand-kit-resolve.js'
import { parseStyleDnas, type StyleDna } from '../bulk/style-dna.js'
import { issueMcpChatApproval } from './approval-prompt.js'
import {
  assertMcpApprovalReady,
  consumeMcpApprovalRequest,
  replayMcpApprovalResult,
  storeMcpApprovalResult,
  type McpApprovalStore,
} from './approval.js'
import type { McpAuthUser, McpBrandKitContext, McpDbClient } from './user-tools.js'
import { isPlaceholderValue, type IgnoredPlaceholder } from '../placeholder-guard.js'
import {
  activeStyleDnaIds,
  BRAND_PROFILE_PATCH_KEYS,
  BrandProfileError,
  parseBrandProfilePatch,
  readBrandProfile,
  type BrandProfile,
} from '../brand-profile.js'
import { MIGRATION_085, isMissingColumnError } from '../db-missing-column.js'
import type { RehostFn } from './asset-rehost.js'

export type McpBrandKitSummary = {
  id: string
  name: string
  businessId: string | null
  isPrimaryForBusiness: boolean
  isDefault: boolean
  isActive: boolean
  primaryColor: string | null
  secondaryColor: string | null
  accentColor: string | null
  hasLogo: boolean
  tagline: string | null
}

export type McpBrandKitStore = {
  listKits: (opts: {
    userId: string
    brandId?: string
    includeInactive?: boolean
  }) => Promise<BrandKitRowLike[]>
  getKit: (opts: { userId: string; kitId: string }) => Promise<BrandKitRowLike | null>
  countKits: (userId: string) => Promise<number>
  insertKit: (opts: {
    userId: string
    row: Record<string, unknown>
  }) => Promise<BrandKitRowLike>
  updateKit: (opts: {
    userId: string
    kitId: string
    patch: Record<string, unknown>
  }) => Promise<BrandKitRowLike>
  clearPrimaryForBusiness: (opts: {
    userId: string
    businessId: string
    exceptKitId?: string
  }) => Promise<void>
  deleteKit: (opts: { userId: string; kitId: string }) => Promise<void>
  assertOwnsBrand: (userId: string, brandId: string) => Promise<boolean>
  /** 085 brand_kits.brand_profile present? Omitted → treated as not available. */
  hasBrandProfile?: () => Promise<boolean>
}

const PLAN_KIT_SOFT_LIMIT = 50

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('Expected string or null')
  const t = value.trim()
  return t || null
}

function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('Expected string array')
  return value.map((v) => {
    if (typeof v !== 'string') throw new Error('Expected string array')
    return v.trim()
  }).filter(Boolean)
}

function mapKitContext(row: BrandKitRowLike): McpBrandKitContext {
  return {
    id: row.id,
    name: row.name,
    primaryColor: row.primary_color ?? null,
    secondaryColor: row.secondary_color ?? null,
    accentColor: row.accent_color ?? null,
    logoUrl: row.logo_url ?? null,
    tagline: row.tagline ?? null,
    brandVoice: row.brand_voice ?? null,
    toneKeywords: Array.isArray(row.tone_keywords) ? row.tone_keywords : [],
    targetAudience: row.target_audience ?? null,
    visualStyleNotes: row.visual_style_notes ?? null,
    fontPrimary: row.font_primary ?? null,
    referenceImages: Array.isArray(row.reference_images) ? row.reference_images : [],
    styleDnas: parseStyleDnas(row.style_dnas),
  }
}

function mapKitSummary(row: BrandKitRowLike): McpBrandKitSummary {
  return {
    id: row.id,
    name: row.name,
    businessId: row.business_id ?? null,
    isPrimaryForBusiness: row.is_primary_for_business === true,
    isDefault: row.is_default === true,
    isActive: row.is_active !== false,
    primaryColor: row.primary_color ?? null,
    secondaryColor: row.secondary_color ?? null,
    accentColor: row.accent_color ?? null,
    hasLogo: Boolean(row.logo_url),
    tagline: row.tagline ?? null,
  }
}

function mapKitDetail(row: BrandKitRowLike): Record<string, unknown> {
  const profile = readBrandProfile(row.brand_profile)
  const dnaIds = parseStyleDnas(row.style_dnas).map((d) => d.id)
  return {
    ...mapKitSummary(row),
    brandProfile: profile,
    // #12: always echoed. null = no explicit selection (every kit Style DNA applies); [] = none.
    styleDnaIds: profile?.styleDnaIds ?? null,
    activeStyleDnaIds: activeStyleDnaIds(dnaIds, profile),
    logoUrl: row.logo_url ?? null,
    fontPrimary: row.font_primary ?? null,
    fontSecondary: row.font_secondary ?? null,
    industry: row.industry ?? null,
    brandVoice: row.brand_voice ?? null,
    toneKeywords: Array.isArray(row.tone_keywords) ? row.tone_keywords : [],
    mustUsePhrases: Array.isArray(row.must_use_phrases) ? row.must_use_phrases : [],
    forbiddenPhrases: Array.isArray(row.forbidden_phrases) ? row.forbidden_phrases : [],
    targetAudience: row.target_audience ?? null,
    visualStyleNotes: row.visual_style_notes ?? null,
    referenceImages: Array.isArray(row.reference_images) ? row.reference_images : [],
    styleDnas: parseStyleDnas(row.style_dnas),
    creditsNote: 'Brand kit sync writes consume no Advance credits.',
  }
}

export async function resolveMcpBrandKit(options: {
  store: McpBrandKitStore
  userId: string
  brandId: string
  brandKitId?: string
}): Promise<{
  brandKit: McpBrandKitContext | null
  brandKits: McpBrandKitSummary[]
  brandKitResolution: BrandKitResolution
  linkedCount: number
  activeCount: number
}> {
  const linked = await options.store.listKits({
    userId: options.userId,
    brandId: options.brandId,
    includeInactive: true,
  })
  const resolved = resolveBrandKitForBusiness({
    linkedKits: linked,
    brandKitId: options.brandKitId,
  })
  return {
    brandKit: resolved.kit ? mapKitContext(resolved.kit) : null,
    brandKits: linked.map(mapKitSummary),
    brandKitResolution: resolved.resolution,
    linkedCount: resolved.linkedCount,
    activeCount: resolved.activeCount,
  }
}

export async function mcpListBrandKits(options: {
  store: McpBrandKitStore
  user: McpAuthUser
  args: Record<string, unknown>
}): Promise<{ kits: McpBrandKitSummary[]; creditsNote: string }> {
  const brandId = asString(options.args.brandId) || undefined
  const includeInactive = options.args.includeInactive === true
  if (brandId) {
    const owns = await options.store.assertOwnsBrand(options.user.id, brandId)
    if (!owns) throw new Error('Brand not found')
  }
  const rows = await options.store.listKits({
    userId: options.user.id,
    brandId,
    includeInactive,
  })
  return {
    kits: rows.map(mapKitSummary),
    creditsNote: 'Free sync read — no Advance credits.',
  }
}

export async function mcpGetBrandKit(options: {
  store: McpBrandKitStore
  user: McpAuthUser
  args: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const kitId = asString(options.args.kitId)
  const brandId = asString(options.args.brandId) || undefined
  if (!kitId && !brandId) {
    throw new Error('Provide kitId, or brandId to resolve the primary kit')
  }
  if (!kitId && brandId) {
    const owns = await options.store.assertOwnsBrand(options.user.id, brandId)
    if (!owns) throw new Error('Brand not found')
    const kits = await options.store.listKits({
      userId: options.user.id,
      brandId,
      includeInactive: false,
    })
    const primary =
      kits.find((k) => k.is_primary_for_business === true) ||
      kits.find((k) => k.is_default === true) ||
      kits[0]
    if (!primary) throw new Error('No brand kit linked to this brand')
    return {
      ...mapKitDetail(primary),
      resolvedFrom: 'brandId',
      brandId,
    }
  }
  const row = await options.store.getKit({ userId: options.user.id, kitId })
  if (!row) throw new Error('Brand kit not found')
  if (brandId && row.business_id && row.business_id !== brandId) {
    throw new Error('Brand kit is linked to a different brand')
  }
  return mapKitDetail(row)
}

async function maybeSetPrimary(options: {
  store: McpBrandKitStore
  userId: string
  kitId: string
  businessId: string
}): Promise<void> {
  await options.store.clearPrimaryForBusiness({
    userId: options.userId,
    businessId: options.businessId,
    exceptKitId: options.kitId,
  })
  await options.store.updateKit({
    userId: options.userId,
    kitId: options.kitId,
    patch: {
      business_id: options.businessId,
      is_primary_for_business: true,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
  })
}

/** Free-text kit fields where placeholders ("country", "N/A", "Personas 18–65") must never be stored (B3). */
const GUARDED_SCALARS = new Set(['tagline', 'industry', 'targetAudience', 'brandVoice', 'visualStyleNotes'])
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Normalize aliases: fonts {heading, body} → fontPrimary/fontSecondary; colors {primary, secondary, accent}. */
function normalizeKitArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args }
  if (args.fonts !== undefined) {
    if (!args.fonts || typeof args.fonts !== 'object' || Array.isArray(args.fonts)) throw new Error('fonts must be { heading?, body? }')
    const f = args.fonts as Record<string, unknown>
    if (f.heading !== undefined) out.fontPrimary = f.heading
    if (f.body !== undefined) out.fontSecondary = f.body
    delete out.fonts
  }
  if (args.colors !== undefined) {
    if (!args.colors || typeof args.colors !== 'object' || Array.isArray(args.colors)) throw new Error('colors must be { primary?, secondary?, accent? } hex values')
    const c = args.colors as Record<string, unknown>
    for (const [k, col] of [['primary', 'primaryColor'], ['secondary', 'secondaryColor'], ['accent', 'accentColor']] as const) {
      if (c[k] === undefined) continue
      if (c[k] !== null && (typeof c[k] !== 'string' || !HEX_RE.test(c[k] as string))) throw new Error(`colors.${k} must be a hex color like #1F6F5C`)
      out[col] = c[k]
    }
    delete out.colors
  }
  return out
}

function buildWritableFields(
  args: Record<string, unknown>,
  mode: 'create' | 'update',
  ignored: IgnoredPlaceholder[] = [],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const name = asOptionalString(args.name)
  if (mode === 'create') {
    if (!name) throw new Error('name is required')
    patch.name = name
  } else if (name !== undefined) {
    if (!name) throw new Error('name cannot be empty')
    patch.name = name
  }

  const scalars: Array<[string, string]> = [
    ['logoUrl', 'logo_url'],
    ['primaryColor', 'primary_color'],
    ['secondaryColor', 'secondary_color'],
    ['accentColor', 'accent_color'],
    ['fontPrimary', 'font_primary'],
    ['fontSecondary', 'font_secondary'],
    ['tagline', 'tagline'],
    ['industry', 'industry'],
    ['targetAudience', 'target_audience'],
    ['brandVoice', 'brand_voice'],
    ['visualStyleNotes', 'visual_style_notes'],
  ]
  for (const [argKey, col] of scalars) {
    if (!(argKey in args)) continue
    let value = asOptionalString(args[argKey])
    if (GUARDED_SCALARS.has(argKey) && typeof value === 'string' && isPlaceholderValue(value)) {
      // Clear instead of storing the placeholder (also repairs a kit that already holds one).
      ignored.push({ field: argKey, value })
      value = null
    }
    if (argKey === 'logoUrl' && typeof value === 'string') {
      patch[col] = assertPublicHttpsUrl(value, 'logoUrl')
    } else {
      patch[col] = value
    }
  }

  const arrays: Array<[string, string]> = [
    ['toneKeywords', 'tone_keywords'],
    ['mustUsePhrases', 'must_use_phrases'],
    ['forbiddenPhrases', 'forbidden_phrases'],
    ['referenceImageUrls', 'reference_images'],
  ]
  for (const [argKey, col] of arrays) {
    if (!(argKey in args)) continue
    let arr = asStringArray(args[argKey])
    if (arr && argKey !== 'referenceImageUrls') {
      arr = arr.filter((v) => {
        if (!isPlaceholderValue(v)) return true
        ignored.push({ field: argKey, value: v })
        return false
      })
    }
    if (argKey === 'referenceImageUrls' && arr) {
      patch[col] = arr.map((u) => assertPublicHttpsUrl(u, 'referenceImageUrls item'))
    } else {
      patch[col] = arr
    }
  }

  if ('isActive' in args) {
    patch.is_active = args.isActive !== false
  }
  if ('isDefault' in args) {
    patch.is_default = args.isDefault === true
  }
  if ('styleDnas' in args) {
    patch.style_dnas = parseStyleDnas(args.styleDnas) as StyleDna[]
  }

  return patch
}

export interface KitWritePlan {
  fields: Record<string, unknown>
  ignoredPlaceholders: IgnoredPlaceholder[]
  warnings: string[]
  rehosted: Array<{ field: string; url: string; sourceUrl: string }>
  brandProfileSaved: boolean
}

/** Profile keys accepted at the top level of create/update_brand_kit (stored in brand_profile). */
export const KIT_PROFILE_ARG_KEYS = BRAND_PROFILE_PATCH_KEYS.filter((k) => k !== 'defaultOfferId')

/**
 * Validate kit args into a brand_kits patch: classic columns + brand_profile (085),
 * placeholder guard, and C2 rehost of logo / reference / logo-variant URLs.
 */
export async function planKitWrite(options: {
  store: McpBrandKitStore
  userId: string
  args: Record<string, unknown>
  mode: 'create' | 'update'
  existing: BrandKitRowLike | null
  rehost?: RehostFn | null
}): Promise<KitWritePlan> {
  const args = normalizeKitArgs(options.args)
  const ignored: IgnoredPlaceholder[] = []
  const warnings: string[] = []
  const fields = buildWritableFields(args, options.mode, ignored)

  const profilePatch: Record<string, unknown> = {}
  for (const key of KIT_PROFILE_ARG_KEYS) if (key in args) profilePatch[key] = args[key]
  let brandProfileSaved = false
  if (Object.keys(profilePatch).length) {
    const knownStyleDnaIds = parseStyleDnas(fields.style_dnas ?? options.existing?.style_dnas).map((d) => d.id)
    let parsed: ReturnType<typeof parseBrandProfilePatch>
    try {
      parsed = parseBrandProfilePatch(profilePatch, readBrandProfile(options.existing?.brand_profile), {
        assertUrl: (u, label) => assertPublicHttpsUrl(u, label),
        knownStyleDnaIds,
      })
    } catch (err) {
      if (err instanceof BrandProfileError) throw Object.assign(new Error(err.message), { code: 'BAD_INPUT' })
      throw err
    }
    ignored.push(...parsed.ignoredPlaceholders)
    const supported = options.store.hasBrandProfile ? await options.store.hasBrandProfile() : false
    if (supported) {
      fields.brand_profile = parsed.profile
      brandProfileSaved = true
    } else {
      warnings.push(`Migration ${MIGRATION_085} is not applied yet: ${parsed.changedKeys.join(', ')} (audiences/locale/register/do/dont/logo variants/styleDnaIds) were NOT saved. Classic kit fields were saved.`)
    }
  }

  const rehosted: KitWritePlan['rehosted'] = []
  const rehost = options.rehost
  if (rehost) {
    const copy = async (field: string, url: string): Promise<string> => {
      const r = await rehost({ userId: options.userId, url, label: field })
      if (r.warning) warnings.push(`${field}: ${r.warning}`)
      if (r.rehosted && r.sourceUrl) rehosted.push({ field, url: r.url, sourceUrl: r.sourceUrl })
      return r.url
    }
    if (typeof fields.logo_url === 'string' && fields.logo_url) fields.logo_url = await copy('logoUrl', fields.logo_url)
    if (Array.isArray(fields.reference_images)) {
      const out: string[] = []
      for (const [i, u] of (fields.reference_images as string[]).entries()) out.push(await copy(`referenceImageUrls[${i}]`, u))
      fields.reference_images = out
    }
    const profile = fields.brand_profile as BrandProfile | undefined
    if (profile && 'logoVariants' in profilePatch && profile.logoVariants?.length) {
      const variants = []
      for (const [i, v] of profile.logoVariants.entries()) {
        const url = await copy(`logoVariants[${i}].url`, v.url)
        variants.push(url !== v.url ? { ...v, url, sourceUrl: v.url } : v)
      }
      fields.brand_profile = { ...profile, logoVariants: variants }
    }
  }
  return { fields, ignoredPlaceholders: ignored, warnings, rehosted, brandProfileSaved }
}

/** Insert/update, retrying once without brand_profile when the column is missing (stale capability). */
async function writeKit<T>(plan: KitWritePlan, write: (fields: Record<string, unknown>) => Promise<T>): Promise<T> {
  try {
    return await write(plan.fields)
  } catch (err) {
    if ('brand_profile' in plan.fields && isMissingColumnError(err, 'brand_profile')) {
      const rest = { ...plan.fields }
      delete rest.brand_profile
      plan.fields = rest
      plan.brandProfileSaved = false
      plan.warnings.push(`Migration ${MIGRATION_085} is not applied yet: the structured kit profile was NOT saved. Classic kit fields were saved.`)
      return await write(rest)
    }
    throw err
  }
}

function planExtras(plan: KitWritePlan): Record<string, unknown> {
  return {
    ...(plan.ignoredPlaceholders.length
      ? { ignoredPlaceholders: plan.ignoredPlaceholders, placeholderNote: 'Placeholder values were not stored (they would leak into ads, e.g. "Hecho para country"). Send the real value.' }
      : {}),
    ...(plan.rehosted.length ? { rehosted: plan.rehosted } : {}),
    ...(plan.warnings.length ? { warnings: plan.warnings } : {}),
    ...(plan.warnings.some((w) => w.includes(MIGRATION_085)) ? { migrationPending: MIGRATION_085 } : {}),
  }
}

export async function mcpCreateBrandKit(options: {
  store: McpBrandKitStore
  db: McpDbClient
  user: McpAuthUser
  args: Record<string, unknown>
  rehost?: RehostFn | null
}): Promise<Record<string, unknown>> {
  const brandId = asString(options.args.brandId)
  if (!brandId) throw new Error('brandId is required')
  const owns = await options.store.assertOwnsBrand(options.user.id, brandId)
  if (!owns) throw new Error('Brand not found')

  const count = await options.store.countKits(options.user.id)
  if (count >= PLAN_KIT_SOFT_LIMIT) {
    throw new Error(`Brand kit limit reached (${PLAN_KIT_SOFT_LIMIT})`)
  }

  const plan = await planKitWrite({ store: options.store, userId: options.user.id, args: options.args, mode: 'create', existing: null, rehost: options.rehost })
  const setAsPrimary = options.args.setAsPrimary !== false
  const row = await writeKit(plan, (fields) => options.store.insertKit({
    userId: options.user.id,
    row: {
      ...fields,
      user_id: options.user.id,
      business_id: brandId,
      is_active: fields.is_active !== false,
      is_default: count === 0 ? true : fields.is_default === true,
      is_primary_for_business: false,
      style_dnas: fields.style_dnas ?? [],
    },
  }))

  if (setAsPrimary) {
    await maybeSetPrimary({
      store: options.store,
      userId: options.user.id,
      kitId: row.id,
      businessId: brandId,
    })
  } else {
    // If this is the only linked kit, promote automatically
    const linked = await options.store.listKits({
      userId: options.user.id,
      brandId,
      includeInactive: false,
    })
    if (linked.length === 1) {
      await maybeSetPrimary({
        store: options.store,
        userId: options.user.id,
        kitId: row.id,
        businessId: brandId,
      })
    }
  }

  const fresh = await options.store.getKit({ userId: options.user.id, kitId: row.id })
  return {
    status: 'created',
    kit: mapKitDetail(fresh || row),
    ...planExtras(plan),
    creditsNote: 'Free sync write — no Advance credits.',
  }
}

export async function mcpUpdateBrandKit(options: {
  store: McpBrandKitStore
  user: McpAuthUser
  args: Record<string, unknown>
  rehost?: RehostFn | null
}): Promise<Record<string, unknown>> {
  const kitId = asString(options.args.kitId)
  const brandId = asString(options.args.brandId)
  if (!kitId) throw new Error('kitId is required')
  if (!brandId) throw new Error('brandId is required')

  const existing = await options.store.getKit({ userId: options.user.id, kitId })
  if (!existing) throw new Error('Brand kit not found')
  if (existing.business_id && existing.business_id !== brandId) {
    throw new Error('Cannot move a linked kit to another brand via update — use link_brand_kit only for unlinked kits')
  }
  const owns = await options.store.assertOwnsBrand(options.user.id, brandId)
  if (!owns) throw new Error('Brand not found')

  const plan = await planKitWrite({ store: options.store, userId: options.user.id, args: options.args, mode: 'update', existing, rehost: options.rehost })
  if (!existing.business_id) {
    plan.fields.business_id = brandId
  }

  let updated = await writeKit(plan, (fields) => options.store.updateKit({
    userId: options.user.id,
    kitId,
    patch: { ...fields, updated_at: new Date().toISOString() },
  }))

  if (options.args.setAsPrimary === true) {
    await maybeSetPrimary({
      store: options.store,
      userId: options.user.id,
      kitId,
      businessId: brandId,
    })
    updated = (await options.store.getKit({ userId: options.user.id, kitId })) || updated
  }

  return {
    status: 'updated',
    kit: mapKitDetail(updated),
    ...planExtras(plan),
    creditsNote: 'Free sync write — no Advance credits.',
  }
}

/** B4: explicit primary kit for a brand (links an unlinked kit; never moves a kit from another brand). */
export async function mcpSetPrimaryBrandKit(options: {
  store: McpBrandKitStore
  user: McpAuthUser
  args: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const brandId = asString(options.args.brandId)
  const kitId = asString(options.args.brandKitId) || asString(options.args.kitId)
  if (!brandId) throw new Error('brandId is required')
  if (!kitId) throw new Error('brandKitId is required')
  const owns = await options.store.assertOwnsBrand(options.user.id, brandId)
  if (!owns) throw new Error('Brand not found')
  const existing = await options.store.getKit({ userId: options.user.id, kitId })
  if (!existing) throw new Error('Brand kit not found')
  if (existing.business_id && existing.business_id !== brandId) {
    throw new Error('This kit belongs to another brand. Pick a kit of this brand (list_brand_kits {brandId}) or create one.')
  }
  const wasPrimary = existing.business_id === brandId && existing.is_primary_for_business === true && existing.is_active !== false
  if (!wasPrimary) {
    await maybeSetPrimary({ store: options.store, userId: options.user.id, kitId, businessId: brandId })
  }
  const fresh = (await options.store.getKit({ userId: options.user.id, kitId })) || existing
  return {
    status: wasPrimary ? 'unchanged' : 'updated',
    brandId,
    kit: mapKitSummary(fresh),
    message: 'This kit is now the primary kit for the brand: ads, packs and GUIDE tools use it by default.',
    creditsNote: 'Free sync write — no Advance credits.',
  }
}

export async function mcpLinkBrandKit(options: {
  store: McpBrandKitStore
  user: McpAuthUser
  args: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const kitId = asString(options.args.kitId)
  const brandId = asString(options.args.brandId)
  if (!kitId) throw new Error('kitId is required')
  if (!brandId) throw new Error('brandId is required')

  const owns = await options.store.assertOwnsBrand(options.user.id, brandId)
  if (!owns) throw new Error('Brand not found')
  const existing = await options.store.getKit({ userId: options.user.id, kitId })
  if (!existing) throw new Error('Brand kit not found')
  if (existing.business_id && existing.business_id !== brandId) {
    throw new Error('Kit already linked to another brand. Create a new kit instead of moving.')
  }

  await options.store.updateKit({
    userId: options.user.id,
    kitId,
    patch: {
      business_id: brandId,
      updated_at: new Date().toISOString(),
    },
  })

  if (options.args.setAsPrimary !== false) {
    await maybeSetPrimary({
      store: options.store,
      userId: options.user.id,
      kitId,
      businessId: brandId,
    })
  }

  const fresh = await options.store.getKit({ userId: options.user.id, kitId })
  return {
    status: 'linked',
    kit: mapKitDetail(fresh || existing),
    creditsNote: 'Free sync write — no Advance credits.',
  }
}

export async function mcpDeleteBrandKit(options: {
  store: McpBrandKitStore
  approvalStore: McpApprovalStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const kitId = asString(options.args.kitId)
  const confirm = asString(options.args.confirm)
  const approvalRequestId = asString(options.args.approvalRequestId)
  if (!kitId) throw new Error('kitId is required')

  const existing = await options.store.getKit({ userId: options.user.id, kitId })
  if (!existing) throw new Error('Brand kit not found')
  if (!confirm || confirm !== existing.name) {
    throw new Error(`Type the exact kit name to confirm delete: "${existing.name}"`)
  }

  const boundInput = { kitId, confirm, businessId: existing.business_id ?? null }
  if (!approvalRequestId) {
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.user.id,
      toolName: 'delete_brand_kit',
      input: boundInput,
      quotedCreditCost: 0,
      appOrigin: options.appOrigin,
      summaryEs: `Eliminar brand kit "${existing.name}"`,
      summaryEn: `Delete brand kit "${existing.name}"`,
      extra: {
        preview: {
          kitId: existing.id,
          name: existing.name,
          businessId: existing.business_id ?? null,
          wasPrimary: existing.is_primary_for_business === true,
          wasAccountDefault: existing.is_default === true,
        },
      },
    })
  }

  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'delete_brand_kit',
    input: boundInput,
  })
  if (replay.ok) return { ...(replay.result as Record<string, unknown>), replayed: true }

  const ready = await assertMcpApprovalReady(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'delete_brand_kit',
    input: boundInput,
  })
  if (!ready.ok) throw new Error(ready.reason)

  const businessId = existing.business_id
  await options.store.deleteKit({ userId: options.user.id, kitId })

  if (businessId && existing.is_primary_for_business) {
    const remaining = await options.store.listKits({
      userId: options.user.id,
      brandId: businessId,
      includeInactive: false,
    })
    if (remaining[0]) {
      await maybeSetPrimary({
        store: options.store,
        userId: options.user.id,
        kitId: remaining[0].id,
        businessId,
      })
    }
  }

  const result = {
    status: 'deleted',
    kitId,
    name: existing.name,
    creditsNote: 'Free delete — no Advance credits.',
  }
  await storeMcpApprovalResult(options.approvalStore, {
    approvalRequestId,
    result,
  })
  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId,
    userId: options.user.id,
    toolName: 'delete_brand_kit',
    input: boundInput,
  })
  if (!consumed.ok) throw new Error(consumed.reason)
  return result
}

// ---------------------------------------------------------------------------
// #12: Style DNA detach (free) / delete (destructive: typed confirm + in-chat approval)
// ---------------------------------------------------------------------------

async function kitWithStyleDna(options: { store: McpBrandKitStore; user: McpAuthUser; args: Record<string, unknown> }) {
  const kitId = asString(options.args.brandKitId) || asString(options.args.kitId)
  const styleDnaId = asString(options.args.styleDnaId)
  if (!kitId) throw Object.assign(new Error('brandKitId is required (list_brand_kits)'), { code: 'BAD_INPUT' })
  if (!styleDnaId) throw Object.assign(new Error('styleDnaId is required (list_style_dnas)'), { code: 'BAD_INPUT' })
  const kit = await options.store.getKit({ userId: options.user.id, kitId })
  if (!kit) throw Object.assign(new Error('Brand kit not found'), { code: 'NOT_FOUND' })
  const brandId = asString(options.args.brandId)
  if (brandId && kit.business_id && kit.business_id !== brandId) throw Object.assign(new Error('Brand kit is linked to a different brand'), { code: 'NOT_FOUND' })
  const dnas = parseStyleDnas(kit.style_dnas)
  const dna = dnas.find((d) => d.id === styleDnaId)
  if (!dna) throw Object.assign(new Error(`Style DNA ${styleDnaId} not found on this kit (list_style_dnas)`), { code: 'NOT_FOUND' })
  return { kitId, styleDnaId, kit, dnas, dna, profile: readBrandProfile(kit.brand_profile) }
}

/** Detach: the Style DNA stays on the kit but no longer shapes packs (explicit selection without it). */
export async function mcpDetachStyleDna(options: { store: McpBrandKitStore; user: McpAuthUser; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const { kitId, styleDnaId, dnas, profile } = await kitWithStyleDna(options)
  const supported = options.store.hasBrandProfile ? await options.store.hasBrandProfile() : false
  if (!supported) {
    throw Object.assign(new Error(`Migration ${MIGRATION_085} is not applied: the Style DNA selection cannot be saved (delete_style_dna removes it instead).`), { code: 'UNAVAILABLE' })
  }
  const current = activeStyleDnaIds(dnas.map((d) => d.id), profile)
  const next = current.filter((id) => id !== styleDnaId)
  const changed = current.length !== next.length || profile?.styleDnaIds === undefined
  if (changed) {
    const brandProfile: BrandProfile = { ...(profile ?? {}), styleDnaIds: next, updatedAt: new Date().toISOString() }
    await options.store.updateKit({ userId: options.user.id, kitId, patch: { brand_profile: brandProfile, updated_at: new Date().toISOString() } })
  }
  return {
    status: current.includes(styleDnaId) ? 'detached' : 'unchanged',
    brandKitId: kitId,
    styleDnaId,
    styleDnaIds: next,
    activeStyleDnaIds: next,
    message: 'The Style DNA stays saved on the kit (list_style_dnas) but no longer shapes ads. Re-attach it with update_brand_kit { styleDnaIds: [...] }; delete it for good with delete_style_dna.',
    creditsNote: 'Free sync write — no Advance credits.',
  }
}

/** Delete: removes the Style DNA from the kit and from the selection. Typed confirm (its name) + in-chat approval. */
export async function mcpDeleteStyleDna(options: {
  store: McpBrandKitStore
  approvalStore: McpApprovalStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const { kitId, styleDnaId, kit, dnas, dna, profile } = await kitWithStyleDna(options)
  const confirm = asString(options.args.confirm)
  const approvalRequestId = asString(options.args.approvalRequestId)
  if (!confirm || confirm !== dna.name) {
    throw Object.assign(new Error(`Type the exact Style DNA name to confirm delete: "${dna.name}" (or detach_style_dna to keep it but stop using it)`), { code: 'BAD_INPUT' })
  }
  const boundInput = { brandKitId: kitId, styleDnaId, confirm }
  if (!approvalRequestId) {
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.user.id,
      toolName: 'delete_style_dna',
      input: boundInput,
      quotedCreditCost: 0,
      appOrigin: options.appOrigin,
      summaryEs: `Eliminar el Style DNA "${dna.name}" del kit "${kit.name}"`,
      summaryEn: `Delete Style DNA "${dna.name}" from kit "${kit.name}"`,
      extra: {
        preview: { brandKitId: kitId, styleDnaId, name: dna.name, references: dna.referenceUrls.length, analyzed: Boolean(dna.analysis) },
        warning: 'This permanently removes the Style DNA (its references and analysis) from the kit. Cannot be undone; detach_style_dna keeps it but stops using it.',
      },
    })
  }
  const replay = await replayMcpApprovalResult(options.approvalStore, { approvalRequestId, userId: options.user.id, toolName: 'delete_style_dna', input: boundInput })
  if (replay.ok) return { ...(replay.result as Record<string, unknown>), replayed: true }
  const ready = await assertMcpApprovalReady(options.approvalStore, { approvalRequestId, userId: options.user.id, toolName: 'delete_style_dna', input: boundInput })
  if (!ready.ok) throw new Error(ready.reason)

  const remaining = dnas.filter((d) => d.id !== styleDnaId)
  const patch: Record<string, unknown> = { style_dnas: remaining, updated_at: new Date().toISOString() }
  let selection: string[] | null = profile?.styleDnaIds ?? null
  if (profile?.styleDnaIds) {
    selection = profile.styleDnaIds.filter((id) => id !== styleDnaId)
    patch.brand_profile = { ...profile, styleDnaIds: selection, updatedAt: new Date().toISOString() }
  }
  try {
    await options.store.updateKit({ userId: options.user.id, kitId, patch })
  } catch (err) {
    if (!('brand_profile' in patch) || !isMissingColumnError(err, 'brand_profile')) throw err
    delete patch.brand_profile
    await options.store.updateKit({ userId: options.user.id, kitId, patch })
  }
  const result = {
    status: 'deleted',
    brandKitId: kitId,
    styleDnaId,
    name: dna.name,
    styleDnas: remaining.map((d) => ({ id: d.id, name: d.name })),
    styleDnaIds: selection,
    creditsNote: 'Free delete — no Advance credits.',
  }
  await storeMcpApprovalResult(options.approvalStore, { approvalRequestId, result })
  const consumed = await consumeMcpApprovalRequest(options.approvalStore, { approvalRequestId, userId: options.user.id, toolName: 'delete_style_dna', input: boundInput })
  if (!consumed.ok) throw new Error(consumed.reason)
  return result
}
