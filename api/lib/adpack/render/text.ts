/**
 * Text wrapping + auto font-size fitting. Measurement uses the same font files
 * satori renders with, so line breaks are decided here (deterministically) and
 * satori only draws pre-broken, non-wrapping lines.
 */
import { measureText, type FontRef } from './fonts.js'

export interface FitSpec {
  text: string
  font: FontRef
  maxWidth: number
  /** Hard cap on lines. */
  maxLines: number
  /** Try to fit within this many lines first (down to `preferMinSize`). */
  preferLines?: number
  preferMinSize?: number
  maxSize: number
  minSize: number
  /** Absolute floor used before giving up (fits=false). Defaults to 60% of minSize. */
  floorSize?: number
  /** Line height as a multiple of font size. */
  lineHeight: number
  /** Re-wrap at the narrowest width that keeps the line count (even line lengths). */
  balance?: boolean
  /** Optional max total block height. */
  maxHeight?: number
}

export interface FittedText {
  text: string
  lines: string[]
  fontSize: number
  lineHeightPx: number
  /** Widest line (px). */
  width: number
  /** lines × line height (px). */
  height: number
  lineWidths: number[]
  fits: boolean
}

/** Collapse whitespace; the result is exactly what gets drawn (lines joined by single spaces). */
export function normalizeText(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function wrapWords(words: string[], font: FontRef, size: number, maxWidth: number): string[] | null {
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (measureText(w, font, size) > maxWidth) return null
    const next = cur ? `${cur} ${w}` : w
    if (!cur || measureText(next, font, size) <= maxWidth) {
      cur = next
    } else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Last resort: break inside words (never used unless a single token is wider than the box at floor size). */
function wrapChars(text: string, font: FontRef, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of Array.from(text)) {
    const next = cur + ch
    if (cur && measureText(next.trimStart(), font, size) > maxWidth) {
      lines.push(cur.trim())
      cur = ch
    } else {
      cur = next
    }
  }
  if (cur.trim()) lines.push(cur.trim())
  return lines
}

function balanceLines(words: string[], font: FontRef, size: number, maxWidth: number, lines: string[]): string[] {
  if (lines.length < 2) return lines
  const n = lines.length
  let lo = Math.max(...words.map((w) => measureText(w, font, size)))
  let hi = maxWidth
  let best = lines
  for (let i = 0; i < 14 && hi - lo > 2; i++) {
    const mid = (lo + hi) / 2
    const attempt = wrapWords(words, font, size, mid)
    if (attempt && attempt.length <= n) {
      best = attempt
      hi = mid
    } else {
      lo = mid
    }
  }
  return best
}

function build(text: string, lines: string[], spec: FitSpec, size: number, fits: boolean): FittedText {
  const lineWidths = lines.map((l) => measureText(l, spec.font, size))
  const lineHeightPx = Math.round(size * spec.lineHeight)
  return {
    text,
    lines,
    fontSize: size,
    lineHeightPx,
    width: Math.ceil(Math.max(0, ...lineWidths)),
    height: lineHeightPx * lines.length,
    lineWidths,
    fits,
  }
}

/** Largest font size (integer px) at which `text` fits the box. */
export function fitText(spec: FitSpec): FittedText {
  const text = normalizeText(spec.text)
  const words = text ? text.split(' ') : []
  if (!words.length) return build('', [], spec, spec.maxSize, true)
  const floor = Math.max(8, Math.round(spec.floorSize ?? spec.minSize * 0.6))

  const tryFit = (lineCap: number, minSize: number): FittedText | null => {
    for (let size = Math.round(spec.maxSize); size >= minSize; size -= Math.max(1, Math.round(size * 0.03))) {
      const lines = wrapWords(words, spec.font, size, spec.maxWidth)
      if (!lines || lines.length > lineCap) continue
      const height = Math.round(size * spec.lineHeight) * lines.length
      if (spec.maxHeight && height > spec.maxHeight) continue
      const finalLines = spec.balance ? balanceLines(words, spec.font, size, spec.maxWidth, lines) : lines
      return build(text, finalLines, spec, size, true)
    }
    return null
  }

  if (spec.preferLines && spec.preferLines < spec.maxLines) {
    const preferred = tryFit(spec.preferLines, Math.max(spec.minSize, spec.preferMinSize ?? spec.minSize))
    if (preferred) return preferred
  }
  const normal = tryFit(spec.maxLines, spec.minSize) ?? tryFit(spec.maxLines, floor)
  if (normal) return normal
  // Does not fit even at the floor: break inside words so nothing overflows horizontally.
  const lines = wrapChars(text, spec.font, floor, spec.maxWidth)
  return build(text, lines, spec, floor, false)
}
