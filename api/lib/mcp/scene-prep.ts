/**
 * Round 7: free, local scene preparation BEFORE the code layers are drawn (sharp only, no model call).
 *
 *  - `detectSeams`: the "keep the top / bottom bands empty" instruction made the model paint FLAT strips (navy / cream block at the top, the table cut
 *    flat at the bottom, a lighter rectangle under the top band). A seam = a flat uniform strip at the top / bottom edge of the picture that ends in a
 *    full-width step (gradient test across the boundary + flatness test of the strip). Natural horizons (wall / table) are not flat strips and are not flagged.
 *  - `blendSeams`: replaces the strip by a continuation of the scene (mirror of the rows next to the seam, blurred progressively with the distance,
 *    matched grain) so the band has no visible rectangle edge: no flat blocks, no frame.
 *  - `shiftSceneDown`: when the top of the picture is occupied by the product (no calm text corridor) the content is moved DOWN by extending the
 *    background above it the same way (content-aware blur-extend, no model call); the bottom rows that scroll out are cropped.
 */
import sharp from 'sharp'
import { safeZoneMargins } from './safe-zones.js'

export type Seam = {
  edge: 'top' | 'bottom'
  /** Row (full resolution) where the flat strip meets the scene. */
  y: number
  /** Height of the flat strip, px and fraction of the height. */
  stripPx: number
  stripShare: number
  /** Colour distance (0–255 RGB) across the boundary. */
  step: number
  /** Texture left in the strip (high-pass std of the luma); ~0 = a flat block. */
  flatness: number
}
export type SeamReport = { found: Seam[]; checked: boolean }

const DW = 320

type Small = { w: number; h: number; rgb: Buffer }

async function downscale(bytes: Buffer): Promise<Small & { fullW: number; fullH: number }> {
  const meta = await sharp(bytes).rotate().metadata()
  const fullW = meta.width || 0
  const fullH = meta.height || 0
  const { data, info } = await sharp(bytes).rotate().removeAlpha().resize({ width: DW }).raw().toBuffer({ resolveWithObject: true })
  return { w: info.width, h: info.height, rgb: data, fullW, fullH }
}

function rowStats(s: Small) {
  const { w, h, rgb } = s
  const mean: Array<[number, number, number]> = []
  const hp: number[] = []
  const luma = new Float32Array(w)
  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]
      luma[x] = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]
    }
    mean.push([r / w, g / w, b / w])
    // high-pass: luma minus a 15-px running mean → texture / noise only (a slow horizontal vignette does not count)
    let acc = 0, n = 0
    const k = 7
    let run = 0
    for (let x = 0; x < Math.min(w, k); x++) run += luma[x]
    for (let x = 0; x < w; x++) {
      if (x + k < w) run += luma[x + k]
      if (x - k - 1 >= 0) run -= luma[x - k - 1]
      const lo = Math.max(0, x - k), hi = Math.min(w - 1, x + k)
      const d = luma[x] - run / (hi - lo + 1)
      acc += d * d; n++
    }
    hp.push(Math.sqrt(acc / n))
  }
  return { mean, hp }
}

const dist3 = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const avg3 = (rows: Array<[number, number, number]>, y0: number, y1: number): [number, number, number] => {
  let r = 0, g = 0, b = 0, n = 0
  for (let y = Math.max(0, y0); y < Math.min(rows.length, y1); y++) { r += rows[y][0]; g += rows[y][1]; b += rows[y][2]; n++ }
  return n ? [r / n, g / n, b / n] : [0, 0, 0]
}

const MIN_STRIP = 0.03
const MAX_STRIP = 0.28
const MIN_STEP = 8
const MAX_TEXTURE = 2.6
const DRIFT = 7

function scan(rows: ReturnType<typeof rowStats>, h: number, dir: 1 | -1): { len: number; step: number; flatness: number } | null {
  const at = (k: number) => (dir === 1 ? k : h - 1 - k)
  const ref = avg3(rows.mean, dir === 1 ? 0 : h - 3, dir === 1 ? 3 : h)
  let k = 0
  const limit = Math.floor(h * MAX_STRIP)
  let tex = 0
  while (k < limit) {
    const y = at(k)
    const here = avg3(rows.mean, dir === 1 ? y - 1 : y - 1, dir === 1 ? y + 2 : y + 2)
    if (dist3(here, ref) > DRIFT || rows.hp[y] > MAX_TEXTURE) break
    tex += rows.hp[y]
    k++
  }
  if (k < Math.floor(h * MIN_STRIP) || k >= limit) return null
  const inside = dir === 1 ? avg3(rows.mean, k - 3, k) : avg3(rows.mean, h - k, h - k + 3)
  const outside = dir === 1 ? avg3(rows.mean, k, k + 3) : avg3(rows.mean, h - k - 3, h - k)
  const step = dist3(inside, outside)
  if (step < MIN_STEP) return null
  return { len: k, step, flatness: tex / k }
}

export async function detectSeams(bytes: Buffer, _ratio = '4:5'): Promise<SeamReport> {
  try {
    const s = await downscale(bytes)
    if (!s.w || !s.h) return { found: [], checked: false }
    const rows = rowStats(s)
    const found: Seam[] = []
    const scale = s.fullH / s.h
    for (const [edge, dir] of [['top', 1], ['bottom', -1]] as const) {
      const r = scan(rows, s.h, dir)
      if (!r) continue
      const stripPx = Math.round(r.len * scale)
      const y = dir === 1 ? stripPx : s.fullH - stripPx
      found.push({ edge, y, stripPx, stripShare: Math.round((r.len / s.h) * 1000) / 1000, step: Math.round(r.step * 10) / 10, flatness: Math.round(r.flatness * 100) / 100 })
    }
    return { found, checked: true }
  } catch {
    return { found: [], checked: false }
  }
}

/** Small deterministic PRNG so the grain (and the tests) are reproducible. */
function prng(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return (((r ^ (r >>> 14)) >>> 0) / 4294967296)
  }
}

/**
 * `n` rows that continue the picture ABOVE a seam, ordered outermost row first (row n-1 touches the seam).
 *
 * Source = the per-column MEAN of the `delta` rows right next to the seam (objects average out instead of being mirrored into the sky), blurred
 * horizontally, continued upward with the vertical colour drift measured on the next rows, plus a faint low-frequency modulation and grain matched to
 * the picture: a soft out-of-focus continuation of the wall / table, not a flat block and not a copy of an object.
 */
function continuationAbove(raw: Buffer, W: number, H: number, srcStart: number, n: number, seed: number): { fill: Buffer; edge: Float32Array } {
  const delta = Math.max(6, Math.round(H * 0.02))
  const meanRows = (y0: number, y1: number): Float32Array => {
    const out = new Float32Array(W * 3)
    const cnt = Math.max(1, Math.min(H, y1) - Math.max(0, y0))
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let i = 0; i < W * 3; i++) out[i] += raw[y * W * 3 + i]
    for (let i = 0; i < out.length; i++) out[i] /= cnt
    return out
  }
  const base = meanRows(srcStart, srcStart + delta)
  const next = meanRows(srcStart + delta, srcStart + 2 * delta)
  // horizontal gaussian blur of the base row
  const sigma = Math.max(3, W * 0.02)
  const rad = Math.ceil(sigma * 2.5)
  const kern = Array.from({ length: rad * 2 + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)))
  const ks = kern.reduce((a, b) => a + b, 0)
  const row = new Float32Array(W * 3)
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let acc = 0
    for (let j = -rad; j <= rad; j++) { const xx = Math.min(W - 1, Math.max(0, x + j)); acc += base[xx * 3 + c] * kern[j + rad] }
    row[x * 3 + c] = acc / ks
  }
  // global vertical drift (per channel) per `delta` rows, pointing AWAY from the picture: continue it, damped
  const drift = [0, 1, 2].map((c) => {
    let a = 0, b = 0
    for (let x = 0; x < W; x++) { a += base[x * 3 + c]; b += next[x * 3 + c] }
    return (a - b) / W
  })
  const rnd = prng(seed)
  // low-frequency modulation: a coarse random grid, bilinear
  const gw = 9, gh = Math.max(2, Math.ceil(n / (H * 0.08)) + 1)
  const grid = Array.from({ length: gw * gh }, () => (rnd() - 0.5) * 3)
  const fill = Buffer.alloc(W * n * 3)
  for (let y = 0; y < n; y++) {
    const k = n - 1 - y // rows away from the seam
    const dr = Math.min(1, k / delta)
    for (let x = 0; x < W; x++) {
      const gx = (x / Math.max(1, W - 1)) * (gw - 1), gy = (k / Math.max(1, n - 1)) * (gh - 1)
      const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0
      const g = (grid[y0 * gw + x0] * (1 - fx) + grid[y0 * gw + Math.min(gw - 1, x0 + 1)] * fx) * (1 - fy) + (grid[Math.min(gh - 1, y0 + 1) * gw + x0] * (1 - fx) + grid[Math.min(gh - 1, y0 + 1) * gw + Math.min(gw - 1, x0 + 1)] * fx) * fy
      const i = (y * W + x) * 3
      const grain = (rnd() - 0.5) * 3.4
      for (let c = 0; c < 3; c++) {
        const shift = Math.max(-14, Math.min(14, drift[c] * (k / delta) * 0.55))
        const v = row[x * 3 + c] + shift + g * Math.min(1, dr + 0.2) + grain
        fill[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
      }
    }
  }
  return { fill, edge: row }
}

/** Cross-fade the `xf` original rows that follow the filled area into the continuation edge so there is no step between texture and fill. */
function softenJoin(out: Buffer, orig: Buffer, W: number, y0: number, xf: number, edge: Float32Array, dir: 1 | -1) {
  for (let t = 0; t < xf; t++) {
    const y = dir === 1 ? y0 + t : y0 - t
    const a = (t + 1) / (xf + 1) // 0 next to the fill → 1 inside the picture
    for (let i = 0; i < W * 3; i++) out[y * W * 3 + i] = Math.round(edge[i] * (1 - a) + orig[y * W * 3 + i] * a)
  }
}

export type BlendReport = { applied: boolean; seams: Seam[]; remaining: Seam[]; note: string }

/** Replace the flat strips by a continuation of the scene. Returns the new image (same pixel size) and the report. */
export async function blendSeams(bytes: Buffer, seams: Seam[], quality = 93): Promise<{ bytes: Buffer; report: BlendReport }> {
  if (!seams.length) return { bytes, report: { applied: false, seams: [], remaining: [], note: 'no seams' } }
  const base = sharp(bytes).rotate().removeAlpha()
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const out = Buffer.from(data)
  const feather = Math.round(H * 0.012)
  const xf = Math.max(4, Math.round(H * 0.012))
  for (const s of seams) {
    if (s.edge === 'top') {
      const n = s.stripPx + feather
      if (n < 4 || n + 3 * Math.max(6, Math.round(H * 0.02)) + xf >= H) continue
      const { fill, edge } = continuationAbove(data, W, H, n, n, 7)
      fill.copy(out, 0, 0, W * n * 3)
      softenJoin(out, data, W, n, xf, edge, 1)
    } else {
      const n = s.stripPx + feather
      const start = H - n // first row replaced
      if (n < 4 || n + 3 * Math.max(6, Math.round(H * 0.02)) + xf >= H) continue
      // mirror the picture so the bottom becomes a top seam, build the continuation there, flip back
      const flipped = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).flip().raw().toBuffer()
      const { fill, edge } = continuationAbove(flipped, W, H, n, n, 11)
      const back = await sharp(fill, { raw: { width: W, height: n, channels: 3 } }).flip().raw().toBuffer()
      back.copy(out, start * W * 3, 0, W * n * 3)
      softenJoin(out, data, W, start - 1, xf, edge, -1)
    }
  }
  const png = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality }).toBuffer()
  const after = await detectSeams(png)
  return { bytes: png, report: { applied: true, seams, remaining: after.found, note: `flat band(s) ${seams.map((s) => `${s.edge} ${Math.round(s.stripShare * 100)}%`).join(', ')} continued from the scene (mirror + progressive blur + grain)` } }
}

/** Largest strip the top / bottom fill can still make from a scene (never more than half the picture). */
export const MAX_SHIFT = 0.2

/**
 * Move the picture content DOWN by `dPx` rows: the vacated top is a content-aware blur-extension of the top rows, the bottom `dPx` rows scroll out
 * (cropped). Same pixel size. Only sensible when the top of the scene is plain background.
 */
export async function shiftSceneDown(bytes: Buffer, dPx: number, quality = 93): Promise<Buffer> {
  const base = sharp(bytes).rotate().removeAlpha()
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const d = Math.max(0, Math.min(Math.round(H * MAX_SHIFT), Math.round(dPx)))
  if (d < 2) return bytes
  const out = Buffer.alloc(data.length)
  const { fill, edge } = continuationAbove(data, W, H, 0, d, 13)
  fill.copy(out, 0, 0, W * d * 3)
  data.copy(out, W * d * 3, 0, W * (H - d) * 3)
  softenJoin(out, data, W, d, Math.max(4, Math.round(H * 0.012)), edge, 1)
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality }).toBuffer()
}

/** Free-band geometry used to place the seam zones (for reports only). */
export function bandZones(ratio: string) {
  const m = safeZoneMargins(ratio)
  return { top: m.top, bottom: m.bottom }
}
