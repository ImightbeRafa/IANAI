/**
 * Round 11 (P0): does the cut-out mask cover the WHOLE product?
 *
 * The border flood treats anything close to the backdrop as backdrop, so a light part of the product on a light
 * background (Patch House pouch: the white top half on a beige wall) is dropped while recall still passes — the
 * foreground estimate makes the same mistake. This check models the backdrop per row (left/right border colours,
 * interpolated across x, so a vignette is followed) and looks for pixels next to the mask that are NOT backdrop:
 * clearly different from the row's backdrop colour and connected to the mask. Neutral darkening (a soft floor / drop
 * shadow) does not count. When that missed region is a real share of the product it is added back (closed + holes
 * filled → the printed text inside the white part comes with it); when it cannot be repaired the cut-out fails.
 */
import { components, erode, dilate } from './pixels.js'

/** Round 11: a flood mask whose IoU with the photo's own silhouette is below this leaked into the backdrop → rejected. */
export const PHOTO_IOU_REJECT = 0.7
/** …and only when the mask covers more than this share of the frame (a leak, not an open frame or a hole). */
export const LEAK_FRAME_SHARE = 0.55
export const MASK_MISSED_MAX = 0.04
/** ΔE76 to the row backdrop for a pixel to count as "not backdrop". */
const NOT_BG_DE = 6
const NOT_BG_DE_CAST = 4

export interface MaskCoverage {
  /** Missed product pixels / mask pixels. */
  missedShare: number
  /** Mask bbox vs the product bbox (mask ∪ missed): area share the mask's box covers. */
  bboxCoverage: number
  /** Repaired mask (mask ∪ missed, closed, holes filled) when something was missed. */
  repaired?: Uint8Array
  missedBox?: { x0: number; y0: number; x1: number; y1: number }
  /** Round 12: share of the repaired mask that the backdrop model explains (leftover background); > LEFTOVER_BG_MAX fails. */
  leftoverBackdrop?: number
  addedShare?: number
}

/** Round 12: a repair that leaves more than this share of backdrop inside the product is a QA fail (A's grey patch). */
export const LEFTOVER_BG_MAX = 0.015
/** Round 12: the span fill (invisible outline of a light panel) only when the first mask missed more than this. */
export const SPAN_FILL_MIN_MISSED = 0.25
/** Round 12: mean ΔE to the backdrop model a region of a SMALL miss needs to be added back. */
export const SMALL_MISS_MIN_DE = 9
/** Round 12: mean |∇L| (per px, L units) under which a darker missed region is a soft shadow, not product. */
const SHADOW_MAX_GRAD = 1.2

/**
 * Round 12: mask pixels the smooth backdrop model explains (ΔE ≤ 5 to the fitted wall / floor at that spot) — the
 * light fringe of wall a flood keeps along thin legs / wheels, where the wall is brighter than its border colour.
 */
export function backdropExplainedPixels(lab: Float32Array, w: number, h: number, mask: Uint8Array): Uint8Array {
  bgH = h
  const coef = fitBackground(lab, w, h, mask)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) if (mask[i] && bgDelta(lab, i, w, coef) <= 5) out[i] = 1
  return out
}

/** Keep only the mask components that overlap the original mask (a recovered island never comes alone). */
function keepConnectedToMask(rep: Uint8Array, mask: Uint8Array, w: number, h: number): Uint8Array {
  const { labels } = components(rep, w, h)
  const keep = new Set<number>()
  for (let i = 0; i < rep.length; i++) if (mask[i] && labels[i]) keep.add(labels[i])
  const out = new Uint8Array(rep.length)
  for (let i = 0; i < rep.length; i++) out[i] = labels[i] && keep.has(labels[i]) ? 1 : 0
  return out
}

/** Smooth backdrop model: L, a, b each a quadratic surface in (x, y), robustly fitted (outliers trimmed) on pixels away from the mask. */
function fitBackground(lab: Float32Array, w: number, h: number, mask: Uint8Array): Float64Array {
  const near = dilate(mask, w, h, 4)
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)))
  const pts: number[] = []
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (!near[y * w + x]) pts.push(y * w + x)
  const basis = (x: number, y: number) => { const u = x / w - 0.5, v = y / h - 0.5; return [1, u, v, u * u, u * v, v * v] }
  let keep = pts
  let coef = new Float64Array(18)
  for (let iter = 0; iter < 4; iter++) {
    const A = new Float64Array(36), B = new Float64Array(18)
    for (const i of keep) {
      const x = i % w, y = (i - x) / w, f = basis(x, y)
      for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) A[r * 6 + c] += f[r] * f[c]; for (let k = 0; k < 3; k++) B[k * 6 + r] += f[r] * lab[i * 3 + k] }
    }
    for (let k = 0; k < 3; k++) coef.set(solve6(A, B.subarray(k * 6, k * 6 + 6)), k * 6)
    const res = keep.map((i) => bgDelta(lab, i, w, coef))
    const med = [...res].sort((p, q) => p - q)[Math.floor(res.length / 2)] ?? 0
    const lim = Math.max(2.5, med * 2.5)
    keep = keep.filter((_, j) => res[j] <= lim)
  }
  return coef
}

function solve6(A0: Float64Array, b0: Float64Array): Float64Array {
  const A = Float64Array.from(A0), b = Float64Array.from(b0)
  for (let i = 0; i < 6; i++) A[i * 7] += 1e-6
  for (let c = 0; c < 6; c++) {
    let p = c
    for (let r = c + 1; r < 6; r++) if (Math.abs(A[r * 6 + c]) > Math.abs(A[p * 6 + c])) p = r
    for (let k = 0; k < 6; k++) { const t = A[c * 6 + k]; A[c * 6 + k] = A[p * 6 + k]; A[p * 6 + k] = t }
    { const t = b[c]; b[c] = b[p]; b[p] = t }
    const d = A[c * 6 + c] || 1e-9
    for (let r = 0; r < 6; r++) {
      if (r === c) continue
      const f = A[r * 6 + c] / d
      if (!f) continue
      for (let k = 0; k < 6; k++) A[r * 6 + k] -= f * A[c * 6 + k]
      b[r] -= f * b[c]
    }
  }
  const out = new Float64Array(6)
  for (let i = 0; i < 6; i++) out[i] = b[i] / (A[i * 7] || 1e-9)
  return out
}

function bgAt(i: number, w: number, coef: Float64Array, h?: number): [number, number, number] {
  const x = i % w, y = (i - x) / w, H = h ?? bgH
  const u = x / w - 0.5, v = y / H - 0.5
  const f = [1, u, v, u * u, u * v, v * v]
  const o: [number, number, number] = [0, 0, 0]
  for (let k = 0; k < 3; k++) for (let r = 0; r < 6; r++) o[k] += coef[k * 6 + r] * f[r]
  return o
}
let bgH = 1

function bgDelta(lab: Float32Array, i: number, w: number, coef: Float64Array): number {
  const [L, a, b] = bgAt(i, w, coef)
  const dL = lab[i * 3] - L, da = lab[i * 3 + 1] - a, db = lab[i * 3 + 2] - b
  return Math.sqrt(dL * dL + da * da + db * db)
}

export function checkMaskCoverage(lab: Float32Array, w: number, h: number, mask: Uint8Array, debug?: { notBg?: Uint8Array; missed?: Uint8Array; de?: Float32Array }): MaskCoverage {
  const n = w * h
  let area = 0, mx0 = w, my0 = h, mx1 = -1, my1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { area++; if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y }
  if (!area) return { missedShare: 0, bboxCoverage: 1 }
  bgH = h
  const coef = fitBackground(lab, w, h, mask)
  const notBg = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (mask[i]) continue
    const [L0, a0, b0] = bgAt(i, w, coef)
    const dL = lab[i * 3] - L0, da = lab[i * 3 + 1] - a0, db = lab[i * 3 + 2] - b0
    const de = Math.sqrt(dL * dL + da * da + db * db)
    const dC = Math.sqrt(da * da + db * db)
    // neutral panel on a warm / cool backdrop: a hue cast difference counts at a lower total ΔE
    if (debug) (debug.de ??= new Float32Array(n))[i] = de
    if (de <= NOT_BG_DE && !(de > NOT_BG_DE_CAST && dC > 3.5)) continue
    // a shadow: darker, chroma barely changed → backdrop, not product
    if (dL < 0 && dC < 5 && -dL < 30) continue
    notBg[i] = 1
  }
  // seal small gaps (antialiasing, print) inside the not-backdrop field; regions of it that sit next to the mask (within
  // ~1.5% of the frame — a low-contrast band can separate a light panel from the printed part) are product the mask missed
  const field = dilate(erode(erode(dilate(notBg, w, h, 2), w, h, 2), w, h, 1), w, h, 1)
  const reach = dilate(mask, w, h, Math.max(3, Math.round(Math.max(w, h) * 0.015)))
  let maskArea = 0
  for (let i = 0; i < n; i++) maskArea += mask[i]
  const { labels, list } = components(field, w, h)
  const touching = new Set<number>()
  const minArea = Math.max(30, maskArea * 0.01)
  for (const c of list) if (c.area >= minArea) touching.add(c.label)
  const hits = new Set<number>()
  for (let i = 0; i < n; i++) if (reach[i] && labels[i] && touching.has(labels[i])) hits.add(labels[i])
  const missed = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (labels[i] && hits.has(labels[i]) && !mask[i]) missed[i] = 1
  // Round 12: a SMALL miss (≤ 25 % of the mask) is accepted per region only when that region clearly differs from the
  // backdrop (mean ΔE ≥ 9): a lit, smooth patch of wall next to the product (A: between the landing-gear legs) is not
  // product. A large miss (PH white pouch top) keeps the round-11 behaviour.
  {
    let mArea = 0
    for (let i = 0; i < n; i++) mArea += missed[i]
    if (mArea) {
      const small = mArea / area <= SPAN_FILL_MIN_MISSED
      const { labels: ml, list: mlist } = components(missed, w, h)
      const sum = new Float64Array(mlist.length + 2), dLs = new Float64Array(mlist.length + 2), grad = new Float64Array(mlist.length + 2)
      for (let i = 0; i < n; i++) {
        const c = ml[i]
        if (!c) continue
        sum[c] += bgDelta(lab, i, w, coef)
        dLs[c] += lab[i * 3] - bgAt(i, w, coef)[0]
        const x = i % w
        if (x + 1 < w && i + w < n) grad[c] += Math.abs(lab[(i + 1) * 3] - lab[i * 3]) + Math.abs(lab[(i + w) * 3] - lab[i * 3])
      }
      // also not product: a soft (blurred, edge-free) region darker than the backdrop = a cast / contact shadow
      const weak = new Set(mlist.filter((c) => (small && sum[c.label] / c.area < SMALL_MISS_MIN_DE) || (dLs[c.label] / c.area < -2 && grad[c.label] / c.area < SHADOW_MAX_GRAD)).map((c) => c.label))
      for (let i = 0; i < n; i++) if (ml[i] && weak.has(ml[i])) missed[i] = 0
    }
  }
  if (debug) { debug.notBg = notBg; debug.missed = missed }
  // thin rims (antialias / edge halo) are not product: open the missed field
  const solid = missed
  let miss = 0, x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid[y * w + x]) { miss++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const missedShare = Math.round((miss / area) * 10000) / 10000
  if (!miss) return { missedShare: 0, bboxCoverage: 1 }
  const ux0 = Math.min(mx0, x0), uy0 = Math.min(my0, y0), ux1 = Math.max(mx1, x1), uy1 = Math.max(my1, y1)
  const bboxCoverage = Math.round((((mx1 - mx0 + 1) * (my1 - my0 + 1)) / ((ux1 - ux0 + 1) * (uy1 - uy0 + 1))) * 10000) / 10000
  let rep: Uint8Array = new Uint8Array(n)
  for (let i = 0; i < n; i++) rep[i] = mask[i] || solid[i] ? 1 : 0
  // Round 12: bridge only the low-contrast band between a recovered region and the mask (closing at the reach radius),
  // then fill fully enclosed holes. No row/column span fill: it painted the open gaps between A's landing-gear legs
  // (grey backdrop rectangles). Only regions CONNECTED to the product after the bridge are kept.
  const r = Math.max(3, Math.round(Math.max(w, h) * 0.015))
  const closed = erode(dilate(rep, w, h, r), w, h, r)
  // the bridge only adds pixels the backdrop model can NOT explain (the low-contrast band itself); backdrop stays out
  for (let i = 0; i < n; i++) if (closed[i] && !rep[i] && bgDelta(lab, i, w, coef) > NOT_BG_DE_CAST) rep[i] = 1
  rep = erode(dilate(rep, w, h, 2), w, h, 2)
  // a LARGE missed light panel (PH: 95 % of the pouch, white on a white wall) has an invisible outline: its face is
  // indistinguishable from the wall, so it is closed by the row ∩ column spans of the recovered silhouette. Small misses
  // (A: 4 %) never get spans — the open gaps of a frame product stay open.
  if (missedShare > SPAN_FILL_MIN_MISSED) rep = spanFill(rep, w, h)
  // enclosed holes: filled only when they are not backdrop (printed text inside a recovered panel); a real opening of
  // the product (the triangle between landing-gear legs) shows the backdrop and stays open
  {
    const filled = fillEnclosed(rep, w, h)
    const holes = new Uint8Array(n)
    for (let i = 0; i < n; i++) holes[i] = filled[i] && !rep[i] ? 1 : 0
    const { labels: hl, list: hlist } = components(holes, w, h)
    const bgCount = new Map<number, number>()
    for (let i = 0; i < n; i++) if (hl[i] && bgDelta(lab, i, w, coef) <= NOT_BG_DE_CAST) bgCount.set(hl[i], (bgCount.get(hl[i]) ?? 0) + 1)
    const fill = new Set(hlist.filter((c) => (bgCount.get(c.label) ?? 0) / c.area < 0.5 || (c.area < area * 0.0005 && (bgCount.get(c.label) ?? 0) / c.area < 0.8)).map((c) => c.label))
    for (let i = 0; i < n; i++) if (hl[i] && fill.has(hl[i])) rep[i] = 1
  }
  rep = keepConnectedToMask(rep, mask, w, h)
  // leftover backdrop added by the repair (pixels the backdrop model explains) — > 1.5 % of the product = fail
  // counted on the cut-out's rim band (where leftover backdrop shows against the new scene): a light product face that
  // matches the wall INSIDE the silhouette (PH white pouch top) is product, not leftover
  const inner = erode(rep, w, h, Math.max(3, Math.round(Math.max(w, h) * 0.006)))
  let added = 0, bgAdded = 0, repArea = 0
  for (let i = 0; i < n; i++) {
    if (!rep[i]) continue
    repArea++
    if (mask[i]) continue
    added++
    if (inner[i]) continue
    const de = bgDelta(lab, i, w, coef)
    if (de <= NOT_BG_DE_CAST) bgAdded++
  }
  const leftoverBackdrop = repArea ? Math.round((bgAdded / repArea) * 10000) / 10000 : 0
  return { missedShare, bboxCoverage, repaired: rep, leftoverBackdrop, addedShare: Math.round((added / Math.max(1, area)) * 10000) / 10000, missedBox: { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h } }
}

/**
 * Row span ∩ column span: a pixel between the leftmost and rightmost mask pixel of its row AND between the top and
 * bottom mask pixel of its column. Closes the low-contrast band left between a recovered light panel and the printed
 * part. Repair only (a product with a real notch / handle gap could be filled — limit noted).
 */
function spanFill(mask0: Uint8Array, w: number, h: number): Uint8Array {
  // column spans first (the light panel above + the printed part below), then rows ∩ columns on that
  const mask = mask0.slice()
  {
    for (let x = 0; x < w; x++) {
      let t = -1, b = -1
      for (let y = 0; y < h; y++) if (mask0[y * w + x]) { if (t < 0) t = y; b = y }
      for (let y = t; y >= 0 && y <= b; y++) mask[y * w + x] = 1
    }
  }
  const out = mask.slice()
  const top = new Int32Array(w).fill(h), bot = new Int32Array(w).fill(-1)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (y < top[x]) top[x] = y; if (y > bot[x]) bot[x] = y }
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (l < 0) l = x; r = x }
    if (l < 0) continue
    for (let x = l; x <= r; x++) if (y >= top[x] && y <= bot[x]) out[y * w + x] = 1
  }
  return out
}

/** Fill every background region not connected to the frame border (printed text inside a recovered panel). */
function fillEnclosed(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h
  const outside = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const push = (i: number) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (sp) {
    const i = stack[--sp]
    const x = i % w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (i >= w) push(i - w)
    if (i < n - w) push(i + w)
  }
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = outside[i] ? 0 : 1
  return out
}

/**
 * Round 11: the cut-out measured against the reference PHOTO, not against itself. An independent silhouette of the
 * product in the photo (every pixel the smooth backdrop model cannot explain, the main group of regions, closed +
 * spans filled) vs the delivered mask → IoU. The round-10 silhouetteIoU (cut-out vs the cut-out composited) was
 * 0.9998 on a PH cut-out missing the whole white top; this one reads ≈ 0.45 there.
 */
export function photoSilhouetteIoU(lab: Float32Array, w: number, h: number, mask: Uint8Array): number | null {
  const n = w * h
  bgH = h
  const coef = fitBackground(lab, w, h, mask)
  const notBg = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const [L0, a0, b0] = bgAt(i, w, coef)
    const dL = lab[i * 3] - L0, da = lab[i * 3 + 1] - a0, db = lab[i * 3 + 2] - b0
    const de = Math.sqrt(dL * dL + da * da + db * db)
    const dC = Math.sqrt(da * da + db * db)
    if (de <= NOT_BG_DE && !(de > NOT_BG_DE_CAST && dC > 3.5)) continue
    if (dL < 0 && dC < 5 && -dL < 30) continue
    notBg[i] = 1
  }
  const field = dilate(erode(erode(dilate(notBg, w, h, 2), w, h, 2), w, h, 1), w, h, 1)
  const { labels, list } = components(field, w, h)
  if (!list.length) return null
  // the photo's product = regions overlapping / touching the mask's neighbourhood (a prop elsewhere is not it)
  const reach = dilate(mask, w, h, Math.max(3, Math.round(Math.max(w, h) * 0.015)))
  const keep = new Set<number>()
  const minArea = Math.max(30, list[0].area * 0.01)
  for (let i = 0; i < n; i++) if (reach[i] && labels[i]) keep.add(labels[i])
  let sil: Uint8Array = new Uint8Array(n)
  const big = new Set(list.filter((c) => c.area >= minArea).map((c) => c.label))
  for (let i = 0; i < n; i++) sil[i] = labels[i] && keep.has(labels[i]) && big.has(labels[i]) ? 1 : 0
  // Round 12: no span fill — openings of the product (landing-gear triangle) show the backdrop and stay open
  sil = erode(dilate(sil, w, h, 4), w, h, 4)
  // a solid product (its mask fills its own spans: a pouch, a box) gets a span-filled silhouette (its light face can
  // match the wall); a frame product (open gaps between legs / wheels) keeps its openings
  {
    let ma = 0, sa = 0
    const spanned = spanFill(mask, w, h)
    for (let i = 0; i < n; i++) { ma += mask[i] ? 1 : 0; sa += spanned[i] }
    if (sa && ma / sa > 0.9) sil = fillEnclosed(spanFill(sil, w, h), w, h)
  }
  let inter = 0, uni = 0
  for (let i = 0; i < n; i++) { const a = mask[i] ? 1 : 0, b = sil[i]; inter += a & b; uni += a | b }
  return uni ? Math.round((inter / uni) * 10000) / 10000 : null
}
