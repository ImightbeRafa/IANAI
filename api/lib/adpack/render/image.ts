/**
 * Image IO for the renderer (sharp only): load inputs, cover-fit the scene,
 * prepare cut-out / logo layers and sample background luminance.
 */
import sharp from 'sharp'
import type { Rgb } from './color.js'
import type { Box, ImageInput } from './types.js'

const FETCH_TIMEOUT_MS = 10_000

export async function loadImageBytes(input: ImageInput): Promise<Buffer> {
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (input instanceof ArrayBuffer) return Buffer.from(input)
  if (typeof input !== 'string' || !input) throw new Error('image input is empty')
  const s = input.trim()
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',')
    if (comma < 0) throw new Error('invalid data URL')
    const meta = s.slice(5, comma)
    const body = s.slice(comma + 1)
    return meta.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8')
  }
  if (/^https?:\/\//i.test(s)) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(s, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('unsupported image input (expected bytes, data URL or http(s) URL)')
}

/** Scene → exact canvas size (cover crop, centered), sRGB, no alpha. */
export async function prepareScene(input: ImageInput, W: number, H: number): Promise<Buffer> {
  const bytes = await loadImageBytes(input)
  return sharp(bytes)
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .png({ compressionLevel: 0 })
    .toBuffer()
}

export interface PreparedLayer {
  png: Buffer
  width: number
  height: number
}

/** Decode any raster/SVG once to PNG and read its size. Returns null on failure. */
export async function decodeLayer(input: ImageInput): Promise<PreparedLayer | null> {
  try {
    const bytes = await loadImageBytes(input)
    const png = await sharp(bytes, { density: 300 }).rotate().ensureAlpha().png().toBuffer()
    const meta = await sharp(png).metadata()
    if (!meta.width || !meta.height) return null
    return { png, width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

/** Trim transparent borders so the product box hugs the visible object. */
export async function trimTransparent(layer: PreparedLayer): Promise<PreparedLayer> {
  try {
    const { data, info } = await sharp(layer.png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true })
    if (info.width < 8 || info.height < 8) return layer
    return { png: data, width: info.width, height: info.height }
  } catch {
    return layer
  }
}

/** Fit a layer inside `box` (contain), centered horizontally and bottom/center aligned. */
export function fitInside(layer: { width: number; height: number }, box: Box, valign: 'center' | 'bottom' = 'center'): Box {
  const s = Math.min(box.w / layer.width, box.h / layer.height)
  const w = Math.max(1, Math.round(layer.width * s))
  const h = Math.max(1, Math.round(layer.height * s))
  const x = Math.round(box.x + (box.w - w) / 2)
  const y = Math.round(valign === 'bottom' ? box.y + box.h - h : box.y + (box.h - h) / 2)
  return { x, y, w, h }
}

export async function resizeLayer(layer: PreparedLayer, w: number, h: number): Promise<Buffer> {
  return sharp(layer.png).resize(w, h, { fit: 'fill' }).png().toBuffer()
}

/** Soft drop shadow for a cut-out (black, blurred alpha). Returns the padded shadow and its offset. */
export async function dropShadow(png: Buffer, w: number, h: number, blur: number, opacity: number): Promise<{ png: Buffer; pad: number } | null> {
  try {
    const pad = Math.ceil(blur * 2.5)
    const alpha = await sharp(png)
      .ensureAlpha()
      .extractChannel(3)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: 0 })
      .blur(blur)
      .linear(opacity, 0)
      .raw()
      .toBuffer()
    const shadow = await sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 3, background: '#000000' } })
      .joinChannel(alpha, { raw: { width: w + pad * 2, height: h + pad * 2, channels: 1 } })
      .png()
      .toBuffer()
    return { png: shadow, pad }
  } catch {
    return null
  }
}

/** Mean color of the opaque pixels of a layer (for logo contrast decisions). */
export async function opaqueMeanColor(png: Buffer): Promise<Rgb | null> {
  try {
    const { data, info } = await sharp(png).ensureAlpha().resize(64, 64, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < info.width * info.height; i++) {
      const a = data[i * 4 + 3]
      if (a < 128) continue
      r += data[i * 4]
      g += data[i * 4 + 1]
      b += data[i * 4 + 2]
      n++
    }
    return n ? { r: r / n, g: g / n, b: b / n } : null
  } catch {
    return null
  }
}

export interface RegionStats {
  /** Luminance percentiles of the region (0–1). */
  p5: number
  p50: number
  p95: number
  /** Std-dev of luminance (busyness). */
  spread: number
  /** Pixel colors at the 5th/95th luminance percentiles. */
  darkest: Rgb
  brightest: Rgb
  mean: Rgb
}

const LUT = (() => {
  const t = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const s = i / 255
    t[i] = s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return t
})()

/** Luminance distribution of `box` in an RGB(A) image (sampled at ≤ 160px on the long side). */
export async function regionStats(png: Buffer, box: Box, canvasW: number, canvasH: number): Promise<RegionStats> {
  const left = Math.max(0, Math.floor(box.x))
  const top = Math.max(0, Math.floor(box.y))
  const width = Math.max(1, Math.min(canvasW - left, Math.ceil(box.w)))
  const height = Math.max(1, Math.min(canvasH - top, Math.ceil(box.h)))
  const scale = Math.min(1, 160 / Math.max(width, height))
  const { data, info } = await sharp(png)
    .extract({ left, top, width, height })
    .resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), { kernel: 'nearest' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  const lum = new Float64Array(n)
  const idx = new Uint32Array(n)
  let sr = 0
  let sg = 0
  let sb = 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const r = data[i * info.channels]
    const g = data[i * info.channels + 1]
    const b = data[i * info.channels + 2]
    sr += r
    sg += g
    sb += b
    lum[i] = 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b]
    sum += lum[i]
    idx[i] = i
  }
  const sorted = Array.from(idx).sort((a, b) => lum[a] - lum[b])
  const at = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))]
  const px = (i: number): Rgb => ({ r: data[i * info.channels], g: data[i * info.channels + 1], b: data[i * info.channels + 2] })
  const meanL = sum / n
  let v = 0
  for (let i = 0; i < n; i++) v += (lum[i] - meanL) ** 2
  return {
    p5: lum[at(0.05)],
    p50: lum[at(0.5)],
    p95: lum[at(0.95)],
    spread: Math.sqrt(v / n),
    darkest: px(at(0.05)),
    brightest: px(at(0.95)),
    mean: { r: sr / n, g: sg / n, b: sb / n },
  }
}

