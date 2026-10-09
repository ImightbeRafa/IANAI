#!/usr/bin/env node
// Build-time smoke for the Ad Pack renderer in the COMPILED output (dist-api),
// run by the Dockerfile's runtime stage after `npm ci --omit=dev`. Proves, in
// the real image, that:
//   - @resvg/resvg-js loads its linux-x64-gnu native binding,
//   - sharp loads its libvips binding,
//   - satori (+ its WASM) loads,
//   - the bundled OFL fonts sit next to dist-api/lib/adpack/render/ so the
//     `new URL('./fonts/x.ttf', import.meta.url)` lookups resolve,
//   - one real 1:1 ad renders end to end to a valid PNG.
// No network, no secrets, no model calls.
//
//   node scripts/adpack-render-smoke.mjs [distApiDir]   (default: dist-api)
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const distApi = resolve(process.argv[2] || 'dist-api')
const renderDir = join(distApi, 'lib/adpack/render')

for (const f of ['Poppins-Bold.ttf', 'SpaceGrotesk-Regular.ttf', 'SpaceGrotesk-Bold.ttf', 'spacegrotesk-OFL.txt']) {
  const fontFile = join(renderDir, 'fonts', f)
  if (!existsSync(fontFile)) throw new Error(`font missing in compiled output: ${fontFile}`)
}

const { Resvg } = await import('@resvg/resvg-js')
const sharp = (await import('sharp')).default
await import('satori')

const probe = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#0f5132"/></svg>').render().asPng()
if (probe.length < 8) throw new Error('resvg produced no PNG')

const scene = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#f1e7d0' } }).png().toBuffer()

const { renderAd } = await import(pathToFileURL(join(renderDir, 'index.js')).href)
const t0 = Date.now()
const { png, layoutReport } = await renderAd({
  format: 'offer_graphic',
  ratio: '1:1',
  sceneImage: scene,
  copy: {
    headline: '¿Cansada de la piel seca?',
    subline: 'Crema de aguacate hecha en Costa Rica',
    bullets: ['Hidratación 24 h', 'Sin parabenos'],
    offerLine: '₡9.900 · Envío gratis',
    cta: '¡Pedí la tuya!',
  },
  // Space Grotesk is a bundled system font: it must resolve exactly with no network.
  visual: { primaryColor: '#0F5132', accentColor: '#F4B400', headingFont: 'Space Grotesk', bodyFont: 'Space Grotesk' },
  language: 'es',
})

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(PNG_SIG)) throw new Error('renderAd did not return a PNG')
const meta = await sharp(png).metadata()
if (meta.width !== 1080 || meta.height !== 1080) throw new Error(`unexpected size ${meta.width}x${meta.height}`)
if (!layoutReport?.elements?.length) throw new Error('layoutReport has no text elements')
const headline = layoutReport.elements.find((e) => e.role === 'headline')
if (headline?.fontFamily !== 'Space Grotesk') throw new Error(`headline font is ${headline?.fontFamily}, expected bundled Space Grotesk`)

console.log(
  `adpack render ok: ${meta.width}x${meta.height} ${png.length}B, ${layoutReport.elements.length} text elements, fits=${layoutReport.fits}, ${Date.now() - t0}ms (sharp vips ${sharp.versions.vips})`,
)
