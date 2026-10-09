/**
 * Visual QA for the Ad Pack layout families: renders every family × format × ratio
 * with synthetic scenes and writes PNGs + layout JSON plus one contact sheet per family.
 *
 *   npx tsx scripts/adpack-layouts-qa.ts [outDir] [--families a,b] [--formats x,y]
 *
 * Default outDir: <os tmp>/adpack-layouts-qa. No network, no model calls.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ALL_FAMILIES, type LayoutFamily } from '../api/lib/adpack/render/families'
import { ALL_FORMATS, ALL_RATIOS, renderAdAllRatios } from '../api/lib/adpack/render/index'
import type { AdFormat } from '../api/lib/adpack/types'
import { makeLogoSvg, makeProductCutout, makeScene, SAMPLE_COPY } from '../test/adpack/render-fixtures'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const outDir = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--'))) || join(tmpdir(), 'adpack-layouts-qa')
const families = (flag('--families')?.split(',') as LayoutFamily[] | undefined) ?? ALL_FAMILIES
const formats = (flag('--formats')?.split(',') as AdFormat[] | undefined) ?? ALL_FORMATS

const COPY_BY_FORMAT: Partial<Record<AdFormat, Partial<typeof SAMPLE_COPY>>> = {
  how_to_steps: { headline: 'Tu rutina en 3 pasos', subline: 'Piel suave en menos de un minuto', bullets: ['Limpiá tu rostro con agua tibia', 'Aplicá una capa fina', 'Masajeá hasta absorber'] },
  before_after: { headline: 'Del tirante al radiante', bullets: ['Piel seca y opaca', 'Piel suave e hidratada'] },
  variant_card: { headline: 'Aguacate & Caña', subline: 'Nuestra fórmula más nutritiva', bullets: ['Para piel seca', '250 ml', 'Vegana'] },
  ugc_person: { headline: 'Probé esta crema 7 días y mirá cómo quedó mi piel', subline: 'No es publi, la compré yo' },
  handheld_overlay: { headline: 'Tu piel lo nota desde el día uno' },
  explainer: { headline: '¿Qué hace la crema de aguacate?', bullets: ['Repara la barrera', 'Hidrata 24 horas', 'Calma la irritación', 'Absorción rápida'] },
}

/** A brand visual per family so the sheet shows palette usage (fictional brand). */
const VISUAL = { primaryColor: '#1F3A5F', secondaryColor: '#0B1F33', accentColor: '#F2B134', headingFont: 'Space Grotesk', bodyFont: 'Inter' }

async function main() {
  await mkdir(outDir, { recursive: true })
  const [warm, dark, light, cutout] = await Promise.all([makeScene(1200, 1500, 'warm'), makeScene(1200, 1500, 'dark'), makeScene(1200, 1500, 'light'), makeProductCutout()])
  const scenes: Record<AdFormat, Buffer> = { offer_graphic: light, before_after: warm, how_to_steps: light, variant_card: warm, ugc_person: warm, handheld_overlay: dark, explainer: light }
  const t0 = Date.now()
  let count = 0
  for (const family of families) {
    const tiles: Array<{ input: Buffer; left: number; top: number }> = []
    const TILE_W = 216
    let col = 0
    for (const format of formats) {
      const copy = { ...SAMPLE_COPY, ...COPY_BY_FORMAT[format] }
      const results = await renderAdAllRatios({
        format,
        sceneImage: scenes[format],
        copy,
        visual: VISUAL,
        productCutout: ['offer_graphic', 'variant_card', 'explainer'].includes(format) ? cutout : undefined,
        logo: makeLogoSvg(),
        language: 'es',
        layoutFamily: family,
      })
      for (const r of results) {
        const name = `${family}__${format}_${r.ratio.replace(':', 'x')}`
        await writeFile(join(outDir, `${name}.png`), r.png)
        await writeFile(join(outDir, `${name}.json`), JSON.stringify(r.layoutReport, null, 2))
        const minC = Math.min(...r.layoutReport.elements.map((e) => e.contrast))
        console.log(`${name.padEnd(48)} fits=${r.layoutReport.fits} scale=${r.layoutReport.scale} place=${r.layoutReport.placement} minC=${minC.toFixed(2)} ${r.layoutReport.warnings.join('; ')}`)
        const row = ALL_RATIOS.indexOf(r.ratio)
        const tile = await sharp(r.png).resize({ width: TILE_W }).png().toBuffer()
        tiles.push({ input: tile, left: col * (TILE_W + 12), top: [0, 228, 512][row] })
        count++
      }
      col++
    }
    const sheet = await sharp({ create: { width: formats.length * (TILE_W + 12), height: 512 + 384 + 4, channels: 3, background: '#e5e7eb' } })
      .composite(tiles)
      .png()
      .toBuffer()
    await writeFile(join(outDir, `_sheet_${family}.png`), sheet)
  }
  console.log(`\n${count} ads in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
