/**
 * renderAd: scene (bytes/URL) + copy + brand visual → finished ad PNG.
 *
 *   scene / plate (sharp cover-fit)
 *   + under layer (scrims, panels, cards, frames, dividers; SVG → resvg)
 *     → contrast is measured here per text box, scrims are strengthened until ≥ 4.5:1
 *   + real product cut-out(s) (fidelity/composite.ts). Exact mode includes the deterministic relight
 *     stage (fidelity/harmonize.ts): plate light model + shared grade, directional shading, white
 *     balance, light wrap, contact/cast shadows, reflection on glossy plates, grain/defocus match
 *   + optional AI relight hook (relight 'ai'; kept only when fidelity holds)
 *   + logo (background removed, variant picked for the background under its slot)
 *   = base
 *   + over layer (pills/icons as SVG + text via satori → resvg)
 *   = final PNG
 *
 * Layout = one of 7 layout FAMILIES (families.ts) × the format. ONE product-avoid path for
 * every family: the product box is the composite's placement of the real cut-out (exact mode,
 * every format; generated mode on cut-out formats) or, when no cut-out is placed, the scene's
 * product bbox from the vision check (`productBox`). The family's placement variants (and, for
 * a scene bbox, free regions around it) are tried until nothing overlaps it; groups still on it
 * move to free zones (render/avoid.ts) and in exact mode the product shrinks when nothing can move.
 * All on-image text comes from `copy`, so it is exact by construction.
 */
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import sharp, { type OverlayOptions } from 'sharp'
import type { AdFormat, AspectRatio } from '../types.js'
import { blend, contrastFromLuminance, contrastRatio, ensureReadableFill, INK, luminance, parseColor, readableOn, toHex, WHITE, type Rgb } from './color.js'
import { composeFamily, FAMILY_SPECS, type LayoutFamily } from './families.js'
import { ensureBrandFonts, type FontResolution } from './font-resolver.js'
import { cssFamily, familyFonts, resolveFonts, satoriFonts, type ResolvedFonts } from './fonts.js'
import { compositeProducts, layoutProductGroup, unionBox, type PlacedProduct } from '../fidelity/composite.js'
import { estimateLight, gradeFor, gradeImage, lightSummary, type LightModel } from '../fidelity/harmonize.js'
import { avoidRegions, blockingNodes, overlayBoxes } from './avoid.js'
import { ALL_RATIOS, inside, makeFrame, overlaps, union, type Frame } from './frame.js'
import { decodeLayer, loadImageBytes, prepareScene, regionStats, resizeLayer, trimTransparent, type PreparedLayer } from './image.js'
import { pickLogoVariant, prepareLogo, type LogoVariantName, type LogoVariants } from './logo.js'
import { makePalette, type Ctx, type IconNode, type Node, type NormalizedCopy, type RectNode, type TemplateLayout, type TextNode, type Zone } from './layout.js'
import { TEMPLATES } from './templates.js'
import { normalizeText } from './text.js'
import type { Box, ImageInput, LayoutReport, LayoutTextElement, NormalizedBox, RenderAdInput, RenderAdResult } from './types.js'

const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const MIN_CONTRAST = 4.5
/** Planning target (a little above the minimum to absorb gradient falloff / sampling). */
const PLAN_CONTRAST = 5
const MAX_SCRIM = 0.94
const SCALES = [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56]
const CUTOUT_FORMATS: AdFormat[] = ['offer_graphic', 'variant_card', 'explainer']
/** Formats that may show real parts next to the hero (H3). */
const PARTS_FORMATS: AdFormat[] = ['offer_graphic', 'explainer']
/** Exact mode: product-box shrink steps when text cannot be moved off it. */
const PRODUCT_SHRINK = [1, 0.9, 0.8, 0.7, 0.6]

interface Assets {
  scene: ImageInput
  /** Scene size after EXIF orientation (for mapping a normalized product box through the cover crop). */
  sceneSize: { width: number; height: number } | null
  product: PreparedLayer | null
  parts: PreparedLayer[]
  logo: LogoVariants | null
  /** Brand fonts (kit upload → bundled → disk cache → Google Fonts → GitHub), resolved once. */
  fonts: FontResolution
  warnings: string[]
}

async function loadAssets(input: Omit<RenderAdInput, 'ratio'>): Promise<Assets> {
  const warnings: string[] = []
  const exact = input.productMode === 'exact'
  let product: PreparedLayer | null = null
  const parts: PreparedLayer[] = []
  if (input.productCutout) {
    if (!exact && !CUTOUT_FORMATS.includes(input.format)) {
      warnings.push(`productCutout ignored for ${input.format} (scene carries the product)`)
    } else {
      const layer = await decodeLayer(input.productCutout)
      if (layer) product = await trimTransparent(layer)
      else warnings.push('productCutout could not be decoded; skipped')
    }
  }
  if (exact && product && input.productParts?.length && PARTS_FORMATS.includes(input.format)) {
    for (const p of input.productParts.slice(0, 3)) {
      const layer = await decodeLayer(p)
      if (layer) parts.push(await trimTransparent(layer))
      else warnings.push('product part could not be decoded; skipped')
    }
  }
  let logo: LogoVariants | null = null
  const logoSrc = input.logo ?? input.visual?.logoUrl
  if (logoSrc) {
    try {
      logo = await prepareLogo(await loadImageBytes(logoSrc))
    } catch {
      warnings.push('logo could not be loaded/decoded; skipped')
    }
  }
  // Decode the scene bytes once (re-used for every ratio).
  const scene = await loadImageBytes(input.sceneImage)
  let sceneSize: Assets['sceneSize'] = null
  try {
    const m = await sharp(scene).metadata()
    if (m.width && m.height) sceneSize = (m.orientation ?? 1) >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height }
  } catch {
    if (input.productBox || input.productAvoid) warnings.push('productBox ignored: scene size unreadable')
  }
  const fonts = await ensureBrandFonts(input.visual, input.fonts)
  for (const role of ['heading', 'body'] as const) {
    const r = fonts[role]
    if (r.note) warnings.push(`${role} font "${r.requested ?? ''}": ${r.note}; using ${r.family}`)
  }
  return { scene, sceneSize, product, parts, logo, fonts, warnings }
}

type CornerBox = { x0: number; y0: number; x1: number; y1: number }

/** {x, y, w, h} or corner form {x0, y0, x1, y1} (both fractions 0–1) → {x, y, w, h}. */
function toNormalizedBox(b: NormalizedBox | CornerBox | undefined | null): NormalizedBox | null {
  if (!b || typeof b !== 'object') return null
  if ('x0' in b) return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }
  return b
}

/**
 * Normalized scene box ({x, y, w, h} or {x0, y0, x1, y1}) → canvas px through the same centered
 * cover-fit as prepareScene. Null when invalid or cropped away.
 */
export function mapSceneBox(box: NormalizedBox | CornerBox, scene: { width: number; height: number }, W: number, H: number): Box | null {
  const nb = toNormalizedBox(box)
  if (!nb) return null
  const vals = [nb.x, nb.y, nb.w, nb.h]
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v)) || nb.w <= 0 || nb.h <= 0) return null
  const scale = Math.max(W / scene.width, H / scene.height)
  const dw = scene.width * scale
  const dh = scene.height * scale
  const ox = (dw - W) / 2
  const oy = (dh - H) / 2
  const x0 = Math.max(0, Math.min(W, nb.x * dw - ox))
  const y0 = Math.max(0, Math.min(H, nb.y * dh - oy))
  const x1 = Math.max(0, Math.min(W, (nb.x + nb.w) * dw - ox))
  const y1 = Math.max(0, Math.min(H, (nb.y + nb.h) * dh - oy))
  if (x1 - x0 < 4 || y1 - y0 < 4) return null
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }
}

/** Free rectangles of the safe area around the product box (largest first, too-small ones dropped). */
function freeRegions(p: Box, frame: Frame): Array<{ side: 'left' | 'right' | 'top' | 'bottom'; box: Box }> {
  const S = frame.safe
  const gap = 56
  const out: Array<{ side: 'left' | 'right' | 'top' | 'bottom'; box: Box }> = [
    { side: 'left', box: { x: S.x, y: S.y, w: p.x - gap - S.x, h: S.h } },
    { side: 'right', box: { x: p.x + p.w + gap, y: S.y, w: S.x + S.w - (p.x + p.w + gap), h: S.h } },
    { side: 'top', box: { x: S.x, y: S.y, w: S.w, h: p.y - gap - S.y } },
    { side: 'bottom', box: { x: S.x, y: p.y + p.h + gap, w: S.w, h: S.y + S.h - (p.y + p.h + gap) } },
  ]
  return out
    .filter((r) => r.box.w >= S.w * 0.36 && r.box.h >= S.h * 0.18)
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
}

/**
 * Nodes that must stay off the product box.
 * - Composited cut-out (`composited`): drawn ABOVE the under layer, so only what is drawn over it
 *   counts: text, icons and over-layer shapes (pills, cards, stickers, rules) — avoid.ts' blockingNodes.
 * - Scene product (vision bbox): everything drawn over the photo except decor and scrims — text,
 *   pills, cards and solid panels (an under-layer panel would hide the product too).
 */
function productColliders(layout: TemplateLayout, composited: boolean): Node[] {
  if (composited) return blockingNodes(layout)
  return layout.nodes.filter((n) => !(n.kind === 'rect' && n.decor) && n.kind !== 'icon')
}

/** Overlap area (px²) between the colliding nodes and the product boxes. */
function productOverlap(layout: TemplateLayout, boxes: Box[], composited: boolean): number {
  if (!boxes.length) return 0
  let area = 0
  for (const n of productColliders(layout, composited)) {
    for (const a of boxes) {
      if (!overlaps(n.box, a)) continue
      const w = Math.min(n.box.x + n.box.w, a.x + a.w) - Math.max(n.box.x, a.x)
      const h = Math.min(n.box.y + n.box.h, a.y + a.h) - Math.max(n.box.y, a.y)
      if (w > 2 && h > 2) area += w * h
    }
  }
  return area
}

function normalizeCopy(copy: RenderAdInput['copy']): NormalizedCopy {
  return {
    headline: normalizeText(copy.headline),
    subline: normalizeText(copy.subline),
    bullets: (copy.bullets ?? []).map(normalizeText).filter(Boolean),
    offer: normalizeText(copy.offerLine),
    cta: normalizeText(copy.cta),
  }
}

const textNodes = (layout: TemplateLayout) => layout.nodes.filter((n): n is TextNode => n.kind === 'text')

function layoutFits(layout: TemplateLayout, frame: Frame): boolean {
  if (!layout.fits) return false
  return textNodes(layout).every((t) => t.fitted.fits && inside(t.box, frame.safe, 1))
}

// ---------------------------------------------------------------------------
// Contrast planning
// ---------------------------------------------------------------------------

interface ZonePlan {
  zone: Zone
  texts: TextNode[]
  box: Box
  text: Rgb
  scrim: Rgb
  alpha: number
}

function alphaNeeded(text: Rgb, scrim: Rgb, worst: Rgb): number {
  for (let a = 0; a <= MAX_SCRIM + 1e-9; a += 0.02) {
    if (contrastRatio(text, blend(scrim, a, worst)) >= PLAN_CONTRAST) return a
  }
  return MAX_SCRIM
}

async function planZones(layout: TemplateLayout, scene: Buffer, frame: Frame): Promise<ZonePlan[]> {
  const plans: ZonePlan[] = []
  for (const zone of layout.zones) {
    const texts = textNodes(layout).filter((t) => t.zone === zone.id)
    if (!texts.length) continue
    const box = union(texts.map((t) => t.box))
    const stats = await regionStats(scene, box, frame.W, frame.H)
    const aWhite = alphaNeeded(WHITE, BLACK, stats.brightest)
    const aInk = alphaNeeded(INK, WHITE, stats.darkest)
    const useInk = zone.tone === 'dark' ? false : zone.tone === 'light' ? true : aInk + 0.1 < aWhite
    const busy = stats.spread > 0.09
    // Very busy backgrounds (patterns, foliage, crowds) get a solid-ish panel instead of a wash.
    const veryBusy = stats.spread > 0.2
    const floor = Math.max(zone.minAlpha ?? 0, veryBusy ? 0.88 : useInk ? (busy ? 0.45 : 0) : busy ? 0.5 : 0.25)
    plans.push({
      zone: veryBusy && zone.style !== 'box' ? { ...zone, style: 'box' } : zone,
      texts,
      box,
      text: useInk ? INK : WHITE,
      scrim: useInk ? WHITE : BLACK,
      alpha: Math.min(MAX_SCRIM, Math.max(floor, useInk ? aInk : aWhite)),
    })
  }
  return plans
}

// ---------------------------------------------------------------------------
// SVG building
// ---------------------------------------------------------------------------

const SHADOW_DEFS =
  '<defs>' +
  '<filter id="sh-soft" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.18"/></filter>' +
  '<filter id="sh-strong" x="-20%" y="-40%" width="140%" height="200%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000" flood-opacity="0.28"/></filter>' +
  '</defs>'

const n2 = (v: number) => (Math.round(v * 100) / 100).toString()

function roundedRectPath(b: Box, radius: number): string {
  const r = Math.min(radius, b.w / 2, b.h / 2)
  const { x, y, w, h } = b
  return `M${n2(x + r)} ${n2(y)}H${n2(x + w - r)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(x + w)} ${n2(y + r)}V${n2(y + h - r)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(x + w - r)} ${n2(y + h)}H${n2(x + r)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(x)} ${n2(y + h - r)}V${n2(y + r)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(x + r)} ${n2(y)}Z`
}

function rectSvg(r: RectNode): string {
  if (r.hole) {
    const outer = `M${n2(r.box.x)} ${n2(r.box.y)}H${n2(r.box.x + r.box.w)}V${n2(r.box.y + r.box.h)}H${n2(r.box.x)}Z`
    return `<path d="${outer}${roundedRectPath(r.hole.box, r.hole.radius)}" fill="${toHex(r.color)}" fill-opacity="${r.alpha ?? 1}" fill-rule="evenodd"/>`
  }
  const { x, y, w, h } = r.box
  const rx = Math.min(r.radius, w / 2, h / 2)
  const filter = r.shadow ? ` filter="url(#sh-${r.shadow})"` : ''
  const stroke = r.stroke ? ` stroke="${toHex(r.stroke.color)}" stroke-width="${r.stroke.width}" stroke-opacity="${r.stroke.alpha ?? 1}"` : ''
  return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" rx="${n2(rx)}" fill="${toHex(r.color)}" fill-opacity="${r.alpha ?? 1}"${stroke}${filter}/>`
}

function iconSvg(i: IconNode): string {
  const { x, y, w } = i.box
  const p = (fx: number, fy: number) => `${n2(x + w * fx)} ${n2(y + w * fy)}`
  const sw = n2(w * (i.icon === 'check' ? 0.12 : 0.11))
  const c = toHex(i.color)
  const common = `fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`
  if (i.icon === 'check') return `<path d="M${p(0.28, 0.52)} L${p(0.44, 0.67)} L${p(0.73, 0.37)}" ${common}/>`
  if (i.icon === 'arrow_right') return `<path d="M${p(0.22, 0.5)} L${p(0.76, 0.5)} M${p(0.54, 0.28)} L${p(0.76, 0.5)} L${p(0.54, 0.72)}" ${common}/>`
  return `<path d="M${p(0.5, 0.22)} L${p(0.5, 0.76)} M${p(0.28, 0.54)} L${p(0.5, 0.76)} L${p(0.72, 0.54)}" ${common}/>`
}

function zoneSvg(plan: ZonePlan, frame: Frame, idx: number): string {
  const { W, H } = frame
  const c = toHex(plan.scrim)
  const a = plan.alpha
  if (a <= 0) return ''
  if (plan.zone.style === 'box') {
    const b = plan.box
    const big = Math.max(...plan.texts.map((t) => t.fitted.fontSize))
    const padX = Math.round(Math.max(28, big * 0.3))
    const padY = Math.round(Math.max(20, big * 0.18))
    return `<rect x="${n2(b.x - padX)}" y="${n2(b.y - padY)}" width="${n2(b.w + padX * 2)}" height="${n2(b.h + padY * 2)}" rx="${Math.round(padY * 1.2)}" fill="${c}" fill-opacity="${a}"/>`
  }
  const fade = Math.round(H * (plan.zone.fade ?? 0.16))
  const id = `zg${idx}`
  if (plan.zone.style === 'gradient-left' || plan.zone.style === 'gradient-right') {
    const hf = Math.round(W * (plan.zone.fade ?? 0.16))
    const left = plan.zone.style === 'gradient-left'
    const solidEnd = left ? plan.box.x + plan.box.w + 24 : W - (plan.box.x - 24)
    const bandW = Math.min(W, solidEnd + hf)
    const o1 = Math.min(1, solidEnd / bandW)
    const o2 = Math.min(1, (solidEnd + hf * 0.5) / bandW)
    const [x1, x2] = left ? ['0', '1'] : ['1', '0']
    return (
      `<defs><linearGradient id="${id}" x1="${x1}" y1="0" x2="${x2}" y2="0">` +
      `<stop offset="0" stop-color="${c}" stop-opacity="${a}"/><stop offset="${n2(o1)}" stop-color="${c}" stop-opacity="${a}"/>` +
      `<stop offset="${n2(o2)}" stop-color="${c}" stop-opacity="${n2(a * 0.42)}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>` +
      `</linearGradient></defs><rect x="${left ? 0 : W - bandW}" y="0" width="${bandW}" height="${H}" fill="url(#${id})"/>`
    )
  }
  if (plan.zone.style === 'gradient-top') {
    const solidEnd = plan.box.y + plan.box.h + 24
    const bandH = Math.min(H, solidEnd + fade)
    const o1 = Math.min(1, solidEnd / bandH)
    const o2 = Math.min(1, (solidEnd + fade * 0.5) / bandH)
    return (
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${c}" stop-opacity="${a}"/><stop offset="${n2(o1)}" stop-color="${c}" stop-opacity="${a}"/>` +
      `<stop offset="${n2(o2)}" stop-color="${c}" stop-opacity="${n2(a * 0.42)}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>` +
      `</linearGradient></defs><rect x="0" y="0" width="${W}" height="${bandH}" fill="url(#${id})"/>`
    )
  }
  const solidStart = plan.box.y - 24
  const bandY = Math.max(0, solidStart - fade)
  const bandH = H - bandY
  const o1 = (solidStart - bandY) / bandH
  const o0 = (solidStart - fade * 0.5 - bandY) / bandH
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset="${n2(Math.max(0, o0))}" stop-color="${c}" stop-opacity="${n2(a * 0.42)}"/>` +
    `<stop offset="${n2(Math.max(0, o1))}" stop-color="${c}" stop-opacity="${a}"/><stop offset="1" stop-color="${c}" stop-opacity="${a}"/>` +
    `</linearGradient></defs><rect x="0" y="${bandY}" width="${W}" height="${bandH}" fill="url(#${id})"/>`
  )
}

function rasterize(svg: string): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false }, background: 'rgba(0,0,0,0)' }).render().asPng()
}

/** Satori element tree (plain objects) for the text nodes only. */
function textTree(texts: TextNode[], colorOf: (t: TextNode) => Rgb, frame: Frame) {
  const PAD = 40
  const children = texts.map((t) => {
    const left = t.align === 'left' ? t.box.x : t.align === 'right' ? t.box.x - PAD * 2 : t.box.x - PAD
    return {
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          left,
          top: t.box.y,
          width: t.box.w + PAD * 2,
          height: t.box.h,
          display: 'flex',
          flexDirection: 'column',
          alignItems: t.align === 'left' ? 'flex-start' : t.align === 'right' ? 'flex-end' : 'center',
        },
        children: t.fitted.lines.map((line) => ({
          type: 'div',
          props: {
            style: {
              display: 'flex',
              whiteSpace: 'nowrap',
              fontFamily: cssFamily(t.font.family),
              fontWeight: t.font.weight,
              fontSize: t.fitted.fontSize,
              lineHeight: `${t.fitted.lineHeightPx}px`,
              height: t.fitted.lineHeightPx,
              color: toHex(colorOf(t)),
            },
            children: line,
          },
        })),
      },
    }
  })
  return { type: 'div', props: { style: { display: 'flex', position: 'relative', width: frame.W, height: frame.H }, children } }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface PlanLayoutInput {
  format: AdFormat
  ratio: AspectRatio
  copy: RenderAdInput['copy']
  visual?: RenderAdInput['visual']
  language: RenderAdInput['language']
  /** Hero cut-out size (when a cut-out is placed). */
  product?: { width: number; height: number }
  /** Part cut-out sizes (exact mode, offer_graphic / explainer). */
  parts?: Array<{ width: number; height: number }>
  logo?: { width: number; height: number }
  /** Exact mode: every format of every family reserves the product slot. */
  exact?: boolean
  /** Default 'bold_pill' (the original templates). */
  layoutFamily?: LayoutFamily
  /** Placement variant tried first. */
  placement?: string
  /** Scene product box (canvas px; generated mode) — used when no cut-out is placed. */
  avoidBox?: Box | null
  /** Resolved brand fonts (renderAd passes the font resolver's result); default resolveFonts(visual). */
  fonts?: ResolvedFonts
}

export interface PlannedLayout {
  layout: TemplateLayout
  scale: number
  frame: Frame
  fonts: ResolvedFonts
  palette: ReturnType<typeof makePalette>
  family: LayoutFamily
  /** Placement variant used (`<variant>@<side>` when laid out in a free region around the product). */
  placement: string
  /** Overlap (px²) of the chosen candidate with its product box, before avoid moves / shrink. */
  collision: number
}

/** Product boxes of a candidate layout: the composite's placement, else the scene product box. */
function productBoxesFor(layout: TemplateLayout, input: PlanLayoutInput): { boxes: Box[]; composited: boolean } {
  if (input.product && layout.productBox && layout.productBox.w > 20 && layout.productBox.h > 20) {
    const valign = layout.productValign ?? (input.exact ? 'bottom' : 'center')
    return { boxes: layoutProductGroup(layout.productBox, input.product, input.exact ? input.parts ?? [] : [], valign), composited: true }
  }
  return { boxes: input.avoidBox ? [input.avoidBox] : [], composited: false }
}

/**
 * Layout only (no pixels): the family's placement variants (plus free regions around a scene
 * product box), each at the largest type scale that fits; the first candidate that fits with
 * nothing over its product box wins, else the least-overlapping one.
 */
export function planLayout(input: PlanLayoutInput): PlannedLayout {
  const frame = makeFrame(input.ratio)
  let fonts = input.fonts ?? resolveFonts(input.visual)
  const palette = makePalette(parseColor(input.visual?.primaryColor), parseColor(input.visual?.secondaryColor), parseColor(input.visual?.accentColor))
  // Style DNA render profile (winners): CTA color emphasis and headline weight.
  const style = input.visual?.styleProfile
  if (style?.paletteEmphasis === 'accent' || style?.paletteEmphasis === 'neutral') {
    palette.cta = style.paletteEmphasis === 'accent' ? ensureReadableFill(palette.accent) : INK
    palette.ctaText = readableOn(palette.cta)
  }
  if (style?.typeWeight === 'regular' && fonts.heading.weight > 700 && familyFonts(fonts.heading.family).some((f) => f.weight === 700)) {
    fonts = { ...fonts, heading: { ...fonts.heading, weight: 700 } }
  }
  const copy = normalizeCopy(input.copy)
  if (!TEMPLATES[input.format]) throw new Error(`unknown ad format: ${input.format}`)
  const family: LayoutFamily = input.layoutFamily && FAMILY_SPECS[input.layoutFamily] ? input.layoutFamily : 'bold_pill'
  const avoidBox = input.avoidBox ?? null

  const named = [...FAMILY_SPECS[family].placements(input.format)]
  if (input.placement && named.includes(input.placement)) named.sort((a, b) => (a === input.placement ? -1 : b === input.placement ? 1 : 0))
  const candidates: Array<{ placement: string; base: string; region?: Box }> = named.map((p) => ({ placement: p, base: p }))
  if (avoidBox) {
    for (const fr of freeRegions(avoidBox, frame)) {
      const prefer = fr.side === 'left' || fr.side === 'right' ? [fr.side, 'left', 'top', 'bottom'] : [fr.side, 'top', 'bottom', 'left']
      const base = prefer.find((p) => named.includes(p)) ?? named[0]
      candidates.push({ placement: `${base}@${fr.side}`, base, region: fr.box })
    }
  }
  let best: { layout: TemplateLayout; scale: number; placement: string; fits: boolean; collision: number } | null = null
  for (const cand of candidates) {
    const f: Frame = cand.region ? { ...frame, safe: cand.region, tall: cand.region.h / cand.region.w > 1.5 } : frame
    let candidate: TemplateLayout | null = null
    let candScale = SCALES[0]
    for (const s of SCALES) {
      const ctx: Ctx = {
        frame: f,
        fonts,
        palette,
        copy,
        language: input.language,
        s,
        product: input.product,
        logo: input.logo,
        exact: input.exact,
        format: input.format,
        placement: cand.base,
        avoid: avoidBox ? [avoidBox] : [],
        ...(cand.region ? { region: { full: frame.safe } } : {}),
      }
      candidate = composeFamily(family, ctx)
      candScale = s
      if (layoutFits(candidate, f)) break
    }
    if (!candidate) continue
    const fits = layoutFits(candidate, f) && layoutFits(candidate, frame)
    const pb = productBoxesFor(candidate, input)
    const collision = productOverlap(candidate, pb.boxes, pb.composited)
    const better = !best || (fits && !best.fits) || (fits === best.fits && collision < best.collision)
    if (better) best = { layout: candidate, scale: candScale, placement: cand.placement, fits, collision }
    if (fits && collision === 0) break
  }
  if (!best) throw new Error('layout failed')
  return { layout: best.layout, scale: best.scale, frame, fonts, palette, family, placement: best.placement, collision: best.collision }
}

/**
 * Where the product would land for each ratio (exact mode), in canvas px — same family and
 * placement choice as the render. Used to tell the plate model where to leave an empty surface.
 */
export function planProductBoxes(
  input: Omit<PlanLayoutInput, 'ratio' | 'exact' | 'avoidBox'> & { ratios: AspectRatio[]; product: { width: number; height: number } },
): Partial<Record<AspectRatio, Box>> {
  const out: Partial<Record<AspectRatio, Box>> = {}
  for (const ratio of input.ratios) {
    const { layout, frame } = planLayout({ ...input, ratio, exact: true })
    const placed = placeProductAndAvoidText({ layout, frame, product: input.product, parts: input.parts, exact: true })
    if (placed.productBoxes.length) out[ratio] = placed.productBoxes[0]
  }
  return out
}

function scaleGroup(boxes: Box[], k: number, anchor: Box): Box[] {
  if (k === 1) return boxes
  // Shrink around the bottom-center of the layout box (the product keeps standing on its surface).
  const ax = anchor.x + anchor.w / 2
  const ay = anchor.y + anchor.h
  return boxes.map((b) => ({ x: Math.round(ax + (b.x - ax) * k), y: Math.round(ay + (b.y - ay) * k), w: Math.max(1, Math.round(b.w * k)), h: Math.max(1, Math.round(b.h * k)) }))
}

/**
 * Product placement + "text never over the product" (H4), pure (no pixels; mutates the layout's
 * node positions). Exact mode: the real cut-out boxes; groups that intersect them move to free
 * zones, and the product shrinks (anchored on its surface) when nothing can move. Generated mode:
 * the scene product's bbox is the region text avoids.
 */
export function placeProductAndAvoidText(input: {
  layout: TemplateLayout
  frame: Frame
  product: { width: number; height: number } | null
  parts?: Array<{ width: number; height: number }>
  exact: boolean
  avoidRegion?: Box | null
}): { productBoxes: Box[]; textOverProduct: boolean; avoidRegion: Box | null; warnings: string[] } {
  const { layout, frame } = input
  const warnings: string[] = []
  let productBoxes: Box[] = []
  if (input.product && layout.productBox && layout.productBox.w > 20 && layout.productBox.h > 20) {
    productBoxes = layoutProductGroup(layout.productBox, input.product, input.exact ? input.parts ?? [] : [], layout.productValign ?? (input.exact ? 'bottom' : 'center'))
  }
  const fixed = layout.logoBox ? [layout.logoBox] : []
  let textOverProduct = false
  const avoidRegion = productBoxes.length ? null : input.avoidRegion ?? null
  if (productBoxes.length) {
    const anchor = layout.productBox as Box
    const original = productBoxes
    for (const k of PRODUCT_SHRINK) {
      productBoxes = scaleGroup(original, k, anchor)
      const res = avoidRegions(layout, productBoxes, frame.safe, fixed)
      if (!res.conflicts) break
      if (k === PRODUCT_SHRINK[PRODUCT_SHRINK.length - 1]) textOverProduct = true
    }
    if (productBoxes[0] !== original[0] && !textOverProduct) warnings.push('product box shrunk to keep text off the product')
  } else if (avoidRegion) {
    textOverProduct = avoidRegions(layout, [avoidRegion], frame.safe, fixed).conflicts > 0
  }
  if (textOverProduct) warnings.push('text overlaps the product (no free zone)')
  return { productBoxes, textOverProduct, avoidRegion, warnings }
}

async function renderWithAssets(input: RenderAdInput, assets: Assets): Promise<RenderAdResult> {
  const exact = input.productMode === 'exact' && Boolean(assets.product)
  const logoDims = assets.logo ? { width: assets.logo.onLight.width, height: assets.logo.onLight.height } : undefined
  const productDims = assets.product ? { width: assets.product.width, height: assets.product.height } : undefined
  const partDims = exact ? assets.parts.map((p) => ({ width: p.width, height: p.height })) : []
  const warnings = [...assets.warnings]
  if (!normalizeText(input.copy.headline)) warnings.push('empty headline')

  // Generated mode: the scene product's bbox (vision check) mapped through the cover crop.
  // Exact mode never uses it — the composite's placement is the product box.
  const frame0 = makeFrame(input.ratio)
  const sceneBox = toNormalizedBox(input.productBox ?? input.productAvoid)
  const avoidBox = !exact && sceneBox && assets.sceneSize ? mapSceneBox(sceneBox, assets.sceneSize, frame0.W, frame0.H) : null

  // 1) Layout: family placement variants × progressive type scale, product box kept clear.
  const planned = planLayout({ ...input, product: productDims, parts: partDims, logo: logoDims, exact, avoidBox, fonts: assets.fonts.fonts })
  const { layout, scale, frame, fonts, palette, family, placement } = planned
  let scene = await prepareScene(assets.scene, frame.W, frame.H)
  warnings.push(...layout.warnings)
  const texts = textNodes(layout)

  // 2) Product boxes (real cut-out placement) or the scene product's bbox; groups still on it move
  //    to free zones, and in exact mode the product shrinks when nothing can move.
  const placed = placeProductAndAvoidText({ layout, frame, product: assets.product, parts: exact ? assets.parts : [], exact, avoidRegion: avoidBox })
  const productBoxes = placed.productBoxes
  const composited = productBoxes.length > 0
  const guarded = composited ? productBoxes : avoidBox ? [avoidBox] : []
  const productBoxRespected = productOverlap(layout, guarded, composited) === 0
  // Exact mode relight stage, part 1: light model of the clean plate around the product slot and
  // the shared grade on the plate itself (before panels / scrims, so brand colors stay exact).
  const harmonize = exact && input.harmonize !== false && productBoxes.length > 0
  let lightModel: LightModel | null = null
  if (harmonize) {
    lightModel = await estimateLight(scene, unionBox(productBoxes), { light: input.light, surface: input.surface })
    scene = await gradeImage(scene, gradeFor(lightModel))
  }
  warnings.push(...placed.warnings)
  if (!productBoxRespected) warnings.push('copy overlaps the product box in every placement of this family (least-overlapping placement used)')

  let logoBox: Box | null = layout.logoBox ?? null

  // 3) Scrim planning on scene + under layer, strengthened until ≥ 4.5:1.
  const plans = await planZones(layout, scene, frame)
  // Rules, underlines, outline buttons and link arrows follow their zone's text color.
  const zoneText = new Map(plans.map((p) => [p.zone.id, p.text]))
  for (const n of layout.nodes) {
    if ((n.kind === 'rect' || n.kind === 'icon') && n.zone) {
      const c = zoneText.get(n.zone) ?? WHITE
      n.color = c
      if (n.kind === 'rect' && n.stroke) n.stroke = { ...n.stroke, color: c }
    }
  }
  const underRects = layout.nodes.filter((n): n is RectNode => n.kind === 'rect' && n.layer === 'under')
  const composeUnder = async () => {
    const under =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.W}" height="${frame.H}" viewBox="0 0 ${frame.W} ${frame.H}">${SHADOW_DEFS}` +
      plans.map((p, i) => zoneSvg(p, frame, i)).join('') +
      underRects.map(rectSvg).join('') +
      '</svg>'
    return sharp(scene)
      .composite([{ input: rasterize(under), left: 0, top: 0 }])
      .png({ compressionLevel: 0 })
      .toBuffer()
  }
  const measured = new Map<TextNode, number>()
  let under = await composeUnder()
  for (let attempt = 0; attempt < 6; attempt++) {
    let weak = false
    for (const plan of plans) {
      let worstC = Infinity
      for (const t of plan.texts) {
        const st = await regionStats(under, t.box, frame.W, frame.H)
        const worstL = plan.text === WHITE ? st.p95 : st.p5
        const c = contrastFromLuminance(luminance(plan.text), worstL)
        measured.set(t, c)
        worstC = Math.min(worstC, c)
      }
      if (worstC < MIN_CONTRAST + 0.5 && plan.alpha < MAX_SCRIM) {
        plan.alpha = Math.min(MAX_SCRIM, plan.alpha + 0.12)
        weak = true
      }
    }
    if (!weak) break
    under = await composeUnder()
  }

  // 4) Real product cut-out(s): exact mode = relight stage (light only) — product pixels never redrawn.
  let base: Buffer = under
  let placements: PlacedProduct[] = []
  let relit = false
  if (assets.product && productBoxes.length) {
    const layers = [assets.product, ...(exact ? assets.parts : [])].slice(0, productBoxes.length)
    const products = layers.map((p, i) => ({ cutout: p.png, box: productBoxes[i], role: (i ? 'part' : 'hero') as 'hero' | 'part' }))
    // Part 2: shading, white balance, the same grade, light wrap, shadows, reflection, grain.
    const comp = await compositeProducts({ base, products, light: input.light, surface: input.surface, harmonize, shadow: true, lightWrap: harmonize, ...(lightModel ? { lightModel, gradeBase: false } : {}) })
    base = comp.png
    placements = comp.placements
    if (exact && input.relight) {
      try {
        const out = await input.relight(base, placements, input.ratio)
        if (out) {
          base = await sharp(out).resize(frame.W, frame.H, { fit: 'fill' }).removeAlpha().png({ compressionLevel: 0 }).toBuffer()
          relit = true
        }
      } catch (error) {
        warnings.push(`relight skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  // 5) Logo (every family): background-free variant picked for what is under its slot — a
  //    family's solid panel / card / avatar when the logo sits on one, else the composite.
  let logoVariant: LogoVariantName | undefined
  if (assets.logo && logoBox) {
    const lb = logoBox
    const host = [...layout.nodes]
      .reverse()
      .find((n): n is RectNode => n.kind === 'rect' && n.layer === 'under' && !n.hole && (n.alpha ?? 1) >= 0.9 && inside(lb, n.box, 0))
    const bgL = host ? luminance(host.color) : (await regionStats(base, lb, frame.W, frame.H)).p50
    const choice = pickLogoVariant(assets.logo, bgL, parseColor(input.visual?.primaryColor))
    logoVariant = choice.variant
    const logoLayers: OverlayOptions[] = []
    if (choice.variant === 'badge' && choice.chip) {
      const pad = 14
      const chipBox = { x: lb.x - pad, y: lb.y - pad, w: lb.w + pad * 2, h: lb.h + pad * 2 }
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.W}" height="${frame.H}" viewBox="0 0 ${frame.W} ${frame.H}">${SHADOW_DEFS}` +
        rectSvg({ kind: 'rect', layer: 'under', box: chipBox, color: choice.chip, radius: 16, alpha: 0.95, shadow: 'soft' }) +
        '</svg>'
      logoLayers.push({ input: rasterize(svg), left: 0, top: 0 })
    }
    logoLayers.push({ input: await resizeLayer(choice.layer, lb.w, lb.h), left: lb.x, top: lb.y })
    base = await sharp(base).composite(logoLayers).png({ compressionLevel: 0 }).toBuffer()
  } else {
    logoBox = null
  }
  const productBox: Box | null = placements[0]?.box ?? null

  // 6) Pills (CTA / offer / labels) must stand out from the scene: swap the fill when it blends in.
  for (const n of layout.nodes) {
    if (n.kind !== 'rect' || n.layer !== 'over' || !n.pill || n.pill.role === 'bullet') continue
    const st = await regionStats(base, n.box, frame.W, frame.H)
    const dist = Math.hypot(n.color.r - st.mean.r, n.color.g - st.mean.g, n.color.b - st.mean.b)
    if (contrastRatio(n.color, st.mean) >= 1.45 || dist >= 110) continue
    const options = [palette.accent, palette.primary, WHITE, INK]
    const alt = options.reduce((best, c) => (contrastRatio(c, st.mean) > contrastRatio(best, st.mean) ? c : best), options[0])
    n.color = alt
    const ink = readableOn(alt)
    n.pill.text.fill = alt
    n.pill.text.color = ink
    for (const i of n.pill.icons) i.color = ink
    warnings.push(`${n.pill.role} fill adjusted for visibility`)
  }

  // 7) Over layer: shapes/icons (SVG) + text (satori paths, brand fonts), one resvg pass.
  const zoneOf = new Map<TextNode, ZonePlan>()
  for (const p of plans) for (const t of p.texts) zoneOf.set(t, p)
  const colorOf = (t: TextNode): Rgb => t.color ?? zoneOf.get(t)?.text ?? WHITE
  const shapes = layout.nodes
    .map((n) => (n.kind === 'rect' && n.layer === 'over' ? rectSvg(n) : n.kind === 'icon' ? iconSvg(n) : ''))
    .join('')
  const textSvg = await satori(textTree(texts, colorOf, frame) as unknown as Parameters<typeof satori>[0], {
    width: frame.W,
    height: frame.H,
    fonts: satoriFonts([fonts.heading.family, fonts.body.family]),
  })
  const open = textSvg.indexOf('>') + 1
  const overSvg = textSvg.slice(0, open) + SHADOW_DEFS + shapes + textSvg.slice(open)
  const png = await sharp(base)
    .composite([{ input: rasterize(overSvg), left: 0, top: 0 }])
    .png({ compressionLevel: 6 })
    .toBuffer()

  // 8) Report.
  const elements: LayoutTextElement[] = texts.map((t) => {
    const color = colorOf(t)
    const plan = zoneOf.get(t)
    const background: LayoutTextElement['background'] = t.fill
      ? { kind: 'fill', color: toHex(t.fill) }
      : { kind: 'scene', treatment: plan && plan.alpha > 0 ? (plan.zone.style === 'box' ? 'box' : 'gradient') : 'none', alpha: plan ? Math.round(plan.alpha * 100) / 100 : 0 }
    const contrast = t.fill ? contrastRatio(color, t.fill) : measured.get(t) ?? 0
    return {
      role: t.role,
      text: t.fitted.text,
      lines: [...t.fitted.lines],
      fontFamily: t.font.family,
      fontWeight: t.font.weight,
      fontSize: t.fitted.fontSize,
      lineHeight: t.fitted.lineHeightPx,
      box: { ...t.box },
      color: toHex(color),
      align: t.align,
      background,
      contrast: Math.round(contrast * 100) / 100,
      fits: t.fitted.fits,
    }
  })
  const fits = layoutFits(layout, frame) && elements.every((e) => e.contrast >= MIN_CONTRAST)
  if (!fits) warnings.push('layout does not fully fit at the minimum type scale')
  const layoutReport: LayoutReport = {
    format: input.format,
    ratio: input.ratio,
    width: frame.W,
    height: frame.H,
    safeArea: { ...frame.safe },
    elements,
    product: productBox,
    productBoxes: placements.map((p) => ({ ...p.box })),
    productAvoid: placed.avoidRegion,
    textOverProduct: !productBoxRespected,
    overlays: overlayBoxes(layout),
    logo: logoBox,
    ...(logoVariant ? { logoVariant } : {}),
    scale,
    layoutFamily: family,
    placement,
    productBox: placements.length ? union(placements.map((p) => p.box)) : avoidBox,
    productBoxRespected,
    fonts: {
      heading: `${fonts.heading.family} ${fonts.heading.weight}`,
      body: `${fonts.body.family} ${fonts.body.weight}/${fonts.body.boldWeight}`,
      resolution: { heading: assets.fonts.heading, body: assets.fonts.body },
    },
    fits,
    warnings,
  }
  return {
    png,
    width: frame.W,
    height: frame.H,
    layoutReport,
    basePng: input.debug?.returnBase ? base : undefined,
    ...(placements.length ? { productPlacements: placements } : {}),
    ...(harmonize && lightModel ? { harmonized: true, light: lightSummary(lightModel) } : {}),
    ...(relit ? { relit } : {}),
  }
}

/** Render one ad. */
export async function renderAd(input: RenderAdInput): Promise<RenderAdResult> {
  const assets = await loadAssets(input)
  return renderWithAssets(input, assets)
}

/** Render the same ad for several ratios (assets and brand fonts are loaded once). Defaults to 1:1, 4:5, 9:16. */
export async function renderAdAllRatios(
  input: Omit<RenderAdInput, 'ratio'>,
  ratios: AspectRatio[] = ALL_RATIOS,
): Promise<Array<RenderAdResult & { ratio: AspectRatio }>> {
  const assets = await loadAssets(input)
  const out: Array<RenderAdResult & { ratio: AspectRatio }> = []
  for (const ratio of ratios) out.push({ ratio, ...(await renderWithAssets({ ...input, ratio }, assets)) })
  return out
}
