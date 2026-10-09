/**
 * Upscale without redrawing (C4 "después"): deterministic super-resolution for low-resolution
 * product photos — only when asset-quality says low resolution, ≤ 2× / 2048 px, verified (SSIM vs
 * the original after downscaling back, silhouette IoU ≈ 1), reported in the asset-quality object.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { analyzeAssetQuality } from '../../api/lib/adpack/fidelity/asset-quality'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { prepareProductCutouts } from '../../api/lib/adpack/fidelity/pipeline'
import { graySsim, upscaleProductPhoto, upscaleTarget, UPSCALE_CHECK } from '../../api/lib/adpack/fidelity/upscale'
import { addGrain, mugPhoto } from './relight-fixtures'
import { productAlphaPng, productOnWhite } from './fidelity-fixtures'

describe('upscaleProductPhoto', () => {
  it('low-res photo → 2×, verified not redrawn (SSIM after downscale, silhouette IoU ≈ 1)', async () => {
    const small = await sharp(await productOnWhite()).resize(420, 560).jpeg({ quality: 90 }).toBuffer()
    const res = await upscaleProductPhoto(small)
    expect(res.upscaled).toBe(true)
    expect(res.from).toEqual({ width: 420, height: 560 })
    expect(res.to).toEqual({ width: 840, height: 1120 })
    expect(res.ssim!).toBeGreaterThanOrEqual(UPSCALE_CHECK.ssim)
    expect(res.silhouetteIoU!).toBeGreaterThanOrEqual(UPSCALE_CHECK.silhouetteIoU)
    const meta = await sharp(res.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([840, 1120])
    // Sharper than a plain bilinear 2× (edge-aware unsharp), never softer.
    const lap = async (b: Buffer) => {
      const g = await sharp(b).greyscale().resize(840, 1120).raw().toBuffer()
      let s = 0
      for (let y = 1; y < 1119; y++) for (let x = 1; x < 839; x++) {
        const i = y * 840 + x
        const v = g[i - 840] + g[i + 840] + g[i - 1] + g[i + 1] - 4 * g[i]
        s += v * v
      }
      return s
    }
    const plain = await sharp(small).resize(840, 1120, { kernel: 'linear' as never }).png().toBuffer()
    expect(await lap(res.bytes)).toBeGreaterThan(await lap(plain))
  })

  it('keeps transparency: an alpha cut-out keeps the same silhouette', async () => {
    const small = await sharp(await productAlphaPng()).resize(300, 400).png().toBuffer()
    const res = await upscaleProductPhoto(small)
    expect(res.upscaled).toBe(true)
    expect((await sharp(res.bytes).metadata()).hasAlpha).toBe(true)
    expect(res.silhouetteIoU!).toBeGreaterThanOrEqual(0.99)
  })

  it('noisy low-res photo: mild denoise, still verified', async () => {
    const small = await sharp(await addGrain(await sharp(await mugPhoto()).resize(350, 400).png().toBuffer(), 6, 5)).jpeg({ quality: 88 }).toBuffer()
    const res = await upscaleProductPhoto(small)
    expect(res.upscaled).toBe(true)
    expect(res.denoised).toBe(true)
    expect(res.ssim!).toBeGreaterThanOrEqual(UPSCALE_CHECK.ssim)
  })

  it('never applied to a photo that is not low resolution; caps at 2048 px / 2×', async () => {
    const big = await sharp(await productOnWhite()).resize(1200, 1600).jpeg().toBuffer()
    const res = await upscaleProductPhoto(big)
    expect(res).toMatchObject({ upscaled: false, reason: 'resolution_ok', from: { width: 1200, height: 1600 }, to: { width: 1200, height: 1600 } })
    expect(res.bytes.equals(big)).toBe(true)
    expect(upscaleTarget(1500, 1000)).toEqual({ width: 2048, height: 1365, factor: 2048 / 1500 })
    expect(upscaleTarget(800, 600)).toMatchObject({ width: 1600, height: 1200, factor: 2 })
    expect(upscaleTarget(2000, 1000)).toBeNull()
  })

  it('graySsim: identical = 1, different < 1', () => {
    const a = new Uint8Array(64 * 64).map((_, i) => (i * 7) % 255)
    expect(graySsim(a, a, 64, 64)).toBeCloseTo(1, 6)
    const b = a.map((v) => 255 - v)
    expect(graySsim(a, b, 64, 64)).toBeLessThan(0.5)
  })
})

describe('upscale before the cut-out (pipeline) + asset-quality report', () => {
  it('a low-res hero is upscaled before segmentation; heroQuality reports upscaled/from/to', async () => {
    const small = await sharp(await productOnWhite()).resize(420, 560).jpeg({ quality: 92 }).toBuffer()
    const q = await analyzeAssetQuality(small)
    expect(q.lowResolution).toBe(true)
    const cache = memoryBlobCache()
    const res = await prepareProductCutouts({ photos: [{ url: 'https://x.test/hero.jpg', role: 'hero' }], load: async () => new Uint8Array(small), cache })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.heroQuality).toMatchObject({ lowResolution: true, upscaled: true, from: { width: 420, height: 560 }, to: { width: 840, height: 1120 } })
    expect(res.hero.upscale).toMatchObject({ from: { width: 420, height: 560 }, to: { width: 840, height: 1120 } })
    // The cut-out is made from the 2× photo (≈ 2× the product's size at 420 px).
    expect(res.hero.height).toBeGreaterThan(560)
    expect([...cache.entries.keys()][0]).toMatch(/-sr840x1120$/)
    // Second run hits the cache (same key, no re-upscale needed).
    const again = await prepareProductCutouts({ photos: [{ url: 'https://x.test/hero.jpg', role: 'hero' }], load: async () => new Uint8Array(small), cache })
    expect(again.ok && again.hero.stored.method).toBe('cache')
  })

  it('a high-res hero is not touched', async () => {
    const big = await sharp(await productOnWhite()).resize(1200, 1600).jpeg().toBuffer()
    const res = await prepareProductCutouts({ photos: [{ url: 'https://x.test/big.jpg', role: 'hero' }], load: async () => new Uint8Array(big), cache: memoryBlobCache() })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.heroQuality?.upscaled).toBeUndefined()
    expect(res.hero.upscale).toBeUndefined()
  })
})
