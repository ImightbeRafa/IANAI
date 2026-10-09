/**
 * Layout primitives shared by the format templates: a tiny scene graph (text,
 * shapes, icons, zones) plus helpers that size text blocks and pills.
 */
import type { AdLanguage } from '../types.js'
import { contrastRatio, INK, readableOn, shade, WHITE, type Rgb } from './color.js'
import type { FontRef, ResolvedFonts } from './fonts.js'
import type { Frame } from './frame.js'
import { fitText, type FittedText } from './text.js'
import type { Box, TextRole } from './types.js'

export interface Palette {
  primary: Rgb
  secondary: Rgb
  accent: Rgb
  /** CTA pill fill + text. */
  cta: Rgb
  ctaText: Rgb
  /** Price/offer badge fill + text. */
  badge: Rgb
  badgeText: Rgb
  /** Benefit chips (on scene). */
  chip: Rgb
  chipText: Rgb
  chipIcon: Rgb
  chipIconMark: Rgb
}

export interface NormalizedCopy {
  headline: string
  subline: string
  bullets: string[]
  offer: string
  cta: string
}

export type Align = 'left' | 'center' | 'right'

export interface TextNode {
  kind: 'text'
  role: TextRole
  fitted: FittedText
  font: FontRef
  align: Align
  /** Tight box around the lines. */
  box: Box
  /** Fixed color when the text sits on a solid fill. */
  color?: Rgb
  fill?: Rgb
  /** Scene zone id when the text sits directly on the scene. */
  zone?: string
}

export interface RectNode {
  kind: 'rect'
  layer: 'under' | 'over'
  box: Box
  color: Rgb
  alpha?: number
  radius: number
  shadow?: 'soft' | 'strong'
  stroke?: { color: Rgb; width: number; alpha?: number }
  /** Set for pills/badges: the text (and icons) drawn on this fill, re-colored if the fill changes. */
  pill?: { role: TextRole; text: TextNode; icons: IconNode[] }
}

export interface IconNode {
  kind: 'icon'
  icon: 'check' | 'arrow_right' | 'arrow_down'
  box: Box
  color: Rgb
}

export type Node = TextNode | RectNode | IconNode

export interface Zone {
  id: string
  /** gradient-top/bottom: full-width band from the canvas edge; box: rounded panel behind the zone's text. */
  style: 'gradient-top' | 'gradient-bottom' | 'box'
}

export interface TemplateLayout {
  nodes: Node[]
  zones: Zone[]
  /** Area the product cut-out is fitted into (contain). */
  productBox?: Box
  productValign?: 'center' | 'bottom'
  logoBox?: Box
  /** Content fits its regions at this scale (no vertical overflow). */
  fits: boolean
  warnings: string[]
}

export interface Ctx {
  frame: Frame
  fonts: ResolvedFonts
  palette: Palette
  copy: NormalizedCopy
  language: AdLanguage
  /** Global type scale (shrinks when content does not fit). */
  s: number
  product?: { width: number; height: number }
  logo?: { width: number; height: number }
  /**
   * Exact product mode: the real cut-out is the product on every format, so every template
   * reserves a product box (formats that used to rely on the scene's product too).
   */
  exact?: boolean
}

/** Fonts used for each role. */
export function headingFont(ctx: Ctx): FontRef {
  return ctx.fonts.heading
}
export function bodyFont(ctx: Ctx, bold = false): FontRef {
  return { family: ctx.fonts.body.family, weight: bold ? ctx.fonts.body.boldWeight : ctx.fonts.body.weight }
}

/** Nominal size × ratio type scale × fit scale. */
export function sz(ctx: Ctx, base: number): number {
  return Math.round(base * ctx.frame.type * ctx.s)
}

/** Optical size factor per heading face (condensed faces can run larger, wide heavy ones smaller). */
export function headingSizeFactor(ctx: Ctx): number {
  const f = ctx.fonts.heading.family
  return f === 'Anton' ? 1.28 : f === 'Archivo Black' ? 0.92 : f === 'DM Serif Display' ? 1.06 : 1
}

/** Headline line-height depends on the face (condensed/display faces need less). */
export function headlineLh(ctx: Ctx): number {
  const f = ctx.fonts.heading.family
  return f === 'Anton' ? 1.08 : f === 'DM Serif Display' ? 1.08 : f === 'Archivo Black' ? 1.1 : 1.1
}

export interface TextOpts {
  x: number
  y: number
  maxW: number
  align: Align
  font: FontRef
  size: number
  min: number
  lines: number
  prefer?: number
  preferMin?: number
  lh?: number
  balance?: boolean
  maxH?: number
  color?: Rgb
  fill?: Rgb
  zone?: string
}

export function textNode(role: TextRole, str: string, o: TextOpts): TextNode {
  const fitted = fitText({
    text: str,
    font: o.font,
    maxWidth: o.maxW,
    maxLines: o.lines,
    preferLines: o.prefer,
    preferMinSize: o.preferMin,
    maxSize: o.size,
    minSize: o.min,
    lineHeight: o.lh ?? 1.2,
    balance: o.balance ?? true,
    maxHeight: o.maxH,
  })
  const w = Math.min(o.maxW, fitted.width)
  const x = o.align === 'left' ? o.x : o.align === 'right' ? o.x + o.maxW - w : o.x + (o.maxW - w) / 2
  return {
    kind: 'text',
    role,
    fitted,
    font: o.font,
    align: o.align,
    box: { x: Math.round(x), y: Math.round(o.y), w: Math.ceil(w), h: fitted.height },
    color: o.color ?? (o.fill ? readableOn(o.fill) : undefined),
    fill: o.fill,
    zone: o.zone,
  }
}

export interface PillOpts {
  x: number
  y: number
  maxW: number
  align: Align
  fill: Rgb
  textColor?: Rgb
  font: FontRef
  size: number
  min: number
  lines?: number
  /** Try this many lines first (down to preferMin) before using `lines`. */
  prefer?: number
  preferMin?: number
  padX?: number
  padY?: number
  radius?: number
  icon?: { kind: IconNode['icon']; bg?: Rgb; mark: Rgb; position?: 'lead' | 'trail' }
  shadow?: RectNode['shadow']
  lh?: number
  /** Force a minimum pill width (e.g. CTA). */
  minW?: number
}

export interface Pill {
  nodes: Node[]
  box: Box
  text: TextNode
}

/** Rounded pill/badge with centered text and an optional leading/trailing icon. */
export function pill(role: TextRole, str: string, o: PillOpts): Pill {
  const padX = o.padX ?? Math.round(o.size * 0.9)
  const padY = o.padY ?? Math.round(o.size * 0.5)
  const iconD = o.icon ? Math.round(o.size * (o.icon.bg ? 1.2 : 0.9)) : 0
  const iconGap = o.icon ? Math.round(o.size * 0.45) : 0
  const lh = o.lh ?? 1.2
  const inner = o.maxW - padX * 2 - iconD - iconGap
  const t = textNode(role, str, {
    x: 0,
    y: 0,
    maxW: Math.max(40, inner),
    align: 'left',
    font: o.font,
    size: o.size,
    min: o.min,
    lines: o.lines ?? 1,
    ...(o.prefer ? { prefer: o.prefer, preferMin: o.preferMin } : {}),
    lh,
    color: o.textColor ?? readableOn(o.fill),
    fill: o.fill,
  })
  const contentW = iconD + iconGap + t.box.w
  const w = Math.max(o.minW ?? 0, Math.min(o.maxW, contentW + padX * 2))
  const h = Math.max(t.box.h, iconD) + padY * 2
  const x = o.align === 'left' ? o.x : o.align === 'right' ? o.x + o.maxW - w : o.x + (o.maxW - w) / 2
  const box = { x: Math.round(x), y: Math.round(o.y), w: Math.round(w), h: Math.round(h) }
  const contentX = box.x + (box.w - contentW) / 2
  const trail = o.icon?.position === 'trail'
  const textX = trail ? contentX : contentX + iconD + iconGap
  t.box = { x: Math.round(textX), y: Math.round(box.y + (box.h - t.box.h) / 2), w: t.box.w, h: t.box.h }
  const multiLine = t.fitted.lines.length > 1
  const radius = o.radius ?? (multiLine ? Math.min(Math.round(box.h / 2), Math.round(o.size * 0.9)) : Math.round(box.h / 2))
  const rect: RectNode = { kind: 'rect', layer: 'over', box, color: o.fill, radius, shadow: o.shadow, pill: { role, text: t, icons: [] } }
  const nodes: Node[] = [rect]
  if (o.icon) {
    const ix = trail ? textX + t.box.w + iconGap : contentX
    const ib = { x: Math.round(ix), y: Math.round(box.y + (box.h - iconD) / 2), w: iconD, h: iconD }
    if (o.icon.bg) nodes.push({ kind: 'rect', layer: 'over', box: ib, color: o.icon.bg, radius: iconD / 2 })
    const icon: IconNode = { kind: 'icon', icon: o.icon.kind, box: ib, color: o.icon.mark }
    if (!o.icon.bg) rect.pill!.icons.push(icon)
    nodes.push(icon)
  }
  nodes.push(t)
  return { nodes, box, text: t }
}

/** Shift every node of a group vertically. */
export function shiftNodes(nodes: Node[], dy: number): void {
  for (const n of nodes) n.box = { ...n.box, y: n.box.y + dy }
}

/** Logo slot in a top corner of the safe area. Returns the slot and the y below it. */
export function logoSlot(ctx: Ctx, side: 'left' | 'right'): { box?: Box; nextY: number } {
  const { safe } = ctx.frame
  if (!ctx.logo) return { nextY: safe.y }
  const maxH = Math.round(60 * ctx.frame.type)
  const maxW = 240
  const s = Math.min(maxW / ctx.logo.width, maxH / ctx.logo.height)
  const w = Math.max(1, Math.round(ctx.logo.width * s))
  const h = Math.max(1, Math.round(ctx.logo.height * s))
  const x = side === 'left' ? safe.x : safe.x + safe.w - w
  return { box: { x, y: safe.y, w, h }, nextY: safe.y + h + Math.round(28 * ctx.frame.type) }
}

/** Build the brand palette from DNA colors (with readable text colors baked in). */
export function makePalette(primary: Rgb | null, secondary: Rgb | null, accent: Rgb | null): Palette {
  const p = primary ?? { r: 17, g: 24, b: 39 }
  const sec = secondary ?? shade(p, -0.35)
  // Badge wants to pop: accent → secondary → a warm yellow when the brand gave only one color.
  const badge = accent ?? secondary ?? (primary ? p : { r: 255, g: 214, b: 10 })
  const a = accent ?? badge
  const cta = p
  const chip = WHITE
  const chipIcon = contrastRatio(p, chip) >= 2 ? p : shade(p, -0.5)
  return {
    primary: p,
    secondary: sec,
    accent: a,
    cta,
    ctaText: readableOn(cta),
    badge,
    badgeText: readableOn(badge),
    chip,
    chipText: INK,
    chipIcon,
    chipIconMark: readableOn(chipIcon),
  }
}

/** A tone of `c` that is distinguishable from `on` (for a CTA sitting on a brand card). */
export function contrastingFill(c: Rgb, on: Rgb): Rgb {
  if (contrastRatio(c, on) >= 1.8) return c
  return readableOn(on)
}
