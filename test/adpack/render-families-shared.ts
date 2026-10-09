/** Shared body of the layout-family render specs (split in two files so vitest runs them in parallel). */
import { beforeAll, describe, expect, it } from 'vitest'
import { ALL_FORMATS, ALL_RATIOS, renderAdAllRatios, type LayoutFamily } from '../../api/lib/adpack/render/index'
import type { AdFormat } from '../../api/lib/adpack/types'
import { assertPng, assertReport, hexLum, ratio, sampledContrast } from './render-assert'
import { makeLogoSvg, makeProductCutout, makeScene, SAMPLE_COPY, SAMPLE_VISUAL } from './render-fixtures'

const CUTOUT: AdFormat[] = ['offer_graphic', 'variant_card', 'explainer']

export function describeFamilies(families: LayoutFamily[]) {
  let warm: Buffer
  let light: Buffer
  let cutout: Buffer
  const logo = makeLogoSvg()

  beforeAll(async () => {
    ;[warm, light, cutout] = await Promise.all([makeScene(1200, 1500, 'warm'), makeScene(1200, 1500, 'light'), makeProductCutout()])
  })

  for (const family of families) {
    describe(`layout family ${family}`, () => {
      for (const format of ALL_FORMATS) {
        it(`${format}: 1:1, 4:5, 9:16 keep exact text, safe zones, fit and contrast`, async () => {
          const results = await renderAdAllRatios({
            format,
            sceneImage: format === 'how_to_steps' || format === 'explainer' ? light : warm,
            copy: SAMPLE_COPY,
            visual: SAMPLE_VISUAL,
            productCutout: CUTOUT.includes(format) ? cutout : undefined,
            logo,
            language: 'es',
            layoutFamily: family,
            debug: { returnBase: true },
          })
          expect(results.map((r) => r.ratio)).toEqual(ALL_RATIOS)
          for (const res of results) {
            await assertPng(res, res.ratio)
            assertReport(res.layoutReport, format, res.ratio)
            expect(res.layoutReport.layoutFamily).toBe(family)
            expect(res.layoutReport.logo).not.toBeNull()
            if (CUTOUT.includes(format)) expect(res.layoutReport.product).not.toBeNull()
            // Independent contrast check of the headline against what is really under it.
            const head = res.layoutReport.elements.find((e) => e.role === 'headline')!
            if (head.background.kind === 'fill') expect(ratio(hexLum(head.color), hexLum(head.background.color))).toBeGreaterThanOrEqual(4.5)
            else expect(await sampledContrast(res.basePng!, head.box, head.color)).toBeGreaterThanOrEqual(4.5)
          }
        }, 60_000)
      }
    })
  }
}

export { SAMPLE_COPY }
