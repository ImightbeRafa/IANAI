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
import { readBrandProfile, type BrandLogoVariant, type BrandLogoVariantKind } from '../brand-profile.js'
import { labelWithRole } from '../adpack/fidelity/photos.js'
import { resolveBrandKitForBusiness } from '../brand-kit-resolve.js'
import { safeFilename, uploadPath } from './asset-rehost.js'
import { LABEL_MAX, PART_NAME_MAX } from './text-limits.js'
import { PRODUCT_PHOTO_ROLES, isProductPhotoRole, roleFromLabel } from '../adpack/fidelity/photos.js'
import { PRODUCT_IMAGE_TAGS, type ProductImageTag } from '../product-image-order.js'
import type { ProductPhotoRole } from '../adpack/types.js'
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
  // #18: sizeBytes is optional; 0 / absent = unknown (the real size is checked at finalize_upload).
  if (args.sizeBytes !== undefined && args.sizeBytes !== null) {
    if (typeof args.sizeBytes !== 'number' || !Number.isFinite(args.sizeBytes) || args.sizeBytes < 0) throw new UploadInputError('sizeBytes is optional; when sent it must be the file size in bytes (0 or omit it if unknown)')
    if (args.sizeBytes > limits.maxBytes) throw new UploadInputError(`File too large: max ${Math.round(limits.maxBytes / 1024 / 1024)} MB for ${kind}`)
  }
  // #18: role uses the same enum as import_image (product_photo: hero|part|box|contents|in_use|detail;
  // logo: a variant). A legacy free part name ("control") is still accepted and kept as the label.
  const rawRole = asString(args.role)
  let role: string | undefined
  let legacyLabel: string | undefined
  if (rawRole) {
    if (kind === 'product_photo') {
      if (isProductPhotoRole(rawRole)) role = rawRole
      else {
        if (rawRole.length > PART_NAME_MAX) throw new UploadInputError(`role "${rawRole.slice(0, 40)}…" is not a role (${PRODUCT_PHOTO_ROLES.join(', ')}); send the part name as label (max ${PART_NAME_MAX} characters)`)
        legacyLabel = rawRole
      }
    } else if (kind === 'logo') {
      if (!(LOGO_VARIANTS as readonly string[]).includes(rawRole)) throw new UploadInputError(`role for a logo is its variant: ${LOGO_VARIANTS.join(', ')}`)
      role = rawRole
    } else throw new UploadInputError('role applies to product_photo (hero|part|box|contents|in_use|detail) and logo (variant) only')
  }
  const variant = asString(args.variant)
  if (variant) {
    if (kind !== 'logo' || !(LOGO_VARIANTS as readonly string[]).includes(variant)) throw new UploadInputError(`variant applies to logo only: ${LOGO_VARIANTS.join(', ')}`)
    role = variant
  }
  const label = asString(args.label).replace(/\s+/g, ' ') || legacyLabel || ''
  if (label.length > LABEL_MAX) throw new UploadInputError(`label is ${label.length} characters; the maximum is ${LABEL_MAX} (shorten it)`)
  let tags: ProductImageTag[] | undefined
  if (args.tags !== undefined && args.tags !== null) {
    if (kind !== 'product_photo') throw new UploadInputError('tags apply to product_photo only')
    if (!Array.isArray(args.tags) || args.tags.some((t) => !(PRODUCT_IMAGE_TAGS as readonly string[]).includes(String(t)))) throw new UploadInputError(`tags must be an array of: ${PRODUCT_IMAGE_TAGS.join(', ')}`)
    tags = [...new Set(args.tags as ProductImageTag[])]
  }
  if (args.setPrimary !== undefined && typeof args.setPrimary !== 'boolean') throw new UploadInputError('setPrimary must be a boolean')

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
      originalFilename: filename,
      contentType,
      ...(offerId ? { offerId } : {}),
      ...(role ? { role } : {}),
      ...(label ? { label } : {}),
      ...(tags?.length ? { tags } : {}),
      ...(args.setPrimary !== undefined ? { setPrimary: args.setPrimary } : {}),
      ...(legacyLabel ? { role: legacyLabel, legacyRole: legacyLabel } : {}),
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

export const LOGO_VARIANTS = ['primary', 'light', 'dark', 'badge', 'wordmark', 'icon'] as const

/**
 * Attach a stored file to the brand's kit (primary kit, or `brandKitId`): logo (+ 085 variant),
 * reference ad, winner ad (085; else saved as a reference), document (085). Shared by
 * finalize_upload and import_image.
 */
export async function saveKitAsset(options: {
  store: Pick<McpOfferStore, 'capabilities'>
  kitStore: McpBrandKitStore
  userId: string
  brandId: string
  brandKitId?: string
  kind: Exclude<UploadKind, 'product_photo'>
  url: string
  role?: string
  filename?: string
  /** Original external link (kept on 085 logo variants). */
  sourceUrl?: string
}): Promise<{ brandKitId: string; warnings: string[]; logoUrlSet: boolean }> {
  const { kitStore, userId, brandId, kind, url, role } = options
  const warnings: string[] = []
  let kit: Row
  if (options.brandKitId) {
    const found = await kitStore.getKit({ userId, kitId: options.brandKitId })
    if (!found || (found.business_id && found.business_id !== brandId)) throw new UploadInputError('brandKitId not found for this brand')
    kit = found as unknown as Row
  } else kit = await primaryKit(kitStore, userId, brandId)
  const kitId = String(kit.id)
  const caps = await options.store.capabilities()
  const profile = readBrandProfile(kit.brand_profile) ?? {}
  const patch: Row = { updated_at: new Date().toISOString() }
  let logoUrlSet = false
  if (kind === 'logo') {
    const variant = role && (LOGO_VARIANTS as readonly string[]).includes(role) ? role : 'primary'
    if (!kit.logo_url || variant === 'primary') {
      patch.logo_url = url
      logoUrlSet = true
    }
    if (caps.brandProfile) {
      const entry: BrandLogoVariant = { url, variant: variant as BrandLogoVariantKind, ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}) }
      patch.brand_profile = { ...profile, logoVariants: [...(profile.logoVariants ?? []).filter((v) => v.variant !== variant), entry] }
    } else if (variant !== 'primary') warnings.push(`logo variant "${variant}" stored as the main logo only (migration ${MIGRATION_085} pending)`)
  } else if (kind === 'reference_ad' || (kind === 'winner_ad' && !caps.brandProfile)) {
    const refs = Array.isArray(kit.reference_images) ? (kit.reference_images as string[]) : []
    patch.reference_images = [...refs.filter((r) => r !== url), url].slice(-16)
    if (kind === 'winner_ad') warnings.push(`saved as a style reference (winner ads list needs migration ${MIGRATION_085})`)
  } else if (kind === 'winner_ad') {
    patch.brand_profile = { ...profile, winnerAdUrls: [...(profile.winnerAdUrls ?? []).filter((u) => u !== url), url].slice(-20) }
  } else if (kind === 'document') {
    if (caps.brandProfile) {
      patch.brand_profile = { ...profile, documents: [...(profile.documents ?? []), { url, filename: options.filename || 'document.pdf' }].slice(-20) }
    } else warnings.push(`document stored in Advance storage but not listed on the kit (migration ${MIGRATION_085} pending)`)
  }
  if (Object.keys(patch).length > 1) await kitStore.updateKit({ userId, kitId, patch })
  return { brandKitId: kitId, warnings, logoUrlSet }
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
  let quality: Row | null = null
  if (kind === 'product_photo') {
    const caps = await store.capabilities()
    const offerId = String(meta.offerId || '')
    // #18: never "MCP upload — <file>": the given label, else a clean name from the file.
    const label = (typeof meta.label === 'string' && meta.label) || cleanLabelFromFilename(String(meta.originalFilename || meta.filename || '')) || 'product photo'
    const photoRole: ProductPhotoRole | undefined = role && isProductPhotoRole(role) ? role : roleFromLabel(typeof meta.legacyRole === 'string' ? meta.legacyRole : undefined)
    const tags: ProductImageTag[] = [...new Set([...(photoRole ? [ROLE_TAG_OF[photoRole]] : []), ...((Array.isArray(meta.tags) ? meta.tags : []) as ProductImageTag[])])]
    const setPrimary = photoRole === 'hero' && meta.setPrimary !== false
    quality = await uploadQuality(store, path)
    if (!quality) warnings.push('quality report unavailable for this upload (the photo is saved; import_image analyzes it too)')
    else if (Array.isArray(quality.warnings)) warnings.push(...(quality.warnings as string[]))
    const row: Row = {
      product_id: offerId,
      user_id: user.id,
      image_url: url,
      label: caps.imageMeta || !photoRole ? label : labelWithRole(photoRole, label),
      kind: 'product',
    }
    if (caps.imageMeta) {
      if (tags.length) row.tags = tags
      // Free part name ("control tipo gamepad") like import_image; legacy free roles stay as before.
      const partName = typeof meta.legacyRole === 'string' ? meta.legacyRole : typeof meta.label === 'string' ? meta.label : ''
      if (partName) row.role = partName
      if (quality) row.quality = quality
      if (setPrimary) {
        await store.clearPrimaryImages({ userId: user.id, offerId })
        row.is_primary = true
      }
    } else if (photoRole || tags.length) warnings.push(`role/tags stored in the label only (migration ${MIGRATION_085} pending)`)
    const inserted = await store.insertProductImage({ userId: user.id, offerId, row })
    saved = {
      target: 'product_images',
      productImageId: inserted.id,
      offerId,
      label,
      role: photoRole ?? null,
      tags: caps.imageMeta ? tags : [],
      isPrimary: Boolean(caps.imageMeta && setPrimary),
      ...(quality ? { width: quality.width, height: quality.height, quality } : { quality: null }),
      ...(quality && (quality.lowResolution || quality.blurry)
        ? { qualityNote: 'Low-quality photo: it is saved, but the sharpest photo of the offer is preferred for ads. Upload a sharper / larger original if you have one.' }
        : {}),
    }
  } else {
    if (!options.brandKitStore) throw new Error('Brand kit store not configured')
    const kitSaved = await saveKitAsset({ store, kitStore: options.brandKitStore, userId: user.id, brandId: record.brandId, kind, url, role, filename: String(meta.filename || 'document.pdf') })
    warnings.push(...kitSaved.warnings)
    saved = { target: 'brand_kit', brandKitId: kitSaved.brandKitId, assetKind: kind, ...(role ? { role } : {}), ...(kind === 'logo' ? { logoUrlSet: kitSaved.logoUrlSet } : {}) }
  }

  const out: Row = {
    status: 'finalized',
    uploadId,
    kind,
    url,
    sizeBytes: stat.size,
    contentType: actualType,
    ...(role ? { role } : {}),
    ...saved,
    ...(warnings.length ? { warnings } : {}),
    creditsNote: 'Free — no Advance credits.',
  }
  await store.updateUploadRecord({ userId: user.id, uploadId, metadata: { ...meta, status: 'finalized', result: out } })
  return out
}

const ROLE_TAG_OF: Record<ProductPhotoRole, ProductImageTag> = { hero: 'hero', part: 'part', box: 'caja', contents: 'contenido-kit', in_use: 'en-uso', detail: 'detalle' }

/** "IMG_2041 avión-armado (final).JPG" → "avión armado final"; camera names ("IMG_2041") drop out. */
export function cleanLabelFromFilename(filename: string): string {
  const stem = filename.replace(/\.[a-z0-9]{2,5}$/i, '')
  const words = stem
    .replace(/[_\-.()[\]{}]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(img|dsc|dscn|pxl|photo|image|whatsapp|wa\d+|\d{3,})$/i.test(w) && !/^\d{6,}$/.test(w))
  return words.join(' ').trim().slice(0, LABEL_MAX)
}

/** #18: the same quality report as import_image, from the uploaded bytes (best-effort). */
async function uploadQuality(store: McpOfferStore, path: string): Promise<Row | null> {
  if (!store.downloadObject) return null
  try {
    const bytes = await store.downloadObject({ path })
    if (!bytes?.length) return null
    const { analyzeAssetQuality } = await import('../adpack/fidelity/asset-quality.js')
    return { ...(await analyzeAssetQuality(bytes, 'es')) }
  } catch {
    return null
  }
}
