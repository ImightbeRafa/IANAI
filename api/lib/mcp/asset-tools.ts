/**
 * MCP 0.26.0 — asset roles + varied reference selection (docs/mcp-quality.md).
 *
 *  - Roles: product | b-roll | unboxing | lifestyle | packaging | logo (product_images.asset_role, optional migration 086). When a
 *    row has no explicit role — or the column does not exist yet — it is inferred from the 085 role column / tags / label
 *    (inferAssetRole) and the kind (context → lifestyle). A missing column is never a block.
 *  - No approval step: every real product / context photo of the brand can be a reference (generated images never are).
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
export const MIGRATION_086 = '086_product_images_asset_role.sql'

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
  // Local, deterministic signals only (size + local compression / screenshot checks): a vision verdict that fails / differs between the
  // quote call and the approved call can never change the selection (and so the bound input).
  return Math.min(long, 4000) - 400 * v.issues.filter((i) => i.severity === 'warning' && i.source !== 'vision' && i.code !== 'low_resolution' && i.code !== 'very_low_resolution').length
}

/**
 * Gate-accepted refs for one generation. `confirmedIds` (productImageId first) → exactly those; none → automatic varied pick:
 * hero product (primary first, then best quality) + another angle / packaging + a lifestyle / b-roll.
 */
export function selectReferences(input: {
  assets: McpOwnedImage[]
  verdicts: Map<string, ReferenceVerdict>
  confirmedIds?: string[]
  productImageId?: string
  /** Provider ref budget for assets (Grok: 3). */
  max?: number
}): ReferenceSelection {
  const max = input.max ?? 3
  const usable = (a: McpOwnedImage) => a.kind !== 'generated' && input.verdicts.get(a.id)?.ok === true
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
  // Packs: the box / pouch IS the product — packaging is a valid hero, then unboxing as the last resort.
  const hero = pool.find((a) => effectiveAssetRole(a) === 'product') ?? pool.find((a) => effectiveAssetRole(a) === 'packaging') ?? pool.find((a) => effectiveAssetRole(a) === 'unboxing')
  if (!hero) return { product, support, picked }
  place(hero, hero.isPrimary ? 'hero (primary photo)' : 'hero (best-quality product photo)')
  const second = pool.find((a) => a.id !== hero.id && (effectiveAssetRole(a) === 'product' || effectiveAssetRole(a) === 'packaging'))
  if (second && picked.length < max) place(second, effectiveAssetRole(second) === 'packaging' ? 'packaging' : 'another angle')
  const context = pool.find((a) => effectiveAssetRole(a) === 'lifestyle' || effectiveAssetRole(a) === 'b-roll')
  if (context && picked.length < max) place(context, 'lifestyle / b-roll context')
  return { product, support, picked }
}

/** The actionable "what is missing" error (before any charge). */
export function missingAssetsMessage(o: { assets: McpOwnedImage[]; verdicts: Map<string, ReferenceVerdict>; confirmedIds?: string[]; language?: 'es' | 'en' }): string {
  const es = o.language !== 'en'
  const products = o.assets.filter((a) => a.kind !== 'generated' && ['product', 'packaging', 'unboxing'].includes(effectiveAssetRole(a)))
  const broken = products.filter((a) => o.verdicts.get(a.id) && !o.verdicts.get(a.id)!.ok)
  const unknown = (o.confirmedIds ?? []).filter((id) => !o.assets.some((x) => x.id === id))
  const min = REFERENCE_GATE_CONFIG.MIN_LONG_SIDE
  const lines: string[] = [es ? 'No se cobró nada. Falta al menos 1 foto de producto descargable para generar.' : 'Nothing was charged. At least 1 downloadable product photo is needed to generate.']
  if (unknown.length) lines.push(es ? `Ids desconocidos para esta marca: ${unknown.join(', ')} (usá list_assets).` : `Unknown ids for this brand: ${unknown.join(', ')} (use list_assets).`)
  if (broken.length) lines.push(es ? `Fotos que no se pueden usar (no descargan o no son imagen): ${broken.map((a) => `${a.id}${a.label ? ` («${stripRolePrefix(a.label).slice(0, 40)}»)` : ''}`).join(', ')} — volvé a importarlas (import_image).` : `Unusable photos (not downloadable / not an image): ${broken.map((a) => a.id).join(', ')} — re-import them (import_image).`)
  if (!products.length) lines.push(es ? `Esta oferta no tiene fotos de producto: subí una foto real del producto de ≥ ${min} px en el lado largo (import_image {kind:"product_photo", role:"hero"}).` : `This offer has no product photos: upload a real product photo of ≥ ${min} px on the long side (import_image {kind:"product_photo", role:"hero"}).`)
  else lines.push(es ? `Consejo: para mejores anuncios subí fotos de ≥ ${min} px, nítidas, sin texto sobreimpreso (las más chicas se aceptan con aviso).` : `Tip: for better ads upload sharp photos of ≥ ${min} px without burned-in text (smaller ones are accepted with a warning).`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// set_asset_role (free, owner-scoped). Needs the optional migration 086 column; without it → MIGRATION_PENDING, generation unaffected.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function mcpSetAssetRole(options: { store: McpOfferStore; user: McpAuthUser; args: Row }): Promise<Row> {
  const role = options.args.assetRole ?? options.args.role
  if (role !== null && !isAssetRole(role)) throw new Error(`assetRole must be one of: ${ASSET_ROLES.join(', ')} (or null to infer it)`)
  const imageId = str(options.args.productImageId) || str(options.args.assetId) || str(options.args.id)
  if (!imageId) throw new Error('productImageId is required (from list_assets)')
  const image = await options.store.getProductImage({ userId: options.user.id, imageId })
  if (!image) throw new Error('Asset not found for this user')
  const offer = await options.store.getOfferById({ userId: options.user.id, offerId: String(image.product_id || '') })
  if (!offer) throw new Error('Asset not found for this user')
  if (options.args.brandId !== undefined && str(options.args.brandId) !== String(offer.business_id)) throw new Error('Asset not found for this brand')
  let updated: Row
  try {
    updated = await options.store.updateProductImage({ userId: options.user.id, imageId: String(image.id), patch: { asset_role: role ?? null } })
  } catch (err) {
    if (isMissingColumnError(err)) throw new MigrationPendingError('set_asset_role', MIGRATION_086)
    throw err
  }
  return {
    status: 'updated',
    asset: { productImageId: updated.id, offerId: updated.product_id, kind: updated.kind ?? null, assetRole: updated.asset_role ?? null, label: updated.label ?? null },
    creditsNote: 'Free sync write — no Advance credits.',
  }
}
