/**
 * Angle-board cache for guide_bulk_angles (F4): key = hash(brand + offer + count + language),
 * TTL 1 h, in-memory LRU per instance plus an optional injected store (e.g. KV / a table the
 * owning workstream adds later). The model call is budgeted: over budget the deterministic
 * catalog board answers at once and the model's board refines the cache in the background.
 */
import { createHash } from 'node:crypto'
import { orchestrateAngles, type AngleOrchestratorDeps } from './angle-orchestrator.js'
import type { AngleBoard, BulkOrchestratorInput } from './types.js'

export const ANGLE_CACHE_TTL_MS = 60 * 60_000
/** Default model budget for the GUIDE call (the MCP host times out around 25–30 s). */
export const ANGLE_MODEL_BUDGET_MS = 12_000
const MEMORY_MAX = 200

export interface AngleBoardCacheStore {
  get(key: string): Promise<AngleBoard | null>
  set(key: string, board: AngleBoard, ttlMs: number): Promise<void>
}

const memory = new Map<string, { board: AngleBoard; expiresAt: number }>()

export function angleCacheKey(parts: { brandId: string; offerId: string; count: number; language: string }): string {
  return createHash('sha256').update(`${parts.brandId}|${parts.offerId}|${parts.count}|${parts.language}`).digest('hex').slice(0, 32)
}

function memGet(key: string, now: number): AngleBoard | null {
  const hit = memory.get(key)
  if (!hit) return null
  if (hit.expiresAt <= now) {
    memory.delete(key)
    return null
  }
  // LRU touch
  memory.delete(key)
  memory.set(key, hit)
  return hit.board
}

function memSet(key: string, board: AngleBoard, now: number): void {
  memory.set(key, { board, expiresAt: now + ANGLE_CACHE_TTL_MS })
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string)
}

export interface CachedAnglesOptions {
  key: string
  input: BulkOrchestratorInput
  deps?: AngleOrchestratorDeps
  store?: AngleBoardCacheStore | null
  /** Skip the cache read (force a fresh board); the result is still cached. */
  refresh?: boolean
  now?: () => number
}

/** Cached + budgeted angle board. Only model boards are cached (planner/fallback boards are not). */
export async function cachedAngleBoard(options: CachedAnglesOptions): Promise<AngleBoard> {
  const now = options.now ?? (() => Date.now())
  const save = async (board: AngleBoard) => {
    if (board.source !== 'model') return
    memSet(options.key, board, now())
    try {
      await options.store?.set(options.key, board, ANGLE_CACHE_TTL_MS)
    } catch {
      // optional store: memory cache is enough
    }
  }
  if (!options.refresh) {
    const mem = memGet(options.key, now())
    if (mem) return { ...mem, cached: true }
    try {
      const stored = await options.store?.get(options.key)
      if (stored && stored.angles?.length) {
        memSet(options.key, stored, now())
        return { ...stored, cached: true }
      }
    } catch {
      // ignore store errors
    }
  }
  const board = await orchestrateAngles(options.input, {
    ...options.deps,
    budgetMs: options.deps?.budgetMs ?? ANGLE_MODEL_BUDGET_MS,
    onLateBoard: (late) => {
      void save(late)
      options.deps?.onLateBoard?.(late)
    },
  })
  await save(board)
  return board
}

/** Tests. */
export function clearAngleBoardCache(): void {
  memory.clear()
}
