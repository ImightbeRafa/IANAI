/**
 * Product fidelity — upscale a low-resolution product photo WITHOUT redrawing it (C4, "después").
 *
 * Deterministic super-resolution with sharp only (no model): optional mild denoise (a 50 % blend
 * with a 3×3 median, only when the photo is noisy) → Lanczos3 resize (≤ 2×, ≤ 2048 px long edge)
 * → edge-aware unsharp mask (strong on edges, almost none on flat areas, so noise is not
 * amplified). Interpolation never invents structure; the result is verified anyway:
 *   - SSIM (1 px blur on both, so grain does not count) of the upscaled photo downscaled back to the
 *     original size vs the original ≥ 0.97;
 *   - silhouette IoU (alpha, or "not the border color" on opaque photos) ≥ 0.99.
 * If a check fails, the original bytes are returned (upscaled: false, reason).
 * Only used when asset-quality says the photo is low resolution, before the cut-out.
 */
import sharp from 'sharp'
import { MIN_LONG_SIDE } from './asset-quality.js'
import { grainSigma } from './harmonize.js'
import { borderBackground, labImage } from './pixels.js'

export const UPSCALE_MAX_FACTOR = 2
export const UPSCALE_MAX_LONG_EDGE = 2048
export const UPSCALE_CHECK = { ssim: 0.97, silhouetteIoU: 0.99 } as const

export interface UpscaleResult {
  bytes: Buffer
  upscaled: boolean
  from: { width: number; height: number }
  to: { width: number; height: number }
  /** Verification (when upscaled or attempted). */
  ssim?: number
  silhouetteIoU?: number
  denoised?: boolean
  reason?: string
}

/** Plain grayscale SSIM (8×8 windows, stride 4) of two same-size raw gray planes. */
export function graySsim(a: Uint8Array | Buffer, b: Uint8Array | Buffer, w: number, h: number): number {
  const C1 = (0.01 * 255) ** 2
  const C2 = (0.03 * 255) ** 2
  let sum = 0
  let n = 0
  for (let y = 0; y + 8 <= h; y += 4) {
    for (let x = 0; x + 8 <= w; x += 4) {
      let ma = 0
      let mb = 0
      for (let yy = y; yy < y + 8; yy++) for (let xx = x; xx < x + 8; xx++) {
        ma += a[yy * w + xx]
        mb += b[yy * w + xx]
      }
      ma /= 64
      mb /= 64
      let va = 0
      let vb = 0
      let cov = 0
      for (let yy = y; yy < y + 8; yy++) for (let xx = x; xx < x + 8; xx++) {
        const da = a[yy * w + xx] - ma
        const db = b[yy * w + xx] - mb
        va += da * da
        vb += db * db
        cov += da * db
      }
      va /= 63
      vb /= 63
      cov /= 63
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
      n++
    }
  }
  return n ? sum / n : 1
}

/** Foreground mask: alpha ≥ 128, or (opaque photo) ΔE > 12 from the border background color. */
async function silhouette(bytes: Buffer, w: number, h: number): Promise<Uint8Array> {
  const meta = await sharp(bytes).metadata()
  const mask = new Uint8Array(w * h)
  if (meta.hasAlpha) {
    const a = await sharp(bytes).ensureAlpha().resize(w, h, { fit: 'fill' }).extractChannel(3).raw().toBuffer()
    for (let i = 0; i < w * h; i++) mask[i] = a[i] >= 128 ? 1 : 0
    return mask
  }
  const { data, info } = await sharp(bytes).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const lab = labImage(data, info.channels, w * h)
  const bg = borderBackground(lab, w, h, 10).lab
  for (let i = 0; i < w * h; i++) {
    const d = Math.hypot(lab[i * 3] - bg[0], lab[i * 3 + 1] - bg[1], lab[i * 3 + 2] - bg[2])
    mask[i] = d > 12 ? 1 : 0
  }
  return mask
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0
  let uni = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++
    if (a[i] || b[i]) uni++
  }
  return uni ? inter / uni : 1
}

/** Target size: ≤ 2× and ≤ 2048 px on the long edge. Null when it would not grow meaningfully. */
export function upscaleTarget(width: number, height: number): { width: number; height: number; factor: number } | null {
  const long = Math.max(width, height)
  if (!long) return null
  const factor = Math.min(UPSCALE_MAX_FACTOR, UPSCALE_MAX_LONG_EDGE / long)
  if (factor < 1.1) return null
  return { width: Math.round(width * factor), height: Math.round(height * factor), factor }
}

/**
 * Upscale a product photo when it is low resolution (long edge < MIN_LONG_SIDE, or `force`).
 * Returns the original bytes untouched when not needed or when verification fails.
 */
export async function upscaleProductPhoto(input: Uint8Array | Buffer, opts: { force?: boolean } = {}): Promise<UpscaleResult> {
  const src = Buffer.from(input)
  // EXIF orientation applied once so every comparison is in the same frame.
  const oriented = await sharp(src).rotate().toBuffer()
  const meta = await sharp(oriented).metadata()
  const from = { width: meta.width ?? 0, height: meta.height ?? 0 }
  const same = (reason: string): UpscaleResult => ({ bytes: src, upscaled: false, from, to: from, reason })
  if (!from.width || !from.height) return same('unreadable')
  if (!opts.force && Math.max(from.width, from.height) >= MIN_LONG_SIDE) return same('resolution_ok')
  const target = upscaleTarget(from.width, from.height)
  if (!target) return same('already_at_limit')
  const hasAlpha = Boolean(meta.hasAlpha)

  // Mild denoise only when the photo is noisy (never on clean renders / cut-outs).
  const g = await sharp(oriented).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const noise = grainSigma(Float32Array.from(g.data), g.info.width, g.info.height)
  let base = oriented
  let denoised = false
  if (noise > 2.5) {
    // 50 % blend of the photo with its 3×3 median (color only; alpha untouched).
    const a = await sharp(oriented).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const m = await sharp(oriented).median(3).ensureAlpha().raw().toBuffer()
    const out = Buffer.from(a.data)
    for (let i = 0; i < a.info.width * a.info.height; i++) for (let c = 0; c < 3; c++) out[i * 4 + c] = (a.data[i * 4 + c] + m[i * 4 + c] + 1) >> 1
    base = await sharp(out, { raw: { width: a.info.width, height: a.info.height, channels: 4 } }).png().toBuffer()
    if (!hasAlpha) base = await sharp(base).removeAlpha().png().toBuffer()
    denoised = true
  }
  const sigma = Math.min(1.6, 0.6 * target.factor)
  // Lanczos3, then an edge-aware unsharp: m1 (flat areas) ~0, m2 (edges) strong; x1 = flat/jagged threshold.
  const up = await sharp(base)
    .resize(target.width, target.height, { fit: 'fill', kernel: 'lanczos3' })
    .sharpen({ sigma, m1: 0.2, m2: 1.6, x1: 2.5, y2: 10, y3: 20 })
    .png()
    .toBuffer()

  // Verify: nothing was redrawn. Both sides get the same 1 px blur so sensor noise (and the mild
  // denoise) does not dominate: the comparison is about structure.
  const backPng = await sharp(up).resize(from.width, from.height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
  const back = await sharp(backPng).flatten({ background: '#ffffff' }).greyscale().blur(1).raw().toBuffer()
  const orig = await sharp(oriented).flatten({ background: '#ffffff' }).greyscale().blur(1).raw().toBuffer()
  const ssim = Math.round(graySsim(orig, back, from.width, from.height) * 10000) / 10000
  const [m0, m1] = await Promise.all([silhouette(oriented, from.width, from.height), silhouette(up, from.width, from.height)])
  const silhouetteIoU = Math.round(iou(m0, m1) * 10000) / 10000
  if (ssim < UPSCALE_CHECK.ssim || silhouetteIoU < UPSCALE_CHECK.silhouetteIoU) {
    return { ...same('verification_failed'), ssim, silhouetteIoU }
  }
  return { bytes: up, upscaled: true, from, to: { width: target.width, height: target.height }, ssim, silhouetteIoU, denoised }
}
