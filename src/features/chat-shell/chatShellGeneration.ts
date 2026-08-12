import {
  normalizeOfferPositions,
  sortOffersByPosition,
  type OfferLike,
} from './sessionOffer'

export interface PlannedOfferStep {
  productId: string
  /** 1-based ordinal within this generate/retry batch */
  ordinal: number
  /** Session offer position (1 = primary) when known */
  position: number
  name?: string
}

/**
 * Walk ALL session offers by position ascending — never primary-only.
 * Used for sequential /api/chat calls (1 usage + 1 ScriptCard per offer).
 */
export function planOfferGenerationWalk(
  offers: Array<OfferLike & { name?: string; product?: { name?: string } | null }>
): PlannedOfferStep[] {
  const sorted = sortOffersByPosition(offers)
  return sorted.map((offer, index) => ({
    productId: offer.product_id,
    ordinal: index + 1,
    position: offer.position,
    name: offer.name || offer.product?.name,
  }))
}

/** Retry only failed product IDs, fresh 1-based ordinals, preserve offer order. */
export function planRetryOfferWalk(
  failedProductIds: string[],
  offers: Array<OfferLike & { name?: string; product?: { name?: string } | null }>
): PlannedOfferStep[] {
  if (failedProductIds.length === 0) return []
  const failed = new Set(failedProductIds)
  const ordered = sortOffersByPosition(offers).filter((o) => failed.has(o.product_id))
  // Preserve failed-id order when an id is no longer in offers
  const byId = new Map(ordered.map((o) => [o.product_id, o]))
  const steps: PlannedOfferStep[] = []
  let ordinal = 1
  for (const id of failedProductIds) {
    const offer = byId.get(id)
    if (!offer) continue
    steps.push({
      productId: id,
      ordinal: ordinal++,
      position: offer.position,
      name: offer.name || offer.product?.name,
    })
  }
  return steps
}

/** Build ordered product id list for persistence (cap + gap-free). */
export function planOfferProductIds(productIds: string[]): string[] {
  return normalizeOfferPositions(productIds).map((row) => row.product_id)
}
