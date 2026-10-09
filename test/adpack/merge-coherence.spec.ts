/**
 * Coherence of the v3 fidelity/copy work with the 0.14 reliability work (fakes only, no model calls):
 * - one plan (preview = quote/approval = start); identical-args approval reuse still detects PLAN_CHANGED;
 * - retry order: copy repair rounds → automatic item retry; a rejected ratio is re-plated per ratio and
 *   never consumes an item retry;
 * - a free ratio regeneration runs in the background (status stays a cheap read).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { advancePack, planPack, type AdvancePackInput } from '../../api/lib/adpack/pack-runner'
import { createAdPackService } from '../../api/lib/adpack/service'
import { createMemoryPackStore } from '../../api/lib/adpack/store-memory'
import type { OfferInput } from '../../api/lib/adpack/types'
import type { RenderInput } from '../../api/lib/adpack/runner-types'
import { caseById } from './helpers'
import { productOnWhite } from './fidelity-fixtures'
import { fakeCharge, fakeImageLoader, fakeRenderer, fakeStorage, runnerGateway, serumCopyFor } from './runner-fakes'
import { USER_A, callMcp, createDoorEnv, createMemoryMcpApprovalStore, serum } from './door-harness'
import { BIZ_A, PROD_A, fakeLibrary, fakeSavedBrandDb } from './saved-brand-fakes'
import { drainBackground, queueBackgroundWork, restoreBackgroundWork } from './background-queue'

beforeEach(() => queueBackgroundWork())
afterEach(() => restoreBackgroundWork())

function savedEnv() {
  const db = fakeSavedBrandDb()
  db.images.push(
    { id: 'img-hero', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/hero.jpg', kind: 'product', message_id: null, is_primary: true, tags: ['hero'], label: 'avión armado' },
    { id: 'img-box', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/box.jpg', kind: 'product', message_id: null, tags: ['caja'], label: 'caja' },
  )
  return { db, ...createDoorEnv({ savedBrandDb: db, library: fakeLibrary(db) }), approvalStore: createMemoryMcpApprovalStore() }
}

describe('one plan: preview → approval (plan + previewId) → start', () => {
  it('identical arguments reuse the open approval; a changed per-ad plan behind the same price is PLAN_CHANGED', async () => {
    const env = savedEnv()
    const base = { brandId: BIZ_A, offerId: PROD_A, size: 2 }
    const preview = await callMcp(env, USER_A, 'adpack_preview', base)
    expect(preview.isError).toBe(false)
    const previewId = String(preview.payload.previewId)
    const previewQuote = preview.payload.quote as { plan: unknown[]; planHash: string }
    expect(previewQuote.plan).toHaveLength(2)

    const args = { ...base, previewId }
    const first = await callMcp(env, USER_A, 'adpack_start', args)
    expect(first.payload.status).toBe('approval_required')
    // The approval shows the same plan the preview showed (one planner).
    expect(first.payload.plan).toEqual(previewQuote.plan)
    expect((first.payload.quote as { planHash: string }).planHash).toBe(previewQuote.planHash)
    const approvalRequestId = String(first.payload.approvalRequestId)
    const record = await env.approvalStore.findById(approvalRequestId)
    expect(record?.inputJson).toMatchObject({ previewId, planHash: previewQuote.planHash })

    // Identical re-quote → the same open approval.
    const again = await callMcp(env, USER_A, 'adpack_start', args)
    expect(again.payload).toMatchObject({ approvalRequestId, reused: true })
    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })

    // The owner swaps the hero photo: same args, same price, different per-ad plan (ad 1's photo).
    for (const img of env.db.images) {
      if (img.id === 'img-hero') Object.assign(img, { is_primary: false, tags: ['uso'] })
      if (img.id === 'img-box') Object.assign(img, { is_primary: true, tags: ['hero'] })
    }
    const requote = await callMcp(env, USER_A, 'adpack_start', args)
    expect(requote.payload.status).toBe('approval_required')
    expect(requote.payload.approvalRequestId).not.toBe(approvalRequestId)
    expect(requote.payload.reused).toBeUndefined()

    // The approved (old-plan) call runs nothing.
    const started = await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(started.payload).toMatchObject({ status: 'plan_changed', code: 'PLAN_CHANGED', reason: 'plan_changed', chargedCredits: 0 })
    expect([...env.store.packs.keys()]).not.toContain(approvalRequestId)
  })

  it('create_ads answers running + packId + eta + the approved plan', async () => {
    const env = savedEnv()
    const args = { brandId: BIZ_A, offerId: PROD_A, count: 2, heroRequired: true }
    const prompt = await callMcp(env, USER_A, 'create_ads', args)
    expect(prompt.payload.status).toBe('approval_required')
    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const started = await callMcp(env, USER_A, 'create_ads', { ...args, approvalRequestId })
    expect(started.payload).toMatchObject({ status: 'running', packId: approvalRequestId, etaSeconds: expect.any(Number), pollAfterSeconds: expect.any(Number), nextTool: 'adpack_status' })
    expect(started.payload.plan).toEqual(prompt.payload.plan)
    await drainBackground()
  })
})

describe('retry order: copy repair rounds → automatic item retry', () => {
  it('blocking copy left after the free repair rounds → one item retry with a new hook and the reason; delivered, charged once', async () => {
    const env = createDoorEnv({
      // The first attempt (generate + 2 repair rounds) keeps the forbidden phrase; the retry drops it.
      json: (input, i) => {
        const c = serumCopyFor(input.user)
        return i < 3 ? c : { ...c, cta: 'Escribinos', caption: c.caption.replace('Escribinos y pedí el tuyo.', 'Escribinos por WhatsApp.'), script: { ...c.script, cta: 'Escribinos por WhatsApp.' } }
      },
    })
    const started = await env.service.startPack({ userId: USER_A, dna: serum.dna, offer: serum.offer, size: 1, forbiddenPhrases: ['pedí el tuyo'], source: 'web' })
    await env.service.advance({ userId: USER_A, packId: started.packId })
    const status = await env.service.getStatus({ userId: USER_A, packId: started.packId })
    expect(status.status).toBe('done')
    // 3 calls (generate + 2 repair rounds) before the item retry; the retry passes on its first call.
    expect(env.gateway.jsonCalls).toHaveLength(4)
    expect(env.gateway.jsonCalls[3].user).toMatch(/REINTENTO 1/)
    const item = (await env.store.getPack(started.packId, USER_A))!.items[0]
    expect(item.angle.autoRetry).toMatchObject({ count: 1, history: [{ attempt: 1, mode: 'copy', error: expect.stringMatching(/^copy_check_failed/) }] })
    // The retry is a new angle variant: another hook, the rejected headline avoided.
    expect(item.angle.retry?.hookType).toBeDefined()
    expect(item.angle.retry?.hookType).not.toBe(item.angle.hookType)
    expect(item.angle.retry?.avoidHeadlines.length).toBeGreaterThan(0)
    expect(status.deliverable!.ads[0]).toMatchObject({ attempts: 2, attemptLog: [{ attempt: 1, mode: 'copy' }] })
    expect(env.charges).toHaveLength(1)
  })
})

const USER = '00000000-0000-4000-8000-000000000001'
const PACK_ID = '44444444-4444-4444-8444-444444444444'
const HERO = 'https://cdn.test/hero.jpg'

async function exactSetup(alter: (input: RenderInput, call: number) => boolean) {
  const serumCase = caseById('beauty-serum')
  const store = createMemoryPackStore()
  const offer: OfferInput = { ...serumCase.offer, productImageUrls: [HERO] }
  const planned = planPack({ dna: serumCase.dna, offer, size: 1, userId: USER, source: 'web', ids: { packId: PACK_ID }, render: { productFidelity: 'exact' } })
  await store.createPack(planned.pack, planned.items)
  const gateway = runnerGateway()
  const renderer = fakeRenderer({ alter })
  const storage = fakeStorage()
  const charge = fakeCharge()
  const loadImage = fakeImageLoader({ [HERO]: async () => new Uint8Array(await productOnWhite()) })
  const base: AdvancePackInput = { store, gateway, renderer, storage, charge, packId: PACK_ID, userId: USER, cutoutCache: memoryBlobCache(), loadImage }
  return { store, gateway, renderer, storage, charge, loadImage, advance: (extra: Partial<AdvancePackInput> = {}) => advancePack({ ...base, ...extra }), state: async () => (await store.getPack(PACK_ID, USER))! }
}

describe('per-ratio fidelity never consumes item retries', () => {
  it('a rejected ratio is re-plated once AT that ratio and delivered — no item retry, charged once', async () => {
    // 9:16 fails on the shared plate (its first render) and passes on its own plate.
    let tall = 0
    const t = await exactSetup((input) => input.ratio === '9:16' && ++tall === 1)
    const progress = await t.advance()
    expect(progress.status).toBe('done')
    const [item] = (await t.state()).items
    expect(item.renders.map((r) => r.ratio)).toEqual(['4:5', '9:16'])
    expect(item.renders[1].plateUrl).toMatch(/plate/)
    expect(item.rejectedRatios).toBeUndefined()
    expect(item.angle.autoRetry).toBeUndefined()
    // Shared plate + one plate generated AT 9:16.
    expect(t.gateway.sceneCalls).toHaveLength(2)
    expect(t.gateway.sceneCalls.at(-1)!.ratio).toBe('9:16')
    expect(t.charge.total()).toBe(1)
  })

  it('a ratio that still fails after its re-plate is listed (item delivered with ≥ 1 ratio, no item retry)', async () => {
    const t = await exactSetup((input) => input.ratio === '9:16')
    await t.advance()
    const [item] = (await t.state()).items
    expect(item.status).toBe('done')
    expect(item.renders.map((r) => r.ratio)).toEqual(['4:5'])
    expect(item.rejectedRatios?.map((r) => r.ratio)).toEqual(['9:16'])
    expect(item.angle.autoRetry).toBeUndefined()
    expect(t.charge.total()).toBe(1)
  })

  it('ratioReplate:false lists the ratio directly (no extra plate)', async () => {
    const t = await exactSetup((input) => input.ratio === '9:16')
    await t.advance({ ratioReplate: false })
    const [item] = (await t.state()).items
    expect(item.rejectedRatios?.map((r) => r.ratio)).toEqual(['9:16'])
    // Only the shared plate was generated.
    expect(t.gateway.sceneCalls).toHaveLength(1)
  })
})

describe('free ratio regeneration runs in the background', () => {
  it('regenerate {ratio} with a scheduler answers running at once; status shows it; the work lands later', async () => {
    let phase: 'advance' | 'regen' = 'advance'
    const t = await exactSetup((input) => input.ratio === '9:16' && (phase === 'advance' || typeof input.sceneImage === 'string'))
    await t.advance({ ratioReplate: false })
    const before = (await t.state()).items[0]
    expect(before.rejectedRatios?.[0].ratio).toBe('9:16')
    phase = 'regen'
    const service = createAdPackService({
      store: t.store, gateway: t.gateway, renderer: t.renderer, storage: t.storage, loadImage: t.loadImage,
      charge: async () => ({ charged: true }),
      checkCredits: async () => ({ allowed: false, remaining: 0 }),
    } as never)
    const queued: Array<() => Promise<void>> = []
    const renderCalls = t.renderer.calls.length
    const res = await service.regenerate({ userId: USER, packId: PACK_ID, itemId: before.id, ratio: '9:16', schedule: (work) => { queued.push(work) } })
    expect(res).toMatchObject({ status: 'running', ratio: { ratio: '9:16', status: 'running', delivered: false }, pollAfterSeconds: expect.any(Number), quote: { credits: 0 } })
    // Nothing rendered inside the request.
    expect(t.renderer.calls.length).toBe(renderCalls)
    expect(queued).toHaveLength(1)
    const running = await service.getStatus({ userId: USER, packId: PACK_ID })
    expect(running.regenerating).toEqual([expect.objectContaining({ itemId: before.id, index: 1, ratio: '9:16' })])
    expect(running.retryAfterSeconds).toBeGreaterThan(0)
    // A second request for the same ad while it runs is BUSY (no double plate).
    await expect(service.regenerate({ userId: USER, packId: PACK_ID, itemId: before.id, ratio: '9:16', schedule: (work) => { queued.push(work) } })).rejects.toThrow(/already being regenerated/)

    await queued[0]()
    const done = await service.getStatus({ userId: USER, packId: PACK_ID })
    expect(done.regenerating).toBeUndefined()
    const item = done.items[0]
    expect(item.renders.map((r) => r.ratio)).toEqual(['4:5', '9:16'])
    expect(item.rejectedRatios).toBeUndefined()
    expect(item.regenerating).toBeUndefined()
  })
})
