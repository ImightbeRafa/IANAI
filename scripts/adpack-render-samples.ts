/**
 * Visual QA for the Ad Pack renderer: renders every format × ratio with synthetic
 * scenes and sample Spanish copy.
 *
 *   npx tsx scripts/adpack-render-samples.ts [outDir]
 *
 * Default outDir: <os tmp>/adpack-render-samples. No network, no model calls.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ALL_FORMATS, renderAdAllRatios } from '../api/lib/adpack/render/index'
import type { AdFormat } from '../api/lib/adpack/types'
import { makeBusyScene, makeLogoSvg, makeProductCutout, makeScene, SAMPLE_COPY, SAMPLE_VISUAL } from '../test/adpack/render-fixtures'

const outDir = process.argv[2] || join(tmpdir(), 'adpack-render-samples')

const COPY_BY_FORMAT: Partial<Record<AdFormat, Partial<typeof SAMPLE_COPY>>> = {
  how_to_steps: {
    headline: 'Tu rutina en 3 pasos',
    subline: 'Piel suave en menos de un minuto',
    bullets: ['Limpiá tu rostro con agua tibia', 'Aplicá una capa fina de crema', 'Masajeá hasta absorber por completo'],
  },
  before_after: { headline: 'Del tirante al radiante', bullets: ['Piel seca y opaca', 'Piel suave e hidratada'] },
  variant_card: { headline: 'Aguacate & Caña', subline: 'Nuestra fórmula más nutritiva', bullets: ['Para piel seca', '250 ml', 'Vegana'] },
  ugc_person: { headline: 'Probé esta crema 7 días y mirá cómo quedó mi piel', subline: 'No es publi, la compré yo' },
  handheld_overlay: { headline: 'Tu piel lo nota desde el día uno' },
  explainer: { headline: '¿Qué hace la crema de aguacate?', bullets: ['Repara la barrera de la piel', 'Hidrata por 24 horas', 'Calma la irritación', 'Absorción rápida, sin grasa'] },
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const [warm, dark, light, cutout] = await Promise.all([makeScene(1200, 1500, 'warm'), makeScene(1200, 1500, 'dark'), makeScene(1200, 1500, 'light'), makeProductCutout()])
  const scenes: Record<AdFormat, Buffer> = {
    offer_graphic: light,
    before_after: warm,
    how_to_steps: light,
    variant_card: light,
    ugc_person: warm,
    handheld_overlay: dark,
    explainer: light,
  }
  const t0 = Date.now()
  for (const format of ALL_FORMATS) {
    const copy = { ...SAMPLE_COPY, ...COPY_BY_FORMAT[format] }
    const results = await renderAdAllRatios({
      format,
      sceneImage: scenes[format],
      copy,
      visual: SAMPLE_VISUAL,
      productCutout: ['offer_graphic', 'variant_card', 'explainer'].includes(format) ? cutout : undefined,
      logo: makeLogoSvg(),
      language: 'es',
    })
    for (const r of results) {
      const name = `${format}_${r.ratio.replace(':', 'x')}`
      await writeFile(join(outDir, `${name}.png`), r.png)
      await writeFile(join(outDir, `${name}.json`), JSON.stringify(r.layoutReport, null, 2))
      const minC = Math.min(...r.layoutReport.elements.map((e) => e.contrast))
      console.log(`${name.padEnd(24)} fits=${r.layoutReport.fits} scale=${r.layoutReport.scale} minContrast=${minC.toFixed(2)} ${r.layoutReport.warnings.join('; ')}`)
    }
  }
  // Stress variants: busy scene + condensed display face, serif brand, no logo / no subline / no bullets.
  const busy = await makeBusyScene(1080, 1920)
  const extras = [
    { name: 'x_busy_anton', format: 'handheld_overlay' as AdFormat, scene: busy, visual: { primaryColor: '#e11d48', headingFont: 'Bebas Neue' }, copy: { ...SAMPLE_COPY, subline: undefined } },
    { name: 'x_serif_offer', format: 'offer_graphic' as AdFormat, scene: dark, visual: { primaryColor: '#7c2d12', accentColor: '#fde68a', headingFont: 'Playfair Display', bodyFont: 'Lato' }, copy: { ...SAMPLE_COPY, bullets: [] } },
    { name: 'x_long_headline', format: 'how_to_steps' as AdFormat, scene: warm, visual: { headingFont: 'Archivo Black' }, copy: { ...SAMPLE_COPY, headline: 'La crema de aguacate costarricense que hidrata, repara y protege tu piel todos los días del año' } },
  ]
  for (const x of extras) {
    const results = await renderAdAllRatios({ format: x.format, sceneImage: x.scene, copy: x.copy, visual: x.visual, language: 'es' })
    for (const r of results) {
      const name = `${x.name}_${r.ratio.replace(':', 'x')}`
      await writeFile(join(outDir, `${name}.png`), r.png)
      await writeFile(join(outDir, `${name}.json`), JSON.stringify(r.layoutReport, null, 2))
      const minC = Math.min(...r.layoutReport.elements.map((e) => e.contrast))
      console.log(`${name.padEnd(24)} fits=${r.layoutReport.fits} scale=${r.layoutReport.scale} minContrast=${minC.toFixed(2)} ${r.layoutReport.warnings.join('; ')}`)
    }
  }
  console.log(`\n${ALL_FORMATS.length * 3 + extras.length * 3} ads in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
