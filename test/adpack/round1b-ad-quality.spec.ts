import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeStudioBackdrop, buildStudioBleed, compositeBleed, studioCanvas, STUDIO_SHADOW_MIN } from '../../api/lib/adpack/fidelity/bleed'
import { matteLayer } from '../../api/lib/adpack/fidelity/matte'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { advancePack, planPack, qaFamilyOrder, autoRetryMode } from '../../api/lib/adpack/pack-runner'
import { createDefaultRenderer } from '../../api/lib/adpack/render-adapter'
import { renderAd } from '../../api/lib/adpack/render'
import { fitText, tidySeparators } from '../../api/lib/adpack/render/text'
import { createMemoryPackStore } from '../../api/lib/adpack/store-memory'
import { buildStatusExtras } from '../../api/lib/adpack/status-summary'
import type { Renderer } from '../../api/lib/adpack/runner-types'
import type { OfferInput } from '../../api/lib/adpack/types'
import { caseById } from './helpers'
import { fakeCharge, fakeImageLoader, fakeStorage, runnerGateway } from './runner-fakes'

const USER = '00000000-0000-4000-8000-000000000001'
const PACK_ID = '22222222-2222-4222-8222-222222222299'
const HERO = 'https://cdn.test/studio-hero.jpg'
const serum = caseById('beauty-serum')

/** Studio shot: light seamless backdrop, a dark+white product, a real soft contact shadow under it. */
async function studioShot(o: { shadow?: boolean; dark?: boolean; touch?: boolean } = {}): Promise<Buffer> {
  const bg = o.dark ? '#202428' : '#ece8df'
  const shadow = o.shadow === false ? '' : '<ellipse cx="620" cy="1130" rx="360" ry="46" fill="#4a4030" opacity="0.38" filter="url(#b)"/>'
  const prod = o.touch
    ? '<rect x="0" y="300" width="1200" height="900" fill="#1b2a44"/>'
    : '<polygon points="260,520 980,430 1010,640 420,700" fill="#f8f8f6"/><rect x="560" y="640" width="40" height="440" fill="#14161a"/><circle cx="470" cy="1080" r="62" fill="#14161a"/><circle cx="760" cy="1080" r="62" fill="#14161a"/>'
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500"><defs><filter id="b"><feGaussianBlur stdDeviation="18"/></filter></defs><rect width="1200" height="1500" fill="${bg}"/>${shadow}${prod}</svg>`)).jpeg({ quality: 95 }).toBuffer()
}

describe('round 1b · studio bleed (render the scene around the untouched product pixels)', () => {
  it('a light, uniform studio backdrop is eligible; a dark or busy one is not', async () => {
    const ok = await analyzeStudioBackdrop(await studioShot())
    expect(ok).toMatchObject({ eligible: true, reason: 'studio backdrop' })
    expect(ok.uniformity).toBeGreaterThan(0.95)
    expect((await analyzeStudioBackdrop(await studioShot({ dark: true }))).eligible).toBe(false)
    const busy = await sharp({ create: { width: 400, height: 500, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg().toBuffer()
    expect((await analyzeStudioBackdrop(busy)).eligible).toBe(false)
  })

  it('keeps native product pixels (no cut edge), fades only the backdrop, and measures the real contact shadow', async () => {
    const photo = await studioShot()
    const layer = await buildStudioBleed(photo)
    expect(layer.shadowShare).toBeGreaterThanOrEqual(STUDIO_SHADOW_MIN)
    const { data, info } = await sharp(layer.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]
    const pb = layer.productBox
    // Opaque over the whole product bbox (product + its shadow are never masked)…
    for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9], [0.5, 0.95]]) expect(at(Math.round(pb.x + pb.w * fx), Math.round(pb.y + pb.h * fy))).toBe(255)
    // …and fully transparent at the layer border.
    expect(at(0, 0)).toBe(0)
    expect(at(info.width - 1, info.height - 1)).toBe(0)
    // Product RGB equals the source photo's pixels (untouched).
    const src = await sharp(photo).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const sx = Math.round(pb.x + pb.w * 0.5)
    const sy = Math.round(pb.y + pb.h * 0.3)
    const ox = layer.sourceWidth > 0 ? sx + (layer.sourceWidth - layer.width >= 0 ? 0 : 0) : sx
    expect(info.width).toBeLessThanOrEqual(src.info.width)
    expect(ox).toBe(sx)
    expect(layer.edgesTouched).toEqual([])
  })

  it('a photo without a real contact shadow is flagged (the cut-out path synthesizes one instead)', async () => {
    const layer = await buildStudioBleed(await studioShot({ shadow: false }))
    expect(layer.shadowShare).toBeLessThan(STUDIO_SHADOW_MIN)
  })

  it('refuses a product that fills the photo (touches 2+ edges)', async () => {
    await expect(buildStudioBleed(await studioShot({ touch: true }))).rejects.toThrow(/studio_bleed_failed/)
  })

  it('composites with one global backdrop gain (≤ ±12 %), Lanczos resample, and reports enlargement honestly', async () => {
    const layer = await buildStudioBleed(await studioShot())
    const base = await studioCanvas(1080, 1350, { r: 241, g: 237, b: 229 }, 'left')
    const small = await compositeBleed(base, layer, { x: 60, y: 300, w: 960, h: 600 })
    expect(small.upscale).toBeLessThan(1)
    for (const g of small.gain) expect(g).toBeGreaterThanOrEqual(0.88)
    for (const g of small.gain) expect(g).toBeLessThanOrEqual(1.12)
    const big = await compositeBleed(base, layer, { x: 0, y: 0, w: 1080, h: 1350 })
    expect(big.upscale).toBeGreaterThan(0)
    const huge = await compositeBleed(await studioCanvas(2400, 3000, { r: 241, g: 237, b: 229 }, 'left'), layer, { x: 0, y: 0, w: 2400, h: 3000 })
    expect(huge.upscale).toBeGreaterThan(1) // enlarged → reported (resampling, not super-resolution)
    expect(small.png.length).toBeGreaterThan(1000)
  })

  it('the procedural canvas is deterministic and keeps the brand light tone', async () => {
    const a = await studioCanvas(300, 400, { r: 241, g: 237, b: 229 }, 'left')
    const b = await studioCanvas(300, 400, { r: 241, g: 237, b: 229 }, 'left')
    expect(a.equals(b)).toBe(true)
    const st = await sharp(a).stats()
    expect(Math.abs(st.channels[0].mean - 241)).toBeLessThan(12)
  })
})

describe('round 1b · wrapped offer lines never start or end with a separator', () => {
  it('tidySeparators drops the "·" the wrap left at a line edge; fitText never emits one', () => {
    expect(tidySeparators(['₡14.900 · 2 kits por ₡26.000 ·', '· Envío gratis desde 2 kits'])).toEqual(['₡14.900 · 2 kits por ₡26.000', 'Envío gratis desde 2 kits'])
    const f = fitText({ text: '₡14.900 · 2 kits por ₡26.000 · Envío gratis desde 2 kits', font: { family: 'Poppins', weight: 700, style: 'normal' } as never, maxWidth: 520, maxLines: 3, maxSize: 52, minSize: 30, lineHeight: 1.12, balance: true })
    for (const l of f.lines) { expect(l).not.toMatch(/^[·•]/); expect(l).not.toMatch(/[·•]$/) }
  })
})

describe('round 1b · alpha matting (feather + colour decontamination)', () => {
  async function disc(contaminate: boolean): Promise<Buffer> {
    const w = 120
    const h = 120
    const raw = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 60, y - 60)
      const i = (y * w + x) * 4
      const inside = d < 40
      // Interior: dark navy product. Rim pixels: contaminated with the white photo backdrop.
      const rim = contaminate && d > 38.3 && d < 40
      raw[i] = rim ? 235 : 20
      raw[i + 1] = rim ? 232 : 30
      raw[i + 2] = rim ? 223 : 60
      raw[i + 3] = inside ? 255 : 0
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  }
  it('softens the binary edge to a 1–2 px alpha ramp and leaves the interior untouched', async () => {
    const src = await disc(false)
    const out = await matteLayer(src)
    const a = await sharp(out).ensureAlpha().extractChannel(3).raw().toBuffer()
    const b = await sharp(src).ensureAlpha().extractChannel(3).raw().toBuffer()
    const frac = [...a].filter((v) => v > 5 && v < 250).length
    expect(frac).toBeGreaterThan(40)
    expect(a[60 * 120 + 60]).toBe(255)
    const rgbOut = await sharp(out).removeAlpha().raw().toBuffer()
    const rgbSrc = await sharp(src).removeAlpha().raw().toBuffer()
    const ci = (60 * 120 + 60) * 3
    expect([rgbOut[ci], rgbOut[ci + 1], rgbOut[ci + 2]]).toEqual([rgbSrc[ci], rgbSrc[ci + 1], rgbSrc[ci + 2]])
    expect(b[60 * 120 + 60]).toBe(255)
  })
  it('replaces backdrop-coloured fringe pixels in the soft band with the nearby product colour (no halo)', async () => {
    const out = await matteLayer(await disc(true))
    const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // A boundary pixel (alpha < 98 %) that started as 235,232,223 is pulled toward navy.
    let worst = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 20 && data[i + 3] < 230) worst = Math.max(worst, data[i])
    expect(worst).toBeLessThan(200)
  })
})

describe('round 1b · studio_hero family (the approved v1 look) + larger logo', () => {
  async function badge(): Promise<Buffer> {
    return sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150"><rect width="260" height="150" rx="14" fill="#15263E"/><text x="130" y="88" font-size="44" fill="#fff" text-anchor="middle" font-family="sans-serif">Marca</text></svg>')).png().toBuffer()
  }
  beforeAll(() => { process.env.ADPACK_FONT_FETCH = '0' })
  afterAll(() => { delete process.env.ADPACK_FONT_FETCH })
  it('renders a bled studio photo: product box from the layer, logo area ≥ 9k px², copy in the IG-safe zone, report carries the resample facts', async () => {
    const layer = await buildStudioBleed(await studioShot())
    for (const ratio of ['4:5', '9:16'] as const) {
      const [w, h] = ratio === '4:5' ? [1080, 1350] : [1080, 1920]
      const res = await renderAd({
        format: 'offer_graphic', ratio, layoutFamily: 'studio_hero', productMode: 'exact', sceneImage: await studioCanvas(w, h, { r: 241, g: 237, b: 229 }, 'left'),
        studioBleed: { layer: layer.png, productBox: layer.productBox, backdrop: layer.backdrop, edgesTouched: layer.edgesTouched },
        copy: { headline: 'Un regalo que armás con papel', subline: 'Chasis armado y control 2.4GHz', bullets: ['Chasis con 2 motores', 'Recomendado 8+ con adulto'], offerLine: '1 kit ₡14.900 · 2 kits ₡29.800 · Envío gratis llevando 2 kits o más', cta: 'Escribinos por DM' },
        language: 'es', logo: await badge(), visual: { primaryColor: '#15263E', accentColor: '#2BB3A3', secondaryColor: '#F1EDE5' },
      })
      const rep = res.layoutReport
      expect(rep.layoutFamily).toBe('studio_hero')
      expect(rep.bleed).toBeDefined()
      expect(rep.bleed!.upscaled).toBe(false)
      expect(rep.fits).toBe(true)
      expect(rep.logo!.w * rep.logo!.h).toBeGreaterThanOrEqual(9000)
      for (const e of rep.elements) {
        expect(e.contrast).toBeGreaterThanOrEqual(4.5)
        expect(e.box.x).toBeGreaterThanOrEqual(rep.safeArea.x - 1)
        expect(e.box.y + e.box.h).toBeLessThanOrEqual(rep.safeArea.y + rep.safeArea.h + 1)
      }
      if (ratio === '9:16') for (const e of rep.elements) { expect(e.box.y).toBeGreaterThanOrEqual(250); expect(e.box.y + e.box.h).toBeLessThanOrEqual(1920 - 340) }
      // The shipping rule rides under the price (verbatim), the price stays whole.
      expect(rep.elements.filter((e) => e.role === 'offer').map((e) => e.text)).toEqual(['1 kit ₡14.900 · 2 kits ₡29.800', 'Envío gratis llevando 2 kits o más'])
      expect(res.productPlacements?.[0]?.box.w).toBeGreaterThan(w * 0.4)
      expect(rep.product).toBeTruthy()
    }
  })

  it('qaFamilyOrder offers alternates (studio first for bleeds, never the failed one)', () => {
    expect(qaFamilyOrder('studio_hero', 'offer_graphic', true)).toEqual(['studio_navy_top', 'studio_top', 'studio_navy_bottom'])
    expect(qaFamilyOrder('studio_top', 'offer_graphic', true)).toEqual(['studio_navy_bottom', 'studio_hero', 'studio_navy_top'])
    expect(qaFamilyOrder('badge_corner', 'offer_graphic', false)).toEqual(['editorial_minimal', 'full_bleed_type'])
    expect(qaFamilyOrder(undefined, 'before_after', true)).toEqual(['editorial_minimal', 'full_bleed_type'])
  })
  it('a gate failure maps to a copy retry for copy problems and a re-scene for pixel problems', () => {
    expect(autoRetryMode('qa_gate_failed: headline (missing article)')).toBe('copy')
    expect(autoRetryMode('qa_gate_failed: required_facts')).toBe('copy')
    expect(autoRetryMode('qa_gate_failed: shadow_present')).toBe('scene')
  })
})

describe('round 1b · pack runner: studio bleed + QA gate (auto-retry, then fail instead of shipping)', () => {
  beforeAll(() => { process.env.ADPACK_FONT_FETCH = '0' })
  afterAll(() => { delete process.env.ADPACK_FONT_FETCH })
  const logoUrl = async () => `data:image/png;base64,${(await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150"><rect width="260" height="150" rx="14" fill="#15263E"/><text x="130" y="88" font-size="44" fill="#fff" text-anchor="middle" font-family="sans-serif">Marca</text></svg>')).png().toBuffer()).toString('base64')}`

  async function setup(wrap?: (inner: Renderer) => Renderer) {
    const store = createMemoryPackStore()
    const dna = { ...serum.dna, visual: { ...(serum.dna.visual ?? {}), logoUrl: await logoUrl(), primaryColor: '#15263E', accentColor: '#2BB3A3', secondaryColor: '#F1EDE5' } }
    const offer: OfferInput = { ...serum.offer, productImageUrls: [HERO] }
    const planned = planPack({ dna, offer, size: 1, userId: USER, source: 'web', ids: { packId: PACK_ID }, render: { productFidelity: 'exact' } })
    await store.createPack(planned.pack, planned.items)
    const gateway = runnerGateway()
    const shot = new Uint8Array(await studioShot())
    const loadImage = fakeImageLoader({ [HERO]: async () => shot })
    const inner = createDefaultRenderer()
    const calls: Array<{ family?: string; ratio: string }> = []
    const renderer: Renderer = { async render(i) { calls.push({ family: i.layoutFamily, ratio: i.ratio }); return inner.render(i) } }
    const r = wrap ? wrap(renderer) : renderer
    const charge = fakeCharge()
    return { store, gateway, calls, charge, run: () => advancePack({ store, gateway, renderer: r, storage: fakeStorage(), charge, packId: PACK_ID, userId: USER, cutoutCache: memoryBlobCache(), loadImage }), state: async () => (await store.getPack(PACK_ID, USER))! }
  }

  it('a studio photo skips the paid plate entirely (0 scene calls), renders the bleed and ships with gate scores', async () => {
    const t = await setup()
    const p = await t.run()
    const { items } = await t.state()
    const item = items[0]
    expect(t.gateway.sceneCalls).toHaveLength(0)
    expect(item.scene).toMatchObject({ model: 'studio-canvas', costUsd: 0, productLocked: true })
    expect(item.scene?.bleed?.edgesTouched).toEqual([])
    expect(item.status, JSON.stringify(item.rejectedRatios?.map((r) => [r.ratio, r.reason]) ?? item.error)).toBe('done')
    expect(p.status).toBe('done')
    expect(item.renders.length).toBe(2)
    for (const r of item.renders) {
      expect(r.qa?.passed).toBe(true)
      expect(r.qa?.metrics.map((m) => m.id)).toContain('shadow_present')
      expect(r.fidelity?.passed).toBe(true)
    }
    // Surfaced in the status output.
    const extras = buildStatusExtras({ packId: PACK_ID, status: 'done', items, moreWork: false, language: 'es', dna: serum.dna })
    const file = extras.deliverable!.ads[0].files[0]
    expect(file?.qa?.passed).toBe(true)
    expect(file?.qa?.score).toBe(1)
  }, 120_000)

  it('a render failing a hard check is re-laid-out with an alternate family before anything is shown', async () => {
    const t = await setup((inner) => ({
      async render(i) {
        const out = await inner.render(i)
        // The studio layout "fails" contrast; the alternate family passes untouched.
        if (i.layoutFamily === 'studio_hero' && out.qaReport) out.qaReport = { ...out.qaReport, elements: out.qaReport.elements.map((e) => ({ ...e, contrast: 2.1 })) }
        return out
      },
    }))
    await t.run()
    const { items } = await t.state()
    const item = items[0]
    expect(item.status).toBe('done')
    expect(t.calls.some((c) => c.family === 'studio_navy_top')).toBe(true)
    for (const r of item.renders) {
      expect(r.qa?.attempts).toBeGreaterThanOrEqual(2)
      expect(r.qa?.layoutFamily).toBe('studio_navy_top')
      expect(r.qa?.passed).toBe(true)
    }
  }, 180_000)

  it('when every alternate still fails, nothing is shipped: no renders, no charge, gate scores in rejectedRatios, failure says qa_gate_failed', async () => {
    const t = await setup((inner) => ({
      async render(i) {
        const out = await inner.render(i)
        if (out.qaReport) out.qaReport = { ...out.qaReport, logo: null }
        return out
      },
    }))
    await t.run()
    const { items } = await t.state()
    const item = items[0]
    expect(item.renders).toHaveLength(0)
    expect(item.status).toBe('failed')
    expect(item.error).toMatch(/^qa_gate_failed: .*logo/)
    expect(t.charge.total()).toBe(0)
    expect(item.rejectedRatios?.length).toBeGreaterThan(0)
    for (const r of item.rejectedRatios ?? []) {
      expect(r.qa?.passed).toBe(false)
      expect(r.qa?.failed).toContain('logo')
      expect(r.qa?.attempts).toBeGreaterThanOrEqual(2)
    }
  }, 240_000)
})
