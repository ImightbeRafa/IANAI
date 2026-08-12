/**
 * Pure helpers for chat-shell single-offer resolution (unit-testable).
 */

export interface OfferLike {
  product_id: string
  position: number
}

export interface SessionProductLike {
  product_id?: string | null
}

/** Prefer session.product_id, else lowest-position offer product. */
export function resolveSessionOfferProductId(
  session: SessionProductLike | null | undefined,
  offers: OfferLike[] | null | undefined
): string | null {
  if (session?.product_id) return session.product_id
  if (!offers || offers.length === 0) return null
  const sorted = [...offers].sort((a, b) => a.position - b.position)
  return sorted[0]?.product_id ?? null
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

/** Prefer explicit preferred (hydrate/click/Quick), else keep current, else first. */
export function resolveNextSessionId(options: {
  sessionIds: string[]
  preferredId?: string | null
  currentId?: string | null
}): string | null {
  const { sessionIds, preferredId, currentId } = options
  if (preferredId && sessionIds.includes(preferredId)) return preferredId
  if (currentId && sessionIds.includes(currentId)) return currentId
  return sessionIds[0] ?? null
}
