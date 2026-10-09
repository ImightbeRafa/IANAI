/**
 * Product photos with roles (H3/C3) — pure helpers, no image deps (safe for any module).
 */
import type { OfferInput, ProductPhoto, ProductPhotoRole } from '../types.js'

export const PRODUCT_PHOTO_ROLES: ProductPhotoRole[] = ['hero', 'part', 'contents', 'box', 'in_use', 'detail']

export function isProductPhotoRole(v: unknown): v is ProductPhotoRole {
  return typeof v === 'string' && (PRODUCT_PHOTO_ROLES as string[]).includes(v)
}

/** Owner label → role (saved product_images rows carry free-text labels; no role column yet). */
export function roleFromLabel(label: string | null | undefined): ProductPhotoRole | undefined {
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

/** Photos of an offer with roles. `productPhotos` wins; else productImageUrls (first = hero, rest = detail). */
export function resolveProductPhotos(offer: Pick<OfferInput, 'productPhotos' | 'productImageUrls'>): ProductPhoto[] {
  const tagged = (offer.productPhotos ?? []).filter((p) => p && typeof p.url === 'string' && p.url)
  if (tagged.length) return tagged
  return (offer.productImageUrls ?? []).filter(Boolean).map((url, i) => ({ url, role: i === 0 ? 'hero' : 'detail' }) as ProductPhoto)
}

export function hasUsableProductPhoto(offer: Pick<OfferInput, 'productPhotos' | 'productImageUrls'>): boolean {
  return resolveProductPhotos(offer).some((p) => p.role !== 'part')
}
