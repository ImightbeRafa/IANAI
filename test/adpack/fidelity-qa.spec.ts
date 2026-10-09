/**
 * Visual QA set for exact product mode (opt-in, writes PNGs; no assertions beyond "renders").
 *   ADPACK_FIDELITY_QA=1 npx vitest run test/adpack/fidelity-qa.spec.ts
 * Output: <os tmp>/adpack-fidelity-qa/
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { segmentProduct } from '../../api/lib/adpack/fidelity/segment'
import { scoreFidelity } from '../../api/lib/adpack/fidelity/score'
import { renderAd } from '../../api/lib/adpack/render'
import { EXTENDED_RATIOS } from '../../api/lib/adpack/render/frame'
import { ALL_FORMATS } from '../../api/lib/adpack/render/templates'
import { goodSerumCopy } from './helpers'
import { partOnGray, productOnWhite, syntheticPlate, whiteSquareLogoJpeg } from './fidelity-fixtures'

const OUT = join(tmpdir(), 'adpack-fidelity-qa')

describe.skipIf(!process.env.ADPACK_FIDELITY_QA)('exact-mode visual QA set', () => {
  it('renders every format × ratio with a real cut-out, plate, logo and parts', async () => {
    mkdirSync(OUT, { recursive: true })
    const cut = await segmentProduct({ bytes: await productOnWhite() })
    const part = await segmentProduct({ bytes: await partOnGray(), role: 'part' })
    expect(cut.ok && part.ok).toBe(true)
    if (!cut.ok || !part.ok) return
    writeFileSync(join(OUT, '00-cutout.png'), cut.png)
    writeFileSync(join(OUT, '00-part.png'), part.png)
    const plate = await syntheticPlate()
    const logo = await whiteSquareLogoJpeg()
    const copy = goodSerumCopy({ headline: 'Tu rutina, sin brillo extra', subline: 'Ligero, se absorbe rápido y no deja residuo', bullets: ['Textura ligera', 'Sin perfume', 'Uso diario'], offerLine: '₡9.900 · Envío gratis desde 2', cta: 'Pedilo hoy' })
    const lines: string[] = []
    for (const format of ALL_FORMATS) {
      for (const ratio of EXTENDED_RATIOS) {
        const res = await renderAd({
          format,
          ratio,
          sceneImage: plate,
          copy,
          visual: { primaryColor: '#0f766e', accentColor: '#f59e0b' },
          productCutout: cut.png,
          productParts: format === 'offer_graphic' || format === 'explainer' ? [part.png] : undefined,
          productMode: 'exact',
          light: 'left',
          logo,
          language: 'es',
        })
        const name = `${format}-${ratio.replace(':', 'x')}.png`
        writeFileSync(join(OUT, name), res.png)
        const p = res.productPlacements?.[0]
        const s = p ? await scoreFidelity({ image: res.png, box: p.box, reference: p.placed }) : null
        lines.push(`${name}\tssim=${s?.ssim}\tdE=${s?.deltaE}\ttextOverProduct=${res.layoutReport.textOverProduct}\tlogo=${res.layoutReport.logoVariant}`)
      }
    }
    writeFileSync(join(OUT, 'report.tsv'), lines.join('\n'))
  }, 300_000)
})
