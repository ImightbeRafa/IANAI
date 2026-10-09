/**
 * Product photos with roles (H3/C3) — pure helpers, no image deps (safe for any module).
 */
import type { OfferInput, ProductPhoto, ProductPhotoRole } from '../types.js'

export const PRODUCT_PHOTO_ROLES: ProductPhotoRole[] = ['hero', 'part', 'contents', 'box', 'in_use', 'detail']

export function isProductPhotoRole(v: unknown): v is ProductPhotoRole {
  return typeof v === 'string' && (PRODUCT_PHOTO_ROLES as string[]).includes(v)
}

/** Immutable product attributes (sanitized, ≤ 8, ≤ 60 chars) — shared by prompts and checks. */
export function cleanAttributes(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((a) => String(a ?? '').replace(/[\r\n"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean))].slice(0, 12)
}

/** Explicit role prefix written by import_image before migration 085 ("[part] control"). */
const ROLE_PREFIX_RE = /^\s*\[(hero|part|contents|box|in_use|detail)\]\s*/i

/** Label that carries the role explicitly (pre-085 storage of import_image roles). */
export function labelWithRole(role: ProductPhotoRole, label?: string | null): string {
  const rest = stripRolePrefix(label)
  return `[${role}]${rest ? ` ${rest}` : ''}`
}

/** Label without the explicit role prefix (for display / prompts). */
export function stripRolePrefix(label: string | null | undefined): string {
  return String(label ?? '').replace(ROLE_PREFIX_RE, '').trim()
}

export function hasRolePrefix(label: string | null | undefined): boolean {
  return ROLE_PREFIX_RE.test(String(label ?? ''))
}

/** Owner label → role (saved product_images rows carry free-text labels; no role column yet). */
export function roleFromLabel(label: string | null | undefined): ProductPhotoRole | undefined {
  const explicit = String(label ?? '').match(ROLE_PREFIX_RE)
  if (explicit) return explicit[1].toLowerCase() as ProductPhotoRole
  const s = String(label ?? '').toLowerCase()
  if (!s) return undefined
  if (/\b(hero|principal|main|portada)\b/.test(s)) return 'hero'
  if (/\b(caja|box|empaque|packaging|package)\b/.test(s)) return 'box'
  if (/\b(contenido|contents|kit|incluye|includes)\b/.test(s)) return 'contents'
  if (/\b(en[- ]uso|in[- ]use|uso|using|lifestyle)\b/.test(s)) return 'in_use'
  if (/\b(detalle|detail|close[- ]?up|macro)\b/.test(s)) return 'detail'
  if (/\b(parte|part|pieza|piece|control|remote|accesorio|accessory)\b/.test(s)) return 'part'
  return undefined
}

/** 085 product_images tags (WS2 tag_product_image) → fidelity roles. */
export const TAG_ROLE: Record<string, ProductPhotoRole> = {
  hero: 'hero',
  part: 'part',
  caja: 'box',
  'contenido-kit': 'contents',
  'en-uso': 'in_use',
  detalle: 'detail',
}

/**
 * Role of a saved product_images row from its 085 columns: a 'part' tag wins (a kit part is never
 * the hero), then is_primary / 'hero', then caja → box, contenido-kit → contents, en-uso → in_use,
 * detalle → detail. Undefined when the row carries no tag and is not primary.
 */
export function roleFromImageRow(row: { tags?: unknown; is_primary?: unknown }): ProductPhotoRole | undefined {
  const tags = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : []
  if (tags.includes('part')) return 'part'
  if (row.is_primary === true || tags.includes('hero')) return 'hero'
  for (const tag of ['caja', 'contenido-kit', 'en-uso', 'detalle']) if (tags.includes(tag)) return TAG_ROLE[tag]
  return undefined
}

/** Photos of an offer with roles. `productPhotos` wins; else productImageUrls (first = hero, rest = detail). */
export function resolveProductPhotos(offer: Pick<OfferInput, 'productPhotos' | 'productImageUrls'>): ProductPhoto[] {
  const tagged = (offer.productPhotos ?? []).filter((p) => p && typeof p.url === 'string' && p.url)
  if (tagged.length) return tagged
  return (offer.productImageUrls ?? []).filter(Boolean).map((url, i) => ({ url, role: i === 0 ? 'hero' : 'detail' }) as ProductPhoto)
}

export function hasUsableProductPhoto(offer: Pick<OfferInput, 'productPhotos' | 'productImageUrls'>): boolean {
  return resolveProductPhotos(offer).some((p) => p.role !== 'part')
}
