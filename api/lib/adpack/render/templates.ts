/**
 * The 7 static ad formats. Each template lays out pre-fitted text blocks, pills,
 * cards and the product slot for one frame (ratio) at a given type scale `ctx.s`.
 * Templates never invent copy except fixed, language-aware labels
 * ("Antes"/"Después", step numbers), which are reported like any other text.
 */
import type { AdFormat } from '../types.js'
import { INK, luminance, readableOn, shade, WHITE, type Rgb } from './color.js'
import { bottom } from './frame.js'
import {
  bodyFont,
  contrastingFill,
  headingFont,
  headingSizeFactor,
  headlineLh,
  logoSlot,
  pill,
  shiftNodes,
  sz,
  textNode,
  type Align,
  type Ctx,
  type Node,
  type Pill,
  type TemplateLayout,
} from './layout.js'
import type { Box } from './types.js'

type Template = (ctx: Ctx) => TemplateLayout

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

interface HeaderOpts {
  y: number
  x?: number
  maxW?: number
  align: Align
  size: number
  min: number
  lines?: number
  prefer?: number
  subSize?: number
  zone?: string
}

/** Headline + optional subline on the scene (zone 'top'). Returns nodes and the bottom y. */
function header(ctx: Ctx, o: HeaderOpts): { nodes: Node[]; bottom: number } {
  const { safe } = ctx.frame
  const x = o.x ?? safe.x
  const maxW = o.maxW ?? safe.w
  const nodes: Node[] = []
  const k = headingSizeFactor(ctx)
  const head = textNode('headline', ctx.copy.headline, {
    x,
    y: o.y,
    maxW,
    align: o.align,
    font: headingFont(ctx),
    size: sz(ctx, o.size * k),
    min: sz(ctx, o.min * k),
    lines: o.lines ?? 3,
    prefer: o.prefer ?? 2,
    preferMin: sz(ctx, o.size * k * 0.66),
    lh: headlineLh(ctx),
    zone: o.zone ?? 'top',
  })
  nodes.push(head)
  let y = bottom(head.box)
  if (ctx.copy.subline) {
    y += sz(ctx, 18)
    const sub = textNode('subline', ctx.copy.subline, {
      x,
      y,
      maxW: Math.min(maxW, safe.w * 0.9),
      align: o.align,
      font: bodyFont(ctx),
      size: sz(ctx, o.subSize ?? 36),
      min: sz(ctx, 24),
      lines: 2,
      lh: 1.32,
      zone: o.zone ?? 'top',
    })
    if (o.align === 'center') sub.box.x = Math.round(x + (maxW - sub.box.w) / 2)
    nodes.push(sub)
    y = bottom(sub.box)
  }
  return { nodes, bottom: y }
}

function ctaPill(ctx: Ctx, x: number, y: number, maxW: number, align: Align, fill?: Rgb): Pill | null {
  if (!ctx.copy.cta) return null
  const f = fill ?? ctx.palette.cta
  const text = readableOn(f)
  return pill('cta', ctx.copy.cta, {
    x,
    y,
    maxW,
    align,
    fill: f,
    textColor: text,
    font: bodyFont(ctx, true),
    size: sz(ctx, 34),
    min: sz(ctx, 24),
    padX: sz(ctx, 46),
    padY: sz(ctx, 24),
    icon: { kind: 'arrow_right', mark: text, position: 'trail' },
    shadow: 'strong',
  })
}

function offerBadge(ctx: Ctx, x: number, y: number, maxW: number, align: Align, big: boolean, fill?: Rgb): Pill | null {
  if (!ctx.copy.offer) return null
  const f = fill ?? ctx.palette.badge
  return pill('offer', ctx.copy.offer, {
    x,
    y,
    maxW,
    align,
    fill: f,
    font: headingFont(ctx),
    size: sz(ctx, big ? 50 : 38),
    min: sz(ctx, big ? 30 : 24),
    lines: 2,
    lh: 1.12,
    padX: sz(ctx, big ? 34 : 30),
    padY: sz(ctx, big ? 22 : 20),
    radius: sz(ctx, 22),
    shadow: 'strong',
  })
}

function chip(ctx: Ctx, text: string, x: number, y: number, maxW: number, align: Align, fill?: Rgb, icon = true): Pill {
  const f = fill ?? ctx.palette.chip
  const iconBg = fill ? contrastingFill(ctx.palette.accent, f) : ctx.palette.chipIcon
  return pill('bullet', text, {
    x,
    y,
    maxW,
    align,
    fill: f,
    font: bodyFont(ctx, true),
    size: sz(ctx, 29),
    min: sz(ctx, 20),
    lines: 2,
    lh: 1.22,
    padX: sz(ctx, 26),
    padY: sz(ctx, 16),
    icon: icon ? { kind: 'check', bg: iconBg, mark: readableOn(iconBg) } : undefined,
    shadow: fill ? undefined : 'soft',
  })
}

/**
 * Offer badge + CTA on one row when they fit, stacked otherwise (CTA last).
 * `bottomY` is where the block must end. Returns nodes and the top y.
 */
function actionBlock(ctx: Ctx, o: { x: number; maxW: number; align: Align; bottomY: number; ctaFill?: Rgb; badgeFill?: Rgb }): { nodes: Node[]; top: number; box: Box | null } {
  const gap = sz(ctx, 20)
  const cta = ctaPill(ctx, o.x, 0, o.maxW, o.align, o.ctaFill)
  const badge = offerBadge(ctx, o.x, 0, o.maxW, o.align, false, o.badgeFill)
  const items = [badge, cta].filter((p): p is Pill => !!p)
  if (!items.length) return { nodes: [], top: o.bottomY, box: null }
  const nodes = items.flatMap((p) => p.nodes)
  if (items.length === 2 && badge!.box.w + gap + cta!.box.w <= o.maxW && badge!.text.fitted.lines.length === 1) {
    const rowH = Math.max(badge!.box.h, cta!.box.h)
    const rowW = badge!.box.w + gap + cta!.box.w
    const startX = o.align === 'left' ? o.x : o.align === 'right' ? o.x + o.maxW - rowW : o.x + (o.maxW - rowW) / 2
    const top = o.bottomY - rowH
    moveTo(badge!, startX, top + (rowH - badge!.box.h) / 2)
    moveTo(cta!, startX + badge!.box.w + gap, top + (rowH - cta!.box.h) / 2)
    return { nodes, top, box: { x: Math.round(startX), y: top, w: rowW, h: rowH } }
  }
  let y = o.bottomY
  for (const p of [...items].reverse()) {
    y -= p.box.h
    shiftNodes(p.nodes, y - p.box.y)
    p.box.y = y
    y -= gap
  }
  const top = y + gap
  return { nodes, top, box: { x: o.x, y: top, w: o.maxW, h: o.bottomY - top } }
}

function moveTo(p: Pill, x: number, y: number) {
  const dx = Math.round(x - p.box.x)
  const dy = Math.round(y - p.box.y)
  for (const n of p.nodes) n.box = { ...n.box, x: n.box.x + dx, y: n.box.y + dy }
  // p.box is the first node's box (same object replaced above) — keep it in sync.
  p.box = p.nodes[0].box
}

/** White card with a numbered/check marker and left-aligned text. */
function card(ctx: Ctx, text: string, x: number, y: number, w: number, marker: { kind: 'number'; n: number } | { kind: 'check' }, textSize = 31): { nodes: Node[]; box: Box } {
  const pad = sz(ctx, 22)
  const d = sz(ctx, marker.kind === 'number' ? 62 : 44)
  const gap = sz(ctx, 20)
  const t = textNode('bullet', text, {
    x: x + pad + d + gap,
    y: 0,
    maxW: w - pad * 2 - d - gap,
    align: 'left',
    font: bodyFont(ctx, true),
    size: sz(ctx, textSize),
    min: sz(ctx, 20),
    lines: 3,
    lh: 1.24,
    fill: WHITE,
    color: INK,
  })
  const h = Math.max(d, t.box.h) + pad * 2
  const box = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
  t.box.y = Math.round(box.y + (h - t.box.h) / 2)
  const mb = { x: box.x + pad, y: Math.round(box.y + (h - d) / 2), w: d, h: d }
  const markFill = ctx.palette.chipIcon
  const nodes: Node[] = [
    { kind: 'rect', layer: 'over', box, color: WHITE, radius: sz(ctx, 26), shadow: 'soft' },
    { kind: 'rect', layer: 'over', box: mb, color: markFill, radius: d / 2 },
  ]
  if (marker.kind === 'number') {
    const num = textNode('step_number', String(marker.n), {
      x: mb.x,
      y: 0,
      maxW: d,
      align: 'center',
      font: headingFont(ctx),
      size: Math.round(d * 0.52),
      min: Math.round(d * 0.3),
      lines: 1,
      lh: 1.1,
      fill: markFill,
    })
    num.box.y = Math.round(mb.y + (d - num.box.h) / 2)
    nodes.push(num)
  } else {
    nodes.push({ kind: 'icon', icon: 'check', box: mb, color: readableOn(markFill) })
  }
  nodes.push(t)
  return { nodes, box }
}

/** Lay pills out left→right, wrapping rows. */
function flowChips(ctx: Ctx, items: string[], x: number, y: number, maxW: number, fill?: Rgb): { nodes: Node[]; bottom: number } {
  const gap = sz(ctx, 14)
  const nodes: Node[] = []
  let cx = x
  let cy = y
  let rowH = 0
  for (const it of items) {
    const p = chip(ctx, it, 0, 0, maxW, 'left', fill)
    if (cx > x && cx + p.box.w > x + maxW) {
      cx = x
      cy += rowH + gap
      rowH = 0
    }
    moveTo(p, cx, cy)
    nodes.push(...p.nodes)
    cx += p.box.w + gap
    rowH = Math.max(rowH, p.box.h)
  }
  return { nodes, bottom: items.length ? cy + rowH : y }
}

function centerVertically(nodes: Node[], top: number, contentBottom: number, regionBottom: number) {
  const slack = regionBottom - contentBottom
  if (slack > 0) shiftNodes(nodes, Math.round(slack / 2))
  return top
}

const skipBullets = (ctx: Ctx, warnings: string[], format: string) => {
  if (ctx.copy.bullets.length) warnings.push(`${format}: bullets not drawn (format uses headline only)`)
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

const offerGraphic: Template = (ctx) => {
  const { safe, tall } = ctx.frame
  const warnings: string[] = []
  const logo = logoSlot(ctx, 'left')
  const nodes: Node[] = []
  const head = header(ctx, { y: logo.nextY, align: 'left', size: 96, min: 46, maxW: tall ? safe.w : safe.w * 0.94 })
  nodes.push(...head.nodes)
  const safeBottom = bottom(safe)
  const cta = ctaPill(ctx, safe.x, 0, safe.w * 0.7, 'left')
  let midBottom = safeBottom
  if (cta) {
    shiftNodes(cta.nodes, safeBottom - cta.box.h - cta.box.y)
    nodes.push(...cta.nodes)
    midBottom = cta.nodes[0].box.y - sz(ctx, 34)
  }
  const midTop = head.bottom + sz(ctx, tall ? 56 : 40)
  const leftW = Math.round(safe.w * (ctx.product ? 0.52 : 0.6))
  const mid: Node[] = []
  let y = midTop
  for (const b of ctx.copy.bullets.slice(0, 4)) {
    const c = chip(ctx, b, safe.x, y, leftW, 'left')
    mid.push(...c.nodes)
    y = bottom(c.box) + sz(ctx, 16)
  }
  const badge = offerBadge(ctx, safe.x, y + (ctx.copy.bullets.length ? sz(ctx, 14) : 0), ctx.product ? leftW : safe.w * 0.8, 'left', true)
  if (badge) {
    mid.push(...badge.nodes)
    y = bottom(badge.box)
  } else if (ctx.copy.bullets.length) {
    y -= sz(ctx, 16)
  }
  const fits = y <= midBottom
  if (mid.length && ctx.copy.bullets.length) centerVertically(mid, midTop, y, midBottom)
  else if (mid.length && midBottom > y) shiftNodes(mid, Math.round(midBottom - y)) // lone badge sits just above the CTA
  nodes.push(...mid)
  const productBox = ctx.product
    ? { x: safe.x + leftW + sz(ctx, 20), y: midTop - sz(ctx, 10), w: safe.w - leftW - sz(ctx, 20), h: Math.max(1, midBottom - midTop + sz(ctx, 10)) }
    : undefined
  return { nodes, zones: [{ id: 'top', style: 'gradient-top' }], productBox, logoBox: logo.box, fits, warnings }
}

const beforeAfter: Template = (ctx) => {
  const { safe, tall, W } = ctx.frame
  const warnings: string[] = []
  const labels = ctx.language === 'en' ? ['Before', 'After'] : ['Antes', 'Después']
  const logo = logoSlot(ctx, 'left')
  const nodes: Node[] = []
  const head = header(ctx, { y: logo.nextY, align: 'center', size: 80, min: 42, prefer: 2 })
  nodes.push(...head.nodes)
  const action = actionBlock(ctx, { x: safe.x, maxW: safe.w, align: 'center', bottomY: bottom(safe) })
  nodes.push(...action.nodes)
  const regionTop = head.bottom + sz(ctx, 36)
  const regionBottom = action.top - sz(ctx, 36)
  const beforeFill: Rgb = { r: 31, g: 41, b: 55 }
  const afterFill = ctx.palette.primary
  const [b0, b1] = ctx.copy.bullets
  if (ctx.copy.bullets.length > 2) warnings.push('before_after: only the first 2 bullets are drawn')
  let fits = regionBottom > regionTop
  const half = (label: string, fill: Rgb, bullet: string | undefined, x: number, w: number, isAfter: boolean) => {
    const l = pill('label', label, {
      x,
      y: 0,
      maxW: w,
      align: tall ? 'left' : 'center',
      fill,
      font: headingFont(ctx),
      size: sz(ctx, 36),
      min: sz(ctx, 24),
      padX: sz(ctx, 30),
      padY: sz(ctx, 14),
      shadow: 'strong',
    })
    const parts: Pill[] = [l]
    if (bullet) {
      const c = chip(ctx, bullet, x, 0, w, tall ? 'left' : 'center', undefined, isAfter)
      parts.push(c)
    }
    return parts
  }
  const stack = (parts: Pill[], top: number) => {
    let y = top
    for (const p of parts) {
      moveTo(p, p.box.x, y)
      y = bottom(p.box) + sz(ctx, 14)
    }
    return y - sz(ctx, 14)
  }
  let split: { kind: 'v'; x: number } | { kind: 'h'; y: number }
  if (!tall) {
    const gutter = sz(ctx, 34)
    const colW = Math.round((safe.w - gutter * 2) / 2)
    const left = half(labels[0], beforeFill, b0, safe.x, colW, false)
    const rightX = W / 2 + gutter
    const rightParts = half(labels[1], afterFill, b1, rightX, safe.x + safe.w - rightX, true)
    const hOf = (ps: Pill[]) => ps.reduce((a, p) => a + p.box.h, 0) + sz(ctx, 14) * (ps.length - 1)
    const blockH = Math.max(hOf(left), hOf(rightParts))
    const top = regionBottom - blockH
    if (top < regionTop) fits = false
    stack(left, top + blockH - hOf(left))
    stack(rightParts, top + blockH - hOf(rightParts))
    nodes.push(...left.flatMap((p) => p.nodes), ...rightParts.flatMap((p) => p.nodes))
    split = { kind: 'v', x: W / 2 }
  } else {
    const splitY = Math.round(Math.min(Math.max(ctx.frame.H / 2, regionTop + 220), regionBottom - 220))
    const top = half(labels[0], beforeFill, b0, safe.x, safe.w, false)
    const bot = half(labels[1], afterFill, b1, safe.x, safe.w, true)
    const hOf = (ps: Pill[]) => ps.reduce((a, p) => a + p.box.h, 0) + sz(ctx, 14) * (ps.length - 1)
    const topStart = splitY - sz(ctx, 30) - hOf(top)
    if (topStart < regionTop) fits = false
    stack(top, topStart)
    const botEnd = stack(bot, splitY + sz(ctx, 30) + sz(ctx, 46))
    if (botEnd > regionBottom) fits = false
    nodes.push(...top.flatMap((p) => p.nodes), ...bot.flatMap((p) => p.nodes))
    split = { kind: 'h', y: splitY }
  }
  // Divider + arrow badge (decorative, no text).
  const d = sz(ctx, 78)
  if (split.kind === 'v') {
    const y0 = regionTop
    const y1 = Math.max(y0 + 10, regionBottom)
    // Divider only between the header and the label/action block, never through text.
    const lineTop = head.bottom + sz(ctx, 24)
    const lineBottom = Math.min(action.top, ...nodes.filter((n) => n.kind === 'rect' && n.layer === 'over').map((n) => n.box.y)) - sz(ctx, 24)
    nodes.unshift({ kind: 'rect', layer: 'under', box: { x: Math.round(split.x - 3), y: lineTop, w: 6, h: Math.max(0, lineBottom - lineTop) }, color: WHITE, radius: 3, alpha: 0.95 })
    const cy = lineBottom - lineTop > d * 1.5 ? Math.round((lineTop + lineBottom) / 2) : Math.round(y0 + (y1 - y0) * 0.35)
    const cb = { x: Math.round(split.x - d / 2), y: cy - d / 2, w: d, h: d }
    nodes.push({ kind: 'rect', layer: 'over', box: cb, color: WHITE, radius: d / 2, shadow: 'strong' })
    nodes.push({ kind: 'icon', icon: 'arrow_right', box: cb, color: ctx.palette.chipIcon })
  } else {
    nodes.unshift({ kind: 'rect', layer: 'under', box: { x: 0, y: split.y - 3, w: W, h: 6 }, color: WHITE, radius: 0, alpha: 0.95 })
    const cb = { x: Math.round(W - safe.x - d), y: split.y - d / 2, w: d, h: d }
    nodes.push({ kind: 'rect', layer: 'over', box: cb, color: WHITE, radius: d / 2, shadow: 'strong' })
    nodes.push({ kind: 'icon', icon: 'arrow_down', box: cb, color: ctx.palette.chipIcon })
  }
  return { nodes, zones: [{ id: 'top', style: 'gradient-top' }], logoBox: logo.box, fits, warnings }
}

const howToSteps: Template = (ctx) => {
  const { safe, tall } = ctx.frame
  const warnings: string[] = []
  const logo = logoSlot(ctx, 'left')
  const nodes: Node[] = []
  const head = header(ctx, { y: logo.nextY, align: 'left', size: 84, min: 42, maxW: tall ? safe.w : safe.w * 0.9 })
  nodes.push(...head.nodes)
  const action = actionBlock(ctx, { x: safe.x, maxW: safe.w, align: 'left', bottomY: bottom(safe) })
  nodes.push(...action.nodes)
  const regionTop = head.bottom + sz(ctx, 40)
  const regionBottom = action.top - sz(ctx, 36)
  const steps = ctx.copy.bullets.slice(0, 4)
  if (!steps.length) warnings.push('how_to_steps: no bullets → no step cards')
  const cardW = Math.round(tall ? safe.w : safe.w * 0.68)
  const cards: Node[] = []
  let y = regionTop
  steps.forEach((s, i) => {
    const c = card(ctx, s, safe.x, y, cardW, { kind: 'number', n: i + 1 })
    cards.push(...c.nodes)
    y = bottom(c.box) + sz(ctx, 18)
  })
  if (steps.length) y -= sz(ctx, 18)
  const fits = y <= regionBottom
  if (cards.length) centerVertically(cards, regionTop, y, regionBottom)
  nodes.push(...cards)
  return { nodes, zones: [{ id: 'top', style: 'gradient-top' }], logoBox: logo.box, fits, warnings }
}

const variantCard: Template = (ctx) => {
  const { safe, H } = ctx.frame
  const warnings: string[] = []
  const logo = logoSlot(ctx, 'left')
  const cardColor = ctx.palette.primary
  const onCard = readableOn(cardColor)
  const P = sz(ctx, 46)
  const innerX = safe.x + P
  const innerW = safe.w - P * 2
  const content: Node[] = []
  // Build card content top-down at y=0, then move it into place.
  const head = textNode('headline', ctx.copy.headline, {
    x: innerX,
    y: 0,
    maxW: innerW,
    align: 'left',
    font: headingFont(ctx),
    size: sz(ctx, 76),
    min: sz(ctx, 40),
    lines: 3,
    prefer: 2,
    preferMin: sz(ctx, 52),
    lh: headlineLh(ctx),
    fill: cardColor,
    color: onCard,
  })
  content.push(head)
  let y = bottom(head.box)
  if (ctx.copy.subline) {
    y += sz(ctx, 14)
    const sub = textNode('subline', ctx.copy.subline, {
      x: innerX,
      y,
      maxW: innerW,
      align: 'left',
      font: bodyFont(ctx),
      size: sz(ctx, 32),
      min: sz(ctx, 22),
      lines: 2,
      lh: 1.3,
      fill: cardColor,
      color: onCard,
    })
    content.push(sub)
    y = bottom(sub.box)
  }
  if (ctx.copy.bullets.length) {
    const chipFill = luminance(cardColor) < 0.35 ? shade(cardColor, 0.16) : shade(cardColor, -0.1)
    const flow = flowChips(ctx, ctx.copy.bullets.slice(0, 4), innerX, y + sz(ctx, 26), innerW, chipFill)
    content.push(...flow.nodes)
    y = flow.bottom
  }
  // On the brand card: badge keeps the accent; the CTA becomes the card's contrast color (white/ink).
  const badgeFill = contrastingFill(ctx.palette.badge, cardColor)
  const ctaFill = onCard
  const actionTop = y + sz(ctx, 30)
  const action = actionBlock(ctx, { x: innerX, maxW: innerW, align: 'left', bottomY: 100000, ctaFill, badgeFill })
  if (action.nodes.length) {
    shiftNodes(action.nodes, actionTop - action.top)
    content.push(...action.nodes)
    y = actionTop + (100000 - action.top)
  }
  const cardH = y + P * 2
  const cardY = bottom(safe) - cardH
  shiftNodes(content, cardY + P)
  const cardBox = { x: safe.x, y: cardY, w: safe.w, h: cardH }
  const nodes: Node[] = [{ kind: 'rect', layer: 'under', box: cardBox, color: cardColor, radius: sz(ctx, 40), shadow: 'strong' }, ...content]
  const productTop = logo.nextY
  const productBottom = cardY + Math.round(P * 0.7)
  const minProduct = H * 0.26
  const fits = productBottom - productTop >= minProduct
  const productBox = ctx.product
    ? { x: Math.round(safe.x + safe.w * 0.1), y: productTop, w: Math.round(safe.w * 0.8), h: Math.max(1, productBottom - productTop) }
    : undefined
  return { nodes, zones: [], productBox, productValign: 'bottom', logoBox: logo.box, fits, warnings }
}

const ugcPerson: Template = (ctx) => {
  const { safe, tall } = ctx.frame
  const warnings: string[] = []
  skipBullets(ctx, warnings, 'ugc_person')
  const logo = logoSlot(ctx, 'right')
  const nodes: Node[] = []
  const maxW = Math.round(safe.w * 0.84)
  const x = safe.x + (safe.w - maxW) / 2
  const captionBlock = (role: 'headline' | 'subline', text: string, y: number, size: number, min: number, fill: Rgb) => {
    const padX = Math.round(size * 0.42)
    const t = textNode(role, text, {
      x: x + padX,
      y,
      maxW: maxW - padX * 2,
      align: 'center',
      font: bodyFont(ctx, true),
      size,
      min,
      lines: 3,
      lh: 1.42,
      fill,
    })
    const lh = t.fitted.lineHeightPx
    const inset = Math.round(lh * 0.04)
    t.fitted.lines.forEach((_, i) => {
      const lw = Math.ceil(t.fitted.lineWidths[i])
      const lx = Math.round(x + maxW / 2 - lw / 2 - padX)
      nodes.push({ kind: 'rect', layer: 'over', box: { x: lx, y: t.box.y + i * lh + inset, w: lw + padX * 2, h: lh - inset * 2 + (i < t.fitted.lines.length - 1 ? inset * 2 + 2 : 0) }, color: fill, radius: Math.round(size * 0.28) })
    })
    nodes.push(t)
    return bottom(t.box)
  }
  const top = logo.box ? logo.nextY : safe.y + Math.round(safe.h * (tall ? 0.04 : 0.02))
  let y = captionBlock('headline', ctx.copy.headline, top, sz(ctx, 58), sz(ctx, 32), WHITE)
  if (ctx.copy.subline) y = captionBlock('subline', ctx.copy.subline, y + sz(ctx, 18), sz(ctx, 34), sz(ctx, 22), INK)
  const action = actionBlock(ctx, { x: safe.x, maxW: safe.w, align: 'center', bottomY: bottom(safe) })
  nodes.push(...action.nodes)
  const fits = y + sz(ctx, 40) <= action.top
  return { nodes, zones: [], logoBox: logo.box, fits, warnings }
}

const handheldOverlay: Template = (ctx) => {
  const { safe } = ctx.frame
  const warnings: string[] = []
  skipBullets(ctx, warnings, 'handheld_overlay')
  const logo = logoSlot(ctx, 'left')
  const nodes: Node[] = []
  const head = header(ctx, { y: logo.nextY, align: 'center', size: 112, min: 52, prefer: 2, subSize: 38 })
  nodes.push(...head.nodes)
  const action = actionBlock(ctx, { x: safe.x, maxW: safe.w, align: 'center', bottomY: bottom(safe) })
  nodes.push(...action.nodes)
  const fits = head.bottom + sz(ctx, 60) <= action.top
  return { nodes, zones: [{ id: 'top', style: 'gradient-top' }], logoBox: logo.box, fits, warnings }
}

const explainer: Template = (ctx) => {
  const { safe, tall } = ctx.frame
  const warnings: string[] = []
  const logo = logoSlot(ctx, 'left')
  const nodes: Node[] = []
  const head = header(ctx, { y: logo.nextY, align: 'center', size: 78, min: 40, prefer: 2 })
  nodes.push(...head.nodes)
  const action = actionBlock(ctx, { x: safe.x, maxW: safe.w, align: 'center', bottomY: bottom(safe) })
  nodes.push(...action.nodes)
  const regionTop = head.bottom + sz(ctx, 40)
  const regionBottom = action.top - sz(ctx, 36)
  const items = ctx.copy.bullets.slice(0, 4)
  const gap = sz(ctx, 24)
  let fits = regionBottom > regionTop
  let productBox: Box | undefined
  const cardNodes: Node[] = []
  const column = (list: string[], x: number, w: number, top: number, bot: number) => {
    const built = list.map((t) => card(ctx, t, x, 0, w, { kind: 'check' }, 28))
    const total = built.reduce((a, c) => a + c.box.h, 0) + gap * Math.max(0, built.length - 1)
    let y = top + Math.max(0, (bot - top - total) / 2)
    if (total > bot - top) fits = false
    for (const c of built) {
      shiftNodes(c.nodes, Math.round(y))
      cardNodes.push(...c.nodes)
      y += c.box.h + gap
    }
  }
  if (ctx.product && !tall && items.length) {
    const colW = Math.round(safe.w * 0.3)
    const left = items.filter((_, i) => i % 2 === 0)
    const rightItems = items.filter((_, i) => i % 2 === 1)
    column(left, safe.x, colW, regionTop, regionBottom)
    column(rightItems, safe.x + safe.w - colW, colW, regionTop, regionBottom)
    productBox = { x: safe.x + colW + gap, y: regionTop, w: safe.w - (colW + gap) * 2, h: Math.max(1, regionBottom - regionTop) }
  } else if (items.length) {
    const colW = Math.round((safe.w - gap) / 2)
    const rows = Math.ceil(items.length / 2)
    const built = items.map((t, i) => card(ctx, t, safe.x + (i % 2) * (colW + gap), 0, colW, { kind: 'check' }, 28))
    const rowHs = Array.from({ length: rows }, (_, r) => Math.max(...built.filter((_, i) => Math.floor(i / 2) === r).map((c) => c.box.h)))
    const gridH = rowHs.reduce((a, b) => a + b, 0) + gap * (rows - 1)
    const productH = ctx.product ? Math.max(0, regionBottom - regionTop - gridH - gap) : 0
    const gridTop = ctx.product ? regionBottom - gridH : regionTop + Math.max(0, (regionBottom - regionTop - gridH) / 2)
    if (gridH > regionBottom - regionTop || (ctx.product && productH < ctx.frame.H * 0.2)) fits = false
    let y = gridTop
    rowHs.forEach((rh, r) => {
      built.forEach((c, i) => {
        if (Math.floor(i / 2) !== r) return
        shiftNodes(c.nodes, Math.round(y + (rh - c.box.h) / 2))
        cardNodes.push(...c.nodes)
      })
      y += rh + gap
    })
    if (ctx.product) productBox = { x: safe.x, y: regionTop, w: safe.w, h: Math.max(1, productH) }
  } else if (ctx.product) {
    productBox = { x: safe.x, y: regionTop, w: safe.w, h: Math.max(1, regionBottom - regionTop) }
  }
  nodes.push(...cardNodes)
  return { nodes, zones: [{ id: 'top', style: 'gradient-top' }], productBox, logoBox: logo.box, fits, warnings }
}

export const TEMPLATES: Record<AdFormat, Template> = {
  offer_graphic: offerGraphic,
  before_after: beforeAfter,
  how_to_steps: howToSteps,
  variant_card: variantCard,
  ugc_person: ugcPerson,
  handheld_overlay: handheldOverlay,
  explainer,
}

export const ALL_FORMATS = Object.keys(TEMPLATES) as AdFormat[]
