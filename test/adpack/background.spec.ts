/**
 * #14 — packs progress WITHOUT polling: self-continuing background slices, a cheap status read,
 * the minute-cron sweep for stale packs, and lease safety (never a double charge).
 * Fakes only: memory store, fake gateway / renderer / storage, queued scheduler. No network.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ADPACK_SWEEP_STALE_MS,
  isStalePack,
  kickPackAdvance,
  resetPackLoops,
  shouldContinue,
  type AdvanceCapable,
} from '../../api/lib/adpack/background'
import type { PackProgress } from '../../api/lib/adpack/pack-runner'
import { createDoorEnv, serum, USER_A, PER_AD } from './door-harness'

type Work = () => Promise<void>

function queue() {
  const jobs: Work[] = []
  return {
    jobs,
    schedule: (w: Work) => {
      jobs.push(w)
    },
    async drain(max = 200) {
      let n = 0
      while (jobs.length && n++ < max) await jobs.shift()!()
      return n
    },
  }
}

function progress(over: Partial<PackProgress>): PackProgress {
  return {
    packId: 'p',
    status: 'running',
    total: 4,
    counts: { planned: 0, copy_ready: 0, scene_ready: 0, rendered: 0, done: 0, failed: 0 },
    done: 0,
    failed: 0,
    pending: 4,
    costUsd: 0,
    advanced: 1,
    stoppedForBudget: true,
    items: [],
    ...over,
  }
}

async function startPack(env: ReturnType<typeof createDoorEnv>, size = 3) {
  const started = await env.service.startPack({ userId: USER_A, dna: serum.dna, offer: serum.offer, size, source: 'web' })
  return started.packId
}

beforeEach(() => resetPackLoops())
afterEach(() => resetPackLoops())

describe('self-continuing background loop (no polling)', () => {
  it('schedules the next slice in-process until the pack is terminal, bounded by maxSlices', async () => {
    let pending = 3
    const calls: number[] = []
    const fake: AdvanceCapable = {
      async advance() {
        calls.push(pending)
        pending--
        return pending > 0 ? progress({ pending, stoppedForBudget: true }) : progress({ pending: 0, status: 'done', stoppedForBudget: false })
      },
    }
    const q = queue()
    expect(kickPackAdvance({ service: fake, userId: USER_A, packId: 'pack-1', schedule: q.schedule })).toBe(true)
    // A second kick while the loop is alive is a no-op (one loop per pack per process).
    expect(kickPackAdvance({ service: fake, userId: USER_A, packId: 'pack-1', schedule: q.schedule })).toBe(false)
    expect(q.jobs).toHaveLength(1)
    await q.drain()
    expect(calls).toEqual([3, 2, 1]) // three slices, each scheduled by the previous one — nobody polled
    // Terminal → the slot is free again.
    expect(kickPackAdvance({ service: fake, userId: USER_A, packId: 'pack-1', schedule: q.schedule })).toBe(true)

    // Bounded: a pack that never finishes stops after maxSlices.
    let n = 0
    const endless: AdvanceCapable = { async advance() { n++; return progress({ pending: 2, stoppedForBudget: true }) } }
    kickPackAdvance({ service: endless, userId: USER_A, packId: 'pack-2', schedule: q.schedule, maxSlices: 4 })
    await q.drain()
    expect(n).toBe(4)
  })

  it('stops when a slice moves nothing (items leased elsewhere) — the cron sweep picks it up later', () => {
    expect(shouldContinue(progress({ advanced: 0, stoppedForBudget: false }))).toBe(false)
    expect(shouldContinue(progress({ advanced: 2, stoppedForBudget: false }))).toBe(true)
    expect(shouldContinue(progress({ status: 'partial', pending: 0 }))).toBe(false)
  })

  it('a real pack finishes from the start kick alone: zero status reads', async () => {
    const env = createDoorEnv()
    const packId = await startPack(env, 4)
    const q = queue()
    // Tiny budget per slice → several slices, each scheduling the next.
    const slices: number[] = []
    kickPackAdvance({ service: env.service, userId: USER_A, packId, schedule: q.schedule, budgetMs: 1, onSlice: ({ slice }) => slices.push(slice) })
    await q.drain(500)
    expect(env.store.packs.get(packId)!.status).toBe('done')
    expect(slices.length).toBeGreaterThan(1)
    expect(env.charges).toHaveLength(4)
  })
})

describe('status is a cheap read', () => {
  it('never runs model work inline and answers immediately, even when the model hangs', async () => {
    const env = createDoorEnv()
    const packId = await startPack(env, 2)
    // Every model call hangs forever.
    const hang = () => new Promise<never>(() => {})
    env.gateway.json = hang as never
    env.gateway.visionJson = hang as never
    env.gateway.scene = hang as never
    const scheduled: Work[] = []
    const t0 = Date.now()
    const status = await Promise.race([
      env.service.pollStatus({ userId: USER_A, packId, schedule: (w) => { scheduled.push(w) } }),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 2_000)),
    ])
    expect(status).not.toBe('timeout')
    expect(Date.now() - t0).toBeLessThan(2_000)
    if (status === 'timeout') return
    expect(status).toMatchObject({ moreWork: true, backgroundKicked: true })
    expect(status.retryAfterSeconds).toBeGreaterThanOrEqual(10)
    expect(status.etaSeconds).toBeGreaterThan(0)
    expect(scheduled).toHaveLength(1)
    // Start the (hanging) background work: the next read still returns at once, no second loop.
    void scheduled[0]()
    const again = await Promise.race([
      env.service.pollStatus({ userId: USER_A, packId, schedule: (w) => { scheduled.push(w) } }),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 2_000)),
    ])
    expect(again).not.toBe('timeout')
    expect(scheduled).toHaveLength(1)
  })

  it('does not kick when another worker holds a lease', async () => {
    const env = createDoorEnv()
    const packId = await startPack(env, 2)
    const future = new Date(Date.now() + 60_000).toISOString()
    for (const i of env.store.items.values()) i.leaseUntil = future
    const scheduled: Work[] = []
    const status = await env.service.pollStatus({ userId: USER_A, packId, schedule: (w) => { scheduled.push(w) } })
    expect(status.leaseActive).toBe(true)
    expect(status.backgroundKicked).toBeUndefined()
    expect(scheduled).toHaveLength(0)
  })
})

describe('cron sweep resumes stale packs', () => {
  it('kicks only unleased packs with no recent progress, bounded per tick, and finishes them', async () => {
    const env = createDoorEnv()
    const stale1 = await startPack(env, 2)
    const stale2 = await startPack(env, 2)
    const stale3 = await startPack(env, 2)
    const fresh = await startPack(env, 2)
    const leased = await startPack(env, 2)
    const old = new Date(Date.now() - ADPACK_SWEEP_STALE_MS - 5_000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()
    for (const i of env.store.items.values()) {
      if (i.packId === fresh) continue
      i.updatedAt = old
      if (i.packId === leased) i.leaseUntil = future
    }
    const q = queue()
    const tick = await env.service.sweepStale({ schedule: q.schedule, limit: 2 })
    expect(tick.resumed).toHaveLength(2)
    expect(tick.resumed.every((id) => [stale1, stale2, stale3].includes(id))).toBe(true)
    await q.drain()
    for (const id of tick.resumed) expect(env.store.packs.get(id)!.status).toBe('done')

    // Next tick: the remaining stale pack; fresh and leased ones are left alone.
    const next = await env.service.sweepStale({ schedule: q.schedule, limit: 2 })
    expect(next.resumed).toEqual([[stale1, stale2, stale3].find((id) => !tick.resumed.includes(id))])
    await q.drain()
    expect(env.store.packs.get(fresh)!.status).toBe('planned')
    expect(env.store.packs.get(leased)!.status).toBe('planned')
    expect(env.charges).toHaveLength(6)
  })

  it('isStalePack: open items, no live lease, last update older than the window', () => {
    const now = Date.now()
    const item = (over: Record<string, unknown>) => ({ id: 'i', packId: 'p', index: 0, status: 'planned', angle: {}, renders: [], attempts: 0, generationId: 'g', updatedAt: new Date(now - ADPACK_SWEEP_STALE_MS - 1).toISOString(), ...over }) as never
    expect(isStalePack([item({})], now)).toBe(true)
    expect(isStalePack([item({ updatedAt: new Date(now).toISOString() })], now)).toBe(false)
    expect(isStalePack([item({ leaseUntil: new Date(now + 1000).toISOString() })], now)).toBe(false)
    expect(isStalePack([item({ status: 'done' })], now)).toBe(false)
  })
})

describe('lease safety', () => {
  it('overlapping workers (loop + sweep + another container) never charge an ad twice', async () => {
    const env = createDoorEnv()
    const packId = await startPack(env, 5)
    const q = queue()
    kickPackAdvance({ service: env.service, userId: USER_A, packId, schedule: q.schedule })
    // Another process (no shared registry) advances the same pack at the same time.
    await Promise.all([q.drain(), env.service.advance({ userId: USER_A, packId }), env.service.advance({ userId: USER_A, packId })])
    await env.service.advance({ userId: USER_A, packId })
    expect(env.store.packs.get(packId)!.status).toBe('done')
    const ids = env.charges.map((c) => c.generationId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(5)
    const status = await env.service.getStatus({ userId: USER_A, packId })
    expect(status.chargedCredits).toBe(5 * PER_AD)
  })
})
