/**
 * Pure helpers for chat-shell offer selection + primary resolution (unit-testable).
 */

export const CHAT_SHELL_MAX_OFFERS = 5

export interface OfferLike {
  product_id: string
  position: number
}

export interface SessionProductLike {
  product_id?: string | null
}

/** Gap-free positions 1..n (n ≤ 5). Dedupes, preserves first-seen order. */
export function normalizeOfferPositions(
  productIds: string[]
): Array<{ product_id: string; position: number }> {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const id of productIds) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    unique.push(id)
    if (unique.length >= CHAT_SHELL_MAX_OFFERS) break
  }
  return unique.map((product_id, index) => ({
    product_id,
    position: index + 1,
  }))
}

export function canAddSessionOffer(currentCount: number): boolean {
  return currentCount < CHAT_SHELL_MAX_OFFERS
}

export function sortOffersByPosition<T extends OfferLike>(offers: T[]): T[] {
  return [...offers].sort((a, b) => a.position - b.position)
}

/**
 * Primary offer = position 1 when offers exist.
 * Legacy: if offers empty, fall back to session.product_id.
 * (Do NOT use this alone as the generate iterator — walk ALL offers.)
 */
export function resolveSessionOfferProductId(
  session: SessionProductLike | null | undefined,
  offers: OfferLike[] | null | undefined
): string | null {
  if (offers && offers.length > 0) {
    const sorted = sortOffersByPosition(offers)
    return sorted[0]?.product_id ?? null
  }
  return session?.product_id ?? null
}

export const CHAT_SESSION_SAFE_UPDATE_KEYS = [
  'title',
  'status',
  'context',
  'primary_channel',
  'awareness_level',
] as const

export type ChatSessionSafeUpdateKey = (typeof CHAT_SESSION_SAFE_UPDATE_KEYS)[number]

const SAFE_KEY_SET = new Set<string>(CHAT_SESSION_SAFE_UPDATE_KEYS)

/** Strip ownership / unknown keys so clients cannot mutate immutable fields. */
export function pickSafeChatSessionUpdates(
  updates: Record<string, unknown>
): Partial<Record<ChatSessionSafeUpdateKey, unknown>> {
  const out: Partial<Record<ChatSessionSafeUpdateKey, unknown>> = {}
  for (const [key, value] of Object.entries(updates)) {
    if (!SAFE_KEY_SET.has(key) || value === undefined) continue
    out[key as ChatSessionSafeUpdateKey] = value
  }
  return out
}

/**
 * Prefer live selection, then URL, then hydrate preferred, else first.
 *
 * currentId wins when still in the list, or when it matches URL/preferred
 * (intentional click/create — list may lag). A stale hydrated id that is no
 * longer in the list and no longer in the URL falls through to recovery.
 */
export function resolveNextSessionId(options: {
  sessionIds: string[]
  preferredId?: string | null
  currentId?: string | null
  urlId?: string | null
}): string | null {
  const { sessionIds, preferredId, currentId, urlId } = options
  if (currentId && sessionIds.includes(currentId)) return currentId
  if (currentId && (currentId === urlId || currentId === preferredId)) return currentId
  if (urlId && sessionIds.includes(urlId)) return urlId
  if (preferredId && sessionIds.includes(preferredId)) return preferredId
  return sessionIds[0] ?? null
}
