/**
 * v3 real-test fixes in the pack runner (fakes only, no model calls):
 * P0 #3 per-ratio delivery + AI-relight fallback + ratio-only regeneration; P1 #6 flat lay →
 * overhead plate; P1 #7 no fake hands in exact mode; P1 #8 hero usage + photo per ad.
 */
import { describe, expect, it } from 'vitest'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { advancePack, ensureHeroUsage, planPack, regenerateRatio, type AdvancePackInput } from '../../api/lib/adpack/pack-runner'
import { PERSON_FORMATS, resolvePackAngles } from '../../api/lib/adpack/plan-angles'
import { createAdPackService } from '../../api/lib/adpack/service'
import { buildStatusExtras } from '../../api/lib/adpack/status-summary'
import { createMemoryPackStore } from '../../api/lib/adpack/store-memory'
import { rowToItem } from '../../api/lib/adpack/store-supabase'
import type { OfferInput, PackRenderOptions, ProductPhoto } from '../../api/lib/adpack/types'
import type { RenderInput } from '../../api/lib/adpack/runner-types'
import { caseById } from './helpers'
import { partOnGray, productOnWhite } from './fidelity-fixtures'
import { flatLayWithWhitePieces } from './v3-fixtures'
import { fakeCharge, fakeImageLoader, fakeRenderer, fakeStorage, runnerGateway, type RunnerGatewayOptions } from './runner-fakes'

const USER = '00000000-0000-4000-8000-000000000001'
const PACK_ID = '33333333-3333-4333-8333-333333333333'
const serum = caseById('beauty-serum')
const HERO = 'https://cdn.test/hero.jpg'
const PART = 'https://cdn.test/gamepad.jpg'
const KIT = 'https://cdn.test/kit-flatlay.jpg'
const IN_USE = 'https://cdn.test/in-hand.jpg'

async function setup(opts: {
  size?: number
  offer?: Partial<OfferInput>
  render?: PackRenderOptions
  gateway?: RunnerGatewayOptions
  alter?: boolean | ((input: RenderInput, call: number) => boolean)
  relitAlters?: boolean
  heroRequired?: boolean
} = {}) {
  const store = createMemoryPackStore()
  const offer: OfferInput = { ...serum.offer, productImageUrls: [HERO], ...opts.offer }
  const planned = planPack({ dna: serum.dna, offer, size: opts.size ?? 1, userId: USER, source: 'web', ids: { packId: PACK_ID }, render: opts.render ?? { productFidelity: 'exact' }, ...(opts.heroRequired !== undefined ? { heroRequired: opts.heroRequired } : {}) })
  await store.createPack(planned.pack, planned.items)
  const gateway = runnerGateway(opts.gateway)
  const renderer = fakeRenderer({ alter: opts.alter, relitAlters: opts.relitAlters })
  const storage = fakeStorage()
  const charge = fakeCharge()
  const loadImage = fakeImageLoader({
    [HERO]: async () => new Uint8Array(await productOnWhite()),
    [PART]: async () => new Uint8Array(await partOnGray()),
    [KIT]: async () => new Uint8Array(await flatLayWithWhitePieces()),
    [IN_USE]: async () => new Uint8Array(await productOnWhite()),
  })
  const base: AdvancePackInput = { store, gateway, renderer, storage, charge, packId: PACK_ID, userId: USER, cutoutCache: memoryBlobCache(), loadImage }
  return { store, gateway, renderer, storage, charge, loadImage, planned, advance: () => advancePack(base), state: async () => (await store.getPack(PACK_ID, USER))! }
}

describe('P0 #3 per-ratio fidelity: deliver what passes, list what does not', () => {
  it('one ratio fails → the ad ships in the other, charged once, rejected ratio listed with reason + full-res diff', async () => {
    const t = await setup({ alter: (input) => input.ratio === '9:16' })
    const progress = await t.advance()
    expect(progress.status).toBe('done')
    const [item] = (await t.state()).items
    expect(item.status).toBe('done')
    expect(item.renders.map((r) => r.ratio)).toEqual(['4:5'])
    expect(item.renders[0].fidelity?.passed).toBe(true)
    expect(item.rejectedRatios).toHaveLength(1)
    expect(item.rejectedRatios![0]).toMatchObject({ ratio: '9:16', fidelity: { passed: false, ratio: '9:16' } })
    expect(item.rejectedRatios![0].reason).toMatch(/hue shift|ΔE|chroma|ssim|IoU/)
    expect(item.rejectedRatios![0].fidelity.diffImageUrl).toMatch(/fidelity-9x16/)
    // The rejected render was never uploaded as a deliverable.
    expect(t.storage.uploads.some((u) => u.kind === 'render-9x16')).toBe(false)
    expect(t.charge.total()).toBe(1)
    // Persisted inside scene_check (no migration) and read back.
    const row = { id: item.id, pack_id: PACK_ID, item_index: 0, status: item.status, angle: item.angle, renders: item.renders, attempts: 0, generation_id: item.generationId, scene_check: item.sceneCheck }
    expect(rowToItem(row).rejectedRatios?.[0].ratio).toBe('9:16')
    // Status: the deliverable lists the rejected ratio with its FREE regenerate call.
    const extras = buildStatusExtras({ packId: PACK_ID, status: 'done', items: [item], moreWork: false, language: 'es' })
    const ad = extras.deliverable!.ads[0]
    expect(ad.files.map((f) => f.ratio)).toEqual(['4:5'])
    expect(ad.rejectedRatios![0].retry.arguments).toEqual({ packId: PACK_ID, itemId: item.id, ratio: '9:16' })
    expect(ad.rejectedRatios![0].retry.call).toMatch(/"ratio":"9:16"/)
  })

  it('every ratio fails → the ad fails (not charged) and lists every ratio', async () => {
    const t = await setup({ alter: true })
    await t.advance()
    const [item] = (await t.state()).items
    expect(item.status).toBe('failed')
    expect(item.error).toMatch(/^fidelity_failed: .*\(4:5, 9:16\)$/)
    expect(item.rejectedRatios?.map((r) => r.ratio)).toEqual(['4:5', '9:16'])
    expect(t.charge.total()).toBe(0)
  })

  it("relight 'ai' changed the product on a ratio → that ratio is retried with 'auto' and delivered", async () => {
    const t = await setup({ render: { productFidelity: 'exact', relight: 'ai' }, gateway: { edit: true }, relitAlters: true })
    await t.advance()
    const [item] = (await t.state()).items
    expect(item.status).toBe('done')
    expect(item.renders.map((r) => r.ratio)).toEqual(['4:5', '9:16'])
    expect(item.renders.every((r) => r.fidelity?.passed && r.fidelity.relightFallback === 'auto')).toBe(true)
    // Each ratio: one AI attempt + one deterministic retry.
    expect(t.renderer.calls.filter((c) => c.relight).length).toBe(2)
    expect(t.renderer.calls.filter((c) => !c.relight).length).toBe(2)
    expect(item.rejectedRatios).toBeUndefined()
  })

  it('adpack_regenerate {ratio}: re-composite first; else a new plate for that ratio only — free, other ratios untouched', async () => {
    let phase: 'advance' | 'recomposite' | 'replate' = 'advance'
    const t = await setup({
      alter: (input) => input.ratio === '9:16' && (phase === 'advance' || (phase === 'replate' && typeof input.sceneImage === 'string')),
    })
    await t.advance()
    const before = (await t.state()).items[0]
    expect(before.rejectedRatios?.[0].ratio).toBe('9:16')
    const keep = before.renders[0]

    phase = 'replate'
    const sceneBefore = t.gateway.sceneCalls.length
    const res = await regenerateRatio({ store: t.store, gateway: t.gateway, renderer: t.renderer, storage: t.storage, packId: PACK_ID, itemId: before.id, userId: USER, ratio: '9:16', loadImage: t.loadImage })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res).toMatchObject({ delivered: true, method: 'replate', ratio: '9:16' })
    // One new plate, generated AT the ratio, for this ratio only.
    expect(t.gateway.sceneCalls.length).toBe(sceneBefore + 1)
    expect(t.gateway.sceneCalls.at(-1)!.ratio).toBe('9:16')
    const after = (await t.state()).items[0]
    expect(after.renders.map((r) => r.ratio)).toEqual(['4:5', '9:16'])
    expect(after.renders[0]).toEqual(keep)
    expect(after.renders[1].plateUrl).toMatch(/plate/)
    expect(after.rejectedRatios).toBeUndefined()
    expect(t.charge.total()).toBe(1) // charged once, with the ad

    // Recomposite path: the same plate passes again (no model call).
    phase = 'recomposite'
    const again = await regenerateRatio({ store: t.store, gateway: t.gateway, renderer: t.renderer, storage: t.storage, packId: PACK_ID, itemId: before.id, userId: USER, ratio: '9:16', loadImage: t.loadImage })
    expect(again.ok && again.method).toBe('recomposite')
    expect(t.gateway.sceneCalls.length).toBe(sceneBefore + 1)
  })

  it('service.regenerate({ ratio }) is free and refuses ratios the ad does not have', async () => {
    const t = await setup({ alter: (input, call) => input.ratio === '9:16' && call < 2 })
    await t.advance()
    const item = (await t.state()).items[0]
    const service = createAdPackService({
      store: t.store,
      gateway: t.gateway,
      renderer: t.renderer,
      storage: t.storage,
      loadImage: t.loadImage,
      charge: async () => ({ charged: true }),
      checkCredits: async () => ({ allowed: false, remaining: 0 }),
    } as never)
    const res = await service.regenerate({ userId: USER, packId: PACK_ID, itemId: item.id, ratio: '9:16' })
    expect(res.ratio).toMatchObject({ ratio: '9:16', delivered: true })
    expect(res.quote.credits).toBe(0)
    await expect(service.regenerate({ userId: USER, packId: PACK_ID, itemId: item.id, ratio: '16:9' })).rejects.toThrow(/not part of this ad/)
  })
})

describe('P1 #6 flat lay → overhead plate, never a perspective scene', () => {
  it('a contents (flat-lay) hero gets a top-down plate prompt, scene.view overhead and top-down compositing', async () => {
    const photos: ProductPhoto[] = [{ url: KIT, role: 'contents', label: 'contenido del kit' }]
    const t = await setup({ offer: { productImageUrls: [KIT], productPhotos: photos } })
    await t.advance()
    const [item] = (await t.state()).items
    expect(item.status, item.error).toBe('done')
    expect(item.scene?.view).toBe('overhead')
    expect(item.scene?.light).toBe('top')
    expect(item.scene?.cutouts?.[0]).toMatchObject({ role: 'contents', flatLay: true })
    expect(item.scene?.cutouts?.[0].recall).toBeGreaterThanOrEqual(0.95)
    const prompt = t.gateway.sceneCalls[0].prompt
    expect(prompt).toMatch(/straight top-down/)
    expect(prompt).toMatch(/NO horizon/)
    expect(prompt).not.toMatch(/in perspective/)
    expect(t.renderer.calls.every((c) => c.topDown === true)).toBe(true)
  })
})

describe('P1 #7 exact mode: no hand-held / person format without a real in-use photo', () => {
  it('the planner never plans handheld_overlay / ugc_person; an in-use photo re-enables them', () => {
    const offer: OfferInput = { ...serum.offer, productImageUrls: [HERO] }
    const exact = resolvePackAngles({ dna: serum.dna, offer, size: 12, productFidelity: 'exact' })
    expect(exact.some((a) => PERSON_FORMATS.has(a.format))).toBe(false)
    const withInUse = resolvePackAngles({ dna: serum.dna, offer: { ...offer, productPhotos: [{ url: HERO, role: 'hero' }, { url: IN_USE, role: 'in_use' }] }, size: 12, productFidelity: 'exact' })
    expect(withInUse.some((a) => PERSON_FORMATS.has(a.format))).toBe(true)
    const generated = resolvePackAngles({ dna: serum.dna, offer, size: 12, productFidelity: 'generated' })
    expect(generated.some((a) => PERSON_FORMATS.has(a.format))).toBe(true)
  })

  it('an explicitly selected hand-held angle is substituted (same count, same category/hook)', () => {
    const offer: OfferInput = { ...serum.offer, productImageUrls: [HERO] }
    const board = resolvePackAngles({ dna: serum.dna, offer, size: 12, productFidelity: 'generated' })
    const person = board.find((a) => PERSON_FORMATS.has(a.format))!
    const picked = [person.id, board.find((a) => !PERSON_FORMATS.has(a.format))!.id]
    const exact = resolvePackAngles({ dna: serum.dna, offer, angleIds: picked, productFidelity: 'exact' })
    expect(exact).toHaveLength(2)
    expect(exact.some((a) => PERSON_FORMATS.has(a.format))).toBe(false)
    expect(exact[0].hookType).toBe(person.hookType)
    expect(exact[0].category).toBe(person.category)
    expect(exact[0].rationale).toMatch(/en mano reemplazado|hand-held format replaced/)
  })
})

describe('P1 #8 hero usage + photo per ad', () => {
  it('the hero photo is guaranteed in the first ad; heroRequired:false keeps the format pick; per-ad picks win', () => {
    const offer: OfferInput = { ...serum.offer, productImageUrls: [KIT, HERO], productPhotos: [{ url: KIT, role: 'contents' }, { url: HERO, role: 'hero', id: 'img-hero' }] }
    expect(ensureHeroUsage(offer, 2).productImageUrlsByAd).toEqual({ '0': [HERO] })
    expect(ensureHeroUsage(offer, 2, false).productImageUrlsByAd).toBeUndefined()
    const picked = { ...offer, productImageUrlsByAd: { '0': [KIT], '1': [HERO] } }
    expect(ensureHeroUsage(picked, 2).productImageUrlsByAd).toEqual(picked.productImageUrlsByAd)
    const ad0Kit = { ...offer, productImageUrlsByAd: { '0': [KIT] } }
    expect(ensureHeroUsage(ad0Kit, 2).productImageUrlsByAd).toEqual({ '0': [KIT], '1': [HERO] })
  })

  it('each ad reports the photo it used (productImageId, url, role, label) — the hero appears even when formats prefer the kit', async () => {
    const t = await setup({
      size: 2,
      offer: { productImageUrls: [KIT, HERO], productPhotos: [{ url: KIT, role: 'contents', id: 'img-kit', label: 'kit' }, { url: HERO, role: 'hero', id: 'img-hero', label: 'avión armado' }] },
    })
    await t.advance()
    const { items } = await t.state()
    expect(items.every((i) => i.status === 'done')).toBe(true)
    const extras = buildStatusExtras({ packId: PACK_ID, status: 'done', items, moreWork: false, language: 'es' })
    const photos = extras.deliverable!.ads.map((a) => a.photo)
    expect(photos[0]).toEqual({ url: HERO, role: 'hero', productImageId: 'img-hero', label: 'avión armado' })
    expect(photos.every((p) => p && p.url && p.role)).toBe(true)
  })
})
