import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { compositeProducts, fitBox, harmonizeGains, HARMONIZE_MAX_GAIN, layoutProductGroup } from '../../api/lib/adpack/fidelity/composite'
import { analyzeAssetQuality, pickProductImage, type PoolImage } from '../../api/lib/adpack/fidelity/asset-quality'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { cutoutForPhoto, prepareProductCutouts, resolveProductPhotos } from '../../api/lib/adpack/fidelity/pipeline'
import { roleFromLabel } from '../../api/lib/adpack/fidelity/photos'
import { relightComposite } from '../../api/lib/adpack/fidelity/relight'
import { FIDELITY_THRESHOLD, scoreFidelity, worstFidelity } from '../../api/lib/adpack/fidelity/score'
import { masksToFrame, segmentProduct, validateMask } from '../../api/lib/adpack/fidelity/segment'
import { parseSegmentationItems } from '../../api/lib/adpack/gateway'
import type { SegmentationItem } from '../../api/lib/adpack/types'
import { busyBlocks, busyPhoto, partOnGray, productAlphaPng, productOnColor, productOnWhite, productSvgBody, syntheticPlate } from './fidelity-fixtures'

/** Mean of a region (sharp's stats() ignores extract(), so crop first). */
async function regionMean(png: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<number> {
  const st = await sharp(await sharp(png).extract(region).png().toBuffer()).stats()
  return st.channels[0].mean
}

async function alphaStats(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let transparent = 0
  for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] < 16) transparent++
  const corner = data[3]
  return { width: info.width, height: info.height, transparentShare: transparent / (info.width * info.height), corner }
}

/** A fake gateway.segment that returns the documented Gemini format for a known box. */
function segmentGateway(items: SegmentationItem[] | (() => SegmentationItem[])) {
  const calls: Array<{ image: string; prompt?: string }> = []
  return {
    calls,
    async segment(input: { image: string; prompt?: string }) {
      calls.push(input)
      return { items: typeof items === 'function' ? items() : items, costUsd: 0.001, model: 'fake-seg' }
    },
  }
}

async function ellipseMaskB64(w: number, h: number): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 2}" ry="${h / 2 - 2}" fill="#fff"/></svg>`
  return (await sharp(Buffer.from(svg)).greyscale().png().toBuffer()).toString('base64')
}

describe('segmentProduct (cut-out strategy chain)', () => {
  it('a) passes a PNG with meaningful alpha through untouched (trimmed)', async () => {
    const res = await segmentProduct({ bytes: await productAlphaPng() })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.method).toBe('alpha')
    // Product spans x 170–430, y 110–690 in the 600×800 source (+2 px margin).
    expect(res.width).toBeGreaterThanOrEqual(260)
    expect(res.width).toBeLessThanOrEqual(266)
    expect(res.height).toBeGreaterThanOrEqual(580)
    expect(res.height).toBeLessThanOrEqual(586)
  })

  it('b) floods a clean white background: tight cut-out, transparent outside, opaque inside', async () => {
    const res = await segmentProduct({ bytes: await productOnWhite() })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.method).toBe('flood')
    expect(res.coverage).toBeGreaterThan(0.25)
    expect(res.coverage).toBeLessThan(0.33)
    expect(Math.abs(res.width - 264)).toBeLessThanOrEqual(6)
    expect(Math.abs(res.height - 584)).toBeLessThanOrEqual(6)
    const st = await alphaStats(res.png)
    expect(st.corner).toBeLessThan(16) // rounded-corner area of the body/cap is background
    // Interior pixel (amber label band, between the stripes) fully opaque and unchanged in color.
    const { data } = await sharp(res.png).extract({ left: Math.round(res.width / 2), top: Math.round(res.height * 0.62), width: 1, height: 1 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(255)
    expect(data[0]).toBeGreaterThan(220) // amber label band
  })

  it('b) works on a colored seamless backdrop with a gradient', async () => {
    const res = await segmentProduct({ bytes: await productOnColor() })
    expect(res.ok && res.method).toBe('flood')
  })

  it('c) falls back to model segmentation (documented box_2d 0–1000 + mask PNG, threshold 127) on busy photos', async () => {
    const mask = await ellipseMaskB64(100, 160)
    const gw = segmentGateway([{ box_2d: [200, 250, 800, 750], mask: `data:image/png;base64,${mask}`, label: 'product' }])
    const res = await segmentProduct({ bytes: await busyPhoto(), gateway: gw, label: 'botella' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.method).toBe('model')
    expect(res.rejected[0]).toMatch(/^alpha:/)
    expect(res.rejected[1]).toMatch(/^flood: background not uniform/)
    expect(gw.calls[0].prompt).toMatch(/box_2d/)
    expect(gw.calls[0].prompt).toMatch(/botella/)
    // Box 50% × 60% of 480×640 → cut-out ≈ 240×384.
    expect(Math.abs(res.width - 240)).toBeLessThanOrEqual(8)
    expect(Math.abs(res.height - 384)).toBeLessThanOrEqual(8)
  })

  it('d) never silently falls back: no clean background + no model → cutout_failed with reasons', async () => {
    const res = await segmentProduct({ bytes: await busyPhoto() })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('cutout_failed')
    expect(res.detail).toMatch(/background not uniform/)
    expect(res.detail).toMatch(/model segmentation unavailable/)
  })

  it('rejects a model mask that covers the whole frame (no background) or is tiny', async () => {
    const full = await ellipseMaskB64(64, 64)
    const whole = segmentGateway([{ box_2d: [0, 0, 1000, 1000], mask: (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64'), label: 'x' }])
    expect((await segmentProduct({ bytes: await busyPhoto(), gateway: whole })).ok).toBe(false)
    const tiny = segmentGateway([{ box_2d: [10, 10, 40, 40], mask: full, label: 'x' }])
    const res = await segmentProduct({ bytes: await busyPhoto(), gateway: tiny })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.detail).toMatch(/foreground .*% < 5%/)
  })

  it('validateMask: area 5–90%, single dominant component, not touching all borders', () => {
    const w = 100
    const h = 100
    const mk = (fill: (x: number, y: number) => boolean) => Uint8Array.from({ length: w * h }, (_, i) => (fill(i % w, Math.floor(i / w)) ? 1 : 0))
    expect(validateMask(mk((x, y) => x > 30 && x < 70 && y > 20 && y < 80), w, h)).toBeNull()
    expect(validateMask(mk((x, y) => x < 2 && y < 2), w, h)).toMatch(/< 5%/)
    expect(validateMask(mk(() => true), w, h)).toMatch(/> 90%/)
    expect(validateMask(mk((x, y) => (x > 5 && x < 40 && y > 10 && y < 60) || (x > 55 && x < 90 && y > 10 && y < 60)), w, h)).toMatch(/dominant/)
    expect(validateMask(mk((x, y) => (x > 5 && x < 40 && y > 10 && y < 60) || (x > 55 && x < 90 && y > 10 && y < 60)), w, h, { allowMulti: true })).toBeNull()
    expect(validateMask(mk((x, y) => x < 3 || y < 3 || x > 96 || y > 96), w, h, { allowMulti: true })).toMatch(/all four borders/)
  })

  it('masksToFrame places each item mask in its box (threshold 127)', async () => {
    const half = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).composite([{ input: await sharp({ create: { width: 5, height: 10, channels: 3, background: '#000000' } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer()
    const frame = await masksToFrame([{ box_2d: [0, 0, 1000, 1000], mask: half.toString('base64'), label: 'p' }], 20, 20)
    expect(frame[10 * 20 + 2]).toBe(0) // left half dark → below threshold
    expect(frame[10 * 20 + 17]).toBe(1)
  })

  it('gateway parses the documented segmentation JSON and drops malformed entries', () => {
    const items = parseSegmentationItems([
      { box_2d: [10, 20, 500, 600], mask: 'data:image/png;base64,AAA', label: 'bottle' },
      { box_2d: [1, 2, 3], mask: 'x', label: 'bad box' },
      { box_2d: [1, 2, 3, 4], label: 'no mask' },
    ])
    expect(items).toEqual([{ box_2d: [10, 20, 500, 600], mask: 'data:image/png;base64,AAA', label: 'bottle' }])
    expect(parseSegmentationItems({ masks: [{ box_2d: [0, 0, 10, 10], mask: 'm', label: 'l' }] })).toHaveLength(1)
  })
})

describe('scoreFidelity', () => {
  async function placed() {
    const res = await segmentProduct({ bytes: await productOnWhite() })
    if (!res.ok) throw new Error('cutout')
    const box = fitBox({ width: res.width, height: res.height }, { x: 300, y: 200, w: 400, h: 600 })
    const ref = await sharp(res.png).resize(box.w, box.h, { fit: 'fill' }).png().toBuffer()
    return { box, ref }
  }

  it('identical product pixels → score ≈ 1 and passed', async () => {
    const { box, ref } = await placed()
    const img = await sharp(await syntheticPlate(1080, 1350)).composite([{ input: ref, left: box.x, top: box.y }]).png().toBuffer()
    const s = await scoreFidelity({ image: img, box, reference: ref, diff: true })
    expect(s.ssim).toBeGreaterThan(0.995)
    expect(s.deltaE).toBeLessThan(1)
    expect(s.score).toBeGreaterThan(0.99)
    expect(s.passed).toBe(true)
    const meta = await sharp(s.diffPng!).metadata()
    expect([meta.width, meta.height]).toEqual([box.w, box.h])
  })

  it('a recolored product (hélices grises en vez de blancas) fails on ΔE', async () => {
    const { box, ref } = await placed()
    const recolored = await sharp(ref).modulate({ hue: 90 }).png().toBuffer()
    const img = await sharp(await syntheticPlate(1080, 1350)).composite([{ input: recolored, left: box.x, top: box.y }]).png().toBuffer()
    const s = await scoreFidelity({ image: img, box, reference: ref })
    expect(s.deltaE).toBeGreaterThan(FIDELITY_THRESHOLD.deltaE)
    expect(s.passed).toBe(false)
  })

  it('a redrawn product (different shape / details) fails on SSIM', async () => {
    const { box, ref } = await placed()
    // "Redraw": a different object of similar colors where the product should be.
    const other = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}"><rect width="${box.w}" height="${box.h}" fill="#0f766e"/>` +
        Array.from({ length: 12 }, (_, i) => `<rect x="0" y="${i * (box.h / 12)}" width="${box.w}" height="${box.h / 30}" fill="${i % 2 ? '#f59e0b' : '#1f2937'}"/>`).join('') +
        '</svg>',
    )
    const img = await sharp(await syntheticPlate(1080, 1350)).composite([{ input: await sharp(other).png().toBuffer(), left: box.x, top: box.y }]).png().toBuffer()
    const s = await scoreFidelity({ image: img, box, reference: ref })
    expect(s.ssim).toBeLessThan(FIDELITY_THRESHOLD.ssim)
    expect(s.passed).toBe(false)
  })

  it('worstFidelity picks a failing ratio over passing ones', () => {
    const worst = worstFidelity([
      { fidelity: { score: 0.99, ssim: 0.99, deltaE: 1, passed: true, method: 'composite' as const, ratio: '1:1' as const } },
      { fidelity: { score: 0.95, ssim: 0.89, deltaE: 2, passed: false, method: 'composite' as const, ratio: '9:16' as const } },
    ])
    expect(worst?.ratio).toBe('9:16')
  })
})

describe('compositeProducts', () => {
  it('keeps the product pixels (SSIM ≥ 0.98 with harmonization; ~1 without) and caps gains', async () => {
    const cut = await segmentProduct({ bytes: await productOnWhite() })
    if (!cut.ok) throw new Error('cutout')
    const plate = await syntheticPlate(1080, 1350)
    const box = fitBox({ width: cut.width, height: cut.height }, { x: 560, y: 380, w: 420, h: 760 })
    for (const harmonize of [false, true]) {
      const comp = await compositeProducts({ base: plate, products: [{ cutout: cut.png, box }], light: 'left', harmonize })
      const s = await scoreFidelity({ image: comp.png, box: comp.placements[0].box, reference: comp.placements[0].placed })
      expect(s.ssim).toBeGreaterThanOrEqual(harmonize ? 0.98 : 0.999)
      expect(s.passed).toBe(true)
      for (const g of comp.gains) expect(Math.abs(g - 1)).toBeLessThanOrEqual(HARMONIZE_MAX_GAIN + 1e-9)
    }
  })

  it('draws a contact shadow under the product (darker than the bare plate) on the side away from the light', async () => {
    const cut = await segmentProduct({ bytes: await productOnWhite() })
    if (!cut.ok) throw new Error('cutout')
    const plate = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#d9d4cc' } }).png().toBuffer()
    const box = fitBox({ width: cut.width, height: cut.height }, { x: 250, y: 200, w: 300, h: 600 })
    const comp = await compositeProducts({ base: plate, products: [{ cutout: cut.png, box }], light: 'left' })
    const under = await regionMean(comp.png, { left: box.x + Math.round(box.w * 0.3), top: box.y + box.h - 2, width: Math.round(box.w * 0.4), height: 6 })
    expect(under).toBeLessThan(200) // plate is 217
    const right = await regionMean(comp.png, { left: box.x + box.w + 2, top: box.y + Math.round(box.h * 0.5), width: 8, height: 40 })
    const left = await regionMean(comp.png, { left: box.x - 10, top: box.y + Math.round(box.h * 0.5), width: 8, height: 40 })
    expect(right).toBeLessThan(left) // cast shadow falls right with light from the left
    expect(await regionMean(comp.png, { left: 10, top: 10, width: 40, height: 40 })).toBeCloseTo(217, 0) // far away: untouched plate
  })

  it('harmonizeGains is luminance-neutral and capped', () => {
    const g = harmonizeGains([20, 40, 200])
    expect(Math.max(...g.map((v) => Math.abs(v - 1)))).toBeLessThanOrEqual(HARMONIZE_MAX_GAIN + 1e-9)
    for (const v of harmonizeGains([128, 128, 128])) expect(v).toBeCloseTo(1, 9)
  })

  it('layoutProductGroup: hero on top, real parts in a row underneath, inside the box, aspect kept', () => {
    const box = { x: 100, y: 100, w: 400, h: 600 }
    const [hero, part] = layoutProductGroup(box, { width: 260, height: 580 }, [{ width: 640, height: 420 }])
    expect(hero.y + hero.h).toBeLessThanOrEqual(part.y)
    for (const b of [hero, part]) {
      expect(b.x).toBeGreaterThanOrEqual(box.x)
      expect(b.x + b.w).toBeLessThanOrEqual(box.x + box.w)
      expect(b.y + b.h).toBeLessThanOrEqual(box.y + box.h)
    }
    expect(Math.abs(hero.w / hero.h - 260 / 580)).toBeLessThan(0.02)
    expect(Math.abs(part.w / part.h - 640 / 420)).toBeLessThan(0.03)
  })
})

describe('relightComposite', () => {
  async function setup() {
    const cut = await segmentProduct({ bytes: await productOnWhite() })
    if (!cut.ok) throw new Error('cutout')
    const box = fitBox({ width: cut.width, height: cut.height }, { x: 560, y: 380, w: 420, h: 760 })
    return compositeProducts({ base: await syntheticPlate(1080, 1350), products: [{ cutout: cut.png, box }] })
  }

  it('keeps a relight that only shifts light a little', async () => {
    const comp = await setup()
    const gw = { async edit() { return { bytes: new Uint8Array(await sharp(comp.png).modulate({ brightness: 1.02 }).png().toBuffer()), mimeType: 'image/png', costUsd: 0.02, model: 'fake-edit' } } }
    const res = await relightComposite({ gateway: gw, composite: comp.png, placements: comp.placements, ratio: '4:5' })
    expect(res.relit).toBe(true)
    expect(res.scores[0].passed).toBe(true)
  })

  it('rejects a relight that redraws the product and keeps the deterministic composite', async () => {
    const comp = await setup()
    const redrawn = await sharp(comp.png).composite([{ input: await sharp({ create: { width: comp.placements[0].box.w, height: comp.placements[0].box.h, channels: 3, background: '#7c3aed' } }).png().toBuffer(), left: comp.placements[0].box.x, top: comp.placements[0].box.y }]).png().toBuffer()
    const gw = { async edit() { return { bytes: new Uint8Array(redrawn), mimeType: 'image/png', costUsd: 0.02, model: 'fake-edit' } } }
    const res = await relightComposite({ gateway: gw, composite: comp.png, placements: comp.placements })
    expect(res.relit).toBe(false)
    expect(res.reason).toBe('relight_rejected_low_fidelity')
    expect(res.png).toBe(comp.png)
  })
})

describe('asset quality + photo pick (C3/C4)', () => {
  it('flags blurry and low-resolution photos with plain-language warnings', async () => {
    const sharpPhoto = await analyzeAssetQuality(await sharp(await productOnWhite()).resize(1200, 1600).jpeg().toBuffer())
    const blurry = await analyzeAssetQuality(await sharp(await productOnWhite()).resize(1200, 1600).blur(12).jpeg().toBuffer())
    const tiny = await analyzeAssetQuality(await sharp(await productOnWhite()).resize(300, 400).jpeg().toBuffer())
    expect(sharpPhoto.blurry).toBe(false)
    expect(sharpPhoto.warnings).toEqual([])
    expect(sharpPhoto.backgroundClean).toBeGreaterThan(0.9)
    expect(blurry.blurry).toBe(true)
    expect(blurry.warnings).toContain('foto borrosa')
    expect(blurry.sharpness).toBeLessThan(sharpPhoto.sharpness)
    expect(tiny.warnings).toContain('baja resolución, se verá blanda')
    const busy = await analyzeAssetQuality(await busyBlocks(), 'en')
    expect(busy.warnings.join(' ')).toMatch(/busy background/)
  })

  it('pickProductImage: role first, never blurry when a sharp one exists, format preferences, parts excluded', () => {
    const q = (score: number, blurry = false) => ({ width: 1500, height: 2000, megapixels: 3, sharpness: blurry ? 10 : 500, sharpnessScore: score, backgroundClean: 1, hasAlpha: false, lowResolution: false, blurry, warnings: blurry ? ['foto borrosa'] : [], score })
    const pool: PoolImage[] = [
      { url: 'whatsapp-latest', role: 'hero', quality: q(0.2, true) },
      { url: 'studio-hero', role: 'hero', quality: q(0.8) },
      { url: 'in-use', role: 'in_use', quality: q(0.9) },
      { url: 'controller', role: 'part', quality: q(0.95) },
      { url: 'box', role: 'box', quality: q(0.7) },
    ]
    expect(pickProductImage(pool, { format: 'offer_graphic' })?.url).toBe('studio-hero')
    expect(pickProductImage(pool, { format: 'how_to_steps' })?.url).toBe('in-use')
    expect(pickProductImage(pool, { role: 'box' })?.url).toBe('box')
    expect(pickProductImage(pool, { role: 'part' })?.url).toBe('controller')
    expect(pickProductImage(pool.filter((p) => p.url !== 'studio-hero' && p.url !== 'box' && p.url !== 'in-use'), { format: 'offer_graphic' })?.url).toBe('whatsapp-latest') // only option left
    expect(pickProductImage([], {})).toBeNull()
  })

  it('roles from owner labels and default roles from plain URLs', () => {
    expect(roleFromLabel('Control tipo gamepad')).toBe('part')
    expect(roleFromLabel('Caja')).toBe('box')
    expect(roleFromLabel('Contenido del kit')).toBe('contents')
    expect(roleFromLabel('foto en uso')).toBe('in_use')
    expect(roleFromLabel('')).toBeUndefined()
    expect(resolveProductPhotos({ productImageUrls: ['a', 'b'] })).toEqual([{ url: 'a', role: 'hero' }, { url: 'b', role: 'detail' }])
  })
})

describe('cut-out cache + multi-part preparation (H3)', () => {
  it('caches cut-outs by content hash and reuses them', async () => {
    const cache = memoryBlobCache()
    const photo = await productOnWhite()
    const load = async () => new Uint8Array(photo)
    const first = await cutoutForPhoto({ url: 'https://x.test/a.jpg', role: 'hero' }, { cache, load })
    const second = await cutoutForPhoto({ url: 'https://x.test/a-copy.jpg', role: 'hero' }, { cache, load })
    expect('error' in first).toBe(false)
    expect('error' in second).toBe(false)
    if ('error' in first || 'error' in second) return
    expect(first.stored.method).toBe('flood')
    expect(second.stored.method).toBe('cache')
    expect(second.stored.sourceHash).toBe(first.stored.sourceHash)
    expect(cache.entries.size).toBe(1)
    expect(cache.hits).toBe(1)
  })

  it('prepares hero + real parts; a part that cannot be cut out is skipped, never synthesized', async () => {
    const files: Record<string, Buffer> = { hero: await productOnWhite(), pad: await partOnGray(), noisy: await busyPhoto() }
    const res = await prepareProductCutouts({
      photos: [
        { url: 'hero', role: 'hero' },
        { url: 'pad', role: 'part', label: 'control tipo gamepad' },
        { url: 'noisy', role: 'part', label: 'hélice' },
      ],
      format: 'offer_graphic',
      load: async (u) => new Uint8Array(files[u]),
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.hero.stored.sourceUrl).toBe('hero')
    expect(res.parts.map((p) => p.stored.label)).toEqual(['control tipo gamepad'])
    expect(res.warnings.join(' ')).toMatch(/hélice.*skipped/)
  })

  it('tries the next best photo when the preferred one cannot be cut out, then fails with cutout_failed', async () => {
    const files: Record<string, Buffer> = { a: await busyPhoto(), b: await productOnWhite() }
    const ok = await prepareProductCutouts({ photos: [{ url: 'a', role: 'hero' }, { url: 'b', role: 'detail' }], load: async (u) => new Uint8Array(files[u]) })
    expect(ok.ok && ok.hero.stored.sourceUrl).toBe('b')
    const bad = await prepareProductCutouts({ photos: [{ url: 'a', role: 'hero' }], load: async (u) => new Uint8Array(files[u]) })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/^cutout_failed/)
  })
})

// Keep the svg helper referenced (fixtures share it with the QA set).
void productSvgBody
