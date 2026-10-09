/**
 * C1 — direct uploads for agents: create_upload_url → PUT bytes → finalize_upload.
 *
 * create_upload_url returns a Supabase Storage signed upload URL in the shared
 * `post-images` bucket under `<userId>/uploads/<uuid>-<safe-filename>`, and records
 * the intent (mcp_workspace_notes kind `mcp_upload`, no migration needed).
 * finalize_upload verifies the object exists, enforces size/type limits and then
 * creates the library entry: a product_images row (product photo) or a brand kit
 * asset (logo / reference ad / winner ad / document). Idempotent per uploadId.
 */
import { randomUUID } from 'node:crypto'
import { MIGRATION_085 } from '../db-missing-column.js'
import { readBrandProfile } from '../brand-profile.js'
import { resolveBrandKitForBusiness } from '../brand-kit-resolve.js'
import { safeFilename, uploadPath } from './asset-rehost.js'
import type { McpBrandKitStore } from './brand-kit-tools.js'
import type { McpOfferStore } from './offer-tools.js'
import type { McpAuthUser, McpDbClient } from './user-tools.js'

type Row = Record<string, unknown>

export const UPLOAD_KINDS = ['product_photo', 'logo', 'reference_ad', 'winner_ad', 'document'] as const
export type UploadKind = typeof UPLOAD_KINDS[number]

export const UPLOAD_NOTE_KIND = 'mcp_upload'
export const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const UPLOAD_LIMITS: Record<UploadKind, { types: string[]; maxBytes: number }> = {
  product_photo: { types: IMAGE_TYPES, maxBytes: 15 * 1024 * 1024 },
  logo: { types: [...IMAGE_TYPES, 'image/svg+xml'], maxBytes: 5 * 1024 * 1024 },
  reference_ad: { types: IMAGE_TYPES, maxBytes: 15 * 1024 * 1024 },
  winner_ad: { types: IMAGE_TYPES, maxBytes: 15 * 1024 * 1024 },
  document: { types: ['application/pdf'], maxBytes: 20 * 1024 * 1024 },
}

const ROLE_MAX = 60
const asString = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

class UploadInputError extends Error {
  readonly code = 'BAD_INPUT'
}

function normalizeType(t: string | null | undefined): string {
  const v = (t || '').split(';')[0].trim().toLowerCase()
  return v === 'image/jpg' ? 'image/jpeg' : v
}

export async function mcpCreateUploadUrl(options: {
  db: McpDbClient
  store: McpOfferStore
  user: McpAuthUser
  args: Row
  newId?: () => string
}): Promise<Row> {
  const { args, user, store } = options
  const brandId = asString(args.brandId)
  if (!brandId) throw new UploadInputError('brandId is required')
  const kind = asString(args.kind) as UploadKind
  if (!(UPLOAD_KINDS as readonly string[]).includes(kind)) throw new UploadInputError(`kind must be one of ${UPLOAD_KINDS.join(', ')}`)
  const filename = asString(args.filename)
  if (!filename || filename.length > 200) throw new UploadInputError('filename is required (max 200 characters)')
  const contentType = normalizeType(asString(args.contentType))
  const limits = UPLOAD_LIMITS[kind]
  if (!limits.types.includes(contentType)) throw new UploadInputError(`contentType for ${kind} must be one of ${limits.types.join(', ')}`)
  if (args.sizeBytes !== undefined) {
    if (typeof args.sizeBytes !== 'number' || !Number.isFinite(args.sizeBytes) || args.sizeBytes <= 0) throw new UploadInputError('sizeBytes must be a positive number')
    if (args.sizeBytes > limits.maxBytes) throw new UploadInputError(`File too large: max ${Math.round(limits.maxBytes / 1024 / 1024)} MB for ${kind}`)
  }
  const role = asString(args.role)
  if (role.length > ROLE_MAX) throw new UploadInputError(`role must be at most ${ROLE_MAX} characters`)

  const brand = await options.db.getBusinessForUser(user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  const offerId = asString(args.offerId)
  if (kind === 'product_photo' && !offerId) throw new UploadInputError('offerId is required for product_photo (create_offer first if needed)')
  if (offerId) {
    const offer = await store.getOffer({ userId: user.id, brandId, offerId })
    if (!offer) throw new Error('Offer not found for this brand')
  }

  const id = (options.newId ?? randomUUID)()
  const path = uploadPath(user.id, filename, id)
  const signed = await store.createSignedUpload({ path })
  const record = await store.insertUploadRecord({
    userId: user.id,
    brandId,
    metadata: {
      status: 'pending',
      kind,
      path,
      filename: safeFilename(filename),
      contentType,
      ...(offerId ? { offerId } : {}),
      ...(role ? { role } : {}),
      expiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
      source: 'mcp',
    },
  })
  return {
    status: 'upload_ready',
    uploadId: record.id,
    uploadUrl: signed.signedUrl,
    method: 'PUT',
    headers: { 'content-type': contentType },
    path,
    maxBytes: limits.maxBytes,
    expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
    nextTool: 'finalize_upload',
    instructions: `PUT the raw file bytes to uploadUrl with header content-type: ${contentType} (max ${Math.round(limits.maxBytes / 1024 / 1024)} MB), then call finalize_upload { uploadId: "${record.id}" }.`,
    creditsNote: 'Free — no Advance credits.',
  }
}

async function primaryKit(kitStore: McpBrandKitStore, userId: string, brandId: string): Promise<Row> {
  const kits = await kitStore.listKits({ userId, brandId, includeInactive: true })
  const resolved = resolveBrandKitForBusiness({ linkedKits: kits })
  if (!resolved.kit) throw new UploadInputError('This brand has no brand kit yet: create_brand_kit first, then retry finalize_upload')
  return resolved.kit as unknown as Row
}

export async function mcpFinalizeUpload(options: {
  store: McpOfferStore
  brandKitStore?: McpBrandKitStore | null
  user: McpAuthUser
  args: Row
}): Promise<Row> {
  const { store, user } = options
  const uploadId = asString(options.args.uploadId)
  if (!uploadId) throw new UploadInputError('uploadId is required (from create_upload_url)')
  const record = await store.getUploadRecord({ userId: user.id, uploadId })
  if (!record) throw new Error('Upload not found')
  const meta = record.metadata
  if (meta.status === 'finalized' && meta.result && typeof meta.result === 'object') {
    return { ...(meta.result as Row), replayed: true }
  }
  if (meta.status === 'rejected') throw new UploadInputError(`This upload was rejected: ${String(meta.error || 'invalid file')}. Start again with create_upload_url.`)
  const kind = meta.kind as UploadKind
  const path = String(meta.path || '')
  if (!(UPLOAD_KINDS as readonly string[]).includes(kind) || !path.startsWith(`${user.id}/uploads/`)) throw new Error('Upload record is invalid')

  const stat = await store.statObject({ path })
  if (!stat) {
    throw new UploadInputError('The file is not in storage yet: PUT the bytes to uploadUrl first (the link expires after 2 hours), then call finalize_upload again.')
  }
  const limits = UPLOAD_LIMITS[kind]
  const actualType = normalizeType(stat.contentType) || String(meta.contentType)
  const problem = stat.size <= 0
    ? 'the file is empty'
    : stat.size > limits.maxBytes
      ? `the file is ${(stat.size / 1024 / 1024).toFixed(1)} MB (max ${Math.round(limits.maxBytes / 1024 / 1024)} MB)`
      : !limits.types.includes(actualType)
        ? `type ${actualType || 'unknown'} is not allowed for ${kind} (${limits.types.join(', ')})`
        : ''
  if (problem) {
    await store.removeObject({ path }).catch(() => undefined)
    await store.updateUploadRecord({ userId: user.id, uploadId, metadata: { ...meta, status: 'rejected', error: problem } })
    throw new UploadInputError(`Upload rejected: ${problem}. The file was removed.`)
  }

  const url = store.publicUrl(path)
  const role = typeof meta.role === 'string' ? meta.role : undefined
  const warnings: string[] = []
  let saved: Row
  if (kind === 'product_photo') {
    const caps = await store.capabilities()
    const offerId = String(meta.offerId || '')
    const row = await store.insertProductImage({
      userId: user.id,
      offerId,
      row: {
        product_id: offerId,
        user_id: user.id,
        image_url: url,
        label: `MCP upload — ${String(meta.filename || 'product photo')}`.slice(0, 200),
        kind: 'product',
        ...(caps.imageMeta && role ? { role } : {}),
      },
    })
    if (role && !caps.imageMeta) warnings.push(`role was not saved (migration ${MIGRATION_085} pending)`)
    saved = { target: 'product_images', productImageId: row.id, offerId }
  } else {
    if (!options.brandKitStore) throw new Error('Brand kit store not configured')
    const kitStore = options.brandKitStore
    const kit = await primaryKit(kitStore, user.id, record.brandId)
    const kitId = String(kit.id)
    const caps = await store.capabilities()
    const profile = readBrandProfile(kit.brand_profile) ?? {}
    const patch: Row = { updated_at: new Date().toISOString() }
    if (kind === 'logo') {
      const variant = role && ['primary', 'light', 'dark', 'badge', 'wordmark', 'icon'].includes(role) ? role : 'primary'
      if (!kit.logo_url || variant === 'primary') patch.logo_url = url
      if (caps.brandProfile) {
        patch.brand_profile = { ...profile, logoVariants: [...(profile.logoVariants ?? []).filter((v) => v.variant !== variant), { url, variant }] }
      } else if (variant !== 'primary') warnings.push(`logo variant "${variant}" stored as the main logo only (migration ${MIGRATION_085} pending)`)
    } else if (kind === 'reference_ad' || (kind === 'winner_ad' && !caps.brandProfile)) {
      const refs = Array.isArray(kit.reference_images) ? (kit.reference_images as string[]) : []
      patch.reference_images = [...refs.filter((r) => r !== url), url].slice(-16)
      if (kind === 'winner_ad') warnings.push(`saved as a style reference (winner ads list needs migration ${MIGRATION_085})`)
    } else if (kind === 'winner_ad') {
      patch.brand_profile = { ...profile, winnerAdUrls: [...(profile.winnerAdUrls ?? []).filter((u) => u !== url), url].slice(-20) }
    } else if (kind === 'document') {
      if (caps.brandProfile) {
        patch.brand_profile = { ...profile, documents: [...(profile.documents ?? []), { url, filename: String(meta.filename || 'document.pdf') }].slice(-20) }
      } else warnings.push(`document stored in Advance storage but not listed on the kit (migration ${MIGRATION_085} pending)`)
    }
    if (Object.keys(patch).length > 1) await kitStore.updateKit({ userId: user.id, kitId, patch })
    saved = { target: 'brand_kit', brandKitId: kitId, assetKind: kind }
  }

  const out: Row = {
    status: 'finalized',
    uploadId,
    kind,
    url,
    sizeBytes: stat.size,
    contentType: actualType,
    ...saved,
    ...(role ? { role } : {}),
    ...(warnings.length ? { warnings } : {}),
    creditsNote: 'Free — no Advance credits.',
  }
  await store.updateUploadRecord({ userId: user.id, uploadId, metadata: { ...meta, status: 'finalized', result: out } })
  return out
}
