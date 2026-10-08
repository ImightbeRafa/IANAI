import type { AdFormat, AspectRatio } from '../types.js'
import type { Box } from './types.js'

export const RATIO_SIZE: Record<AspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
}

export const ALL_RATIOS: AspectRatio[] = ['1:1', '4:5', '9:16']

export interface Frame {
  ratio: AspectRatio
  W: number
  H: number
  /** Text-safe area. */
  safe: Box
  /** Relative type scale per ratio (taller canvases get slightly larger type). */
  type: number
  tall: boolean
}

/**
 * Safe area per ratio. 9:16 follows Meta Stories/Reels guidance: keep text out of
 * the top ~14% and bottom ~20%; feed ratios use a uniform ~5.5% margin.
 */
export function makeFrame(ratio: AspectRatio): Frame {
  const { width: W, height: H } = RATIO_SIZE[ratio]
  if (ratio === '9:16') {
    const top = Math.round(H * 0.14)
    const bottom = Math.round(H * 0.2)
    const side = 64
    return { ratio, W, H, safe: { x: side, y: top, w: W - side * 2, h: H - top - bottom }, type: 1.1, tall: true }
  }
  const m = 60
  return { ratio, W, H, safe: { x: m, y: m, w: W - m * 2, h: H - m * 2 }, type: ratio === '4:5' ? 1.04 : 1, tall: false }
}

export const right = (b: Box) => b.x + b.w
export const bottom = (b: Box) => b.y + b.h

export function inside(inner: Box, outer: Box, tolerance = 0.5): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance
  )
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Where each format puts copy, so the scene prompt can ask for clean negative space
 * there (and keep the product away from it). Plain-language hint for the scene model.
 */
export function copySpaceHint(format: AdFormat, ratio: AspectRatio): string {
  const tall = ratio === '9:16'
  switch (format) {
    case 'offer_graphic':
      return 'clean, uncluttered background; keep the top third and the left half free of objects; product entirely in the right half, label fully visible'
    case 'before_after':
      // Left/right at every ratio: one scene is cover-fit to all ratios and the template always splits vertically.
      return 'split composition: "before" state on the left half, "after" state on the right half, divided at the vertical center line; keep the top 20% simple'
    case 'how_to_steps':
      return 'keep the left 60% calm and low-detail (cards go there); product entirely in the right third, label fully visible; keep the top 25% simple'
    case 'variant_card':
      return 'subject centered in the upper half; lower half simple, plain backdrop (a color card covers it)'
    case 'ugc_person':
      return 'authentic smartphone photo of a person with the product; face in the middle; keep the upper-middle area readable'
    case 'handheld_overlay':
      return 'product held in a hand, lifestyle setting; keep the top 30% calm (sky, wall, blurred background)'
    case 'explainer':
      // Callout cards sit in a bottom band above the button at every ratio.
      return 'product centered in the middle of the frame, slightly above center; keep the top 25% simple and the lower third calm and low-detail (callout cards go there)'
  }
}
