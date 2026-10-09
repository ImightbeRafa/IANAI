/**
 * In-memory PackStore for tests and the benchmark. Same semantics as the
 * Supabase store: deep copies in/out, atomic leasing (single JS thread), owner
 * check on read, a present-but-undefined `leaseUntil` clears the lease.
 */
import type { Pack, PackItem, PackStore } from './types.js'

const clone = <T>(v: T): T => structuredClone(v)

export interface MemoryPackStore extends PackStore {
  packs: Map<string, Pack>
  items: Map<string, PackItem>
  /** Test clock override. */
  now: () => number
}

export function createMemoryPackStore(options: { now?: () => number } = {}): MemoryPackStore {
  const packs = new Map<string, Pack>()
  const items = new Map<string, PackItem>()
  const store: MemoryPackStore = {
    packs,
    items,
    now: options.now ?? (() => Date.now()),

    async createPack(pack, packItems) {
      if (packs.has(pack.id)) throw new Error(`pack_exists:${pack.id}`)
      packs.set(pack.id, clone(pack))
      for (const it of packItems) items.set(it.id, clone(it))
    },

    async getPack(packId, userId) {
      const pack = packs.get(packId)
      if (!pack || pack.userId !== userId) return null
      const list = [...items.values()].filter((i) => i.packId === packId).sort((a, b) => a.index - b.index)
      return { pack: clone(pack), items: list.map(clone) }
    },

    async updatePack(packId, patch) {
      const pack = packs.get(packId)
      if (!pack) throw new Error(`pack_not_found:${packId}`)
      packs.set(packId, { ...pack, ...clone(patch), updatedAt: new Date(store.now()).toISOString() })
    },

    async leaseItems(packId, limit, leaseMs, opts) {
      const now = store.now()
      const exclude = new Set(opts?.excludeIds ?? [])
      const free = [...items.values()]
        .filter((i) => i.packId === packId && i.status !== 'done' && i.status !== 'failed' && !exclude.has(i.id))
        .filter((i) => !i.leaseUntil || Date.parse(i.leaseUntil) < now)
        .sort((a, b) => a.index - b.index)
        .slice(0, Math.max(0, limit))
      const leaseUntil = new Date(now + leaseMs).toISOString()
      for (const i of free) {
        i.leaseUntil = leaseUntil
        i.updatedAt = new Date(now).toISOString()
      }
      return free.map(clone)
    },

    async listOpenPacks({ limit, createdAfterIso }) {
      const after = Date.parse(createdAfterIso)
      return [...packs.values()]
        .filter((p) => (p.status === 'planned' || p.status === 'running') && Date.parse(p.createdAt) >= after)
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
        .slice(0, Math.max(0, limit))
        .map((p) => ({ packId: p.id, userId: p.userId }))
    },

    async updateItem(itemId, patch) {
      const item = items.get(itemId)
      if (!item) throw new Error(`item_not_found:${itemId}`)
      const next: PackItem = { ...item, ...clone(patch), updatedAt: new Date(store.now()).toISOString() }
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k]
      items.set(itemId, next)
    },
  }
  return store
}
