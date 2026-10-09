/**
 * Logo cleanup + variants (C5/H5, P0 #1).
 *
 * 1. Background removal: PNG/WebP alpha passes through; SVG is rasterized with resvg; a uniform
 *    background (the "white square" JPEG) is removed by an EDGE-CONNECTED flood fill from the
 *    border pixels only — never a global color key. Pixels the flood cannot reach from the border
 *    (text, inner borders, dots inside a badge) keep their exact values, whatever their color.
 *    Only the ≤ 2 px antialiased band next to the removed region gets a soft alpha (decontaminated).
 *    `removedPct` + `warnings` report what was removed; when the flood would remove more than 60%
 *    of the logo's own bounding box the original is kept (with a warning).
 * 2. Transparent padding is trimmed.
 * 3. Variants: a SELF-CONTAINED logo (opaque area > 85% of its trimmed bbox — a badge with its own
 *    background shape — or a kit 'badge' variant) is never recolored: placed as-is when its outer
 *    edge reads on the ad region (contrast ≥ 3), else on a light (or dark) chip. Monochrome white
 *    (`onDark`) exists only for true transparent line / wordmark logos.
 *
 * In-process memo by content hash; `cachedLogo` adds the storage cache (deterministic paths).
 */
import { createHash } from 'node:crypto'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import type { BlobCache } from '../fidelity/cache.js'
import { borderBackground, erode, labImage } from '../fidelity/pixels.js'
import { contrastFromLuminance, contrastRatio, luminance, readableOn, WHITE, type Rgb } from './color.js'
import type { PreparedLayer } from './image.js'

/** 'edge_flood' = uniform background removed from the borders inward (interior pixels untouched). */
export type LogoMethod = 'alpha' | 'svg' | 'edge_flood' | 'as_is'
export type LogoVariantName = 'onLight' | 'onDark' | 'badge'

export interface LogoVariants {
  hash: string
  method: LogoMethod
  /** True when an opaque background was removed. */
  backgroundRemoved: boolean
  /** Transparent, trimmed, original colors. */
  onLight: PreparedLayer
  /** White monochrome version: only for transparent line / wordmark logos with poor contrast on dark. */
  onDark: PreparedLayer | null
  /** Mean color of the opaque pixels. */
  color: Rgb
  /** Mean color of the logo's outer edge (what touches the ad background). */
  edgeColor: Rgb
  /** Opaque area / trimmed bbox area (0–1). */
  opaqueShare: number
  /** Badge-like logo with its own background shape: never recolored. */
  selfContained: boolean
  /** Share of the source pixels made transparent by the cleanup (0–1). */
  removedPct: number
  /** Plain-language cleanup warnings (owner-facing, Spanish). */
  warnings: string[]
}

/** Min contrast for a logo to read on its background (WCAG non-text). */
export const LOGO_MIN_CONTRAST = 3
/** Opaque share of the trimmed bbox above which a logo is self-contained (badge, solid shape). */
export const SELF_CONTAINED_SHARE = 0.85
/** Max share of the logo's own bbox the edge flood may remove (else the original is kept). */
export const LOGO_MAX_INTERIOR_REMOVAL = 0.6
/** Removal share (of the source pixels) from which the owner is asked to review the result. */
const LOGO_REVIEW_REMOVAL = 0.3
const DARK_BG: Rgb = { r: 17, g: 17, b: 17 }
/** Chips for self-contained logos that do not read on the ad region. */
export const LIGHT_CHIP: Rgb = { r: 255, g: 255, b: 255 }
export const DARK_CHIP: Rgb = { r: 20, g: 22, b: 26 }
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

/** Mean opaque color, mean outer-edge color and opaque share of a (trimmed) RGBA logo. */
export async function logoStats(png: Buffer): Promise<{ color: Rgb; edgeColor: Rgb; opaqueShare: number }> {
  const { data, info } = await sharp(png).ensureAlpha().resize(160, 160, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const n = w * h
  const solid = new Uint8Array(n)
  let r = 0
  let g = 0
  let b = 0
  let k = 0
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue
    solid[i] = 1
    r += data[i * 4]
    g += data[i * 4 + 1]
    b += data[i * 4 + 2]
    k++
  }
  const color = k ? { r: r / k, g: g / k, b: b / k } : { r: 0, g: 0, b: 0 }
  // Outer edge: opaque pixels within ~4% of a transparent pixel or of the bbox border.
  const ringR = Math.max(2, Math.round(0.04 * Math.min(w, h)))
  const pw = w + 2
  const padded = new Uint8Array(pw * (h + 2))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded[(y + 1) * pw + x + 1] = solid[y * w + x]
  const core = erode(padded, pw, h + 2, ringR)
  let er = 0
  let eg = 0
  let eb = 0
  let ek = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!solid[i] || core[(y + 1) * pw + x + 1]) continue
      er += data[i * 4]
      eg += data[i * 4 + 1]
      eb += data[i * 4 + 2]
      ek++
    }
  }
  const edgeColor = ek ? { r: er / ek, g: eg / ek, b: eb / ek } : color
  return { color, edgeColor, opaqueShare: n ? k / n : 0 }
}

export interface EdgeFloodResult {
  png: Buffer
  /** Share of the source pixels removed (0–1). */
  removedPct: number
  /** Share of the kept content's bounding box that was removed (0–1). */
  interiorRemovedPct: number
}

export interface EdgeFloodRefused {
  reason: 'too_much_removed'
  removedPct: number
  interiorRemovedPct: number
}

/**
 * Remove a uniform background by flooding from the border pixels only (P0 #1). A pixel is removed
 * only when it is reachable from the image border through background-colored pixels; anything
 * enclosed by the logo (text inside a badge, an inner border, dots) is kept bit-identical, even
 * when it has the background's color. The ≤ 2 px antialiased band next to the removed region gets
 * a soft alpha with the background color decontaminated. Null when the border is not uniform or
 * the flood removes nothing / everything; a refusal when > 60% of the logo's own bbox would go.
 */
export async function edgeFloodBackground(bytes: Buffer | Uint8Array, opts: { tolerance?: number; band?: [number, number] } = {}): Promise<EdgeFloodResult | EdgeFloodRefused | null> {
  const { data, info } = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const n = w * h
  const lab = labImage(data, 4, n)
  const border = borderBackground(lab, w, h, 8)
  if (border.uniformity < 0.8) return null
  const [L, A, B] = border.lab
  const tol = opts.tolerance ?? 10
  const [t0, t1] = opts.band ?? [6, 22]
  const dist = new Float32Array(n)
  for (let i = 0; i < n; i++) dist[i] = Math.hypot(lab[i * 3] - L, lab[i * 3 + 1] - A, lab[i * 3 + 2] - B)
  // Edge-connected flood (4-neighborhood) from every border pixel within the tolerance.
  const bg = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const push = (i: number) => {
    if (bg[i] || dist[i] > tol) return
    bg[i] = 1
    stack[sp++] = i
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (sp) {
    const i = stack[--sp]
    const x = i % w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (i >= w) push(i - w)
    if (i < n - w) push(i + w)
  }
  let removed = 0
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let i = 0; i < n; i++) {
    if (bg[i]) {
      removed++
      continue
    }
    const x = i % w
    const y = (i - x) / w
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (!removed || x1 < 0 || n - removed < n * 0.005) return null
  const removedPct = removed / n
  let inside = 0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) inside += bg[y * w + x]
  const interiorRemovedPct = inside / ((x1 - x0 + 1) * (y1 - y0 + 1))
  if (interiorRemovedPct > LOGO_MAX_INTERIOR_REMOVAL) return { reason: 'too_much_removed', removedPct, interiorRemovedPct }
  // Background RGB: mean of the removed pixels close to the median color.
  let br = 0
  let bgc = 0
  let bb = 0
  let bn = 0
  for (let i = 0; i < n; i++) {
    if (!bg[i] || dist[i] > 6) continue
    br += data[i * 4]
    bgc += data[i * 4 + 1]
    bb += data[i * 4 + 2]
    bn++
  }
  const bgRgb = bn ? [br / bn, bgc / bn, bb / bn] : [255, 255, 255]
  const out = Buffer.from(data)
  for (let i = 0; i < n; i++) {
    if (bg[i]) {
      out[i * 4 + 3] = 0
      continue
    }
    // Antialiased band: kept pixels touching the removed region (≤ 2 px) get a soft alpha.
    const x = i % w
    const y = (i - x) / w
    let near = false
    for (let dy = -2; dy <= 2 && !near; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx
        if (xx >= 0 && xx < w && bg[yy * w + xx]) {
          near = true
          break
        }
      }
    }
    if (!near) continue
    const t = Math.max(0, Math.min(1, (dist[i] - t0) / (t1 - t0)))
    const a = Math.max(0.06, t * t * (3 - 2 * t))
    if (a >= 1) continue
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round((data[i * 4 + c] - (1 - a) * bgRgb[c]) / a)))
    out[i * 4 + 3] = Math.round(a * data[i * 4 + 3])
  }
  const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  return { png, removedPct, interiorRemovedPct }
}

/** @deprecated A global color key erases interior text of the background's color: edge flood only. */
export async function colorKeyBackground(bytes: Buffer): Promise<Buffer | null> {
  const res = await edgeFloodBackground(bytes)
  return res && 'png' in res ? res.png : null
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

const pct = (v: number) => Math.round(v * 100)

/** Clean a logo and build its variants. Never throws on odd inputs: falls back to the original. */
export async function prepareLogo(input: Uint8Array, opts: { badge?: boolean } = {}): Promise<LogoVariants> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const hash = logoHash(bytes)
  const key = opts.badge ? `${hash}:badge` : hash
  const hit = memo.get(key)
  if (hit) return hit
  let method: LogoMethod = 'as_is'
  let png: Buffer
  let backgroundRemoved = false
  let removedPct = 0
  const warnings: string[] = []
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
      const flood = await edgeFloodBackground(bytes)
      if (flood && 'png' in flood) {
        png = flood.png
        method = 'edge_flood'
        backgroundRemoved = true
        removedPct = flood.removedPct
        if (flood.removedPct >= LOGO_REVIEW_REMOVAL) warnings.push(`se removió el ${pct(flood.removedPct)}% de los píxeles (solo el fondo conectado al borde) — revisá el resultado`)
      } else {
        png = base
        if (flood && 'reason' in flood) {
          warnings.push(`no se removió el fondo: habría borrado el ${pct(flood.interiorRemovedPct)}% del propio logo — se usa el original; subí un PNG con transparencia`)
        }
      }
    }
  }
  const onLightPng = await trim(png)
  const stats = await logoStats(onLightPng)
  const selfContained = opts.badge === true || stats.opaqueShare > SELF_CONTAINED_SHARE
  // Monochrome white only for true transparent line / wordmark logos (never a self-contained badge).
  const poorOnDark = !selfContained && contrastRatio(stats.color, DARK_BG) < LOGO_MIN_CONTRAST
  const variants: LogoVariants = {
    hash,
    method,
    backgroundRemoved,
    onLight: await layer(onLightPng),
    onDark: poorOnDark ? await layer(await monochrome(onLightPng, WHITE)) : null,
    color: stats.color,
    edgeColor: stats.edgeColor,
    opaqueShare: Math.round(stats.opaqueShare * 1000) / 1000,
    selfContained,
    removedPct: Math.round(removedPct * 1000) / 1000,
    warnings,
  }
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string)
  memo.set(key, variants)
  return variants
}

export interface LogoChoice {
  variant: LogoVariantName
  layer: PreparedLayer
  /** Chip fill (only for 'badge'). */
  chip?: Rgb
  /** True when the logo was treated as self-contained (never recolored). */
  selfContained?: boolean
  /** Contrast of the placed logo (edge or chip) vs what is under it. */
  contrast?: number
}

/** Natural-color contrast of a logo on a background of luminance `bgLuminance` (edge color for badges). */
export function logoContrast(v: LogoVariants, bgLuminance: number): number {
  return contrastFromLuminance(luminance(v.selfContained ? v.edgeColor : v.color), bgLuminance)
}

/**
 * Pick the variant for a background whose median luminance is `bgLuminance` (0–1).
 * - Self-contained (badge / solid shape): as-is when its outer edge reads (≥ 3:1), else on a light
 *   chip (dark edge) or a dark chip (light edge). Never monochrome.
 * - Transparent line / wordmark: onLight when the original reads; else onDark (white) when it
 *   reads; else a chip in the brand color (or the logo's readable counter-color).
 */
export function pickLogoVariant(v: LogoVariants, bgLuminance: number, brand?: Rgb | null): LogoChoice {
  if (v.selfContained) {
    const c = logoContrast(v, bgLuminance)
    if (c >= LOGO_MIN_CONTRAST) return { variant: 'onLight', layer: v.onLight, selfContained: true, contrast: Math.round(c * 100) / 100 }
    const chip = luminance(v.edgeColor) < 0.4 ? LIGHT_CHIP : DARK_CHIP
    return { variant: 'badge', layer: v.onLight, chip, selfContained: true, contrast: Math.round(contrastRatio(chip, v.edgeColor) * 100) / 100 }
  }
  const logoL = luminance(v.color)
  if (contrastFromLuminance(logoL, bgLuminance) >= LOGO_MIN_CONTRAST) return { variant: 'onLight', layer: v.onLight, contrast: Math.round(contrastFromLuminance(logoL, bgLuminance) * 100) / 100 }
  if (v.onDark && contrastFromLuminance(1, bgLuminance) >= LOGO_MIN_CONTRAST) return { variant: 'onDark', layer: v.onDark, contrast: Math.round(contrastFromLuminance(1, bgLuminance) * 100) / 100 }
  const chip = brand && contrastRatio(brand, v.color) >= LOGO_MIN_CONTRAST ? brand : readableOn(v.color)
  return { variant: 'badge', layer: v.onLight, chip, contrast: Math.round(contrastRatio(chip, v.color) * 100) / 100 }
}

/** Kit logo variant kinds the renderer can choose from (brand_profile.logoVariants). */
export type KitLogoKind = 'primary' | 'light' | 'dark' | 'badge'

export interface KitLogo {
  kind: KitLogoKind
  variants: LogoVariants
}

/**
 * Choose among the kit's logo variants (P0 #1): the primary logo when it reads as-is; else the
 * kit variant (light / dark / badge) that reads best as-is (≥ 3:1); else the kit badge (or the
 * primary when self-contained) on a chip; else the primary through pickLogoVariant.
 */
export function chooseKitLogo(logos: KitLogo[], bgLuminance: number, brand?: Rgb | null): (LogoChoice & { kind: KitLogoKind }) | null {
  if (!logos.length) return null
  const primary = logos.find((l) => l.kind === 'primary') ?? logos[0]
  const asIs = (l: KitLogo) => logoContrast(l.variants, bgLuminance)
  if (asIs(primary) >= LOGO_MIN_CONTRAST) return { ...pickLogoVariant(primary.variants, bgLuminance, brand), kind: primary.kind }
  const readable = logos.filter((l) => l !== primary && asIs(l) >= LOGO_MIN_CONTRAST).sort((a, b) => asIs(b) - asIs(a))[0]
  if (readable) return { ...pickLogoVariant(readable.variants, bgLuminance, brand), kind: readable.kind }
  const badge = logos.find((l) => l.kind === 'badge')
  if (badge && !primary.variants.selfContained) return { ...pickLogoVariant(badge.variants, bgLuminance, brand), kind: 'badge' }
  return { ...pickLogoVariant(primary.variants, bgLuminance, brand), kind: primary.kind }
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
