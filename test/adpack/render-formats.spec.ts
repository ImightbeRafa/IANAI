import { beforeAll, describe, expect, it } from 'vitest'
import { ALL_FORMATS, ALL_RATIOS, renderAdAllRatios } from '../../api/lib/adpack/render/index'
import { assertPng, assertReport, hexLum, ratio, sampledContrast } from './render-assert'
import { makeLogoSvg, makeProductCutout, makeScene, SAMPLE_COPY, SAMPLE_VISUAL } from './render-fixtures'

let warm: Buffer
let cutout: Buffer
const logo = makeLogoSvg()

beforeAll(async () => {
  ;[warm, cutout] = await Promise.all([makeScene(1200, 1500, 'warm'), makeProductCutout()])
})

describe('renderAd — every format × ratio', () => {
  for (const format of ALL_FORMATS) {
    it(`${format}: 1:1, 4:5, 9:16 with exact Spanish copy`, async () => {
      const results = await renderAdAllRatios({
        format,
        sceneImage: warm,
        copy: SAMPLE_COPY,
        visual: SAMPLE_VISUAL,
        productCutout: ['offer_graphic', 'variant_card', 'explainer'].includes(format) ? cutout : undefined,
        logo,
        language: 'es',
        debug: { returnBase: true },
      })
      expect(results.map((r) => r.ratio)).toEqual(ALL_RATIOS)
      for (const res of results) {
        await assertPng(res, res.ratio)
        assertReport(res.layoutReport, format, res.ratio)
        expect(res.layoutReport.logo).not.toBeNull()
        if (['offer_graphic', 'variant_card', 'explainer'].includes(format)) expect(res.layoutReport.product).not.toBeNull()
        // Independent contrast check: headline color vs the composited background under it.
        const head = res.layoutReport.elements.find((e) => e.role === 'headline')!
        const bg = head.background.kind === 'fill' ? null : res.basePng!
        if (bg) expect(await sampledContrast(bg, head.box, head.color)).toBeGreaterThanOrEqual(4.5)
        else expect(ratio(hexLum(head.color), hexLum((head.background as { color: string }).color))).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
