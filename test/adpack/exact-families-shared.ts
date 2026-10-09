/**
 * Unification 1 (WS1 × WS3): ONE product-avoid path. In exact mode the composite's placement of
 * the real cut-out IS the product box every layout family keeps copy off — on every format and
 * ratio — and the real product pixels survive (fidelity unchanged). Split in two spec files so
 * vitest runs them in parallel.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { scoreFidelity } from '../../api/lib/adpack/fidelity/score'
import { placeProductAndAvoidText, planLayout, renderAdAllRatios, type LayoutFamily } from '../../api/lib/adpack/render/index'
import { overlayBoxes } from '../../api/lib/adpack/render/avoid'
import { EXTENDED_RATIOS, overlaps } from '../../api/lib/adpack/render/frame'
import { ALL_FORMATS } from '../../api/lib/adpack/render/templates'
import { goodSerumCopy } from './helpers'
import { logoSvg, productAlphaPng, syntheticPlate } from './fidelity-fixtures'

const FULL_COPY = {
  headline: 'Tu rutina nocturna, sin brillo extra en la zona T',
  subline: 'Ligero, se absorbe rápido y no deja residuo en la almohada',
  bullets: ['Textura ligera', 'Sin perfume añadido', 'Uso diario', 'Piel mixta'],
  offerLine: '₡9.900 · Envío gratis desde 2 unidades',
  cta: 'Pedilo hoy',
}
const SHAPES = { tall: { width: 260, height: 580 }, square: { width: 500, height: 480 }, wide: { width: 900, height: 300 } }

export function describeExactFamilies(families: LayoutFamily[]) {
  let plate: Buffer
  let cutout: Buffer
  beforeAll(async () => {
    ;[plate, cutout] = await Promise.all([syntheticPlate(1080, 1920), productAlphaPng()])
  })

  for (const family of families) {
    describe(`exact mode · ${family}`, () => {
      it('plan: every format × ratio × product shape reserves a product slot and keeps copy off it', () => {
        for (const format of ALL_FORMATS) {
          for (const ratio of EXTENDED_RATIOS) {
            for (const [shape, product] of Object.entries(SHAPES)) {
              const parts = format === 'offer_graphic' || format === 'explainer' ? [{ width: 640, height: 420 }] : []
              const label = `${family} ${format} ${ratio} ${shape}`
              const { layout, frame, family: used } = planLayout({ format, ratio, copy: goodSerumCopy(FULL_COPY), visual: {}, language: 'es', product, parts, logo: { width: 200, height: 80 }, exact: true, layoutFamily: family })
              expect(used, label).toBe(family)
              const res = placeProductAndAvoidText({ layout, frame, product, parts, exact: true })
              expect(res.productBoxes.length, label).toBeGreaterThan(0)
              expect(res.textOverProduct, label).toBe(false)
              for (const pb of res.productBoxes) for (const ob of overlayBoxes(layout)) expect(overlaps(ob, pb), `${label}: ${JSON.stringify(ob)} vs ${JSON.stringify(pb)}`).toBe(false)
            }
          }
        }
      })

      // Native sharp/resvg work crashes forked vitest workers on Windows dev machines (not code-specific:
      // the deployed de6210b crashes the same way there). Linux — CI and the Cloudflare container — runs it.
      it.skipIf(process.platform === 'win32')('render: every format × ratio composites the real product, no text over it, fidelity passes', async () => {
        for (const format of ALL_FORMATS) {
          const results = await renderAdAllRatios(
            { format, sceneImage: plate, copy: goodSerumCopy(FULL_COPY), visual: {}, productCutout: cutout, productMode: 'exact', logo: logoSvg(), language: 'es', layoutFamily: family },
            EXTENDED_RATIOS,
          )
          for (const res of results) {
            const r = res.layoutReport
            const label = `${family} ${format} ${res.ratio}`
            expect(r.layoutFamily, label).toBe(family)
            expect(r.textOverProduct, label).toBe(false)
            expect(r.productBoxRespected, label).toBe(true)
            // The product box every family avoids IS the composite's placement.
            expect(r.productBox, label).toEqual(r.productBoxes![0])
            for (const e of r.elements) expect(overlaps(e.box, r.productBox!), `${label} ${e.role}`).toBe(false)
            for (const o of r.overlays ?? []) expect(overlaps(o, r.productBox!), `${label} overlay`).toBe(false)
            // WS1 logo variants on every family.
            expect(r.logoVariant, label).toBeDefined()
            const p = res.productPlacements![0]
            const s = await scoreFidelity({ image: res.png, box: p.box, reference: p.placed })
            expect(s.passed, `${label} ssim=${s.ssim} dE=${s.deltaE}`).toBe(true)
          }
        }
      }, 180_000)
    })
  }
}
