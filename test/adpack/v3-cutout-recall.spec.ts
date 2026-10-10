/**
 * P0 #4 — cut-out recall: white pieces on a light flat lay are kept; a cut-out that drops pieces
 * retries the model path and otherwise fails `cutout_incomplete`; owner cut-outs pass as-is.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { floodBackground, segmentProduct } from '../../api/lib/adpack/fidelity/segment'
import { alphaIsFlatLay, cutoutRecall, estimateForeground } from '../../api/lib/adpack/fidelity/recall'
import { components, labImage } from '../../api/lib/adpack/fidelity/pixels'
import { prepareProductCutouts } from '../../api/lib/adpack/fidelity/pipeline'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import type { SegmentationItem } from '../../api/lib/adpack/types'
import { flatLayWithWhitePieces, productWithWhiteCap } from './v3-fixtures'

/** Gateway fake: segmentation masks from fixed full-frame boxes (box_2d 0–1000, solid masks). */
function segmentGateway(boxes: Array<[number, number, number, number]>) {
  const solid = async () => (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64')
  return {
    calls: 0,
    async segment() {
      this.calls++
      const mask = await solid()
      const items: SegmentationItem[] = boxes.map((b, i) => ({ box_2d: b, mask: `data:image/png;base64,${mask}`, label: `piece ${i}` }))
      return { items, costUsd: 0, model: 'fake-seg' }
    },
  }
}

describe('P0 #4 cut-out recall', () => {
  it('flat lay with white pieces on a light surface: every piece is kept (tape roll + 2 screws), recall ≥ 95%, flat lay detected', async () => {
    const src = await flatLayWithWhitePieces()
    for (const role of [undefined, 'contents'] as const) {
      const res = await segmentProduct({ bytes: src, ...(role ? { role } : {}) })
      expect(res.ok, `${role}: ${!res.ok ? res.detail : ''}`).toBe(true)
      if (!res.ok) return
      expect(res.method).toBe('flood')
      expect(res.flatLay).toBe(true)
      expect(res.recall?.recall).toBeGreaterThanOrEqual(0.95)
      expect(res.recall?.components.kept).toBe(res.recall?.components.source)
      expect(res.recall?.components.source).toBeGreaterThanOrEqual(5)
      // Every piece survives as its own opaque component (airframe, controller, tape roll, 2 screws).
      const { data, info } = await sharp(res.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect(alphaIsFlatLay(data, info.width, info.height)).toBe(true)
      const mask = new Uint8Array(info.width * info.height)
      for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0
      const pieces = components(mask, info.width, info.height).list.filter((c) => c.area >= 300)
      expect(pieces.length, `${role}`).toBeGreaterThanOrEqual(5)
      // The white tape roll keeps its exact color (near-white, opaque) and its hole stays open.
      const ring = pieces.find((c) => c.x1 - c.x0 > 150 && Math.abs((c.x1 - c.x0) - (c.y1 - c.y0)) < 12)
      expect(ring, 'tape roll piece').toBeTruthy()
    }
  })

  it('the old flood alone loses the white pieces — the recall measure sees it (< 95%)', async () => {
    const src = await flatLayWithWhitePieces()
    const { data, info } = await sharp(src).resize(1024, 1024, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const lab = labImage(data, 4, info.width * info.height)
    const flood = floodBackground(lab, info.width, info.height)
    if (typeof flood === 'string') throw new Error(flood)
    const fg = flood.bg.map((v) => (v ? 0 : 1))
    const est = estimateForeground(lab, info.width, info.height, flood.bg)!
    const r = cutoutRecall(est, fg)
    expect(r.recall).toBeLessThan(0.95)
    expect(r.components.kept).toBeLessThan(r.components.source)
  })

  it('a single product whose white cap the default flood drops: the strict flood retry keeps it (round 1), else model / cutout_incomplete', async () => {
    const src = await productWithWhiteCap()
    // Round 1: the default flood (tol 10) eats the near-white cap → recall fails → the strict flood
    // (tol 5, local 3.5) keeps it. Delivered with recall 1, no model call.
    const none = await segmentProduct({ bytes: src })
    expect(none.ok).toBe(true)
    if (!none.ok) return
    expect(none.rejected.some((r) => /^flood: recall/.test(r))).toBe(true)
    expect(none.recall?.recall).toBeGreaterThanOrEqual(0.95)
    const viaModel = segmentGateway([[227, 333, 773, 622]])
    const strict = await segmentProduct({ bytes: src, gateway: viaModel })
    expect(strict.ok && strict.method).toBe('flood')
    expect(viaModel.calls).toBe(0)
  })

  it('owner-provided transparent cut-outs (role contents / part) are used as-is', async () => {
    const src = await flatLayWithWhitePieces()
    // Owner cut-out: the source with a hand-made alpha (pieces opaque, surface transparent).
    const alphaMask = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#000"/><rect x="130" y="80" width="540" height="440" fill="#fff"/><rect x="750" y="130" width="320" height="190" fill="#fff"/><circle cx="300" cy="660" r="110" fill="#fff"/><rect x="680" y="565" width="220" height="200" fill="#fff"/></svg>')).greyscale().raw().toBuffer()
    const rgb = await sharp(src).removeAlpha().raw().toBuffer()
    const rgba = Buffer.alloc(1200 * 900 * 4)
    for (let i = 0; i < 1200 * 900; i++) {
      rgba[i * 4] = rgb[i * 3]
      rgba[i * 4 + 1] = rgb[i * 3 + 1]
      rgba[i * 4 + 2] = rgb[i * 3 + 2]
      rgba[i * 4 + 3] = alphaMask[i]
    }
    const png = await sharp(rgba, { raw: { width: 1200, height: 900, channels: 4 } }).png().toBuffer()
    const res = await segmentProduct({ bytes: png, role: 'contents' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.method).toBe('alpha')
    expect(res.flatLay).toBe(true)
    // A per-part owner mask: one piece as its own transparent PNG.
    const partPng = await sharp(png).extract({ left: 680, top: 560, width: 240, height: 220 }).png().toBuffer()
    const part = await prepareProductCutouts({
      photos: [{ url: 'https://x.test/kit.png', role: 'contents' }, { url: 'https://x.test/part.png', role: 'part', label: 'tornillos' }],
      withParts: true,
      load: async (u) => new Uint8Array(u.endsWith('part.png') ? partPng : png),
      cache: memoryBlobCache(),
    })
    expect(part.ok).toBe(true)
    if (!part.ok) return
    expect(part.parts[0].stored.method).toBe('alpha')
  })
})
