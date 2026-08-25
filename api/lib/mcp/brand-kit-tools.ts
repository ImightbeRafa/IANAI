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
  return {
    ...mapKitSummary(row),
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

function buildWritableFields(args: Record<string, unknown>, mode: 'create' | 'update'): Record<string, unknown> {
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
    const value = asOptionalString(args[argKey])
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
    const arr = asStringArray(args[argKey])
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

export async function mcpCreateBrandKit(options: {
  store: McpBrandKitStore
  db: McpDbClient
  user: McpAuthUser
  args: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const brandId = asString(options.args.brandId)
  if (!brandId) throw new Error('brandId is required')
  const owns = await options.store.assertOwnsBrand(options.user.id, brandId)
  if (!owns) throw new Error('Brand not found')

  const count = await options.store.countKits(options.user.id)
  if (count >= PLAN_KIT_SOFT_LIMIT) {
    throw new Error(`Brand kit limit reached (${PLAN_KIT_SOFT_LIMIT})`)
  }

  const fields = buildWritableFields(options.args, 'create')
  const setAsPrimary = options.args.setAsPrimary !== false
  const row = await options.store.insertKit({
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
  })

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
    creditsNote: 'Free sync write — no Advance credits.',
  }
}

export async function mcpUpdateBrandKit(options: {
  store: McpBrandKitStore
  user: McpAuthUser
  args: Record<string, unknown>
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

  const fields = buildWritableFields(options.args, 'update')
  if (!existing.business_id) {
    fields.business_id = brandId
  }

  let updated = await options.store.updateKit({
    userId: options.user.id,
    kitId,
    patch: { ...fields, updated_at: new Date().toISOString() },
  })

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
