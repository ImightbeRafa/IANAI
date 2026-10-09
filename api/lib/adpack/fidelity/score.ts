/**
 * Product fidelity — how close the product in a finished image is to the real cut-out (A1/A4).
 *
 * Inside the product mask (cut-out alpha ≥ 250, eroded 3 px so the ≤ 2 px light wrap and the
 * feathered edge never count):
 *   - SSIM on grayscale, 8×8 windows (stride 4), windows fully inside the mask;
 *   - mean ΔE (CIE76, Lab) per pixel.
 * score = 0.7·SSIM + 0.3·(1 − ΔE/20), clamped 0–1. Passed when SSIM ≥ 0.90 and ΔE ≤ 6.
 * Optional diff heatmap (per-pixel ΔE: transparent → yellow → red) for the agent / UI.
 */
import sharp from 'sharp'
import type { Box } from '../render/types.js'
import type { FidelityMethod, FidelityResult } from '../types.js'
import { erode, gray, rgbToLab } from './pixels.js'

export const FIDELITY_THRESHOLD = { ssim: 0.9, deltaE: 6 } as const
const MASK_EROSION = 3
const WIN = 8
const STRIDE = 4
const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2

export interface FidelityScore extends FidelityResult {
  ssim: number
  deltaE: number
  /** Masked pixels compared. */
  pixels: number
  diffPng?: Buffer
}

export interface ScoreFidelityInput {
  /** Final image (PNG/JPEG bytes or raw-decodable), canvas coordinates. */
  image: Buffer | Uint8Array
  /** Where the cut-out was placed in `image`. */
  box: Box
  /** The placed cut-out (RGBA PNG) at exactly box.w × box.h, BEFORE any harmonization. */
  reference: Buffer | Uint8Array
  method?: FidelityMethod
  /** Also return a heatmap PNG (box size). */
  diff?: boolean
}

export function fidelityScoreValue(ssim: number, dE: number): number {
  const s = 0.7 * Math.max(0, Math.min(1, ssim)) + 0.3 * Math.max(0, 1 - dE / 20)
  return Math.round(Math.max(0, Math.min(1, s)) * 1000) / 1000
}

export function passesFidelity(ssim: number, dE: number): boolean {
  return ssim >= FIDELITY_THRESHOLD.ssim && dE <= FIDELITY_THRESHOLD.deltaE
}

export async function scoreFidelity(input: ScoreFidelityInput): Promise<FidelityScore> {
  const { box } = input
  const w = Math.max(1, Math.round(box.w))
  const h = Math.max(1, Math.round(box.h))
  const meta = await sharp(input.image).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  // Region of the final image under the box (out-of-canvas parts are treated as masked out).
  const left = Math.max(0, Math.round(box.x))
  const top = Math.max(0, Math.round(box.y))
  const right = Math.min(W, Math.round(box.x) + w)
  const bottom = Math.min(H, Math.round(box.y) + h)
  const method = input.method ?? 'composite'
  if (right - left < 4 || bottom - top < 4) return empty(method)
  const img = await sharp(input.image)
    .extract({ left, top, width: right - left, height: bottom - top })
    .extend({ left: left - Math.round(box.x), top: top - Math.round(box.y), right: Math.round(box.x) + w - right, bottom: Math.round(box.y) + h - bottom, background: '#000000' })
    .removeAlpha()
    .raw()
    .toBuffer()
  const ref = await sharp(input.reference).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer()

  let mask: Uint8Array = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.round(box.x) + x
      const cy = Math.round(box.y) + y
      const inCanvas = cx >= 0 && cy >= 0 && cx < W && cy < H
      mask[y * w + x] = inCanvas && ref[(y * w + x) * 4 + 3] >= 250 ? 1 : 0
    }
  }
  mask = erode(mask, w, h, MASK_EROSION)

  const ga = new Float32Array(w * h)
  const gb = new Float32Array(w * h)
  let pixels = 0
  let dESum = 0
  const dEMap = input.diff ? new Float32Array(w * h) : null
  for (let i = 0; i < w * h; i++) {
    const r1 = ref[i * 4]
    const g1 = ref[i * 4 + 1]
    const b1 = ref[i * 4 + 2]
    const r2 = img[i * 3]
    const g2 = img[i * 3 + 1]
    const b2 = img[i * 3 + 2]
    ga[i] = gray(r1, g1, b1)
    gb[i] = gray(r2, g2, b2)
    if (!mask[i]) continue
    const l1 = rgbToLab(r1, g1, b1)
    const l2 = rgbToLab(r2, g2, b2)
    const d = Math.hypot(l1[0] - l2[0], l1[1] - l2[1], l1[2] - l2[2])
    dESum += d
    pixels++
    if (dEMap) dEMap[i] = d
  }
  if (pixels < 64) return empty(method)

  // SSIM over 8×8 windows fully inside the mask.
  const integ = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x]
      integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row
    }
  }
  const inside = (x: number, y: number) =>
    integ[(y + WIN) * (w + 1) + x + WIN] - integ[y * (w + 1) + x + WIN] - integ[(y + WIN) * (w + 1) + x] + integ[y * (w + 1) + x] === WIN * WIN
  let ssimSum = 0
  let windows = 0
  const ssimWindow = (x0: number, y0: number, x1: number, y1: number, onlyMasked: boolean) => {
    let n = 0
    let ma = 0
    let mb = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x
      if (onlyMasked && !mask[i]) continue
      ma += ga[i]
      mb += gb[i]
      n++
    }
    if (!n) return null
    ma /= n
    mb /= n
    let va = 0
    let vb = 0
    let cov = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x
      if (onlyMasked && !mask[i]) continue
      const da = ga[i] - ma
      const db = gb[i] - mb
      va += da * da
      vb += db * db
      cov += da * db
    }
    va /= Math.max(1, n - 1)
    vb /= Math.max(1, n - 1)
    cov /= Math.max(1, n - 1)
    return ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
  }
  for (let y = 0; y + WIN <= h; y += STRIDE) {
    for (let x = 0; x + WIN <= w; x += STRIDE) {
      if (!inside(x, y)) continue
      const s = ssimWindow(x, y, x + WIN, y + WIN, false)
      if (s === null) continue
      ssimSum += s
      windows++
    }
  }
  // Thin products with no full window: one masked-pixel SSIM.
  const ssim = windows ? ssimSum / windows : ssimWindow(0, 0, w, h, true) ?? 0
  const dE = dESum / pixels
  const result: FidelityScore = {
    score: fidelityScoreValue(ssim, dE),
    ssim: Math.round(ssim * 10000) / 10000,
    deltaE: Math.round(dE * 100) / 100,
    passed: passesFidelity(ssim, dE),
    method,
    pixels,
  }
  if (dEMap) result.diffPng = await heatmap(dEMap, mask, ref, w, h)
  return result
}

function empty(method: FidelityMethod): FidelityScore {
  return { score: 0, ssim: 0, deltaE: 100, passed: false, method, pixels: 0 }
}

/** Grayscale product + ΔE overlay (≥ 2 yellow, ≥ 6 red). Outside the mask: transparent. */
async function heatmap(dE: Float32Array, mask: Uint8Array, ref: Buffer, w: number, h: number): Promise<Buffer> {
  const out = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const g = gray(ref[i * 4], ref[i * 4 + 1], ref[i * 4 + 2]) * 0.5 + 64
    const a = ref[i * 4 + 3]
    if (!mask[i]) {
      out[i * 4] = g
      out[i * 4 + 1] = g
      out[i * 4 + 2] = g
      out[i * 4 + 3] = Math.round(a * 0.35)
      continue
    }
    const t = Math.min(1, dE[i] / FIDELITY_THRESHOLD.deltaE)
    const r = t < 0.33 ? g : 255
    const gg = t < 0.33 ? g : t < 1 ? 220 : 40
    const b = t < 0.33 ? g : 40
    out[i * 4] = r
    out[i * 4 + 1] = gg
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

/** Item-level fidelity: the worst ratio wins. */
export function worstFidelity<T extends { fidelity?: FidelityResult }>(renders: T[]): FidelityResult | undefined {
  const scored = renders.map((r) => r.fidelity).filter((f): f is FidelityResult => Boolean(f))
  if (!scored.length) return undefined
  return scored.reduce((w, f) => (f.passed !== w.passed ? (f.passed ? w : f) : f.score < w.score ? f : w))
}

/** Public shape (drops internal fields). */
export function toFidelityResult(s: FidelityScore, extra: Partial<FidelityResult> = {}): FidelityResult {
  return { score: s.score, ssim: s.ssim, deltaE: s.deltaE, passed: s.passed, method: s.method, ...extra }
}
