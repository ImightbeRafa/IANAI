/**
 * Visual QA for the exact-mode relight stage (deterministic harmonization). No model calls.
 *
 *   npx tsx scripts/adpack-relight-qa.ts [outDir]
 *
 * For several synthetic products (flat bottle, photo-like mug, RC plane, gamepad part) on
 * photo-like plates (warm wood, cool concrete, dark navy, bright glossy studio, pastel top-light)
 * it writes, into <os tmp>/adpack-relight-qa/ by default:
 *   <product>-<plate>.png        side by side: plain cut-out paste | harmonized (full frame)
 *   <product>-<plate>-zoom.png   the same, cropped around the product
 *   report.tsv                   light model + fidelity metrics of both
 * plus negative controls (redrawn / reshaped / recolored) that must FAIL the fidelity metric, and
 * upscale-mug.png (low-res photo: plain bicubic 2× | upscaleProductPhoto).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { compositeProducts, fitBox } from '../api/lib/adpack/fidelity/composite'
import { lightSummary } from '../api/lib/adpack/fidelity/harmonize'
import { scoreFidelity, type FidelityScore } from '../api/lib/adpack/fidelity/score'
import { segmentProduct } from '../api/lib/adpack/fidelity/segment'
import { upscaleProductPhoto } from '../api/lib/adpack/fidelity/upscale'
import { partOnGray, productOnWhite } from '../test/adpack/fidelity-fixtures'
import { mugPhoto, planePhoto, PLATES, realisticPlate } from '../test/adpack/relight-fixtures'

const OUT = process.argv[2] || join(tmpdir(), 'adpack-relight-qa')
mkdirSync(OUT, { recursive: true })

const W = 1080
const H = 1350

const fmt = (s: FidelityScore) => `pass=${s.passed} ssimD=${s.ssimDetail} iou=${s.silhouetteIoU}${s.silhouetteMeasured ? '' : '(n/m)'} hue=${s.hueShift} chroma=${s.chromaRatio} dE=${s.deltaE}`

async function main() {
  const products: Array<{ name: string; bytes: Buffer; area: { x: number; y: number; w: number; h: number } }> = [
    { name: 'bottle', bytes: await productOnWhite(), area: { x: 0.3, y: 0.3, w: 0.4, h: 0.52 } },
    { name: 'mug', bytes: await mugPhoto(), area: { x: 0.24, y: 0.42, w: 0.52, h: 0.4 } },
    { name: 'plane', bytes: await planePhoto(), area: { x: 0.12, y: 0.46, w: 0.76, h: 0.36 } },
    { name: 'gamepad', bytes: await partOnGray(), area: { x: 0.25, y: 0.55, w: 0.5, h: 0.27 } },
  ]
  const lines = ['file\tlight\tplain\tharmonized\tharmonizeReport']
  for (const spec of PLATES) {
    const plate = await realisticPlate(spec, W, H)
    writeFileSync(join(OUT, `plate-${spec.name}.jpg`), plate)
    for (const p of products) {
      const cut = await segmentProduct({ bytes: p.bytes })
      if (!cut.ok) throw new Error(`cutout ${p.name}: ${cut.detail}`)
      const box = fitBox({ width: cut.width, height: cut.height }, { x: p.area.x * W, y: p.area.y * H, w: p.area.w * W, h: p.area.h * H }, 'bottom')
      const products1 = [{ cutout: cut.png, box }]
      const light = spec.light
      const surface = spec.glossy ? ('glossy' as const) : ('matte' as const)
      const plain = await compositeProducts({ base: plate, products: products1, light, surface, harmonize: false, shadow: false })
      const harm = await compositeProducts({ base: plate, products: products1, light, surface })
      const pl = plain.placements[0]
      const hp = harm.placements[0]
      const sPlain = await scoreFidelity({ image: plain.png, box: pl.box, reference: pl.placed, background: pl.background, method: 'composite' })
      const sHarm = await scoreFidelity({ image: harm.png, box: hp.box, reference: hp.placed, background: hp.background, method: 'harmonized', diff: true })
      const name = `${p.name}-${spec.name}`
      const pair = await sharp({ create: { width: W * 2 + 20, height: H, channels: 3, background: '#ffffff' } })
        .composite([{ input: plain.png, left: 0, top: 0 }, { input: harm.png, left: W + 20, top: 0 }])
        .png()
        .toBuffer()
      writeFileSync(join(OUT, `${name}.png`), await sharp(pair).resize(1400).png().toBuffer())
      const pad = Math.round(Math.max(box.w, box.h) * 0.35)
      const zx = Math.max(0, box.x - pad)
      const zy = Math.max(0, box.y - pad)
      const zw = Math.min(W - zx, box.w + pad * 2)
      const zh = Math.min(H - zy, box.h + pad * 2)
      const z1 = await sharp(plain.png).extract({ left: zx, top: zy, width: zw, height: zh }).png().toBuffer()
      const z2 = await sharp(harm.png).extract({ left: zx, top: zy, width: zw, height: zh }).png().toBuffer()
      const zoom = await sharp({ create: { width: zw * 2 + 12, height: zh, channels: 3, background: '#ffffff' } })
        .composite([{ input: z1, left: 0, top: 0 }, { input: z2, left: zw + 12, top: 0 }])
        .png()
        .toBuffer()
      writeFileSync(join(OUT, `${name}-zoom.png`), await sharp(zoom).resize({ width: 1400, withoutEnlargement: true }).png().toBuffer())
      if (sHarm.diffPng) writeFileSync(join(OUT, `${name}-diff.png`), sHarm.diffPng)
      lines.push(`${name}\t${JSON.stringify(harm.lightModel ? lightSummary(harm.lightModel) : null)}\t${fmt(sPlain)}\t${fmt(sHarm)}\t${JSON.stringify(harm.reports[0] ?? null)}`)
      console.log(`${name.padEnd(28)} plain: ${fmt(sPlain)}\n${''.padEnd(28)} harm : ${fmt(sHarm)}`)
    }
  }

  // Negative controls on one plate: a redraw must fail even after "relighting".
  const plate = await realisticPlate(PLATES[0], W, H)
  const cut = await segmentProduct({ bytes: await planePhoto() })
  if (!cut.ok) throw new Error('cutout plane')
  const box = fitBox({ width: cut.width, height: cut.height }, { x: 0.12 * W, y: 0.46 * H, w: 0.76 * W, h: 0.36 * H }, 'bottom')
  const harm = await compositeProducts({ base: plate, products: [{ cutout: cut.png, box }], light: 'left' })
  const ref = harm.placements[0]
  const variants: Array<[string, Buffer]> = []
  // 1) Recolored: gray propellers / hue rotated.
  variants.push(['hue-rotated', await sharp(ref.placed).modulate({ hue: 70 }).png().toBuffer()])
  // 2) Reshaped: stretched 8% wider (bigger wheels / wing redrawn).
  const meta = { w: ref.box.w, h: ref.box.h }
  variants.push(['stretched', await sharp(await sharp(ref.placed).resize(Math.round(meta.w * 1.08), meta.h, { fit: 'fill' }).png().toBuffer()).extract({ left: Math.round(meta.w * 0.04), top: 0, width: meta.w, height: meta.h }).png().toBuffer()])
  // 3) Redrawn details: mirrored product (same colors, details in the wrong place).
  variants.push(['mirrored', await sharp(ref.placed).flop().png().toBuffer()])
  // 4) Smoothed (model "repaint" losing detail).
  variants.push(['repainted-blur', await sharp(ref.placed).blur(4).png().toBuffer()])
  for (const [name, layer] of variants) {
    const img = await compositeProducts({ base: plate, products: [{ cutout: layer, box: ref.box }], light: 'left' })
    const s = await scoreFidelity({ image: img.png, box: ref.box, reference: ref.placed, background: ref.background, method: 'relit' })
    console.log(`negative ${name.padEnd(16)} ${fmt(s)}`)
    lines.push(`negative-${name}\t\t\t${fmt(s)}\t`)
    writeFileSync(join(OUT, `negative-${name}.png`), await sharp(img.png).extract({ left: ref.box.x, top: ref.box.y, width: ref.box.w, height: ref.box.h }).png().toBuffer())
  }
  // Upscale without redrawing: a low-res product photo, plain bicubic 2× vs upscaleProductPhoto.
  const small = await sharp(await mugPhoto()).resize(350, 400).jpeg({ quality: 85 }).toBuffer()
  const up = await upscaleProductPhoto(small)
  const cubic = await sharp(small).resize(up.to.width, up.to.height, { kernel: 'cubic' }).png().toBuffer()
  const crop = { left: Math.round(up.to.width * 0.2), top: Math.round(up.to.height * 0.35), width: Math.round(up.to.width * 0.5), height: Math.round(up.to.height * 0.35) }
  const c1 = await sharp(cubic).extract(crop).png().toBuffer()
  const c2 = await sharp(up.bytes).extract(crop).png().toBuffer()
  writeFileSync(
    join(OUT, 'upscale-mug.png'),
    await sharp({ create: { width: crop.width * 2 + 12, height: crop.height, channels: 3, background: '#ffffff' } })
      .composite([{ input: c1, left: 0, top: 0 }, { input: c2, left: crop.width + 12, top: 0 }])
      .png()
      .toBuffer(),
  )
  console.log(`upscale: ${JSON.stringify({ ...up, bytes: undefined })}`)
  lines.push(`upscale-mug\t\t\t${JSON.stringify({ ...up, bytes: undefined })}\t`)
  writeFileSync(join(OUT, 'report.tsv'), lines.join('\n'))
  console.log(`\nwrote ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
