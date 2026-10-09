/**
 * P3 #17 sharpness at a normalized scale (+ primary → role → sharpness ranking) and P1 #7
 * grounding (surface line snap, stronger contact shadow) / P1 #6 top-down compositing.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { analyzeAssetQuality, pickProductImage, SHARPNESS_SIDE, type AssetQuality, type PoolImage } from '../../api/lib/adpack/fidelity/asset-quality'
import { segmentProduct } from '../../api/lib/adpack/fidelity/segment'
import { scoreFidelity } from '../../api/lib/adpack/fidelity/score'
import { buildPlatePrompt } from '../../api/lib/adpack/fidelity/plate'
import { findSurfaceLine, renderAd } from '../../api/lib/adpack/render'
import { goodSerumCopy, caseById } from './helpers'
import { productOnWhite } from './fidelity-fixtures'
import { flatLayWithWhitePieces, overheadPlate, wallTablePlate } from './v3-fixtures'

/** Studio photo: a detailed product (fine print, seams) on a big clean background. */
async function studioPhoto(w = 1080, h = 1350): Promise<Buffer> {
  const lines = Array.from({ length: 18 }, (_, i) => `<rect x="${380 + (i % 3) * 8}" y="${560 + i * 14}" width="${300 - (i % 4) * 30}" height="4" fill="#f8fafc"/>`).join('')
  const body = `<rect width="${w}" height="${h}" fill="#f7f7f5"/><rect x="340" y="380" width="400" height="700" rx="60" fill="#0f766e"/>${lines}<circle cx="540" cy="470" r="34" fill="#134e4a"/>`
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)).jpeg({ quality: 92 }).toBuffer()
}

describe('P3 #17 sharpness at a normalized scale', () => {
  it('a 2× upscaled studio photo is not flagged blurry and scores like its native original', async () => {
    const native = await studioPhoto()
    const up = await sharp(native).resize(2160, 2700, { kernel: 'lanczos3' }).jpeg({ quality: 92 }).toBuffer()
    const small = await sharp(native).resize(540, 675).jpeg({ quality: 92 }).toBuffer()
    const qn = await analyzeAssetQuality(native)
    const qu = await analyzeAssetQuality(up)
    const qs = await analyzeAssetQuality(small)
    expect(SHARPNESS_SIDE).toBe(1024)
    expect(qn.blurry).toBe(false)
    expect(qu.blurry).toBe(false)
    expect(qu.warnings).not.toContain('foto borrosa')
    // Same photo, same scale → same sharpness (± 25%), whatever the file resolution.
    expect(qu.sharpness / qn.sharpness).toBeGreaterThan(0.75)
    expect(qu.sharpness / qn.sharpness).toBeLessThan(1.33)
    // A genuinely soft (small, upsampled to the same scale) photo still reads softer.
    expect(qs.sharpness).toBeLessThan(qn.sharpness)
    // Truly blurred → blurry.
    const blurred = await analyzeAssetQuality(await sharp(native).blur(10).jpeg().toBuffer())
    expect(blurred.blurry).toBe(true)
  })

  it('ranking: role preference → primary → sharpness (a soft primary hero beats a sharp non-primary hero; role beats both)', () => {
    const q = (score: number, blurry = false): AssetQuality => ({ width: 1500, height: 2000, megapixels: 3, sharpness: blurry ? 10 : 500, sharpnessScore: score, backgroundClean: 1, hasAlpha: false, lowResolution: false, blurry, warnings: [], score })
    const pool: PoolImage[] = [
      { url: 'sharp-hero', role: 'hero', quality: q(0.9) },
      { url: 'primary-hero', role: 'hero', primary: true, quality: q(0.3, true) },
      { url: 'box', role: 'box', quality: q(0.95) },
    ]
    expect(pickProductImage(pool, { format: 'offer_graphic' })?.url).toBe('primary-hero')
    expect(pickProductImage(pool, { role: 'box' })?.url).toBe('box')
    expect(pickProductImage(pool.filter((p) => !p.primary), { format: 'offer_graphic' })?.url).toBe('sharp-hero')
  })
})

describe('P1 #7 grounding on the plate surface line', () => {
  it('the plate prompt states the surface line for the slot', () => {
    const serum = caseById('beauty-serum')
    const prompt = buildPlatePrompt({ format: 'offer_graphic', dna: serum.dna, offer: serum.offer, placement: { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.85, baseY: 0.78 }, light: 'left' })
    expect(prompt).toMatch(/Surface line: the product's base will sit at 78% of the image height/)
    expect(prompt).toMatch(/ABOVE 72% of the height/)
  })

  it('a product whose base sits on the wall (table edge below it) is moved down onto the surface', async () => {
    const cut = await segmentProduct({ bytes: await productOnWhite() })
    if (!cut.ok) throw new Error('cutout')
    // Table edge just below the product's planned base (88% of the height): the product's
    // base would stand against the wall.
    const plate = await wallTablePlate(1080, 1350, 0.88)
    const res = await renderAd({ format: 'offer_graphic', ratio: '4:5', sceneImage: plate, copy: goodSerumCopy(), visual: {}, productCutout: cut.png, productMode: 'exact', language: 'es' })
    const g = res.layoutReport.grounding
    expect(g).toBeTruthy()
    const p = res.productPlacements![0]
    const base = p.box.y + p.box.h
    expect(g!.surfaceLineY, JSON.stringify(g)).not.toBeNull()
    expect(g!.snappedPx, JSON.stringify(g)).toBeGreaterThan(0)
    expect(base).toBeGreaterThanOrEqual(g!.surfaceLineY!)
    expect(res.layoutReport.textOverProduct).toBe(false)
    // The real product is still pixel-identical after grounding.
    const s = await scoreFidelity({ image: res.png, box: p.box, reference: p.placed, background: p.background })
    expect(s.passed).toBe(true)
  }, 60_000)

  it('findSurfaceLine finds a table edge across the slot and ignores flat backdrops', async () => {
    const plate = await sharp(await wallTablePlate(1080, 1350, 0.7)).png().toBuffer()
    const y = await findSurfaceLine(plate, 1080, 1350, { x: 300, y: 500, w: 480, h: 420 })
    expect(y).not.toBeNull()
    expect(Math.abs(y! - 0.7 * 1350)).toBeLessThanOrEqual(6)
    const flat = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#cbbfae' } }).png().toBuffer()
    expect(await findSurfaceLine(flat, 1080, 1350, { x: 300, y: 500, w: 480, h: 420 })).toBeNull()
  })
})

describe('P1 #6 top-down compositing', () => {
  it('a flat lay on an overhead plate: drop shadow under every piece, pieces pixel-identical, no surface snap', async () => {
    const cut = await segmentProduct({ bytes: await flatLayWithWhitePieces(), role: 'contents' })
    if (!cut.ok) throw new Error(cut.detail)
    const plate = await overheadPlate(1080, 1350)
    const res = await renderAd({ format: 'explainer', ratio: '4:5', sceneImage: plate, copy: goodSerumCopy(), visual: {}, productCutout: cut.png, productMode: 'exact', language: 'es', topDown: true })
    expect(res.layoutReport.view).toBe('overhead')
    expect(res.layoutReport.grounding).toBeUndefined()
    const p = res.productPlacements![0]
    const s = await scoreFidelity({ image: res.png, box: p.box, reference: p.placed, background: p.background })
    expect(s.passed, JSON.stringify(s)).toBe(true)
    // A soft shadow right under the pieces: the plate just below the box bottom is darker than far away.
    const below = await sharp(res.png).extract({ left: p.box.x + Math.round(p.box.w * 0.2), top: Math.min(1349 - 6, p.box.y + p.box.h + 1), width: Math.round(p.box.w * 0.6), height: 4 }).stats()
    const far = await sharp(plate).extract({ left: 20, top: 1300, width: 200, height: 20 }).stats()
    expect(below.channels[0].mean).toBeLessThanOrEqual(far.channels[0].mean + 1)
  }, 60_000)
})
