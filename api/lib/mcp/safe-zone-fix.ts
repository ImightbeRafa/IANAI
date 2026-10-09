/**
 * Deterministic safe-zone enforcement for the MCP image path (free, local, sharp only — no model call, no extra charge).
 *
 * Grok ignores "keep the logo / CTA out of the top & bottom 8%". When the QA finds a violation we FIX it in code:
 *   1. (optional) a logo clipped by the top edge is replaced by the REAL brand logo, composited whole;
 *   2. the whole picture is scaled down uniformly and centred on a canvas of the EXACT same pixel size, and the
 *      band that appears above / below is filled with the picture's own edge colours (per-column, with the logo plate /
 *      CTA button columns replaced by the surrounding background) — no outpaint, no product or text distortion;
 *   3. the result is re-checked with the same QA; if it still violates, the picture is scaled down a bit more (≤ 4 tries).
 * Output ratio is always identical to the input (same width × height).
 */
import sharp from 'sharp'
import { components } from '../adpack/fidelity/pixels.js'
import { checkSafeZones, type SafeZoneIssue } from './image-postcheck.js'
import { safeZoneMargins } from './safe-zones.js'

export type SafeZoneFix = {
  applied: boolean
  /** Uniform scale applied to the picture inside the canvas (1 = untouched). */
  scale: number
  padTop: number
  padBottom: number
  attempts: number
  /** The real brand logo was composited over a clipped one. */
  logoRestored: boolean
  /** Issues found before the fix. */
  before: SafeZoneIssue[]
  /** Issues left after the fix (empty = verified clean). */
  after: SafeZoneIssue[]
  note: string
}

export type SafeZoneFixResult = { bytes: Buffer; fix: SafeZoneFix }

type RGB = [number, number, number]
const EPS = 0.012
const SHRINK = [1, 0.94, 0.88, 0.8]

const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Per-column colour line of an edge strip with the columns that differ from the background removed (logo plate / button). */
function cleanLine(strip: Float64Array, w: number): RGB[] {
  const col = (x: number): RGB => [strip[x * 3], strip[x * 3 + 1], strip[x * 3 + 2]]
  const edge = Math.max(2, Math.round(w * 0.025))
  const avg = (x0: number, x1: number): RGB => {
    const o: RGB = [0, 0, 0]
    for (let x = x0; x < x1; x++) { const c = col(x); o[0] += c[0]; o[1] += c[1]; o[2] += c[2] }
    const n = Math.max(1, x1 - x0)
    return [o[0] / n, o[1] / n, o[2] / n]
  }
  const left = avg(0, edge)
  const right = avg(w - edge, w)
  const flagged = new Uint8Array(w)
  const line: RGB[] = []
  for (let x = 0; x < w; x++) {
    const t = w > 1 ? x / (w - 1) : 0
    line.push([left[0] + (right[0] - left[0]) * t, left[1] + (right[1] - left[1]) * t, left[2] + (right[2] - left[2]) * t])
    if (dist(col(x), line[x]) > 38) flagged[x] = 1
  }
  // dilate the flagged columns (anti-aliased borders), then rebuild: kept columns are the real edge colours.
  const grow = Math.max(2, Math.round(w * 0.012))
  const dil = new Uint8Array(w)
  for (let x = 0; x < w; x++) if (flagged[x]) for (let k = Math.max(0, x - grow); k <= Math.min(w - 1, x + grow); k++) dil[k] = 1
  // Background estimate under a flagged run: interpolate between the nearest kept columns on each side.
  const out: RGB[] = []
  for (let x = 0; x < w; x++) {
    if (!dil[x]) { out.push(col(x)); continue }
    let a = x
    while (a > 0 && dil[a]) a--
    let b = x
    while (b < w - 1 && dil[b]) b++
    const ca = dil[a] ? line[x] : col(a)
    const cb = dil[b] ? line[x] : col(b)
    const t = b === a ? 0 : (x - a) / (b - a)
    out.push([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t])
  }
  // light smoothing so the rebuilt line has no steps
  const sm: RGB[] = []
  const r = Math.max(1, Math.round(w * 0.02))
  for (let x = 0; x < w; x++) {
    const o: RGB = [0, 0, 0]
    let n = 0
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { o[0] += out[k][0]; o[1] += out[k][1]; o[2] += out[k][2]; n++ }
    sm.push([o[0] / n, o[1] / n, o[2] / n])
  }
  return sm
}

function rowsMean(data: Buffer, w: number, h: number, y0: number, y1: number): Float64Array {
  const strip = new Float64Array(w * 3)
  const n = Math.max(1, y1 - y0)
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) strip[x * 3 + c] += data[(y * w + x) * 3 + c] / n
  return strip
}

type LogoBox = { x0: number; y0: number; x1: number; y1: number }

/** The clipped logo plate: a compact foreground blob touching the top edge (≤ 55 % wide, ≤ 18 % tall). In pixels of `raw`. */
function findTopLogo(raw: Buffer, w: number, h: number): LogoBox | null {
  const rowsN = Math.round(h * 0.26)
  const edge = Math.max(2, Math.round(w * 0.02))
  const fg = new Uint8Array(w * rowsN)
  for (let y = 0; y < rowsN; y++) {
    const l: RGB = [0, 0, 0]
    const r: RGB = [0, 0, 0]
    for (let x = 0; x < edge; x++) for (let c = 0; c < 3; c++) { l[c] += raw[(y * w + x) * 3 + c] / edge; r[c] += raw[(y * w + w - 1 - x) * 3 + c] / edge }
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1)
      const bg: RGB = [l[0] + (r[0] - l[0]) * t, l[1] + (r[1] - l[1]) * t, l[2] + (r[2] - l[2]) * t]
      if (dist([raw[(y * w + x) * 3], raw[(y * w + x) * 3 + 1], raw[(y * w + x) * 3 + 2]], bg) > 55) fg[y * w + x] = 1
    }
  }
  // dilate so plate border + icon + wordmark join into one blob
  const d = Math.max(2, Math.round(w * 0.012))
  const dil = new Uint8Array(w * rowsN)
  for (let y = 0; y < rowsN; y++) for (let x = 0; x < w; x++) {
    if (!fg[y * w + x]) continue
    for (let yy = Math.max(0, y - d); yy <= Math.min(rowsN - 1, y + d); yy++) for (let xx = Math.max(0, x - d); xx <= Math.min(w - 1, x + d); xx++) dil[yy * w + xx] = 1
  }
  const { list } = components(dil, w, rowsN)
  let best: LogoBox | null = null
  for (const c of list) {
    if (c.y0 > Math.max(2, d + 1)) continue // must touch the top edge
    const bw = c.x1 - c.x0 + 1
    const bh = c.y1 - c.y0 + 1
    if (bw / w < 0.08 || bw / w > 0.55 || bh / h > 0.18 || bh / h < 0.02) continue
    if (!best || bw * bh > (best.x1 - best.x0 + 1) * (best.y1 - best.y0 + 1)) best = { x0: Math.max(0, c.x0 + d), y0: 0, x1: Math.min(w - 1, c.x1 - d), y1: Math.min(rowsN - 1, c.y1 - d) }
  }
  return best
}

/** Replace the clipped logo plate by the real logo: cover with the surrounding background, then composite the whole logo. */
async function restoreLogo(bytes: Buffer, logo: Buffer, w: number, h: number): Promise<{ bytes: Buffer; restored: boolean }> {
  const raw = await sharp(bytes).removeAlpha().raw().toBuffer()
  const box = findTopLogo(raw, w, h)
  if (!box) return { bytes, restored: false }
  const padX = Math.round(w * 0.012)
  const x0 = Math.max(0, box.x0 - padX)
  const x1 = Math.min(w - 1, box.x1 + padX)
  const y1 = Math.min(h - 1, box.y1 + padX)
  const margin = Math.max(3, Math.round(w * 0.012))
  const haveL = x0 - margin >= 0
  const haveR = x1 + margin < w
  if (!haveL && !haveR) return { bytes, restored: false }
  // cover: per row, horizontal interpolation between the pixels just left / right of the plate
  const out = Buffer.from(raw)
  for (let y = 0; y <= y1; y++) {
    const l: RGB = [0, 0, 0]
    const r: RGB = [0, 0, 0]
    for (let k = 1; k <= margin; k++) for (let c = 0; c < 3; c++) {
      if (haveL) l[c] += raw[(y * w + x0 - k) * 3 + c] / margin
      if (haveR) r[c] += raw[(y * w + x1 + k) * 3 + c] / margin
    }
    if (!haveL) { l[0] = r[0]; l[1] = r[1]; l[2] = r[2] }
    if (!haveR) { r[0] = l[0]; r[1] = l[1]; r[2] = l[2] }
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / Math.max(1, x1 - x0)
      for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = Math.round(l[c] + (r[c] - l[c]) * t)
    }
  }
  const lm = await sharp(logo).metadata()
  if (!lm.width || !lm.height) return { bytes, restored: false }
  const boxW = x1 - x0 + 1
  const aspect = lm.width / lm.height
  let lw = Math.round(boxW * 0.96)
  let lh = Math.round(lw / aspect)
  const maxH = Math.round(h * 0.17)
  if (lh > maxH) { lh = maxH; lw = Math.round(lh * aspect) }
  const lx = Math.round((x0 + x1) / 2 - lw / 2)
  const ly = Math.max(Math.round(h * 0.004), 0)
  const logoPng = await sharp(logo).rotate().ensureAlpha().resize(lw, lh, { fit: 'fill' }).png().toBuffer()
  // the cover must also cover the (possibly taller) real logo footprint
  const base = await sharp(out, { raw: { width: w, height: h, channels: 3 } }).composite([{ input: logoPng, left: Math.max(0, Math.min(w - lw, lx)), top: ly }]).jpeg({ quality: 93 }).toBuffer()
  return { bytes: base, restored: true }
}

async function scaleInCanvas(bytes: Buffer, w: number, h: number, scale: number, y0Frac: number): Promise<Buffer> {
  const sw = Math.max(2, Math.round(w * scale))
  const sh = Math.max(2, Math.round(h * scale))
  const x0 = Math.round((w - sw) / 2)
  const y0 = Math.max(0, Math.min(h - sh, Math.round(h * y0Frac)))
  const scaled = await sharp(bytes).removeAlpha().resize(sw, sh, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer()
  const topLine = cleanLine(rowsMean(scaled, sw, sh, 0, Math.min(3, sh)), sw)
  const botLine = cleanLine(rowsMean(scaled, sw, sh, Math.max(0, sh - 3), sh), sw)
  const pad = Buffer.alloc(w * h * 3)
  const at = (line: RGB[], x: number): RGB => line[Math.max(0, Math.min(sw - 1, x - x0))]
  const sideCol = (y: number, left: boolean): RGB => {
    const yy = Math.max(0, Math.min(sh - 1, y - y0))
    const xs = left ? [0, 1, 2] : [sw - 1, sw - 2, sw - 3]
    const o: RGB = [0, 0, 0]
    for (const x of xs) for (let c = 0; c < 3; c++) o[c] += scaled[(yy * sw + Math.max(0, x)) * 3 + c] / 3
    return o
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c: RGB
      if (y < y0) c = at(topLine, x)
      else if (y >= y0 + sh) c = at(botLine, x)
      else if (x < x0) c = sideCol(y, true)
      else if (x >= x0 + sw) c = sideCol(y, false)
      else continue
      const i = (y * w + x) * 3
      pad[i] = c[0]; pad[i + 1] = c[1]; pad[i + 2] = c[2]
    }
  }
  // Heavy blur: the padding becomes a soft colour field (no streaks); the picture is feathered into it at its edges.
  const blurred = await sharp(pad, { raw: { width: w, height: h, channels: 3 } }).blur(Math.max(4, w * 0.012)).raw().toBuffer()
  const fx = Math.max(2, Math.round(sw * 0.012))
  const fy = Math.max(2, Math.round(sh * 0.004))
  const rgba = Buffer.alloc(sw * sh * 4)
  for (let y = 0; y < sh; y++) {
    const ay = Math.min(1, (y + 1) / fy, (sh - y) / fy)
    for (let x = 0; x < sw; x++) {
      const ax = Math.min(1, (x + 1) / fx, (sw - x) / fx)
      const i = (y * sw + x) * 4
      const j = (y * sw + x) * 3
      rgba[i] = scaled[j]; rgba[i + 1] = scaled[j + 1]; rgba[i + 2] = scaled[j + 2]
      rgba[i + 3] = Math.round(255 * Math.max(0, Math.min(1, ax * ay)))
    }
  }
  const sharpPng = await sharp(rgba, { raw: { width: sw, height: sh, channels: 4 } }).png().toBuffer()
  return sharp(blurred, { raw: { width: w, height: h, channels: 3 } }).composite([{ input: sharpPng, left: x0, top: y0 }]).jpeg({ quality: 93 }).toBuffer()
}

/**
 * Make the picture pass the safe-zone QA. No-op (applied:false) when it already passes. The output has the SAME
 * pixel size as the input, so the requested ratio stays exact.
 */
export async function enforceSafeZones(input: { bytes: Buffer; ratio: string; logo?: Buffer | null; issues?: SafeZoneIssue[] }): Promise<SafeZoneFixResult> {
  const meta = await sharp(input.bytes).rotate().metadata()
  const w = meta.width || 0
  const h = meta.height || 0
  const issues = input.issues ?? (w && h ? await checkSafeZones(input.bytes, input.ratio) : [])
  const none: SafeZoneFix = { applied: false, scale: 1, padTop: 0, padBottom: 0, attempts: 0, logoRestored: false, before: issues, after: issues, note: 'no safe-zone violation' }
  if (!w || !h || !issues.length) return { bytes: input.bytes, fix: none }

  const m = safeZoneMargins(input.ratio)
  const needTop = issues.some((i) => i.edge === 'top')
  const needBottom = issues.some((i) => i.edge === 'bottom')
  const padTop = needTop ? m.top + EPS : 0
  const padBottom = needBottom ? m.bottom + EPS : 0
  const room = 1 - padTop - padBottom

  let source = await sharp(input.bytes).rotate().removeAlpha().jpeg({ quality: 95 }).toBuffer()
  let logoRestored = false
  if (needTop && input.logo) {
    try {
      const restored = await restoreLogo(source, input.logo, w, h)
      source = restored.bytes
      logoRestored = restored.restored
    } catch { /* keep the scale-in only */ }
  }

  let last: { bytes: Buffer; scale: number; after: SafeZoneIssue[] } | null = null
  for (let attempt = 0; attempt < SHRINK.length; attempt++) {
    const scale = Math.round(room * SHRINK[attempt] * 1000) / 1000
    const y0 = padTop + (room - scale) / 2
    const bytes = await scaleInCanvas(source, w, h, scale, y0)
    const after = await checkSafeZones(bytes, input.ratio)
    last = { bytes, scale, after }
    if (!after.length) {
      return {
        bytes,
        fix: { applied: true, scale, padTop: Math.round(y0 * 1000) / 1000, padBottom: Math.round((1 - y0 - scale) * 1000) / 1000, attempts: attempt + 1, logoRestored, before: issues, after: [], note: `scaled the picture to ${Math.round(scale * 100)}% inside a ${w}x${h} canvas with edge-matched padding${logoRestored ? ' and re-stamped the real logo' : ''}` },
      }
    }
  }
  const l = last!
  const y0 = padTop + (room - l.scale) / 2
  return {
    bytes: l.bytes,
    fix: { applied: true, scale: l.scale, padTop: Math.round(y0 * 1000) / 1000, padBottom: Math.round((1 - y0 - l.scale) * 1000) / 1000, attempts: SHRINK.length, logoRestored, before: issues, after: l.after, note: 'scaled in but the QA still reports a violation (review by eye)' },
  }
}
