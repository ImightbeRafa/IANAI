/**
 * Pure authz helpers for chat-shell image routes (C3).
 * When sessionId is present: product MUST ∈ chat_session_offers (no legacy fallback).
 */

export type ImageSessionAuthOk = { ok: true; productId: string }
export type ImageSessionAuthErr = { ok: false; status: number; error: string }
export type ImageSessionAuthResult = ImageSessionAuthOk | ImageSessionAuthErr

/**
 * Authorize productId for image generate/edit/upload when session offers are loaded.
 * Unlike /api/chat, empty offers do NOT fall back to session.product_id.
 */
export function authorizeSessionImageProduct(options: {
  offerProductIds: string[]
  clientProductId: string | null | undefined
}): ImageSessionAuthResult {
  const offers = options.offerProductIds.filter(Boolean)
  const client = options.clientProductId || null

  if (!client) {
    return { ok: false, status: 400, error: 'productId is required for session image operations' }
  }
  if (offers.length === 0) {
    return { ok: false, status: 400, error: 'Session has no offers — attach a product before images' }
  }
  if (!offers.includes(client)) {
    return { ok: false, status: 403, error: 'productId is not an offer on this session' }
  }
  return { ok: true, productId: client }
}

export interface ProductImageAuthRow {
  id: string
  product_id: string
  user_id?: string | null
  session_id?: string | null
  image_url?: string | null
}

/**
 * Authorize a product_images row for edit/optimize under a session+offer.
 * - Row product_id must match authorized productId
 * - If row.session_id set, must equal current sessionId
 * - Reusable refs (session_id NULL) allowed for the same product
 */
export function authorizeProductImageForSession(options: {
  image: ProductImageAuthRow | null | undefined
  sessionId: string
  productId: string
}): ImageSessionAuthResult {
  const { image, sessionId, productId } = options
  if (!image) {
    return { ok: false, status: 404, error: 'Product image not found' }
  }
  if (image.product_id !== productId) {
    return { ok: false, status: 403, error: 'product_image_id does not belong to this product' }
  }
  if (image.session_id && image.session_id !== sessionId) {
    return { ok: false, status: 403, error: 'product_image_id belongs to another session' }
  }
  return { ok: true, productId }
}

/** Reject shell poll without a bound task mapping (Flux not wired in C3). */
export function authorizeShellImagePoll(options: {
  sessionId: string | null | undefined
  hasBoundTask: boolean
}): ImageSessionAuthResult | { ok: true } {
  if (!options.sessionId) return { ok: true }
  if (!options.hasBoundTask) {
    return { ok: false, status: 400, error: 'Image poll is not available for this session task' }
  }
  return { ok: true }
}

/** Normalize client productImageIds (max 4 UUIDs). */
export function normalizeProductImageIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string' || !value) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= 4) break
  }
  return out
}
