/**
 * Product fidelity — deterministic photographic harmonization (exact mode, no model call).
 *
 * Makes the real product cut-out sit IN the plate instead of on top of it, without redrawing a
 * single product detail: every change is a bounded, smooth function of light (luminance gain
 * maps, a shared grade, a few px of edge light, grain), never of shape or identity color.
 *
 *  a) Light model per plate (`estimateLight`): key direction (prompted, cross-checked against the
 *     plate's luminance gradient around the slot), key/fill ratio, light color (plate highlights
 *     + ambient → white-balance gains, temperature / tint), ambient color (ring around the slot),
 *     grain level and acuity near the surface, tone percentiles, surface type.
 *  b) Product shading: directional luminance gradient (key side up, shadow side down, soft
 *     tanh falloff), form roll-off toward the silhouette, ambient occlusion near the base.
 *     Plus a uniform exposure match to the plate's light level (0.75–1.08). Luminance only
 *     (linear-RGB gain, hue/chroma ratios kept), bounded to [0.5, 1.22] in total.
 *  c) Color: partial white balance toward the plate light (≤ ±4 % per channel, luminance
 *     neutral) + ONE shared grade (tone curve + mild split-toning) applied to plate and product.
 *  d) Light wrap: plate light bleeding 1–3 px into edges that face the key light, only where the
 *     plate behind is brighter than the edge; alpha edge softened to the plate's acuity.
 *  e) Shadows: tight contact shadow + ground AO + a cast shadow projected away from the light on
 *     the surface plane (perspective squash, length from light elevation, penumbra widening with
 *     distance), tinted by the ambient color (never pure black).
 *  f) Reflection on glossy surfaces: flipped, faded, blurred product under the base.
 *  g) Grain + defocus match: plate noise / acuity measured, the product gets the missing grain
 *     and (≤ 1 px) defocus so it is not crisper or cleaner than the photo it sits in.
 *
 * sharp for decode/encode; the pixel math is plain TS. Same inputs → same bytes (seeded grain).
 */
import sharp from 'sharp'
import type { Box } from '../render/types.js'
import type { LightDirection, PlateSurface } from '../types.js'
import { blurPlane, distanceInside, gaussianRng, linearToSrgb, maskedBlurMany, srgbToLinear } from './pixels.js'

export type Rgb3 = [number, number, number]

export interface LightModel {
  /** Direction used for shading / shadows. */
  direction: LightDirection
  /** Direction the plate was prompted with (null when unknown). */
  prompted: LightDirection | null
  /** Direction read from the plate's luminance gradient around the slot (null = no clear gradient). */
  estimated: LightDirection | null
  /** Horizontal luminance gradient around the slot, relative to its mean (+ = brighter to the right). */
  gradient: number
  /** Unit vector (image plane, y down) from the product toward the key light. */
  vector: [number, number]
  /** 0 (grazing) … 1 (overhead). */
  elevation: number
  /** Key / fill luminance ratio around the slot (≥ 1). */
  keyFill: number
  /** −1 cool … +1 warm. */
  temperature: number
  /** −1 green … +1 magenta. */
  tint: number
  /** Luminance-neutral channel gains of the plate light (full strength; applied partially). */
  whiteBalance: Rgb3
  /** Mean sRGB color around the slot. */
  ambient: Rgb3
  /** sRGB color of the plate highlights (max channel = 255). */
  keyColor: Rgb3
  /** Plate grain σ (8-bit levels) near the surface. */
  noise: number
  /** Fine-detail energy ratio of the plate near the slot (lower = softer photo). */
  acuity: number
  tone: { p5: number; p50: number; p95: number }
  surface: PlateSurface
}

/** Shared grade (applied to the plate AND the product so both carry the same look). */
export interface Grade {
  /** S-curve amount (0 = identity). */
  curve: number
  /** Black lift (0–1 units at black). */
  lift: number
  /** Added in shadows / highlights (0–1 units, per channel). */
  shadowTint: Rgb3
  highlightTint: Rgb3
}

/** Bounds (owner rule: light may change, the product may not). */
export const HARMONIZE_LIMITS = {
  /** Max per-channel white-balance shift toward the plate light. */
  wbMaxGain: 0.04,
  /** Share of the plate light color applied to the product (before the cap). */
  wbStrength: 0.45,
  /** Product luminance gain range (shading + AO). */
  gainMin: 0.5,
  gainMax: 1.22,
  /** Light wrap width (px) and max mix. */
  wrapMaxPx: 3,
  wrapMax: 0.25,
  /** Max grain σ added (8-bit levels) and max defocus σ (px). */
  grainMax: 4.5,
  defocusMax: 0.6,
} as const

const lumaLin = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const lumaSrgb = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export const LIGHT_VECTORS: Record<LightDirection, [number, number]> = {
  left: [-0.83, -0.56],
  right: [0.83, -0.56],
  top: [0, -1],
}

function percentile(sorted: Float32Array | number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]
}

/** Least-squares plane L = a + b·u + c·v. */
function fitPlane(samples: Array<[number, number, number]>): [number, number, number] {
  let n = 0, su = 0, sv = 0, suu = 0, svv = 0, suv = 0, sl = 0, sul = 0, svl = 0
  for (const [u, v, l] of samples) {
    n++
    su += u
    sv += v
    suu += u * u
    svv += v * v
    suv += u * v
    sl += l
    sul += u * l
    svl += v * l
  }
  if (n < 3) return [sl / Math.max(1, n), 0, 0]
  // Solve [[n su sv][su suu suv][sv suv svv]] x = [sl sul svl] (Cramer).
  const m = [n, su, sv, su, suu, suv, sv, suv, svv]
  const det3 = (a: number[]) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6])
  const D = det3(m)
  if (Math.abs(D) < 1e-9) return [sl / n, 0, 0]
  const rep = (col: number) => {
    const c = m.slice()
    const rhs = [sl, sul, svl]
    for (let r = 0; r < 3; r++) c[r * 3 + col] = rhs[r]
    return det3(c) / D
  }
  return [rep(0), rep(1), rep(2)]
}

/** Fine-detail energy ratio: var(I − blur₀.₈ I) / var(I − blur₂.₅ I) over weighted pixels. */
export function acuity(grayPx: Float32Array, w: number, h: number, weight?: Uint8Array | Float32Array): number {
  const b1 = blurPlane(grayPx, w, h, 0.8)
  const b2 = blurPlane(grayPx, w, h, 2.5)
  let e1 = 0
  let e2 = 0
  for (let i = 0; i < w * h; i++) {
    if (weight && !weight[i]) continue
    const d1 = grayPx[i] - b1[i]
    const d2 = grayPx[i] - b2[i]
    e1 += d1 * d1
    e2 += d2 * d2
  }
  return e2 > 1e-6 ? e1 / e2 : 0
}

/** Robust grain σ (8-bit levels) from the 3×3 residual (MAD), over weighted pixels. */
export function grainSigma(grayPx: Float32Array, w: number, h: number, weight?: Uint8Array | Float32Array): number {
  const vals: number[] = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (weight && !weight[i]) continue
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += grayPx[i + dy * w + dx]
      vals.push(Math.abs(grayPx[i] - s / 9))
    }
  }
  if (vals.length < 50) return 0
  vals.sort((a, b) => a - b)
  return 1.4826 * vals[vals.length >> 1] * 1.06
}

function clipBox(b: Box, W: number, H: number): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: clamp(Math.floor(b.x), 0, W), y0: clamp(Math.floor(b.y), 0, H), x1: clamp(Math.ceil(b.x + b.w), 0, W), y1: clamp(Math.ceil(b.y + b.h), 0, H) }
}

/** Light model of a plate around the product slot (canvas px). */
export async function estimateLight(plate: Buffer | Uint8Array, slot: Box, opts: { light?: LightDirection; surface?: PlateSurface } = {}): Promise<LightModel> {
  const meta = await sharp(plate).metadata()
  const W = meta.width ?? 1
  const H = meta.height ?? 1
  const SW = Math.min(256, W)
  const scale = SW / W
  const SH = Math.max(1, Math.round(H * scale))
  const small = await sharp(plate).removeAlpha().resize(SW, SH, { fit: 'fill' }).raw().toBuffer()
  const n = SW * SH
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) lum[i] = lumaSrgb(small[i * 3], small[i * 3 + 1], small[i * 3 + 2])

  // Ring around the slot (small coords), slot itself excluded.
  const s = { x: slot.x * scale, y: slot.y * scale, w: slot.w * scale, h: slot.h * scale }
  const pad = 0.35 * Math.max(s.w, s.h)
  const ring = clipBox({ x: s.x - pad, y: s.y - pad, w: s.w + 2 * pad, h: s.h + 2 * pad }, SW, SH)
  const cx = s.x + s.w / 2
  const cy = s.y + s.h / 2
  const hx = Math.max(1, (ring.x1 - ring.x0) / 2)
  const hy = Math.max(1, (ring.y1 - ring.y0) / 2)
  const samples: Array<[number, number, number]> = []
  const amb = [0, 0, 0]
  let keySum = 0, keyN = 0, fillSum = 0, fillN = 0
  for (let y = ring.y0; y < ring.y1; y++) {
    for (let x = ring.x0; x < ring.x1; x++) {
      if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) continue
      const i = y * SW + x
      const u = (x - cx) / hx
      const v = (y - cy) / hy
      samples.push([u, v, lum[i]])
      for (let c = 0; c < 3; c++) amb[c] += small[i * 3 + c]
    }
  }
  const ringN = Math.max(1, samples.length)
  const ambient: Rgb3 = [amb[0] / ringN, amb[1] / ringN, amb[2] / ringN]
  const [a0, bx, cyv] = fitPlane(samples)
  const meanL = Math.max(8, a0)
  const relX = bx / meanL
  const relY = cyv / meanL
  const estimated: LightDirection | null = Math.abs(relX) >= 0.05 ? (relX > 0 ? 'right' : 'left') : relY < -0.08 ? 'top' : null
  const prompted = opts.light ?? null
  // The prompt is the plan; a plate that clearly lit the other side wins (the model ignored the prompt).
  const direction: LightDirection = prompted && estimated && estimated !== prompted && estimated !== 'top' && Math.abs(relX) >= 0.12 ? estimated : prompted ?? estimated ?? 'left'
  const vector = LIGHT_VECTORS[direction]
  for (const [u, v, l] of samples) {
    const t = u * vector[0] + v * vector[1]
    if (t > 0.15) (keySum += srgbToLinear(l)), keyN++
    else if (t < -0.15) (fillSum += srgbToLinear(l)), fillN++
  }
  const keyMean = keyN ? keySum / keyN : 0
  const fillMean = fillN ? fillSum / fillN : 0
  const gradRatio = 1 + Math.abs(relX) * 2.5
  const keyFill = clamp(keyMean > 0 && fillMean > 0 ? Math.max(keyMean / fillMean, gradRatio) : gradRatio, 1.15, 2.6)

  // Highlights (light color): top 8 % luma, not strongly saturated.
  const sorted = Float32Array.from(lum).sort()
  const p92 = percentile(sorted, 0.92)
  const hi = [0, 0, 0]
  let hiN = 0
  for (const strict of [true, false]) {
    for (let i = 0; i < n && (strict || !hiN); i++) {
      if (lum[i] < p92) continue
      const r = small[i * 3]
      const g = small[i * 3 + 1]
      const b = small[i * 3 + 2]
      const mx = Math.max(r, g, b)
      if (strict && mx > 0 && (mx - Math.min(r, g, b)) / mx > 0.45) continue
      hi[0] += r
      hi[1] += g
      hi[2] += b
      hiN++
    }
    if (hiN) break
  }
  const hiMax = Math.max(1, hi[0], hi[1], hi[2])
  const keyColor: Rgb3 = hiN ? [(hi[0] / hiMax) * 255, (hi[1] / hiMax) * 255, (hi[2] / hiMax) * 255] : [255, 255, 255]
  // Plate light color = mostly the highlights, a little of the ambient bounce.
  const ambMax = Math.max(1, ...ambient)
  const lightLin = [0, 1, 2].map((c) => 0.7 * srgbToLinear(keyColor[c]) + 0.3 * srgbToLinear((ambient[c] / ambMax) * 255))
  const ly = Math.max(1e-4, lumaLin(lightLin[0], lightLin[1], lightLin[2]))
  const whiteBalance = lightLin.map((v) => clamp(v / ly, 0.5, 1.6)) as Rgb3
  const temperature = clamp((whiteBalance[0] - whiteBalance[2]) / 0.35, -1, 1)
  const tint = clamp(((whiteBalance[0] + whiteBalance[2]) / 2 - whiteBalance[1]) / 0.2, -1, 1)

  // Grain + acuity at full resolution on the surface right under / around the slot.
  const surf = clipBox({ x: slot.x - slot.w * 0.25, y: slot.y + slot.h * 0.8, w: slot.w * 1.5, h: Math.max(24, slot.h * 0.3) }, W, H)
  let noise = 0
  let acu = 0.25
  if (surf.x1 - surf.x0 >= 16 && surf.y1 - surf.y0 >= 16) {
    const g = await sharp(plate).removeAlpha().extract({ left: surf.x0, top: surf.y0, width: surf.x1 - surf.x0, height: surf.y1 - surf.y0 }).greyscale().raw().toBuffer({ resolveWithObject: true })
    const f = Float32Array.from(g.data)
    noise = clamp(grainSigma(f, g.info.width, g.info.height), 0, 8)
    acu = acuity(f, g.info.width, g.info.height)
  }
  const elevation = direction === 'top' ? 0.8 : 0.45
  return {
    direction,
    prompted,
    estimated,
    gradient: Math.round(relX * 1000) / 1000,
    vector,
    elevation,
    keyFill: Math.round(keyFill * 100) / 100,
    temperature: Math.round(temperature * 100) / 100,
    tint: Math.round(tint * 100) / 100,
    whiteBalance,
    ambient,
    keyColor,
    noise: Math.round(noise * 100) / 100,
    acuity: Math.round(acu * 1000) / 1000,
    tone: { p5: percentile(sorted, 0.05), p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) },
    surface: opts.surface ?? 'matte',
  }
}

/** The shared grade for a plate: gentle S-curve, lifted blacks, shadows → ambient hue, highlights → key light hue. */
export function gradeFor(model: LightModel): Grade {
  const chromaDir = (c: Rgb3, amount: number): Rgb3 => {
    const m = (c[0] + c[1] + c[2]) / 3 || 1
    const d = c.map((v) => (v - m) / m)
    const len = Math.hypot(d[0], d[1], d[2])
    const k = len > 1e-3 ? Math.min(1, len / 0.35) * amount : 0
    return (len > 1e-3 ? d.map((v) => (v / len) * k) : [0, 0, 0]) as Rgb3
  }
  const contrast = (model.tone.p95 - model.tone.p5) / 255
  return {
    curve: clamp(0.16 - contrast * 0.08, 0.06, 0.14),
    lift: 0.012,
    shadowTint: chromaDir(model.ambient, 0.03),
    highlightTint: chromaDir(model.keyColor, 0.025),
  }
}

function curveLut(grade: Grade): Float32Array {
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let y = x - (grade.curve * Math.sin(2 * Math.PI * x)) / (2 * Math.PI)
    y = y + grade.lift * Math.pow(1 - y, 3)
    lut[i] = y
  }
  return lut
}

/** Grade one sRGB pixel (0–255 floats) in place into `out`. */
function gradePixel(r: number, g: number, b: number, lut: Float32Array, grade: Grade, out: Float32Array, o: number): void {
  const yr = lut[clamp(Math.round(r), 0, 255)]
  const yg = lut[clamp(Math.round(g), 0, 255)]
  const yb = lut[clamp(Math.round(b), 0, 255)]
  const Y = lumaSrgb(yr, yg, yb)
  // Split-toning peaks in the low mids (4·Y·(1−Y)² → 0 at black): an additive tint on near-black
  // colors would change their identity (navy-black must stay navy-black).
  const ws = 4 * Y * (1 - Y) * (1 - Y)
  const wh = Y * Y
  out[o] = clamp((yr + ws * grade.shadowTint[0] + wh * grade.highlightTint[0]) * 255, 0, 255)
  out[o + 1] = clamp((yg + ws * grade.shadowTint[1] + wh * grade.highlightTint[1]) * 255, 0, 255)
  out[o + 2] = clamp((yb + ws * grade.shadowTint[2] + wh * grade.highlightTint[2]) * 255, 0, 255)
}

/** Grade raw RGB/RGBA bytes in place (alpha untouched). */
export function gradeRaw(data: Buffer | Uint8Array, channels: number, grade: Grade): void {
  const lut = curveLut(grade)
  const tmp = new Float32Array(3)
  const n = Math.floor(data.length / channels)
  for (let i = 0; i < n; i++) {
    const o = i * channels
    gradePixel(data[o], data[o + 1], data[o + 2], lut, grade, tmp, 0)
    data[o] = Math.round(tmp[0])
    data[o + 1] = Math.round(tmp[1])
    data[o + 2] = Math.round(tmp[2])
  }
}

/** Grade a whole image (PNG/JPEG in → PNG out, same size, alpha dropped). */
export async function gradeImage(image: Buffer | Uint8Array, grade: Grade): Promise<Buffer> {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  gradeRaw(data, 3, grade)
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
}

/** Luminance-neutral, capped channel gains toward the plate light. */
export function whiteBalanceGains(model: Pick<LightModel, 'whiteBalance'>, strength: number = HARMONIZE_LIMITS.wbStrength): Rgb3 {
  const raw = model.whiteBalance.map((g) => Math.pow(Math.max(1e-3, g), strength))
  const l = lumaLin(raw[0], raw[1], raw[2]) || 1
  const capped = raw.map((g) => clamp(g / l, 1 - HARMONIZE_LIMITS.wbMaxGain, 1 + HARMONIZE_LIMITS.wbMaxGain))
  const l2 = lumaLin(capped[0], capped[1], capped[2]) || 1
  return capped.map((g) => clamp(g / l2, 1 - HARMONIZE_LIMITS.wbMaxGain, 1 + HARMONIZE_LIMITS.wbMaxGain)) as Rgb3
}

/** Directional shading amplitude from the plate's key/fill ratio. */
export function shadingStrength(keyFill: number): number {
  return clamp(0.1 + 0.08 * (keyFill - 1), 0.1, 0.2)
}

/** Exposure gain (0.75–1.08) that keeps the product's mean light level within 0.9–3.2× the plate's around the slot. */
export function exposureGain(R: Float32Array, G: Float32Array, B: Float32Array, solid: Uint8Array, model: Pick<LightModel, 'ambient'>): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < solid.length; i++) {
    if (!solid[i]) continue
    sum += lumaLin(R[i], G[i], B[i])
    n++
  }
  if (!n) return 1
  const yp = Math.max(1e-4, sum / n)
  const ya = Math.max(1e-3, lumaLin(srgbToLinear(model.ambient[0]), srgbToLinear(model.ambient[1]), srgbToLinear(model.ambient[2])))
  const target = clamp(yp, ya * 0.9, ya * 3.2)
  return clamp(Math.pow(target / yp, 0.6), 0.75, 1.08)
}

export interface ProductMaskInfo {
  w: number
  h: number
  alpha: Float32Array
  solid: Uint8Array
  dist: Float32Array
  x0: number
  y0: number
  x1: number
  y1: number
}

export function maskInfo(rgba: Buffer | Uint8Array, w: number, h: number): ProductMaskInfo {
  const alpha = new Float32Array(w * h)
  const solid = new Uint8Array(w * h)
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let i = 0; i < w * h; i++) {
    alpha[i] = rgba[i * 4 + 3] / 255
    if (rgba[i * 4 + 3] >= 128) {
      solid[i] = 1
      const x = i % w
      const y = (i - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return { w, h, alpha, solid, dist: distanceInside(solid, w, h), x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) }
}

/**
 * Luminance gain map of the product (shading + roll-off + AO), 1 outside the mask.
 * Exported for the fidelity tests (a "relit" reference).
 */
export function shadingGains(m: ProductMaskInfo, model: Pick<LightModel, 'vector' | 'keyFill' | 'elevation'>): Float32Array {
  const { w, h, solid, dist } = m
  const bw = Math.max(1, m.x1 - m.x0 + 1)
  const bh = Math.max(1, m.y1 - m.y0 + 1)
  const cx = (m.x0 + m.x1) / 2
  const cy = (m.y0 + m.y1) / 2
  const [vx, vy] = model.vector
  const s = shadingStrength(model.keyFill)
  const rollPx = Math.max(2, 0.16 * Math.min(bw, bh))
  const aoBand = Math.max(2, 0.12 * bh)
  const G = new Float32Array(w * h).fill(1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!solid[i] && m.alpha[i] <= 0) continue
      const u = (x - cx) / (bw / 2)
      const v = (y - cy) / (bh / 2)
      const t = u * vx + v * vy
      let dir = s * Math.tanh(1.3 * t)
      if (dir < 0) dir *= 1.4
      const e = Math.pow(1 - Math.min(1, dist[i] / rollPx), 2)
      const roll = e * (t > 0 ? 0.35 * s * Math.min(1, t) : -0.8 * s * Math.min(1, -t)) - 0.03 * e
      const top = -0.04 * v * model.elevation
      const q = clamp((y - (m.y1 - aoBand)) / aoBand, 0, 1)
      const ao = -0.2 * Math.pow(q, 1.6)
      G[i] = clamp(Math.exp(dir + roll + top + ao), HARMONIZE_LIMITS.gainMin, HARMONIZE_LIMITS.gainMax)
    }
  }
  return G
}

export interface HarmonizeLayerInput {
  /** Cut-out at box size (RGBA PNG). */
  placed: Buffer
  /** Plate under the box (graded), raw RGB at box size. */
  background: Buffer
  model: LightModel
  grade: Grade | null
  /** Seed for the grain (deterministic). */
  seed?: number
  /** Skip parts of the stage (tests / QA comparisons). */
  shading?: boolean
  lightWrap?: boolean
  grain?: boolean
}

export interface HarmonizeReport {
  wbGains: Rgb3
  shading: { strength: number; min: number; max: number }
  /** Uniform exposure gain toward the plate's light level. */
  exposure: number
  defocusSigma: number
  wrapPx: number
  grainSigma: number
  edgeSigma: number
}

/** b + c + d + g on one product layer. Returns the RGBA PNG to composite at the box. */
export async function harmonizeLayer(input: HarmonizeLayerInput): Promise<{ png: Buffer; report: HarmonizeReport }> {
  const { data, info } = await sharp(input.placed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const N = w * h
  const m = maskInfo(data, w, h)
  const model = input.model
  const bw = Math.max(1, m.x1 - m.x0 + 1)
  const bh = Math.max(1, m.y1 - m.y0 + 1)
  const interior = new Uint8Array(N)
  for (let i = 0; i < N; i++) interior[i] = m.dist[i] >= 4 ? 1 : 0

  // g) defocus match: never crisper than the plate around it (≤ 1 px).
  const gray = new Float32Array(N)
  for (let i = 0; i < N; i++) gray[i] = lumaSrgb(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
  const prodAcuity = acuity(gray, w, h, interior)
  let defocus = 0
  if (prodAcuity > model.acuity * 1.25 && model.acuity > 0) {
    let best = Math.abs(prodAcuity - model.acuity)
    for (const sg of [0.3, 0.45, 0.6]) {
      const a = acuity(blurPlane(gray, w, h, sg), w, h, interior)
      const d = Math.abs(a - model.acuity)
      if (d < best) {
        best = d
        defocus = sg
      }
    }
    defocus = Math.min(defocus, HARMONIZE_LIMITS.defocusMax)
  }

  // Linear planes.
  let R: Float32Array = new Float32Array(N)
  let Gc: Float32Array = new Float32Array(N)
  let B: Float32Array = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    R[i] = srgbToLinear(data[i * 4])
    Gc[i] = srgbToLinear(data[i * 4 + 1])
    B[i] = srgbToLinear(data[i * 4 + 2])
  }
  if (defocus > 0) {
    const [r2, g2, b2] = maskedBlurMany([R, Gc, B], m.alpha, w, h, defocus)
    R = r2
    Gc = g2
    B = b2
  }

  // c) partial white balance + b) shading (luminance only).
  const wb = whiteBalanceGains(model)
  const S = input.shading === false ? null : shadingGains(m, model)
  // Exposure match: a studio-bright product dropped into a low-key plate (or a dull one into a
  // bright set) is pulled toward the light level around the slot. Uniform gain, bounded.
  const exposure = input.shading === false ? 1 : exposureGain(R, Gc, B, m.solid, model)
  let gmin = 1
  let gmax = 1
  for (let i = 0; i < N; i++) {
    const g = S ? S[i] : 1
    if (m.solid[i]) {
      if (g < gmin) gmin = g
      if (g > gmax) gmax = g
    }
    let r = R[i] * wb[0] * g * exposure
    let gg = Gc[i] * wb[1] * g * exposure
    let b = B[i] * wb[2] * g * exposure
    const mx = Math.max(r, gg, b)
    if (mx > 1) {
      // Soft highlight clip that keeps the hue (scale, don't clip channels independently).
      r /= mx
      gg /= mx
      b /= mx
    }
    R[i] = r
    Gc[i] = gg
    B[i] = b
  }

  // d) light wrap: plate light bleeding into the key-facing edges (+ faint ambient wrap).
  const wrapPx = input.lightWrap === false ? 0 : clamp(Math.round(Math.min(bw, bh) / 140), 1, HARMONIZE_LIMITS.wrapMaxPx)
  if (wrapPx > 0) {
    const bgR = new Float32Array(N)
    const bgG = new Float32Array(N)
    const bgB = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      bgR[i] = srgbToLinear(input.background[i * 3])
      bgG[i] = srgbToLinear(input.background[i * 3 + 1])
      bgB[i] = srgbToLinear(input.background[i * 3 + 2])
    }
    const sg = wrapPx * 2 + 2
    const bR = blurPlane(bgR, w, h, sg)
    const bG = blurPlane(bgG, w, h, sg)
    const bB = blurPlane(bgB, w, h, sg)
    const ds = blurPlane(m.dist, w, h, 1.5)
    const [vx, vy] = model.vector
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const d = m.dist[i]
        if (!m.solid[i] || d > wrapPx + 0.5) continue
        // Outward normal = −∇dist.
        let nx = -(ds[i + 1] - ds[i - 1])
        let ny = -(ds[i + w] - ds[i - w])
        const len = Math.hypot(nx, ny)
        if (len > 1e-6) {
          nx /= len
          ny /= len
        }
        const facing = Math.max(0, nx * vx + ny * vy)
        // Light wraps only where the plate behind is brighter than the product edge (it is light, not paint).
        const yP = lumaLin(R[i], Gc[i], B[i])
        const yB = lumaLin(bR[i], bG[i], bB[i])
        const brighter = clamp((yB - yP) / Math.max(0.05, yB), 0, 1)
        const k = clamp(0.32 * facing * brighter * Math.pow(1 - Math.max(0, d - 0.5) / (wrapPx + 0.5), 1.5), 0, HARMONIZE_LIMITS.wrapMax)
        if (k <= 0) continue
        R[i] = R[i] * (1 - k) + Math.min(1, bR[i] * 1.08) * k
        Gc[i] = Gc[i] * (1 - k) + Math.min(1, bG[i] * 1.08) * k
        B[i] = B[i] * (1 - k) + Math.min(1, bB[i] * 1.08) * k
      }
    }
  }

  // Back to sRGB + the shared grade.
  const out = Buffer.alloc(N * 4)
  const lut = input.grade ? curveLut(input.grade) : null
  const px = new Float32Array(3)
  // g) grain: what the plate has and the product lacks.
  const prodNoise = grainSigma(gray, w, h, interior)
  const grain = input.grain === false ? 0 : clamp(Math.sqrt(Math.max(0, model.noise * model.noise - prodNoise * prodNoise)), model.noise >= 0.8 ? 0.5 : 0, HARMONIZE_LIMITS.grainMax)
  const rng = gaussianRng((input.seed ?? 0) ^ (w * 73856093) ^ (h * 19349663))
  for (let i = 0; i < N; i++) {
    let r = linearToSrgb(R[i])
    let g = linearToSrgb(Gc[i])
    let b = linearToSrgb(B[i])
    if (lut && input.grade) {
      gradePixel(r, g, b, lut, input.grade, px, 0)
      r = px[0]
      g = px[1]
      b = px[2]
    }
    if (grain > 0 && m.alpha[i] > 0) {
      const mono = rng() * grain
      r += mono + rng() * grain * 0.25
      g += mono + rng() * grain * 0.25
      b += mono + rng() * grain * 0.25
    }
    out[i * 4] = clamp(Math.round(r), 0, 255)
    out[i * 4 + 1] = clamp(Math.round(g), 0, 255)
    out[i * 4 + 2] = clamp(Math.round(b), 0, 255)
  }

  // d) edge anti-alias matched to the plate's acuity (softer photo → softer edge).
  const edgeSigma = clamp(0.35 + (model.acuity > 0 && prodAcuity > model.acuity ? 0.35 * Math.min(1, prodAcuity / model.acuity - 1) : 0), 0.35, 0.7)
  const a2 = blurPlane(m.alpha, w, h, edgeSigma)
  // Edge decontamination: the cut-out's outermost ring (and its transparent pixels, which the
  // softened alpha now shows a little) still carries the photo's backdrop color — a light fringe
  // reads as a sticker outline. Those pixels take the product color from just inside instead.
  const inner = new Float32Array(N)
  for (let i = 0; i < N; i++) inner[i] = m.dist[i] >= 2 ? 1 : 0
  const planes = maskedBlurMany(
    [0, 1, 2].map((c) => {
      const p = new Float32Array(N)
      for (let i = 0; i < N; i++) p[i] = out[i * 4 + c]
      return p
    }),
    inner,
    w,
    h,
    1.5,
    -1,
  )
  for (let i = 0; i < N; i++) {
    if (m.dist[i] >= 2) continue
    if (planes[0][i] < 0) continue
    const keep = m.dist[i] >= 1 ? 0.35 : 0
    for (let c = 0; c < 3; c++) out[i * 4 + c] = clamp(Math.round(out[i * 4 + c] * keep + planes[c][i] * (1 - keep)), 0, 255)
  }
  for (let i = 0; i < N; i++) out[i * 4 + 3] = clamp(Math.round((m.dist[i] >= 2 ? m.alpha[i] : a2[i]) * 255), 0, 255)

  const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  return {
    png,
    report: {
      wbGains: wb.map((v) => Math.round(v * 1000) / 1000) as Rgb3,
      shading: { strength: Math.round(shadingStrength(model.keyFill) * 1000) / 1000, min: Math.round(gmin * 1000) / 1000, max: Math.round(gmax * 1000) / 1000 },
      exposure: Math.round(exposure * 1000) / 1000,
      defocusSigma: defocus,
      wrapPx,
      grainSigma: Math.round(grain * 100) / 100,
      edgeSigma: Math.round(edgeSigma * 100) / 100,
    },
  }
}

// ---------------------------------------------------------------------------
// e/f) Ground effects on the plate: reflection, cast shadow, contact shadow + ground AO
// ---------------------------------------------------------------------------

export interface GroundLayer {
  /** Product RGBA raw at box size (pre-harmonization is fine: only alpha + rough color are used). */
  rgba: Buffer
  w: number
  h: number
  box: { x: number; y: number }
}

export interface GroundOptions {
  shadow?: boolean
  reflection?: boolean
  /**
   * Overhead plate + flat-lay product (P1 #6): the pieces LIE on the surface, seen from above — a
   * soft drop shadow + tight ambient occlusion directly under every component, no cast shadow
   * (no perspective ground plane) and no reflection.
   */
  topDown?: boolean
}

/** Contact-shadow strengths (P1 #7: stronger grounding so a product never looks pasted on). */
export const GROUND_STRENGTH = { contact: 0.9, ao: 0.46 } as const

/** Top-down drop shadow + AO under every opaque component of each layer (in place). */
function applyTopDownShadows(base: Buffer, W: number, H: number, layers: GroundLayer[], model: LightModel, tintK: Rgb3): void {
  for (const L of layers) {
    const m = maskInfo(L.rgba, L.w, L.h)
    if (m.x1 < m.x0 || m.y1 < m.y0) continue
    const small = Math.max(8, Math.min(m.x1 - m.x0 + 1, m.y1 - m.y0 + 1))
    const sigma = Math.max(2, 0.022 * small)
    const pad = Math.ceil(sigma * 3) + 4
    // Light from the side tilts the drop shadow a little away from it; overhead light → straight under.
    const dx = Math.round((model.direction === 'left' ? 1 : model.direction === 'right' ? -1 : 0) * 0.35 * sigma)
    const dy = Math.round(0.45 * sigma)
    const rw = L.w + pad * 2
    const rh = L.h + pad * 2
    const acc = new Float32Array(rw * rh)
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) acc[(y + pad + dy) * rw + x + pad + dx] = m.alpha[y * L.w + x] ?? 0
    const soft = blurPlane(acc, rw, rh, sigma)
    const tight = blurPlane(acc, rw, rh, Math.max(1, sigma * 0.3))
    for (let y = 0; y < rh; y++) {
      const ty = L.box.y + y - pad
      if (ty < 0 || ty >= H) continue
      for (let x = 0; x < rw; x++) {
        const tx = L.box.x + x - pad
        if (tx < 0 || tx >= W) continue
        const j = y * rw + x
        const A = 1 - (1 - 0.42 * Math.min(1, soft[j])) * (1 - 0.3 * Math.min(1, tight[j]))
        if (A < 2e-3) continue
        const o = (ty * W + tx) * 3
        for (let c = 0; c < 3; c++) base[o + c] = Math.round(linearToSrgb(srgbToLinear(base[o + c]) * (1 - A * (1 - tintK[c]))))
      }
    }
  }
}

/** Draw reflection + shadows for each product directly into raw RGB `base` (W×H), in place. */
export function applyGroundEffects(base: Buffer, W: number, H: number, layers: GroundLayer[], model: LightModel, opts: GroundOptions = {}): void {
  const ambMax = Math.max(1, ...model.ambient)
  // Shadow color: the ambient bounce, never pure black.
  const tintK = model.ambient.map((c) => clamp(0.2 * srgbToLinear((c / ambMax) * 255) + 0.04, 0.04, 0.3)) as Rgb3
  if (opts.topDown) {
    if (opts.shadow !== false) applyTopDownShadows(base, W, H, layers, model, tintK)
    return
  }
  for (const L of layers) {
    const m = maskInfo(L.rgba, L.w, L.h)
    if (m.x1 < m.x0 || m.y1 < m.y0) continue
    const bw = m.x1 - m.x0 + 1
    const bh = m.y1 - m.y0 + 1
    const ybLocal = m.y1
    const yb = L.box.y + ybLocal
    // Region that the effects can touch (canvas px).
    const len = clamp((0.95 * (1 - model.elevation)) / Math.max(0.2, model.elevation), 0.35, 1.3) * 0.75
    const dirX = model.direction === 'left' ? 1 : model.direction === 'right' ? -1 : 0
    const squash = model.direction === 'top' ? 0.05 : 0.2
    const reach = Math.ceil(bh * len) + 0
    const pad = Math.ceil(0.2 * bh) + 8
    const rx0 = clamp(L.box.x + m.x0 - (dirX < 0 ? reach : 0) - pad, 0, W)
    const rx1 = clamp(L.box.x + m.x1 + (dirX > 0 ? reach : 0) + pad, 0, W)
    const ry0 = clamp(yb - Math.ceil(bh * squash) - pad, 0, H)
    const ry1 = clamp(yb + Math.ceil(bh * 0.45) + pad, 0, H)
    const rw = rx1 - rx0
    const rh = ry1 - ry0
    if (rw < 2 || rh < 2) continue
    const idx = (x: number, y: number) => (y - ry0) * rw + (x - rx0)

    // f) Reflection (glossy surfaces only).
    if (opts.reflection !== false && model.surface === 'glossy') {
      const accA = new Float32Array(rw * rh)
      const accR = new Float32Array(rw * rh)
      const accG = new Float32Array(rw * rh)
      const accB = new Float32Array(rw * rh)
      const reflH = 0.4 * bh
      for (let y = Math.max(0, Math.round(ybLocal - reflH)); y <= ybLocal; y++) {
        const up = ybLocal - y
        const fade = 0.3 * Math.pow(1 - up / reflH, 2)
        const ty = yb + 1 + Math.round(up * 0.9)
        if (ty < ry0 || ty >= ry1) continue
        for (let x = 0; x < L.w; x++) {
          const a = m.alpha[y * L.w + x]
          if (a <= 0) continue
          const tx = L.box.x + x
          if (tx < rx0 || tx >= rx1) continue
          const j = idx(tx, ty)
          const k = a * fade
          accA[j] = Math.max(accA[j], k)
          const o = (y * L.w + x) * 4
          accR[j] = srgbToLinear(L.rgba[o]) * k
          accG[j] = srgbToLinear(L.rgba[o + 1]) * k
          accB[j] = srgbToLinear(L.rgba[o + 2]) * k
        }
      }
      const sg = Math.max(1.5, 0.008 * bh)
      const A = blurPlane(accA, rw, rh, sg)
      const Rr = blurPlane(accR, rw, rh, sg)
      const Rg = blurPlane(accG, rw, rh, sg)
      const Rb = blurPlane(accB, rw, rh, sg)
      for (let y = ry0; y < ry1; y++) {
        for (let x = rx0; x < rx1; x++) {
          const j = idx(x, y)
          if (A[j] < 1e-3) continue
          const o = (y * W + x) * 3
          base[o] = Math.round(linearToSrgb(srgbToLinear(base[o]) * (1 - A[j]) + Rr[j]))
          base[o + 1] = Math.round(linearToSrgb(srgbToLinear(base[o + 1]) * (1 - A[j]) + Rg[j]))
          base[o + 2] = Math.round(linearToSrgb(srgbToLinear(base[o + 2]) * (1 - A[j]) + Rb[j]))
        }
      }
    }
    if (opts.shadow === false) continue

    // e) Cast shadow: silhouette projected on the ground plane away from the light. The penumbra
    //    widens and the shadow fades with the occluder's height above the ground (height bands).
    const castOp = clamp(0.42 + 0.15 * (model.keyFill - 1), 0.4, 0.62)
    const edges = [0, 0.05, 0.14, 0.3, 0.55, 1.01]
    // Soft shadows are computed at half resolution on large products (4× fewer pixels), then
    // bilinearly upsampled: the penumbra is wider than a pixel anyway.
    const q = bh > 240 ? 2 : 1
    const lw = Math.ceil(rw / q)
    const lh = Math.ceil(rh / q)
    const castLow = new Float32Array(lw * lh)
    for (let b = 0; b < edges.length - 1; b++) {
      const acc = new Float32Array(lw * lh)
      let any = false
      const hLo = edges[b] * bh
      const hHi = edges[b + 1] * bh
      for (let y = Math.max(m.y0, Math.ceil(ybLocal - hHi)); y <= ybLocal - hLo; y++) {
        const hgt = ybLocal - y
        const ty = Math.round(yb - hgt * squash)
        if (ty < ry0 || ty >= ry1) continue
        const shift = hgt * len * dirX
        for (let x = 0; x < L.w; x++) {
          const a = m.alpha[y * L.w + x]
          if (a <= 0.02) continue
          const tx = Math.round(L.box.x + x + shift)
          if (tx < rx0 || tx >= rx1) continue
          const j = (((ty - ry0) / q) | 0) * lw + (((tx - rx0) / q) | 0)
          if (a > acc[j]) acc[j] = a
          any = true
        }
      }
      if (!any) continue
      const mid = ((edges[b] + Math.min(1, edges[b + 1])) / 2) * bh
      // Vertical squash leaves 1-px gaps between projected rows: a small blur closes them first.
      const A = blurPlane(acc, lw, lh, Math.max(0.6, (1.2 + 0.07 * mid) / q))
      const op = castOp * (1 - 0.6 * (mid / bh))
      for (let j = 0; j < lw * lh; j++) castLow[j] = 1 - (1 - castLow[j]) * (1 - Math.min(1, A[j] * 1.15) * op)
    }
    const cast = q === 1 ? castLow : new Float32Array(rw * rh)
    if (q > 1) {
      for (let y = 0; y < rh; y++) {
        const fy = Math.min(lh - 1, Math.max(0, (y + 0.5) / q - 0.5))
        const y0 = Math.floor(fy)
        const y1 = Math.min(lh - 1, y0 + 1)
        const wy = fy - y0
        for (let x = 0; x < rw; x++) {
          const fx = Math.min(lw - 1, Math.max(0, (x + 0.5) / q - 0.5))
          const x0 = Math.floor(fx)
          const x1 = Math.min(lw - 1, x0 + 1)
          const wx = fx - x0
          const top = castLow[y0 * lw + x0] * (1 - wx) + castLow[y0 * lw + x1] * wx
          const bot = castLow[y1 * lw + x0] * (1 - wx) + castLow[y1 * lw + x1] * wx
          cast[y * rw + x] = top * (1 - wy) + bot * wy
        }
      }
    }

    // e) Contact shadow + ground AO following the bottom contour (columns that touch the ground).
    const reachGround = Math.max(3, 0.12 * bh)
    const seed = new Float32Array(rw * rh)
    const contactMap = new Float32Array(rw * rh)
    const ry = Math.max(1.5, 0.012 * bh)
    for (let x = 0; x < L.w; x++) {
      let yc = -1
      let ac = 0
      for (let y = L.h - 1; y >= 0; y--) {
        const a = m.alpha[y * L.w + x]
        if (a >= 0.5) {
          yc = y
          ac = a
          break
        }
      }
      if (yc < 0 || yc < ybLocal - reachGround) continue
      const tx = L.box.x + x
      if (tx < rx0 || tx >= rx1) continue
      // Lower contact = darker (a corner lifted off the ground gets a lighter line).
      const touch = 1 - (ybLocal - yc) / reachGround
      const ty0 = L.box.y + yc
      for (let ty = Math.max(ry0, ty0 - 2); ty < Math.min(ry1, ty0 + Math.ceil(ry * 3) + 1); ty++) {
        const dy = Math.max(0, ty - ty0)
        contactMap[idx(tx, ty)] = Math.max(contactMap[idx(tx, ty)], ac * touch * Math.exp(-((dy / ry) ** 2)))
      }
      for (let ty = Math.max(ry0, ty0 - 1); ty <= Math.min(ry1 - 1, ty0 + 1); ty++) seed[idx(tx, ty)] = touch
    }
    const contactB = blurPlane(contactMap, rw, rh, 0.9)
    const aoB = blurPlane(seed, rw, rh, Math.max(3, 0.035 * Math.max(bh, bw * 0.6)))
    let aoMax = 0
    for (let j = 0; j < rw * rh; j++) if (aoB[j] > aoMax) aoMax = aoB[j]
    for (let y = ry0; y < ry1; y++) {
      for (let x = rx0; x < rx1; x++) {
        const j = idx(x, y)
        const contact = GROUND_STRENGTH.contact * contactB[j]
        const ao = aoMax > 0 ? GROUND_STRENGTH.ao * Math.min(1, aoB[j] / aoMax) : 0
        const A = 1 - (1 - contact) * (1 - ao) * (1 - cast[j])
        if (A < 2e-3) continue
        const o = (y * W + x) * 3
        for (let c = 0; c < 3; c++) {
          const lin = srgbToLinear(base[o + c])
          base[o + c] = Math.round(linearToSrgb(lin * (1 - A * (1 - tintK[c]))))
        }
      }
    }
  }
}

/** Compact, JSON-safe summary of a light model (reports / layoutReport). */
export function lightSummary(model: LightModel): Record<string, unknown> {
  return {
    direction: model.direction,
    prompted: model.prompted,
    estimated: model.estimated,
    keyFill: model.keyFill,
    temperature: model.temperature,
    tint: model.tint,
    ambient: model.ambient.map((v) => Math.round(v)),
    noise: model.noise,
    acuity: model.acuity,
    surface: model.surface,
  }
}
