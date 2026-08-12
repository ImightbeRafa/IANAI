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

const ALL_SLOTS = [1, 2, 3, 4, 5] as const

export interface OfferPositionUpdate {
  product_id: string
  /** Must always be ∈ [1, 5] — never park outside CHECK. */
  position: number
}

export interface OfferPositionPlan {
  /** Sequential UPDATEs; after each, positions stay unique in 1..5. */
  moves: OfferPositionUpdate[]
  /**
   * When all 5 slots are occupied and a cycle blocks progress, temporarily
   * DELETE this kept row (must be artifact-free), apply moves, then reinsert
   * at its final target. Null when a free 1..5 hole already exists.
   */
  pivotDeleteId: string | null
}

function assertSlot(position: number): void {
  if (position < 1 || position > CHAT_SHELL_MAX_OFFERS) {
    throw new Error(`Offer position ${position} outside 1..${CHAT_SHELL_MAX_OFFERS}`)
  }
}

/**
 * Plan UPDATEs that move kept offers to gap-free targets without using
 * out-of-range temps (CHECK position ∈ [1,5] + UNIQUE(session_id, position)).
 *
 * Strategy: prefer direct moves into free 1..5 slots; break cycles by parking
 * one displaced row into a free hole. If no hole (full 5 permute), return a
 * pivotDeleteId for the caller to temp-delete (artifact-free only).
 */
export function planKeptOfferPositionUpdates(
  kept: OfferLike[],
  targetsByProductId: Readonly<Record<string, number>>
): OfferPositionPlan {
  const pos = new Map<string, number>()
  for (const row of kept) {
    assertSlot(row.position)
    if (pos.has(row.product_id)) {
      throw new Error(`Duplicate kept product ${row.product_id}`)
    }
    pos.set(row.product_id, row.position)
  }

  const ids = kept.map((k) => k.product_id)
  for (const id of ids) {
    const target = targetsByProductId[id]
    if (target == null) {
      throw new Error(`Missing target position for kept offer ${id}`)
    }
    assertSlot(target)
  }

  const occupied = () => new Set(pos.values())
  const freeSlots = () => ALL_SLOTS.filter((slot) => !occupied().has(slot))

  const moves: OfferPositionUpdate[] = []
  let pivotDeleteId: string | null = null

  const needsMove = () =>
    ids.some((id) => pos.has(id) && pos.get(id) !== targetsByProductId[id])

  if (!needsMove()) {
    return { moves, pivotDeleteId: null }
  }

  // Full board + displacement: open a hole via temp delete (caller reinserts).
  if (freeSlots().length === 0) {
    const pivot =
      ids.find((id) => pos.get(id) !== targetsByProductId[id]) ?? ids[0]
    pivotDeleteId = pivot
    pos.delete(pivot)
  }

  const maxSteps = CHAT_SHELL_MAX_OFFERS * CHAT_SHELL_MAX_OFFERS * 2
  let steps = 0
  while (needsMove()) {
    if (++steps > maxSteps) {
      throw new Error('Offer position planner exceeded max steps')
    }

    let progressed = false
    for (const id of ids) {
      if (!pos.has(id)) continue
      const target = targetsByProductId[id]
      const current = pos.get(id)!
      if (current === target) continue
      if (!occupied().has(target)) {
        assertSlot(target)
        moves.push({ product_id: id, position: target })
        pos.set(id, target)
        progressed = true
      }
    }
    if (progressed) continue

    const hole = freeSlots()[0]
    if (hole == null) {
      throw new Error('Offer position planner has no free 1..5 slot to break a cycle')
    }
    const displaced = ids.find(
      (id) => pos.has(id) && pos.get(id) !== targetsByProductId[id]
    )
    if (!displaced) break
    assertSlot(hole)
    moves.push({ product_id: displaced, position: hole })
    pos.set(displaced, hole)
  }

  // Every planned temp/final must stay in CHECK range.
  for (const move of moves) {
    assertSlot(move.position)
  }

  return { moves, pivotDeleteId }
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
 * Honor deep-link / preferred / live selection over brand-newest.
 *
 * Order: urlId → preferredId → currentId (always, even if list lags) → sessionIds[0].
 * Never fall through to newest while any of url/preferred/current is set — that
 * rewrite is the A→B snap after Skip / reload.
 */
export function resolveNextSessionId(options: {
  sessionIds: string[]
  preferredId?: string | null
  currentId?: string | null
  urlId?: string | null
}): string | null {
  const { preferredId, currentId, urlId } = options
  if (urlId) return urlId
  if (preferredId) return preferredId
  if (currentId) return currentId
  return options.sessionIds[0] ?? null
}
