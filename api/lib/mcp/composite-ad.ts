/**
 * Code-composited brand layers for the MCP image path (free, local: sharp + satori + resvg, no model call).
 *
 * Grok does not respect margins and redraws logos, so the generated flow asks it for NEITHER: the model paints the scene,
 * the product, the headline / price / facts, and leaves the top and bottom bands free. Afterwards this module composites:
 *   - the REAL kit logo (the exact asset, whole, never a text chip) inside the top safe zone;
 *   - ONE CTA button with the exact `copy` CTA text inside the bottom safe zone, in the brand palette (text contrast ≥ 4.5:1),
 *     on a soft gradient scrim sampled from the picture itself (no hard bands).
 * The output keeps the input's pixel size (ratio exact). If there is no logo asset nothing is drawn in its place.
 */
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import sharp from 'sharp'
import { blend, contrastRatio, ensureReadableFill, INK, luminance, parseColor, readableOn, toHex, WHITE, type Rgb } from '../adpack/render/color.js'
import { cssFamily, measureText, resolveFonts, satoriFonts } from '../adpack/render/fonts.js'
import { freeBands, safeZoneMargins } from './safe-zones.js'

export { freeBands }

export type CompositeInput = {
  bytes: Buffer
  ratio: string
  /** The kit logo asset bytes (any raster / alpha PNG). Absent → nothing is drawn (never a placeholder). */
  logo?: Buffer | null
  /** Exact CTA text from the copy. Absent → no button. */
  ctaText?: string
  palette?: { primary?: string | null; secondary?: string | null; accent?: string | null }
  /** Regions (fractions of the image) the CTA must not cover: the located product bbox, prop regions. */
  avoid?: Array<{ x0: number; y0: number; x1: number; y1: number }>
  fonts?: { headingFont?: string | null; bodyFont?: string | null }
}

export type CompositeReport = {
  method: 'composite'
  width: number
  height: number
  logo: { status: 'drawn' | 'unavailable' | 'not_requested'; reason?: string; box?: Box; contrast?: number; glow?: boolean }
  cta: { status: 'drawn' | 'none'; text?: string; box?: Box; fill?: string; textColor?: string; contrast?: number; fontSize?: number; fits?: boolean; slot?: 'center' | 'left' | 'right'; /** Local busyness (0–1 share of edge pixels) under the pill. */ busyness?: number; /** true when even the calmest slot is busy or overlaps the product. */ busy?: boolean; /** true when even the best slot straddles a hard horizontal edge (table edge / band seam). */ seam?: boolean }
  scrim: { color: string; maxAlpha: number } | null
  /** Band fractions the layers were placed inside. */
  zones: { top: number; bottom: number }
}

export type Box = { x: number; y: number; w: number; h: number }

export const rasterize = (svg: string): Buffer => new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false }, background: 'rgba(0,0,0,0)' }).render().asPng()

export function meanRegion(raw: Buffer, w: number, h: number, box: Box): { color: Rgb; lum: number } {
  const x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(w, Math.ceil(box.x + box.w))
  const y0 = Math.max(0, Math.floor(box.y)), y1 = Math.min(h, Math.ceil(box.y + box.h))
  let r = 0, g = 0, b = 0, n = 0
  const step = 3
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { const i = (y * w + x) * 3; r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; n++ }
  const c: Rgb = n ? { r: r / n, g: g / n, b: b / n } : { r: 128, g: 128, b: 128 }
  return { color: c, lum: luminance(c) }
}

/** Edge-energy lookup (share of "busy" pixels inside a box) on a 360 px wide grey copy: text and product edges are busy, wall / table are not. */
export async function edgeMap(raw: Buffer, W: number, H: number): Promise<(box: Box) => number> {
  const w = 360
  const h = Math.max(1, Math.round((H * w) / W))
  const g = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).resize(w, h, { kernel: 'lanczos3' }).greyscale().raw().toBuffer()
  const busy = new Uint8Array(w * h)
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) busy[y * w + x] = Math.abs(g[y * w + x] - g[y * w + x + 1]) + Math.abs(g[y * w + x] - g[(y + 1) * w + x]) > 36 ? 1 : 0
  return (box) => {
    const x0 = Math.max(0, Math.floor((box.x / W) * w)), x1 = Math.min(w, Math.ceil(((box.x + box.w) / W) * w))
    const y0 = Math.max(0, Math.floor((box.y / H) * h)), y1 = Math.min(h, Math.ceil(((box.y + box.h) / H) * h))
    let n = 0, t = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n += busy[y * w + x]; t++ }
    return t ? n / t : 0
  }
}


/** The CTA pill (exact text, brand palette, text contrast ≥ 4.5:1, distinct from the scrim it sits on) as a transparent PNG. */
export async function renderCtaPill(input: {
  text: string
  btnH: number
  W: number
  scrimMean: Rgb
  palette?: CompositeInput['palette']
  fonts?: CompositeInput['fonts']
}): Promise<{ png: Buffer; btnW: number; fill: Rgb; ink: Rgb; fontSize: number; fits: boolean }> {
  const { text: cta, btnH, W, scrimMean } = input
  // fill: brand palette, readable text on it (≥ 4.5:1), and distinct from the scrim it sits on
  const pal = [input.palette?.accent, input.palette?.primary, input.palette?.secondary].map((c) => parseColor(c)).filter((c): c is Rgb => Boolean(c)).map((c) => ensureReadableFill(c))
  const options = [...pal, WHITE, INK]
  const fill = options.find((c) => contrastRatio(c, scrimMean) >= 1.8) ?? options.reduce((b, c) => (contrastRatio(c, scrimMean) > contrastRatio(b, scrimMean) ? c : b), options[0])
  const ink = readableOn(fill)
  const fonts = resolveFonts({ headingFont: input.fonts?.headingFont ?? undefined, bodyFont: input.fonts?.bodyFont ?? undefined } as never)
  const ref = { family: fonts.body.family, weight: fonts.body.boldWeight }
  let fontSize = Math.round(btnH * 0.44)
  const padX = Math.round(btnH * 0.9)
  const maxW = Math.round(W * 0.84)
  let textW = measureText(cta, ref, fontSize)
  while (textW + padX * 2 > maxW && fontSize > btnH * 0.28) { fontSize -= 1; textW = measureText(cta, ref, fontSize) }
  const btnW = Math.min(maxW, Math.round(textW + padX * 2))
  const fits = textW + padX * 2 <= maxW + 1
  const svg = await satori({
    type: 'div',
    props: {
      style: { display: 'flex', width: btnW, height: btnH, alignItems: 'center', justifyContent: 'center', backgroundColor: toHex(fill), borderRadius: Math.round(btnH * 0.3), color: toHex(ink), fontFamily: cssFamily(ref.family), fontWeight: ref.weight, fontSize, whiteSpace: 'nowrap' },
      children: cta,
    },
  } as unknown as Parameters<typeof satori>[0], { width: btnW, height: btnH, fonts: satoriFonts([fonts.body.family]) })
  return { png: rasterize(svg), btnW, fill, ink, fontSize, fits }
}

export async function compositeBrandLayers(input: CompositeInput): Promise<{ bytes: Buffer; report: CompositeReport }> {
  const base = sharp(input.bytes).rotate().removeAlpha()
  const meta = await base.metadata()
  const W = meta.width || 0
  const H = meta.height || 0
  if (!W || !H) throw new Error('composite: image has no size')
  const raw = await base.clone().raw().toBuffer()
  const m = safeZoneMargins(input.ratio)
  const story = m.top > 0.1
  const layers: import("sharp").OverlayOptions[] = []
  const busy = await edgeMap(raw, W, H)
  const report: CompositeReport = { method: 'composite', width: W, height: H, logo: { status: 'not_requested' }, cta: { status: 'none' }, scrim: null, zones: { top: m.top, bottom: m.bottom } }

  // ---- CTA scrim + button (bottom safe zone) --------------------------------------------------------------------------
  const cta = (input.ctaText || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (cta) {
    // Round 5c: ~20 % bigger than round 5b (0.052 / 0.04 of the height).
    const btnH = Math.round(H * (story ? 0.048 : 0.0624))
    const bottomEdge = Math.round(H * (1 - m.bottom - 0.012))
    const zoneTop = Math.round(H * (1 - m.bottom - 0.22))
    const around = meanRegion(raw, W, H, { x: 0, y: H * (1 - m.bottom - 0.12), w: W, h: H * 0.12 + H * m.bottom })
    const dark = blend({ r: 0, g: 0, b: 0 }, 0.62, around.color)
    const maxAlpha = around.lum > 0.55 ? 0.42 : 0.6
    const scrimSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${toHex(dark)}" stop-opacity="0"/><stop offset="0.45" stop-color="${toHex(dark)}" stop-opacity="${maxAlpha * 0.8}"/><stop offset="1" stop-color="${toHex(dark)}" stop-opacity="${maxAlpha}"/></linearGradient></defs><rect x="0" y="${zoneTop}" width="${W}" height="${H - zoneTop}" fill="url(#s)"/></svg>`
    layers.push({ input: rasterize(scrimSvg), left: 0, top: 0 })
    report.scrim = { color: toHex(dark), maxAlpha }
    const scrimMean = blend(dark, maxAlpha, around.color)

    const pill = await renderCtaPill({ text: cta, btnH, W, scrimMean, palette: input.palette, fonts: input.fonts })
    const { png: btnPng, btnW, fill, ink, fontSize, fits } = pill
    const by = bottomEdge - btnH
    // Calmest spot of the bottom band: centre / left / right, scored by local edge density (+ overlap with the located product).
    const sideX = Math.round(W * m.side)
    const slots: Array<['center' | 'left' | 'right', number]> = [['center', Math.round((W - btnW) / 2)], ['left', sideX], ['right', W - sideX - btnW]]
    const overlapOf = (x: number) => {
      let o = 0
      for (const r of input.avoid ?? []) {
        const ix = Math.max(0, Math.min((x + btnW) / W, r.x1) - Math.max(x / W, r.x0))
        const iy = Math.max(0, Math.min((by + btnH) / H, r.y1) - Math.max(by / H, r.y0))
        o = Math.max(o, (ix * iy) / ((btnW / W) * (btnH / H)))
      }
      return o
    }
    let pick = { slot: slots[0][0], x: slots[0][1], busyness: 1, score: Infinity }
    for (const [slot, x] of slots) {
      const b = busy({ x: x - W * 0.01, y: by - H * 0.006, w: btnW + W * 0.02, h: btnH + H * 0.012 })
      const score = b + 3 * overlapOf(x)
      if (score < pick.score - 0.004) pick = { slot, x, busyness: b, score }
    }
    const bx = pick.x
    const shadow = await sharp({ create: { width: btnW, height: btnH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.35 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${btnW}" height="${btnH}"><rect width="${btnW}" height="${btnH}" rx="${Math.round(btnH * 0.3)}" fill="#fff"/></svg>`), blend: 'dest-in' }])
      .blur(Math.max(2, btnH * 0.1)).png().toBuffer()
    layers.push({ input: shadow, left: bx, top: by + Math.round(btnH * 0.08) })
    layers.push({ input: btnPng, left: bx, top: by })
    report.cta = { status: 'drawn', text: cta, box: { x: bx, y: by, w: btnW, h: btnH }, fill: toHex(fill), textColor: toHex(ink), contrast: Math.round(contrastRatio(fill, ink) * 100) / 100, fontSize, fits, slot: pick.slot, busyness: Math.round(pick.busyness * 1000) / 1000, busy: pick.score > 0.08 }
  }

  // ---- real logo (top safe zone) -------------------------------------------------------------------------------------
  if (input.logo) {
    try {
      const lm = await sharp(input.logo).metadata()
      if (!lm.width || !lm.height) throw new Error('logo asset has no size')
      const aspect = lm.width / lm.height
      const ly = Math.round(H * (m.top + 0.008))
      // Where the badge goes: top-right by default, but never over the model's own text / product. Try 3 heights x 3 slots on a
      // downscaled edge map and take the first clear one (else the least busy): the picture is never shrunk or padded for it.
      const heights = (story ? [0.07, 0.064, 0.058] : [0.078, 0.074, 0.07]).map((f) => Math.round(H * f))
      const maxW = Math.round(W * 0.34)
      let best: { x: number; w: number; h: number; score: number } | null = null
      search: for (const hh of heights) {
        let lh = hh
        let lw = Math.round(lh * aspect)
        if (lw > maxW) { lw = maxW; lh = Math.round(lw / aspect) }
        const slots = [W - Math.round(W * 0.05) - lw, Math.round(W * 0.05), Math.round((W - lw) / 2)]
        for (const x of slots) {
          const score = busy({ x: x - W * 0.012, y: ly - H * 0.006, w: lw + W * 0.024, h: lh + H * 0.012 })
          if (!best || score < best.score - 1e-9) best = { x, w: lw, h: lh, score }
          if (score <= 0.012) { best = { x, w: lw, h: lh, score }; break search }
        }
      }
      const { x: lx, w: lw, h: lh } = best!
      const logoPng = await sharp(input.logo).rotate().ensureAlpha().resize(lw, lh, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
      // contrast of the logo against what is under it (only matters for logos without their own plate)
      const { channels, data } = await sharp(logoPng).raw().toBuffer({ resolveWithObject: true }).then((r) => ({ channels: r.info.channels, data: r.data }))
      let lr = 0, lg = 0, lb = 0, ln = 0, opaque = 0
      for (let i = 0; i < data.length; i += channels) { if (data[i + 3] > 200) { lr += data[i]; lg += data[i + 1]; lb += data[i + 2]; ln++ } opaque++ }
      const logoMean: Rgb = ln ? { r: lr / ln, g: lg / ln, b: lb / ln } : { r: 255, g: 255, b: 255 }
      const under = meanRegion(raw, W, H, { x: lx, y: ly, w: lw, h: lh })
      const contrast = Math.round(contrastRatio(logoMean, under.color) * 100) / 100
      const selfContained = ln / Math.max(1, opaque) >= 0.85
      let glow = false
      if (!selfContained && contrast < 2.5) {
        // a transparent logo that would vanish: a soft local halo of the opposite tone (not a chip, not a box)
        const tone = luminance(logoMean) > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
        const gl = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g"><stop offset="0" stop-color="${toHex(tone)}" stop-opacity="0.5"/><stop offset="1" stop-color="${toHex(tone)}" stop-opacity="0"/></radialGradient></defs><ellipse cx="${lx + lw / 2}" cy="${ly + lh / 2}" rx="${lw * 0.75}" ry="${lh * 1.1}" fill="url(#g)"/></svg>`
        layers.push({ input: rasterize(gl), left: 0, top: 0 })
        glow = true
      }
      layers.push({ input: logoPng, left: lx, top: ly })
      report.logo = { status: 'drawn', box: { x: lx, y: ly, w: lw, h: lh }, contrast, glow }
    } catch (err) {
      report.logo = { status: 'unavailable', reason: `logo asset could not be drawn: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}` }
    }
  } else {
    report.logo = { status: 'unavailable', reason: 'no logo asset in the brand kit' }
  }

  const out = await sharp(input.bytes).rotate().removeAlpha().composite(layers).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer()
  return { bytes: out, report }
}
