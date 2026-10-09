/**
 * Product fidelity — asset quality (C3/C4): resolution, sharpness (variance of the Laplacian),
 * background cleanliness, plain-language warnings, and the photo picker used per ad.
 *
 * `pickProductImage` is pure: it prefers the requested role, then the format's preferred roles,
 * then the owner's primary photo, then the sharpest / highest-resolution photo — never a blurry or
 * tiny photo when a better one of the same role exists. Sharpness is measured at a normalized
 * 1024 px scale, so an upscaled studio photo is not mistaken for a blurry one (P3 #17).
 */
import sharp from 'sharp'
import type { AdFormat, AdLanguage, ProductPhotoRole } from '../types.js'
import { borderBackground, labImage } from './pixels.js'

/** Long side below this → "low resolution" warning. */
export const MIN_LONG_SIDE = 900
/** Laplacian variance (on the 1024-px normalized gray copy, detail tiles) below this → "blurry". */
export const BLUR_VARIANCE = 60
/**
 * Sharpness is always measured at this long edge (P3 #17): the photo is resized UP or DOWN to it
 * first, so a 2× upscaled studio photo and its native original score alike (a fixed pixel scale,
 * not the file's resolution).
 */
export const SHARPNESS_SIDE = 1024
/** Tile size (px, at SHARPNESS_SIDE) of the detail-weighted Laplacian measure. */
const SHARPNESS_TILE = 32

export interface AssetQuality {
  width: number
  height: number
  megapixels: number
  /**
   * Variance of the 3×3 Laplacian on a grayscale copy normalized to SHARPNESS_SIDE (1024 px long
   * edge), averaged over the most detailed tiles (the subject), so clean studio backgrounds and
   * upscaled files do not read as blur.
   */
  sharpness: number
  /** 0–1 (1 = very sharp). */
  sharpnessScore: number
  /** 0–1 share of the border that is one uniform color (1 = clean studio background). */
  backgroundClean: number
  hasAlpha: boolean
  lowResolution: boolean
  blurry: boolean
  /** Plain-language warnings ("baja resolución, se verá blanda", "foto borrosa"). */
  warnings: string[]
  /** 0–1 overall usability. */
  score: number
  /**
   * Set when the photo was upscaled before the cut-out (low resolution only; fidelity/upscale.ts:
   * Lanczos3 + edge-aware unsharp, ≤ 2× / 2048 px, verified not redrawn).
   */
  upscaled?: boolean
  from?: { width: number; height: number }
  to?: { width: number; height: number }
}

export function laplacianVariance(grayPx: Uint8Array | Buffer, w: number, h: number): number {
  let sum = 0
  let sum2 = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = grayPx[i - w] + grayPx[i + w] + grayPx[i - 1] + grayPx[i + 1] - 4 * grayPx[i]
      sum += v
      sum2 += v * v
      n++
    }
  }
  if (!n) return 0
  const m = sum / n
  return sum2 / n - m * m
}

/**
 * Detail-tile sharpness: Laplacian variance per SHARPNESS_TILE tile, mean of the top quarter
 * (≥ 4 tiles). A flat studio background no longer dilutes the subject's sharpness.
 */
export function detailSharpness(grayPx: Uint8Array | Buffer, w: number, h: number, tile = SHARPNESS_TILE): number {
  const vars: number[] = []
  for (let ty = 0; ty + tile <= h; ty += tile) {
    for (let tx = 0; tx + tile <= w; tx += tile) {
      let sum = 0
      let sum2 = 0
      let n = 0
      for (let y = Math.max(1, ty); y < Math.min(h - 1, ty + tile); y++) {
        for (let x = Math.max(1, tx); x < Math.min(w - 1, tx + tile); x++) {
          const i = y * w + x
          const v = grayPx[i - w] + grayPx[i + w] + grayPx[i - 1] + grayPx[i + 1] - 4 * grayPx[i]
          sum += v
          sum2 += v * v
          n++
        }
      }
      if (n) vars.push(sum2 / n - (sum / n) ** 2)
    }
  }
  if (!vars.length) return laplacianVariance(grayPx, w, h)
  vars.sort((a, b) => b - a)
  const k = Math.max(4, Math.ceil(vars.length * 0.25))
  const top = vars.slice(0, k)
  return top.reduce((s, v) => s + v, 0) / top.length
}

export async function analyzeAssetQuality(bytes: Uint8Array, language: AdLanguage = 'es'): Promise<AssetQuality> {
  const meta = await sharp(bytes).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const longSide = Math.max(width, height)
  // Normalized scale (P3 #17): always SHARPNESS_SIDE on the long edge (up or down), detail tiles only.
  const g = await sharp(bytes)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(SHARPNESS_SIDE, SHARPNESS_SIDE, { fit: 'inside', kernel: 'lanczos3' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const sharpness = detailSharpness(g.data, g.info.width, g.info.height)
  const small = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).resize(256, 256, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const lab = labImage(small.data, small.info.channels, small.info.width * small.info.height)
  const backgroundClean = Math.round(borderBackground(lab, small.info.width, small.info.height, 10).uniformity * 100) / 100
  const lowResolution = longSide < MIN_LONG_SIDE
  const blurry = sharpness < BLUR_VARIANCE
  const es = language === 'es'
  const warnings: string[] = []
  if (lowResolution) warnings.push(es ? 'baja resolución, se verá blanda' : 'low resolution, it will look soft')
  if (blurry) warnings.push(es ? 'foto borrosa' : 'blurry photo')
  if (backgroundClean < 0.5) warnings.push(es ? 'fondo con ruido: el recorte puede fallar' : 'busy background: the cut-out may fail')
  const sharpnessScore = Math.round(Math.min(1, sharpness / 400) * 100) / 100
  const resScore = Math.min(1, longSide / 2000)
  const score = Math.round((0.5 * sharpnessScore + 0.35 * resScore + 0.15 * backgroundClean) * 100) / 100
  return {
    width,
    height,
    megapixels: Math.round(((width * height) / 1e6) * 100) / 100,
    sharpness: Math.round(sharpness * 10) / 10,
    sharpnessScore,
    backgroundClean,
    hasAlpha: Boolean(meta.hasAlpha),
    lowResolution,
    blurry,
    warnings,
    score,
  }
}

export interface PoolImage {
  url: string
  id?: string
  role?: ProductPhotoRole
  label?: string
  quality?: AssetQuality
  /** Owner's primary photo (product_images.is_primary): never dropped for being soft. */
  primary?: boolean
}

/** Roles each format prefers for its main product image (most preferred first). */
export const FORMAT_ROLE_PREFERENCE: Record<AdFormat, ProductPhotoRole[]> = {
  offer_graphic: ['hero', 'box', 'detail'],
  variant_card: ['hero', 'detail', 'box'],
  before_after: ['hero', 'in_use'],
  how_to_steps: ['in_use', 'hero', 'contents'],
  ugc_person: ['in_use', 'hero'],
  handheld_overlay: ['hero', 'in_use'],
  explainer: ['contents', 'hero', 'detail'],
}

const isWeak = (q?: AssetQuality) => Boolean(q && (q.blurry || q.lowResolution))

/**
 * Pick the best product photo for one ad. Null when the pool is empty.
 * Ranking (P3 #17): role preference of the format → the owner's primary photo → quality
 * (sharpness at the normalized scale + resolution). A soft photo is skipped when a strong one of
 * the same rank exists, but the primary photo is never dropped for quality.
 */
export function pickProductImage(pool: PoolImage[], opts: { format?: AdFormat; role?: ProductPhotoRole; exclude?: string[] } = {}): PoolImage | null {
  const skip = new Set(opts.exclude ?? [])
  let list = pool.filter((p) => p && p.url && !skip.has(p.url))
  // Parts / kit contents are never the main product image unless explicitly requested.
  if (opts.role !== 'part') list = list.filter((p) => p.role !== 'part')
  if (!list.length) return null
  if (opts.role) {
    const exact = list.filter((p) => p.role === opts.role)
    if (exact.length) list = exact
  }
  const prefs = opts.role ? [opts.role] : FORMAT_ROLE_PREFERENCE[opts.format ?? 'offer_graphic'] ?? ['hero']
  const roleRank = (p: PoolImage) => {
    const i = p.role ? prefs.indexOf(p.role) : -1
    return i >= 0 ? i : p.role ? prefs.length + 1 : prefs.length // untagged photos rank just after the preferred roles
  }
  const primaryRank = (p: PoolImage) => (p.primary ? 0 : 1)
  // Within the same role (and primary flag), never a blurry / tiny photo when a better one exists.
  const weakRank = (p: PoolImage) => (isWeak(p.quality) ? 1 : 0)
  return [...list].sort((a, b) => roleRank(a) - roleRank(b) || primaryRank(a) - primaryRank(b) || weakRank(a) - weakRank(b) || (b.quality?.score ?? 0) - (a.quality?.score ?? 0) || pool.indexOf(a) - pool.indexOf(b))[0]
}
