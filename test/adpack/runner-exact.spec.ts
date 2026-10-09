import { describe, expect, it } from 'vitest'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { generateExactProductImage, resolveToolProductFidelity } from '../../api/lib/adpack/fidelity/pipeline'
import { buildPlatePrompt, checkPlate } from '../../api/lib/adpack/fidelity/plate'
import { advancePack, editItemText, plateRegionFor, planPack, regenerateItem, type AdvancePackInput } from '../../api/lib/adpack/pack-runner'
import { createAdPackService, resolveRenderOptions } from '../../api/lib/adpack/service'
import { buildStatusExtras, failureReason } from '../../api/lib/adpack/status-summary'
import { createMemoryPackStore } from '../../api/lib/adpack/store-memory'
import { packToRow, rowToItem, rowToPack } from '../../api/lib/adpack/store-supabase'
import type { OfferInput, PackRenderOptions } from '../../api/lib/adpack/types'
import { caseById, goodSerumCopy } from './helpers'
import { busyPhoto, partOnGray, productOnWhite, syntheticPlate, syntheticPlate34 } from './fidelity-fixtures'
import { fakeCharge, fakeImageLoader, fakeRenderer, fakeStorage, runnerGateway, type RunnerGatewayOptions } from './runner-fakes'

const USER = '00000000-0000-4000-8000-000000000001'
const PACK_ID = '22222222-2222-4222-8222-222222222222'
const serum = caseById('beauty-serum')
const HERO = 'https://cdn.test/hero.jpg'
const PART = 'https://cdn.test/gamepad.jpg'

async function photoLoader() {
  const files: Record<string, () => Promise<Uint8Array>> = {
    [HERO]: async () => new Uint8Array(await productOnWhite()),
    [PART]: async () => new Uint8Array(await partOnGray()),
    'https://cdn.test/noisy.jpg': async () => new Uint8Array(await busyPhoto()),
  }
  return fakeImageLoader(files)
}

async function setup(opts: { size?: number; offer?: Partial<OfferInput>; render?: PackRenderOptions; gateway?: RunnerGatewayOptions; alter?: boolean } = {}) {
  const store = createMemoryPackStore()
  const offer: OfferInput = { ...serum.offer, productImageUrls: [HERO], ...opts.offer }
  const planned = planPack({ dna: serum.dna, offer, size: opts.size ?? 3, userId: USER, source: 'web', ids: { packId: PACK_ID }, render: opts.render ?? { productFidelity: 'exact' } })
  await store.createPack(planned.pack, planned.items)
  const gateway = runnerGateway(opts.gateway)
  const renderer = fakeRenderer({ alter: opts.alter })
  const storage = fakeStorage()
  const charge = fakeCharge()
  const cache = memoryBlobCache()
  const loadImage = await photoLoader()
  const base: AdvancePackInput = { store, gateway, renderer, storage, charge, packId: PACK_ID, userId: USER, cutoutCache: cache, loadImage }
  return { store, gateway, renderer, storage, charge, cache, loadImage, advance: (x: Partial<AdvancePackInput> = {}) => advancePack({ ...base, ...x }), state: async () => (await store.getPack(PACK_ID, USER))! }
}

describe('exact product mode — pack runner (A1/A3/A4/H3)', () => {
  it('happy path: plates without product refs, real cut-out composited per ratio, fidelity on every render', async () => {
    const t = await setup({ size: 3, render: { productFidelity: 'exact', allowedProps: ['caja del kit'], immutableAttributes: ['hélices blancas'] } })
    const progress = await t.advance()
    expect(progress.status).toBe('done')
    // The image model never receives the product (it only draws the empty plate).
    expect(t.gateway.sceneCalls).toHaveLength(3)
    for (const c of t.gateway.sceneCalls) {
      expect(c.refs).toEqual([])
      expect(c.prompt).toMatch(/NO product, no devices/)
      expect(c.prompt).toMatch(/caja del kit/)
      expect(c.prompt).toMatch(/clear, empty, flat placement area/)
    }
    // Plate check sees the plate + the real photo.
    expect(t.gateway.visionCalls.every((v) => v.images.length === 2 && v.images[1] === HERO)).toBe(true)
    const { items } = await t.state()
    for (const item of items) {
      expect(item.status).toBe('done')
      expect(item.scene).toMatchObject({ kind: 'plate', productLocked: true })
      expect(item.scene?.cutouts?.[0]).toMatchObject({ role: 'hero', sourceUrl: HERO })
      expect(['flood', 'cache']).toContain(item.scene?.cutouts?.[0].method)
      expect(item.renders).toHaveLength(3)
      for (const r of item.renders) expect(r.fidelity).toMatchObject({ passed: true, method: 'composite' })
      expect(item.fidelity?.passed).toBe(true)
      expect(item.fidelity?.ssim).toBeGreaterThan(0.99)
      expect(item.fidelity?.diffImageUrl).toMatch(/fidelity-/)
      expect(item.sceneCheck?.fidelity).toEqual(item.fidelity) // persisted copy (scene_check jsonb)
    }
    // Renderer got the exact inputs.
    expect(t.renderer.calls.every((c) => c.productMode === 'exact' && c.productCutout instanceof Uint8Array && (c.light === 'left' || c.light === 'right'))).toBe(true)
    // Cut-out made once per photo and reused (content-addressed cache).
    expect(t.cache.entries.size).toBe(1)
    expect(t.storage.uploads.filter((u) => u.kind === 'plate')).toHaveLength(3)
  })

  it('A4: status/deliverable expose fidelity {score, passed, method, diffImageUrl}', async () => {
    const t = await setup({ size: 2 })
    await t.advance()
    const { items } = await t.state()
    const extras = buildStatusExtras({ packId: PACK_ID, status: 'done', items, moreWork: false, language: 'es' })
    expect(extras.deliverable?.ads).toHaveLength(2)
    for (const ad of extras.deliverable!.ads) {
      expect(ad.fidelity).toMatchObject({ passed: true, method: 'composite' })
      expect(ad.fidelity!.score).toBeGreaterThan(0.95)
      expect(ad.fidelity!.diffImageUrl).toBeTruthy()
    }
  })

  it('cut-out failure → item failed with cutout_failed, no plate generated, never a redrawn product', async () => {
    const t = await setup({ size: 2, offer: { productImageUrls: ['https://cdn.test/noisy.jpg'] } })
    const progress = await t.advance()
    expect(progress.status).toBe('failed')
    const { items } = await t.state()
    for (const item of items) {
      expect(item.status).toBe('failed')
      expect(item.error).toMatch(/^cutout_failed/)
      expect(item.renders).toEqual([])
    }
    expect(t.gateway.sceneCalls).toHaveLength(0)
    expect(t.charge.total()).toBe(0)
    expect(failureReason(items[0].error, 'es')).toMatch(/recortar el producto/)
  })

  it('props check: invented parts on the plate → retry (≤ 2) → accepted when clean', async () => {
    const t = await setup({ size: 1, gateway: { vision: (i) => ({ extraObjects: i < 2 ? ['hélice suelta', 'cable USB'] : [], strayText: false, borders: false, placementClear: true, score: 0.8 }) } })
    await t.advance()
    const { items } = await t.state()
    expect(items[0].status).toBe('done')
    expect(items[0].sceneAttempts).toBe(3)
    expect(t.gateway.sceneCalls[1].prompt).toMatch(/look like a product, device, part, cable or packaging/)
  })

  it('props check: still invented after 2 retries → scene_props_failed, nothing rendered or charged', async () => {
    const t = await setup({ size: 1, gateway: { vision: () => ({ extraObjects: ['radiocontrol con antena'], strayText: false, borders: false, score: 0.7 }) } })
    await t.advance()
    const { items } = await t.state()
    expect(items[0].status).toBe('failed')
    expect(items[0].error).toMatch(/^scene_props_failed: radiocontrol con antena \(after 3 attempts\)/)
    expect(items[0].sceneCheck?.extraObjects).toEqual(['radiocontrol con antena'])
    expect(t.gateway.sceneCalls).toHaveLength(3)
    expect(t.charge.total()).toBe(0)
  })

  it('fidelity below threshold → fidelity_failed, renders dropped (never delivered), not charged', async () => {
    const t = await setup({ size: 1, alter: true })
    await t.advance()
    const { items } = await t.state()
    expect(items[0].status).toBe('failed')
    expect(items[0].error).toMatch(/^fidelity_failed: ssim/)
    expect(items[0].renders).toEqual([])
    expect(items[0].fidelity?.passed).toBe(false)
    expect(t.charge.total()).toBe(0)
  })

  it('multi-part product (H3): offer_graphic / explainer get the real part cut-out, other formats only the hero', async () => {
    const t = await setup({
      size: 10,
      offer: { productImageUrls: [HERO, PART], productPhotos: [{ url: HERO, role: 'hero' }, { url: PART, role: 'part', label: 'control tipo gamepad' }] },
    })
    await t.advance()
    const { items } = await t.state()
    expect(items.every((i) => i.status === 'done')).toBe(true)
    for (const item of items) {
      const roles = item.scene?.cutouts?.map((c) => c.role)
      if (item.angle.format === 'offer_graphic' || item.angle.format === 'explainer') expect(roles).toEqual(['hero', 'part'])
      else expect(roles).toEqual(['hero'])
    }
    const partRenders = t.renderer.calls.filter((c) => c.productParts?.length)
    expect(partRenders.length).toBeGreaterThan(0)
    expect(partRenders.every((c) => c.format === 'offer_graphic' || c.format === 'explainer')).toBe(true)
  })

  it('editText re-renders from the stored cut-out URL and re-measures fidelity', async () => {
    const t = await setup({ size: 1 })
    await t.advance()
    const before = (await t.state()).items[0]
    expect(before.status).toBe('done')
    const res = await editItemText({ store: t.store, renderer: t.renderer, storage: t.storage, packId: PACK_ID, itemId: before.id, userId: USER, copyPatch: { headline: 'Brillo bajo control' }, loadImage: t.loadImage })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.item.fidelity?.passed).toBe(true)
    // Stored cut-out URL was loaded (no in-memory bytes in editText).
    expect(t.loadImage.calls.some((u) => u === before.scene?.cutouts?.[0].url)).toBe(true)
  })

  it('regenerate clears the fidelity of the previous attempt', async () => {
    const t = await setup({ size: 1 })
    await t.advance()
    const item = (await t.state()).items[0]
    const res = await regenerateItem({ store: t.store, packId: PACK_ID, itemId: item.id, userId: USER, mode: 'scene' })
    expect(res.ok && res.item.fidelity).toBeUndefined()
  })

  it('plate placement region = union of the per-ratio product boxes mapped into the 9:16 plate', () => {
    const { pack } = planPack({ dna: serum.dna, offer: { ...serum.offer, productImageUrls: [HERO] }, size: 1, userId: USER, source: 'web', ids: { packId: PACK_ID } })
    const r = plateRegionFor({ pack, format: 'offer_graphic', copy: goodSerumCopy(), product: { width: 260, height: 580 } })
    expect(r.x0).toBeGreaterThan(0.45) // right column
    expect(r.x1).toBeLessThanOrEqual(1)
    expect(r.y0).toBeGreaterThan(0.2)
    expect(r.y1).toBeLessThan(0.85)
    const prompt = buildPlatePrompt({ format: 'offer_graphic', dna: serum.dna, offer: serum.offer, placement: r, light: 'left', allowedProps: ['manual'] })
    expect(prompt).toMatch(/in the right half/)
    expect(prompt).toMatch(/light from the upper left/)
    expect(prompt).not.toMatch(/attached product photo/)
  })
})

describe('generated mode keeps working, with the new props / bbox checks', () => {
  it('legacy packs (no render options) stay generated: product ref on the scene, vision bbox → renderer productAvoid', async () => {
    const t = await setup({
      size: 1,
      render: { productFidelity: 'generated', allowedProps: ['caja'] },
      gateway: { vision: () => ({ productMatches: true, strayText: false, headlineSpace: true, extraObjects: [], productBox: [400, 500, 800, 900], score: 0.9 }) },
    })
    await t.advance()
    const { items } = await t.state()
    expect(items[0].status).toBe('done')
    expect(t.gateway.sceneCalls[0].refs).toEqual([HERO])
    expect(t.renderer.calls[0].productMode).toBeUndefined()
    expect(t.renderer.calls[0].productAvoid).toEqual({ y0: 0.4, x0: 0.5, y1: 0.8, x1: 0.9 })
    expect(items[0].fidelity).toMatchObject({ method: 'generated', passed: true, ssim: null, deltaE: null })
  })

  it('generated mode: invented accessories → regenerate with a props hint → scene_props_failed', async () => {
    const t = await setup({ size: 1, render: { productFidelity: 'generated' }, gateway: { vision: () => ({ productMatches: true, strayText: false, headlineSpace: true, extraObjects: ['cable USB'], score: 0.8 }) } })
    await t.advance()
    const { items } = await t.state()
    expect(items[0].status).toBe('failed')
    expect(items[0].error).toMatch(/^scene_props_failed: cable USB/)
    expect(t.gateway.sceneCalls[1].prompt).toMatch(/no extra parts, cables or devices/)
  })
})

describe('pack options + persistence', () => {
  it('default exact whenever a product photo exists; generated only when asked or no photo', () => {
    const withPhoto: OfferInput = { ...serum.offer, productImageUrls: [HERO] }
    const noPhoto: OfferInput = { ...serum.offer, productImageUrls: [] }
    expect(resolveRenderOptions({}, withPhoto).productFidelity).toBe('exact')
    expect(resolveRenderOptions({ productFidelity: 'generated' }, withPhoto).productFidelity).toBe('generated')
    expect(resolveRenderOptions({}, noPhoto).productFidelity).toBe('generated')
    expect(() => resolveRenderOptions({ productFidelity: 'exact' }, noPhoto)).toThrow(/needs a real product photo/)
    expect(() => resolveRenderOptions({ productFidelity: 'pixel' }, withPhoto)).toThrow(/exact or generated/)
    expect(resolveRenderOptions({ relight: true, allowedProps: ['caja', ' caja '], immutableAttributes: ['ala blanca'] }, withPhoto)).toEqual({ productFidelity: 'exact', relight: true, allowedProps: ['caja'], immutableAttributes: ['ala blanca'] })
    // Relight is ignored in generated mode.
    expect(resolveRenderOptions({ relight: true, productFidelity: 'generated' }, withPhoto).relight).toBeUndefined()
  })

  it('service.startPack stores the options; status reports productFidelity', async () => {
    const store = createMemoryPackStore()
    const service = createAdPackService({
      store,
      gateway: runnerGateway(),
      renderer: fakeRenderer(),
      storage: fakeStorage(),
      async charge() { return { charged: true } },
      async checkCredits() { return { allowed: true, remaining: 999 } },
      loadImage: await photoLoader(),
    })
    const started = await service.startPack({ userId: USER, source: 'web', dna: serum.dna, offer: { ...serum.offer, productImageUrls: [HERO], productPhotos: [{ url: HERO, role: 'hero' }] }, size: 1, immutableAttributes: ['hélices blancas'] })
    const pack = store.packs.get(started.packId)!
    expect(pack.render).toEqual({ productFidelity: 'exact', immutableAttributes: ['hélices blancas'] })
    expect((await service.getStatus({ userId: USER, packId: started.packId })).productFidelity).toBe('exact')
    await expect(service.startPack({ userId: USER, source: 'web', dna: serum.dna, offer: { ...serum.offer, productPhotos: [{ url: HERO, role: 'robot' }] }, size: 1 })).rejects.toMatchObject({ code: 'BAD_INPUT' })
    await expect(service.startPack({ userId: USER, source: 'web', dna: serum.dna, offer: { ...serum.offer, productImageUrls: [] }, size: 1, productFidelity: 'exact' })).rejects.toMatchObject({ code: 'BAD_INPUT' })
  })

  it('no migration needed: render options ride in the offer jsonb, fidelity in scene_check', () => {
    const { pack } = planPack({ dna: serum.dna, offer: { ...serum.offer, productImageUrls: [HERO] }, size: 1, userId: USER, source: 'web', ids: { packId: PACK_ID }, render: { productFidelity: 'exact', relight: true } })
    const row = packToRow(pack)
    expect((row.offer as Record<string, unknown>).packRender).toEqual({ productFidelity: 'exact', relight: true })
    const back = rowToPack(row)
    expect(back.render).toEqual({ productFidelity: 'exact', relight: true })
    expect(back.offer).toEqual(pack.offer)
    const fidelity = { score: 0.99, ssim: 0.999, deltaE: 1.2, passed: true, method: 'composite' as const }
    const item = rowToItem({ id: 'i', pack_id: PACK_ID, item_index: 0, status: 'done', angle: {}, renders: [], attempts: 0, generation_id: 'g', updated_at: new Date().toISOString(), scene_check: { ok: true, productMatches: null, strayText: null, score: 0.8, fidelity } })
    expect(item.fidelity).toEqual(fidelity)
  })
})

describe('exact single image (execute_image_generate / bulk / campaign pack)', () => {
  function plateGateway(plate: () => Promise<Buffer>, vision?: RunnerGatewayOptions['vision']) {
    const gw = runnerGateway({ vision })
    gw.scene = async (input) => {
      gw.sceneCalls.push({ prompt: input.prompt, refs: input.refs, styleRefs: input.styleRefs ?? [], ratio: input.ratio, draft: input.draft, startedAt: Date.now() })
      return { bytes: new Uint8Array(await plate()), mimeType: 'image/jpeg', costUsd: 0.02, model: 'fake-image', productLocked: false }
    }
    return gw
  }

  it('4:5 works end-to-end (plate at a native ratio, reframed), real product pixels, fidelity returned', async () => {
    const gw = plateGateway(syntheticPlate34)
    const res = await generateExactProductImage({ gateway: gw, photos: [{ url: HERO, role: 'hero' }], ratio: '4:5', brandName: 'Marca Demo', offerName: 'Kit Demo', language: 'es', load: await photoLoader(), cache: memoryBlobCache() })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect([res.width, res.height]).toEqual([1080, 1350])
    expect(res.fidelity).toMatchObject({ passed: true, method: 'composite' })
    expect(gw.sceneCalls[0]).toMatchObject({ refs: [], ratio: '4:5' })
  })

  it('16:9 and 1:1 too; props failure → scene_props_failed (job fails, nothing delivered)', async () => {
    for (const ratio of ['16:9', '1:1']) {
      const ok = await generateExactProductImage({ gateway: plateGateway(() => syntheticPlate(1920, 1080)), photos: [{ url: HERO, role: 'hero' }], ratio, brandName: 'B', offerName: 'O', language: 'en', load: await photoLoader() })
      expect(ok.ok, ratio).toBe(true)
    }
    const bad = await generateExactProductImage({
      gateway: plateGateway(() => syntheticPlate(), () => ({ extraObjects: ['USB cable'], score: 0.5 })),
      photos: [{ url: HERO, role: 'hero' }],
      ratio: '9:16',
      brandName: 'B',
      offerName: 'O',
      language: 'en',
      load: await photoLoader(),
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toBe('scene_props_failed: USB cable')
  })

  it('productFidelity defaults for the single-image tools', () => {
    expect(resolveToolProductFidelity(undefined, true)).toBe('exact')
    expect(resolveToolProductFidelity(undefined, false)).toBe('generated')
    expect(resolveToolProductFidelity('generated', true)).toBe('generated')
    expect(() => resolveToolProductFidelity('exact', false)).toThrow(/needs a product photo/)
  })

  it('checkPlate parses extra objects and the placement verdict', async () => {
    const gw = runnerGateway({ vision: () => ({ extraObjects: ['hélice', '', 'hélice'], strayText: 'no', borders: false, placementClear: 'false', score: 7 }) })
    const res = await checkPlate({ gateway: gw, plateImage: 'data:image/png;base64,AA', refs: [{ image: HERO, role: 'hero' }], language: 'es' })
    expect(res).toMatchObject({ ok: false, extraObjects: ['hélice'], strayText: false, placementClear: false, score: 0.7 })
  })
})
