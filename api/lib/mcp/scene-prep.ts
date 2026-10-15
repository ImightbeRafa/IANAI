/**
 * Round 7: free, local scene preparation BEFORE the code layers are drawn (sharp only, no model call).
 *
 *  - `detectSeams`: the "keep the top / bottom bands empty" instruction made the model paint FLAT strips (navy / cream block at the top, the table cut
 *    flat at the bottom, a lighter rectangle under the top band). A seam = a flat uniform strip at the top / bottom edge of the picture that ends in a
 *    full-width step (gradient test across the boundary + flatness test of the strip). Natural horizons (wall / table) are not flat strips and are not flagged.
 *  - `blendSeams`: replaces the strip by a continuation of the scene (round 10: per-column background colour of the rows next to the seam + synthetic
 *    grain matched to the texture; never a mirror / flip of the picture) so the band has no visible rectangle edge: no flat blocks, no frame.
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

/** Normalised box (fractions of the picture). */
type NB = { x0: number; y0: number; x1: number; y1: number }

/**
 * Round 10: per-edge continuation WITHOUT any mirror / flip (round 9's vertical high-pass read rows back INTO the picture, so a controller / pouch print near
 * the edge came back as a ghost, and the rotated side strips read as a blurred frame).
 *
 * Builds `n` rows beyond a horizontal edge of `raw` (W×H RGB). `srcStart` = rows next to the edge that are skipped (the strip being replaced).
 *   - colour: the per-column MEDIAN of the `delta` rows right next to the edge (thin objects drop out), with columns covered by a located product / object
 *     (`maskCols`) re-interpolated from their free neighbours, blurred horizontally, carried outward with the measured vertical colour drift (damped);
 *   - texture: NOT copied — synthetic streak noise (smooth along x, AR(1) across rows) whose strength matches the high-pass std of the source rows (wood grain,
 *     fabric), plus fine grain. Nothing of the picture is reproduced except the per-column background colour.
 * Returned rows are ordered by distance from the edge: fill row 0 touches the edge, row n-1 is the outermost. `edge` = the colour row used at distance 0.
 */
export function continueEdge(raw: Buffer, W: number, H: number, side: 'top' | 'bottom', srcStart: number, n: number, seed: number, maskCols?: Uint8Array): { fill: Buffer; edge: Float32Array } {
  const delta = Math.max(6, Math.round(H * 0.02))
  const rowAt = (j: number) => { const y = side === 'top' ? srcStart + j : H - 1 - srcStart - j; return Math.min(H - 1, Math.max(0, y)) }
  const medianRows = (j0: number, j1: number): Float32Array => {
    const out = new Float32Array(W * 3)
    const vals: number[] = []
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
      vals.length = 0
      for (let j = j0; j < j1; j++) vals.push(raw[(rowAt(j) * W + x) * 3 + c])
      vals.sort((a, b) => a - b)
      out[x * 3 + c] = vals[vals.length >> 1]
    }
    return out
  }
  const base = medianRows(0, delta)
  const next = medianRows(delta, 2 * delta)
  if (maskCols && maskCols.some((m) => m) && !maskCols.every((m) => m)) for (const arr of [base, next]) interpolateMasked(arr, W, maskCols)
  const sigma = Math.max(3, W * 0.02)
  const row = blurRow(base, W, sigma)
  const drift = [0, 1, 2].map((c) => { let a = 0, b = 0; for (let x = 0; x < W; x++) { a += base[x * 3 + c]; b += next[x * 3 + c] } return (a - b) / W })
  // texture strength of the source rows: luma minus a ±6-row vertical mean (horizontal grain / streaks), robust std, clamped
  const lumaAt = (y: number, x: number) => { const j = (y * W + x) * 3; return 0.299 * raw[j] + 0.587 * raw[j + 1] + 0.114 * raw[j + 2] }
  const hp: number[] = []
  for (let j = 0; j < delta; j += 2) for (let x = 0; x < W; x += 3) {
    if (maskCols?.[x]) continue
    let m = 0
    for (let t = -6; t <= 6; t++) m += lumaAt(rowAt(j + t + 6), x)
    hp.push(Math.abs(lumaAt(rowAt(j + 6), x) - m / 13))
  }
  hp.sort((a, b) => a - b)
  const texStd = Math.min(9, (hp[Math.floor(hp.length * 0.5)] ?? 0) * 1.4826)
  const rnd = prng(seed)
  const corr = Math.max(4, Math.round(W * 0.012))
  const streak = new Float32Array(W)
  const fresh = new Float32Array(W)
  const freshRow = () => {
    for (let x = 0; x < W; x++) fresh[x] = rnd() - 0.5
    const sm = blurScalar(fresh, W, corr)
    let s = 0
    for (let x = 0; x < W; x++) s += sm[x] * sm[x]
    const k = 1 / Math.max(1e-6, Math.sqrt(s / W))
    for (let x = 0; x < W; x++) sm[x] *= k
    return sm
  }
  const init = freshRow()
  streak.set(init)
  const rho = 0.7
  const fill = Buffer.alloc(W * n * 3)
  for (let k = 0; k < n; k++) {
    const nw = freshRow()
    for (let x = 0; x < W; x++) streak[x] = rho * streak[x] + Math.sqrt(1 - rho * rho) * nw[x]
    const fade = Math.max(0.35, 1 - k / Math.max(1, n * 1.6))
    for (let x = 0; x < W; x++) {
      const i = (k * W + x) * 3
      const t = streak[x] * texStd * fade + (rnd() - 0.5) * 3.4
      for (let c = 0; c < 3; c++) {
        const shift = Math.max(-14, Math.min(14, drift[c] * (k / delta) * 0.55))
        const v = row[x * 3 + c] + shift + t
        fill[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
      }
    }
  }
  return { fill, edge: row }
}

function blurScalar(src: Float32Array, W: number, sigma: number): Float32Array {
  const rad = Math.ceil(sigma * 2.5)
  const kern = Array.from({ length: rad * 2 + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)))
  const ks = kern.reduce((a, b) => a + b, 0)
  const out = new Float32Array(W)
  for (let x = 0; x < W; x++) { let acc = 0; for (let j = -rad; j <= rad; j++) acc += src[Math.min(W - 1, Math.max(0, x + j))] * kern[j + rad]; out[x] = acc / ks }
  return out
}

function blurRow(base: Float32Array, W: number, sigma: number): Float32Array {
  const out = new Float32Array(W * 3)
  const ch = new Float32Array(W)
  for (let c = 0; c < 3; c++) {
    for (let x = 0; x < W; x++) ch[x] = base[x * 3 + c]
    const b = blurScalar(ch, W, sigma)
    for (let x = 0; x < W; x++) out[x * 3 + c] = b[x]
  }
  return out
}

/** Replace masked entries of an interleaved RGB row by a linear interpolation between the nearest free entries (or the nearest free one at the ends). */
export function interpolateMasked(arr: Float32Array, W: number, mask: Uint8Array) {
  let x = 0
  while (x < W) {
    if (!mask[x]) { x++; continue }
    const a = x - 1
    let b = x
    while (b < W && mask[b]) b++
    for (let k = x; k < b; k++) for (let c = 0; c < 3; c++) {
      const va = a >= 0 ? arr[a * 3 + c] : arr[b * 3 + c]
      const vb = b < W ? arr[b * 3 + c] : va
      const t = a >= 0 && b < W ? (k - a) / (b - a) : 0
      arr[k * 3 + c] = va * (1 - t) + vb * t
    }
    x = b
  }
}

/** Columns covered by a located box that reaches within `reach` (fraction of H) of the given edge. */
export function edgeMask(boxes: NB[] | undefined, W: number, side: 'top' | 'bottom', reach = 0.08): Uint8Array | undefined {
  if (!boxes?.length) return undefined
  const m = new Uint8Array(W)
  let any = false
  for (const b of boxes) {
    const touches = side === 'top' ? b.y0 <= reach : b.y1 >= 1 - reach
    if (!touches) continue
    const x0 = Math.max(0, Math.floor((b.x0 - 0.01) * W)), x1 = Math.min(W, Math.ceil((b.x1 + 0.01) * W))
    for (let x = x0; x < x1; x++) m[x] = 1
    any = true
  }
  return any ? m : undefined
}

/** Place a continueEdge result: top = fill rows reversed (outermost first) into rows [0, n); bottom = fill rows in order into rows [start, start+n). */
function placeFill(out: Buffer, W: number, fill: Buffer, n: number, side: 'top' | 'bottom', start: number) {
  for (let k = 0; k < n; k++) {
    const y = side === 'top' ? start + n - 1 - k : start + k
    fill.copy(out, y * W * 3, k * W * 3, (k + 1) * W * 3)
  }
}

/** Cross-fade the `xf` original rows that follow the filled area into the continuation edge so there is no step between texture and fill. */
function softenJoin(out: Buffer, orig: Buffer, W: number, y0: number, xf: number, edge: Float32Array, dir: 1 | -1) {
  for (let t = 0; t < xf; t++) {
    const y = dir === 1 ? y0 + t : y0 - t
    const a = (t + 1) / (xf + 1) // 0 next to the fill → 1 inside the picture
    for (let i = 0; i < W * 3; i++) out[y * W * 3 + i] = Math.round(edge[i] * (1 - a) + orig[y * W * 3 + i] * a)
  }
}

/** Share of the strip's neighbouring content that is "detailed": the blend continues the per-column mean colour of the rows next to the strip, which smears objects / art / lit areas (round-7 B: smear + glitch at the top edge of the box). */
export const DETAIL_REFUSE = 0.62
/** `share of columns` whose mean colour (over the 6 % of the height next to the strip) is > 40 away from the median column: calm wall / table ≈ 0–0.2, objects or art touching the strip ≥ 0.7. */
export function neighbourDetail(raw: Buffer, W: number, H: number, seam: Seam): number {
  const rows = Math.max(4, Math.round(H * 0.06))
  const y0 = seam.edge === 'top' ? Math.min(H - rows, seam.stripPx) : Math.max(0, H - seam.stripPx - rows)
  const step = Math.max(1, Math.round(W / 320))
  const cols: Array<[number, number, number]> = []
  for (let x = 0; x < W; x += step) {
    const m: [number, number, number] = [0, 0, 0]
    for (let y = y0; y < y0 + rows; y++) { const i = (y * W + x) * 3; m[0] += raw[i]; m[1] += raw[i + 1]; m[2] += raw[i + 2] }
    cols.push([m[0] / rows, m[1] / rows, m[2] / rows])
  }
  const med = [0, 1, 2].map((c) => cols.map((m) => m[c]).sort((a, b) => a - b)[cols.length >> 1])
  return Math.round((cols.filter((m) => Math.hypot(m[0] - med[0], m[1] - med[1], m[2] - med[2]) > 40).length / cols.length) * 1000) / 1000
}

export type BlendReport = { applied: boolean; seams: Seam[]; remaining: Seam[]; /** Strips left as they were because the content next to them is detailed (flag qa.seamBlendSkipped). */ skipped: Array<{ edge: Seam['edge']; detail: number }>; note: string }

/** Replace the flat strips by a continuation of the scene. Returns the new image (same pixel size) and the report. */
export async function blendSeams(bytes: Buffer, seams: Seam[], quality = 93, refuseAbove = DETAIL_REFUSE, avoid?: NB[]): Promise<{ bytes: Buffer; report: BlendReport }> {
  if (!seams.length) return { bytes, report: { applied: false, seams: [], remaining: [], skipped: [], note: 'no seams' } }
  const base = sharp(bytes).rotate().removeAlpha()
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const out = Buffer.from(data)
  const feather = Math.round(H * 0.012)
  const xf = Math.max(4, Math.round(H * 0.012))
  const skipped: BlendReport['skipped'] = []
  for (const s of seams) {
    const detail = neighbourDetail(data, W, H, s)
    if (detail > refuseAbove) { skipped.push({ edge: s.edge, detail }); continue }
    if (s.edge === 'top') {
      const n = s.stripPx + feather
      if (n < 4 || n + 3 * Math.max(6, Math.round(H * 0.02)) + xf >= H) continue
      const { fill, edge } = continueEdge(data, W, H, 'top', n, n, 7, edgeMask(avoid, W, 'top', s.stripShare + 0.08))
      placeFill(out, W, fill, n, 'top', 0)
      softenJoin(out, data, W, n, xf, edge, 1)
    } else {
      const n = s.stripPx + feather
      const start = H - n // first row replaced
      if (n < 4 || n + 3 * Math.max(6, Math.round(H * 0.02)) + xf >= H) continue
      // Round 10: built directly below the scene (no flip / mirror of the picture)
      const { fill, edge } = continueEdge(data, W, H, 'bottom', n, n, 11, edgeMask(avoid, W, 'bottom', s.stripShare + 0.08))
      placeFill(out, W, fill, n, 'bottom', start)
      softenJoin(out, data, W, start - 1, xf, edge, -1)
    }
  }
  const png = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality }).toBuffer()
  const after = await detectSeams(png)
  const done = seams.filter((x) => !skipped.some((k) => k.edge === x.edge))
  const note = [
    done.length ? `flat band(s) ${done.map((x) => `${x.edge} ${Math.round(x.stripShare * 100)}%`).join(', ')} continued from the scene (soft continuation + surface texture + grain)` : '',
    skipped.length ? `NOT blended (the content next to the strip is detailed, a blend would smear it): ${skipped.map((k) => `${k.edge} (detail ${Math.round(k.detail * 100)}%)`).join(', ')} — left as it is, regenerate` : '',
  ].filter(Boolean).join('; ')
  return { bytes: png, report: { applied: done.length > 0, seams, remaining: after.found, skipped, note } }
}

/** Round 8: the largest zoom the crop-and-zoom path may use (strips of up to ~14 % of the height in total). */
export const MAX_CROP_ZOOM = 1.16

export type CropZoomReport = { applied: boolean; zoom?: number; cropTopPx?: number; cropBottomPx?: number; cropLeftPx?: number; cropWidthPx?: number; note: string }
/**
 * Round 8: the flat strips are never "continued" when they can simply be CUT OFF. The picture keeps the rows between the strips and is zoomed back to the
 * original pixel size (same ratio, so a few % of the sides go too): no mirrored blur, no synthetic rows, nothing to see. Feasible when the zoom stays
 * ≤ MAX_CROP_ZOOM and every located product / object box still fits inside the cropped window (otherwise the caller falls back to the textured continuation).
 * Returns the new image and the located boxes mapped into the new picture.
 */
export async function cropZoomSeams(bytes: Buffer, seams: Seam[], keep: NB[] = [], quality = 93): Promise<{ bytes: Buffer; keep: NB[]; report: CropZoomReport }> {
  if (!seams.length) return { bytes, keep, report: { applied: false, note: 'no seams' } }
  const { data, info } = await sharp(bytes).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const safety = Math.max(3, Math.round(H * 0.006))
  const top = seams.filter((x) => x.edge === 'top').reduce((a, x) => Math.max(a, x.stripPx), 0)
  const bottom = seams.filter((x) => x.edge === 'bottom').reduce((a, x) => Math.max(a, x.stripPx), 0)
  const t = top ? top + safety : 0
  const b = bottom ? bottom + safety : 0
  const ch = H - t - b
  const zoom = H / ch
  if (ch < H * 0.6 || zoom > MAX_CROP_ZOOM) return { bytes, keep, report: { applied: false, note: `crop-and-zoom would need ${Math.round((zoom - 1) * 100)}% zoom (max ${Math.round((MAX_CROP_ZOOM - 1) * 100)}%)` } }
  const cw = Math.min(W, Math.round((ch * W) / H))
  // keep every located box inside the window horizontally (centre on them when they are off-centre) and inside the kept rows vertically
  let x0c = Math.round((W - cw) / 2)
  if (keep.length) {
    const ux0 = Math.min(...keep.map((k) => k.x0)) * W, ux1 = Math.max(...keep.map((k) => k.x1)) * W
    if (ux1 - ux0 > cw * 0.995) return { bytes, keep, report: { applied: false, note: 'the product / objects span the whole width: a crop would cut them' } }
    if (ux0 < x0c) x0c = Math.max(0, Math.floor(ux0 - cw * 0.01))
    else if (ux1 > x0c + cw) x0c = Math.min(W - cw, Math.ceil(ux1 + cw * 0.01 - cw))
    if (ux0 < x0c - 1 || ux1 > x0c + cw + 1) return { bytes, keep, report: { applied: false, note: 'the product / objects would be cut by the crop' } }
    const uy0 = Math.min(...keep.map((k) => k.y0)) * H, uy1 = Math.max(...keep.map((k) => k.y1)) * H
    if (uy0 < t - 1 || uy1 > H - b + 1) return { bytes, keep, report: { applied: false, note: 'a located object reaches into the strip: not cropped' } }
  }
  const out = await sharp(data, { raw: { width: W, height: H, channels: 3 } })
    .extract({ left: x0c, top: t, width: cw, height: ch })
    .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
    .jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer()
  const after = await detectSeams(out)
  if (after.found.length) return { bytes, keep, report: { applied: false, note: 'a strip remained after the crop' } }
  const mapped = keep.map((k) => ({ x0: Math.max(0, (k.x0 * W - x0c) / cw), x1: Math.min(1, (k.x1 * W - x0c) / cw), y0: Math.max(0, (k.y0 * H - t) / ch), y1: Math.min(1, (k.y1 * H - t) / ch) }))
  return { bytes: out, keep: mapped, report: { applied: true, zoom: Math.round(zoom * 1000) / 1000, cropTopPx: t, cropBottomPx: b, cropLeftPx: x0c, cropWidthPx: cw, note: `strip(s) cut off and the picture zoomed ${Math.round((zoom - 1) * 1000) / 10}% (top ${t}px, bottom ${b}px): no blend, nothing synthetic` } }
}

/**
 * Move the picture content UP by `dPx` rows: the vacated bottom is a texture-carrying continuation of the bottom rows, the top `dPx` rows scroll out (cropped).
 * Used when the CTA has no free slot under the product (the mirror image of shiftSceneDown).
 */
export async function shiftSceneUp(bytes: Buffer, dPx: number, quality = 93, avoid?: NB[]): Promise<Buffer> {
  const { data, info } = await sharp(bytes).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const d = Math.max(0, Math.min(Math.round(H * MAX_SHIFT), Math.round(dPx)))
  if (d < 2) return bytes
  // Round 10: continuation built below the bottom rows directly (no flip): background colour + matched synthetic texture, product columns masked
  const { fill, edge } = continueEdge(data, W, H, 'bottom', 0, d, 17, edgeMask(avoid, W, 'bottom'))
  const out = Buffer.alloc(data.length)
  data.copy(out, 0, W * d * 3, W * H * 3)
  placeFill(out, W, fill, d, 'bottom', H - d)
  softenJoin(out, Buffer.from(out), W, H - d - 1, Math.max(4, Math.round(H * 0.012)), edge, -1)
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality }).toBuffer()
}

/** Largest strip the top / bottom fill can still make from a scene (never more than half the picture). */
export const MAX_SHIFT = 0.2

/**
 * Move the picture content DOWN by `dPx` rows: the vacated top is a content-aware blur-extension of the top rows, the bottom `dPx` rows scroll out
 * (cropped). Same pixel size. Only sensible when the top of the scene is plain background.
 */
export async function shiftSceneDown(bytes: Buffer, dPx: number, quality = 93, avoid?: NB[]): Promise<Buffer> {
  const base = sharp(bytes).rotate().removeAlpha()
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const d = Math.max(0, Math.min(Math.round(H * MAX_SHIFT), Math.round(dPx)))
  if (d < 2) return bytes
  const out = Buffer.alloc(data.length)
  const { fill, edge } = continueEdge(data, W, H, 'top', 0, d, 13, edgeMask(avoid, W, 'top'))
  placeFill(out, W, fill, d, 'top', 0)
  data.copy(out, W * d * 3, 0, W * (H - d) * 3)
  softenJoin(out, Buffer.from(out), W, d, Math.max(4, Math.round(H * 0.012)), edge, 1)
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality }).toBuffer()
}

/** Free-band geometry used to place the seam zones (for reports only). */
export function bandZones(ratio: string) {
  const m = safeZoneMargins(ratio)
  return { top: m.top, bottom: m.bottom }
}

/**
 * Round 10: continue a picture sideways by `n` columns (no rotation, no mirror). Each new pixel takes the ROW's background colour — the median of the `delta`
 * columns next to the edge at that row (rows covered by a located product re-interpolated), sharp near the picture and progressively smoothed vertically
 * farther out — plus synthetic streak texture matched to the edge's grain. The table edge / wall line continues straight; nothing is copied.
 * Returns n×H RGB, column 0 touching the picture.
 */
export function continueSide(raw: Buffer, W: number, H: number, side: 'left' | 'right', n: number, seed: number, maskRows?: Uint8Array): Buffer {
  const delta = Math.max(4, Math.round(W * 0.015))
  const colAt = (j: number) => Math.min(W - 1, Math.max(0, side === 'left' ? j : W - 1 - j))
  const colour = new Float32Array(H * 3)
  const vals: number[] = []
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    vals.length = 0
    for (let j = 0; j < delta; j++) vals.push(raw[(y * W + colAt(j)) * 3 + c])
    vals.sort((a, b) => a - b)
    colour[y * 3 + c] = vals[vals.length >> 1]
  }
  if (maskRows && maskRows.some((m) => m) && !maskRows.every((m) => m)) interpolateMasked(colour, H, maskRows)
  const near = blurRow(colour, H, Math.max(1, H * 0.002))
  const far = blurRow(colour, H, Math.max(3, H * 0.02))
  // grain strength next to the edge (luma minus a ±6-column horizontal mean)
  const lumaAt = (y: number, x: number) => { const j = (y * W + x) * 3; return 0.299 * raw[j] + 0.587 * raw[j + 1] + 0.114 * raw[j + 2] }
  const hp: number[] = []
  for (let y = 0; y < H; y += 3) {
    if (maskRows?.[y]) continue
    let m = 0
    for (let t = 0; t < 13; t++) m += lumaAt(y, colAt(t))
    hp.push(Math.abs(lumaAt(y, colAt(6)) - m / 13))
  }
  hp.sort((a, b) => a - b)
  const texStd = Math.min(9, (hp[Math.floor(hp.length * 0.5)] ?? 0) * 1.4826)
  const rnd = prng(seed)
  const corr = Math.max(4, Math.round(n * 0.25))
  const out = Buffer.alloc(n * H * 3)
  let prev = new Float32Array(n)
  const rho = 0.6
  for (let y = 0; y < H; y++) {
    const f = new Float32Array(n)
    for (let x = 0; x < n; x++) f[x] = rnd() - 0.5
    const sm = blurScalar(f, n, corr)
    let s = 0
    for (let x = 0; x < n; x++) s += sm[x] * sm[x]
    const k = 1 / Math.max(1e-6, Math.sqrt(s / Math.max(1, n)))
    for (let x = 0; x < n; x++) prev[x] = y === 0 ? sm[x] * k : rho * prev[x] + Math.sqrt(1 - rho * rho) * sm[x] * k
    for (let x = 0; x < n; x++) {
      const a = Math.min(1, x / Math.max(1, n)) // 0 at the picture → 1 at the outer edge
      const t = prev[x] * texStd * (1 - 0.5 * a) + (rnd() - 0.5) * 3.4
      const i = (y * n + x) * 3
      for (let c = 0; c < 3; c++) {
        const v = near[y * 3 + c] * (1 - a) + far[y * 3 + c] * a + t
        out[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
      }
    }
  }
  return out
}

/** Rows covered by a located box that reaches within `reach` (fraction of W) of the given side. */
export function sideMask(boxes: NB[] | undefined, H: number, side: 'left' | 'right', reach = 0.06): Uint8Array | undefined {
  if (!boxes?.length) return undefined
  const m = new Uint8Array(H)
  let any = false
  for (const b of boxes) {
    if (!(side === 'left' ? b.x0 <= reach : b.x1 >= 1 - reach)) continue
    for (let y = Math.max(0, Math.floor((b.y0 - 0.01) * H)); y < Math.min(H, Math.ceil((b.y1 + 0.01) * H)); y++) m[y] = 1
    any = true
  }
  return any ? m : undefined
}

/** Smallest scale the canvas extension normally uses (the picture keeps ≥ 86 % of its size). */
export const MIN_EXTEND_SCALE = 0.86
/** Round 10: last resort for a CTA blocked by a product standing on the bottom edge (never used to make room for text). */
export const EXTEND_LAST_RESORT = 0.78

/**
 * "Extend the canvas" — the picture is scaled to `scale` (≥ 0.86) and the canvas around it continued from the scene, same pixel size. `anchorY` = share of
 * the freed height that goes above the picture. Round 10: no mirror / rotation: the sides take each row's background colour (row-average continuation), the
 * top / bottom each column's (column-average), both with matched synthetic grain; columns / rows of `avoid` boxes touching an edge are masked so no product
 * colour is carried out. Returns the bytes and the mapping of a normalised box into the new picture.
 */
export async function extendCanvas(bytes: Buffer, scale: number, anchorY = 0.3, quality = 93, avoid?: NB[]): Promise<{ bytes: Buffer; map: (b: NB) => NB; scale: number }> {
  const meta = await sharp(bytes).metadata()
  const W = meta.width!, H = meta.height!
  const s = Math.max(EXTEND_LAST_RESORT, Math.min(1, scale))
  const ws = Math.round(W * s), hs = Math.round(H * s)
  const small = await sharp(bytes).rotate().removeAlpha().resize(ws, hs, { kernel: 'lanczos3' }).raw().toBuffer()
  const top = Math.round((H - hs) * anchorY), bottom = H - hs - top
  const left = Math.floor((W - ws) / 2), right = W - ws - left
  // 1. sides on the scaled picture (rows hs)
  const mid = Buffer.alloc(W * hs * 3)
  const L = left > 0 ? continueSide(small, ws, hs, 'left', left, 31, sideMask(avoid, hs, 'left')) : null
  const R = right > 0 ? continueSide(small, ws, hs, 'right', right, 37, sideMask(avoid, hs, 'right')) : null
  for (let y = 0; y < hs; y++) {
    small.copy(mid, (y * W + left) * 3, y * ws * 3, (y + 1) * ws * 3)
    if (L) for (let x = 0; x < left; x++) { const si = (y * left + x) * 3, di = (y * W + (left - 1 - x)) * 3; mid[di] = L[si]; mid[di + 1] = L[si + 1]; mid[di + 2] = L[si + 2] }
    if (R) for (let x = 0; x < right; x++) { const si = (y * right + x) * 3, di = (y * W + left + ws + x) * 3; mid[di] = R[si]; mid[di + 1] = R[si + 1]; mid[di + 2] = R[si + 2] }
    // soft join: the outer picture columns fade into the continuation's first column (no vertical step at the picture edge)
    const xfs = Math.max(3, Math.round(ws * 0.012))
    for (let t = 0; t < xfs; t++) {
      const a = (t + 1) / (xfs + 1)
      if (L) { const si = (y * left) * 3, di = (y * W + left + t) * 3; for (let c = 0; c < 3; c++) mid[di + c] = Math.round(L[si + c] * (1 - a) + mid[di + c] * a) }
      if (R) { const si = (y * right) * 3, di = (y * W + left + ws - 1 - t) * 3; for (let c = 0; c < 3; c++) mid[di + c] = Math.round(R[si + c] * (1 - a) + mid[di + c] * a) }
    }
  }
  // 2. top / bottom over the full width (corners come from the side columns)
  const midAvoid = avoid?.map((b) => ({ x0: (left + b.x0 * ws) / W, x1: (left + b.x1 * ws) / W, y0: b.y0, y1: b.y1 }))
  const out = Buffer.alloc(W * H * 3)
  mid.copy(out, W * top * 3)
  const xf = Math.max(4, Math.round(H * 0.012))
  if (top > 0) {
    const { fill, edge } = continueEdge(mid, W, hs, 'top', 0, top, 23, edgeMask(midAvoid, W, 'top'))
    placeFill(out, W, fill, top, 'top', 0)
    softenJoin(out, Buffer.from(out), W, top, Math.min(xf, hs >> 3), edge, 1)
  }
  if (bottom > 0) {
    const { fill, edge } = continueEdge(mid, W, hs, 'bottom', 0, bottom, 27, edgeMask(midAvoid, W, 'bottom'))
    placeFill(out, W, fill, bottom, 'bottom', top + hs)
    softenJoin(out, Buffer.from(out), W, top + hs - 1, Math.min(xf, hs >> 3), edge, -1)
  }
  const jpg = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality }).toBuffer()
  const map = (b: NB): NB => ({ x0: (left + b.x0 * ws) / W, x1: (left + b.x1 * ws) / W, y0: (top + b.y0 * hs) / H, y1: (top + b.y1 * hs) / H })
  return { bytes: jpg, map, scale: s }
}
