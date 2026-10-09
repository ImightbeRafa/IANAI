/**
 * Logo cleanup + variants (C5/H5).
 *
 * 1. Background removal: PNG/WebP alpha passes through; SVG is rasterized with resvg;
 *    a uniform background (the "white square" JPEG) is color-keyed with antialiased edges
 *    (alpha ramps with the Lab distance to the background, edge colors decontaminated).
 * 2. Transparent padding is trimmed.
 * 3. Variants: `onLight` (original colors), `onDark` (monochrome white, only when the
 *    original reads poorly on dark), `badge` (original on a rounded chip) — picked per ad by
 *    sampling the background under the logo slot (contrast ≥ 3).
 *
 * In-process memo by content hash; `cachedLogo` adds the storage cache (deterministic paths).
 */
import { createHash } from 'node:crypto'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import type { BlobCache } from '../fidelity/cache.js'
import { borderBackground, labImage } from '../fidelity/pixels.js'
import { contrastFromLuminance, contrastRatio, luminance, readableOn, WHITE, type Rgb } from './color.js'
import type { PreparedLayer } from './image.js'

export type LogoMethod = 'alpha' | 'svg' | 'color_key' | 'as_is'
export type LogoVariantName = 'onLight' | 'onDark' | 'badge'

export interface LogoVariants {
  hash: string
  method: LogoMethod
  /** True when an opaque background was removed. */
  backgroundRemoved: boolean
  /** Transparent, trimmed, original colors. */
  onLight: PreparedLayer
  /** White monochrome version (only when the original has poor contrast on dark). */
  onDark: PreparedLayer | null
  /** Mean color of the opaque pixels. */
  color: Rgb
}

/** Min contrast for a logo to read on its background (WCAG non-text). */
export const LOGO_MIN_CONTRAST = 3
const DARK_BG: Rgb = { r: 17, g: 17, b: 17 }
const memo = new Map<string, LogoVariants>()
const MEMO_MAX = 32

const isSvg = (bytes: Buffer) => {
  const head = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase()
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
}

async function layer(png: Buffer): Promise<PreparedLayer> {
  const m = await sharp(png).metadata()
  return { png, width: m.width ?? 1, height: m.height ?? 1 }
}

async function trim(png: Buffer): Promise<Buffer> {
  try {
    const { data, info } = await sharp(png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true })
    if (info.width >= 4 && info.height >= 4) return data
  } catch {
    // fully transparent or tiny: keep as is
  }
  return png
}

async function meanOpaque(png: Buffer): Promise<Rgb> {
  const { data, info } = await sharp(png).ensureAlpha().resize(96, 96, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < info.width * info.height; i++) {
    if (data[i * 4 + 3] < 128) continue
    r += data[i * 4]
    g += data[i * 4 + 1]
    b += data[i * 4 + 2]
    n++
  }
  return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 }
}

/**
 * Color-key a uniform background: alpha = smoothstep of ΔE to the background color between
 * `t0` and `t1`, edge colors decontaminated. Returns null when the border is not uniform.
 */
export async function colorKeyBackground(bytes: Buffer, t0 = 6, t1 = 22): Promise<Buffer | null> {
  const { data, info } = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const n = w * h
  const lab = labImage(data, 4, n)
  const border = borderBackground(lab, w, h, 8)
  if (border.uniformity < 0.8) return null
  const [L, A, B] = border.lab
  // Background RGB: mean of border-ish pixels close to the median.
  let br = 0
  let bgc = 0
  let bb = 0
  let bn = 0
  for (let i = 0; i < n; i++) {
    const x = i % w
    const y = (i - x) / w
    if (x > 1 && y > 1 && x < w - 2 && y < h - 2) continue
    const d = Math.hypot(lab[i * 3] - L, lab[i * 3 + 1] - A, lab[i * 3 + 2] - B)
    if (d > 8) continue
    br += data[i * 4]
    bgc += data[i * 4 + 1]
    bb += data[i * 4 + 2]
    bn++
  }
  const bg = bn ? [br / bn, bgc / bn, bb / bn] : [255, 255, 255]
  const out = Buffer.alloc(n * 4)
  let opaque = 0
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(lab[i * 3] - L, lab[i * 3 + 1] - A, lab[i * 3 + 2] - B)
    const t = Math.max(0, Math.min(1, (d - t0) / (t1 - t0)))
    let a = t * t * (3 - 2 * t)
    if (a < 0.06) a = 0
    const srcA = data[i * 4 + 3] / 255
    for (let c = 0; c < 3; c++) {
      const v = data[i * 4 + c]
      out[i * 4 + c] = a > 0 && a < 1 ? Math.max(0, Math.min(255, Math.round((v - (1 - a) * bg[c]) / a))) : v
    }
    out[i * 4 + 3] = Math.round(a * srcA * 255)
    if (a > 0.5) opaque++
  }
  // Nothing left (logo identical to its background) → not keyable.
  if (opaque < n * 0.005) return null
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

async function transparentShare(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().resize(128, 128, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
  let t = 0
  for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] < 128) t++
  return t / (info.width * info.height)
}

/** White monochrome version keeping the alpha (antialiasing intact). */
async function monochrome(png: Buffer, color: Rgb): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.from(data)
  for (let i = 0; i < info.width * info.height; i++) {
    out[i * 4] = color.r
    out[i * 4 + 1] = color.g
    out[i * 4 + 2] = color.b
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

export function logoHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Clean a logo and build its variants. Never throws on odd inputs: falls back to the original. */
export async function prepareLogo(input: Uint8Array): Promise<LogoVariants> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const hash = logoHash(bytes)
  const hit = memo.get(hash)
  if (hit) return hit
  let method: LogoMethod = 'as_is'
  let png: Buffer
  let backgroundRemoved = false
  if (isSvg(bytes)) {
    png = Buffer.from(new Resvg(bytes.toString('utf8'), { fitTo: { mode: 'width', value: 1024 }, background: 'rgba(0,0,0,0)', font: { loadSystemFonts: false } }).render().asPng())
    method = 'svg'
  } else {
    const meta = await sharp(bytes).metadata()
    const base = await sharp(bytes, { density: 300 }).rotate().ensureAlpha().png().toBuffer()
    const share = meta.hasAlpha ? await transparentShare(base) : 0
    if (meta.hasAlpha && share >= 0.02) {
      png = base
      method = 'alpha'
    } else {
      const keyed = await colorKeyBackground(bytes)
      if (keyed) {
        png = keyed
        method = 'color_key'
        backgroundRemoved = true
      } else {
        png = base
      }
    }
  }
  const onLightPng = await trim(png)
  const color = await meanOpaque(onLightPng)
  const poorOnDark = contrastRatio(color, DARK_BG) < LOGO_MIN_CONTRAST
  const variants: LogoVariants = {
    hash,
    method,
    backgroundRemoved,
    onLight: await layer(onLightPng),
    onDark: poorOnDark ? await layer(await monochrome(onLightPng, WHITE)) : null,
    color,
  }
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string)
  memo.set(hash, variants)
  return variants
}

export interface LogoChoice {
  variant: LogoVariantName
  layer: PreparedLayer
  /** Badge chip fill (only for 'badge'). */
  chip?: Rgb
}

/**
 * Pick the variant for a background whose median luminance is `bgLuminance` (0–1).
 * onLight when the original reads (≥ 3:1); else onDark (white) when it reads; else a badge chip
 * in the brand color (or the logo's readable counter-color).
 */
export function pickLogoVariant(v: LogoVariants, bgLuminance: number, brand?: Rgb | null): LogoChoice {
  const logoL = luminance(v.color)
  if (contrastFromLuminance(logoL, bgLuminance) >= LOGO_MIN_CONTRAST) return { variant: 'onLight', layer: v.onLight }
  if (v.onDark && contrastFromLuminance(1, bgLuminance) >= LOGO_MIN_CONTRAST) return { variant: 'onDark', layer: v.onDark }
  const chip = brand && contrastRatio(brand, v.color) >= LOGO_MIN_CONTRAST ? brand : readableOn(v.color)
  return { variant: 'badge', layer: v.onLight, chip }
}

/** Storage-backed variant cache: the cleaned logo is stored once per content hash. */
export async function cachedLogo(bytes: Uint8Array, cache: BlobCache | null): Promise<{ png: Uint8Array; url?: string; variants: LogoVariants }> {
  const hash = logoHash(bytes)
  if (cache) {
    const hit = await cache.get(`${hash}-onLight`)
    if (hit) {
      const variants = await prepareLogo(hit.bytes)
      return { png: hit.bytes, url: hit.url, variants }
    }
  }
  const variants = await prepareLogo(bytes)
  const png = new Uint8Array(variants.onLight.png)
  let url: string | undefined
  if (cache) {
    try {
      url = (await cache.put(`${hash}-onLight`, png)).url
      if (variants.onDark) await cache.put(`${hash}-onDark`, new Uint8Array(variants.onDark.png))
    } catch {
      // cache is best-effort
    }
  }
  return { png, url, variants }
}
