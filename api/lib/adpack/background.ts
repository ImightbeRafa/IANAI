/**
 * Ad Pack background progress (owner feedback #14): packs advance WITHOUT polling.
 *
 *   start / status kick ─► kickPackAdvance ─► slice 1 (advance, ≤ budget) ─► slice 2 … (self-continues)
 *   minute cron (ENABLE_CRONS) ─► sweepStalePacks ─► kickPackAdvance for unleased running packs
 *
 * - One loop per pack per process (in-process registry); a second kick while a loop runs is a no-op.
 *   A registry entry older than the stale window is ignored (a dropped scheduler can never wedge a pack).
 * - Lease-safe: every slice leases items through the PackStore (no two workers run the same item),
 *   charges stay idempotent per item generationId, so overlapping loops (another container, the cron
 *   sweep) never double-charge.
 * - Bounded: at most `maxSlices` slices per kick; a slice that moves nothing (items leased elsewhere /
 *   waiting) ends the loop — the sweep resumes the pack once its leases expire.
 */
import type { PackProgress } from './pack-runner.js'
import type { PackItem, PackStatus, PackStore } from './types.js'

/** Budget of one background slice (ms). */
export const ADPACK_SLICE_BUDGET_MS = 50_000
/** Upper bound of slices per kick (~25 min of work at 50 s each). */
export const ADPACK_MAX_SLICES = 30
/** A pack with no lease and no item update for this long is "stale" for the sweep. */
export const ADPACK_SWEEP_STALE_MS = 90_000
/** Packs resumed per cron tick. */
export const ADPACK_SWEEP_LIMIT = 3
/** Packs older than this are never resumed by the sweep (zombie guard). */
export const ADPACK_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000

const TERMINAL: ReadonlySet<PackStatus> = new Set(['done', 'partial', 'failed', 'cancelled'])

export type BackgroundSchedule = (work: () => Promise<void>) => void

export interface AdvanceCapable {
  advance(input: { userId: string; packId: unknown; budgetMs?: number }): Promise<PackProgress>
}

/** packId → when the in-process loop started its current slice (ms). */
const activeLoops = new Map<string, number>()

/** Tests: forget in-process loops (a dropped fake scheduler leaves entries behind). */
export function resetPackLoops(): void {
  activeLoops.clear()
}

export function isPackLoopActive(packId: string, nowMs = Date.now(), budgetMs = ADPACK_SLICE_BUDGET_MS): boolean {
  const at = activeLoops.get(packId)
  if (at === undefined) return false
  // A slice overrunning its budget by > 90 s (or a scheduler that dropped the work) frees the slot.
  if (nowMs - at > budgetMs + ADPACK_SWEEP_STALE_MS) {
    activeLoops.delete(packId)
    return false
  }
  return true
}

export interface KickPackAdvanceInput {
  service: AdvanceCapable
  userId: string
  packId: string
  schedule: BackgroundSchedule
  budgetMs?: number
  maxSlices?: number
  now?: () => number
  /** Observability hook (tests). */
  onSlice?: (info: { slice: number; progress: PackProgress }) => void
}

/** True when the pack still has work this loop should continue. */
export function shouldContinue(progress: PackProgress): boolean {
  if (TERMINAL.has(progress.status) || progress.pending <= 0) return false
  return progress.stoppedForBudget || progress.advanced > 0
}

/**
 * Schedule a self-continuing advance loop for one pack. Returns false when this process already runs
 * a loop for it (nothing scheduled). Never throws.
 */
export function kickPackAdvance(input: KickPackAdvanceInput): boolean {
  const now = input.now ?? (() => Date.now())
  const budgetMs = input.budgetMs ?? ADPACK_SLICE_BUDGET_MS
  const maxSlices = Math.max(1, input.maxSlices ?? ADPACK_MAX_SLICES)
  if (isPackLoopActive(input.packId, now(), budgetMs)) return false
  activeLoops.set(input.packId, now())
  const runSlice = async (slice: number): Promise<void> => {
    activeLoops.set(input.packId, now())
    let progress: PackProgress
    try {
      progress = await input.service.advance({ userId: input.userId, packId: input.packId, budgetMs })
    } catch (err) {
      activeLoops.delete(input.packId)
      console.error('[adpack] background slice failed', input.packId, err instanceof Error ? err.message : err)
      return
    }
    input.onSlice?.({ slice, progress })
    if (shouldContinue(progress) && slice + 1 < maxSlices) {
      // In-process continuation: the next slice starts right away, no poll needed.
      try {
        input.schedule(() => runSlice(slice + 1))
        return
      } catch (err) {
        console.error('[adpack] could not schedule the next slice', err instanceof Error ? err.message : err)
      }
    }
    activeLoops.delete(input.packId)
  }
  try {
    input.schedule(() => runSlice(0))
  } catch (err) {
    activeLoops.delete(input.packId)
    console.error('[adpack] could not schedule a background advance', err instanceof Error ? err.message : err)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Cron sweep: resume packs nobody is advancing (dropped background task, container restart)
// ---------------------------------------------------------------------------

export interface ResumablePackRef {
  packId: string
  userId: string
}

/** True when nobody holds a lease and nothing moved for `staleMs`. */
export function isStalePack(items: PackItem[], nowMs: number, staleMs = ADPACK_SWEEP_STALE_MS): boolean {
  const open = items.filter((i) => i.status !== 'done' && i.status !== 'failed')
  if (!open.length) return false
  if (open.some((i) => i.leaseUntil && Date.parse(i.leaseUntil) > nowMs)) return false
  const last = Math.max(0, ...items.map((i) => Date.parse(i.updatedAt) || 0))
  return nowMs - last >= staleMs
}

export interface SweepStalePacksInput {
  store: Pick<PackStore, 'getPack' | 'listOpenPacks'>
  service: AdvanceCapable
  schedule: BackgroundSchedule
  limit?: number
  staleMs?: number
  maxAgeMs?: number
  now?: () => number
}

export interface SweepResult {
  checked: number
  resumed: string[]
  skipped: number
}

/** Bounded per tick: at most `limit` packs are kicked. Never throws for a single bad pack. */
export async function sweepStalePacks(input: SweepStalePacksInput): Promise<SweepResult> {
  const now = input.now ?? (() => Date.now())
  const limit = Math.max(1, input.limit ?? ADPACK_SWEEP_LIMIT)
  if (!input.store.listOpenPacks) return { checked: 0, resumed: [], skipped: 0 }
  const nowMs = now()
  const candidates = await input.store.listOpenPacks({
    limit: limit * 4,
    createdAfterIso: new Date(nowMs - (input.maxAgeMs ?? ADPACK_SWEEP_MAX_AGE_MS)).toISOString(),
  })
  const resumed: string[] = []
  let skipped = 0
  for (const ref of candidates) {
    if (resumed.length >= limit) break
    try {
      if (isPackLoopActive(ref.packId, nowMs)) {
        skipped++
        continue
      }
      const loaded = await input.store.getPack(ref.packId, ref.userId)
      if (!loaded || TERMINAL.has(loaded.pack.status) || !isStalePack(loaded.items, nowMs, input.staleMs)) {
        skipped++
        continue
      }
      if (kickPackAdvance({ service: input.service, userId: ref.userId, packId: ref.packId, schedule: input.schedule, now })) resumed.push(ref.packId)
      else skipped++
    } catch (err) {
      skipped++
      console.error('[adpack] sweep skipped a pack', ref.packId, err instanceof Error ? err.message : err)
    }
  }
  return { checked: candidates.length, resumed, skipped }
}
