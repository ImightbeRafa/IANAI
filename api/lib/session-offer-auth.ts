/**
 * Pure authorization rules for chat-shell /api/chat session+offer binding.
 *
 * Legacy note: when chat_session_offers is empty AND session.product_id is set,
 * allow that one product only (older shell / transitional sessions).
 */

export type SessionOfferAuthOk = { ok: true; productId: string; mode: 'offers' | 'legacy' }
export type SessionOfferAuthErr = { ok: false; status: number; error: string }
export type SessionOfferAuthResult = SessionOfferAuthOk | SessionOfferAuthErr

/**
 * Authorize one product_id for one /api/chat call.
 *
 * - When chat_session_offers is non-empty: product_id MUST ∈ offers
 *   (offers override session.product_id).
 * - Legacy: when offers empty AND session.product_id set → allow that one product only.
 */
export function authorizeSessionOfferProduct(options: {
  offerProductIds: string[]
  sessionProductId: string | null | undefined
  clientProductId: string | null | undefined
}): SessionOfferAuthResult {
  const offers = options.offerProductIds.filter(Boolean)
  const client = options.clientProductId || null
  const legacy = options.sessionProductId || null

  if (offers.length > 0) {
    if (!client) {
      return {
        ok: false,
        status: 400,
        error: 'productId is required for this session',
      }
    }
    if (!offers.includes(client)) {
      return {
        ok: false,
        status: 403,
        error: 'productId is not an offer on this session',
      }
    }
    return { ok: true, productId: client, mode: 'offers' }
  }

  // Legacy: no chat_session_offers rows — allow session.product_id only.
  if (legacy) {
    if (client && client !== legacy) {
      return {
        ok: false,
        status: 403,
        error: 'productId is not an offer on this session',
      }
    }
    return { ok: true, productId: legacy, mode: 'legacy' }
  }

  return {
    ok: false,
    status: 400,
    error: 'Session has no product/offer',
  }
}
