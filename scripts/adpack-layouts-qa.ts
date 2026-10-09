/**
 * Visual QA for the Ad Pack layout families: renders every family × format × ratio
 * with synthetic scenes and writes PNGs + layout JSON plus one contact sheet per family.
 *
 *   npx tsx scripts/adpack-layouts-qa.ts [outDir] [--families a,b] [--formats x,y] [--ratios 4:5,9:16] [--exact]
 *
 * --exact: exact product mode — the synthetic real-product cut-out is composited on a synthetic
 * plate in EVERY format (each family's product slot), fidelity is scored per render and the
 * report says whether any text / pill touches the product box.
 *
 * Default outDir: <os tmp>/adpack-layouts-qa (or <os tmp>/adpack-premium-qa with --exact).
 * No network, no model calls.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ALL_FAMILIES, type LayoutFamily } from '../api/lib/adpack/render/families'
import { ALL_FORMATS, ALL_RATIOS, renderAdAllRatios } from '../api/lib/adpack/render/index'
import { scoreFidelity } from '../api/lib/adpack/fidelity/score'
import type { AdFormat, AspectRatio } from '../api/lib/adpack/types'
import { productAlphaPng, syntheticPlate } from '../test/adpack/fidelity-fixtures'
import { makeLogoSvg, makeProductCutout, makeScene, SAMPLE_COPY } from '../test/adpack/render-fixtures'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const exact = args.includes('--exact')
const outDir =
  args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--') || args[i - 1] === '--exact')) || join(tmpdir(), exact ? 'adpack-premium-qa' : 'adpack-layouts-qa')
const families = (flag('--families')?.split(',') as LayoutFamily[] | undefined) ?? ALL_FAMILIES
const formats = (flag('--formats')?.split(',') as AdFormat[] | undefined) ?? ALL_FORMATS
const ratios = (flag('--ratios')?.split(',') as AspectRatio[] | undefined) ?? ALL_RATIOS
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

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
  const [warm, dark, light, cutout, plate, realProduct] = await Promise.all([
    makeScene(1200, 1500, 'warm'),
    makeScene(1200, 1500, 'dark'),
    makeScene(1200, 1500, 'light'),
    makeProductCutout(),
    syntheticPlate(1080, 1920),
    productAlphaPng(),
  ])
  const scenes: Record<AdFormat, Buffer> = exact
    ? { offer_graphic: plate, before_after: plate, how_to_steps: plate, variant_card: plate, ugc_person: plate, handheld_overlay: plate, explainer: plate }
    : { offer_graphic: light, before_after: warm, how_to_steps: light, variant_card: warm, ugc_person: warm, handheld_overlay: dark, explainer: light }
  const t0 = Date.now()
  let count = 0
  for (const family of families) {
    const tiles: Array<{ input: Buffer; left: number; top: number }> = []
    const TILE_W = 216
    const rowTops = ratios.reduce<number[]>((acc, r) => {
      const [w, h] = r.split(':').map(Number)
      acc.push(acc[acc.length - 1] + Math.round((TILE_W * h) / w) + 12)
      return acc
    }, [0])
    let col = 0
    for (const format of formats) {
      const copy = { ...SAMPLE_COPY, ...COPY_BY_FORMAT[format] }
      const results = await renderAdAllRatios(
        {
          format,
          sceneImage: scenes[format],
          copy,
          visual: VISUAL,
          productCutout: exact ? realProduct : ['offer_graphic', 'variant_card', 'explainer'].includes(format) ? cutout : undefined,
          ...(exact ? { productMode: 'exact' as const } : {}),
          logo: makeLogoSvg(),
          language: 'es',
          layoutFamily: family,
        },
        ratios,
      )
      for (const r of results) {
        const name = `${family}__${format}_${r.ratio.replace(':', 'x')}`
        await writeFile(join(outDir, `${name}.png`), r.png)
        await writeFile(join(outDir, `${name}.json`), JSON.stringify(r.layoutReport, null, 2))
        const minC = Math.min(...r.layoutReport.elements.map((e) => e.contrast))
        let extra = ''
        if (exact) {
          const p = r.productPlacements?.[0]
          const fid = p ? await scoreFidelity({ image: r.png, box: p.box, reference: p.placed }) : null
          const boxes = r.layoutReport.productBoxes ?? []
          const hit = boxes.some((b) => [...r.layoutReport.elements.map((e) => e.box), ...(r.layoutReport.overlays ?? [])].some((o) => overlaps(o, b)))
          extra = ` product=${p ? 'yes' : 'NO'} fidelity=${fid ? `${fid.passed ? 'pass' : 'FAIL'} ssim=${fid.ssim} dE=${fid.deltaE}` : 'n/a'} textOverProduct=${hit} logo=${r.layoutReport.logoVariant ?? 'none'}`
        }
        console.log(`${name.padEnd(48)} fits=${r.layoutReport.fits} scale=${r.layoutReport.scale} place=${r.layoutReport.placement} minC=${minC.toFixed(2)}${extra} ${r.layoutReport.warnings.join('; ')}`)
        const row = ratios.indexOf(r.ratio)
        const tile = await sharp(r.png).resize({ width: TILE_W }).png().toBuffer()
        tiles.push({ input: tile, left: col * (TILE_W + 12), top: rowTops[row] })
        count++
      }
      col++
    }
    const sheet = await sharp({ create: { width: formats.length * (TILE_W + 12), height: rowTops[ratios.length], channels: 3, background: '#e5e7eb' } })
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
