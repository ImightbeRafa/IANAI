import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { segmentProduct } from '../../api/lib/adpack/fidelity/segment'
import { scoreFidelity } from '../../api/lib/adpack/fidelity/score'
import { mapSceneBox, placeProductAndAvoidText, planLayout, renderAd } from '../../api/lib/adpack/render'
import { overlayBoxes } from '../../api/lib/adpack/render/avoid'
import { EXTENDED_RATIOS, makeFrame, overlaps } from '../../api/lib/adpack/render/frame'
import { cachedLogo, pickLogoVariant, prepareLogo } from '../../api/lib/adpack/render/logo'
import { ALL_FORMATS } from '../../api/lib/adpack/render/templates'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import type { AdCopy } from '../../api/lib/adpack/types'
import { goodSerumCopy } from './helpers'
import { darkLogoPng, darkScene, logoSvg, partOnGray, productAlphaPng, productOnWhite, syntheticPlate, whiteSquareLogoJpeg } from './fidelity-fixtures'

const FULL_COPY: Partial<AdCopy> = {
  headline: 'Tu rutina nocturna, sin brillo extra en la zona T',
  subline: 'Ligero, se absorbe rápido y no deja residuo en la almohada',
  bullets: ['Textura ligera', 'Sin perfume añadido', 'Uso diario', 'Piel mixta'],
  offerLine: '₡9.900 · Envío gratis desde 2 unidades',
  cta: 'Pedilo hoy',
}
const SHAPES = {
  tall: { width: 260, height: 580 },
  square: { width: 500, height: 480 },
  wide: { width: 900, height: 300 },
}

describe('text never over the product (H4) — every format × ratio × product shape', () => {
  for (const format of ALL_FORMATS) {
    it(`${format}: no text, pill, card or icon intersects the product box (exact mode)`, () => {
      for (const ratio of EXTENDED_RATIOS) {
        for (const [shape, product] of Object.entries(SHAPES)) {
          for (const copy of [goodSerumCopy(), goodSerumCopy(FULL_COPY)]) {
            const parts = format === 'offer_graphic' || format === 'explainer' ? [{ width: 640, height: 420 }] : []
            const { layout, frame } = planLayout({ format, ratio, copy, visual: {}, language: 'es', product, logo: { width: 200, height: 80 }, exact: true })
            const res = placeProductAndAvoidText({ layout, frame, product, parts, exact: true })
            const label = `${format} ${ratio} ${shape}`
            expect(res.productBoxes.length, label).toBeGreaterThan(0)
            expect(res.textOverProduct, label).toBe(false)
            for (const pb of res.productBoxes) {
              for (const ob of overlayBoxes(layout)) expect(overlaps(ob, pb), `${label}: overlay ${JSON.stringify(ob)} vs product ${JSON.stringify(pb)}`).toBe(false)
              expect(pb.x, label).toBeGreaterThanOrEqual(0)
              expect(pb.x + pb.w, label).toBeLessThanOrEqual(frame.W)
            }
            // The hero stays a hero (not shrunk to a thumbnail to dodge the text).
            const hero = res.productBoxes[0]
            expect(Math.max(hero.w / frame.W, hero.h / frame.H), `${label}: hero ${JSON.stringify(hero)}`).toBeGreaterThanOrEqual(0.15)
          }
        }
      }
    })
  }

  it('full render agrees: layoutReport elements/overlays never intersect the placed product (4:5 + 16:9)', async () => {
    const cut = await segmentProduct({ bytes: await productOnWhite() })
    if (!cut.ok) throw new Error('cutout')
    const plate = await syntheticPlate(1080, 1920)
    for (const format of ALL_FORMATS) {
      for (const ratio of ['4:5', '16:9'] as const) {
        const res = await renderAd({ format, ratio, sceneImage: plate, copy: goodSerumCopy(FULL_COPY), visual: {}, productCutout: cut.png, productMode: 'exact', language: 'es' })
        const r = res.layoutReport
        expect(r.textOverProduct, `${format} ${ratio}`).toBe(false)
        expect(r.productBoxes?.length).toBeGreaterThan(0)
        for (const pb of r.productBoxes ?? []) {
          for (const e of r.elements) expect(overlaps(e.box, pb), `${format} ${ratio} ${e.role}`).toBe(false)
          for (const o of r.overlays ?? []) expect(overlaps(o, pb), `${format} ${ratio} overlay`).toBe(false)
        }
        // Real product pixels survive the whole render (shadow, harmonization, text layer).
        const p = res.productPlacements![0]
        const s = await scoreFidelity({ image: res.png, box: p.box, reference: p.placed })
        expect(s.passed, `${format} ${ratio} ssim=${s.ssim} dE=${s.deltaE}`).toBe(true)
      }
    }
  }, 120_000)

  it('generated mode: the scene product bbox (vision check) is mapped through the cover crop and text moves off it', () => {
    const copy = goodSerumCopy(FULL_COPY)
    // Product standing in the left-middle of the 9:16 scene, where offer_graphic puts its chips.
    const avoidNorm = { x0: 0.06, y0: 0.4, x1: 0.42, y1: 0.62 }
    for (const ratio of EXTENDED_RATIOS) {
      const { layout, frame } = planLayout({ format: 'offer_graphic', ratio, copy, visual: {}, language: 'es' })
      const region = mapSceneBox(avoidNorm, { width: 1080, height: 1920 }, frame.W, frame.H)!
      expect(region).not.toBeNull()
      const before = overlayBoxes(layout).some((b) => overlaps(b, region))
      const res = placeProductAndAvoidText({ layout, frame, product: null, exact: false, avoidRegion: region })
      const after = overlayBoxes(layout).some((b) => overlaps(b, region))
      // Either the text was moved off the product or the render reports it (never silent).
      expect(after).toBe(res.textOverProduct)
      if (before && ratio === '9:16') expect(after).toBe(false)
    }
  })

  it('mapSceneBox follows the centered cover crop (9:16 scene → 1:1 canvas keeps the middle band)', () => {
    const b = mapSceneBox({ x0: 0.25, y0: 0.5, x1: 0.75, y1: 0.6 }, { width: 1080, height: 1920 }, 1080, 1080)!
    expect(b.x).toBe(270)
    expect(b.w).toBe(540)
    expect(b.y).toBe(Math.round(0.5 * 1920 - (1920 - 1080) / 2))
    expect(mapSceneBox({ x0: 0, y0: 0, x1: 1, y1: 0.1 }, { width: 1080, height: 1920 }, 1080, 1080)).toBeNull() // cropped away
  })
})

describe('logo cleanup + variants (C5/H5)', () => {
  it('white-square JPEG logo → transparent background, trimmed, no box around it', async () => {
    const v = await prepareLogo(await whiteSquareLogoJpeg())
    expect(v.method).toBe('edge_flood')
    expect(v.backgroundRemoved).toBe(true)
    // Trimmed to the drawn shapes (circle 130–270 wide area, bars 90–310): no 400×400 square left.
    expect(v.onLight.width).toBeLessThan(250)
    expect(v.onLight.height).toBeLessThan(260)
    const { data, info } = await sharp(v.onLight.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0) // top-left corner transparent
    expect(data[(info.width * info.height - 1) * 4 + 3]).toBe(0)
    // Center of the circle stays opaque navy.
    const c = (Math.floor(info.height * 0.25) * info.width + Math.floor(info.width / 2)) * 4
    expect(data[c + 3]).toBe(255)
    expect(data[c + 2]).toBeGreaterThan(data[c]) // blue > red
  })

  it('rendered on a dark scene: no light box shows around the logo slot', async () => {
    const res = await renderAd({ format: 'handheld_overlay', ratio: '1:1', sceneImage: await darkScene(1080, 1080), copy: goodSerumCopy(), visual: { primaryColor: '#0f766e' }, logo: await whiteSquareLogoJpeg(), language: 'es' })
    const lb = res.layoutReport.logo!
    expect(lb).toBeTruthy()
    // The corners of the logo slot (outside the drawn shapes) must stay dark (the scene), not white.
    const corner = await sharp(await sharp(res.png).extract({ left: lb.x, top: lb.y, width: 6, height: 6 }).png().toBuffer()).stats()
    expect(corner.channels[0].mean).toBeLessThan(60)
    expect(['onDark', 'badge']).toContain(res.layoutReport.logoVariant)
  })

  it('dark logo on a dark background → onDark (white) or badge; on a light background → onLight', async () => {
    const v = await prepareLogo(await darkLogoPng())
    expect(v.method).toBe('alpha')
    expect(v.onDark).not.toBeNull()
    expect(pickLogoVariant(v, 0.01).variant).toBe('onDark')
    expect(pickLogoVariant(v, 0.9).variant).toBe('onLight')
    // Dim background where the dark original no longer reads (< 3:1) but white does.
    expect(pickLogoVariant(v, 0.1).variant).toBe('onDark')
    const noDark = { ...v, onDark: null }
    const badge = pickLogoVariant(noDark, 0.02, { r: 255, g: 214, b: 10 })
    expect(badge.variant).toBe('badge')
    expect(badge.chip).toEqual({ r: 255, g: 214, b: 10 })
  })

  it('SVG logos are rasterized (resvg) with transparency; storage cache stores the cleaned variant once', async () => {
    const v = await prepareLogo(logoSvg())
    expect(v.method).toBe('svg')
    expect(v.onLight.width).toBeGreaterThan(500)
    const cache = memoryBlobCache()
    const bytes = await whiteSquareLogoJpeg()
    const a = await cachedLogo(bytes, cache)
    const b = await cachedLogo(bytes, cache)
    expect(a.variants.backgroundRemoved).toBe(true)
    expect(cache.hits).toBe(1)
    expect(Buffer.from(b.png).equals(Buffer.from(a.png))).toBe(true)
  })
})

describe('exact mode in the renderer', () => {
  it('composites hero + real part (offer_graphic) and reports both placements', async () => {
    const hero = await productAlphaPng()
    const part = await segmentProduct({ bytes: await partOnGray(), role: 'part' })
    if (!part.ok) throw new Error('part')
    const res = await renderAd({ format: 'offer_graphic', ratio: '4:5', sceneImage: await syntheticPlate(), copy: goodSerumCopy(), visual: {}, productCutout: hero, productParts: [part.png], productMode: 'exact', light: 'right', language: 'es' })
    expect(res.productPlacements?.map((p) => p.role)).toEqual(['hero', 'part'])
    for (const p of res.productPlacements!) expect((await scoreFidelity({ image: res.png, box: p.box, reference: p.placed })).passed).toBe(true)
  })

  it('ignores parts outside offer_graphic / explainer and keeps a cut-out on every exact format', async () => {
    const hero = await productAlphaPng()
    const res = await renderAd({ format: 'ugc_person', ratio: '9:16', sceneImage: await syntheticPlate(), copy: goodSerumCopy(), visual: {}, productCutout: hero, productParts: [hero], productMode: 'exact', language: 'es' })
    expect(res.productPlacements).toHaveLength(1)
    expect(res.layoutReport.warnings.join(' ')).not.toMatch(/productCutout ignored/)
  })

  it('a relight hook result replaces the composite (the caller decides with the fidelity score)', async () => {
    let called = 0
    const res = await renderAd({
      format: 'offer_graphic',
      ratio: '1:1',
      sceneImage: await syntheticPlate(),
      copy: goodSerumCopy(),
      visual: {},
      productCutout: await productAlphaPng(),
      productMode: 'exact',
      language: 'es',
      relight: async (composite) => {
        called++
        return sharp(composite).modulate({ brightness: 1.01 }).png().toBuffer()
      },
    })
    expect(called).toBe(1)
    expect(res.relit).toBe(true)
  })

  it('16:9 frame is landscape with side margins', () => {
    const f = makeFrame('16:9')
    expect([f.W, f.H]).toEqual([1920, 1080])
    expect(f.safe.x).toBeGreaterThan(0)
  })
})
