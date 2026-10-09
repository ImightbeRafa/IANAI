/**
 * `import_image` / `import_images` — one tool to bring a photo from Google Drive, Dropbox or any
 * public https link into a brand or offer (owner feedback items 1–2, C1/C2/C3/C4/C5).
 *
 * The bytes are always COPIED into Advance storage (`post-images/<userId>/uploads/…`); the
 * share link is kept only as `sourceUrl` (product_images.source_url after migration 085), so a
 * permission change on Drive can never break an ad.
 *
 * - product_photo → product_images row on the offer with a role (hero | part | box | contents |
 *   in_use | detail). 085 applied: `tags` (hero/part/caja/contenido-kit/en-uso/detalle) +
 *   `role` (free part name) + `quality` + `source_url` (+ is_primary for a hero). 085 pending:
 *   the role is written as an explicit label prefix ("[part] control") that the Ad Pack photo
 *   reader parses — nothing is lost, nothing crashes.
 * - logo → the kit logo is the CLEANED logo (background removed, trimmed, transparent PNG);
 *   the cleanup report is returned (method, backgroundRemoved, dark variant).
 * - reference_ad → offer context image (with offerId) or kit reference; winner_ad → kit winners.
 *
 * Every import returns the photo quality report (resolution, sharpness, background, warnings).
 * No model calls, no credits.
 */
import { randomUUID } from 'node:crypto'
import { isPlaceholderValue } from '../placeholder-guard.js'
import { PRODUCT_PHOTO_ROLES, isProductPhotoRole, labelWithRole } from '../adpack/fidelity/photos.js'
import type { ProductPhotoRole } from '../adpack/types.js'
import type { ProductImageTag } from '../product-image-order.js'
import { MIGRATION_085 } from '../db-missing-column.js'
import { parseStyleDnas, upsertStyleDnaList } from '../bulk/style-dna.js'
import type { StyleDna } from '../bulk/types.js'
import { safeFilename, uploadPath } from './asset-rehost.js'
import { downloadRemoteImage, RemoteImageError, type RemoteFetch } from './remote-image.js'
import { LOGO_VARIANTS, UPLOAD_LIMITS, saveKitAsset } from './upload-tools.js'
import type { McpBrandKitStore } from './brand-kit-tools.js'
import type { McpOfferStore } from './offer-tools.js'
import type { McpAuthUser, McpDbClient } from './user-tools.js'

type Row = Record<string, unknown>

export const IMPORT_KINDS = ['product_photo', 'logo', 'reference_ad', 'winner_ad'] as const
export type ImportKind = typeof IMPORT_KINDS[number]
export const IMPORT_ROLES = PRODUCT_PHOTO_ROLES
export const IMPORT_BATCH_MAX = 12
/** Style DNA on the kit that collects imported winner ads. */
export const WINNERS_STYLE_DNA_ID = 'winners'

/** Fidelity role → 085 product_images tag (tag_product_image vocabulary). */
export const ROLE_TAG: Record<ProductPhotoRole, ProductImageTag> = {
  hero: 'hero',
  part: 'part',
  box: 'caja',
  contents: 'contenido-kit',
  in_use: 'en-uso',
  detail: 'detalle',
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }
const LABEL_MAX = 80
const asString = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

class ImportInputError extends Error {
  readonly code = 'BAD_INPUT'
}

export interface ImportDeps {
  db: McpDbClient
  store: McpOfferStore
  kitStore?: McpBrandKitStore | null
  user: McpAuthUser
  fetchImpl?: RemoteFetch
  newId?: () => string
}

/** Photo quality report (C4) — lazy so the MCP cold start does not load sharp. */
async function qualityOf(bytes: Uint8Array): Promise<Row | null> {
  try {
    const { analyzeAssetQuality } = await import('../adpack/fidelity/asset-quality.js')
    const q = await analyzeAssetQuality(bytes, 'es')
    return { ...q }
  } catch {
    return null
  }
}

async function resolveOfferId(deps: ImportDeps, brandId: string, offerId: string, kind: ImportKind): Promise<string> {
  if (offerId) {
    const offer = await deps.store.getOffer({ userId: deps.user.id, brandId, offerId })
    if (!offer) throw new Error('Offer not found for this brand')
    return offerId
  }
  if (kind !== 'product_photo') return ''
  const offers = await deps.db.listOffersForBrand(deps.user.id, brandId)
  if (offers.length === 1) return offers[0].id
  if (!offers.length) throw new ImportInputError('product_photo needs an offer: create_offer first, then import_image { offerId }')
  throw new ImportInputError(`product_photo needs offerId (this brand has ${offers.length} offers: ${offers.slice(0, 6).map((o) => `${o.name} = ${o.id}`).join('; ')})`)
}

/** Import one image (throws a coded error with a plain-language message on any problem). */
export async function mcpImportImage(deps: ImportDeps & { args: Row }): Promise<Row> {
  const { args, user, store } = deps
  const brandId = asString(args.brandId)
  if (!brandId) throw new ImportInputError('brandId is required (from list_brands / create_brand)')
  const kind = asString(args.kind) as ImportKind
  if (!(IMPORT_KINDS as readonly string[]).includes(kind)) throw new ImportInputError(`kind must be one of ${IMPORT_KINDS.join(', ')}`)
  const url = asString(args.url)
  if (!url) throw new ImportInputError('url is required (Google Drive share link, Dropbox link or public https image URL)')

  let role: ProductPhotoRole | undefined
  if (args.role !== undefined && args.role !== null && args.role !== '') {
    if (kind !== 'product_photo') throw new ImportInputError('role applies to product_photo only (use variant for logos)')
    if (!isProductPhotoRole(args.role)) throw new ImportInputError(`role must be one of ${IMPORT_ROLES.join(', ')}`)
    role = args.role
  }
  let variant: string | undefined
  if (args.variant !== undefined && args.variant !== null && args.variant !== '') {
    if (kind !== 'logo') throw new ImportInputError('variant applies to logo only')
    if (!(LOGO_VARIANTS as readonly string[]).includes(String(args.variant))) throw new ImportInputError(`variant must be one of ${LOGO_VARIANTS.join(', ')}`)
    variant = String(args.variant)
  }
  const rawLabel = asString(args.label)
  if (rawLabel.length > LABEL_MAX) throw new ImportInputError(`label must be at most ${LABEL_MAX} characters`)
  const label = rawLabel && !isPlaceholderValue(rawLabel) ? rawLabel : ''
  if (args.setPrimary !== undefined && typeof args.setPrimary !== 'boolean') throw new ImportInputError('setPrimary must be a boolean')

  const brand = await deps.db.getBusinessForUser(user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  const offerId = await resolveOfferId(deps, brandId, asString(args.offerId), kind)

  let downloaded
  try {
    downloaded = await downloadRemoteImage(url, { fetchImpl: deps.fetchImpl, maxBytes: UPLOAD_LIMITS[kind].maxBytes, allowSvg: kind === 'logo' })
  } catch (err) {
    if (err instanceof RemoteImageError) throw Object.assign(new Error(err.message), { code: err.code, details: { url } })
    throw err
  }
  const { bytes, mime } = downloaded
  const warnings: string[] = []
  const quality = mime === 'image/svg+xml' ? null : await qualityOf(bytes)
  if (quality && Array.isArray(quality.warnings)) warnings.push(...(quality.warnings as string[]))

  const newId = deps.newId ?? randomUUID
  const stem = safeFilename(label || (downloaded.filename ?? '').replace(/\.[a-z0-9]{2,5}$/i, '') || (role ? `${kind}-${role}` : kind), kind).replace(/\.[a-z0-9]{2,5}$/i, '')
  const path = uploadPath(user.id, `${stem}.${EXT[mime]}`, newId())
  const storedUrl = await store.uploadBytes({ path, bytes, contentType: mime })
  const caps = await store.capabilities()

  const base: Row = {
    status: 'imported',
    kind,
    brandId,
    url: storedUrl,
    sourceUrl: url,
    provider: downloaded.provider,
    ...(downloaded.driveConfirmed ? { driveLargeFileConfirmed: true } : {}),
    contentType: mime,
    sizeBytes: bytes.length,
    ...(quality ? { width: quality.width, height: quality.height, quality } : {}),
    upscaled: false,
  }

  if (kind === 'product_photo' || (kind === 'reference_ad' && offerId)) {
    const isProduct = kind === 'product_photo'
    const setPrimary = isProduct && role === 'hero' && args.setPrimary !== false
    const row: Row = {
      product_id: offerId,
      user_id: user.id,
      image_url: storedUrl,
      kind: isProduct ? 'product' : 'context',
      // 085 pending: the role travels as an explicit "[role] label" prefix the Ad Pack reader parses.
      label: (isProduct && role && !caps.imageMeta ? labelWithRole(role, label) : label || (isProduct ? 'MCP import — product photo' : 'MCP import — reference ad')).slice(0, 200),
    }
    if (caps.imageMeta) {
      row.source_url = url
      if (quality) row.quality = quality
      if (isProduct && role) row.tags = [ROLE_TAG[role]]
      if (isProduct && label) row.role = label.slice(0, 60)
    }
    if (setPrimary && caps.imageMeta) await store.clearPrimaryImages({ userId: user.id, offerId })
    if (setPrimary && caps.imageMeta) row.is_primary = true
    const inserted = await store.insertProductImage({ userId: user.id, offerId, row })
    if (!caps.imageMeta) warnings.push(`Migration ${MIGRATION_085} pending: role stored in the label ("${String(row.label)}"); tags/quality/source_url columns are not available yet.`)
    return {
      ...base,
      target: 'product_images',
      productImageId: inserted.id,
      offerId,
      ...(isProduct ? { role: role ?? null, tags: role ? [ROLE_TAG[role]] : [], isPrimary: setPrimary && caps.imageMeta, roleStoredAs: role ? (caps.imageMeta ? 'tags' : 'label') : null } : {}),
      ...(label ? { label } : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(quality && (quality.lowResolution || quality.blurry)
        ? { qualityNote: 'Low-quality photo: it is saved, but the sharpest photo of the offer is preferred for ads. Upload a sharper / larger original if you have one.' }
        : {}),
      creditsNote: 'Free — no Advance credits.',
      nextStep: isProduct
        ? 'Import the other parts with their roles (hero, part, box, contents, in_use, detail). Ads only show product parts that have a real photo.'
        : 'Reference saved on the offer (style only, never copied as a template).',
    }
  }

  if (!deps.kitStore) throw new Error('Brand kit store not configured')
  let kitUrl = storedUrl
  let logo: Row | undefined
  if (kind === 'logo') {
    try {
      const { prepareLogo } = await import('../adpack/render/logo.js')
      const prepared = await prepareLogo(bytes)
      const cleanPath = uploadPath(user.id, `${stem}-clean.png`, newId())
      const cleanUrl = await store.uploadBytes({ path: cleanPath, bytes: new Uint8Array(prepared.onLight.png), contentType: 'image/png' })
      kitUrl = cleanUrl
      logo = {
        cleanedUrl: cleanUrl,
        originalUrl: storedUrl,
        method: prepared.method,
        backgroundRemoved: prepared.backgroundRemoved,
        transparent: prepared.method !== 'as_is',
        darkVariant: Boolean(prepared.onDark),
        width: prepared.onLight.width,
        height: prepared.onLight.height,
        note: prepared.backgroundRemoved
          ? 'The solid background was removed: ads place the transparent logo (no box around it).'
          : prepared.method === 'as_is'
            ? 'Could not separate the logo from its background: upload a PNG with transparency for a clean logo.'
            : 'Logo already transparent.',
      }
      if (prepared.method === 'as_is') warnings.push('logo background could not be removed (busy background): upload a transparent PNG')
    } catch (err) {
      warnings.push(`logo cleanup failed (${err instanceof Error ? err.message : String(err)}): the original file is used`.slice(0, 200))
    }
  }
  const kitSaved = await saveKitAsset({
    store,
    kitStore: deps.kitStore,
    userId: user.id,
    brandId,
    ...(asString(args.brandKitId) ? { brandKitId: asString(args.brandKitId) } : {}),
    kind,
    url: kitUrl,
    role: variant,
    sourceUrl: url,
  })
  warnings.push(...kitSaved.warnings)
  // Winners feed the brand's "winning ads" Style DNA, so create_ads { styleDnaId } uses them as a
  // style reference (layout family, hierarchy, density) — never as a template to copy.
  let styleDnaId: string | undefined
  if (kind === 'winner_ad') {
    const kitRow = await deps.kitStore.getKit({ userId: user.id, kitId: kitSaved.brandKitId })
    const dnas = parseStyleDnas(kitRow?.style_dnas)
    const current = dnas.find((d) => d.id === WINNERS_STYLE_DNA_ID)
    const next: StyleDna = {
      id: WINNERS_STYLE_DNA_ID,
      name: current?.name || 'Anuncios ganadores',
      kind: 'ads',
      referenceUrls: [...(current?.referenceUrls ?? []).filter((u) => u !== kitUrl), kitUrl].slice(-12),
      // New references → the stored analysis is dropped and redone on the next pack that uses it.
      notes: current?.notes || 'Winning ads of the brand: style reference (layout, hierarchy, density), never a template.',
    }
    await deps.kitStore.updateKit({ userId: user.id, kitId: kitSaved.brandKitId, patch: { style_dnas: upsertStyleDnaList(dnas, next), updated_at: new Date().toISOString() } })
    styleDnaId = WINNERS_STYLE_DNA_ID
  }
  return {
    ...base,
    url: kitUrl,
    ...(styleDnaId ? { styleDnaId, nextStep: `create_ads { brandId, offerId, styleDnaId: "${styleDnaId}" } makes the layouts follow these winners (style reference only).` } : {}),
    ...(kind === 'logo' ? { originalStoredUrl: storedUrl } : {}),
    target: 'brand_kit',
    brandKitId: kitSaved.brandKitId,
    ...(variant ? { variant } : {}),
    ...(kind === 'logo' ? { logoUrlSet: kitSaved.logoUrlSet } : {}),
    ...(logo ? { logo } : {}),
    ...(warnings.length ? { warnings } : {}),
    creditsNote: 'Free — no Advance credits.',
  }
}

/** Batch: same rules per item; one failure never stops the others. */
export async function mcpImportImages(deps: ImportDeps & { args: Row }): Promise<Row> {
  const items = deps.args.items
  if (!Array.isArray(items) || !items.length) throw new ImportInputError('items must be a non-empty array of { url, kind, role?, label?, offerId? }')
  if (items.length > IMPORT_BATCH_MAX) throw new ImportInputError(`At most ${IMPORT_BATCH_MAX} images per call`)
  const defaults: Row = {}
  for (const k of ['brandId', 'offerId', 'kind', 'brandKitId'] as const) if (deps.args[k] !== undefined) defaults[k] = deps.args[k]
  const results: Row[] = []
  for (const [index, raw] of items.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      results.push({ index, status: 'error', error: { code: 'BAD_INPUT', message: 'each item must be an object' } })
      continue
    }
    try {
      results.push({ index, ...(await mcpImportImage({ ...deps, args: { ...defaults, ...(raw as Row) } })) })
    } catch (err) {
      const e = err as { message?: string; code?: string }
      results.push({ index, status: 'error', url: (raw as Row).url ?? null, error: { code: e.code ?? 'IMPORT_FAILED', message: e.message ?? String(err) } })
    }
  }
  const imported = results.filter((r) => r.status === 'imported').length
  return {
    status: imported === results.length ? 'imported' : imported ? 'partial' : 'failed',
    imported,
    failed: results.length - imported,
    results,
    creditsNote: 'Free — no Advance credits.',
    ...(imported < results.length ? { nextStep: 'Fix the failed items (see error.message: e.g. share the Drive file as "Anyone with the link") and import them again.' } : {}),
  }
}
