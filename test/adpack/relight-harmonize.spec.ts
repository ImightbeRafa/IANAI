/**
 * Exact-mode relight stage (owner decision 2026-10-08: relight included, real and free).
 *
 * 1. Light model per plate: direction (prompt + luminance-gradient check), color temperature,
 *    ambient, grain.
 * 2. Product shading is luminance-only (hue kept) and directional; one shared grade.
 * 3. Shadows (contact + cast, ambient-tinted), reflection on glossy plates, grain match.
 * 4. Fidelity metric: a relit product PASSES on warm / cool / dark / bright / top-lit plates; a
 *    redrawn, reshaped, recolored or repainted product still FAILS.
 * No model calls (sharp-made photo-like plates and products).
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { compositeProducts, fitBox } from '../../api/lib/adpack/fidelity/composite'
import { estimateLight, gradeFor, gradeRaw, harmonizeLayer, type LightModel } from '../../api/lib/adpack/fidelity/harmonize'
import { buildPlatePrompt, plateSurface } from '../../api/lib/adpack/fidelity/plate'
import { rgbToLab } from '../../api/lib/adpack/fidelity/pixels'
import { FIDELITY_THRESHOLD, scoreFidelity } from '../../api/lib/adpack/fidelity/score'
import { segmentProduct } from '../../api/lib/adpack/fidelity/segment'
import { productOnWhite } from './fidelity-fixtures'
import { mugPhoto, PLATES, planePhoto, realisticPlate } from './relight-fixtures'

const W = 1080
const H = 1350
const plates = new Map<string, Buffer>()
async function plate(name: string): Promise<Buffer> {
  if (!plates.has(name)) plates.set(name, await realisticPlate(PLATES.find((p) => p.name === name)!, W, H))
  return plates.get(name)!
}

async function cut(bytes: Buffer) {
  const c = await segmentProduct({ bytes })
  if (!c.ok) throw new Error('cutout')
  return c
}

async function regionMean(png: Buffer, r: { left: number; top: number; width: number; height: number }): Promise<[number, number, number]> {
  const st = await sharp(await sharp(png).extract(r).png().toBuffer()).stats()
  return [st.channels[0].mean, st.channels[1].mean, st.channels[2].mean]
}
const luma = (c: [number, number, number]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

describe('1 · light model per plate', () => {
  const slot = { x: 324, y: 400, w: 432, h: 700 }

  it('reads the key side from the plate gradient and agrees with the prompt', async () => {
    const warm = await estimateLight(await plate('warm-wood'), slot, { light: 'left' })
    expect(warm).toMatchObject({ direction: 'left', prompted: 'left', estimated: 'left' })
    expect(warm.keyFill).toBeGreaterThan(1.1)
    const cool = await estimateLight(await plate('cool-concrete'), slot, { light: 'right' })
    expect(cool).toMatchObject({ direction: 'right', estimated: 'right' })
  })

  it('the plate is prompted with its surface type (glossy studio formats → reflection; matte otherwise)', () => {
    expect(plateSurface('explainer', 0)).toBe('glossy')
    expect(plateSurface('explainer', 1)).toBe('matte')
    expect(plateSurface('offer_graphic', 0)).toBe('matte')
    const dna = { version: 1, brandName: 'B', category: 'other', language: 'es', register: 'voseo', facts: [], gaps: [], sources: [] } as never
    const prompt = buildPlatePrompt({ format: 'explainer', dna, offer: { name: 'Kit', facts: [], productImageUrls: [] }, placement: { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.85 }, light: 'left', surface: 'glossy' })
    expect(prompt).toMatch(/Surface: a smooth glossy surface/)
    expect(buildPlatePrompt({ format: 'offer_graphic', dna, offer: { name: 'Kit', facts: [], productImageUrls: [] }, placement: { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.85 }, light: 'left' })).toMatch(/Surface: a matte surface/)
  })

  it('a plate clearly lit from the other side wins over the prompt (the model ignored it)', async () => {
    const m = await estimateLight(await plate('dark-navy'), slot, { light: 'right' })
    expect(m.prompted).toBe('right')
    expect(m.estimated).toBe('left')
    expect(m.direction).toBe('left')
  })

  it('color temperature from highlights / ambient: warm plate > 0, cool plate < warm plate; ambient + grain measured', async () => {
    const warm = await estimateLight(await plate('warm-wood'), slot, { light: 'left' })
    const cool = await estimateLight(await plate('cool-concrete'), slot, { light: 'right' })
    expect(warm.temperature).toBeGreaterThan(0)
    expect(cool.temperature).toBeLessThan(warm.temperature)
    expect(warm.ambient[0]).toBeGreaterThan(warm.ambient[2]) // warm surroundings
    expect(cool.ambient[2]).toBeGreaterThan(cool.ambient[0]) // cool surroundings
    expect(cool.noise).toBeGreaterThan(1)
    const studio = await estimateLight(await plate('bright-studio'), slot, { light: 'right', surface: 'glossy' })
    expect(studio.noise).toBeLessThan(cool.noise)
    expect(studio.surface).toBe('glossy')
  })
})

describe('2 · product shading is luminance only, directional, with one shared grade', () => {
  it('key side brighter than the shadow side; hue of every colored area kept', async () => {
    const c = await cut(await productOnWhite())
    const box = { x: 0, y: 0, w: c.width, h: c.height }
    const placed = await sharp(c.png).png().toBuffer()
    const background = Buffer.alloc(c.width * c.height * 3, 180)
    const model: LightModel = {
      direction: 'left', prompted: 'left', estimated: 'left', gradient: -0.2, vector: [-0.83, -0.56], elevation: 0.45, keyFill: 1.8,
      temperature: 0, tint: 0, whiteBalance: [1, 1, 1], ambient: [180, 180, 180], keyColor: [255, 255, 255], noise: 0, acuity: 0.3,
      tone: { p5: 40, p50: 128, p95: 230 }, surface: 'matte',
    }
    const res = await harmonizeLayer({ placed, background, model, grade: null, grain: false })
    const out = res.png
    // Teal body band (y 560–600 in the 600×800 source → cut-out coordinates): left vs right third.
    const y = Math.round(c.height * 0.8)
    const l = await regionMean(out, { left: Math.round(c.width * 0.12), top: y, width: Math.round(c.width * 0.2), height: 12 })
    const r = await regionMean(out, { left: Math.round(c.width * 0.68), top: y, width: Math.round(c.width * 0.2), height: 12 })
    const l0 = await regionMean(placed, { left: Math.round(c.width * 0.12), top: y, width: Math.round(c.width * 0.2), height: 12 })
    expect(luma(l)).toBeGreaterThan(luma(r) * 1.12)
    // Same hue as the cut-out (luminance-only gain).
    const hue = (c3: [number, number, number]) => {
      const [, a, b] = rgbToLab(Math.round(c3[0]), Math.round(c3[1]), Math.round(c3[2]))
      return (Math.atan2(b, a) * 180) / Math.PI
    }
    expect(Math.abs(hue(l) - hue(l0))).toBeLessThan(4)
    expect(Math.abs(hue(r) - hue(l0))).toBeLessThan(4)
    expect(res.report.shading.max).toBeLessThanOrEqual(1.22)
    expect(res.report.shading.min).toBeGreaterThanOrEqual(0.5)
  })

  it('the shared grade is one function: plate and product pixels of the same color end up identical', () => {
    const grade = gradeFor({ ambient: [150, 120, 90], keyColor: [255, 230, 200], tone: { p5: 20, p50: 120, p95: 235 } } as LightModel)
    const a = Buffer.from([10, 120, 110, 200, 160, 40, 30, 30, 50])
    const b = Buffer.from(a)
    gradeRaw(a, 3, grade)
    gradeRaw(b, 3, grade)
    expect([...a]).toEqual([...b])
    // Near-black stays near-black and keeps its blue (no additive tint in deep shadows).
    expect(a[8]).toBeGreaterThan(a[6])
  })
})

describe('3 · shadows, reflection, grain', () => {
  it('shadow is ambient-tinted (not pure black) and falls away from the light on the surface', async () => {
    const c = await cut(await productOnWhite())
    const base = await plate('warm-wood')
    const box = fitBox({ width: c.width, height: c.height }, { x: 0.3 * W, y: 0.3 * H, w: 0.4 * W, h: 0.52 * H }, 'bottom')
    const comp = await compositeProducts({ base, products: [{ cutout: c.png, box }], light: 'left' })
    const plain = await compositeProducts({ base, products: [{ cutout: c.png, box }], light: 'left', harmonize: false, shadow: false })
    const right = { left: box.x + box.w + 6, top: box.y + box.h - 40, width: 60, height: 30 }
    const s = await regionMean(comp.png, right)
    const p = await regionMean(plain.png, right)
    expect(luma(s)).toBeLessThan(luma(p) * 0.92) // a real cast shadow
    expect(Math.min(...s)).toBeGreaterThan(8) // not pure black
    // Warm wood stays warm in shadow (tinted by the ambient, not a gray overlay).
    expect(s[0]).toBeGreaterThan(s[2])
  })

  it('glossy plate → faded reflection under the product; matte → none', async () => {
    const c = await cut(await productOnWhite())
    const base = await plate('bright-studio')
    const box = fitBox({ width: c.width, height: c.height }, { x: 0.3 * W, y: 0.3 * H, w: 0.4 * W, h: 0.52 * H }, 'bottom')
    const below = { left: box.x + Math.round(box.w * 0.25), top: box.y + box.h + 12, width: Math.round(box.w * 0.5), height: 20 }
    const glossy = await compositeProducts({ base, products: [{ cutout: c.png, box }], light: 'right', surface: 'glossy' })
    const matte = await compositeProducts({ base, products: [{ cutout: c.png, box }], light: 'right', surface: 'matte' })
    const g = await regionMean(glossy.png, below)
    const m = await regionMean(matte.png, below)
    // The teal product's reflection pulls the area toward green-blue.
    expect(g[1] - g[0]).toBeGreaterThan(m[1] - m[0] + 4)
  })

  it('grain match: a clean product gets the plate grain on a noisy plate, none on a clean one', async () => {
    const c = await cut(await productOnWhite())
    const placed = await sharp(c.png).png().toBuffer()
    const background = Buffer.alloc(c.width * c.height * 3, 160)
    const base: LightModel = {
      direction: 'left', prompted: 'left', estimated: null, gradient: 0, vector: [-0.83, -0.56], elevation: 0.45, keyFill: 1.3,
      temperature: 0, tint: 0, whiteBalance: [1, 1, 1], ambient: [160, 160, 160], keyColor: [255, 255, 255], noise: 4, acuity: 0.3,
      tone: { p5: 40, p50: 128, p95: 230 }, surface: 'matte',
    }
    const noisy = await harmonizeLayer({ placed, background, model: base, grade: null })
    const clean = await harmonizeLayer({ placed, background, model: { ...base, noise: 0 }, grade: null })
    expect(noisy.report.grainSigma).toBeGreaterThan(2.5)
    expect(clean.report.grainSigma).toBe(0)
  })
})

describe('4 · fidelity: light may change, the product may not', () => {
  it('the harmonized product PASSES on warm / cool / dark / bright / top-lit plates (bottle, mug, plane)', async () => {
    const products = [
      { bytes: await productOnWhite(), area: { x: 0.3, y: 0.3, w: 0.4, h: 0.52 } },
      { bytes: await mugPhoto(), area: { x: 0.24, y: 0.42, w: 0.52, h: 0.4 } },
      { bytes: await planePhoto(), area: { x: 0.12, y: 0.46, w: 0.76, h: 0.36 } },
    ]
    for (const spec of PLATES) {
      for (const pr of products) {
        const c = await cut(pr.bytes)
        const box = fitBox({ width: c.width, height: c.height }, { x: pr.area.x * W, y: pr.area.y * H, w: pr.area.w * W, h: pr.area.h * H }, 'bottom')
        const comp = await compositeProducts({ base: await plate(spec.name), products: [{ cutout: c.png, box }], light: spec.light, surface: spec.glossy ? 'glossy' : 'matte' })
        const p = comp.placements[0]
        const s = await scoreFidelity({ image: comp.png, box: p.box, reference: p.placed, background: p.background, method: 'harmonized' })
        expect(s.passed, `${spec.name}: ${JSON.stringify(s)}`).toBe(true)
        expect(s).toMatchObject({ method: 'harmonized' })
        expect(s.ssimDetail).toBeGreaterThanOrEqual(0.9)
        expect(s.silhouetteIoU).toBeGreaterThanOrEqual(FIDELITY_THRESHOLD.silhouetteIoU)
        expect(s.hueShift).toBeLessThanOrEqual(8)
      }
    }
  }, 240_000)

  it('an AI-style relight (strong directional gradient + warm cast on the product) PASSES', async () => {
    const c = await cut(await productOnWhite())
    const base = await plate('cool-concrete')
    const box = fitBox({ width: c.width, height: c.height }, { x: 0.3 * W, y: 0.3 * H, w: 0.4 * W, h: 0.52 * H }, 'bottom')
    const comp = await compositeProducts({ base, products: [{ cutout: c.png, box }], light: 'right', surface: 'matte' })
    const p = comp.placements[0]
    // Relight the product region: ×(0.7 → 1.15) left→right gradient and +4 % red / −4 % blue.
    const { data, info } = await sharp(comp.png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let y = p.box.y; y < p.box.y + p.box.h; y++) {
      for (let x = p.box.x; x < p.box.x + p.box.w; x++) {
        const g = 0.7 + 0.45 * ((x - p.box.x) / p.box.w)
        const o = (y * info.width + x) * 3
        data[o] = Math.min(255, Math.round(data[o] * g * 1.04))
        data[o + 1] = Math.min(255, Math.round(data[o + 1] * g))
        data[o + 2] = Math.min(255, Math.round(data[o + 2] * g * 0.96))
      }
    }
    const relit = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()
    const s = await scoreFidelity({ image: relit, box: p.box, reference: p.placed, background: p.background, method: 'relit' })
    expect(s.passed, JSON.stringify(s)).toBe(true)
  })

  it('redrawn / reshaped / recolored / repainted products still FAIL, even after harmonization', async () => {
    const c = await cut(await planePhoto())
    const base = await plate('warm-wood')
    const box = fitBox({ width: c.width, height: c.height }, { x: 0.12 * W, y: 0.46 * H, w: 0.76 * W, h: 0.36 * H }, 'bottom')
    const ref = (await compositeProducts({ base, products: [{ cutout: c.png, box }], light: 'left' })).placements[0]
    const { w, h } = ref.box
    const variants: Array<[string, Buffer, (s: Awaited<ReturnType<typeof scoreFidelity>>) => boolean]> = [
      ['recolored (hue)', await sharp(ref.placed).modulate({ hue: 70 }).png().toBuffer(), (s) => s.hueShift > FIDELITY_THRESHOLD.hueShift],
      ['reshaped (8 % wider)', await sharp(await sharp(ref.placed).resize(Math.round(w * 1.08), h, { fit: 'fill' }).png().toBuffer()).extract({ left: Math.round(w * 0.04), top: 0, width: w, height: h }).png().toBuffer(), (s) => s.silhouetteIoU < FIDELITY_THRESHOLD.silhouetteIoU || s.ssimDetail < FIDELITY_THRESHOLD.ssimDetail],
      ['redrawn (mirrored details)', await sharp(ref.placed).flop().png().toBuffer(), (s) => s.ssimDetail < FIDELITY_THRESHOLD.ssimDetail],
      ['repainted (detail lost)', await sharp(ref.placed).blur(4).png().toBuffer(), (s) => s.ssimDetail < FIDELITY_THRESHOLD.ssimDetail],
    ]
    for (const [name, layer, why] of variants) {
      const img = await compositeProducts({ base, products: [{ cutout: layer, box: ref.box }], light: 'left' })
      const s = await scoreFidelity({ image: img.png, box: ref.box, reference: ref.placed, background: ref.background, method: 'relit' })
      expect(s.passed, `${name}: ${JSON.stringify(s)}`).toBe(false)
      expect(why(s), `${name}: ${JSON.stringify(s)}`).toBe(true)
    }
  }, 120_000)

  it('reports {score, ssimDetail, silhouetteIoU, hueShift, chromaRatio, deltaE, passed, method}', async () => {
    const c = await cut(await productOnWhite())
    const box = fitBox({ width: c.width, height: c.height }, { x: 0.3 * W, y: 0.3 * H, w: 0.4 * W, h: 0.52 * H }, 'bottom')
    const comp = await compositeProducts({ base: await plate('pastel-pink'), products: [{ cutout: c.png, box }], light: 'top' })
    const p = comp.placements[0]
    const s = await scoreFidelity({ image: comp.png, box: p.box, reference: p.placed, background: p.background, method: 'harmonized' })
    for (const k of ['score', 'ssimDetail', 'silhouetteIoU', 'hueShift', 'chromaRatio', 'deltaE', 'passed', 'method'] as const) expect(s).toHaveProperty(k)
    expect(s.ssim).toBe(s.ssimDetail)
  })
})
