/**
 * Round 1b — alpha matting for the cut-out path (fallback when the photo is not a studio shot).
 *
 *  1. Feather: the alpha's boundary band is softened with a ~1.2 px blur (interior and exterior
 *     untouched), so a binary flood mask never shows stair-steps at placement size.
 *  2. Colour decontamination: pixels in the soft band (alpha < 0.98) take the colour of the
 *     nearest solid interior (normalized convolution over alpha ≥ 0.98, σ 2.5 px), blended by
 *     (1 − alpha) — the photo's backdrop never tints the edge (no halo on wing tips / props).
 *
 * Interior pixels are never changed (fidelity). Deterministic.
 */
import sharp from 'sharp'
import { blurPlane, maskedBlurMany } from './pixels.js'

export interface MatteOptions {
  /** Feather blur σ in px (default 1.2; 0 = no feather). */
  feather?: number
  /** Decontamination σ in px (default 2.5). */
  decontam?: number
}

export async function matteLayer(png: Buffer, opts: MatteOptions = {}): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const n = w * h
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = data[i * 4 + 3] / 255
  const feather = opts.feather ?? 1.2
  let af = a
  if (feather > 0) {
    const b = blurPlane(a, w, h, feather)
    af = new Float32Array(n)
    // Only the boundary band changes: keep fully solid / fully empty neighbourhoods exact.
    for (let i = 0; i < n; i++) af[i] = b[i] > 0.995 || b[i] < 0.005 ? a[i] : b[i]
  }
  const solid = new Float32Array(n)
  for (let i = 0; i < n; i++) solid[i] = a[i] >= 0.98 ? 1 : 0
  const ch = [0, 1, 2].map((c) => {
    const p = new Float32Array(n)
    for (let i = 0; i < n; i++) p[i] = data[i * 4 + c]
    return p
  })
  const fg = maskedBlurMany(ch, solid, w, h, opts.decontam ?? 2.5, -1)
  const out = Buffer.from(data)
  for (let i = 0; i < n; i++) {
    const alpha = af[i]
    out[i * 4 + 3] = Math.round(alpha * 255)
    if (alpha <= 0 || alpha >= 0.98 || fg[0][i] < 0) continue
    // Soft band (original edge pixels and the feathered ring): foreground colour estimation —
    // the nearest solid interior colour replaces what the photo's backdrop contaminated.
    const t = Math.min(1, (0.98 - alpha) / 0.2)
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(data[i * 4 + c] * (1 - t) + fg[c][i] * t)
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}
