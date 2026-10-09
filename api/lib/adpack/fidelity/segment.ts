/**
 * Product fidelity — real product photo → transparent cut-out (exact mode, A1/H3).
 *
 * Strategy chain; the first result that passes the quality checks wins:
 *   a) alpha     the asset already is a PNG/WebP with meaningful transparency → used as is;
 *   b) flood     clean / uniform backgrounds: edge-connected flood fill from the borders in
 *                Lab space (global + local tolerance), morphological cleanup, dominant
 *                component, feathered edge and background decontamination (sharp raw buffers);
 *   c) model     gateway.segment (Gemini 2.5 Flash segmentation: box_2d 0–1000 + mask PNG,
 *                thresholded at 127) when injected;
 *   d) failure   `cutout_failed` with the reasons. Exact mode never falls back to a
 *                model-redrawn product.
 *
 * Quality checks: foreground 5–90% of the frame, one dominant component (kit-contents photos
 * may hold several), not touching all four borders.
 *
 * Recall (P0 #4): the flood / model masks are compared with an independent foreground estimate of
 * the source (recall.ts: components, area, color coverage). Flat lays (role 'contents' or ≥ 3
 * separated objects on a uniform background) keep every piece: near-white pieces the flood took
 * for background are added back from the estimate. Recall < 95% → the model path is tried; still
 * below → `cutout_incomplete` (never delivered). Owner cut-outs (alpha) are used as-is.
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { ModelGateway, ProductPhotoRole, SegmentationItem } from '../types.js'
import { borderBackground, bordersTouched, components, deltaE, dilate, erode, labImage } from './pixels.js'
import { BACKGROUND_LEAK_MAX, backgroundLeakShare } from './score.js'
import { addMissedObjects, cutoutRecall, estimateForeground, isFlatLayEstimate, MIN_CUTOUT_RECALL, type CutoutRecall, type ForegroundEstimate } from './recall.js'

export type CutoutMethod = 'alpha' | 'flood' | 'model'

export interface CutoutOk {
  ok: true
  /** Trimmed RGBA PNG. */
  png: Buffer
  width: number
  height: number
  method: CutoutMethod
  /** Foreground share of the source frame (0–1). */
  coverage: number
  sourceHash: string
  /** Strategies tried before this one and why they were rejected. */
  rejected: string[]
  /** Recall vs the source photo's foreground (absent for owner cut-outs / unmeasurable photos). */
  recall?: CutoutRecall
  /** Top-down kit layout (role 'contents' or ≥ 3 separated objects): overhead plate, no perspective. */
  flatLay?: boolean
  /** Share of the cut-out that is still the source photo's backdrop / its shadow (round 1, P2). */
  backgroundLeak?: number
}

export interface CutoutFailed {
  ok: false
  /** cutout_incomplete = a mask was found but it dropped pieces of the product (recall < 95%). */
  reason: 'cutout_failed' | 'cutout_incomplete'
  detail: string
  sourceHash: string
  rejected: string[]
  recall?: CutoutRecall
}

export type CutoutResult = CutoutOk | CutoutFailed

export interface SegmentProductInput {
  bytes: Uint8Array
  role?: ProductPhotoRole
  /** Owner label of the product / part, used in the model prompt. */
  label?: string
  gateway?: Pick<ModelGateway, 'segment'>
  /** Long-side cap of the produced cut-out (px). */
  maxSide?: number
  /** Disable strategy (c) even when the gateway supports it. */
  noModel?: boolean
}

export const CUTOUT_MIN_COVERAGE = 0.05
export const CUTOUT_MAX_COVERAGE = 0.9
/** Largest component / all foreground. */
export const CUTOUT_MIN_DOMINANCE = 0.75
const WORK_SIDE = 1024
/** Strict flood retry (round 1): backdrop ΔE and neighbor continuity caps. */
export const STRICT_FLOOD_TOLERANCE = 5
export const STRICT_FLOOD_LOCAL = 3.5
const DEFAULT_MAX_SIDE = 2048

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface Raw {
  data: Buffer
  w: number
  h: number
  channels: number
}

async function rawRgba(bytes: Uint8Array | Buffer, maxSide: number): Promise<Raw> {
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height, channels: info.channels }
}

/** Validate a 0/1 mask. Returns null when OK, else the reason. */
export function validateMask(mask: Uint8Array, w: number, h: number, opts: { allowMulti?: boolean; requireBackground?: boolean } = {}): string | null {
  let area = 0
  for (let i = 0; i < mask.length; i++) area += mask[i]
  const coverage = area / (w * h)
  if (coverage < CUTOUT_MIN_COVERAGE) return `foreground ${(coverage * 100).toFixed(1)}% < ${CUTOUT_MIN_COVERAGE * 100}%`
  if (opts.requireBackground !== false && coverage > CUTOUT_MAX_COVERAGE) return `foreground ${(coverage * 100).toFixed(1)}% > ${CUTOUT_MAX_COVERAGE * 100}%`
  const { list } = components(mask, w, h)
  const dominance = list.length ? list[0].area / area : 0
  if (!opts.allowMulti && dominance < CUTOUT_MIN_DOMINANCE) return `no single dominant object (largest ${(dominance * 100).toFixed(0)}% of foreground)`
  if (opts.requireBackground !== false && bordersTouched(mask, w, h).count === 4) return 'foreground touches all four borders'
  return null
}

/** Drop specks: keep components ≥ 0.5% of the largest when multi (small kit pieces), ≥ 15% otherwise. */
function keepMain(mask: Uint8Array, w: number, h: number, allowMulti: boolean): Uint8Array {
  const { labels, list } = components(mask, w, h)
  if (!list.length) return mask
  const keep = new Set<number>()
  const minMulti = Math.max(24, list[0].area * 0.005)
  for (const c of list) {
    if (c === list[0] || (allowMulti ? c.area >= minMulti : c.area >= list[0].area * 0.15)) keep.add(c.label)
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = keep.has(labels[i]) ? 1 : 0
  return out
}

/** Fill background holes that are fully enclosed AND tiny (≤ 0.2% of the frame) — specular / noise holes. */
function fillSmallHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1
  const { labels, list } = components(inv, w, h)
  const small = new Set(list.filter((c) => c.area <= w * h * 0.002 && c.x0 > 0 && c.y0 > 0 && c.x1 < w - 1 && c.y1 < h - 1).map((c) => c.label))
  if (!small.size) return mask
  const out = mask.slice()
  for (let i = 0; i < out.length; i++) if (small.has(labels[i])) out[i] = 1
  return out
}

/** Full-resolution RGBA cut-out from a work-resolution mask: upscale + feather + decontaminate + trim. */
async function buildCutout(full: Raw, mask: Uint8Array, mw: number, mh: number, bgRgb: [number, number, number] | null): Promise<{ png: Buffer; width: number; height: number }> {
  const maskPng = await sharp(Buffer.from(mask.map((v) => (v ? 255 : 0))), { raw: { width: mw, height: mh, channels: 1 } })
    .resize(full.w, full.h, { kernel: 'linear', fit: 'fill' })
    .blur(Math.max(0.5, Math.min(1.6, full.w / 1400)))
    .extractChannel(0)
    .raw()
    .toBuffer()
  const out = Buffer.alloc(full.w * full.h * 4)
  for (let i = 0; i < full.w * full.h; i++) {
    let a = maskPng[i]
    // Hard-edge cleanup: near-zero → 0, near-full → 255 (keeps the interior pixels exact).
    if (a < 10) a = 0
    else if (a > 245) a = 255
    let r = full.data[i * full.channels]
    let g = full.data[i * full.channels + 1]
    let b = full.data[i * full.channels + 2]
    const srcA = full.channels === 4 ? full.data[i * 4 + 3] : 255
    if (bgRgb && a > 0 && a < 255) {
      // Remove the background color bleeding into semi-transparent edge pixels.
      const f = a / 255
      r = Math.max(0, Math.min(255, Math.round((r - (1 - f) * bgRgb[0]) / f)))
      g = Math.max(0, Math.min(255, Math.round((g - (1 - f) * bgRgb[1]) / f)))
      b = Math.max(0, Math.min(255, Math.round((b - (1 - f) * bgRgb[2]) / f)))
    }
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = Math.round((a * srcA) / 255)
  }
  return trimRgba(out, full.w, full.h)
}

/** Trim fully transparent borders (keeps a 2px margin). */
export async function trimRgba(rgba: Buffer, w: number, h: number): Promise<{ png: Buffer; width: number; height: number }> {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) throw new Error('empty cut-out')
  const pad = 2
  const left = Math.max(0, x0 - pad)
  const top = Math.max(0, y0 - pad)
  const width = Math.min(w, x1 + pad + 1) - left
  const height = Math.min(h, y1 + pad + 1) - top
  const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).extract({ left, top, width, height }).png().toBuffer()
  return { png, width, height }
}

// ---------------------------------------------------------------------------
// (a) alpha passthrough
// ---------------------------------------------------------------------------

/** Share of transparent (< 128) pixels; null when the image has no alpha channel. */
export async function transparentShare(bytes: Uint8Array): Promise<number | null> {
  const meta = await sharp(bytes).metadata()
  if (!meta.hasAlpha) return null
  const { data, info } = await sharp(bytes).ensureAlpha().resize(256, 256, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
  let t = 0
  const n = info.width * info.height
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) t++
  return t / n
}

async function tryAlpha(bytes: Uint8Array, maxSide: number): Promise<CutoutOk | string> {
  const share = await transparentShare(bytes)
  if (share === null) return 'no alpha channel'
  if (share < 0.01) return `alpha present but ${(share * 100).toFixed(1)}% transparent`
  if (share > 0.95) return 'alpha image is almost empty'
  const full = await rawRgba(bytes, maxSide)
  const mask = new Uint8Array(full.w * full.h)
  for (let i = 0; i < mask.length; i++) mask[i] = full.data[i * 4 + 3] >= 128 ? 1 : 0
  // A tight cut-out may touch every border and fill most of its frame: only area + dominance matter.
  const why = validateMask(mask, full.w, full.h, { allowMulti: true, requireBackground: false })
  if (why) return why
  const trimmed = await trimRgba(full.data, full.w, full.h)
  return { ok: true, ...trimmed, method: 'alpha', coverage: 1 - share, sourceHash: '', rejected: [] }
}

// ---------------------------------------------------------------------------
// (b) deterministic flood fill on clean backgrounds
// ---------------------------------------------------------------------------

export interface FloodOptions {
  /** Max ΔE from the border background color for a pixel to count as background. */
  tolerance?: number
  /** Max ΔE between neighbors while flooding (local continuity, handles gradients). */
  localTolerance?: number
  allowMulti?: boolean
}

/** Background mask (1 = background) by flooding from the borders; null when the border is not uniform. */
export function floodBackground(lab: Float32Array, w: number, h: number, opts: FloodOptions = {}): { bg: Uint8Array; bgLab: [number, number, number]; tol: number; local: number } | string {
  const border = borderBackground(lab, w, h, 10)
  if (border.uniformity < 0.6) return `background not uniform (${Math.round(border.uniformity * 100)}% of the border matches)`
  const tol = opts.tolerance ?? Math.min(24, Math.max(10, border.spread * 2.5 + 6))
  const local = opts.localTolerance ?? 7
  const [L, A, B] = border.lab
  const bg = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const seed = (i: number) => {
    if (!bg[i] && deltaE(lab, i, L, A, B) <= tol) {
      bg[i] = 1
      stack[sp++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x)
    seed((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  const visit = (from: number, to: number) => {
    if (bg[to]) return
    if (deltaE(lab, to, L, A, B) > tol) return
    if (deltaE(lab, to, lab[from * 3], lab[from * 3 + 1], lab[from * 3 + 2]) > local) return
    bg[to] = 1
    stack[sp++] = to
  }
  while (sp) {
    const i = stack[--sp]
    const x = i % w
    if (x > 0) visit(i, i - 1)
    if (x < w - 1) visit(i, i + 1)
    if (i >= w) visit(i, i - w)
    if (i < w * (h - 1)) visit(i, i + w)
  }
  return { bg, bgLab: border.lab, tol, local }
}

/** Trapped background (round-1 halo): min area of an enclosed background pocket that is removed (share of the frame). */
export const TRAPPED_BG_MIN_AREA = 0.0003
/** Soft shadow: same hue as the backdrop (|Δa| / |Δb| caps), darker, reached through a smooth gradient only. */
const SHADOW_MAX_DA = 2.5
const SHADOW_MAX_DB = 1.8
const SHADOW_MAX_DARKEN = 50
const SHADOW_LOCAL = 3.5

/**
 * Remove background the edge flood could not reach (round 1, Prototipo plane "halo"):
 *  1. enclosed pockets — regions inside the silhouette that match the backdrop with the SAME rules as
 *     the edge flood (|ΔE| ≤ tol from the backdrop, ≤ local between neighbors) and cover ≥ 0.03% of
 *     the frame with a mean ΔE ≤ tol/2 (smaller / off-color ones stay: specular / noise holes);
 *  2. soft shadows — grown from the background into pixels with the backdrop's hue (Δa ≤ 2.5,
 *     Δb ≤ 1.8), darker (≤ 50 L) and reached through a smooth gradient (≤ 3.5 ΔE per step). A hard
 *     product edge (paper, black frame, grey propeller with a different hue) stops it.
 * Returns the new foreground mask (1 = product) and the removed share of the frame.
 */
export function removeTrappedBackground(
  lab: Float32Array,
  w: number,
  h: number,
  fgIn: Uint8Array,
  bgLab: [number, number, number],
  tol: number,
  local = 7,
): { fg: Uint8Array; removedPockets: number; removedShadow: number } {
  const n = w * h
  const fg = fgIn.slice()
  const [L0, A0, B0] = bgLab
  // 1) Enclosed pockets with the flood's own rules.
  const pocket = new Uint8Array(n)
  const stack = new Int32Array(n)
  const seen = new Uint8Array(n)
  let removedPockets = 0
  for (let s = 0; s < n; s++) {
    if (!fg[s] || seen[s] || deltaE(lab, s, L0, A0, B0) > tol) continue
    let sp = 0
    const members: number[] = []
    let sumDe = 0
    seen[s] = 1
    stack[sp++] = s
    while (sp) {
      const i = stack[--sp]
      members.push(i)
      sumDe += deltaE(lab, i, L0, A0, B0)
      const x = i % w
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]
      for (const j of nb) {
        if (j < 0 || seen[j] || !fg[j]) continue
        if (deltaE(lab, j, L0, A0, B0) > tol) continue
        if (deltaE(lab, j, lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]) > local) continue
        seen[j] = 1
        stack[sp++] = j
      }
    }
    // Mean ΔE ≤ tol/2: a real backdrop pocket sits at the backdrop color, a bright product panel
    // (white paper next to an off-white wall) only grazes the tolerance.
    if (members.length >= n * TRAPPED_BG_MIN_AREA && sumDe / members.length <= tol / 2) {
      for (const i of members) pocket[i] = 1
      removedPockets += members.length
    }
  }
  for (let i = 0; i < n; i++) if (pocket[i]) fg[i] = 0
  // 2) Soft shadows grown from every background pixel bordering the silhouette.
  const isShadow = (j: number) => {
    const L = lab[j * 3]
    return L <= L0 + tol / 2 && L >= L0 - SHADOW_MAX_DARKEN && Math.abs(lab[j * 3 + 1] - A0) <= SHADOW_MAX_DA && Math.abs(lab[j * 3 + 2] - B0) <= SHADOW_MAX_DB
  }
  const nbOf = (i: number) => {
    const x = i % w
    return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]
  }
  const smooth = (i: number, j: number) => deltaE(lab, j, lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]) <= SHADOW_LOCAL
  let sp = 0
  for (let i = 0; i < n; i++) {
    if (fg[i]) continue
    if (nbOf(i).some((j) => j >= 0 && fg[j])) stack[sp++] = i
  }
  let removedShadow = 0
  while (sp) {
    const i = stack[--sp]
    for (const j of nbOf(i)) {
      if (j < 0 || !fg[j] || !isShadow(j) || !smooth(i, j)) continue
      fg[j] = 0
      removedShadow++
      stack[sp++] = j
    }
  }
  // 3) Enclosed shaded pockets (e.g. the gradient trapped between landing-gear legs): seeded only by
  //    pixels at the backdrop's own color (|ΔL| ≤ tol/2 + backdrop hue), grown through the shadow
  //    rule, removed when the pocket covers ≥ 0.03% of the frame.
  seen.fill(0)
  for (let s = 0; s < n; s++) {
    if (!fg[s] || seen[s] || !isShadow(s) || Math.abs(lab[s * 3] - L0) > tol / 2) continue
    let sp2 = 0
    const members: number[] = []
    seen[s] = 1
    stack[sp2++] = s
    while (sp2) {
      const i = stack[--sp2]
      members.push(i)
      for (const j of nbOf(i)) {
        if (j < 0 || seen[j] || !fg[j] || !isShadow(j) || !smooth(i, j)) continue
        seen[j] = 1
        stack[sp2++] = j
      }
    }
    if (members.length >= n * TRAPPED_BG_MIN_AREA) {
      for (const i of members) fg[i] = 0
      removedShadow += members.length
    }
  }
  return { fg, removedPockets: removedPockets / n, removedShadow: removedShadow / n }
}

function labToRgbApprox(raw: Raw, bg: Uint8Array): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < bg.length; i += 3) {
    if (!bg[i]) continue
    r += raw.data[i * raw.channels]
    g += raw.data[i * raw.channels + 1]
    b += raw.data[i * raw.channels + 2]
    n++
  }
  return n ? [r / n, g / n, b / n] : [255, 255, 255]
}

/** Work-resolution view of a photo shared by the strategies (one decode, one Lab conversion). */
interface WorkImage {
  raw: Raw
  lab: Float32Array
  /** Border flood with the default options (null when the border is not uniform). */
  flood: { bg: Uint8Array; bgLab: [number, number, number]; tol: number; local: number } | null
  /** Independent foreground estimate (recall reference); null when not measurable. */
  est: ForegroundEstimate | null
}

async function workImage(bytes: Uint8Array): Promise<WorkImage> {
  const raw = await rawRgba(bytes, WORK_SIDE)
  const lab = labImage(raw.data, raw.channels, raw.w * raw.h)
  const flood = floodBackground(lab, raw.w, raw.h)
  const est = typeof flood === 'string' ? null : estimateForeground(lab, raw.w, raw.h, flood.bg)
  return { raw, lab, flood: typeof flood === 'string' ? null : flood, est }
}

type Attempt = { cut: CutoutOk; mask: Uint8Array } | string

async function tryFlood(bytes: Uint8Array, maxSide: number, opts: FloodOptions, wi?: WorkImage): Promise<Attempt> {
  const work = wi?.raw ?? (await rawRgba(bytes, WORK_SIDE))
  const n = work.w * work.h
  const lab = wi?.lab ?? labImage(work.data, work.channels, n)
  const flood = floodBackground(lab, work.w, work.h, opts)
  if (typeof flood === 'string') return flood
  let fg: Uint8Array = new Uint8Array(n)
  for (let i = 0; i < n; i++) fg[i] = flood.bg[i] ? 0 : 1
  // Round 1: enclosed backdrop pockets + soft floor shadows the edge flood could not reach.
  // Flat lays keep their pieces' gaps (pockets between pieces are already edge-connected or tiny).
  if (!opts.allowMulti) fg = removeTrappedBackground(lab, work.w, work.h, fg, flood.bgLab, flood.tol, flood.local).fg
  // Open (remove specks / noise), close (seal 1–2 px gaps along the silhouette).
  fg = dilate(erode(fg, work.w, work.h, 1), work.w, work.h, 1)
  fg = erode(dilate(fg, work.w, work.h, 2), work.w, work.h, 2)
  fg = fillSmallHoles(fg, work.w, work.h)
  fg = keepMain(fg, work.w, work.h, opts.allowMulti === true)
  // Flat lays: near-white pieces on a light surface fall under the flood's tolerance — the
  // stricter, model-relative estimate brings every missed piece back (P0 #4).
  if (opts.allowMulti && wi?.est) fg = addMissedObjects(wi.est, fg)
  const why = validateMask(fg, work.w, work.h, { allowMulti: opts.allowMulti })
  if (why) return why
  // Round 1 (P2): backdrop baked into the cut-out is a failure (next strategy), never a "product".
  const leak = opts.allowMulti ? 0 : backgroundLeakShare(lab, fg, work.w, work.h, flood.bgLab)
  if (leak > BACKGROUND_LEAK_MAX) return `background left in cutout ${(leak * 100).toFixed(1)}% > ${BACKGROUND_LEAK_MAX * 100}%`
  let area = 0
  for (let i = 0; i < n; i++) area += fg[i]
  const bgMask = new Uint8Array(n)
  for (let i = 0; i < n; i++) bgMask[i] = fg[i] ? 0 : 1
  const bgRgb = labToRgbApprox(work, bgMask)
  const full = await rawRgba(bytes, maxSide)
  const cut = await buildCutout(full, fg, work.w, work.h, bgRgb)
  return { cut: { ok: true, ...cut, method: 'flood', coverage: area / n, sourceHash: '', rejected: [], ...(opts.allowMulti ? {} : { backgroundLeak: leak }) }, mask: fg }
}

// ---------------------------------------------------------------------------
// (c) model segmentation (gateway.segment)
// ---------------------------------------------------------------------------

export function buildSegmentationPrompt(label?: string, role?: ProductPhotoRole): string {
  const what = label?.trim() ? `the product "${label.trim().slice(0, 80)}"` : 'the main product being sold'
  const multi = role === 'contents' ? ' Include every item of the kit laid out in the photo as separate entries.' : ' Include all of its attached parts as one object; exclude hands, people, tables, shadows and background.'
  return (
    `Give the segmentation mask for ${what}.${multi} ` +
    'Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", ' +
    'the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels.'
  )
}

/** Rasterize documented Gemini items into one full-frame 0/1 mask at w×h. */
export async function masksToFrame(items: SegmentationItem[], w: number, h: number): Promise<Uint8Array> {
  const frame = new Uint8Array(w * h)
  for (const item of items) {
    const box = item?.box_2d
    if (!Array.isArray(box) || box.length !== 4 || typeof item.mask !== 'string') continue
    const [y0n, x0n, y1n, x1n] = box.map((v) => Math.max(0, Math.min(1000, Number(v))))
    const x0 = Math.floor((x0n / 1000) * w)
    const y0 = Math.floor((y0n / 1000) * h)
    const x1 = Math.ceil((x1n / 1000) * w)
    const y1 = Math.ceil((y1n / 1000) * h)
    const bw = x1 - x0
    const bh = y1 - y0
    if (bw < 2 || bh < 2) continue
    const b64 = item.mask.replace(/^data:image\/png;base64,/, '')
    let probs: Buffer
    try {
      probs = await sharp(Buffer.from(b64, 'base64')).greyscale().resize(bw, bh, { fit: 'fill', kernel: 'linear' }).extractChannel(0).raw().toBuffer()
    } catch {
      continue
    }
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (probs[y * bw + x] > 127) frame[(y0 + y) * w + x0 + x] = 1
      }
    }
  }
  return frame
}

async function tryModel(bytes: Uint8Array, maxSide: number, input: SegmentProductInput, multi?: boolean, wi?: WorkImage): Promise<Attempt> {
  const gw = input.gateway
  if (!gw?.segment || input.noModel) return 'model segmentation unavailable'
  const work = wi?.raw ?? (await rawRgba(bytes, WORK_SIDE))
  const dataUrl = `data:image/png;base64,${(await sharp(work.data, { raw: { width: work.w, height: work.h, channels: work.channels as 4 } }).png().toBuffer()).toString('base64')}`
  let items: SegmentationItem[]
  try {
    items = (await gw.segment({ image: dataUrl, prompt: buildSegmentationPrompt(input.label, multi ? 'contents' : input.role) })).items ?? []
  } catch (error) {
    return `model segmentation failed: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!items.length) return 'model returned no mask'
  let fg: Uint8Array = await masksToFrame(items, work.w, work.h)
  fg = erode(dilate(fg, work.w, work.h, 1), work.w, work.h, 1)
  const allowMulti = multi ?? input.role === 'contents'
  fg = keepMain(fg, work.w, work.h, allowMulti)
  const why = validateMask(fg, work.w, work.h, { allowMulti })
  if (why) return why
  let leak: number | undefined
  if (!allowMulti) {
    const lab = wi?.lab ?? labImage(work.data, work.channels, work.w * work.h)
    // Only a photo with a real backdrop (flood found one, or a mostly uniform border) has one to leak.
    const border = wi?.flood ? null : borderBackground(lab, work.w, work.h, 10)
    const backdrop = wi?.flood?.bgLab ?? (border && border.uniformity >= 0.6 ? border.lab : null)
    if (backdrop) {
      leak = backgroundLeakShare(lab, fg, work.w, work.h, backdrop)
      if (leak > BACKGROUND_LEAK_MAX) return `background left in cutout ${(leak * 100).toFixed(1)}% > ${BACKGROUND_LEAK_MAX * 100}%`
    }
  }
  let area = 0
  for (let i = 0; i < fg.length; i++) area += fg[i]
  const full = await rawRgba(bytes, maxSide)
  const cut = await buildCutout(full, fg, work.w, work.h, null)
  return { cut: { ok: true, ...cut, method: 'model', coverage: area / fg.length, sourceHash: '', rejected: [], ...(leak !== undefined ? { backgroundLeak: leak } : {}) }, mask: fg }
}

/** Segment one real product photo. Never throws for image content problems (returns cutout_failed). */
export async function segmentProduct(input: SegmentProductInput): Promise<CutoutResult> {
  const bytes = input.bytes
  const sourceHash = sha256Hex(bytes)
  const maxSide = input.maxSide ?? DEFAULT_MAX_SIDE
  const rejected: string[] = []
  // (a) An owner-provided cut-out / per-part mask (transparent PNG) is used as-is.
  try {
    const alpha = await tryAlpha(bytes, maxSide)
    if (typeof alpha !== 'string') return { ...alpha, sourceHash, rejected, ...(input.role === 'contents' ? { flatLay: true } : {}) }
    rejected.push(`alpha: ${alpha}`)
  } catch (error) {
    rejected.push(`alpha: error: ${error instanceof Error ? error.message : String(error)}`)
  }
  let wi: WorkImage | undefined
  try {
    wi = await workImage(bytes)
  } catch {
    wi = undefined
  }
  // Flat lay: kit contents laid out top-down (role or ≥ 3 separated objects on a clean surface).
  const flatLay = input.role === 'contents' || isFlatLayEstimate(wi?.est ?? null)
  const allowMulti = flatLay
  // Single products only count objects around the product (a prop elsewhere is not the product).
  const measure = (mask: Uint8Array): CutoutRecall | undefined => (wi?.est ? cutoutRecall(wi.est, mask, { scopeToMain: !allowMulti }) : undefined)
  let incomplete: { recall: CutoutRecall; method: CutoutMethod } | null = null
  // Round 1: a strict flood (ΔE ≤ 5, ≤ 3.5 between neighbors) is retried for single products when the
  // default one fails — near-white paper on an off-white wall (Prototipo side photo) leaks into the
  // default tolerance and splits the product ("largest 61% of foreground").
  const steps: Array<[string, CutoutMethod, () => Promise<Attempt>]> = [
    ['flood', 'flood', () => tryFlood(bytes, maxSide, { allowMulti }, wi)],
    ...(allowMulti ? [] : [['flood-strict', 'flood', () => tryFlood(bytes, maxSide, { allowMulti, tolerance: STRICT_FLOOD_TOLERANCE, localTolerance: STRICT_FLOOD_LOCAL })] as [string, CutoutMethod, () => Promise<Attempt>]]),
    ['model', 'model', () => tryModel(bytes, maxSide, input, allowMulti, wi)],
  ]
  for (const [name, method, run] of steps) {
    let res: Attempt
    try {
      res = await run()
    } catch (error) {
      res = `error: ${error instanceof Error ? error.message : String(error)}`
    }
    if (typeof res === 'string') {
      rejected.push(`${name}: ${res}`)
      continue
    }
    const recall = measure(res.mask)
    if (recall && recall.recall < MIN_CUTOUT_RECALL) {
      // Pieces of the product were dropped: try the next strategy (model), never deliver it.
      rejected.push(`${name}: recall ${recall.recall} < ${MIN_CUTOUT_RECALL} (${recall.components.kept}/${recall.components.source} pieces, area ${recall.areaRecall}, color ${recall.colorCoverage})`)
      if (!incomplete || recall.recall > incomplete.recall.recall) incomplete = { recall, method }
      continue
    }
    return { ...res.cut, sourceHash, rejected, ...(recall ? { recall } : {}), ...(flatLay ? { flatLay: true } : {}) }
  }
  if (incomplete) {
    return { ok: false, reason: 'cutout_incomplete', detail: rejected.join('; ').slice(0, 400), sourceHash, rejected, recall: incomplete.recall }
  }
  return { ok: false, reason: 'cutout_failed', detail: rejected.join('; ').slice(0, 400), sourceHash, rejected }
}
