import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { ALL_FAMILIES, mapSceneBox, renderAd, type Box, type LayoutFamily } from '../../api/lib/adpack/render/index'
import type { AdFormat, AspectRatio } from '../../api/lib/adpack/types'
import { assertReport } from './render-assert'
import { makeLogoSvg, makeScene, SAMPLE_COPY, SAMPLE_VISUAL } from './render-fixtures'

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2

let warm: Buffer
beforeAll(async () => {
  warm = await makeScene(1200, 1500, 'warm')
})

describe('mapSceneBox', () => {
  it('maps a normalized scene box through the centered cover-fit', () => {
    // 1200×1500 scene → 1080×1080: scale 0.9, 1350 tall, 135 px cropped top and bottom.
    expect(mapSceneBox({ x: 0.5, y: 0.5, w: 0.25, h: 0.2 }, { width: 1200, height: 1500 }, 1080, 1080)).toEqual({ x: 540, y: 540, w: 270, h: 270 })
    // Fully cropped away → null; invalid → null.
    expect(mapSceneBox({ x: 0.2, y: 0, w: 0.2, h: 0.05 }, { width: 1200, height: 1500 }, 1080, 1080)).toBeNull()
    expect(mapSceneBox({ x: Number.NaN, y: 0, w: 1, h: 1 }, { width: 10, height: 10 }, 1080, 1080)).toBeNull()
  })
})

describe('productBox: copy never covers the product', () => {
  const cases: Array<{ name: string; box: { x: number; y: number; w: number; h: number } }> = [
    { name: 'product right', box: { x: 0.56, y: 0.25, w: 0.38, h: 0.5 } },
    { name: 'product left', box: { x: 0.06, y: 0.25, w: 0.38, h: 0.5 } },
  ]
  const formats: AdFormat[] = ['offer_graphic', 'how_to_steps', 'handheld_overlay']
  for (const family of ALL_FAMILIES) {
    it(`${family}: ${cases.map((c) => c.name).join(', ')} × ${formats.length} formats × 3 ratios`, async () => {
      for (const c of cases) {
        for (const format of formats) {
          for (const ratio of ['1:1', '4:5', '9:16'] as AspectRatio[]) {
            const r = await renderAd({ format, ratio, sceneImage: warm, copy: SAMPLE_COPY, visual: SAMPLE_VISUAL, logo: makeLogoSvg(), language: 'es', layoutFamily: family as LayoutFamily, productBox: c.box })
            const L = r.layoutReport
            expect(L.productBox, `${family} ${format} ${ratio}`).not.toBeNull()
            expect(L.productBoxRespected, `${family} ${format} ${ratio} ${c.name} (${L.placement})`).toBe(true)
            for (const e of L.elements) expect(overlaps(e.box, L.productBox!), `${e.role} over product (${family} ${format} ${ratio} ${c.name})`).toBe(false)
            assertReport(L, format, ratio)
          }
        }
      }
    }, 120_000)
  }

  it('reports (never hides) a product box no placement can avoid', async () => {
    const r = await renderAd({ format: 'offer_graphic', ratio: '1:1', sceneImage: warm, copy: SAMPLE_COPY, visual: SAMPLE_VISUAL, language: 'es', layoutFamily: 'framed_card', productBox: { x: 0.05, y: 0.12, w: 0.9, h: 0.76 } })
    expect(r.layoutReport.productBoxRespected).toBe(false)
    expect(r.layoutReport.warnings.join(' ')).toMatch(/product box/)
  })

  it('without productBox the API is unchanged (bold_pill default placement)', async () => {
    const r = await renderAd({ format: 'offer_graphic', ratio: '4:5', sceneImage: warm, copy: SAMPLE_COPY, visual: SAMPLE_VISUAL, language: 'es' })
    expect(r.layoutReport.layoutFamily).toBe('bold_pill')
    expect(r.layoutReport.placement).toBe('default')
    expect(r.layoutReport.productBox).toBeNull()
    expect(r.layoutReport.productBoxRespected).toBe(true)
  })
})

describe('families look different (not the same template recolored)', () => {
  it('every pair of families differs visually for the same ad', async () => {
    const thumbs = new Map<LayoutFamily, Buffer>()
    for (const family of ALL_FAMILIES) {
      const r = await renderAd({ format: 'offer_graphic', ratio: '4:5', sceneImage: warm, copy: SAMPLE_COPY, visual: SAMPLE_VISUAL, logo: makeLogoSvg(), language: 'es', layoutFamily: family })
      thumbs.set(family, await sharp(r.png).resize(27, 34, { fit: 'fill' }).greyscale().raw().toBuffer())
    }
    const fams = [...thumbs.keys()]
    for (let i = 0; i < fams.length; i++) {
      for (let j = i + 1; j < fams.length; j++) {
        const a = thumbs.get(fams[i])!
        const b = thumbs.get(fams[j])!
        let diff = 0
        for (let k = 0; k < a.length; k++) diff += Math.abs(a[k] - b[k])
        expect(diff / a.length, `${fams[i]} vs ${fams[j]}`).toBeGreaterThan(8)
      }
    }
  }, 60_000)

  it('each family uses a different treatment for the CTA / offer / list', async () => {
    const sig = new Set<string>()
    for (const family of ALL_FAMILIES) {
      const r = await renderAd({ format: 'offer_graphic', ratio: '1:1', sceneImage: warm, copy: SAMPLE_COPY, visual: SAMPLE_VISUAL, language: 'es', layoutFamily: family })
      const bg = (role: string) => r.layoutReport.elements.filter((e) => e.role === role).map((e) => (e.background.kind === 'fill' ? `fill:${e.background.color}` : `scene:${e.background.treatment}`)).join(',')
      sig.add(`${bg('cta')}|${bg('offer')}|${bg('bullet')}|${bg('headline')}|${r.layoutReport.elements.find((e) => e.role === 'headline')!.fontSize}`)
    }
    expect(sig.size).toBe(ALL_FAMILIES.length)
  }, 60_000)
})
