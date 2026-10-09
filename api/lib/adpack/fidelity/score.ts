/**
 * Product fidelity — is the product in a finished image still the real product? (A1/A4)
 *
 * Owner rule: light may change (shading, shadows, white balance, grade, grain), shape and
 * identity color may not. So the metric separates the two:
 *
 *  Structural
 *   - ssimDetail: detail-weighted SSIM (8×8 windows, stride 4, inside the eroded mask) of the band-pass
 *     log-luminance — ln(Y+32) of a 1 px pre-smooth (drops matched grain) minus its masked blur — so any smooth multiplicative light
 *     gradient cancels while edges, text and parts must line up.
 *   - silhouetteIoU: the product region found in the image (each pixel: closer to the cut-out's
 *     color or to the plate behind it, both up to a luminance scale so shading / shadows don't
 *     count) vs the cut-out's own silhouette. Pixels where product and plate look alike are not
 *     decidable and are skipped.
 *  Identity color (after dividing out the low-frequency luminance gain map image/cut-out)
 *   - hueShift: chroma-weighted mean hue difference (°) on chromatic pixels,
 *   - chromaRatio: mean chroma image / cut-out,
 *   - deltaE: mean ΔE76 of the gain-corrected colors.
 *
 * passed = ssimDetail ≥ 0.88 AND silhouetteIoU ≥ 0.98 AND hueShift ≤ 10° AND
 *          0.8 ≤ chromaRatio ≤ 1.25 AND deltaE ≤ 10.
 * score = 0.55·ssimDetail + 0.2·IoU term + 0.25·color term (0–1).
 * A relit product passes; a redrawn / reshaped / recolored one fails.
 * Optional diff heatmap (gain-corrected ΔE + detail mismatch) for the agent / UI.
 */
import sharp from 'sharp'
import type { Box } from '../render/types.js'
import type { FidelityMethod, FidelityResult } from '../types.js'
import { dilate, erode, gray, linearToSrgb, maskedBlurMany, rgbToLab, srgbToLinear } from './pixels.js'

export const FIDELITY_THRESHOLD = {
  /** Detail SSIM floor (alias `ssim` for older callers). */
  ssim: 0.88,
  ssimDetail: 0.88,
  silhouetteIoU: 0.98,
  /** Degrees. */
  hueShift: 10,
  chromaRatio: [0.8, 1.25] as const,
  /** Gain-corrected mean ΔE76. */
  deltaE: 10,
} as const

/** Core mask erosion (px): the ≤ 4 px light wrap and the softened edge never count for color/detail. */
const MASK_EROSION = 5
const WIN = 8
const STRIDE = 4
/** Log-luminance offset (keeps sensor-like grain in deep shadows from dominating). */
const LOG_OFFSET = 32
/** SSIM constants in the log-luminance domain (range ≈ ln(287/32) ≈ 2.19). */
const C1 = (0.01 * 2.19) ** 2
const C2 = (0.03 * 2.19) ** 2
/**
 * Low-texture tolerance (P0 #3): 8-bit noise levels a flat region may carry after relighting,
 * expressed in the log-luminance band-pass domain as NOISE / (gray + LOG_OFFSET), clamped.
 */
const LOW_TEXTURE_NOISE = 9
const LOW_TEXTURE_TOL: readonly [number, number] = [0.03, 0.25]
/** Silhouette IoU: max side it is measured at (the placement's native resolution up to this). */
export const IOU_MAX_SIDE = 1400
/** Diff heatmaps are never smaller than this on the long side (a 142 px heatmap is unreadable). */
export const DIFF_MIN_SIDE = 512
/** Chroma (Lab) below which a pixel's hue is not meaningful; chroma ratio uses clearly colored pixels. */
const MIN_CHROMA = 12
const RATIO_CHROMA = 18

export interface FidelityScore extends FidelityResult {
  ssim: number
  deltaE: number
  ssimDetail: number
  silhouetteIoU: number
  hueShift: number
  chromaRatio: number
  /** False when product and plate were too alike around the silhouette to measure the IoU. */
  silhouetteMeasured: boolean
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
  /** The plate under the box before the product (RGB, box size). Estimated from the image when absent. */
  background?: Buffer | Uint8Array
  method?: FidelityMethod
  /** Also return a heatmap PNG (box size). */
  diff?: boolean
}

export function fidelityScoreValue(m: { ssimDetail: number; silhouetteIoU: number; hueShift: number; deltaE: number }): number {
  const iouTerm = Math.max(0, Math.min(1, (m.silhouetteIoU - 0.9) / 0.1))
  const colorTerm = Math.max(0, 1 - Math.max(m.hueShift / 30, m.deltaE / 25))
  const s = 0.55 * Math.max(0, Math.min(1, m.ssimDetail)) + 0.2 * iouTerm + 0.25 * colorTerm
  return Math.round(Math.max(0, Math.min(1, s)) * 1000) / 1000
}

export function passesFidelity(m: { ssimDetail: number; silhouetteIoU: number; hueShift: number; chromaRatio: number; deltaE: number }): boolean {
  const T = FIDELITY_THRESHOLD
  return (
    m.ssimDetail >= T.ssimDetail &&
    m.silhouetteIoU >= T.silhouetteIoU &&
    m.hueShift <= T.hueShift &&
    m.chromaRatio >= T.chromaRatio[0] &&
    m.chromaRatio <= T.chromaRatio[1] &&
    m.deltaE <= T.deltaE
  )
}

/** Distance from `f` to the closest luminance-scaled copy k·x (k in [kmin, kmax]), sRGB units. */
function scaledDist(fr: number, fg: number, fb: number, xr: number, xg: number, xb: number, kmin: number, kmax: number): number {
  const xx = xr * xr + xg * xg + xb * xb
  if (xx < 1) return Math.hypot(fr, fg, fb)
  const k = Math.max(kmin, Math.min(kmax, (fr * xr + fg * xg + fb * xb) / xx))
  return Math.hypot(fr - k * xr, fg - k * xg, fb - k * xb)
}

async function boxCrop(image: Buffer | Uint8Array, box: Box): Promise<{ img: Buffer; inCanvas: Uint8Array; W: number; H: number } | null> {
  const meta = await sharp(image).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  const w = Math.max(1, Math.round(box.w))
  const h = Math.max(1, Math.round(box.h))
  const bx = Math.round(box.x)
  const by = Math.round(box.y)
  const left = Math.max(0, bx)
  const top = Math.max(0, by)
  const right = Math.min(W, bx + w)
  const bottom = Math.min(H, by + h)
  if (right - left < 4 || bottom - top < 4) return null
  const img = await sharp(image)
    .extract({ left, top, width: right - left, height: bottom - top })
    .extend({ left: left - bx, top: top - by, right: bx + w - right, bottom: by + h - bottom, background: '#000000' })
    .removeAlpha()
    .raw()
    .toBuffer()
  const inCanvas = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inCanvas[y * w + x] = bx + x >= 0 && by + y >= 0 && bx + x < W && by + y < H ? 1 : 0
  return { img, inCanvas, W, H }
}

/** Long side the metric works at (larger boxes are measured on a Lanczos-downscaled copy: same verdict, ~3× faster). */
export const SCORE_MAX_SIDE = 560

export async function scoreFidelity(input: ScoreFidelityInput): Promise<FidelityScore> {
  const { box } = input
  const bw = Math.max(1, Math.round(box.w))
  const bh = Math.max(1, Math.round(box.h))
  const method = input.method ?? 'composite'
  const crop = await boxCrop(input.image, box)
  if (!crop) return empty(method)
  const k = Math.min(1, SCORE_MAX_SIDE / Math.max(bw, bh))
  const w = Math.max(8, Math.round(bw * k))
  const h = Math.max(8, Math.round(bh * k))
  const N = w * h
  let img = crop.img
  let inCanvas = crop.inCanvas
  if (k < 1) {
    img = await sharp(crop.img, { raw: { width: bw, height: bh, channels: 3 } }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer()
    inCanvas = new Uint8Array(await sharp(Buffer.from(crop.inCanvas.map((v) => v * 255)), { raw: { width: bw, height: bh, channels: 1 } }).resize(w, h, { fit: 'fill', kernel: 'nearest' }).raw().toBuffer()).map((v) => (v >= 128 ? 1 : 0))
  }
  const ref = await sharp(input.reference).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer()

  // Masks: silhouette (α ≥ 128) and core (α ≥ 250, eroded) for color / detail.
  const sil = new Uint8Array(N)
  let core: Uint8Array = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    sil[i] = inCanvas[i] && ref[i * 4 + 3] >= 128 ? 1 : 0
    core[i] = inCanvas[i] && ref[i * 4 + 3] >= 250 ? 1 : 0
  }
  core = erode(core, w, h, MASK_EROSION)
  let pixels = 0
  for (let i = 0; i < N; i++) pixels += core[i]
  if (pixels < 64) return empty(method)

  // Linear luminance + the low-frequency gain map (image / cut-out) inside the core.
  const Yr = new Float32Array(N)
  const Yi = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    Yr[i] = 0.2126 * srgbToLinear(ref[i * 4]) + 0.7152 * srgbToLinear(ref[i * 4 + 1]) + 0.0722 * srgbToLinear(ref[i * 4 + 2])
    Yi[i] = 0.2126 * srgbToLinear(img[i * 3]) + 0.7152 * srgbToLinear(img[i * 3 + 1]) + 0.0722 * srgbToLinear(img[i * 3 + 2])
  }
  const minDim = Math.min(w, h)
  const sigGain = Math.max(4, 0.08 * minDim)
  const [bYr, bYi] = maskedBlurMany([Yr, Yi], core, w, h, sigGain, 0)

  // Identity color after gain removal.
  let dESum = 0
  let hueW = 0
  let hueSum = 0
  let cRef = 0
  let cImg = 0
  const dEMap = input.diff ? new Float32Array(N) : null
  for (let i = 0; i < N; i++) {
    if (!core[i]) continue
    const g = bYr[i] > 1e-5 ? Math.max(0.2, Math.min(5, bYi[i] / bYr[i])) : 1
    const r2 = linearToSrgb(srgbToLinear(img[i * 3]) / g)
    const g2 = linearToSrgb(srgbToLinear(img[i * 3 + 1]) / g)
    const b2 = linearToSrgb(srgbToLinear(img[i * 3 + 2]) / g)
    const l1 = rgbToLab(ref[i * 4], ref[i * 4 + 1], ref[i * 4 + 2])
    const l2 = rgbToLab(Math.round(r2), Math.round(g2), Math.round(b2))
    const d = Math.hypot(l1[0] - l2[0], l1[1] - l2[1], l1[2] - l2[2])
    dESum += d
    if (dEMap) dEMap[i] = d
    const c1 = Math.hypot(l1[1], l1[2])
    if (c1 >= MIN_CHROMA) {
      const c2 = Math.hypot(l2[1], l2[2])
      let dh = Math.abs(Math.atan2(l2[2], l2[1]) - Math.atan2(l1[2], l1[1])) * (180 / Math.PI)
      if (dh > 180) dh = 360 - dh
      // Weight by how meaningful the hue is (near-neutral pixels swing with any white balance).
      const wgt = ((c1 - MIN_CHROMA + 1) ** 2) / 10
      // A colored pixel that lost its color entirely counts as a full hue miss.
      hueSum += (c2 < 3 ? 90 : dh) * wgt
      hueW += wgt
      if (c1 >= RATIO_CHROMA) {
        cRef += c1
        cImg += c2
      }
    }
  }
  const deltaE = dESum / pixels
  const hueShift = hueW ? hueSum / hueW : 0
  const chromaRatio = cRef > 0 ? cImg / cRef : 1

  // Detail SSIM on high-pass log-luminance.
  // Band-pass: a 1 px pre-smooth drops grain (added to match the plate) before the log high-pass.
  const gr0 = new Float32Array(N)
  const gi0 = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    gr0[i] = gray(ref[i * 4], ref[i * 4 + 1], ref[i * 4 + 2])
    gi0[i] = gray(img[i * 3], img[i * 3 + 1], img[i * 3 + 2])
  }
  const coreDil = dilate(core, w, h, 2)
  const [grs, gis] = maskedBlurMany([gr0, gi0], coreDil, w, h, 1, 0)
  const lr = new Float32Array(N)
  const li = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    lr[i] = Math.log(grs[i] + LOG_OFFSET)
    li[i] = Math.log(gis[i] + LOG_OFFSET)
  }
  const sigDetail = Math.max(3, 0.05 * minDim)
  const [blr, bli] = maskedBlurMany([lr, li], coreDil, w, h, sigDetail, 0)
  const ha = new Float32Array(N)
  const hb = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    ha[i] = lr[i] - blr[i]
    hb[i] = li[i] - bli[i]
  }
  const integ = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += core[y * w + x]
      integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row
    }
  }
  const inside = (x: number, y: number) =>
    integ[(y + WIN) * (w + 1) + x + WIN] - integ[y * (w + 1) + x + WIN] - integ[(y + WIN) * (w + 1) + x] + integ[y * (w + 1) + x] === WIN * WIN
  // Returns [ssim, weight]: windows are weighted by the cut-out's own detail energy (va + C2), so
  // the score is about the product's structure (edges, print, parts), not about flat areas where
  // SSIM only measures the grain added to match the plate.
  const ssimWindow = (x0: number, y0: number, x1: number, y1: number, onlyMasked: boolean): [number, number] | null => {
    let n = 0
    let ma = 0
    let mb = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x
      if (onlyMasked && !core[i]) continue
      ma += ha[i]
      mb += hb[i]
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
      if (onlyMasked && !core[i]) continue
      const da = ha[i] - ma
      const db = hb[i] - mb
      va += da * da
      vb += db * db
      cov += da * db
    }
    va /= Math.max(1, n - 1)
    vb /= Math.max(1, n - 1)
    cov /= Math.max(1, n - 1)
    return [((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)), va + C2]
  }
  // Low-texture windows (P0 #3): where the cut-out itself has no detail beyond the noise level of
  // its luminance (matte black plastic, flat paint), SSIM only measures grain — a relit / re-grained
  // flat part looks "different" while nothing changed. There the similarity is a luminance-adaptive
  // flatness test instead: the image window must stay flat within the noise tolerance of that
  // luminance (a dark part tolerates more log-domain noise than a bright one). New structure
  // (a printed logo, a removed button) breaks flatness → 0, and gains weight by its excess energy.
  const lowTexture = (x0: number, y0: number): { tol: number; sdA: number; sdB: number } => {
    let g = 0
    let sa = 0
    let sa2 = 0
    let sb = 0
    let sb2 = 0
    let n = 0
    for (let y = y0; y < y0 + WIN; y++) for (let x = x0; x < x0 + WIN; x++) {
      const i = y * w + x
      g += grs[i]
      sa += ha[i]
      sa2 += ha[i] * ha[i]
      sb += hb[i]
      sb2 += hb[i] * hb[i]
      n++
    }
    const tol = Math.max(LOW_TEXTURE_TOL[0], Math.min(LOW_TEXTURE_TOL[1], LOW_TEXTURE_NOISE / (g / n + LOG_OFFSET)))
    return { tol, sdA: Math.sqrt(Math.max(0, sa2 / n - (sa / n) ** 2)), sdB: Math.sqrt(Math.max(0, sb2 / n - (sb / n) ** 2)) }
  }
  let ssimSum = 0
  let windows = 0
  let lowWindows = 0
  let allWindows = 0
  const detailMap = dEMap ? new Float32Array(N) : null
  for (let y = 0; y + WIN <= h; y += STRIDE) {
    for (let x = 0; x + WIN <= w; x += STRIDE) {
      if (!inside(x, y)) continue
      const r = ssimWindow(x, y, x + WIN, y + WIN, false)
      if (r === null) continue
      let s = r[0]
      let wgt = r[1]
      allWindows++
      const lt = lowTexture(x, y)
      if (lt.sdA <= lt.tol) {
        lowWindows++
        s = lt.sdB <= lt.tol ? 1 : Math.max(0, 1 - (lt.sdB - lt.tol) / (1.5 * lt.tol))
        wgt += Math.max(0, lt.sdB * lt.sdB - lt.tol * lt.tol)
      }
      ssimSum += s * wgt
      windows += wgt
      if (detailMap) for (let yy = y; yy < y + WIN; yy++) for (let xx = x; xx < x + WIN; xx++) detailMap[yy * w + xx] = Math.max(detailMap[yy * w + xx], 1 - s)
    }
  }
  const ssimDetail = windows ? ssimSum / windows : ssimWindow(0, 0, w, h, true)?.[0] ?? 0

  // Silhouette IoU at the placement's native resolution (P0 #3): a downscaled copy turns the
  // antialiased edge into a band of mixed pixels that small / thin parts cannot afford.
  const kI = Math.min(1, IOU_MAX_SIDE / Math.max(bw, bh))
  const iw = Math.max(8, Math.round(bw * kI))
  const ih = Math.max(8, Math.round(bh * kI))
  const imgN = kI < 1 ? await sharp(crop.img, { raw: { width: bw, height: bh, channels: 3 } }).resize(iw, ih, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer() : crop.img
  const inCanvasN = kI < 1 ? new Uint8Array(await sharp(Buffer.from(crop.inCanvas.map((v) => v * 255)), { raw: { width: bw, height: bh, channels: 1 } }).resize(iw, ih, { fit: 'fill', kernel: 'nearest' }).raw().toBuffer()).map((v) => (v >= 128 ? 1 : 0)) : crop.inCanvas
  const refN = await sharp(input.reference).resize(iw, ih, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer()
  const silN = new Uint8Array(iw * ih)
  for (let i = 0; i < iw * ih; i++) silN[i] = inCanvasN[i] && refN[i * 4 + 3] >= 128 ? 1 : 0
  const iou = await silhouetteIoU({ img: imgN, ref: refN, sil: silN, inCanvas: inCanvasN, w: iw, h: ih, background: input.background })

  const metrics = { ssimDetail, silhouetteIoU: iou.iou, hueShift, chromaRatio, deltaE }
  const result: FidelityScore = {
    score: fidelityScoreValue(metrics),
    ssim: round4(ssimDetail),
    ssimDetail: round4(ssimDetail),
    silhouetteIoU: round4(iou.iou),
    silhouetteMeasured: iou.measured,
    hueShift: Math.round(hueShift * 100) / 100,
    chromaRatio: Math.round(chromaRatio * 1000) / 1000,
    deltaE: Math.round(deltaE * 100) / 100,
    passed: passesFidelity(metrics),
    method,
    pixels,
  }
  if (dEMap && detailMap) {
    const png = await heatmap(dEMap, detailMap, core, ref, w, h)
    // Full placement resolution (never the metric's downscaled copy), and at least DIFF_MIN_SIDE on
    // the long side so a small part's heatmap stays readable (nearest: no invented detail).
    const up = Math.max(1, DIFF_MIN_SIDE / Math.max(bw, bh))
    const dw = Math.round(bw * up)
    const dh = Math.round(bh * up)
    result.diffPng = dw !== w || dh !== h ? await sharp(png).resize(dw, dh, { fit: 'fill', kernel: up > 1 ? 'nearest' : 'lanczos3' }).png().toBuffer() : png
  }
  return result
}

const round4 = (v: number) => Math.round(v * 10000) / 10000

/**
 * Product region in the image vs the cut-out silhouette. Each pixel is "product" when it is
 * closer (up to a luminance scale) to the cut-out color there (nearest cut-out color outside
 * the silhouette) than to the plate behind it. Pixels where cut-out and plate look alike are
 * skipped (undecidable).
 */
async function silhouetteIoU(a: { img: Buffer; ref: Buffer; sil: Uint8Array; inCanvas: Uint8Array; w: number; h: number; background?: Buffer | Uint8Array }): Promise<{ iou: number; measured: boolean }> {
  const { img, ref, sil, inCanvas, w, h } = a
  const N = w * h
  const minDim = Math.min(w, h)
  // Product color everywhere: the cut-out inside, its nearest colors spread outward.
  const pr = new Float32Array(N)
  const pg = new Float32Array(N)
  const pb = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    pr[i] = ref[i * 4]
    pg[i] = ref[i * 4 + 1]
    pb[i] = ref[i * 4 + 2]
  }
  // Nearest cut-out colors outside the silhouette: a tight spread, then a wide one, then the mean.
  const near = maskedBlurMany([pr, pg, pb], sil, w, h, 3, -1)
  const far = maskedBlurMany([pr, pg, pb], sil, w, h, Math.max(6, 0.08 * minDim), -1)
  const spread = (plane: Float32Array, c: number) => {
    const out = new Float32Array(N)
    let mean = 0
    let n = 0
    for (let i = 0; i < N; i++) if (sil[i]) (mean += plane[i]), n++
    mean = n ? mean / n : 0
    for (let i = 0; i < N; i++) out[i] = sil[i] ? plane[i] : near[c][i] >= 0 ? near[c][i] : far[c][i] >= 0 ? far[c][i] : mean
    return out
  }
  const Pr = spread(pr, 0)
  const Pg = spread(pg, 1)
  const Pb = spread(pb, 2)
  // Plate behind: given, else estimated from the image away from the product.
  let Br: Float32Array
  let Bg: Float32Array
  let Bb: Float32Array
  if (a.background) {
    const bg = await sharp(a.background).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    Br = new Float32Array(N)
    Bg = new Float32Array(N)
    Bb = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      Br[i] = bg[i * 3]
      Bg[i] = bg[i * 3 + 1]
      Bb[i] = bg[i * 3 + 2]
    }
  } else {
    const away = dilate(sil, w, h, Math.max(3, Math.round(0.04 * minDim)))
    const wgt = new Uint8Array(N)
    for (let i = 0; i < N; i++) wgt[i] = away[i] || !inCanvas[i] ? 0 : 1
    const planes = [0, 1, 2].map((c) => {
      const p = new Float32Array(N)
      for (let i = 0; i < N; i++) p[i] = img[i * 3 + c]
      return p
    })
    const blurred = maskedBlurMany(planes, wgt, w, h, Math.max(8, 0.15 * minDim), -1)
    for (let c = 0; c < 3; c++) {
      let mean = 0
      let n = 0
      for (let i = 0; i < N; i++) if (wgt[i]) (mean += planes[c][i]), n++
      mean = n ? mean / n : 128
      for (let i = 0; i < N; i++) if (blurred[c][i] < 0) blurred[c][i] = mean
    }
    Br = blurred[0]
    Bg = blurred[1]
    Bb = blurred[2]
  }
  // The antialiased rim (±1 px, wider on large placements) is neither in nor out: a soft / relit
  // edge must not count as a shape change; a real reshape moves whole regions far beyond it.
  const rim = Math.max(1, Math.round(minDim / 300))
  const outer = dilate(sil, w, h, rim)
  const innerCore = erode(sil, w, h, rim)
  let inter = 0
  let uni = 0
  let decRef = 0
  let refArea = 0
  for (let i = 0; i < N; i++) {
    if (!inCanvas[i]) continue
    if (outer[i] && !innerCore[i]) continue
    if (sil[i]) refArea++
    // Undecidable: the product color is (up to light) the plate color.
    if (scaledDist(Pr[i], Pg[i], Pb[i], Br[i], Bg[i], Bb[i], 0.6, 1.6) < 20) continue
    const fr = img[i * 3]
    const fg = img[i * 3 + 1]
    const fb = img[i * 3 + 2]
    // Outside, the plate may be deep in a cast/contact shadow; under the product it never is.
    const dB = scaledDist(fr, fg, fb, Br[i], Bg[i], Bb[i], sil[i] ? 0.6 : 0.2, 1.15)
    const dP = scaledDist(fr, fg, fb, Pr[i], Pg[i], Pb[i], 0.55, 1.6)
    // Prior = the cut-out's own silhouette: flipping a pixel needs clear evidence (tinted shadows
    // outside, shading inside must not count; a real redraw changes whole regions decisively).
    const est = sil[i] ? (dB < 0.6 * dP ? 0 : 1) : dP < 0.6 * dB ? 1 : 0
    if (sil[i]) decRef++
    if (est && sil[i]) inter++
    if (est || sil[i]) uni++
  }
  if (decRef < Math.max(200, 0.25 * refArea) || !uni) return { iou: 1, measured: false }
  return { iou: inter / uni, measured: true }
}

function empty(method: FidelityMethod): FidelityScore {
  return { score: 0, ssim: 0, deltaE: 100, ssimDetail: 0, silhouetteIoU: 0, hueShift: 180, chromaRatio: 0, silhouetteMeasured: false, passed: false, method, pixels: 0 }
}

/** Grayscale product + mismatch overlay (gain-corrected ΔE or detail loss; yellow → red). Outside the core: faded. */
async function heatmap(dE: Float32Array, detail: Float32Array, mask: Uint8Array, ref: Buffer, w: number, h: number): Promise<Buffer> {
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
    const t = Math.min(1, Math.max(dE[i] / FIDELITY_THRESHOLD.deltaE, detail[i] / (1 - FIDELITY_THRESHOLD.ssimDetail)))
    out[i * 4] = t < 0.33 ? g : 255
    out[i * 4 + 1] = t < 0.33 ? g : t < 1 ? 220 : 40
    out[i * 4 + 2] = t < 0.33 ? g : 40
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
  return {
    score: s.score,
    ssim: s.ssim,
    deltaE: s.deltaE,
    ssimDetail: s.ssimDetail,
    silhouetteIoU: s.silhouetteIoU,
    hueShift: s.hueShift,
    chromaRatio: s.chromaRatio,
    passed: s.passed,
    method: s.method,
    ...extra,
  }
}

/** One-line reason for a failed score (error strings / logs). */
export function fidelityFailReason(f: Pick<FidelityResult, 'ssimDetail' | 'ssim' | 'silhouetteIoU' | 'hueShift' | 'chromaRatio' | 'deltaE'>): string {
  const T = FIDELITY_THRESHOLD
  const parts: string[] = []
  const ssim = f.ssimDetail ?? f.ssim
  if (ssim !== null && ssim !== undefined && ssim < T.ssimDetail) parts.push(`detail ssim ${ssim} < ${T.ssimDetail}`)
  if (f.silhouetteIoU !== null && f.silhouetteIoU !== undefined && f.silhouetteIoU < T.silhouetteIoU) parts.push(`silhouette IoU ${f.silhouetteIoU} < ${T.silhouetteIoU}`)
  if (f.hueShift !== null && f.hueShift !== undefined && f.hueShift > T.hueShift) parts.push(`hue shift ${f.hueShift}° > ${T.hueShift}°`)
  if (f.chromaRatio !== null && f.chromaRatio !== undefined && (f.chromaRatio < T.chromaRatio[0] || f.chromaRatio > T.chromaRatio[1])) parts.push(`chroma ratio ${f.chromaRatio}`)
  if (f.deltaE !== null && f.deltaE !== undefined && f.deltaE > T.deltaE) parts.push(`ΔE ${f.deltaE} > ${T.deltaE}`)
  return parts.join(', ') || `ssim ${ssim} / ΔE ${f.deltaE}`
}
