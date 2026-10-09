import { describe, expect, it } from 'vitest'
import { CREDIT_WEIGHTS } from '../../api/lib/credits/catalog'
import {
  advancePack,
  editItemText,
  itemGenerationId,
  planPack,
  quotePack,
  regenerateItem,
  type AdvancePackInput,
} from '../../api/lib/adpack/pack-runner'
import { SCENE_SETTINGS } from '../../api/lib/adpack/scene'
import { createMemoryPackStore, type MemoryPackStore } from '../../api/lib/adpack/store-memory'
import type { OfferInput } from '../../api/lib/adpack/types'
import { caseById } from './helpers'
import {
  PRODUCT_REF,
  fakeCharge,
  fakeRenderer,
  fakeStorage,
  propFor,
  runnerGateway,
  type RunnerGatewayOptions,
} from './runner-fakes'

const USER = '00000000-0000-4000-8000-000000000001'
const PACK_ID = '11111111-1111-4111-8111-111111111111'
const serum = caseById('beauty-serum')

async function setup(opts: { size?: number; offer?: Partial<OfferInput>; gateway?: RunnerGatewayOptions; chargeDelayMs?: number; store?: MemoryPackStore } = {}) {
  const store = opts.store ?? createMemoryPackStore()
  const offer = { ...serum.offer, ...opts.offer }
  const planned = planPack({ dna: serum.dna, offer, size: opts.size ?? 10, userId: USER, source: 'web', ids: { packId: PACK_ID } })
  await store.createPack(planned.pack, planned.items)
  const gateway = runnerGateway(opts.gateway)
  const renderer = fakeRenderer()
  const storage = fakeStorage()
  const charge = fakeCharge(opts.chargeDelayMs)
  const base: AdvancePackInput = { store, gateway, renderer, storage, charge, packId: PACK_ID, userId: USER }
  const advance = (extra: Partial<AdvancePackInput> = {}) => advancePack({ ...base, ...extra })
  const state = async () => (await store.getPack(PACK_ID, USER))!
  return { store, gateway, renderer, storage, charge, planned, advance, state }
}

describe('planPack / quotePack', () => {
  it('plans N items with deterministic generation ids and quotes image_standard per ad', () => {
    const a = planPack({ dna: serum.dna, offer: serum.offer, userId: USER, source: 'web', ids: { packId: PACK_ID } })
    const b = planPack({ dna: serum.dna, offer: serum.offer, userId: USER, source: 'mcp', ids: { packId: PACK_ID } })
    expect(a.items).toHaveLength(10)
    expect(a.items.map((i) => i.generationId)).toEqual(b.items.map((i) => i.generationId))
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id))
    expect(new Set(a.items.map((i) => i.generationId)).size).toBe(10)
    expect(a.items[3].generationId).toBe(itemGenerationId(PACK_ID, 3))
    expect(a.items[3].generationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a.pack.ratios).toEqual(['4:5', '9:16'])
    expect(quotePack(10)).toEqual({ credits: 10 * CREDIT_WEIGHTS.image_standard, perAd: CREDIT_WEIGHTS.image_standard })
    expect(a.pack.quotedCredits).toBe(quotePack(10).credits)
  })
})

describe('advancePack', () => {
  it('completes a full pack of 10 (copy → scene → check → 3 renders → charge)', async () => {
    const t = await setup()
    const progress = await t.advance()
    expect(progress.status).toBe('done')
    expect(progress.done).toBe(10)
    expect(progress.counts.failed).toBe(0)
    const { pack, items } = await t.state()
    expect(pack.status).toBe('done')
    for (const item of items) {
      expect(item.status).toBe('done')
      expect(item.renders.map((r) => r.ratio)).toEqual(['4:5', '9:16'])
      expect(item.scene?.imageUrl).toContain(`/adpack/${PACK_ID}/${item.index}-scene-`)
      expect(item.leaseUntil).toBeUndefined()
      expect(item.chargedAt).toBeTruthy()
      expect(item.costUsd).toBeGreaterThan(0)
      expect(item.timings?.copyMs).toBeTypeOf('number')
      expect(item.timings?.renderMs).toBeTypeOf('number')
    }
    expect(t.gateway.sceneCalls).toHaveLength(10)
    expect(t.gateway.sceneCalls.every((c) => c.ratio === '9:16' && c.draft)).toBe(true)
    expect(t.renderer.calls).toHaveLength(20)
    expect(t.charge.total()).toBe(10)
    expect(progress.costUsd).toBeGreaterThan(0)
  })

  it('reports partial success when 2 items always fail their scenes', async () => {
    const failing = [propFor(3), propFor(6)]
    const t = await setup({ gateway: { sceneFails: (p) => failing.some((w) => p.includes(w)) } })
    const progress = await t.advance()
    expect(progress.status).toBe('partial')
    expect(progress.done).toBe(8)
    expect(progress.failed).toBe(2)
    const { items } = await t.state()
    const failed = items.filter((i) => i.status === 'failed')
    expect(failed.map((i) => i.index).sort()).toEqual([3, 6])
    for (const f of failed) {
      expect(f.error).toMatch(/^scene_failed/)
      expect(f.sceneAttempts).toBe(3)
      expect(t.charge.counts.get(f.generationId)).toBeUndefined()
    }
    expect(t.charge.total()).toBe(8)
  })

  it('by default uses no style anchor and rotates the setting between same-format ads', async () => {
    const t = await setup({ gateway: { delayMs: 5 } })
    await t.advance({ concurrency: 4 })
    const calls = t.gateway.sceneCalls
    expect(calls).toHaveLength(10)
    for (const c of calls) expect(c.styleRefs ?? []).toEqual([])
    const { items } = await t.state()
    const byFormat = new Map<string, string[]>()
    for (const it of items) {
      const call = calls.find((c) => c.prompt.includes(propFor(it.index)))!
      const setting = call.prompt.split('\n').find((l) => l.startsWith('Setting for this ad:'))!
      byFormat.set(it.angle.format, [...(byFormat.get(it.angle.format) ?? []), setting])
    }
    for (const [format, settings] of byFormat) {
      const distinct = Math.min(settings.length, SCENE_SETTINGS[format as keyof typeof SCENE_SETTINGS].length)
      expect(new Set(settings).size).toBe(distinct)
    }
  })

  it('settles the style anchor (index 0) before any other scene and passes it as a style ref (opt-in)', async () => {
    const t = await setup({ gateway: { delayMs: 5 } })
    await t.advance({ concurrency: 4, styleAnchor: true })
    const calls = t.gateway.sceneCalls
    expect(calls[0].prompt).toContain(propFor(0))
    expect(calls[0].styleRefs).toEqual([])
    const { items } = await t.state()
    const anchorUrl = items[0].scene!.imageUrl
    const anchorEnd = calls[0].endedAt!
    for (const c of calls.slice(1)) {
      expect(c.styleRefs).toEqual([anchorUrl])
      expect(c.startedAt).toBeGreaterThanOrEqual(anchorEnd)
    }
  })

  it('regenerates a scene when the product does not match the reference (≤ 2 retries)', async () => {
    const t = await setup({
      size: 1,
      offer: { productImageUrls: [PRODUCT_REF] },
      gateway: { vision: (i) => ({ productMatches: i >= 1, strayText: false, headlineSpace: true, score: i >= 1 ? 0.9 : 0.3 }) },
    })
    await t.advance()
    const [item] = (await t.state()).items
    expect(item.status).toBe('done')
    expect(item.sceneAttempts).toBe(2)
    expect(item.sceneCheck?.productMatches).toBe(true)
    expect(t.gateway.sceneCalls).toHaveLength(2)
    expect(t.gateway.sceneCalls[0].refs).toEqual([PRODUCT_REF])
    expect(t.gateway.sceneCalls[1].prompt).toMatch(/previous attempt changed the product/)
    expect(t.gateway.visionCalls[0].images).toHaveLength(2)
  })

  it('fails an item whose product never matches after 2 retries', async () => {
    const t = await setup({
      size: 1,
      offer: { productImageUrls: [PRODUCT_REF] },
      gateway: { vision: () => ({ productMatches: false, strayText: false, score: 0.2 }) },
    })
    const progress = await t.advance()
    expect(progress.status).toBe('failed')
    const [item] = (await t.state()).items
    expect(item.status).toBe('failed')
    expect(item.error).toMatch(/scene_product_mismatch/)
    // 3 scene attempts per run × (1 + 2 automatic retries inside the approval, #16).
    expect(t.gateway.sceneCalls).toHaveLength(9)
    expect(item.angle.retry).toMatchObject({ count: 2, history: [{ attempt: 1, mode: 'scene' }, { attempt: 2, mode: 'scene' }] })
    expect(t.charge.total()).toBe(0)
  })

  it('#16: a failed ad is retried automatically inside the approval, delivered and charged once', async () => {
    let checks = 0
    const t = await setup({
      size: 1,
      offer: { productImageUrls: [PRODUCT_REF] },
      // The first run's 3 scene checks reject the product; the automatic retry passes.
      gateway: { vision: () => (++checks <= 3 ? { productMatches: false, strayText: false, score: 0.2 } : { productMatches: true, strayText: false, score: 0.9 }) },
    })
    const progress = await t.advance()
    expect(progress.status).toBe('done')
    const [item] = (await t.state()).items
    expect(item.status).toBe('done')
    expect(item.angle.retry).toMatchObject({ count: 1, history: [{ attempt: 1, mode: 'scene', error: expect.stringMatching(/^scene_product_mismatch/) }] })
    expect(t.charge.total()).toBe(1)
    expect(t.charge.counts.get(item.generationId)).toBe(1)
  })

  it('#16: maxAutoRetries 0 reports the first failure (no retry)', async () => {
    const t = await setup({
      size: 1,
      offer: { productImageUrls: [PRODUCT_REF] },
      gateway: { vision: () => ({ productMatches: false, strayText: false, score: 0.2 }) },
    })
    await t.advance({ maxAutoRetries: 0 })
    const [item] = (await t.state()).items
    expect(item.status).toBe('failed')
    expect(item.angle.retry).toBeUndefined()
    expect(t.gateway.sceneCalls).toHaveLength(3)
  })

  it('charges each item exactly once across repeated and concurrent advance calls', async () => {
    const t = await setup({ gateway: { delayMs: 2 }, chargeDelayMs: 3 })
    await Promise.all([t.advance({ concurrency: 3 }), t.advance({ concurrency: 3 })])
    for (let i = 0; i < 5; i++) {
      const p = await t.advance()
      if (p.status === 'done') break
    }
    await t.advance()
    const { items, pack } = await t.state()
    expect(pack.status).toBe('done')
    expect(t.charge.total()).toBe(10)
    for (const item of items) expect(t.charge.counts.get(item.generationId)).toBe(1)
    expect(t.gateway.sceneCalls).toHaveLength(10)
  })

  it('reclaims items whose lease expired (crashed worker)', async () => {
    let clock = Date.now()
    const store = createMemoryPackStore({ now: () => clock })
    const t = await setup({ store })
    const stolen = await store.leaseItems(PACK_ID, 10, 60_000)
    expect(stolen).toHaveLength(10)
    const blocked = await t.advance()
    expect(blocked.done).toBe(0)
    expect(t.gateway.totalCalls()).toBe(0)
    clock += 120_000
    const resumed = await t.advance()
    expect(resumed.status).toBe('done')
    expect(t.charge.total()).toBe(10)
  })

  it('respects budgetMs: stops leasing new work and resumes on the next call', async () => {
    const t = await setup({ gateway: { delayMs: 25 } })
    const first = await t.advance({ budgetMs: 40, concurrency: 1 })
    expect(first.stoppedForBudget).toBe(true)
    expect(first.done).toBeLessThan(10)
    const mid = await t.state()
    for (const item of mid.items) expect(item.leaseUntil).toBeUndefined()
    // Item 0 was the only one touched (concurrency 1, lowest index first).
    expect(mid.items.slice(1).every((i) => i.status === 'planned')).toBe(true)
    const second = await t.advance({ budgetMs: 60_000 })
    expect(second.status).toBe('done')
    expect(t.charge.total()).toBe(10)
  })
})

describe('editItemText', () => {
  it('re-renders with the new text, no model calls and no credits', async () => {
    const t = await setup({ size: 2 })
    await t.advance()
    const before = await t.state()
    const item = before.items[1]
    const calls = t.gateway.totalCalls()
    const renders = t.renderer.calls.length
    const res = await editItemText({
      store: t.store,
      renderer: t.renderer,
      storage: t.storage,
      packId: PACK_ID,
      itemId: item.id,
      userId: USER,
      copyPatch: { headline: 'Tu piel, más pareja', cta: 'Pedí el tuyo' },
    })
    expect(res.ok).toBe(true)
    expect(t.gateway.totalCalls()).toBe(calls)
    expect(t.charge.total()).toBe(2)
    expect(t.renderer.calls.length).toBe(renders + 2)
    expect(t.renderer.calls.at(-1)!.copy.headline).toBe('Tu piel, más pareja')
    const after = (await t.state()).items[1]
    expect(after.copy?.headline).toBe('Tu piel, más pareja')
    expect(after.status).toBe('done')
    expect(after.renders.map((r) => r.imageUrl)).not.toEqual(item.renders.map((r) => r.imageUrl))
  })

  it('rejects an unconfirmed price and does not re-render', async () => {
    const t = await setup({ size: 1 })
    await t.advance()
    const item = (await t.state()).items[0]
    const renders = t.renderer.calls.length
    const res = await editItemText({
      store: t.store,
      renderer: t.renderer,
      storage: t.storage,
      packId: PACK_ID,
      itemId: item.id,
      userId: USER,
      copyPatch: { headline: 'Ahora solo ₡9.900' },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('copy_rejected')
      expect(res.issues?.some((i) => i.code === 'number_mismatch' || i.code === 'unconfirmed_fact')).toBe(true)
    }
    expect(t.renderer.calls.length).toBe(renders)
    expect((await t.state()).items[0].copy?.headline).toBe(item.copy?.headline)
  })
})

describe('regenerateItem', () => {
  it('scene mode keeps copy, new generation id, charged once more', async () => {
    const t = await setup({ size: 3 })
    await t.advance()
    const item = (await t.state()).items[2]
    const json = t.gateway.jsonCalls.length
    const res = await regenerateItem({ store: t.store, packId: PACK_ID, itemId: item.id, userId: USER, mode: 'scene' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.item.status).toBe('copy_ready')
    expect(res.item.attempts).toBe(1)
    expect(res.item.generationId).toBe(itemGenerationId(PACK_ID, 2, 1))
    expect(res.item.generationId).not.toBe(item.generationId)
    expect((await t.state()).pack.status).toBe('running')
    const p = await t.advance()
    expect(p.status).toBe('done')
    expect(t.gateway.jsonCalls.length).toBe(json)
    expect(t.gateway.sceneCalls).toHaveLength(4)
    expect(t.charge.counts.get(res.item.generationId)).toBe(1)
    expect(t.charge.counts.get(item.generationId)).toBe(1)
    await t.advance()
    expect(t.charge.total()).toBe(4)
  })

  it('copy mode resets to planned and writes new copy', async () => {
    const t = await setup({ size: 2 })
    await t.advance()
    const item = (await t.state()).items[1]
    const json = t.gateway.jsonCalls.length
    const res = await regenerateItem({ store: t.store, packId: PACK_ID, itemId: item.id, userId: USER, mode: 'copy' })
    expect(res.ok && res.item.status).toBe('planned')
    const mid = (await t.state()).items[1]
    expect(mid.copy).toBeUndefined()
    expect(mid.renders).toEqual([])
    await t.advance()
    expect(t.gateway.jsonCalls.length).toBe(json + 1)
    expect((await t.state()).items[1].status).toBe('done')
    expect(t.charge.counts.get(itemGenerationId(PACK_ID, 1, 1))).toBe(1)
  })
})
