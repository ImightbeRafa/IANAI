/**
 * Round 1b — "studio bleed": render the scene AROUND the untouched product pixels.
 *
 * When the hero photo is a studio shot (light, near-neutral, uniform seamless backdrop — the
 * Estudio v1 photos), cutting the product out and pasting it on a generated plate throws away the
 * two things that make it look real: the photo's own contact shadows / ambient occlusion and its
 * own light. This is the approved v1 technique (prototipo/ads/v1/src/assets.py) as an engine step:
 *
 *   photo → backdrop analysis (eligible?) → product bbox (incl. its real shadows)
 *         → crop with margin → feathered smoothstep alpha OUTSIDE the product bbox (no pixel of the
 *           product or its shadow is masked) → at composite time one global per-channel gain maps the
 *           photo's backdrop onto the canvas tone, so the fade is seamless.
 *
 * No edge is ever cut through the product (no jaggies, no halo, no leftover patches), the light
 * and colour temperature are the photo's own, and the canvas is procedural (no paid plate).
 * Resolution: the layer keeps the photo's native pixels; when it must be enlarged it is resampled
 * with Lanczos-3 plus a mild unsharp mask — that is resampling, NOT super-resolution (reported).
 * sharp only; same inputs → same bytes.
 */
import sharp from 'sharp'
import type { Box } from '../render/types.js'

export interface Rgb3 { r: number; g: number; b: number }

export interface StudioBackdrop {
  eligible: boolean
  /** light = near-neutral light backdrop; colour = uniform saturated light backdrop; dark = near-black backdrop. */
  mode?: 'light' | 'colour' | 'dark'
  reason: string
  /** Median border colour (sRGB). */
  backdrop: Rgb3
  /** Share of border pixels within tolerance of the median. */
  uniformity: number
  /** Relative luminance 0–1 of the backdrop. */
  lightness: number
  /** max−min channel spread of the backdrop (0 = neutral grey). */
  chroma: number
}

/** Overall enlargement cap of the real photo pixels (Lanczos-3 + unsharp = resampling, not super-resolution). */
export const BLEED_MAX_UPSCALE = 1.55

export const STUDIO_BLEED_RULES = {
  minUniformity: 0.8,
  minLightness: 0.55,
  maxChroma: 34,
  /** Round 1c: a uniform coloured studio backdrop (pouch on yellow/lilac) is bled as long as it is light. */
  maxChromaColour: 90,
  /** Round 1c: a near-black uniform studio backdrop (dark product on black) is bled onto a dark canvas. */
  maxDarkLightness: 0.12,
  maxDarkChroma: 40,
  /** Per-pixel |Δ| sum vs the local backdrop that counts as "product or shadow". */
  diffThreshold: 42,
  /** Product bbox may not touch more than this many photo edges (a cropped product is not bled). */
  maxEdgesTouched: 1,
} as const

const lum = (c: Rgb3) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255

function medianOf(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[s.length >> 1]
}

async function rawRgb(bytes: Uint8Array | Buffer, maxSide?: number): Promise<{ data: Buffer; w: number; h: number }> {
  let img = sharp(Buffer.from(bytes)).rotate().removeAlpha()
  if (maxSide) img = img.resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

/** Is this photo a studio shot whose own backdrop can be extended (bled) into the canvas? */
export async function analyzeStudioBackdrop(bytes: Uint8Array | Buffer): Promise<StudioBackdrop> {
  const { data, w, h } = await rawRgb(bytes, 400)
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03))
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const idx: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue
      const i = (y * w + x) * 3
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); idx.push(i)
    }
  }
  const backdrop = { r: medianOf(rs), g: medianOf(gs), b: medianOf(bs) }
  let near = 0
  for (const i of idx) if (Math.abs(data[i] - backdrop.r) + Math.abs(data[i + 1] - backdrop.g) + Math.abs(data[i + 2] - backdrop.b) <= 36) near++
  const uniformity = idx.length ? near / idx.length : 0
  const lightness = lum(backdrop)
  const chroma = Math.max(backdrop.r, backdrop.g, backdrop.b) - Math.min(backdrop.r, backdrop.g, backdrop.b)
  const R = STUDIO_BLEED_RULES
  const dark = lightness <= R.maxDarkLightness && chroma <= R.maxDarkChroma
  const colour = lightness >= R.minLightness && chroma > R.maxChroma && chroma <= R.maxChromaColour && uniformity >= 0.9
  const reason =
    uniformity < R.minUniformity ? `backdrop not uniform (${uniformity.toFixed(2)} < ${R.minUniformity})`
      : dark || colour ? 'studio backdrop'
        : lightness < R.minLightness ? `backdrop too dark (${lightness.toFixed(2)})`
          : chroma > R.maxChroma ? `backdrop too saturated (spread ${chroma})`
            : 'studio backdrop'
  return { eligible: reason === 'studio backdrop', mode: dark ? 'dark' as const : colour ? 'colour' as const : 'light' as const, reason, backdrop, uniformity: Math.round(uniformity * 1000) / 1000, lightness: Math.round(lightness * 1000) / 1000, chroma }
}

export interface StudioBleedLayer {
  /** Enlargement already applied to the source photo (deterministic upscale step), counted in the reported scale. */
  preScale?: number
  /** RGBA PNG: native photo pixels, alpha 1 over the product bbox + margin, smoothstep fade outside. */
  png: Buffer
  width: number
  height: number
  /** Product (+ its real shadow) bbox inside the layer, px. */
  productBox: Box
  /** Photo backdrop colour measured on the visible fade ring (sRGB). */
  backdrop: Rgb3
  /** Photo edges the product touches (bled off-canvas side). */
  edgesTouched: string[]
  sourceWidth: number
  sourceHeight: number
  /**
   * Share of soft-shadow pixels (3–45 % darker than the backdrop, near-neutral) in the band at the
   * product's base. The bleed exists to keep the photo's real contact shadow: a photo without one
   * (flat packshot) goes to the cut-out path, which synthesizes it.
   */
  shadowShare: number
}

/** Minimum real-shadow share at the base for a studio bleed. */
export const STUDIO_SHADOW_MIN = 0.04

export interface StudioBleedOptions {
  /** Opaque margin around the product bbox, fraction of the bbox's larger side (default 0.06). */
  margin?: number
  /** Fade width, fraction of the bbox's larger side (default 0.16). */
  fade?: number
}

/**
 * Product bbox on a downscaled copy: pixels differing from a smooth backdrop model (row-wise
 * median of the left/right borders, so a vignette or sweep gradient is not "product"), cleaned by
 * row/column occupancy so specks and dust never widen it.
 */
function productBbox(data: Buffer, w: number, h: number, threshold: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const band = Math.max(2, Math.round(w * 0.03))
  const rowBg: Rgb3[] = []
  for (let y = 0; y < h; y++) {
    const r: number[] = []
    const g: number[] = []
    const b: number[] = []
    for (let x = 0; x < band; x++) for (const xx of [x, w - 1 - x]) {
      const i = (y * w + xx) * 3
      r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2])
    }
    rowBg.push({ r: medianOf(r), g: medianOf(g), b: medianOf(b) })
  }
  const rows = new Array<number>(h).fill(0)
  const cols = new Array<number>(w).fill(0)
  for (let y = 0; y < h; y++) {
    const bg = rowBg[y]
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      if (Math.abs(data[i] - bg.r) + Math.abs(data[i + 1] - bg.g) + Math.abs(data[i + 2] - bg.b) > threshold) {
        rows[y]++
        cols[x]++
      }
    }
  }
  const minRow = Math.max(2, Math.round(w * 0.006))
  const minCol = Math.max(2, Math.round(h * 0.006))
  const ys = rows.map((v, i) => (v >= minRow ? i : -1)).filter((i) => i >= 0)
  const xs = cols.map((v, i) => (v >= minCol ? i : -1)).filter((i) => i >= 0)
  if (!ys.length || !xs.length) return null
  return { x0: xs[0], y0: ys[0], x1: xs[xs.length - 1], y1: ys[ys.length - 1] }
}

/** Build the bleed layer from a studio photo (call analyzeStudioBackdrop first). */
export async function buildStudioBleed(bytes: Uint8Array | Buffer, opts: StudioBleedOptions = {}): Promise<StudioBleedLayer> {
  const full = await rawRgb(bytes)
  const small = await rawRgb(bytes, 480)
  const k = full.w / small.w
  const bb = productBbox(small.data, small.w, small.h, STUDIO_BLEED_RULES.diffThreshold)
  if (!bb) throw new Error('studio_bleed_failed: no product found on the backdrop')
  const shadowShare = baseShadowShare(small.data, small.w, small.h, bb)
  const x0 = Math.floor(bb.x0 * k)
  const y0 = Math.floor(bb.y0 * k)
  const x1 = Math.min(full.w - 1, Math.ceil((bb.x1 + 1) * k))
  const y1 = Math.min(full.h - 1, Math.ceil((bb.y1 + 1) * k))
  const side = Math.max(x1 - x0, y1 - y0)
  const margin = Math.round(side * (opts.margin ?? 0.06))
  const fade = Math.max(8, Math.round(side * (opts.fade ?? 0.16)))
  const edgeTol = Math.round(full.w * 0.01)
  const edgesTouched = [
    x0 <= edgeTol ? 'left' : '',
    y0 <= edgeTol ? 'top' : '',
    x1 >= full.w - 1 - edgeTol ? 'right' : '',
    y1 >= full.h - 1 - edgeTol ? 'bottom' : '',
  ].filter(Boolean)
  if (edgesTouched.length > STUDIO_BLEED_RULES.maxEdgesTouched) throw new Error(`studio_bleed_failed: product touches ${edgesTouched.join('+')} photo edges`)
  const cx0 = Math.max(0, x0 - margin - fade)
  const cy0 = Math.max(0, y0 - margin - fade)
  const cx1 = Math.min(full.w, x1 + 1 + margin + fade)
  const cy1 = Math.min(full.h, y1 + 1 + margin + fade)
  const W = cx1 - cx0
  const H = cy1 - cy0
  const rgba = Buffer.alloc(W * H * 4)
  // Opaque core: product bbox + margin (in layer coords).
  const ox0 = x0 - margin - cx0
  const oy0 = y0 - margin - cy0
  const ox1 = x1 + margin - cx0
  const oy1 = y1 + margin - cy0
  const ringR: number[] = []
  const ringG: number[] = []
  const ringB: number[] = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = ((y + cy0) * full.w + (x + cx0)) * 3
      const di = (y * W + x) * 4
      rgba[di] = full.data[si]
      rgba[di + 1] = full.data[si + 1]
      rgba[di + 2] = full.data[si + 2]
      const dx = Math.max(ox0 - x, x - ox1, 0)
      const dy = Math.max(oy0 - y, y - oy1, 0)
      // A side where the product leaves the photo stays opaque up to the layer edge (bleeds off-canvas).
      const ddx = (dx > 0 && ((x < ox0 && edgesTouched.includes('left')) || (x > ox1 && edgesTouched.includes('right')))) ? 0 : dx
      const ddy = (dy > 0 && ((y < oy0 && edgesTouched.includes('top')) || (y > oy1 && edgesTouched.includes('bottom')))) ? 0 : dy
      const d = Math.hypot(ddx, ddy)
      const t = Math.max(0, Math.min(1, 1 - d / fade))
      // The photo may end before the fade does (product near its edge): fade to 0 at the layer edge too.
      const de = Math.min(
        edgesTouched.includes('left') ? Infinity : x,
        edgesTouched.includes('right') ? Infinity : W - 1 - x,
        edgesTouched.includes('top') ? Infinity : y,
        edgesTouched.includes('bottom') ? Infinity : H - 1 - y,
      )
      const te = Math.max(0, Math.min(1, de / (fade * 0.5)))
      const a = t * t * (3 - 2 * t) * (te * te * (3 - 2 * te))
      rgba[di + 3] = Math.round(a * 255)
      if (d > fade * 0.15 && d < fade * 0.7 && (x + y) % 3 === 0) {
        ringR.push(full.data[si]); ringG.push(full.data[si + 1]); ringB.push(full.data[si + 2])
      }
    }
  }
  const backdrop = ringR.length ? { r: medianOf(ringR), g: medianOf(ringG), b: medianOf(ringB) } : { r: 240, g: 237, b: 230 }
  const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer()
  return {
    png,
    width: W,
    height: H,
    productBox: { x: x0 - cx0, y: y0 - cy0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    backdrop,
    edgesTouched,
    sourceWidth: full.w,
    sourceHeight: full.h,
    shadowShare,
  }
}

/** Soft-shadow share in the band around the product bbox's base (downscaled photo). */
function baseShadowShare(data: Buffer, w: number, h: number, bb: { x0: number; y0: number; x1: number; y1: number }): number {
  const bh = bb.y1 - bb.y0 + 1
  const yA = Math.max(0, Math.round(bb.y1 - bh * 0.15))
  const yB = Math.min(h - 1, Math.round(bb.y1 + bh * 0.04))
  const band = Math.max(2, Math.round(w * 0.03))
  const br: number[] = []
  for (let y = yA; y <= yB; y++) for (let x = 0; x < band; x++) for (const xx of [x, w - 1 - x]) {
    const i = (y * w + xx) * 3
    br.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
  }
  const ref = medianOf(br)
  let n = 0
  let sh = 0
  for (let y = yA; y <= yB; y++) for (let x = bb.x0; x <= bb.x1; x++) {
    const i = (y * w + x) * 3
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])
    n++
    // Dark studio: the grounding is the photo's own floor light pool (brighter than the near-black backdrop).
    if (ref <= 40 ? l >= ref + 5 && l <= ref + 110 && chroma <= 40 : l <= ref * 0.97 && l >= ref * 0.55 && chroma <= 40) sh++
  }
  return n ? Math.round((sh / n) * 1000) / 1000 : 0
}

/**
 * Procedural studio canvas (no paid generation): the brand light tone as a seamless sweep —
 * a soft key-light falloff from `light` and a gentle floor darkening toward the bottom, so the
 * scene has depth instead of a flat wall + table. Deterministic.
 */
export async function studioCanvas(width: number, height: number, tone: Rgb3, light: 'left' | 'right' | 'top' = 'left'): Promise<Buffer> {
  const hex = (c: Rgb3, k = 1) => `rgb(${Math.round(Math.min(255, c.r * k))},${Math.round(Math.min(255, c.g * k))},${Math.round(Math.min(255, c.b * k))})`
  const cx = light === 'left' ? 0.28 : light === 'right' ? 0.72 : 0.5
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs>` +
    `<radialGradient id="k" cx="${cx}" cy="0.32" r="0.95"><stop offset="0" stop-color="${hex(tone, 1.025)}"/><stop offset="0.55" stop-color="${hex(tone)}"/><stop offset="1" stop-color="${hex(tone, 0.94)}"/></radialGradient>` +
    `<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#3a2a14" stop-opacity="0.07"/></linearGradient>` +
    `</defs><rect width="100%" height="100%" fill="url(#k)"/><rect width="100%" height="100%" fill="url(#f)"/></svg>`
  return sharp(Buffer.from(svg)).removeAlpha().png({ compressionLevel: 0 }).toBuffer()
}

export interface PlacedBleed {
  png: Buffer
  box: Box
  /** Fidelity reference: the layer resized to the box, before the backdrop gain. */
  placed: Buffer
  gain: [number, number, number]
  /** >1 when the product had to be enlarged (Lanczos-3 + unsharp; resampling, not super-res). */
  upscale: number
}

/**
 * Composite the bleed layer into `box` on `base`: Lanczos-3 resample (+ mild unsharp mask; a
 * stronger one only when enlarging), then ONE global per-channel gain that maps the photo's
 * backdrop onto the canvas tone measured under the box (≤ ±12 % per channel; light/temperature
 * only — the product's relative colours and detail are untouched).
 */
export async function compositeBleed(base: Buffer, layer: StudioBleedLayer, box: Box, clip?: Box): Promise<PlacedBleed> {
  // The PRODUCT bbox (not the whole layer) fits the slot; the fade ring may extend past the slot
  // (it is the canvas tone after the gain, so nothing visible lands on the copy).
  const pb = layer.productBox
  // A side where the photo itself cut the product (wing leaving the frame) runs off the canvas
  // edge, as in the approved v1 set — never ends in a visible vertical cut inside the canvas.
  const meta0 = await sharp(base).metadata()
  const CW = meta0.width ?? 0
  const touchL = layer.edgesTouched.includes('left')
  const touchR = layer.edgesTouched.includes('right')
  const bx0 = touchL ? 0 : box.x
  const bx1 = touchR ? CW : box.x + box.w
  const wide: Box = { x: bx0, y: box.y, w: bx1 - bx0, h: box.h }
  // Round 1c: never enlarge the real pixels past BLEED_MAX_UPSCALE overall (counting any pre-upscale):
  // a smaller crisp product beats a bigger soft one (the gate caps at 1.6×).
  const pre = layer.preScale && layer.preScale > 1 ? layer.preScale : 1
  const fit = Math.min(wide.w / pb.w, wide.h / pb.h)
  const s = pre > 1 ? Math.min(fit, BLEED_MAX_UPSCALE / pre) : fit > 1 ? Math.min(fit, BLEED_MAX_UPSCALE) : fit
  const w = Math.max(1, Math.round(layer.width * s))
  const h = Math.max(1, Math.round(layer.height * s))
  const pw = Math.round(pb.w * s)
  const ph = Math.round(pb.h * s)
  const innerX = touchR ? CW - pw : touchL ? 0 : Math.round(wide.x + (wide.w - pw) / 2)
  const innerBox: Box = { x: innerX, y: Math.round(box.y + box.h - ph), w: pw, h: ph }
  const lx = innerBox.x - Math.round(pb.x * s)
  const ly = innerBox.y - Math.round(pb.y * s)
  let img = sharp(layer.png).resize(w, h, { kernel: 'lanczos3', fit: 'fill' })
  img = s > 1 ? img.sharpen({ sigma: 1.0, m1: 0.6, m2: 2.2 }) : img.sharpen({ sigma: 0.5, m1: 0.3, m2: 1.2 })
  const resized = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const meta = await sharp(base).metadata()
  const BW = meta.width ?? 0
  const BH = meta.height ?? 0
  // Canvas tone under the layer (clipped to the canvas).
  const rx = Math.max(0, lx)
  const ry = Math.max(0, ly)
  const rw = Math.max(1, Math.min(BW, lx + w) - rx)
  const rh = Math.max(1, Math.min(BH, ly + h) - ry)
  const st = await sharp(base).extract({ left: rx, top: ry, width: rw, height: rh }).removeAlpha().stats()
  const target = { r: st.channels[0].mean, g: st.channels[1].mean, b: st.channels[2].mean }
  const clampG = (v: number) => Math.max(0.88, Math.min(1.12, v))
  const gain: [number, number, number] = [clampG(target.r / Math.max(1, layer.backdrop.r)), clampG(target.g / Math.max(1, layer.backdrop.g)), clampG(target.b / Math.max(1, layer.backdrop.b))]
  const graded = Buffer.from(resized.data)
  for (let i = 0; i < graded.length; i += 4) {
    graded[i] = Math.min(255, Math.round(graded[i] * gain[0]))
    graded[i + 1] = Math.min(255, Math.round(graded[i + 1] * gain[1]))
    graded[i + 2] = Math.min(255, Math.round(graded[i + 2] * gain[2]))
  }
  // Fidelity reference: the resized layer (before the gain) over the product box, opaque.
  const ix = Math.max(0, Math.min(w - 1, innerBox.x - lx))
  const iy = Math.max(0, Math.min(h - 1, innerBox.y - ly))
  const placed = await sharp(resized.data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: ix, top: iy, width: Math.max(1, Math.min(pw, w - ix)), height: Math.max(1, Math.min(ph, h - iy)) })
    .png()
    .toBuffer()
  // Clip to the canvas (a bled side may extend past it).
  const left = Math.max(0, lx)
  const top = Math.max(0, ly)
  const cw = Math.min(BW, lx + w) - left
  const ch = Math.min(BH, ly + h) - top
  let layerImg = sharp(graded, { raw: { width: w, height: h, channels: 4 } })
  // Round 1c: a family may clip the layer to a region (e.g. below a solid colour band) so the photo's
  // plain backdrop never paints over the band; the cut lands on the canvas tone, never on the product.
  let ox = left, oy = top, ow = cw, oh = ch
  if (clip) {
    ox = Math.max(left, clip.x); oy = Math.max(top, clip.y)
    ow = Math.min(left + cw, clip.x + clip.w) - ox; oh = Math.min(top + ch, clip.y + clip.h) - oy
  }
  if (ow < 1 || oh < 1) { ox = left; oy = top; ow = cw; oh = ch }
  if (ow < w || oh < h) layerImg = layerImg.extract({ left: ox - lx, top: oy - ly, width: ow, height: oh })
  const overlay = await layerImg.png().toBuffer()
  const png = await sharp(base).composite([{ input: overlay, left: ox, top: oy }]).removeAlpha().png({ compressionLevel: 0 }).toBuffer()
  return { png, box: innerBox, placed, gain, upscale: Math.round(s * pre * 1000) / 1000 }
}
