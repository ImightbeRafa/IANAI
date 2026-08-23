/**
 * Pure FIFO credit lot math (unit-tested; mirrored by SQL RPC).
 */

export type CreditLotKind =
  | 'monthly'
  | 'rollover'
  | 'pack'
  | 'welcome'
  | 'bonus_migration'
  | 'comp'

export type CreditLot = {
  id: string
  kind: CreditLotKind
  remaining: number
  expiresAtMs: number | null
  createdAtMs: number
}

const SPEND_ORDER: CreditLotKind[] = [
  'monthly',
  'rollover',
  'welcome',
  'bonus_migration',
  'comp',
  'pack',
]

function kindRank(kind: CreditLotKind): number {
  const i = SPEND_ORDER.indexOf(kind)
  return i === -1 ? 99 : i
}

export function sortLotsForSpend(lots: CreditLot[], nowMs: number): CreditLot[] {
  return lots
    .filter((l) => l.remaining > 0 && (l.expiresAtMs == null || l.expiresAtMs > nowMs))
    .slice()
    .sort((a, b) => {
      const kr = kindRank(a.kind) - kindRank(b.kind)
      if (kr !== 0) return kr
      const ae = a.expiresAtMs ?? Number.MAX_SAFE_INTEGER
      const be = b.expiresAtMs ?? Number.MAX_SAFE_INTEGER
      if (ae !== be) return ae - be
      return a.createdAtMs - b.createdAtMs
    })
}

export function sumRemaining(lots: CreditLot[], nowMs: number): number {
  return sortLotsForSpend(lots, nowMs).reduce((s, l) => s + l.remaining, 0)
}

export type LotDelta = { lotId: string; delta: number }

export function planFifoSpend(
  lots: CreditLot[],
  credits: number,
  nowMs: number
): { ok: true; deltas: LotDelta[]; nextLots: CreditLot[] } | { ok: false; remaining: number } {
  if (credits <= 0) {
    return { ok: true, deltas: [], nextLots: lots.map((l) => ({ ...l })) }
  }
  const ordered = sortLotsForSpend(lots, nowMs)
  const available = ordered.reduce((s, l) => s + l.remaining, 0)
  if (available < credits) {
    return { ok: false, remaining: available }
  }

  const byId = new Map(lots.map((l) => [l.id, { ...l }]))
  const deltas: LotDelta[] = []
  let need = credits
  for (const lot of ordered) {
    if (need <= 0) break
    const row = byId.get(lot.id)!
    const take = Math.min(row.remaining, need)
    if (take <= 0) continue
    row.remaining -= take
    need -= take
    deltas.push({ lotId: row.id, delta: -take })
  }
  return { ok: true, deltas, nextLots: Array.from(byId.values()) }
}

/**
 * After a monthly grant: fold leftover monthly into rollover (1 cycle),
 * cap monthly+rollover at 2× allotment (burn oldest first).
 */
export function applyMonthlyGrant(options: {
  lots: CreditLot[]
  allotment: number
  nowMs: number
  periodEndMs: number
  nextPeriodEndMs: number
  newMonthlyLotId: string
  newRolloverLotId: string
}): CreditLot[] {
  const { allotment, nowMs, periodEndMs, nextPeriodEndMs } = options
  const lots = options.lots.map((l) => ({ ...l }))

  // Expire anything past expiry
  for (const lot of lots) {
    if (lot.expiresAtMs != null && lot.expiresAtMs <= nowMs) {
      lot.remaining = 0
    }
  }

  const leftoverMonthly = lots
    .filter((l) => l.kind === 'monthly' && l.remaining > 0)
    .reduce((s, l) => s + l.remaining, 0)

  for (const lot of lots) {
    if (lot.kind === 'monthly') lot.remaining = 0
  }

  if (leftoverMonthly > 0) {
    lots.push({
      id: options.newRolloverLotId,
      kind: 'rollover',
      remaining: leftoverMonthly,
      expiresAtMs: nextPeriodEndMs,
      createdAtMs: nowMs,
    })
  }

  // Cap monthly+rollover at 2×
  const cap = allotment * 2
  let pool = lots
    .filter((l) => (l.kind === 'monthly' || l.kind === 'rollover') && l.remaining > 0)
    .sort((a, b) => (a.expiresAtMs ?? 0) - (b.expiresAtMs ?? 0) || a.createdAtMs - b.createdAtMs)
  let total = pool.reduce((s, l) => s + l.remaining, 0)
  while (total > cap && pool.length) {
    const burn = total - cap
    const oldest = pool[0]
    const take = Math.min(oldest.remaining, burn)
    oldest.remaining -= take
    total -= take
    if (oldest.remaining <= 0) pool = pool.slice(1)
  }

  lots.push({
    id: options.newMonthlyLotId,
    kind: 'monthly',
    remaining: allotment,
    expiresAtMs: nextPeriodEndMs,
    createdAtMs: nowMs,
  })

  // periodEndMs reserved for callers who stamp metadata; silence unused if identical
  void periodEndMs

  return lots.filter((l) => l.remaining > 0 || l.kind === 'monthly')
}

/** Convert legacy bonus_images → persistent credits (24 each, no pack expiry). */
export function bonusImagesToCredits(bonusImages: number): number {
  return Math.max(0, Math.floor(bonusImages)) * 24
}
