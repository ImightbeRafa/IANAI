/**
 * Layout FAMILIES: distinct visual systems that each implement all 7 formats.
 *
 * A family decides WHERE copy lives (side column, solid panel, type scrim, inset card,
 * native stickers…) and HOW each element looks (type scale, list/chip style, offer and
 * CTA treatment, palette usage). The format decides WHAT is drawn (headline, subline,
 * benefits / steps / tags / callouts, before-after labels, offer, CTA, product slot), so
 * every family draws exactly the same strings for a given format and the renderer's
 * guarantees (exact text, safe zones, fit, contrast, layoutReport) hold for all of them.
 *
 * `bold_pill` is the original template set (templates.ts), kept byte-for-byte.
 */
import type { AdFormat, LayoutFamily } from '../types.js'
import { contrastRatio, ensureReadableFill, INK, luminance, readableOn, readableTint, shade, WHITE, type Rgb } from './color.js'
import { bottom, right } from './frame.js'
import {
  bodyFont,
  contrastingFill,
  headingFont,
  headingSizeFactor,
  headlineLh,
  pill,
  shiftNodes,
  sz,
  textNode,
  type Align,
  type Ctx,
  type Node,
  type Pill,
  type RectNode,
  type TemplateLayout,
  type TextNode,
  type Zone,
} from './layout.js'
import { TEMPLATES } from './templates.js'
import type { Box } from './types.js'

export type { LayoutFamily }

export const ALL_FAMILIES: LayoutFamily[] = ['bold_pill', 'editorial_minimal', 'split_panel', 'full_bleed_type', 'badge_corner', 'framed_card', 'ugc_native']

export function isLayoutFamily(v: unknown): v is LayoutFamily {
  return typeof v === 'string' && (ALL_FAMILIES as string[]).includes(v)
}

const ALL_FORMATS_LIST: AdFormat[] = ['offer_graphic', 'before_after', 'how_to_steps', 'variant_card', 'ugc_person', 'handheld_overlay', 'explainer']

export interface FamilySpec {
  id: LayoutFamily
  label: { es: string; en: string }
  /** One line for agents / docs. */
  description: string
  /** Formats this family is rotated onto by default (all formats render; this is taste). */
  formats: AdFormat[]
  /** Placement variants in preference order (the renderer tries the next one when text would cover the product). */
  placements(format: AdFormat): string[]
  /** Scene-prompt hint: where the product goes and which area must stay calm for this family's copy. */
  sceneHint(format: AdFormat): string
}

const except = (...f: AdFormat[]) => ALL_FORMATS_LIST.filter((x) => !f.includes(x))

export const FAMILY_SPECS: Record<LayoutFamily, FamilySpec> = {
  bold_pill: {
    id: 'bold_pill',
    label: { es: 'Píldoras bold', en: 'Bold pills' },
    description: 'Big headline, white benefit pills with check icons, price badge and a rounded CTA button (classic performance ad).',
    formats: ALL_FORMATS_LIST,
    placements: () => ['default', 'mirror'],
    sceneHint: () => '',
  },
  editorial_minimal: {
    id: 'editorial_minimal',
    label: { es: 'Editorial minimal', en: 'Editorial minimal' },
    description: 'Magazine look: large headline in the brand heading face, thin accent rule, hairline-separated list, price as type and a text-link CTA. No pills.',
    formats: except('ugc_person'),
    placements: (f) => (f === 'before_after' ? ['top'] : ['left', 'right']),
    sceneHint: (f) =>
      f === 'before_after'
        ? ''
        : 'airy, minimal composition with generous negative space; product in the right half of the frame; the left half and the bottom edge calm and low-detail (large editorial type sits there)',
  },
  split_panel: {
    id: 'split_panel',
    label: { es: 'Panel dividido', en: 'Split panel' },
    description: 'A solid brand-color panel holds all the copy (checks, price, full-width button); the photo owns the other side. Strong brand color usage.',
    formats: except('ugc_person'),
    placements: (f) => (f === 'before_after' ? ['bottom'] : ['left', 'right', 'bottom']),
    sceneHint: (f) =>
      f === 'before_after'
        ? ''
        : 'product and subject entirely in the right half of the frame, slightly above center; the left half is covered by a solid color panel, so keep nothing important there',
  },
  full_bleed_type: {
    id: 'full_bleed_type',
    label: { es: 'Tipografía a sangre', en: 'Full-bleed type' },
    description: 'Huge headline over a deep photographic scrim, compact inline facts, small outline CTA. Type-led, poster-like.',
    formats: ALL_FORMATS_LIST,
    placements: () => ['bottom', 'top'],
    sceneHint: (f) =>
      f === 'before_after'
        ? ''
        : 'product in the upper half of the frame; the lower half darker, simple and low-detail (a large headline sits there over a shadow gradient)',
  },
  badge_corner: {
    id: 'badge_corner',
    label: { es: 'Sticker de precio', en: 'Price sticker' },
    description: 'Clean product image, compact headline, round price sticker in a corner, a white spec strip and a squared CTA button.',
    formats: except('before_after'),
    placements: () => ['left', 'right'],
    sceneHint: (f) =>
      f === 'before_after'
        ? ''
        : 'clean, uncluttered product shot; product centered slightly below the middle; keep the top corners and the bottom strip simple',
  },
  framed_card: {
    id: 'framed_card',
    label: { es: 'Tarjeta enmarcada', en: 'Framed card' },
    description: 'Photo inside a brand-color frame with rounded corners; a white card carries headline, checks, price and button.',
    formats: except('ugc_person'),
    placements: () => ['bottom', 'top'],
    sceneHint: (f) =>
      f === 'before_after' ? '' : 'product in the upper-middle of the frame; the lower 40% simple and low-detail (a white card covers it)',
  },
  studio_hero: {
    id: 'studio_hero',
    label: { es: 'Estudio editorial', en: 'Studio editorial' },
    description: 'Approved v1 look (cream, product top, text bottom): studio canvas with the real photo bled in large, kicker with accent rule, big headline, price as type with the shipping rule, facts line, text-link CTA and a large logo badge. Used automatically for studio-bleed renders.',
    formats: ['offer_graphic', 'variant_card', 'explainer'],
    placements: () => ['default'],
    sceneHint: () => '',
  },
  studio_top: {
    id: 'studio_top',
    label: { es: 'Estudio titular arriba', en: 'Estudio titular arriba' },
    description: 'Studio canvas: headline with accent underline on top, the real photo bled in large, price + facts + CTA row at the bottom. Studio-bleed renders only.',
    formats: ['offer_graphic', 'variant_card', 'explainer'],
    placements: () => ['default'],
    sceneHint: () => '',
  },
  studio_navy_top: {
    id: 'studio_navy_top',
    label: { es: 'Estudio banda navy arriba', en: 'Estudio banda navy arriba' },
    description: 'Navy band on top with headline, price and shipping rule; the real photo bled in large on the studio canvas; CTA + logo row at the bottom. Studio-bleed renders only.',
    formats: ['offer_graphic', 'variant_card', 'explainer'],
    placements: () => ['default'],
    sceneHint: () => '',
  },
  studio_navy_bottom: {
    id: 'studio_navy_bottom',
    label: { es: 'Estudio banda navy abajo', en: 'Estudio banda navy abajo' },
    description: 'Real photo bled in large on the studio canvas; navy band at the bottom with headline, price, shipping rule, CTA and logo. Studio-bleed renders only.',
    formats: ['offer_graphic', 'variant_card', 'explainer'],
    placements: () => ['default'],
    sceneHint: () => '',
  },
  ugc_native: {
    id: 'ugc_native',
    label: { es: 'Post nativo', en: 'Native post' },
    description: 'Looks like a native social post: comment-reply bubble with the headline, caption stickers, a link sticker as CTA; minimal branding.',
    formats: ['ugc_person', 'handheld_overlay', 'how_to_steps', 'before_after'],
    placements: () => ['top', 'bottom'],
    sceneHint: (f) =>
      f === 'before_after'
        ? ''
        : 'authentic smartphone photo in a real, lived-in setting, natural light; product in use in the lower-middle of the frame; upper third simple',
  },
}

// ---------------------------------------------------------------------------
// Content model per format (identical for every family)
// ---------------------------------------------------------------------------

type ListKind = 'benefits' | 'steps' | 'tags' | 'callouts'

interface Content {
  headline: string
  subline: string
  list: { kind: ListKind; items: string[] } | null
  split: { labels: [string, string]; items: [string | undefined, string | undefined] } | null
  offer: string
  cta: string
  /**
   * Format places the product cut-out (when given). Exact mode (ctx.exact): the real cut-out is
   * the product on EVERY format, so every family reserves its product slot on every format.
   */
  cutout: boolean
}

function contentOf(ctx: Ctx, warnings: string[]): Content {
  const f = ctx.format ?? 'offer_graphic'
  const { copy } = ctx
  const base = { headline: copy.headline, subline: copy.subline, offer: copy.offer, cta: copy.cta, list: null, split: null, cutout: Boolean(ctx.exact) } as Content
  switch (f) {
    case 'offer_graphic':
      return { ...base, list: copy.bullets.length ? { kind: 'benefits', items: copy.bullets.slice(0, 4) } : null, cutout: true }
    case 'variant_card':
      return { ...base, list: copy.bullets.length ? { kind: 'tags', items: copy.bullets.slice(0, 4) } : null, cutout: true }
    case 'explainer':
      return { ...base, list: copy.bullets.length ? { kind: 'callouts', items: copy.bullets.slice(0, 4) } : null, cutout: true }
    case 'how_to_steps':
      if (!copy.bullets.length) warnings.push('how_to_steps: no bullets → no step cards')
      return { ...base, list: copy.bullets.length ? { kind: 'steps', items: copy.bullets.slice(0, 4) } : null }
    case 'before_after': {
      if (copy.bullets.length > 2) warnings.push('before_after: only the first 2 bullets are drawn')
      const labels: [string, string] = ctx.language === 'en' ? ['Before', 'After'] : ['Antes', 'Después']
      return { ...base, split: { labels, items: [copy.bullets[0], copy.bullets[1]] } }
    }
    case 'ugc_person':
    case 'handheld_overlay':
      if (copy.bullets.length) warnings.push(`${f}: bullets not drawn (format uses headline only)`)
      return base
  }
}

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

const boxOf = (nodes: Node[]): Box | null => {
  if (!nodes.length) return null
  const x0 = Math.min(...nodes.map((n) => n.box.x))
  const y0 = Math.min(...nodes.map((n) => n.box.y))
  const x1 = Math.max(...nodes.map((n) => n.box.x + n.box.w))
  const y1 = Math.max(...nodes.map((n) => n.box.y + n.box.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function moveNodes(nodes: Node[], dx: number, dy: number): void {
  for (const n of nodes) {
    n.box = { ...n.box, x: Math.round(n.box.x + dx), y: Math.round(n.box.y + dy) }
    if (n.kind === 'rect' && n.hole) n.hole = { ...n.hole, box: { ...n.hole.box, x: n.hole.box.x + dx, y: n.hole.box.y + dy } }
  }
}

/** Vertical stack builder: each step receives the current y and returns the nodes it added. */
class Stack {
  nodes: Node[] = []
  y: number
  private first = true
  constructor(y: number) {
    this.y = y
  }
  add(gap: number, build: (y: number) => { nodes: Node[]; bottom: number } | null): void {
    const y = this.first ? this.y : this.y + gap
    const res = build(y)
    if (!res || !res.nodes.length) return
    this.nodes.push(...res.nodes)
    this.y = res.bottom
    this.first = false
  }
  get empty() {
    return this.nodes.length === 0
  }
}

type Surface = { zone: string } | { fill: Rgb }
const surf = (s: Surface) => ('fill' in s ? { fill: s.fill, color: readableOn(s.fill) } : { zone: s.zone })

// ---------------------------------------------------------------------------
// Block builders (shared by the families, styled by parameters)
// ---------------------------------------------------------------------------

function headlineText(ctx: Ctx, text: string, o: { x: number; y: number; w: number; align: Align; size: number; min: number; lines?: number; prefer?: number; lh?: number; surface: Surface; font?: 'heading' | 'body' }): TextNode {
  const k = o.font === 'body' ? 1 : headingSizeFactor(ctx)
  return textNode('headline', text, {
    x: o.x,
    y: o.y,
    maxW: o.w,
    align: o.align,
    font: o.font === 'body' ? bodyFont(ctx, true) : headingFont(ctx),
    size: sz(ctx, o.size * k),
    min: sz(ctx, o.min * k),
    lines: o.lines ?? 3,
    prefer: o.prefer ?? 2,
    preferMin: sz(ctx, o.size * k * 0.68),
    lh: o.lh ?? headlineLh(ctx),
    ...surf(o.surface),
  })
}

function sublineText(ctx: Ctx, text: string, o: { x: number; y: number; w: number; align: Align; size: number; lines?: number; surface: Surface; bold?: boolean }): TextNode {
  return textNode('subline', text, {
    x: o.x,
    y: o.y,
    maxW: o.w,
    align: o.align,
    font: bodyFont(ctx, o.bold ?? false),
    size: sz(ctx, o.size),
    min: sz(ctx, Math.max(20, o.size * 0.7)),
    lines: o.lines ?? 2,
    lh: 1.32,
    ...surf(o.surface),
  })
}

/** Rows: filled circle with a check (or number) + text. */
function markerList(
  ctx: Ctx,
  items: string[],
  o: { x: number; y: number; w: number; surface: Surface; size: number; markerFill: Rgb; numbered: boolean; gap?: number; start?: number },
): { nodes: Node[]; bottom: number } {
  const nodes: Node[] = []
  const d = sz(ctx, o.size * (o.numbered ? 1.55 : 1.3))
  const gapX = sz(ctx, 18)
  let y = o.y
  items.forEach((it, i) => {
    const t = textNode('bullet', it, {
      x: o.x + d + gapX,
      y,
      maxW: o.w - d - gapX,
      align: 'left',
      font: bodyFont(ctx, true),
      size: sz(ctx, o.size),
      min: sz(ctx, Math.max(18, o.size * 0.7)),
      lines: 2,
      lh: 1.24,
      ...surf(o.surface),
    })
    const rowH = Math.max(d, t.box.h)
    t.box.y = Math.round(y + (rowH - t.box.h) / 2)
    const mb = { x: o.x, y: Math.round(y + (rowH - d) / 2), w: d, h: d }
    nodes.push({ kind: 'rect', layer: 'over', box: mb, color: o.markerFill, radius: d / 2 })
    if (o.numbered) {
      const num = textNode('step_number', String((o.start ?? 0) + i + 1), {
        x: mb.x,
        y: 0,
        maxW: d,
        align: 'center',
        font: headingFont(ctx),
        size: Math.round(d * 0.52),
        min: Math.round(d * 0.3),
        lines: 1,
        lh: 1.1,
        fill: o.markerFill,
      })
      num.box.y = Math.round(mb.y + (d - num.box.h) / 2)
      nodes.push(num)
    } else {
      nodes.push({ kind: 'icon', icon: 'check', box: mb, color: readableOn(o.markerFill) })
    }
    nodes.push(t)
    y += rowH + sz(ctx, o.gap ?? 16)
  })
  return { nodes, bottom: items.length ? y - sz(ctx, o.gap ?? 16) : o.y }
}

/** Editorial rows: small accent square + text, hairlines between rows (zone-colored). */
function hairlineList(ctx: Ctx, items: string[], o: { x: number; y: number; w: number; zone: string; accent: Rgb; size: number; numbered?: boolean }): { nodes: Node[]; bottom: number } {
  const nodes: Node[] = []
  const padY = sz(ctx, 14)
  const line = Math.max(2, Math.round(sz(ctx, 2)))
  const markW = o.numbered ? sz(ctx, o.size * 1.5) : sz(ctx, 30)
  let y = o.y
  items.forEach((it, i) => {
    const t = textNode('bullet', it, {
      x: o.x + markW,
      y: y + padY,
      maxW: o.w - markW,
      align: 'left',
      font: bodyFont(ctx, true),
      size: sz(ctx, o.size),
      min: sz(ctx, Math.max(18, o.size * 0.7)),
      lines: 2,
      lh: 1.24,
      zone: o.zone,
    })
    if (o.numbered) {
      const num = textNode('step_number', String(i + 1), {
        x: o.x,
        y: y + padY,
        maxW: markW - sz(ctx, 10),
        align: 'left',
        font: headingFont(ctx),
        size: sz(ctx, o.size * 1.2),
        min: sz(ctx, o.size * 0.8),
        lines: 1,
        lh: 1.0,
        zone: o.zone,
      })
      num.box.y = Math.round(t.box.y + (t.fitted.lineHeightPx - num.box.h) / 2)
      nodes.push(num)
    } else {
      const m = sz(ctx, 11)
      nodes.push({ kind: 'rect', layer: 'over', box: { x: o.x, y: Math.round(t.box.y + (t.fitted.lineHeightPx - m) / 2), w: m, h: m }, color: o.accent, radius: 2, decor: true })
    }
    nodes.push(t)
    y = bottom(t.box) + padY
    if (i < items.length - 1) {
      nodes.push({ kind: 'rect', layer: 'over', box: { x: o.x, y, w: o.w, h: line }, color: WHITE, alpha: 0.45, radius: 0, zone: o.zone, decor: true })
      y += line
    }
  })
  return { nodes, bottom: y }
}

/** Items flowing on one or more rows, separated by small accent dots. */
function inlineList(ctx: Ctx, items: string[], o: { x: number; y: number; w: number; zone: string; dot: Rgb; size: number }): { nodes: Node[]; bottom: number } {
  const nodes: Node[] = []
  const d = Math.max(6, sz(ctx, 10))
  const gap = sz(ctx, 18)
  let cx = o.x
  let cy = o.y
  let rowH = 0
  for (const it of items) {
    const t = textNode('bullet', it, { x: 0, y: 0, maxW: o.w, align: 'left', font: bodyFont(ctx, true), size: sz(ctx, o.size), min: sz(ctx, Math.max(18, o.size * 0.72)), lines: 2, lh: 1.25, zone: o.zone })
    const needDot = cx > o.x
    const need = (needDot ? gap * 2 + d : 0) + t.box.w
    if (needDot && cx + need > o.x + o.w) {
      cx = o.x
      cy += rowH + sz(ctx, 10)
      rowH = 0
    }
    if (cx > o.x) {
      const lh = t.fitted.lineHeightPx
      nodes.push({ kind: 'rect', layer: 'over', box: { x: Math.round(cx + gap), y: Math.round(cy + (lh - d) / 2), w: d, h: d }, color: o.dot, radius: d / 2, decor: true })
      cx += gap * 2 + d
    }
    t.box = { ...t.box, x: Math.round(cx), y: Math.round(cy) }
    nodes.push(t)
    cx += t.box.w
    rowH = Math.max(rowH, t.box.h)
  }
  return { nodes, bottom: items.length ? cy + rowH : o.y }
}

/** Sticker pills (small radius) — stacked or flowing. */
function stickers(ctx: Ctx, items: string[], o: { x: number; y: number; w: number; align: Align; fill: Rgb; size: number; flow: boolean; numbered?: { fill: Rgb } }): { nodes: Node[]; bottom: number } {
  const nodes: Node[] = []
  const gap = sz(ctx, 12)
  let cx = o.x
  let cy = o.y
  let rowH = 0
  items.forEach((it, i) => {
    const p = pill('bullet', it, {
      x: 0,
      y: 0,
      maxW: o.w - (o.numbered ? sz(ctx, o.size * 1.9) : 0),
      align: 'left',
      fill: o.fill,
      font: bodyFont(ctx, true),
      size: sz(ctx, o.size),
      min: sz(ctx, Math.max(18, o.size * 0.72)),
      lines: 2,
      lh: 1.22,
      padX: sz(ctx, 20),
      padY: sz(ctx, 12),
      radius: sz(ctx, 12),
    })
    const parts: Node[] = []
    let w = p.box.w
    if (o.numbered) {
      const d = p.box.h
      const nb = { x: 0, y: 0, w: d, h: d }
      const num = textNode('step_number', String(i + 1), { x: 0, y: 0, maxW: d, align: 'center', font: headingFont(ctx), size: Math.round(d * 0.5), min: Math.round(d * 0.3), lines: 1, lh: 1.1, fill: o.numbered.fill })
      num.box.y = Math.round((d - num.box.h) / 2)
      parts.push({ kind: 'rect', layer: 'over', box: nb, color: o.numbered.fill, radius: sz(ctx, 12) }, num)
      moveNodes(p.nodes, d + sz(ctx, 8), 0)
      w += d + sz(ctx, 8)
    }
    parts.push(...p.nodes)
    if (o.flow) {
      if (cx > o.x && cx + w > o.x + o.w) {
        cx = o.x
        cy += rowH + gap
        rowH = 0
      }
      moveNodes(parts, cx, cy)
      cx += w + gap
      rowH = Math.max(rowH, p.box.h)
    } else {
      const x = o.align === 'left' ? o.x : o.align === 'right' ? o.x + o.w - w : o.x + (o.w - w) / 2
      moveNodes(parts, x, cy)
      cy += p.box.h + gap
    }
    nodes.push(...parts)
  })
  const b = boxOf(nodes)
  // Flowing rows are left-packed; center them as a block when asked.
  if (o.flow && b && o.align !== 'left') moveNodes(nodes, o.align === 'center' ? (o.x + (o.w - b.w) / 2 - b.x) : (o.x + o.w - b.w - b.x), 0)
  return { nodes, bottom: b ? b.y + b.h : o.y }
}

function button(ctx: Ctx, o: { x: number; y: number; maxW: number; align: Align; fill: Rgb; size: number; radius: number; minW?: number; shadow?: RectNode['shadow']; padX?: number; padY?: number }): Pill | null {
  if (!ctx.copy.cta) return null
  const ink = readableOn(o.fill)
  return pill('cta', ctx.copy.cta, {
    x: o.x,
    y: o.y,
    maxW: o.maxW,
    align: o.align,
    fill: o.fill,
    textColor: ink,
    font: bodyFont(ctx, true),
    size: sz(ctx, o.size),
    min: sz(ctx, Math.max(20, o.size * 0.72)),
    padX: o.padX ?? sz(ctx, 40),
    padY: o.padY ?? sz(ctx, 22),
    radius: o.radius,
    minW: o.minW,
    icon: { kind: 'arrow_right', mark: ink, position: 'trail' },
    shadow: o.shadow,
  })
}

/** CTA as type: text + arrow + underline, all in the zone's text color (or on a fill). */
function ctaLink(ctx: Ctx, o: { x: number; y: number; maxW: number; align: Align; surface: Surface; size: number; underline?: boolean }): { nodes: Node[]; box: Box } | null {
  if (!ctx.copy.cta) return null
  const size = sz(ctx, o.size)
  const iconD = Math.round(size * 1.05)
  const gap = Math.round(size * 0.35)
  const t = textNode('cta', ctx.copy.cta, { x: 0, y: 0, maxW: o.maxW - iconD - gap, align: 'left', font: bodyFont(ctx, true), size, min: sz(ctx, Math.max(20, o.size * 0.72)), lines: 1, lh: 1.2, ...surf(o.surface) })
  const w = t.box.w + gap + iconD
  const x = o.align === 'left' ? o.x : o.align === 'right' ? o.x + o.maxW - w : o.x + (o.maxW - w) / 2
  t.box = { ...t.box, x: Math.round(x), y: Math.round(o.y) }
  const iconColor = 'fill' in o.surface ? readableOn(o.surface.fill) : WHITE
  const zone = 'zone' in o.surface ? o.surface.zone : undefined
  const nodes: Node[] = [t, { kind: 'icon', icon: 'arrow_right', box: { x: Math.round(x + t.box.w + gap), y: Math.round(o.y + (t.box.h - iconD) / 2), w: iconD, h: iconD }, color: iconColor, ...(zone ? { zone } : {}) }]
  let h = t.box.h
  if (o.underline !== false) {
    const lw = Math.max(2, Math.round(size * 0.09))
    nodes.push({ kind: 'rect', layer: 'over', box: { x: Math.round(x), y: Math.round(o.y + t.box.h + size * 0.12), w: Math.round(w), h: lw }, color: iconColor, radius: lw / 2, decor: true, ...(zone ? { zone } : {}) })
    h += Math.round(size * 0.12) + lw
  }
  return { nodes, box: { x: Math.round(x), y: Math.round(o.y), w: Math.round(w), h } }
}

/** Outline pill CTA on the scene (stroke + text + arrow follow the zone's text color). */
function ctaOutline(ctx: Ctx, o: { x: number; y: number; maxW: number; align: Align; zone: string; size: number }): { nodes: Node[]; box: Box } | null {
  if (!ctx.copy.cta) return null
  const size = sz(ctx, o.size)
  const padX = Math.round(size * 0.95)
  const padY = Math.round(size * 0.55)
  const iconD = Math.round(size * 1.0)
  const gap = Math.round(size * 0.35)
  const t = textNode('cta', ctx.copy.cta, { x: 0, y: 0, maxW: o.maxW - padX * 2 - iconD - gap, align: 'left', font: bodyFont(ctx, true), size, min: sz(ctx, Math.max(20, o.size * 0.72)), lines: 1, lh: 1.2, zone: o.zone })
  const w = t.box.w + gap + iconD + padX * 2
  const h = t.box.h + padY * 2
  const x = o.align === 'left' ? o.x : o.align === 'right' ? o.x + o.maxW - w : o.x + (o.maxW - w) / 2
  t.box = { ...t.box, x: Math.round(x + padX), y: Math.round(o.y + padY) }
  const sw = Math.max(2, Math.round(size * 0.08))
  return {
    nodes: [
      { kind: 'rect', layer: 'over', box: { x: Math.round(x), y: Math.round(o.y), w: Math.round(w), h: Math.round(h) }, color: WHITE, alpha: 0, radius: Math.round(h / 2), stroke: { color: WHITE, width: sw }, zone: o.zone },
      t,
      { kind: 'icon', icon: 'arrow_right', box: { x: Math.round(x + padX + t.box.w + gap), y: Math.round(o.y + (h - iconD) / 2), w: iconD, h: iconD }, color: WHITE, zone: o.zone },
    ],
    box: { x: Math.round(x), y: Math.round(o.y), w: Math.round(w), h: Math.round(h) },
  }
}

function offerType(ctx: Ctx, o: { x: number; y: number; w: number; align: Align; surface: Surface; size: number; font?: 'heading' | 'body' }): TextNode | null {
  if (!ctx.copy.offer) return null
  return textNode('offer', ctx.copy.offer, {
    x: o.x,
    y: o.y,
    maxW: o.w,
    align: o.align,
    font: o.font === 'body' ? bodyFont(ctx, true) : headingFont(ctx),
    size: sz(ctx, o.size),
    min: sz(ctx, Math.max(22, o.size * 0.6)),
    lines: 2,
    prefer: 1,
    preferMin: sz(ctx, o.size * 0.75),
    lh: 1.12,
    ...surf(o.surface),
  })
}

function offerTag(ctx: Ctx, o: { x: number; y: number; maxW: number; align: Align; fill: Rgb; size: number; radius: number }): Pill | null {
  if (!ctx.copy.offer) return null
  return pill('offer', ctx.copy.offer, {
    x: o.x,
    y: o.y,
    maxW: o.maxW,
    align: o.align,
    fill: o.fill,
    font: headingFont(ctx),
    size: sz(ctx, o.size),
    min: sz(ctx, Math.max(22, o.size * 0.62)),
    lines: 2,
    prefer: 1,
    preferMin: sz(ctx, o.size * 0.75),
    lh: 1.12,
    padX: sz(ctx, 24),
    padY: sz(ctx, 14),
    radius: o.radius,
  })
}

/** Shipping / delivery part of an offer line ("Envío gratis llevando 2 kits o más"). */
const SHIPPING_PART_RE = /\b(?:env[ií]os?|shipping|delivery|despacho|entrega)\b/i

/**
 * Round price sticker (falls back to a rounded tag when the offer is too long for a circle).
 * Round-1 P6: prices break at their " · " separators ("1 kit ₡14.900" / "2 kits ₡29.800"), never
 * after a dangling "·", and a shipping rule rides in a ribbon under the circle instead of being
 * squeezed into it at an unreadable size.
 */
function offerSticker(ctx: Ctx, o: { right: number; top: number; fill: Rgb; maxD: number }): { nodes: Node[]; box: Box } | null {
  if (!ctx.copy.offer) return null
  const ring = Math.max(4, sz(ctx, 7))
  const parts = ctx.copy.offer.split(' · ').map((p) => p.trim()).filter(Boolean)
  const shipIdx = parts.length >= 2 ? parts.findIndex((p, i) => i > 0 && SHIPPING_PART_RE.test(p)) : -1
  const circleText = shipIdx > 0 ? parts.filter((_, i) => i !== shipIdx).join(' · ') : ctx.copy.offer
  const ribbonText = shipIdx > 0 ? parts[shipIdx] : ''
  for (const d of [o.maxD, Math.round(o.maxD * 1.12)]) {
    const inner = Math.round(d * 0.72)
    const t = textNode('offer', circleText, {
      x: 0,
      y: 0,
      maxW: inner,
      align: 'center',
      font: headingFont(ctx),
      size: Math.round(d * 0.23),
      min: Math.max(sz(ctx, 22), Math.round(d * 0.11)),
      lines: 3,
      prefer: 2,
      preferMin: Math.round(d * 0.13),
      lh: 1.08,
      maxH: inner,
      fill: o.fill,
      segmentBreaks: true,
    })
    if (!t.fitted.fits || t.box.h > inner) continue
    const box = { x: o.right - d, y: o.top, w: d, h: d }
    t.box = { ...t.box, x: Math.round(box.x + (d - t.box.w) / 2), y: Math.round(box.y + (d - t.box.h) / 2) }
    const nodes: Node[] = [
      { kind: 'rect', layer: 'over', box: { x: box.x - ring, y: box.y - ring, w: d + ring * 2, h: d + ring * 2 }, color: WHITE, radius: (d + ring * 2) / 2, shadow: 'strong', decor: true },
      { kind: 'rect', layer: 'over', box, color: o.fill, radius: d / 2, pill: { role: 'offer', text: t, icons: [] } },
      t,
    ]
    let outer = box
    if (ribbonText) {
      const w = d + ring * 2
      // Same role: it IS the offer line's last part (the report lists both offer blocks).
      const ribbon = pill('offer', ribbonText, {
        x: box.x - ring,
        y: box.y + d + ring + sz(ctx, 10),
        maxW: w,
        align: 'center',
        fill: WHITE,
        textColor: readableTint(o.fill, WHITE),
        font: headingFont(ctx),
        size: Math.max(sz(ctx, 20), Math.round(d * 0.085)),
        min: Math.max(sz(ctx, 16), Math.round(d * 0.06)),
        lines: 2,
        lh: 1.08,
        padX: sz(ctx, 14),
        padY: sz(ctx, 8),
        radius: sz(ctx, 12),
        shadow: 'soft',
      })
      if (!ribbon.text.fitted.fits) continue
      nodes.push(...ribbon.nodes)
      const x0 = Math.min(box.x, ribbon.box.x)
      outer = { x: x0, y: box.y, w: Math.max(box.x + d, ribbon.box.x + ribbon.box.w) - x0, h: ribbon.box.y + ribbon.box.h - box.y }
    }
    return { nodes, box: outer }
  }
  const tag = offerTag(ctx, { x: o.right - o.maxD * 1.6, y: o.top, maxW: Math.round(o.maxD * 1.6), align: 'right', fill: o.fill, size: 40, radius: sz(ctx, 18) })
  return tag ? { nodes: tag.nodes, box: tag.box } : null
}

/** Before/after columns split exactly at the canvas center (the scene is composed that way). */
function splitColumns(
  ctx: Ctx,
  split: NonNullable<Content['split']>,
  o: { y: number; x0: number; x1: number; labelStyle: 'type' | 'tag'; surface: Surface; labelFills?: [Rgb, Rgb]; itemStyle: 'text' | 'sticker'; size: number; align: Align },
): { nodes: Node[]; bottom: number } {
  const { W } = ctx.frame
  const gutter = sz(ctx, 30)
  const cols: Array<{ x: number; w: number }> = [
    { x: o.x0, w: Math.round(W / 2 - gutter - o.x0) },
    { x: Math.round(W / 2 + gutter), w: Math.round(o.x1 - (W / 2 + gutter)) },
  ]
  const nodes: Node[] = []
  let maxBottom = o.y
  cols.forEach((c, i) => {
    let y = o.y
    if (o.labelStyle === 'tag') {
      const fill = o.labelFills?.[i] ?? (i === 0 ? INK : ctx.palette.primary)
      const l = pill('label', split.labels[i], { x: c.x, y, maxW: c.w, align: o.align, fill, font: headingFont(ctx), size: sz(ctx, 32), min: sz(ctx, 22), padX: sz(ctx, 22), padY: sz(ctx, 10), radius: sz(ctx, 10) })
      nodes.push(...l.nodes)
      y = bottom(l.box) + sz(ctx, 12)
    } else {
      const l = textNode('label', split.labels[i], { x: c.x, y, maxW: c.w, align: o.align, font: headingFont(ctx), size: sz(ctx, 42), min: sz(ctx, 26), lines: 1, lh: 1.1, ...surf(o.surface) })
      nodes.push(l)
      y = bottom(l.box) + sz(ctx, 10)
    }
    const item = split.items[i]
    if (item) {
      if (o.itemStyle === 'sticker') {
        const st = stickers(ctx, [item], { x: c.x, y, w: c.w, align: o.align, fill: WHITE, size: o.size, flow: false })
        nodes.push(...st.nodes)
        y = st.bottom
      } else {
        const t = textNode('bullet', item, { x: c.x, y, maxW: c.w, align: o.align, font: bodyFont(ctx, i === 1), size: sz(ctx, o.size), min: sz(ctx, Math.max(18, o.size * 0.7)), lines: 2, lh: 1.25, ...surf(o.surface) })
        nodes.push(t)
        y = bottom(t.box)
      }
    }
    maxBottom = Math.max(maxBottom, y)
  })
  return { nodes, bottom: maxBottom }
}

/** Logo slot of a given max height at a corner of a box. */
function logoIn(ctx: Ctx, area: Box, side: 'left' | 'right', maxH = 84): { box?: Box; nextY: number } {
  if (!ctx.logo) return { nextY: area.y }
  // Square / tall logos get more height (same visual weight as a wide wordmark).
  const aspect = ctx.logo.width / ctx.logo.height
  const mh = Math.round(maxH * ctx.frame.type * (aspect < 1.4 ? 1.3 : 1))
  const s = Math.min((aspect >= 4 ? 420 : 300) / ctx.logo.width, mh / ctx.logo.height)
  const w = Math.max(1, Math.round(ctx.logo.width * s))
  const h = Math.max(1, Math.round(ctx.logo.height * s))
  const x = side === 'left' ? area.x : area.x + area.w - w
  return { box: { x, y: area.y, w, h }, nextY: area.y + h + Math.round(28 * ctx.frame.type) }
}

const accentOn = (ctx: Ctx, bg: Rgb): Rgb => contrastingFill(ctx.palette.accent, bg)

/** Exact mode, before/after split: the real product stands in the "after" half between the header and the columns. */
function afterHalfSlot(ctx: Ctx, top: number, bottomY: number): Box {
  const { safe: S, W } = ctx.frame
  const x = Math.round(W / 2 + sz(ctx, 30))
  return { x, y: Math.round(top), w: Math.max(1, right(S) - x), h: Math.max(1, Math.round(bottomY - top)) }
}

// ---------------------------------------------------------------------------
// editorial_minimal
// ---------------------------------------------------------------------------

function editorialMinimal(ctx: Ctx): TemplateLayout {
  const { safe: S, tall, W } = ctx.frame
  const warnings: string[] = []
  const c = contentOf(ctx, warnings)
  const side = ctx.placement === 'right' ? 'right' : 'left'
  const nodes: Node[] = []
  const accent = ctx.palette.accent
  if (c.split) {
    // Headline block top-left, before/after columns + offer/CTA at the bottom, hairline divider at the split.
    const logo = logoIn(ctx, S, 'right')
    const top = new Stack(S.y)
    top.add(0, (y) => ({ nodes: [{ kind: 'rect', layer: 'over', box: { x: S.x, y, w: sz(ctx, 64), h: Math.max(4, sz(ctx, 5)) }, color: accent, radius: 1, decor: true }], bottom: y + Math.max(4, sz(ctx, 5)) }))
    const headW = logo.box ? S.w - logo.box.w - sz(ctx, 30) : S.w
    top.add(sz(ctx, 26), (y) => { const t = headlineText(ctx, c.headline, { x: S.x, y, w: headW, align: 'left', size: 88, min: 42, lines: 3, surface: { zone: 'top' } }); return { nodes: [t], bottom: bottom(t.box) } })
    if (c.subline) top.add(sz(ctx, 16), (y) => { const t = sublineText(ctx, c.subline, { x: S.x, y, w: S.w * 0.9, align: 'left', size: 32, surface: { zone: 'top' } }); return { nodes: [t], bottom: bottom(t.box) } })
    const bot = new Stack(0)
    bot.add(0, (y) => splitColumns(ctx, c.split!, { y, x0: S.x, x1: right(S), labelStyle: 'type', surface: { zone: 'bot' }, itemStyle: 'text', size: 28, align: 'left' }))
    bot.add(sz(ctx, 30), (y) => actionRow(ctx, y, S.x, S.w, { surface: { zone: 'bot' }, style: 'type' }))
    const botH = bot.y
    moveNodes(bot.nodes, 0, bottom(S) - botH)
    const botTop = bottom(S) - botH
    nodes.push(...top.nodes, ...bot.nodes)
    const lineTop = top.y + sz(ctx, 24)
    const lineBottom = botTop - sz(ctx, 24)
    if (lineBottom - lineTop > 20) nodes.unshift({ kind: 'rect', layer: 'under', box: { x: Math.round(W / 2 - 1), y: lineTop, w: 3, h: lineBottom - lineTop }, color: WHITE, alpha: 0.85, radius: 1, decor: true })
    const productBox = c.cutout && ctx.product ? afterHalfSlot(ctx, lineTop, lineBottom) : undefined
    const fits = top.y + sz(ctx, 40) <= botTop && (!productBox || productBox.h >= ctx.frame.H * 0.16)
    return { nodes, zones: [{ id: 'top', style: 'gradient-top' }, { id: 'bot', style: 'gradient-bottom' }], productBox, productValign: 'bottom', logoBox: logo.box, fits, warnings }
  }

  const single = tall || !!ctx.region
  const colW = single ? S.w : Math.round(S.w * (c.cutout && ctx.product ? 0.56 : 0.64))
  const colX = side === 'right' ? right(S) - colW : S.x
  const logo = logoIn(ctx, S, single ? 'left' : side === 'left' ? 'right' : 'left')
  const top = new Stack(single && logo.box ? logo.nextY : S.y)
  const ruleH = Math.max(4, sz(ctx, 5))
  top.add(0, (y) => ({ nodes: [{ kind: 'rect', layer: 'over', box: { x: colX, y, w: sz(ctx, 64), h: ruleH }, color: accent, radius: 1, decor: true }], bottom: y + ruleH }))
  top.add(sz(ctx, 28), (y) => { const t = headlineText(ctx, c.headline, { x: colX, y, w: colW, align: 'left', size: tall ? 104 : 96, min: 44, lines: 4, prefer: 3, lh: Math.min(1.06, headlineLh(ctx)), surface: { zone: 'top' } }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.subline) top.add(sz(ctx, 20), (y) => { const t = sublineText(ctx, c.subline, { x: colX, y, w: colW, align: 'left', size: 32, lines: 3, surface: { zone: 'top' } }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.list) {
    const items = c.list.items
    top.add(sz(ctx, 34), (y) => hairlineList(ctx, items, { x: colX, y, w: Math.min(colW, sz(ctx, 620)), zone: 'top', accent, size: 29, numbered: c.list!.kind === 'steps' }))
  }
  // Side wash covers the full height, so the bottom group shares the column's zone (one scrim tone).
  const botZone = single ? 'bot' : 'top'
  const bot = new Stack(0)
  bot.add(0, (y) => actionRow(ctx, y, colX, colW, { surface: { zone: botZone }, style: 'type' }))
  const botH = bot.empty ? 0 : bot.y
  moveNodes(bot.nodes, 0, bottom(S) - botH)
  const botTop = bot.empty ? bottom(S) : bottom(S) - botH
  nodes.push(...top.nodes, ...bot.nodes)
  let productBox: Box | undefined
  if (c.cutout && ctx.product) {
    productBox = single
      ? { x: S.x, y: top.y + sz(ctx, 30), w: S.w, h: Math.max(1, botTop - sz(ctx, 30) - (top.y + sz(ctx, 30))) }
      : { x: side === 'left' ? colX + colW + sz(ctx, 30) : S.x, y: (logo.box ? logo.nextY : S.y), w: S.w - colW - sz(ctx, 30), h: Math.max(1, botTop - sz(ctx, 20) - (logo.box ? logo.nextY : S.y)) }
  }
  const zones: Zone[] = single
    ? [{ id: 'top', style: 'gradient-top', fade: 0.2 }, { id: 'bot', style: 'gradient-bottom' }]
    : [{ id: 'top', style: side === 'left' ? 'gradient-left' : 'gradient-right', fade: 0.2 }]
  const fits = top.y + sz(ctx, 36) <= botTop && (!productBox || productBox.h >= ctx.frame.H * 0.18)
  return { nodes, zones, productBox, logoBox: logo.box, fits, warnings }
}

/** Offer + CTA on one row when they fit, stacked otherwise. Returns nodes and bottom. */
function actionRow(
  ctx: Ctx,
  y: number,
  x: number,
  w: number,
  o: { surface: Surface; style: 'type' | 'outline' | 'button'; buttonFill?: Rgb; buttonRadius?: number; offerSize?: number; align?: Align },
): { nodes: Node[]; bottom: number } | null {
  const align = o.align ?? 'left'
  const zone = 'zone' in o.surface ? o.surface.zone : undefined
  const offer = offerType(ctx, { x: 0, y: 0, w: o.style === 'button' ? Math.round(w * 0.55) : w, align: 'left', surface: o.surface, size: o.offerSize ?? (o.style === 'outline' ? 34 : 52), font: o.style === 'outline' ? 'body' : 'heading' })
  const ctaBuilt =
    o.style === 'button'
      ? (() => { const p = button(ctx, { x: 0, y: 0, maxW: w, align: 'left', fill: o.buttonFill ?? ctx.palette.cta, size: 32, radius: o.buttonRadius ?? sz(ctx, 12) }); return p ? { nodes: p.nodes, box: p.box } : null })()
      : o.style === 'outline' && zone
        ? ctaOutline(ctx, { x: 0, y: 0, maxW: w, align: 'left', zone, size: 30 })
        : ctaLink(ctx, { x: 0, y: 0, maxW: w, align: 'left', surface: o.surface, size: 32 })
  const parts: Array<{ nodes: Node[]; box: Box }> = []
  if (offer) parts.push({ nodes: [offer], box: offer.box })
  if (ctaBuilt) parts.push(ctaBuilt)
  if (!parts.length) return null
  const gap = sz(ctx, 28)
  const rowW = parts.reduce((a, p) => a + p.box.w, 0) + gap * (parts.length - 1)
  const oneLineOffer = !offer || offer.fitted.lines.length === 1
  const nodes: Node[] = []
  if (parts.length === 2 && rowW <= w && oneLineOffer) {
    const rowH = Math.max(...parts.map((p) => p.box.h))
    let cx = align === 'left' ? x : align === 'right' ? x + w - rowW : x + (w - rowW) / 2
    for (const p of parts) {
      moveNodes(p.nodes, cx - p.box.x, y + (rowH - p.box.h) / 2 - p.box.y)
      nodes.push(...p.nodes)
      cx += p.box.w + gap
    }
    return { nodes, bottom: y + rowH }
  }
  let cy = y
  for (const p of parts) {
    const px = align === 'left' ? x : align === 'right' ? x + w - p.box.w : x + (w - p.box.w) / 2
    moveNodes(p.nodes, px - p.box.x, cy - p.box.y)
    nodes.push(...p.nodes)
    cy += p.box.h + sz(ctx, 22)
  }
  return { nodes, bottom: cy - sz(ctx, 22) }
}

// ---------------------------------------------------------------------------
// split_panel
// ---------------------------------------------------------------------------

function splitPanel(ctx: Ctx): TemplateLayout {
  const { safe: S, tall, W, H } = ctx.frame
  const warnings: string[] = []
  const c = contentOf(ctx, warnings)
  const P = ensureReadableFill(ctx.palette.primary)
  const onP = readableOn(P)
  const accent = accentOn(ctx, P)
  const ctaFill = contrastRatio(accent, P) >= 2.2 ? accent : onP
  const place = c.split ? 'bottom' : ctx.placement === 'right' ? 'right' : ctx.placement === 'bottom' || ctx.placement === 'top' ? 'bottom' : 'left'
  const nodes: Node[] = []
  const pad = sz(ctx, 46)

  if (place === 'bottom') {
    // Full-width band at the bottom; height follows its content.
    const inner = { x: S.x, w: S.w }
    const st = new Stack(0)
    st.add(0, (y) => { const t = headlineText(ctx, c.headline, { x: inner.x, y, w: inner.w, align: 'left', size: 74, min: 38, lines: 3, surface: { fill: P } }); return { nodes: [t], bottom: bottom(t.box) } })
    if (c.subline) st.add(sz(ctx, 14), (y) => { const t = sublineText(ctx, c.subline, { x: inner.x, y, w: inner.w, align: 'left', size: 30, surface: { fill: P } }); return { nodes: [t], bottom: bottom(t.box) } })
    if (c.split) st.add(sz(ctx, 26), (y) => splitColumns(ctx, c.split!, { y, x0: inner.x, x1: inner.x + inner.w, labelStyle: 'tag', labelFills: [shade(P, luminance(P) < 0.3 ? 0.18 : -0.25), ctaFill], surface: { fill: P }, itemStyle: 'text', size: 27, align: 'left' }))
    else if (c.list) st.add(sz(ctx, 24), (y) => (c.list!.kind === 'tags' ? stickers(ctx, c.list!.items, { x: inner.x, y, w: inner.w, align: 'left', fill: shade(P, luminance(P) < 0.3 ? 0.16 : -0.12), size: 27, flow: true }) : markerList(ctx, c.list!.items, { x: inner.x, y, w: inner.w, surface: { fill: P }, size: 27, markerFill: accent, numbered: c.list!.kind === 'steps' })))
    st.add(sz(ctx, 30), (y) => actionRow(ctx, y, inner.x, inner.w, { surface: { fill: P }, style: 'button', buttonFill: ctaFill, offerSize: 46 }))
    const h = st.y
    moveNodes(st.nodes, 0, bottom(S) - h)
    const panelTop = Math.max(0, bottom(S) - h - pad)
    // In a free region above the product the band stops below its content instead of running to the edge.
    const panelBottom = ctx.region && bottom(S) < bottom(ctx.region.full) - 1 ? bottom(S) + pad : H
    const logo = logoIn(ctx, S, 'left')
    nodes.push({ kind: 'rect', layer: 'under', box: { x: 0, y: panelTop, w: W, h: panelBottom - panelTop }, color: P, radius: 0 })
    nodes.push({ kind: 'rect', layer: 'under', box: { x: 0, y: panelTop, w: W, h: Math.max(6, sz(ctx, 10)) }, color: accent, radius: 0, decor: true })
    nodes.push(...st.nodes)
    let productBox: Box | undefined
    if (c.cutout && ctx.product) productBox = { x: S.x, y: logo.box ? logo.nextY : S.y, w: S.w, h: Math.max(1, panelTop - sz(ctx, 30) - (logo.box ? logo.nextY : S.y)) }
    const fits = panelTop - (logo.box ? logo.nextY : S.y) >= H * (c.split ? 0.22 : 0.2)
    return { nodes, zones: [], productBox, logoBox: logo.box, fits, warnings }
  }

  let panelW = Math.round(W * (tall ? 0.56 : 0.48))
  if (ctx.region) panelW = Math.min(Math.round(W * 0.62), place === 'left' ? right(S) + pad : W - (S.x - pad))
  const panel: Box = place === 'left' ? { x: 0, y: 0, w: panelW, h: H } : { x: W - panelW, y: 0, w: panelW, h: H }
  const x0 = place === 'left' ? S.x : W - panelW + pad
  const x1 = place === 'left' ? panelW - pad : right(S)
  const iw = x1 - x0
  nodes.push({ kind: 'rect', layer: 'under', box: panel, color: P, radius: 0 })
  const barW = Math.max(6, sz(ctx, 10))
  nodes.push({ kind: 'rect', layer: 'under', box: { x: place === 'left' ? panelW : W - panelW - barW, y: 0, w: barW, h: H }, color: accent, radius: 0, decor: true })
  const logo = logoIn(ctx, { x: x0, y: S.y, w: iw, h: S.h }, 'left')
  const top = new Stack(logo.box ? logo.nextY + sz(ctx, 10) : S.y)
  top.add(0, (y) => { const t = headlineText(ctx, c.headline, { x: x0, y, w: iw, align: 'left', size: tall ? 80 : 78, min: 36, lines: 4, prefer: 3, surface: { fill: P } }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.subline) top.add(sz(ctx, 16), (y) => { const t = sublineText(ctx, c.subline, { x: x0, y, w: iw, align: 'left', size: 30, lines: 3, surface: { fill: P } }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.list) {
    const items = c.list.items
    top.add(sz(ctx, 30), (y) =>
      c.list!.kind === 'tags'
        ? stickers(ctx, items, { x: x0, y, w: iw, align: 'left', fill: shade(P, luminance(P) < 0.3 ? 0.16 : -0.12), size: 27, flow: true })
        : markerList(ctx, items, { x: x0, y, w: iw, surface: { fill: P }, size: 27, markerFill: accent, numbered: c.list!.kind === 'steps' }),
    )
  }
  const bot = new Stack(0)
  bot.add(0, (y) => { const t = offerType(ctx, { x: x0, y, w: iw, align: 'left', surface: { fill: P }, size: 54 }); return t ? { nodes: [t], bottom: bottom(t.box) } : null })
  bot.add(sz(ctx, 22), (y) => { const p = button(ctx, { x: x0, y, maxW: iw, align: 'left', fill: ctaFill, size: 31, radius: sz(ctx, 12), minW: iw }); return p ? { nodes: p.nodes, bottom: bottom(p.box) } : null })
  const botH = bot.empty ? 0 : bot.y
  moveNodes(bot.nodes, 0, bottom(S) - botH)
  const botTop = bottom(S) - botH
  nodes.push(...top.nodes, ...bot.nodes)
  let productBox: Box | undefined
  if (c.cutout && ctx.product) {
    const px = place === 'left' ? panelW + barW + sz(ctx, 30) : S.x
    productBox = { x: px, y: S.y, w: (place === 'left' ? right(S) : W - panelW - barW - sz(ctx, 30)) - px, h: S.h }
  }
  return { nodes, zones: [], productBox, productValign: 'center', logoBox: logo.box, fits: top.y + sz(ctx, 30) <= botTop, warnings }
}

// ---------------------------------------------------------------------------
// full_bleed_type
// ---------------------------------------------------------------------------

function fullBleedType(ctx: Ctx): TemplateLayout {
  const { safe: S } = ctx.frame
  const warnings: string[] = []
  const c = contentOf(ctx, warnings)
  const atTop = ctx.placement === 'top'
  const logo = logoIn(ctx, S, atTop ? 'right' : 'left', 80)
  const z = 'type'
  const st = new Stack(0)
  st.add(0, (y) => { const t = headlineText(ctx, c.headline, { x: S.x, y, w: S.w, align: 'left', size: 146, min: 58, lines: 4, prefer: 3, lh: Math.min(1.0, headlineLh(ctx)), surface: { zone: z } }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.subline) st.add(sz(ctx, 18), (y) => { const t = sublineText(ctx, c.subline, { x: S.x, y, w: S.w * 0.88, align: 'left', size: 35, surface: { zone: z } }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.split) st.add(sz(ctx, 30), (y) => splitColumns(ctx, c.split!, { y, x0: S.x, x1: right(S), labelStyle: 'type', surface: { zone: z }, itemStyle: 'text', size: 29, align: 'left' }))
  else if (c.list?.kind === 'steps') st.add(sz(ctx, 26), (y) => hairlineList(ctx, c.list!.items, { x: S.x, y, w: S.w, zone: z, accent: ctx.palette.accent, size: 29, numbered: true }))
  else if (c.list) st.add(sz(ctx, 24), (y) => inlineList(ctx, c.list!.items, { x: S.x, y, w: S.w, zone: z, dot: ctx.palette.accent, size: 29 }))
  st.add(sz(ctx, 34), (y) => actionRow(ctx, y, S.x, S.w, { surface: { zone: z }, style: 'outline', offerSize: 36 }))
  const h = st.y
  if (atTop) moveNodes(st.nodes, 0, (logo.box ? logo.nextY : S.y))
  else moveNodes(st.nodes, 0, bottom(S) - h)
  const b = boxOf(st.nodes)!
  // Accent tick above the headline (poster detail).
  const tick: Node = { kind: 'rect', layer: 'over', box: { x: S.x, y: b.y - sz(ctx, 26), w: sz(ctx, 46), h: Math.max(5, sz(ctx, 7)) }, color: ctx.palette.accent, radius: 2, decor: true }
  const nodes: Node[] = [...st.nodes]
  if (tick.box.y >= (atTop ? (logo.box ? logo.box.y + logo.box.h + 4 : S.y) : S.y)) nodes.unshift(tick)
  let productBox: Box | undefined
  if (c.cutout && ctx.product) {
    productBox = atTop
      ? { x: S.x, y: b.y + b.h + sz(ctx, 30), w: S.w, h: Math.max(1, bottom(S) - (b.y + b.h + sz(ctx, 30))) }
      : { x: S.x, y: logo.box ? logo.nextY : S.y, w: S.w, h: Math.max(1, b.y - sz(ctx, 50) - (logo.box ? logo.nextY : S.y)) }
  }
  const fits = atTop ? b.y + b.h <= bottom(S) : b.y >= (logo.box ? logo.nextY : S.y)
  return { nodes, zones: [{ id: z, style: atTop ? 'gradient-top' : 'gradient-bottom', minAlpha: 0.66, fade: 0.3, tone: 'dark' }], productBox, logoBox: logo.box, fits: fits && (!productBox || productBox.h >= ctx.frame.H * 0.16), warnings }
}

// ---------------------------------------------------------------------------
// badge_corner
// ---------------------------------------------------------------------------

function specStrip(ctx: Ctx, list: NonNullable<Content['list']>, x: number, y: number, w: number): { nodes: Node[]; bottom: number } {
  const nodes: Node[] = []
  const pad = sz(ctx, 22)
  const numbered = list.kind === 'steps'
  const n = list.items.length
  const cols = ctx.frame.tall ? 1 : n <= 2 ? n : n === 3 ? 3 : 2
  const rows = Math.ceil(n / cols)
  const colW = Math.floor((w - pad * 2) / cols)
  const cells: Node[][] = []
  const heights: number[] = []
  list.items.forEach((it, i) => {
    const r = markerList(ctx, [it], { x: 0, y: 0, w: colW - sz(ctx, 16), surface: { fill: WHITE }, size: 25, markerFill: ensureReadableFill(ctx.palette.primary), numbered, gap: 0, start: i })
    cells.push(r.nodes)
    heights.push(r.bottom)
  })
  const rowHs = Array.from({ length: rows }, (_, r) => Math.max(...heights.filter((_, i) => Math.floor(i / cols) === r)))
  let cy = y + pad
  rowHs.forEach((rh, r) => {
    cells.forEach((cell, i) => {
      if (Math.floor(i / cols) !== r) return
      const cx = x + pad + (i % cols) * colW
      moveNodes(cell, cx, cy + (rh - heights[i]) / 2)
      nodes.push(...cell)
      if (i % cols > 0) nodes.push({ kind: 'rect', layer: 'over', box: { x: Math.round(cx - sz(ctx, 10)), y: Math.round(cy), w: 2, h: Math.round(rh) }, color: { r: 220, g: 220, b: 220 }, radius: 1, decor: true })
    })
    cy += rh + sz(ctx, 16)
  })
  const hgt = cy - sz(ctx, 16) + pad - y
  nodes.unshift({ kind: 'rect', layer: 'over', box: { x, y, w, h: Math.round(hgt) }, color: WHITE, radius: sz(ctx, 18), shadow: 'soft' })
  return { nodes, bottom: y + hgt }
}

function badgeCorner(ctx: Ctx): TemplateLayout {
  const { safe: S } = ctx.frame
  const warnings: string[] = []
  const c = contentOf(ctx, warnings)
  const nodes: Node[] = []
  const stickerFill = ensureReadableFill(ctx.palette.badge)
  const btnFill = ensureReadableFill(ctx.palette.primary)
  if (c.split) {
    const logo = logoIn(ctx, S, 'left', 80)
    const top = new Stack(logo.box ? logo.nextY : S.y)
    top.add(0, (y) => { const t = headlineText(ctx, c.headline, { x: S.x, y, w: S.w, align: 'center', size: 78, min: 40, lines: 3, surface: { zone: 'top' } }); return { nodes: [t], bottom: bottom(t.box) } })
    if (c.subline) top.add(sz(ctx, 14), (y) => { const t = sublineText(ctx, c.subline, { x: S.x + S.w * 0.06, y, w: S.w * 0.88, align: 'center', size: 30, surface: { zone: 'top' } }); return { nodes: [t], bottom: bottom(t.box) } })
    const bot = new Stack(0)
    bot.add(0, (y) => splitColumns(ctx, c.split!, { y, x0: S.x, x1: right(S), labelStyle: 'tag', labelFills: [INK, btnFill], surface: { zone: 'bot' }, itemStyle: 'sticker', size: 26, align: 'center' }))
    bot.add(sz(ctx, 26), (y) => {
      const nn: Node[] = []
      const tag = offerTag(ctx, { x: S.x, y, maxW: S.w, align: 'center', fill: stickerFill, size: 34, radius: sz(ctx, 10) })
      let yy = y
      if (tag) { nn.push(...tag.nodes); yy = bottom(tag.box) + sz(ctx, 16) }
      const b = button(ctx, { x: S.x, y: yy, maxW: S.w, align: 'center', fill: btnFill, size: 30, radius: sz(ctx, 10), shadow: 'soft' })
      if (b) { nn.push(...b.nodes); yy = bottom(b.box) } else yy -= sz(ctx, 16)
      return { nodes: nn, bottom: yy }
    })
    moveNodes(bot.nodes, 0, bottom(S) - bot.y)
    nodes.push(...top.nodes, ...bot.nodes)
    const botTop = bottom(S) - bot.y
    const productBox = c.cutout && ctx.product ? afterHalfSlot(ctx, top.y + sz(ctx, 24), botTop - sz(ctx, 24)) : undefined
    const fits = top.y + sz(ctx, 40) <= botTop && (!productBox || productBox.h >= ctx.frame.H * 0.16)
    return { nodes, zones: [{ id: 'top', style: 'gradient-top' }], productBox, productValign: 'bottom', logoBox: logo.box, fits, warnings }
  }
  // Headline top-left, sticker top-right, spec strip + squared button at the bottom.
  const D = Math.round(Math.min(S.w * 0.34, sz(ctx, 300)))
  const sticker = offerSticker(ctx, { right: right(S), top: S.y, fill: stickerFill, maxD: D })
  const logo = logoIn(ctx, S, 'left', 80)
  const headW = sticker ? S.w - sticker.box.w - sz(ctx, 36) : Math.round(S.w * 0.82)
  const top = new Stack(logo.box ? logo.nextY : S.y)
  top.add(0, (y) => { const t = headlineText(ctx, c.headline, { x: S.x, y, w: headW, align: 'left', size: 80, min: 38, lines: 4, prefer: 3, surface: { zone: 'top' } }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.subline) top.add(sz(ctx, 14), (y) => { const t = sublineText(ctx, c.subline, { x: S.x, y, w: headW, align: 'left', size: 29, surface: { zone: 'top' } }); return { nodes: [t], bottom: bottom(t.box) } })
  const bot = new Stack(0)
  if (c.list) bot.add(0, (y) => specStrip(ctx, c.list!, S.x, y, S.w))
  bot.add(sz(ctx, 22), (y) => { const p = button(ctx, { x: S.x, y, maxW: S.w, align: 'left', fill: btnFill, size: 31, radius: sz(ctx, 10), shadow: 'soft' }); return p ? { nodes: p.nodes, bottom: bottom(p.box) } : null })
  const botH = bot.empty ? 0 : bot.y
  moveNodes(bot.nodes, 0, bottom(S) - botH)
  const botTop = bottom(S) - botH
  if (sticker) nodes.push(...sticker.nodes)
  nodes.push(...top.nodes, ...bot.nodes)
  const upper = Math.max(top.y, sticker ? bottom(sticker.box) : 0)
  const productBox = c.cutout && ctx.product ? { x: S.x, y: upper + sz(ctx, 24), w: S.w, h: Math.max(1, botTop - sz(ctx, 24) - (upper + sz(ctx, 24))) } : undefined
  const fits = upper + sz(ctx, 40) <= botTop && (!productBox || productBox.h >= ctx.frame.H * 0.18)
  return { nodes, zones: [{ id: 'top', style: 'gradient-top' }], productBox, logoBox: logo.box, fits, warnings }
}

// ---------------------------------------------------------------------------
// framed_card
// ---------------------------------------------------------------------------

function framedCard(ctx: Ctx): TemplateLayout {
  const { safe: S, W, H } = ctx.frame
  const warnings: string[] = []
  const c = contentOf(ctx, warnings)
  const atTop = ctx.placement === 'top'
  const T = Math.round(W * 0.042)
  const frameColor = ensureReadableFill(ctx.palette.primary)
  const card = WHITE
  const headInk = readableTint(ensureReadableFill(ctx.palette.secondary), card)
  const btnFill = frameColor
  const priceInk = readableTint(frameColor, card)
  const pad = sz(ctx, 42)
  const cardX = Math.max(T + sz(ctx, 22), S.x - pad)
  const cardW = Math.min(W - T - sz(ctx, 22), right(S) + pad) - cardX
  const ix = Math.max(S.x, cardX + pad)
  const iw = Math.min(right(S), cardX + cardW - pad) - ix
  const st = new Stack(0)
  st.add(0, (y) => { const t = headlineText(ctx, c.headline, { x: ix, y, w: iw, align: 'left', size: 70, min: 36, lines: 3, surface: { fill: card } }); t.color = headInk; return { nodes: [t], bottom: bottom(t.box) } })
  if (c.subline) st.add(sz(ctx, 12), (y) => { const t = sublineText(ctx, c.subline, { x: ix, y, w: iw, align: 'left', size: 29, surface: { fill: card } }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.split) st.add(sz(ctx, 24), (y) => splitColumns(ctx, c.split!, { y, x0: ix, x1: ix + iw, labelStyle: 'tag', labelFills: [INK, btnFill], surface: { fill: card }, itemStyle: 'text', size: 26, align: 'left' }))
  else if (c.list) {
    const items = c.list.items
    const two = !ctx.frame.tall && items.length >= 3 && c.list.kind !== 'steps'
    st.add(sz(ctx, 22), (y) => {
      if (!two) return markerList(ctx, items, { x: ix, y, w: iw, surface: { fill: card }, size: 26, markerFill: accentOn(ctx, card), numbered: c.list!.kind === 'steps', gap: 12 })
      const colW = Math.round((iw - sz(ctx, 24)) / 2)
      const left = markerList(ctx, items.filter((_, i) => i % 2 === 0), { x: ix, y, w: colW, surface: { fill: card }, size: 25, markerFill: accentOn(ctx, card), numbered: false, gap: 12 })
      const rightCol = markerList(ctx, items.filter((_, i) => i % 2 === 1), { x: ix + colW + sz(ctx, 24), y, w: colW, surface: { fill: card }, size: 25, markerFill: accentOn(ctx, card), numbered: false, gap: 12 })
      return { nodes: [...left.nodes, ...rightCol.nodes], bottom: Math.max(left.bottom, rightCol.bottom) }
    })
  }
  st.add(sz(ctx, 26), (y) => {
    const row = actionRow(ctx, y, ix, iw, { surface: { fill: card }, style: 'button', buttonFill: btnFill, buttonRadius: sz(ctx, 14), offerSize: 46 })
    if (row) for (const n of row.nodes) if (n.kind === 'text' && n.role === 'offer') n.color = priceInk
    return row
  })
  const contentH = st.y
  const cardH = contentH + pad * 2
  let cardY: number
  if (atTop) {
    cardY = Math.min(S.y - pad, Math.max(T + sz(ctx, 22), S.y - pad))
    cardY = Math.max(T + sz(ctx, 22), cardY)
    if (cardY + pad < S.y) cardY = S.y - pad
  } else {
    const cardBottom = Math.min(bottom(S) + pad, H - T - sz(ctx, 22))
    cardY = cardBottom - cardH
  }
  moveNodes(st.nodes, 0, cardY + pad)
  // Content must stay in the safe area even when the card bottom is clamped.
  const b = boxOf(st.nodes)
  if (b && bottom(b) > bottom(S)) {
    const dy = bottom(S) - bottom(b)
    moveNodes(st.nodes, 0, dy)
    cardY += dy
  }
  const cardBox: Box = { x: cardX, y: cardY, w: cardW, h: cardH }
  const inner: Box = { x: T, y: T, w: W - T * 2, h: H - T * 2 }
  const nodes: Node[] = [
    { kind: 'rect', layer: 'under', box: { x: 0, y: 0, w: W, h: H }, color: frameColor, radius: 0, hole: { box: inner, radius: sz(ctx, 30) }, decor: true },
    { kind: 'rect', layer: 'under', box: cardBox, color: card, radius: sz(ctx, 26), shadow: 'strong' },
    { kind: 'rect', layer: 'under', box: { x: cardX + pad, y: cardY, w: sz(ctx, 70), h: Math.max(5, sz(ctx, 7)) }, color: ctx.palette.accent, radius: 0, decor: true },
    ...st.nodes,
  ]
  const logo = atTop ? logoIn(ctx, { x: S.x, y: bottom(S) - Math.round(84 * ctx.frame.type), w: S.w, h: 88 }, 'left') : logoIn(ctx, S, 'left')
  const freeTop = atTop ? cardY + cardH + sz(ctx, 24) : logo.box ? logo.nextY : S.y
  const freeBottom = atTop ? (logo.box ? logo.box.y - sz(ctx, 20) : bottom(S)) : cardY - sz(ctx, 24)
  const productBox = c.cutout && ctx.product ? { x: S.x, y: freeTop, w: S.w, h: Math.max(1, freeBottom - freeTop) } : undefined
  const fits = freeBottom - freeTop >= H * (c.cutout && ctx.product ? 0.2 : 0.12) && cardY >= T
  return { nodes, zones: [], productBox, logoBox: logo.box, fits, warnings }
}

// ---------------------------------------------------------------------------
// ugc_native
// ---------------------------------------------------------------------------

function ugcNative(ctx: Ctx): TemplateLayout {
  const { safe: S } = ctx.frame
  const warnings: string[] = []
  const c = contentOf(ctx, warnings)
  const atBottom = ctx.placement === 'bottom'
  const nodes: Node[] = []
  // Comment-reply bubble: avatar (logo or brand dot) + headline in the body face.
  const bubbleMaxW = Math.round(S.w * 0.92)
  const av = sz(ctx, 66)
  const padX = sz(ctx, 26)
  const padY = sz(ctx, 22)
  const gap = sz(ctx, 18)
  const head = textNode('headline', c.headline, { x: 0, y: 0, maxW: bubbleMaxW - padX * 2 - av - gap, align: 'left', font: bodyFont(ctx, true), size: sz(ctx, 50), min: sz(ctx, 28), lines: 4, prefer: 3, preferMin: sz(ctx, 36), lh: 1.22, fill: WHITE, color: INK })
  const bw = head.box.w + padX * 2 + av + gap
  const bh = Math.max(av, head.box.h) + padY * 2
  const top = new Stack(S.y)
  top.add(0, (y) => {
    const bx = Math.round(S.x + (S.w - bw) / 2)
    const bubble: Box = { x: bx, y, w: Math.round(bw), h: Math.round(bh) }
    head.box = { ...head.box, x: bx + padX + av + gap, y: Math.round(y + (bh - head.box.h) / 2) }
    const avatar: Box = { x: bx + padX, y: Math.round(y + (bh - av) / 2), w: av, h: av }
    return {
      nodes: [
        { kind: 'rect', layer: 'under', box: bubble, color: WHITE, radius: sz(ctx, 30), shadow: 'soft' },
        { kind: 'rect', layer: 'under', box: { x: bx + sz(ctx, 30), y: y + bh - sz(ctx, 10), w: sz(ctx, 26), h: sz(ctx, 26) }, color: WHITE, radius: sz(ctx, 6), decor: true },
        { kind: 'rect', layer: 'under', box: avatar, color: ctx.logo ? { r: 245, g: 245, b: 245 } : ensureReadableFill(ctx.palette.primary), radius: av / 2, stroke: { color: ctx.palette.accent, width: Math.max(3, sz(ctx, 4)) } },
        head,
      ],
      bottom: y + bh,
    }
  })
  const avatarBox = (top.nodes[2] as RectNode).box
  let logoBox: Box | undefined
  if (ctx.logo) {
    const inner = Math.round(av * 0.66)
    const s = Math.min(inner / ctx.logo.width, inner / ctx.logo.height)
    const w = Math.max(1, Math.round(ctx.logo.width * s))
    const h = Math.max(1, Math.round(ctx.logo.height * s))
    logoBox = { x: Math.round(avatarBox.x + (av - w) / 2), y: Math.round(avatarBox.y + (av - h) / 2), w, h }
  }
  if (c.subline) top.add(sz(ctx, 22), (y) => { const t = textNode('subline', c.subline, { x: S.x + S.w * 0.08, y, maxW: S.w * 0.84, align: 'center', font: bodyFont(ctx, true), size: sz(ctx, 30), min: sz(ctx, 22), lines: 2, lh: 1.3, zone: 'cap' }); return { nodes: [t], bottom: bottom(t.box) } })
  if (c.list) {
    const items = c.list.items
    top.add(sz(ctx, 22), (y) => stickers(ctx, items, { x: S.x, y, w: S.w, align: 'center', fill: WHITE, size: 29, flow: c.list!.kind === 'tags', numbered: c.list!.kind === 'steps' ? { fill: ensureReadableFill(ctx.palette.primary) } : undefined }))
  }
  if (c.split) top.add(sz(ctx, 26), (y) => splitColumns(ctx, c.split!, { y, x0: S.x, x1: right(S), labelStyle: 'tag', labelFills: [INK, ensureReadableFill(ctx.palette.primary)], surface: { zone: 'cap' }, itemStyle: 'sticker', size: 25, align: 'center' }))
  // Bottom: offer sticker + link sticker (CTA).
  const bot = new Stack(0)
  bot.add(0, (y) => { const t = offerTag(ctx, { x: S.x, y, maxW: S.w, align: 'center', fill: ensureReadableFill(ctx.palette.badge), size: 36, radius: sz(ctx, 12) }); return t ? { nodes: t.nodes, bottom: bottom(t.box) } : null })
  bot.add(sz(ctx, 16), (y) => {
    const linkInk = readableTint(ensureReadableFill(ctx.palette.primary), WHITE)
    const p = button(ctx, { x: S.x, y, maxW: S.w, align: 'center', fill: WHITE, size: 31, radius: sz(ctx, 14), padX: sz(ctx, 30), padY: sz(ctx, 18), shadow: 'soft' })
    if (!p) return null
    p.text.color = linkInk
    for (const n of p.nodes) if (n.kind === 'icon') n.color = linkInk
    return { nodes: p.nodes, bottom: bottom(p.box) }
  })
  const botH = bot.empty ? 0 : bot.y
  moveNodes(bot.nodes, 0, bottom(S) - botH)
  const botTop = bottom(S) - botH
  if (atBottom) {
    const shift = botTop - sz(ctx, 36) - top.y
    if (shift > 0) {
      moveNodes(top.nodes, 0, shift)
      if (logoBox) logoBox = { ...logoBox, y: logoBox.y + shift }
    }
  }
  nodes.push(...top.nodes, ...bot.nodes)
  const tb = boxOf(top.nodes)!
  const productBox = c.cutout && ctx.product
    ? atBottom
      ? { x: S.x, y: S.y, w: S.w, h: Math.max(1, tb.y - sz(ctx, 24) - S.y) }
      : { x: S.x, y: tb.y + tb.h + sz(ctx, 24), w: S.w, h: Math.max(1, botTop - sz(ctx, 24) - (tb.y + tb.h + sz(ctx, 24))) }
    : undefined
  const fits = tb.y + tb.h + sz(ctx, 30) <= botTop && tb.y >= S.y && (!productBox || productBox.h >= ctx.frame.H * 0.16)
  return { nodes, zones: [{ id: 'cap', style: 'box' }], productBox, logoBox, fits, warnings }
}

// ---------------------------------------------------------------------------
// Studio families (rounds 1b–1c) — the approved Prototipo v1 look on a procedural studio canvas
// with the real photo bled in BIG. Four distinct compositions rotate per angle so a pack never
// repeats a layout:
//   studio_hero       cream · product top, headline + price + facts + CTA bottom-left
//   studio_top        cream · headline top with accent underline, product middle, price/CTA row bottom
//   studio_navy_top   navy band top (headline, price, facts) · product on cream · CTA row bottom
//   studio_navy_bottom cream product top · navy band bottom (headline, price, facts, CTA, logo)
// Each ad carries at most: 1 headline, 1 price line, 1 small facts line (the shipping rule), a CTA
// and the logo. Long facts (age, not-included, WhatsApp) live in the caption.
// ---------------------------------------------------------------------------

type StudioVariant = 'hero' | 'top' | 'navy_top' | 'navy_bottom'

interface StudioParts {
  priceText: string
  shipText: string
}

function studioParts(ctx: Ctx): StudioParts {
  const parts = ctx.copy.offer ? ctx.copy.offer.split(' · ').map((p) => p.trim()).filter(Boolean) : []
  const shipIdx = parts.length >= 2 ? parts.findIndex((p, i) => i > 0 && SHIPPING_PART_RE.test(p)) : -1
  return { priceText: shipIdx > 0 ? parts.filter((_, i) => i !== shipIdx).join(' · ') : ctx.copy.offer ?? '', shipText: shipIdx > 0 ? parts[shipIdx] : '' }
}

function studioLayout(ctx: Ctx, variant: StudioVariant): TemplateLayout {
  const { safe: S, tall, W, H } = ctx.frame
  const warnings: string[] = []
  const c = contentOf(ctx, warnings)
  const nodes: Node[] = []
  const accent = ctx.palette.accent
  const dark = (ctx.canvasLum ?? 1) < 0.4
  const P = ensureReadableFill(ctx.palette.primary)
  const onP = readableOn(P)
  const accentP = accentOn(ctx, P)
  const ink = dark ? WHITE : ctx.palette.primary
  const { priceText, shipText } = studioParts(ctx)
  const LIGHT = 'studio'
  const surface = (band: boolean): Surface => (band ? { fill: P } : { zone: LIGHT })
  const colorFor = (band: boolean): Rgb | undefined => (band ? onP : ink)
  const shipColor = (band: boolean): Rgb | undefined => (band ? (contrastRatio(accentP, P) >= 4.5 ? accentP : onP) : ink)

  const headline = (y: number, band: boolean, size: number): { nodes: Node[]; bottom: number } => {
    const t = headlineText(ctx, c.headline, { x: S.x, y, w: S.w, align: 'left', size, min: 46, lines: 3, prefer: 2, lh: Math.min(1.04, headlineLh(ctx)), surface: surface(band) })
    return { nodes: [t], bottom: bottom(t.box) }
  }
  const price = (y: number, band: boolean): { nodes: Node[]; bottom: number } | null => {
    if (!priceText) return null
    const t = textNode('offer', priceText, { x: S.x, y, maxW: S.w, align: 'left', font: headingFont(ctx), size: sz(ctx, tall ? 72 : 64), min: sz(ctx, 34), lines: 2, prefer: 1, preferMin: sz(ctx, 46), lh: 1.08, segmentBreaks: true, ...(band ? { fill: P, color: onP } : { zone: LIGHT, color: ink }) })
    return { nodes: [t], bottom: bottom(t.box) }
  }
  const facts = (y: number, band: boolean): { nodes: Node[]; bottom: number } | null => {
    if (!shipText) return null
    const t = textNode('offer', shipText, { x: S.x, y, maxW: S.w, align: 'left', font: bodyFont(ctx, true), size: sz(ctx, 28), min: sz(ctx, 20), lines: 2, lh: 1.25, ...(band ? { fill: P, color: shipColor(true) } : { zone: LIGHT, color: shipColor(false) }) })
    return { nodes: [t], bottom: bottom(t.box) }
  }
  const logo = logoIn(ctx, { x: S.x, y: 0, w: S.w, h: 0 }, 'right', tall ? 92 : 88)
  // No logo asset: the brand name stands in as a large text wordmark (the gate reports it as such).
  const wordmark = (band: boolean): TextNode | null =>
    !logo.box && ctx.brandName
      ? textNode('bullet', ctx.brandName, { x: 0, y: 0, maxW: Math.round(S.w * 0.42), align: 'left', font: headingFont(ctx), size: sz(ctx, tall ? 60 : 54), min: sz(ctx, 38), lines: 1, lh: 1.1, ...(band ? { fill: P, color: onP } : { zone: LIGHT, color: ink }) })
      : null
  const logoW = logo.box ? logo.box.w + sz(ctx, 30) : (wordmark(false)?.box.w ?? 0) + (ctx.brandName && !logo.box ? sz(ctx, 30) : 0)
  const ctaRow = (y: number, band: boolean): { nodes: Node[]; bottom: number } => {
    const cta = ctaLink(ctx, { x: S.x, y, maxW: S.w - logoW, align: 'left', surface: surface(band), size: 30 })
    const wm = wordmark(band)
    const rowH = Math.max(cta?.box.h ?? 0, logo.box?.h ?? 0, wm?.box.h ?? 0)
    const out: Node[] = []
    if (wm) {
      wm.box = { ...wm.box, x: Math.round(right(S) - wm.box.w), y: Math.round(y + (rowH - wm.box.h) / 2) }
      out.push(wm)
    }
    if (cta) {
      moveNodes(cta.nodes, 0, (rowH - cta.box.h) / 2)
      out.push(...cta.nodes)
    }
    if (logo.box) logo.box = { ...logo.box, y: Math.round(y + (rowH - logo.box.h) / 2) }
    return { nodes: out, bottom: y + rowH }
  }
  const hSize = tall ? 104 : 92
  const pushStack = (st: Stack) => nodes.push(...st.nodes)
  let productBox: Box | undefined
  let bleedClip: Box | undefined
  let fits = true
  const tone = dark ? ('dark' as const) : ('light' as const)
  let zones: TemplateLayout['zones'] = [{ id: LIGHT, style: 'gradient-bottom', tone, fade: 0.2, ...(dark ? {} : { ink }) }]
  const gapP = sz(ctx, tall ? 50 : 30)

  if (variant === 'hero' || variant === 'navy_bottom') {
    // Bottom group anchored to the safe bottom; product fills everything above it.
    const band = variant === 'navy_bottom'
    const st = new Stack(0)
    st.add(0, (y) => headline(y, band, hSize))
    st.add(sz(ctx, 22), (y) => price(y, band))
    st.add(sz(ctx, 10), (y) => facts(y, band))
    st.add(sz(ctx, 26), (y) => ctaRow(y, band))
    const h = st.y
    moveNodes(st.nodes, 0, bottom(S) - h)
    if (logo.box) logo.box = { ...logo.box, y: logo.box.y + bottom(S) - h }
    const groupTop = bottom(S) - h
    if (band) {
      const pad = sz(ctx, 46)
      const panelTop = Math.max(0, groupTop - pad)
      nodes.push({ kind: 'rect', layer: 'under', box: { x: 0, y: panelTop, w: W, h: H - panelTop }, color: P, radius: 0 })
      nodes.push({ kind: 'rect', layer: 'under', box: { x: 0, y: panelTop, w: W, h: Math.max(6, sz(ctx, 10)) }, color: accent, radius: 0, decor: true })
      bleedClip = { x: 0, y: 0, w: W, h: panelTop }
      zones = []
      const y0 = S.y
      if (c.cutout && ctx.product) productBox = { x: S.x, y: y0, w: S.w, h: Math.max(1, panelTop - sz(ctx, 24) - y0) }
      fits = panelTop >= y0 + H * 0.2
    } else {
      const y0 = S.y + sz(ctx, tall ? 40 : 10)
      if (c.cutout && ctx.product) productBox = { x: S.x, y: y0, w: S.w, h: Math.max(1, groupTop - gapP - y0) }
      fits = groupTop >= y0 + sz(ctx, 40) && (!productBox || productBox.h >= H * 0.24)
    }
    pushStack(st)
  } else if (variant === 'top') {
    const top = new Stack(S.y)
    top.add(0, (y) => headline(y, false, hSize))
    const barY = top.y + sz(ctx, 16)
    nodes.push({ kind: 'rect', layer: 'over', box: { x: S.x, y: Math.round(barY), w: sz(ctx, 150), h: Math.max(6, sz(ctx, 9)) }, color: accent, radius: 3, decor: true })
    const topBottom = barY + Math.max(6, sz(ctx, 9))
    const bot = new Stack(0)
    bot.add(0, (y) => price(y, false))
    bot.add(sz(ctx, 10), (y) => facts(y, false))
    bot.add(sz(ctx, 26), (y) => ctaRow(y, false))
    const h = bot.y
    moveNodes(bot.nodes, 0, bottom(S) - h)
    if (logo.box) logo.box = { ...logo.box, y: logo.box.y + bottom(S) - h }
    const botTop = bottom(S) - h
    pushStack(top)
    pushStack(bot)
    const y0 = topBottom + sz(ctx, tall ? 40 : 12)
    if (c.cutout && ctx.product) productBox = { x: S.x, y: y0, w: S.w, h: Math.max(1, botTop - gapP - y0) }
    fits = botTop >= y0 + H * 0.2 && (!productBox || productBox.h >= H * 0.22)
    zones = [{ id: LIGHT, style: 'gradient-top', tone, fade: 0.12, ...(dark ? {} : { ink }) }, { id: 'studio_b', style: 'gradient-bottom', tone, fade: 0.18, ...(dark ? {} : { ink }) }]
    // bottom texts sit on the lower scrim zone
    for (const n of bot.nodes) if (n.kind === 'text' || (n.kind === 'icon' && n.zone) || (n.kind === 'rect' && n.zone)) (n as { zone?: string }).zone = n.zone ? 'studio_b' : n.zone
  } else {
    // navy_top: navy band with headline, price and facts; product on cream; CTA + logo row bottom.
    const pad = sz(ctx, 46)
    const st = new Stack(S.y)
    st.add(0, (y) => headline(y, true, tall ? 100 : 88))
    st.add(sz(ctx, 20), (y) => price(y, true))
    st.add(sz(ctx, 8), (y) => facts(y, true))
    const bandBottom = st.y + pad
    nodes.push({ kind: 'rect', layer: 'under', box: { x: 0, y: 0, w: W, h: Math.round(bandBottom) }, color: P, radius: 0 })
    nodes.push({ kind: 'rect', layer: 'under', box: { x: 0, y: Math.round(bandBottom), w: W, h: Math.max(6, sz(ctx, 10)) }, color: accent, radius: 0, decor: true })
    const row = new Stack(0)
    row.add(0, (y) => ctaRow(y, false))
    const h = row.y
    moveNodes(row.nodes, 0, bottom(S) - h)
    if (logo.box) logo.box = { ...logo.box, y: logo.box.y + bottom(S) - h }
    const rowTop = bottom(S) - h
    pushStack(st)
    pushStack(row)
    const y0 = bandBottom + sz(ctx, 20)
    bleedClip = { x: 0, y: Math.round(bandBottom + Math.max(6, sz(ctx, 10))), w: W, h: H }
    if (c.cutout && ctx.product) productBox = { x: S.x, y: y0, w: S.w, h: Math.max(1, rowTop - gapP - y0) }
    fits = rowTop >= y0 + H * 0.24 && (!productBox || productBox.h >= H * 0.24)
    zones = [{ id: LIGHT, style: 'gradient-bottom', tone, fade: 0.14, ...(dark ? {} : { ink }) }]
  }
  return { nodes, zones, productBox, productValign: variant === 'navy_top' || variant === 'top' ? 'center' : 'bottom', ...(bleedClip ? { bleedClip } : {}), logoBox: logo.box, fits, warnings }
}

const studioHero = (ctx: Ctx) => studioLayout(ctx, 'hero')
const studioTop = (ctx: Ctx) => studioLayout(ctx, 'top')
const studioNavyTop = (ctx: Ctx) => studioLayout(ctx, 'navy_top')
const studioNavyBottom = (ctx: Ctx) => studioLayout(ctx, 'navy_bottom')

// ---------------------------------------------------------------------------
// Registry + mirroring
// ---------------------------------------------------------------------------

/** Mirror a layout horizontally (text alignment flips; arrows keep pointing right). */
export function mirrorLayout(layout: TemplateLayout, W: number): TemplateLayout {
  const flip = (b: Box): Box => ({ ...b, x: W - b.x - b.w })
  for (const n of layout.nodes) {
    n.box = flip(n.box)
    if (n.kind === 'text') n.align = n.align === 'left' ? 'right' : n.align === 'right' ? 'left' : 'center'
    if (n.kind === 'rect' && n.hole) n.hole = { ...n.hole, box: flip(n.hole.box) }
  }
  layout.zones = layout.zones.map((z) => (z.style === 'gradient-left' ? { ...z, style: 'gradient-right' } : z.style === 'gradient-right' ? { ...z, style: 'gradient-left' } : z))
  if (layout.productBox) layout.productBox = flip(layout.productBox)
  if (layout.logoBox) layout.logoBox = flip(layout.logoBox)
  return layout
}

const COMPOSERS: Record<Exclude<LayoutFamily, 'bold_pill'>, (ctx: Ctx) => TemplateLayout> = {
  editorial_minimal: editorialMinimal,
  split_panel: splitPanel,
  full_bleed_type: fullBleedType,
  badge_corner: badgeCorner,
  framed_card: framedCard,
  ugc_native: ugcNative,
  studio_hero: studioHero,
  studio_top: studioTop,
  studio_navy_top: studioNavyTop,
  studio_navy_bottom: studioNavyBottom,
}

/** Lay out one format in one family at `ctx.placement` / `ctx.s`. */
export function composeFamily(family: LayoutFamily, ctx: Ctx): TemplateLayout {
  const format = ctx.format ?? 'offer_graphic'
  if (family === 'bold_pill') {
    const layout = TEMPLATES[format](ctx)
    return ctx.placement === 'mirror' && !ctx.region ? mirrorLayout(layout, ctx.frame.W) : layout
  }
  if (family === 'badge_corner' && ctx.placement === 'right' && format !== 'before_after') {
    // Inside a free region the composition already sits on the right side: no mirroring.
    if (ctx.region) return COMPOSERS.badge_corner({ ...ctx, placement: 'left' })
    return mirrorLayout(COMPOSERS.badge_corner({ ...ctx, placement: 'left' }), ctx.frame.W)
  }
  return COMPOSERS[family](ctx)
}

/** Scene hint for a family (falls back to the format hint for bold_pill / before_after). */
export function familySceneHint(family: LayoutFamily | undefined, format: AdFormat): string {
  if (!family) return ''
  return FAMILY_SPECS[family].sceneHint(format)
}
