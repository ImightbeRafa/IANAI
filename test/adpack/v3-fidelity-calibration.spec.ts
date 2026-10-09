/**
 * P0 #3 — fidelity calibration for dark / low-texture parts: a matte black product relit
 * deterministically (and with AI-like grain) passes; an actually altered product still fails.
 * Native-resolution silhouette IoU, diff heatmap at placement resolution.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { segmentProduct } from '../../api/lib/adpack/fidelity/segment'
import { compositeProducts, fitBox } from '../../api/lib/adpack/fidelity/composite'
import { scoreFidelity } from '../../api/lib/adpack/fidelity/score'
import { gaussianRng } from '../../api/lib/adpack/fidelity/pixels'
import { matteBlackProduct } from './v3-fixtures'

async function plate(w = 1080, h = 1350): Promise<Buffer> {
  const body = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8cfc2"/><stop offset="1" stop-color="#b9a993"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)).png().toBuffer()
}

/** AI-like relight of the product box: smooth gain + fresh grain (what an image-edit pass does to a flat black part). */
async function aiLikeRelight(png: Buffer, box: { x: number; y: number; w: number; h: number }, seed = 7): Promise<Buffer> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const rng = gaussianRng(seed)
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const gain = 1 + 0.3 * ((x - box.x) / box.w)
      const n = rng() * 6
      const o = (y * info.width + x) * 3
      for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round(data[o + c] * gain + n)))
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()
}

/** An actual alteration: a white logo painted on the product + one button removed. */
async function alter(png: Buffer, box: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const w = Math.round(box.w * 0.3)
  const h = Math.round(box.h * 0.12)
  const patch = await sharp({ create: { width: w, height: h, channels: 3, background: '#f2f2f2' } }).png().toBuffer()
  const dot = await sharp({ create: { width: Math.round(box.w * 0.12), height: Math.round(box.w * 0.12), channels: 3, background: '#141414' } }).png().toBuffer()
  return sharp(png)
    .composite([
      { input: patch, left: box.x + Math.round(box.w * 0.35), top: box.y + Math.round(box.h * 0.2) },
      { input: dot, left: box.x + Math.round(box.w * 0.24), top: box.y + Math.round(box.h * 0.4) },
    ])
    .png()
    .toBuffer()
}

describe('P0 #3 fidelity calibration (dark / low-texture parts)', () => {
  it('matte black product: deterministic relight passes, AI-like grain + gain passes, an altered product fails', async () => {
    const cut = await segmentProduct({ bytes: await matteBlackProduct() })
    expect(cut.ok).toBe(true)
    if (!cut.ok) return
    const base = await plate()
    const box = fitBox({ width: cut.width, height: cut.height }, { x: 140, y: 520, w: 800, h: 560 }, 'bottom')
    const comp = await compositeProducts({ base, products: [{ cutout: cut.png, box, role: 'hero' }], light: 'left' })
    const p = comp.placements[0]
    const auto = await scoreFidelity({ image: comp.png, box: p.box, reference: p.placed, background: p.background, method: 'harmonized' })
    expect(auto.passed, JSON.stringify(auto)).toBe(true)

    const ai = await scoreFidelity({ image: await aiLikeRelight(comp.png, p.box), box: p.box, reference: p.placed, background: p.background, method: 'relit' })
    expect(ai.passed, JSON.stringify(ai)).toBe(true)

    // A reshape: a chunk of the product replaced by the plate behind it → silhouette fails.
    const chunk = await sharp(p.background!).extract({ left: Math.round(p.box.w * 0.7), top: 0, width: Math.round(p.box.w * 0.3), height: p.box.h }).png().toBuffer()
    const reshaped = await sharp(comp.png).composite([{ input: chunk, left: p.box.x + Math.round(p.box.w * 0.7), top: p.box.y }]).png().toBuffer()
    const cutShape = await scoreFidelity({ image: reshaped, box: p.box, reference: p.placed, background: p.background, method: 'harmonized' })
    expect(cutShape.passed, JSON.stringify(cutShape)).toBe(false)
    expect(cutShape.silhouetteIoU).toBeLessThan(0.98)

    const altered = await scoreFidelity({ image: await alter(comp.png, p.box), box: p.box, reference: p.placed, background: p.background, method: 'harmonized', diff: true })
    expect(altered.passed, JSON.stringify({ ...altered, diffPng: undefined })).toBe(false)
    // Diff heatmap at (at least) placement resolution — readable, never a thumbnail.
    const m = await sharp(altered.diffPng!).metadata()
    expect(Math.max(m.width!, m.height!)).toBeGreaterThanOrEqual(Math.max(p.box.w, p.box.h))
  }, 60_000)

  it('small placements still get a legible diff (long side ≥ 512 px)', async () => {
    const cut = await segmentProduct({ bytes: await matteBlackProduct() })
    if (!cut.ok) throw new Error('cutout')
    const box = fitBox({ width: cut.width, height: cut.height }, { x: 300, y: 900, w: 150, h: 110 }, 'bottom')
    const comp = await compositeProducts({ base: await plate(), products: [{ cutout: cut.png, box, role: 'part' }], light: 'left' })
    const p = comp.placements[0]
    const s = await scoreFidelity({ image: comp.png, box: p.box, reference: p.placed, background: p.background, diff: true })
    const m = await sharp(s.diffPng!).metadata()
    expect(Math.max(m.width!, m.height!)).toBeGreaterThanOrEqual(512)
  }, 60_000)
})
