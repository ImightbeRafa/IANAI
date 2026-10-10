/**
 * Halo / leftover-background detector for a placed cut-out (round 3: the Prototipo "exact" image scored 0.965 although pale
 * backdrop patches and a grey blob stayed around the wheels and above the wing). Two free, local signals:
 *
 *  1. `leak`   — share of the cut-out's core pixels that are still the SOURCE photo's backdrop (the segmenter's own
 *                measure, `StoredCutout.backgroundLeak`). The segmenter only fails above 4 %; visible patches start ~1.5 %.
 *  2. `haze`   — share of the ring just OUTSIDE the product (2–12 px from its opaque core) in the FINAL composite that is
 *                lighter and greyer than the plate underneath it. A contact shadow darkens; leftover backdrop or a light
 *                fringe lightens and desaturates, so a clean composite scores ≈ 0.
 *
 * Warning-grade: it never blocks and never changes credits.
 */
import sharp from 'sharp'
import { erode, labImage } from './pixels.js'

export const HALO_LIMITS = { leak: 0.015, haze: 0.06 } as const

export type HaloReport = {
  leak: number | null
  haze: number
  ringPixels: number
  flagged: boolean
  reasons: string[]
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // dilate = complement of erode(complement)
  const inv = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1
  const e = erode(inv, w, h, r)
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = e[i] ? 0 : 1
  return out
}

export async function measureHalo(input: {
  /** Final composite (any sharp-readable image) and the product box in its pixel space. */
  composite: Buffer
  box: { x: number; y: number; w: number; h: number }
  /** Cut-out as placed (RGBA, box size). */
  placed: Buffer
  /** Plate crop under the box before shadows / product (RGB, box size). */
  background: Buffer
  /** Segmenter's leftover-backdrop share. */
  leak?: number
}): Promise<HaloReport> {
  const pad = 14
  const W = Math.round(input.box.w)
  const H = Math.round(input.box.h)
  const meta = await sharp(input.composite).metadata()
  const cw = meta.width ?? 0
  const ch = meta.height ?? 0
  const left = Math.max(0, Math.round(input.box.x) - pad)
  const top = Math.max(0, Math.round(input.box.y) - pad)
  const right = Math.min(cw, Math.round(input.box.x) + W + pad)
  const bottom = Math.min(ch, Math.round(input.box.y) + H + pad)
  const ew = right - left
  const eh = bottom - top
  if (ew < 16 || eh < 16) return { leak: input.leak ?? null, haze: 0, ringPixels: 0, flagged: false, reasons: [] }
  const comp = await sharp(input.composite).extract({ left, top, width: ew, height: eh }).removeAlpha().raw().toBuffer()
  // Expand placed alpha / plate crop onto the padded window (outside the box = no product; plate unknown → use the composite itself, i.e. no haze there).
  const alphaBox = await sharp(input.placed).ensureAlpha().resize(W, H, { fit: 'fill' }).extractChannel(3).raw().toBuffer()
  const bgBox = await sharp(input.background).removeAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer()
  const alpha = new Uint8Array(ew * eh)
  const inBox = new Uint8Array(ew * eh)
  const plate = Buffer.from(comp)
  for (let y = 0; y < eh; y++) {
    for (let x = 0; x < ew; x++) {
      const gx = left + x - Math.round(input.box.x)
      const gy = top + y - Math.round(input.box.y)
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue
      const i = y * ew + x
      inBox[i] = 1
      alpha[i] = alphaBox[gy * W + gx] >= 128 ? 1 : 0
      const b = (gy * W + gx) * 3
      plate[i * 3] = bgBox[b]; plate[i * 3 + 1] = bgBox[b + 1]; plate[i * 3 + 2] = bgBox[b + 2]
    }
  }
  const near = dilate(alpha, ew, eh, 2)
  const far = dilate(alpha, ew, eh, 12)
  const lc = labImage(comp, 3, ew * eh)
  const lp = labImage(plate, 3, ew * eh)
  let ring = 0
  let hazy = 0
  for (let i = 0; i < ew * eh; i++) {
    if (!inBox[i] || near[i] || !far[i]) continue
    ring++
    const dL = lc[i * 3] - lp[i * 3]
    const cC = Math.hypot(lc[i * 3 + 1], lc[i * 3 + 2])
    const cP = Math.hypot(lp[i * 3 + 1], lp[i * 3 + 2])
    if (dL > 7 && cC < cP - 5) hazy++
  }
  const haze = ring ? Math.round((hazy / ring) * 1000) / 1000 : 0
  const reasons: string[] = []
  if (typeof input.leak === 'number' && input.leak > HALO_LIMITS.leak) reasons.push(`${Math.round(input.leak * 1000) / 10}% of the cut-out is leftover photo backdrop (> ${HALO_LIMITS.leak * 100}%)`)
  if (haze > HALO_LIMITS.haze) reasons.push(`${Math.round(haze * 1000) / 10}% of the ring around the product is lighter/greyer than the scene (pale halo patches, > ${HALO_LIMITS.haze * 100}%)`)
  return { leak: input.leak ?? null, haze, ringPixels: ring, flagged: reasons.length > 0, reasons }
}
