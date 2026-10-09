/**
 * WS1 (exact product fidelity) × WS2 (saved offer data) × WS4 (resize / status / approvals) wiring.
 *
 * 1. ad_profile lock / immutableAttributes / allowedProps + tagged/primary photos → pack options & productPhotos.
 * 2. adpack_resize re-composites the stored plate + cut-outs (fidelity kept), falls back to the stored scene.
 * 3. Status / deliverable carry WS4 fields AND WS1 fidelity per ad / file.
 * 4. Quote: productFidelity is free; relight (an extra image-edit call) is priced, PLAN_CHANGED stays exact.
 */
import { describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../../api/lib/usage-logger'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { roleFromImageRow } from '../../api/lib/adpack/fidelity/photos'
import { advancePack, offerForItem, planPack, quotePack, relightGenerationId, resizeItem, type AdvancePackInput } from '../../api/lib/adpack/pack-runner'
import { buildDnaFromSavedBrand } from '../../api/lib/adpack/saved-brand'
import { adPackPlanSummary, createAdPackService, resolveRenderOptions } from '../../api/lib/adpack/service'
import { buildStatusExtras } from '../../api/lib/adpack/status-summary'
import { createMemoryPackStore } from '../../api/lib/adpack/store-memory'
import type { OfferInput, PackRenderOptions } from '../../api/lib/adpack/types'
import { createMcpWorld } from '../helpers/mcp-world'
import { caseById } from './helpers'
import { USER_A } from './door-harness'
import { BIZ_A, PROD_A } from './saved-brand-fakes'
import { productOnWhite } from './fidelity-fixtures'
import { fakeCharge, fakeImageLoader, fakeRenderer, fakeStorage, runnerGateway } from './runner-fakes'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

const USER = '00000000-0000-4000-8000-000000000001'
const PACK_ID = '33333333-3333-4333-8333-333333333333'
const serum = caseById('beauty-serum')
const HERO = 'https://cdn.test/hero.jpg'
const ALT = 'https://cdn.test/alt-hero.jpg'

async function loader() {
  const bytes = async () => new Uint8Array(await productOnWhite())
  return fakeImageLoader({ [HERO]: bytes, [ALT]: bytes })
}

async function setup(opts: { size?: number; offer?: Partial<OfferInput>; render?: PackRenderOptions } = {}) {
  const store = createMemoryPackStore()
  const offer: OfferInput = { ...serum.offer, productImageUrls: [HERO], ...opts.offer }
  const planned = planPack({ dna: serum.dna, offer, size: opts.size ?? 1, userId: USER, source: 'web', ids: { packId: PACK_ID }, render: opts.render ?? { productFidelity: 'exact' } })
  await store.createPack(planned.pack, planned.items)
  const renderer = fakeRenderer()
  const storage = fakeStorage()
  const charge = fakeCharge()
  const loadImage = await loader()
  const base: AdvancePackInput = { store, gateway: runnerGateway(), renderer, storage, charge, packId: PACK_ID, userId: USER, cutoutCache: memoryBlobCache(), loadImage }
  return { store, renderer, storage, charge, loadImage, planned, advance: () => advancePack(base), state: async () => (await store.getPack(PACK_ID, USER))! }
}

describe('1 · saved offer data feeds the exact pipeline', () => {
  it('085 tags / primary → fidelity roles (part wins, then primary/hero, caja, contenido-kit, en-uso, detalle)', () => {
    expect(roleFromImageRow({ tags: ['part', 'hero'] })).toBe('part')
    expect(roleFromImageRow({ is_primary: true, tags: ['caja'] })).toBe('hero')
    expect(roleFromImageRow({ tags: ['caja'] })).toBe('box')
    expect(roleFromImageRow({ tags: ['contenido-kit'] })).toBe('contents')
    expect(roleFromImageRow({ tags: ['en-uso'] })).toBe('in_use')
    expect(roleFromImageRow({ tags: ['detalle'] })).toBe('detail')
    expect(roleFromImageRow({ tags: [] , is_primary: false })).toBeUndefined()
  })

  it('ad_profile lock + immutableAttributes + allowedProps and tagged photos reach the offer', async () => {
    const world = createMcpWorld()
    const product = world.db.products.find((p) => p.id === PROD_A)!
    product.ad_profile = { lockProductAppearance: true, immutableAttributes: ['hélices blancas'], allowedProps: ['caja del kit'] }
    world.db.images.find((i) => i.id === 'img-prod')!.is_primary = true
    world.db.images.push(
      { id: 'img-ctrl', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/control.jpg', kind: 'product', message_id: null, tags: ['part'], role: 'control' },
      { id: 'img-box', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/box.jpg', kind: 'product', message_id: null, tags: ['caja'] },
      { id: 'img-kit', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/kit.jpg', kind: 'product', message_id: null, tags: ['contenido-kit'] },
      { id: 'img-use', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/use.jpg', kind: 'product', message_id: null, tags: ['en-uso'] },
    )
    const { offer } = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    expect(offer).toMatchObject({ lockProductAppearance: true, immutableAttributes: ['hélices blancas'], allowedProps: ['caja del kit'] })
    const roles = Object.fromEntries((offer.productPhotos ?? []).map((p) => [p.url, p.role]))
    expect(roles).toMatchObject({
      'https://cdn.example/serum.jpg': 'hero',
      'https://cdn.example/control.jpg': 'part',
      'https://cdn.example/box.jpg': 'box',
      'https://cdn.example/kit.jpg': 'contents',
      'https://cdn.example/use.jpg': 'in_use',
    })
    // Primary first (orderProductImages), the free role labels the part.
    expect(offer.productPhotos?.[0]).toMatchObject({ url: 'https://cdn.example/serum.jpg', role: 'hero' })
    expect(offer.productPhotos?.find((p) => p.role === 'part')?.label).toBe('control')

    // Lock forces exact (a request for 'generated' is upgraded), ad_profile lists become pack options.
    const render = resolveRenderOptions({ productFidelity: 'generated' }, offer)
    expect(render).toEqual({ productFidelity: 'exact', allowedProps: ['caja del kit'], immutableAttributes: ['hélices blancas'] })
  })

  it('a locked offer without a product photo is refused, never silently generated', () => {
    const offer: OfferInput = { ...serum.offer, productImageUrls: [], productLock: { lockProductAppearance: true, immutableAttributes: [], allowedProps: [] } }
    expect(() => resolveRenderOptions({}, offer)).toThrow(/lockProductAppearance/)
    // Raw offers (dna + offer door) carrying productLock use its lists too.
    const withPhoto: OfferInput = { ...serum.offer, productImageUrls: [HERO], productLock: { lockProductAppearance: false, immutableAttributes: ['tapa dorada'], allowedProps: [] } }
    expect(resolveRenderOptions({ productFidelity: 'generated' }, withPhoto)).toEqual({ productFidelity: 'generated', immutableAttributes: ['tapa dorada'] })
  })

  it('productImageIdsByAd picks the hero per ad; kit parts of the pool stay available', () => {
    const offer: OfferInput = {
      ...serum.offer,
      productImageUrls: [HERO, ALT, 'https://cdn.test/part.jpg'],
      productPhotos: [{ url: HERO, role: 'hero' }, { url: ALT, role: 'in_use' }, { url: 'https://cdn.test/part.jpg', role: 'part', label: 'control' }],
      productImageUrlsByAd: { 1: [ALT] },
    }
    expect(offerForItem(offer, 0)).toBe(offer)
    expect(offerForItem(offer, 1).productPhotos).toEqual([{ url: ALT, role: 'hero' }, { url: 'https://cdn.test/part.jpg', role: 'part', label: 'control' }])
  })

  it('runner: the per-ad photo becomes that ad\'s cut-out hero (even when the format prefers another role)', async () => {
    const t = await setup({
      size: 2,
      offer: { productImageUrls: [HERO, ALT], productPhotos: [{ url: HERO, role: 'hero' }, { url: ALT, role: 'in_use' }], productImageUrlsByAd: { 1: [ALT] } },
    })
    await t.advance()
    const { items } = await t.state()
    const byIndex = new Map(items.map((i) => [i.index, i]))
    expect(byIndex.get(0)?.scene?.cutouts?.[0]).toMatchObject({ sourceUrl: HERO, role: 'hero' })
    expect(byIndex.get(1)?.scene?.cutouts?.[0]).toMatchObject({ sourceUrl: ALT, role: 'hero' })
    expect(items.every((i) => i.status === 'done' && i.fidelity?.passed)).toBe(true)
  })
})

describe('2 · free resize keeps the real product', () => {
  it('exact ads re-composite the stored plate + cut-out: new ratios scored, text box planned around the product', async () => {
    const t = await setup()
    await t.advance()
    const item = (await t.state()).items[0]
    expect(item.renders.map((r) => r.ratio)).toEqual(['4:5', '9:16'])
    const calls = t.renderer.calls.length
    const res = await resizeItem({ store: t.store, renderer: t.renderer, storage: t.storage, packId: PACK_ID, itemId: item.id, userId: USER, ratios: ['1:1', '16:9'], loadImage: t.loadImage })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.method).toBe('composite')
    expect(res.added).toEqual(['1:1', '16:9'])
    const fresh = t.renderer.calls.slice(calls)
    expect(fresh.map((c) => c.ratio)).toEqual(['1:1', '16:9'])
    expect(fresh.every((c) => c.productMode === 'exact' && c.productCutout instanceof Uint8Array && c.sceneImage === item.scene?.imageUrl)).toBe(true)
    // Stored cut-out URL reloaded (no model calls, no relight).
    expect(t.loadImage.calls).toContain(item.scene?.cutouts?.[0].url)
    for (const r of res.item.renders.filter((x) => x.ratio === '1:1' || x.ratio === '16:9')) expect(r.fidelity).toMatchObject({ passed: true, method: 'composite' })
  })

  it('a new ratio whose product does not survive is not delivered', async () => {
    const t = await setup()
    await t.advance()
    const item = (await t.state()).items[0]
    const res = await resizeItem({ store: t.store, renderer: fakeRenderer({ alter: true }), storage: t.storage, packId: PACK_ID, itemId: item.id, userId: USER, ratios: ['1:1'], loadImage: t.loadImage })
    expect(res.ok && res.added).toEqual([])
    expect(res.ok && res.rejected?.[0]).toMatchObject({ ratio: '1:1', fidelity: { passed: false } })
    expect((await t.state()).items[0].renders.map((r) => r.ratio)).toEqual(['4:5', '9:16'])
  })

  it('no stored cut-outs → re-render from the stored final scene, fidelity.method generated; a bare plate is refused', async () => {
    const t = await setup({ render: { productFidelity: 'generated' } })
    await t.advance()
    const item = (await t.state()).items[0]
    const res = await resizeItem({ store: t.store, renderer: t.renderer, storage: t.storage, packId: PACK_ID, itemId: item.id, userId: USER, ratios: ['1:1'] })
    expect(res.ok && res.method).toBe('scene')
    expect(res.ok && res.item.renders.find((r) => r.ratio === '1:1')?.fidelity).toMatchObject({ method: 'generated', ssim: null, deltaE: null })

    const x = await setup()
    await x.advance()
    const plate = (await x.state()).items[0]
    await x.store.updateItem(plate.id, { scene: { ...plate.scene!, cutouts: [] } })
    const refused = await resizeItem({ store: x.store, renderer: x.renderer, storage: x.storage, packId: PACK_ID, itemId: plate.id, userId: USER, ratios: ['1:1'], loadImage: x.loadImage })
    expect(refused).toEqual({ ok: false, error: 'cutout_missing' })
  })
})

describe('3 · status / deliverable carry WS4 fields and WS1 fidelity', () => {
  it('files[] (with per-file fidelity), forbiddenHits, ad fidelity, summary; failures keep the retry call + fidelity', async () => {
    const t = await setup({ size: 2 })
    await t.advance()
    const { items } = await t.state()
    const failed = { ...items[1], status: 'failed' as const, renders: [], error: 'fidelity_failed: ssim 0.4 / ΔE 30 (4:5)', fidelity: { score: 0.3, ssim: 0.4, deltaE: 30, passed: false, method: 'composite' as const } }
    const extras = buildStatusExtras({ packId: PACK_ID, status: 'partial', items: [items[0], failed], moreWork: false, language: 'es', dna: serum.dna })
    expect(extras.summary).toBeTruthy()
    const ad = extras.deliverable!.ads[0]
    expect(ad.forbiddenHits).toEqual([])
    expect(ad.fidelity).toMatchObject({ passed: true, method: 'composite' })
    expect(ad.files.map((f) => f.ratio)).toEqual(['4:5', '9:16'])
    for (const f of ad.files) expect(f).toMatchObject({ format: 'png', fidelity: { passed: true, method: 'composite' } })
    expect(extras.failures?.[0]).toMatchObject({
      index: 2,
      reason: 'el producto no quedó idéntico a la foto',
      retry: { tool: 'adpack_regenerate', arguments: { mode: 'scene' } },
      fidelity: { passed: false, method: 'composite' },
    })
  })
})

describe('4 · quote / approval: relight is priced, productFidelity is not', () => {
  const service = () => {
    const store = createMemoryPackStore()
    return {
      store,
      svc: createAdPackService({
        store,
        gateway: runnerGateway(),
        renderer: fakeRenderer(),
        storage: fakeStorage(),
        async charge() { return { charged: true } },
        async checkCredits() { return { allowed: true, remaining: 9999 } },
      }),
    }
  }
  const offer = { ...serum.offer, productImageUrls: [HERO] }

  it('quote: exact vs generated cost the same; relight adds one image unit per ad (exact only)', async () => {
    const { svc } = service()
    const base = await svc.quote({ size: 3, dna: serum.dna, offer })
    expect((await svc.quote({ size: 3, dna: serum.dna, offer, productFidelity: 'generated' })).credits).toBe(base.credits)
    const relit = await svc.quote({ size: 3, dna: serum.dna, offer, relight: true })
    expect(relit).toMatchObject({ size: 3, relight: true, credits: base.credits * 2, perAd: base.perAd * 2 })
    // Relight is dropped in generated mode → no surcharge.
    expect((await svc.quote({ size: 3, dna: serum.dna, offer, productFidelity: 'generated', relight: true })).credits).toBe(base.credits)
    expect(quotePack(3, { relight: true }).credits).toBe(adPackPlanSummary(3, { relight: true }).total)
  })

  it('PLAN_CHANGED when relight was not part of the approved price; matching approval runs', async () => {
    const { svc, store } = service()
    const plain = adPackPlanSummary(2)
    await expect(svc.startPack({ userId: USER, source: 'web', dna: serum.dna, offer, size: 2, relight: true, approved: { items: plain.items, total: plain.total } }))
      .rejects.toMatchObject({ code: 'PLAN_CHANGED', details: { planned: { items: 2, total: plain.total * 2 } } })
    const relit = adPackPlanSummary(2, { relight: true })
    const started = await svc.startPack({ userId: USER, source: 'web', dna: serum.dna, offer, size: 2, relight: true, approved: { items: relit.items, total: relit.total } })
    expect(started.quote).toMatchObject({ credits: relit.total, relight: true })
    expect(store.packs.get(started.packId)?.quotedCredits).toBe(relit.total)
    const status = await svc.getStatus({ userId: USER, packId: started.packId })
    expect(status).toMatchObject({ productFidelity: 'exact', relight: true, quotedCredits: relit.total })
  })

  it('the runner charges the quoted relight unit under its own idempotent id', async () => {
    const t = await setup({ render: { productFidelity: 'exact', relight: true } })
    expect(t.planned.pack.quotedCredits).toBe(quotePack(1, { relight: true }).credits)
    await t.advance()
    const item = (await t.state()).items[0]
    expect(item.status).toBe('done')
    expect(t.charge.counts.get(item.generationId)).toBe(1)
    expect(t.charge.counts.get(relightGenerationId(item.generationId))).toBe(1)
  })
})
