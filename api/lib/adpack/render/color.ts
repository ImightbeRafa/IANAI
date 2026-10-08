/**
 * Color helpers for the Ad Pack renderer: parsing, WCAG luminance/contrast and
 * readable text color selection. Pure functions, no deps.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export const WHITE: Rgb = { r: 255, g: 255, b: 255 }
/** Near-black used for dark text (pure black looks harsh on photos). */
export const INK: Rgb = { r: 17, g: 17, b: 17 }

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#e11d48',
  green: '#16a34a',
  blue: '#2563eb',
  yellow: '#facc15',
  orange: '#f97316',
  purple: '#7c3aed',
  pink: '#ec4899',
  gray: '#6b7280',
  grey: '#6b7280',
  navy: '#1e3a8a',
  teal: '#0d9488',
  gold: '#d4a017',
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/** Parse #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() or a few named colors. Returns null when invalid. */
export function parseColor(input: string | undefined | null): Rgb | null {
  if (!input || typeof input !== 'string') return null
  let s = input.trim().toLowerCase()
  if (NAMED[s]) s = NAMED[s]
  const hex = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }
  const rgb = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/)
  if (rgb) return { r: clamp255(+rgb[1]), g: clamp255(+rgb[2]), b: clamp255(+rgb[3]) }
  return null
}

export function toHex(c: Rgb): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

export function rgba(c: Rgb, a: number): string {
  return `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

const channel = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance (0–1). */
export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

export function contrastFromLuminance(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  return contrastFromLuminance(luminance(a), luminance(b))
}

/** Alpha-blend `top` over `bottom` (sRGB space, like the compositor). */
export function blend(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
  }
}

/** White or ink, whichever reads better on `bg` (one of them always reaches ≥ 4.5:1). */
export function readableOn(bg: Rgb): Rgb {
  return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK
}

/** Lighten (amount > 0) or darken (amount < 0) towards white/black. */
export function shade(c: Rgb, amount: number): Rgb {
  return amount >= 0 ? blend(WHITE, amount, c) : blend({ r: 0, g: 0, b: 0 }, -amount, c)
}

export function sameColor(a: Rgb, b: Rgb): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 12
}
