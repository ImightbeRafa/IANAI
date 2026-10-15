/**
 * Round 11: keep the CLEAR carrier sheet of a patch / sticker grid.
 *
 * Round 10 SP: the six purple patches of the Sleeping Patches photo sit on a transparent film; the border flood keyed the
 * near-white film out with the backdrop, so the patches floated on the scene as loose squares (pasted look). A grid of
 * ≥ 4 similar pieces separated by narrow, even gaps is a sheet: the film rectangle = the pieces' joint box grown by
 * ~0.7 × the median gap (the film's margin). Inside it, outside the pieces, the cut-out keeps the film as a translucent
 * layer (alpha FILM_ALPHA, a firmer FILM_EDGE_ALPHA rim) instead of nothing. Never applied to a single product.
 */
import { components } from './pixels.js'

export const FILM_ALPHA = 0.24
export const FILM_EDGE_ALPHA = 0.5

export interface SheetFilm {
  /** Alpha (0–255) of the film per work pixel, 0 outside the film / on the pieces. */
  alpha: Uint8Array
  box: { x0: number; y0: number; x1: number; y1: number }
  pieces: number
}

export function sheetFilm(mask: Uint8Array, w: number, h: number): SheetFilm | null {
  const { list } = components(mask, w, h)
  if (list.length < 4) return null
  const areas = list.map((c) => c.area).sort((a, b) => a - b)
  // the pieces: the commonest size class (the pouch / box next to them is far larger)
  let best: typeof list = []
  for (const ref of list) {
    const group = list.filter((c) => c.area >= ref.area * 0.6 && c.area <= ref.area * 1.6)
    if (group.length > best.length) best = group
  }
  if (best.length < 4 || best[0].area < w * h * 0.002) return null
  void areas
  const x0 = Math.min(...best.map((c) => c.x0)), y0 = Math.min(...best.map((c) => c.y0))
  const x1 = Math.max(...best.map((c) => c.x1)), y1 = Math.max(...best.map((c) => c.y1))
  const fill = best.reduce((a, c) => a + c.area, 0) / ((x1 - x0 + 1) * (y1 - y0 + 1))
  if (fill < 0.45) return null
  // gaps between neighbouring pieces (horizontal and vertical), median
  const gaps: number[] = []
  for (const a of best) for (const b of best) {
    if (a === b) continue
    const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
    const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
    if (overlapY > (a.y1 - a.y0) * 0.5 && b.x0 > a.x1) gaps.push(b.x0 - a.x1)
    if (overlapX > (a.x1 - a.x0) * 0.5 && b.y0 > a.y1) gaps.push(b.y0 - a.y1)
  }
  if (!gaps.length) return null
  const g = gaps.sort((p, q) => p - q)[gaps.length >> 1]
  const pieceW = (x1 - x0) / Math.max(1, Math.round(Math.sqrt(best.length)))
  if (g > pieceW * 0.6) return null // loose pieces, not a sheet
  const m = Math.max(2, Math.round(g * 0.7))
  const bx0 = Math.max(0, x0 - m), by0 = Math.max(0, y0 - m), bx1 = Math.min(w - 1, x1 + m), by1 = Math.min(h - 1, y1 + m)
  const alpha = new Uint8Array(w * h)
  const rim = Math.max(1, Math.round(Math.min(w, h) * 0.002))
  const r = Math.max(2, Math.round(m * 0.6)) // rounded film corners
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const i = y * w + x
    if (mask[i]) continue
    const dx = Math.max(bx0 + r - x, x - (bx1 - r), 0), dy = Math.max(by0 + r - y, y - (by1 - r), 0)
    if (dx * dx + dy * dy > r * r) continue
    const edge = Math.min(x - bx0, bx1 - x, y - by0, by1 - y) < rim || (dx > 0 && dy > 0 && dx * dx + dy * dy > (r - rim) * (r - rim))
    alpha[i] = Math.round((edge ? FILM_EDGE_ALPHA : FILM_ALPHA) * 255)
  }
  return { alpha, box: { x0: bx0 / w, y0: by0 / h, x1: (bx1 + 1) / w, y1: (by1 + 1) / h }, pieces: best.length }
}
