/**
 * Free, local, model-free product locator + region comparison for the MCP fidelity post-check.
 *
 * ORB-style: FAST corners → oriented BRIEF descriptors → ratio-test matching on a small scale
 * pyramid of the generated image → RANSAC similarity transform (scale, small rotation, shift).
 * Once the reference product is located in the generated image, the reference is warped onto it
 * and compared cell by cell with zero-mean normalised correlation (lighting tolerant). The share of
 * textured reference cells that still correlate is the "preserved structure" score: a product that
 * was re-lit keeps it high, a product whose wing fold / landing gear / parts were redrawn loses it.
 *
 * Pure TypeScript on top of sharp (already a dependency). Deterministic (seeded RNG).
 */
import sharp from 'sharp'

export type Gray = { data: Uint8Array; w: number; h: number }

export const REF_WIDTH = 512
export const GEN_WIDTH = 640
const GEN_PYRAMID = [1, 0.7, 0.5]

export async function toGray(bytes: Buffer, width: number): Promise<Gray> {
  const { data, info } = await sharp(bytes)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width, withoutEnlargement: false })
    .greyscale()
    .normalise({ lower: 1, upper: 99 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), w: info.width, h: info.height }
}

type Keypoint = { x: number; y: number; desc: Uint32Array }

const CIRCLE: ReadonlyArray<readonly [number, number]> = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
]

function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

// Fixed BRIEF sampling pattern (deterministic).
const PATTERN: ReadonlyArray<readonly [number, number, number, number]> = (() => {
  const rnd = makeRng(12345)
  const g = () => {
    let u = 0
    for (let i = 0; i < 4; i++) u += rnd()
    return (u - 2) * 6
  }
  const clamp = (v: number) => Math.max(-14, Math.min(14, Math.round(v)))
  return Array.from({ length: 256 }, () => [clamp(g()), clamp(g()), clamp(g()), clamp(g())] as const)
})()

function box3(img: Gray): Uint8Array {
  const { data: d, w, h } = img
  const out = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += d[(y + dy) * w + x + dx]
      out[y * w + x] = (s / 9) | 0
    }
  }
  return out
}

function detectAt(img: Gray, smooth: Uint8Array, thr: number, maxKp: number): Keypoint[] {
  const { data: d, w, h } = img
  const cand: Array<{ x: number; y: number; s: number }> = []
  for (let y = 16; y < h - 16; y++) {
    for (let x = 16; x < w - 16; x++) {
      const c = d[y * w + x]
      let runB = 0
      let runD = 0
      let maxB = 0
      let maxD = 0
      for (let k = 0; k < 32; k++) {
        const p = CIRCLE[k & 15]
        const v = d[(y + p[1]) * w + x + p[0]]
        if (v > c + thr) { runB++; runD = 0 } else if (v < c - thr) { runD++; runB = 0 } else { runB = 0; runD = 0 }
        if (runB > maxB) maxB = runB
        if (runD > maxD) maxD = runD
      }
      if (maxB >= 9 || maxD >= 9) {
        let s = 0
        for (const p of CIRCLE) s += Math.abs(d[(y + p[1]) * w + x + p[0]] - c)
        cand.push({ x, y, s })
      }
    }
  }
  cand.sort((a, b) => b.s - a.s)
  const taken = new Uint8Array(w * h)
  const out: Keypoint[] = []
  for (const c of cand) {
    if (out.length >= maxKp) break
    let free = true
    for (let dy = -3; dy <= 3 && free; dy++) for (let dx = -3; dx <= 3; dx++) if (taken[(c.y + dy) * w + c.x + dx]) { free = false; break }
    if (!free) continue
    taken[c.y * w + c.x] = 1
    let m10 = 0
    let m01 = 0
    for (let dy = -7; dy <= 7; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        if (dx * dx + dy * dy > 49) continue
        const v = smooth[(c.y + dy) * w + c.x + dx]
        m10 += dx * v
        m01 += dy * v
      }
    }
    const a = Math.atan2(m01, m10)
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const desc = new Uint32Array(8)
    for (let i = 0; i < 256; i++) {
      const [x1, y1, x2, y2] = PATTERN[i]
      const px = Math.max(0, Math.min(w - 1, c.x + Math.round(ca * x1 - sa * y1)))
      const py = Math.max(0, Math.min(h - 1, c.y + Math.round(sa * x1 + ca * y1)))
      const qx = Math.max(0, Math.min(w - 1, c.x + Math.round(ca * x2 - sa * y2)))
      const qy = Math.max(0, Math.min(h - 1, c.y + Math.round(sa * x2 + ca * y2)))
      if (smooth[py * w + px] < smooth[qy * w + qx]) desc[i >> 5] |= 1 << (i & 31)
    }
    out.push({ x: c.x, y: c.y, desc })
  }
  return out
}

/** Adaptive FAST threshold: lower it until the image yields enough corners (dark / low-contrast products). */
export function detectKeypoints(img: Gray, minKp: number, maxKp: number): Keypoint[] {
  const smooth = box3(img)
  let kps: Keypoint[] = []
  for (const thr of [24, 16, 10, 6]) {
    kps = detectAt(img, smooth, thr, maxKp)
    if (kps.length >= minKp) break
  }
  return kps
}

function popcount(v: number): number {
  v -= (v >>> 1) & 0x55555555
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}
function hamming(a: Uint32Array, b: Uint32Array): number {
  let s = 0
  for (let i = 0; i < 8; i++) s += popcount(a[i] ^ b[i])
  return s
}

export type Similarity = { a: number; b: number; mrx: number; mry: number; mgx: number; mgy: number; /** Least-squares affine refinement on the inliers [A00, A01, A10, A11] (tilted / perspective-ish flat products). */ aff?: [number, number, number, number] }
const applyX = (t: Similarity, x: number, y: number) => (t.aff ? t.aff[0] * (x - t.mrx) + t.aff[1] * (y - t.mry) : t.a * (x - t.mrx) - t.b * (y - t.mry)) + t.mgx
const applyY = (t: Similarity, x: number, y: number) => (t.aff ? t.aff[2] * (x - t.mrx) + t.aff[3] * (y - t.mry) : t.b * (x - t.mrx) + t.a * (y - t.mry)) + t.mgy

export type Located = {
  /** RANSAC inliers (reference keypoint ↔ generated image). */
  inliers: number
  /** Generated-image scale relative to the reference (REF_WIDTH → GEN_WIDTH frames). */
  scale: number
  transform: Similarity
  refKeypoints: number
  matches: number
}

type Match = { rx: number; ry: number; gx: number; gy: number }

export async function locateProduct(refBytes: Buffer, genBytes: Buffer): Promise<{ located: Located | null; ref: Gray; gen: Gray; refKps: Keypoint[] }> {
  const ref = await toGray(refBytes, REF_WIDTH)
  const gen = await toGray(genBytes, GEN_WIDTH)
  const refKps = detectKeypoints(ref, 250, 700)
  const matches: Match[] = []
  for (const s of GEN_PYRAMID) {
    const g = s === 1 ? gen : await toGray(genBytes, Math.round(GEN_WIDTH * s))
    const kps = detectKeypoints(g, 300, 900)
    for (const r of refKps) {
      let b1 = 1e9
      let b2 = 1e9
      let bi = -1
      for (let i = 0; i < kps.length; i++) {
        const d = hamming(r.desc, kps[i].desc)
        if (d < b1) { b2 = b1; b1 = d; bi = i } else if (d < b2) b2 = d
      }
      if (bi >= 0 && b1 < 70 && b1 < 0.8 * b2) matches.push({ rx: r.x, ry: r.y, gx: kps[bi].x / s, gy: kps[bi].y / s })
    }
  }
  if (matches.length < 6) return { located: null, ref, gen, refKps }
  const rnd = makeRng(777)
  let best: Match[] = []
  for (let it = 0; it < 1500; it++) {
    const a = matches[(rnd() * matches.length) | 0]
    const b = matches[(rnd() * matches.length) | 0]
    if (a === b) continue
    const rx = b.rx - a.rx
    const ry = b.ry - a.ry
    const gx = b.gx - a.gx
    const gy = b.gy - a.gy
    const rl = Math.hypot(rx, ry)
    const gl = Math.hypot(gx, gy)
    if (rl < 20 || gl < 5) continue
    const sc = gl / rl
    if (sc < 0.25 || sc > 2.5) continue
    const ang = Math.atan2(gy, gx) - Math.atan2(ry, rx)
    if (Math.abs(ang) > 0.35) continue
    const ca = Math.cos(ang) * sc
    const sa = Math.sin(ang) * sc
    const tx = a.gx - (ca * a.rx - sa * a.ry)
    const ty = a.gy - (sa * a.rx + ca * a.ry)
    const tol = 6 * Math.max(1, sc)
    const inl = matches.filter((m) => Math.hypot(ca * m.rx - sa * m.ry + tx - m.gx, sa * m.rx + ca * m.ry + ty - m.gy) < tol)
    if (inl.length > best.length) best = inl
  }
  if (best.length < 6) return { located: null, ref, gen, refKps }
  // Least-squares similarity (Procrustes) on the inliers.
  const n = best.length
  let mrx = 0, mry = 0, mgx = 0, mgy = 0
  for (const m of best) { mrx += m.rx; mry += m.ry; mgx += m.gx; mgy += m.gy }
  mrx /= n; mry /= n; mgx /= n; mgy /= n
  let num1 = 0, num2 = 0, den = 0
  for (const m of best) {
    const rx = m.rx - mrx, ry = m.ry - mry, gx = m.gx - mgx, gy = m.gy - mgy
    num1 += rx * gx + ry * gy
    num2 += rx * gy - ry * gx
    den += rx * rx + ry * ry
  }
  if (den < 1) return { located: null, ref, gen, refKps }
  const t: Similarity = { a: num1 / den, b: num2 / den, mrx, mry, mgx, mgy }
  // Affine refinement: absorbs the tilt / slight perspective of a flat product (a pouch) that a pure similarity
  // turns into a systematic drift. Kept only when it stays close to the similarity (no degenerate fits).
  let sxx = 0, sxy = 0, syy = 0, gxx = 0, gxy = 0, gyx = 0, gyy = 0
  for (const m of best) {
    const rx = m.rx - mrx, ry = m.ry - mry, gx = m.gx - mgx, gy = m.gy - mgy
    sxx += rx * rx; sxy += rx * ry; syy += ry * ry
    gxx += gx * rx; gxy += gx * ry; gyx += gy * rx; gyy += gy * ry
  }
  const det = sxx * syy - sxy * sxy
  if (det > 1e-3 * sxx * syy && n >= 12) {
    const A00 = (gxx * syy - gxy * sxy) / det
    const A01 = (gxy * sxx - gxx * sxy) / det
    const A10 = (gyx * syy - gyy * sxy) / det
    const A11 = (gyy * sxx - gyx * sxy) / det
    const sc = Math.hypot(t.a, t.b)
    const dev = Math.max(Math.abs(A00 - t.a), Math.abs(A01 + t.b), Math.abs(A10 - t.b), Math.abs(A11 - t.a)) / Math.max(sc, 1e-6)
    if (dev < 0.25) t.aff = [A00, A01, A10, A11]
  }
  return {
    located: { inliers: n, scale: Math.hypot(t.a, t.b), transform: t, refKeypoints: refKps.length, matches: matches.length },
    ref,
    gen,
    refKps,
  }
}

export type RegionComparison = {
  /** Textured reference cells compared. */
  cells: number
  /** Share of those cells whose structure still correlates in the generated image (0–1). */
  preserved: number
  /** Bounding box of the located product in the GEN_WIDTH frame. */
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

// Calibrated on the Round 2/3 real pairs (flat pouch faithful 0.89, plane redraw 0.77, synthetic intact ≥ 0.8): affine-refined location, 10 px cells, ±1 px tolerance.
const CELL_DEFAULT = 10
const STD_DEFAULT = 12
const NCC_DEFAULT = 0.6
const SHIFT_DEFAULT = 1

function bilinear(g: Gray, x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  if (xi < 0 || yi < 0 || xi >= g.w - 1 || yi >= g.h - 1) return -1
  const fx = x - xi
  const fy = y - yi
  const d = g.data
  const w = g.w
  return d[yi * w + xi] * (1 - fx) * (1 - fy) + d[yi * w + xi + 1] * fx * (1 - fy) + d[(yi + 1) * w + xi] * (1 - fx) * fy + d[(yi + 1) * w + xi + 1] * fx * fy
}

/** Warp the reference onto the generated image and correlate cell by cell (±2 px shift tolerance). */
export function compareLocatedRegion(ref: Gray, gen: Gray, refKps: Keypoint[], t: Similarity, opts: { cell?: number; stdMin?: number; nccMin?: number; shift?: number } = {}): RegionComparison | null {
  const CELL_STD_MIN = opts.stdMin ?? STD_DEFAULT
  const CELL_NCC_MIN = opts.nccMin ?? NCC_DEFAULT
  let kx0 = 1e9, ky0 = 1e9, kx1 = -1, ky1 = -1
  for (const k of refKps) { kx0 = Math.min(kx0, k.x); ky0 = Math.min(ky0, k.y); kx1 = Math.max(kx1, k.x); ky1 = Math.max(ky1, k.y) }
  if (kx1 <= kx0 || ky1 <= ky0) return null
  // Cell size follows the product size (small products need fine cells, large flat ones coarse cells).
  const CELL = opts.cell ?? Math.max(10, Math.min(CELL_DEFAULT, Math.round(Math.min(kx1 - kx0, ky1 - ky0) / 8)))
  let cells = 0
  let kept = 0
  const rv = new Float32Array(CELL * CELL)
  const gv = new Float32Array(CELL * CELL)
  let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1
  for (let cy = Math.floor(ky0); cy < ky1; cy += CELL) {
    for (let cx = Math.floor(kx0); cx < kx1; cx += CELL) {
      if (cx + CELL >= ref.w || cy + CELL >= ref.h) continue
      let mr = 0
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) { const v = ref.data[(cy + y) * ref.w + cx + x]; rv[y * CELL + x] = v; mr += v }
      mr /= CELL * CELL
      let sr = 0
      for (let i = 0; i < rv.length; i++) sr += (rv[i] - mr) ** 2
      if (Math.sqrt(sr / rv.length) < CELL_STD_MIN) continue
      let bestNcc = -1
      let ok = false
      const SH = opts.shift ?? SHIFT_DEFAULT
      for (let sy = -SH; sy <= SH; sy++) {
        for (let sx = -SH; sx <= SH; sx++) {
          let bad = false
          let mg = 0
          for (let y = 0; y < CELL && !bad; y++) {
            for (let x = 0; x < CELL; x++) {
              const px = cx + x
              const py = cy + y
              const v = bilinear(gen, applyX(t, px, py) + sx, applyY(t, px, py) + sy)
              if (v < 0) { bad = true; break }
              gv[y * CELL + x] = v
              mg += v
            }
          }
          if (bad) continue
          ok = true
          mg /= CELL * CELL
          let sg = 0, sc = 0
          for (let i = 0; i < gv.length; i++) { sg += (gv[i] - mg) ** 2; sc += (rv[i] - mr) * (gv[i] - mg) }
          const ncc = sc / (Math.sqrt(sr * sg) + 1e-6)
          if (ncc > bestNcc) bestNcc = ncc
        }
      }
      if (!ok) continue
      cells++
      if (bestNcc >= CELL_NCC_MIN) kept++
      const gx = applyX(t, cx + CELL / 2, cy + CELL / 2)
      const gy = applyY(t, cx + CELL / 2, cy + CELL / 2)
      bx0 = Math.min(bx0, gx); by0 = Math.min(by0, gy); bx1 = Math.max(bx1, gx); by1 = Math.max(by1, gy)
    }
  }
  if (cells === 0) return null
  return { cells, preserved: kept / cells, bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 } }
}

/** Where the whole reference frame lands in the generated image, as fractions (0–1). Used to find the brand logo. */
export function projectReferenceBox(ref: Gray, gen: Gray, t: Similarity): { x0: number; y0: number; x1: number; y1: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const [x, y] of [[0, 0], [ref.w, 0], [0, ref.h], [ref.w, ref.h]] as Array<[number, number]>) {
    xs.push(applyX(t, x, y))
    ys.push(applyY(t, x, y))
  }
  const c = (v: number) => Math.max(0, Math.min(1, v))
  return { x0: c(Math.min(...xs) / gen.w), y0: c(Math.min(...ys) / gen.h), x1: c(Math.max(...xs) / gen.w), y1: c(Math.max(...ys) / gen.h) }
}
