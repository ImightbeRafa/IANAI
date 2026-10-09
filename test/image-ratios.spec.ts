import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { buildSceneCheckPrompt, checkScene } from '../api/lib/adpack/check-scene'
import { isSupportedImageRatio, nativeRatioFor, ratioValue, reframeToRatio, resolveImageRatio, SUPPORTED_IMAGE_RATIOS } from '../api/lib/image-ratios'
import { runnerGateway } from './adpack/runner-fakes'

describe('shared image ratios (F3)', () => {
  it('supports 1:1, 4:5, 9:16 and 16:9 in every image tool', () => {
    expect(SUPPORTED_IMAGE_RATIOS).toEqual(['1:1', '4:5', '9:16', '16:9'])
    for (const r of SUPPORTED_IMAGE_RATIOS) expect(() => resolveImageRatio(r)).not.toThrow()
    expect(isSupportedImageRatio('4:5')).toBe(true)
    expect(isSupportedImageRatio('5:7')).toBe(false)
  })

  it('maps ratios Grok lacks to the nearest native ratio (4:5 → 3:4) and flags the reframe', () => {
    expect(nativeRatioFor('4:5')).toEqual({ native: '3:4', needsReframe: true })
    expect(nativeRatioFor('9:16')).toEqual({ native: '9:16', needsReframe: false })
    expect(nativeRatioFor('16:9')).toEqual({ native: '16:9', needsReframe: false })
    expect(resolveImageRatio('4:5')).toEqual({ requested: '4:5', generateAt: '3:4', needsReframe: true })
    expect(resolveImageRatio(undefined)).toEqual({ requested: '9:16', generateAt: '9:16', needsReframe: false })
    expect(resolveImageRatio('3:4').needsReframe).toBe(false) // Grok-native ratios still pass
    expect(() => resolveImageRatio('7:3')).toThrow(/Unsupported aspectRatio/)
    expect(ratioValue('4:5')).toBeCloseTo(0.8)
    expect(ratioValue('wide')).toBeNull()
  })

  it('reframes deterministically: cover crops to the exact ratio, extend pads with mirrored edges', async () => {
    const src = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#3366aa' } }).png().toBuffer()
    const cover = await reframeToRatio(src, '4:5')
    expect([cover.width, cover.height]).toEqual([900, 1125])
    const meta = await sharp(cover.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([900, 1125])
    const ext = await reframeToRatio(src, '1:1', { mode: 'extend' })
    expect([ext.width, ext.height]).toEqual([1200, 1200])
    const wide = await reframeToRatio(src, '16:9', { maxLongSide: 1920, format: 'jpeg' })
    expect(wide.mimeType).toBe('image/jpeg')
    expect(Math.abs(wide.width / wide.height - 16 / 9)).toBeLessThan(0.01)
    const same = await reframeToRatio(src, '3:4')
    expect([same.width, same.height]).toEqual([900, 1200])
  })
})

describe('scene check (generated mode) — parts, allowed props, immutable attributes, bbox', () => {
  it('prompt lists the real part photos, the allowed props and the immutable attributes', () => {
    const p = buildSceneCheckPrompt(true, 'es', {
      partRefs: [{ image: 'https://x.test/pad.jpg', role: 'part', label: 'control tipo gamepad' }],
      allowedProps: ['caja'],
      immutableAttributes: ['hélices blancas', 'ala de papel blanca'],
    })
    expect(p.user).toMatch(/Image 3: "control tipo gamepad" \(part\)/)
    expect(p.user).toMatch(/hélices blancas; ala de papel blanca/)
    expect(p.user).toMatch(/Allowed and NOT errors: table, plants, fabric, light, wall texture, caja/)
    expect(p.user).toMatch(/productBox/)
    expect(p.system).toMatch(/extraObjects/)
  })

  it('extra objects fail the check; the product bbox is returned normalized 0–1000', async () => {
    const gw = runnerGateway({ vision: () => ({ productMatches: true, strayText: false, headlineSpace: true, borders: false, extraObjects: ['hélice suelta'], productBox: [300, 450, 820, 980], score: 0.8 }) })
    const res = await checkScene({ gateway: gw, sceneImage: 'data:image/png;base64,AA', productRef: 'https://x.test/hero.jpg', partRefs: [{ image: 'https://x.test/pad.jpg', role: 'part' }], language: 'es' })
    expect(res.ok).toBe(false)
    expect(res.extraObjects).toEqual(['hélice suelta'])
    expect(res.productBox).toEqual([300, 450, 820, 980])
    expect(gw.visionCalls[0].images).toEqual(['data:image/png;base64,AA', 'https://x.test/hero.jpg', 'https://x.test/pad.jpg'])
  })
})
