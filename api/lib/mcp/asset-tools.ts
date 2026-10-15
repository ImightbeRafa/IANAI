/**
 * MCP 0.26.0 — asset roles + the owner's `approved` flag (docs/mcp-quality.md, migration 086).
 *
 *  - Roles: product | b-roll | unboxing | lifestyle | packaging | logo (product_images.asset_role). When a row has no explicit
 *    role it is inferred from the 085 role column / tags / label (inferAssetRole) and the kind (context → lifestyle).
 *  - `approved` is set ONLY by the brand owner (approve_asset / unapprove_asset; RLS enforces it in the database too).
 *    Generation uses ONLY approved assets. A store without the column at all (tests / fakes) reports approved = undefined and is
 *    treated as approved; the Supabase adapter reports false while migration 086 is pending (fail closed).
 *  - Varied refs: hero product + one other angle / packaging + one lifestyle / b-roll context, best quality first, within the
 *    provider's 3-ref budget.
 */
import { inferAssetRole, stripRolePrefix } from '../adpack/fidelity/photos.js'
import { isMissingColumnError, MigrationPendingError } from '../db-missing-column.js'
import type { McpOwnedImage } from './artifact-store.js'
import type { McpOfferStore } from './offer-tools.js'
import { REFERENCE_GATE_CONFIG, type ReferenceVerdict } from './reference-gate.js'
import type { McpAuthUser } from './user-tools.js'

export const ASSET_ROLES = ['product', 'b-roll', 'unboxing', 'lifestyle', 'packaging', 'logo'] as const
export type AssetRole = (typeof ASSET_ROLES)[number]
export const MIGRATION_086 = '086_product_images_approved.sql'

export function isAssetRole(v: unknown): v is AssetRole {
  return typeof v === 'string' && (ASSET_ROLES as readonly string[]).includes(v)
}

/** Explicit asset role, else inferred from the 085 role / tags / label and the kind. */
export function effectiveAssetRole(img: Pick<McpOwnedImage, 'assetRole' | 'kind' | 'tags' | 'role' | 'label' | 'isPrimary'>): AssetRole {
  if (isAssetRole(img.assetRole)) return img.assetRole
  if (img.kind === 'context') return 'lifestyle'
  const r = inferAssetRole({ tags: img.tags, isPrimary: img.isPrimary, role: img.role, label: img.label })
  if (r === 'box') return 'packaging'
  if (r === 'contents') return 'unboxing'
  if (r === 'in_use') return 'lifestyle'
  return 'product'
}

/** Approved by the owner. `undefined` = the store has no approval column at all (fakes / tests): treated as approved. */
export function isApproved(img: Pick<McpOwnedImage, 'approved'>): boolean {
  return img.approved !== false
}

export type ReferenceSelection = {
  /** Product refs (hero first): /images/edits PRODUCT LOCK. */
  product: McpOwnedImage[]
  /** Context refs (lifestyle / b-roll): style / scene refs. */
  support: McpOwnedImage[]
  /** Why each one was picked. */
  picked: Array<{ id: string; role: AssetRole; reason: string }>
}

const qualityRank = (v: ReferenceVerdict | undefined): number => {
  if (!v) return 0
  const long = Math.max(v.width ?? 0, v.height ?? 0)
  return Math.min(long, 4000) - 400 * v.issues.filter((i) => i.severity === 'warning' && i.code !== 'low_resolution' && i.code !== 'very_low_resolution').length
}

/**
 * Approved, gate-accepted refs for one generation. `confirmedIds` (productImageId first) → exactly those (each must be approved);
 * none → automatic varied pick: hero product (primary first, then best quality) + another angle / packaging + a lifestyle / b-roll.
 */
export function selectApprovedReferences(input: {
  assets: McpOwnedImage[]
  verdicts: Map<string, ReferenceVerdict>
  confirmedIds?: string[]
  productImageId?: string
  /** Provider ref budget for assets (Grok: 3). */
  max?: number
}): ReferenceSelection {
  const max = input.max ?? 3
  const usable = (a: McpOwnedImage) => isApproved(a) && a.kind !== 'generated' && input.verdicts.get(a.id)?.ok === true
  const picked: ReferenceSelection['picked'] = []
  const product: McpOwnedImage[] = []
  const support: McpOwnedImage[] = []
  const place = (a: McpOwnedImage, reason: string) => {
    const role = effectiveAssetRole(a)
    ;(role === 'lifestyle' || role === 'b-roll' ? support : product).push(a)
    picked.push({ id: a.id, role, reason })
  }
  const ids = [...new Set([...(input.productImageId ? [input.productImageId] : []), ...(input.confirmedIds ?? [])])]
  if (ids.length) {
    for (const id of ids.slice(0, max)) {
      const a = input.assets.find((x) => x.id === id)
      if (a && usable(a)) place(a, id === input.productImageId ? 'confirmed hero' : 'confirmed')
    }
    return { product, support, picked }
  }
  const pool = input.assets.filter(usable).sort((x, y) => Number(y.isPrimary === true) - Number(x.isPrimary === true) || qualityRank(input.verdicts.get(y.id)) - qualityRank(input.verdicts.get(x.id)))
  const hero = pool.find((a) => effectiveAssetRole(a) === 'product')
  if (!hero) return { product, support, picked }
  place(hero, hero.isPrimary ? 'hero (primary photo)' : 'hero (best-quality approved product photo)')
  const second = pool.find((a) => a.id !== hero.id && (effectiveAssetRole(a) === 'product' || effectiveAssetRole(a) === 'packaging'))
  if (second && picked.length < max) place(second, effectiveAssetRole(second) === 'packaging' ? 'packaging' : 'another angle')
  const context = pool.find((a) => effectiveAssetRole(a) === 'lifestyle' || effectiveAssetRole(a) === 'b-roll')
  if (context && picked.length < max) place(context, 'lifestyle / b-roll context')
  return { product, support, picked }
}

/** The actionable "what is missing" error (before any charge). */
export function missingAssetsMessage(o: { assets: McpOwnedImage[]; verdicts: Map<string, ReferenceVerdict>; confirmedIds?: string[]; language?: 'es' | 'en' }): string {
  const es = o.language !== 'en'
  const products = o.assets.filter((a) => a.kind !== 'generated' && effectiveAssetRole(a) === 'product')
  const unapproved = products.filter((a) => !isApproved(a))
  const broken = products.filter((a) => o.verdicts.get(a.id) && !o.verdicts.get(a.id)!.ok)
  const notApprovedConfirmed = (o.confirmedIds ?? []).filter((id) => { const a = o.assets.find((x) => x.id === id); return a && !isApproved(a) })
  const unknown = (o.confirmedIds ?? []).filter((id) => !o.assets.some((x) => x.id === id))
  const min = REFERENCE_GATE_CONFIG.MIN_LONG_SIDE
  const lines: string[] = [es ? 'No se cobró nada. Falta al menos 1 foto de producto APROBADA y descargable para generar.' : 'Nothing was charged. At least 1 APPROVED, downloadable product photo is needed to generate.']
  if (notApprovedConfirmed.length) lines.push(es ? `Las fotos elegidas no están aprobadas: ${notApprovedConfirmed.map((id) => `approve_asset ${id}`).join(' · ')}` : `The selected photos are not approved: ${notApprovedConfirmed.map((id) => `approve_asset ${id}`).join(' · ')}`)
  if (unknown.length) lines.push(es ? `Ids desconocidos para esta marca: ${unknown.join(', ')} (usá list_assets).` : `Unknown ids for this brand: ${unknown.join(', ')} (use list_assets).`)
  if (unapproved.length) lines.push(es ? `Fotos de producto sin aprobar (el dueño de la marca las aprueba, gratis): ${unapproved.slice(0, 8).map((a) => `approve_asset ${a.id}${a.label ? ` («${stripRolePrefix(a.label).slice(0, 40)}»)` : ''}`).join(' · ')}` : `Unapproved product photos (the brand owner approves them, free): ${unapproved.slice(0, 8).map((a) => `approve_asset ${a.id}${a.label ? ` ("${stripRolePrefix(a.label).slice(0, 40)}")` : ''}`).join(' · ')}`)
  if (broken.length) lines.push(es ? `Fotos que no se pueden usar (no descargan o no son imagen): ${broken.map((a) => a.id).join(', ')} — volvé a importarlas (import_image).` : `Unusable photos (not downloadable / not an image): ${broken.map((a) => a.id).join(', ')} — re-import them (import_image).`)
  if (!products.length) lines.push(es ? `Esta oferta no tiene fotos de producto: subí una foto real del producto de ≥ ${min} px en el lado largo (import_image {kind:"product_photo", role:"hero"}), luego approve_asset <id>.` : `This offer has no product photos: upload a real product photo of ≥ ${min} px on the long side (import_image {kind:"product_photo", role:"hero"}), then approve_asset <id>.`)
  else lines.push(es ? `Consejo: para mejores anuncios subí fotos de ≥ ${min} px, nítidas, sin texto sobreimpreso (las más chicas se aceptan con aviso).` : `Tip: for better ads upload sharp photos of ≥ ${min} px without burned-in text (smaller ones are accepted with a warning).`)
  return lines.join('\n')
}

export class MissingAssetsError extends Error {
  readonly code = 'MISSING_ASSETS'
}

// ---------------------------------------------------------------------------
// Tools (free; owner only)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

async function ownerImage(store: McpOfferStore, user: McpAuthUser, args: Row): Promise<{ image: Row; offer: Row }> {
  const imageId = str(args.productImageId) || str(args.assetId) || str(args.id)
  if (!imageId) throw new Error('productImageId is required (from list_assets)')
  const image = await store.getProductImage({ userId: user.id, imageId })
  if (!image) throw new Error('Asset not found for this user')
  // Owner only: getOfferById is owner-scoped (products.owner_id = user) — a team member / another user never resolves.
  const offer = await store.getOfferById({ userId: user.id, offerId: String(image.product_id || '') })
  if (!offer) throw new Error('Only the brand owner can change this asset (offer not owned by this user)')
  if (args.brandId !== undefined && str(args.brandId) !== String(offer.business_id)) throw new Error('Asset not found for this brand')
  return { image, offer }
}

function assetView(row: Row): Row {
  return {
    productImageId: row.id,
    offerId: row.product_id,
    imageUrl: row.image_url,
    kind: row.kind ?? null,
    assetRole: row.asset_role ?? null,
    approved: row.approved === true,
    approvedAt: row.approved_at ?? null,
    label: row.label ?? null,
  }
}

const isMissingApproval = (err: unknown) => isMissingColumnError(err)

export async function mcpSetAssetApproved(options: { store: McpOfferStore; user: McpAuthUser; args: Row; approved: boolean }): Promise<Row> {
  const { image } = await ownerImage(options.store, options.user, options.args)
  if (image.kind === 'generated') throw new Error('Generated images cannot be approved as references: approve a real photo')
  const patch: Row = options.approved
    ? { approved: true, approved_at: new Date().toISOString(), approved_by: options.user.id }
    : { approved: false, approved_at: null, approved_by: null }
  let updated: Row
  try {
    updated = await options.store.updateProductImage({ userId: options.user.id, imageId: String(image.id), patch })
  } catch (err) {
    if (isMissingApproval(err)) throw new MigrationPendingError(options.approved ? 'approve_asset' : 'unapprove_asset', MIGRATION_086)
    throw err
  }
  return {
    status: 'updated',
    asset: assetView(updated),
    message: options.approved ? 'Approved: this asset can now be used as a reference for generation.' : 'Unapproved: this asset will not be used for generation.',
    creditsNote: 'Free sync write — no Advance credits.',
  }
}

export async function mcpSetAssetRole(options: { store: McpOfferStore; user: McpAuthUser; args: Row }): Promise<Row> {
  const role = options.args.assetRole ?? options.args.role
  if (role !== null && !isAssetRole(role)) throw new Error(`assetRole must be one of: ${ASSET_ROLES.join(', ')} (or null to infer it)`)
  const { image } = await ownerImage(options.store, options.user, options.args)
  let updated: Row
  try {
    updated = await options.store.updateProductImage({ userId: options.user.id, imageId: String(image.id), patch: { asset_role: role ?? null } })
  } catch (err) {
    if (isMissingApproval(err)) throw new MigrationPendingError('set_asset_role', MIGRATION_086)
    throw err
  }
  return { status: 'updated', asset: assetView(updated), creditsNote: 'Free sync write — no Advance credits.' }
}
