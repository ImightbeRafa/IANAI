/**
 * renderAd: scene (bytes/URL) + copy + brand visual → finished ad PNG.
 *
 *   scene (sharp cover-fit)
 *   + under layer (scrims, cards, dividers; SVG → resvg)
 *   + product cut-out (+ soft shadow) and logo (sharp composite)
 *   = base → contrast is measured here per text box, scrims are strengthened until ≥ 4.5:1
 *   + over layer (pills/icons as SVG + text via satori → resvg)
 *   = final PNG
 *
 * All on-image text comes from `copy`, so it is exact by construction.
 */
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import sharp, { type OverlayOptions } from 'sharp'
import type { AdFormat, AspectRatio } from '../types.js'
import { blend, contrastFromLuminance, contrastRatio, INK, luminance, parseColor, readableOn, toHex, WHITE, type Rgb } from './color.js'
import { composeFamily, FAMILY_SPECS, type LayoutFamily } from './families.js'
import { ensureBrandFonts, type FontResolution } from './font-resolver.js'
import { cssFamily, satoriFonts } from './fonts.js'
import { ALL_RATIOS, inside, makeFrame, overlaps, union, type Frame } from './frame.js'
import {
  decodeLayer,
  dropShadow,
  fitInside,
  loadImageBytes,
  opaqueMeanColor,
  prepareScene,
  regionStats,
  resizeLayer,
  trimTransparent,
  type PreparedLayer,
} from './image.js'
import { makePalette, type Ctx, type IconNode, type NormalizedCopy, type RectNode, type TemplateLayout, type TextNode, type Zone } from './layout.js'
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

interface Assets {
  scene: ImageInput
  /** Scene size after EXIF orientation (for mapping the normalized product box). */
  sceneSize: { width: number; height: number } | null
  product: PreparedLayer | null
  logo: PreparedLayer | null
  logoColor: Rgb | null
  fonts: FontResolution
  warnings: string[]
}

async function loadAssets(input: Omit<RenderAdInput, 'ratio'>): Promise<Assets> {
  const warnings: string[] = []
  let product: PreparedLayer | null = null
  if (input.productCutout) {
    if (!CUTOUT_FORMATS.includes(input.format)) {
      warnings.push(`productCutout ignored for ${input.format} (scene carries the product)`)
    } else {
      const layer = await decodeLayer(input.productCutout)
      if (layer) product = await trimTransparent(layer)
      else warnings.push('productCutout could not be decoded; skipped')
    }
  }
  let logo: PreparedLayer | null = null
  let logoColor: Rgb | null = null
  const logoSrc = input.logo ?? input.visual?.logoUrl
  if (logoSrc) {
    const layer = await decodeLayer(logoSrc)
    if (layer) {
      logo = await trimTransparent(layer)
      logoColor = await opaqueMeanColor(logo.png)
    } else {
      warnings.push('logo could not be loaded/decoded; skipped')
    }
  }
  // Decode the scene bytes once (re-used for every ratio).
  const scene = await loadImageBytes(input.sceneImage)
  let sceneSize: Assets['sceneSize'] = null
  if (input.productBox) {
    try {
      const meta = await sharp(scene).metadata()
      if (meta.width && meta.height) sceneSize = (meta.orientation ?? 1) >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height }
    } catch {
      warnings.push('productBox ignored: scene size unreadable')
    }
  }
  const fonts = await ensureBrandFonts(input.visual, input.fonts)
  for (const role of ['heading', 'body'] as const) {
    const r = fonts[role]
    if (r.note) warnings.push(`${role} font "${r.requested ?? ''}": ${r.note}; using ${r.family}`)
  }
  return { scene, sceneSize, product, logo, logoColor, fonts, warnings }
}

/** Normalized scene box → canvas px through the same centered cover-fit as prepareScene. */
export function mapSceneBox(nb: NormalizedBox, scene: { width: number; height: number }, W: number, H: number): Box | null {
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
  if (x1 - x0 < 2 || y1 - y0 < 2) return null
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

/** Nodes that must stay off the product: text, cards, panels, pills (decor and scrims are fine). */
function collisionArea(layout: TemplateLayout, avoid: Box[]): number {
  let area = 0
  for (const n of layout.nodes) {
    if (n.kind === 'rect' && n.decor) continue
    if (n.kind === 'icon') continue
    for (const a of avoid) {
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

async function renderWithAssets(input: RenderAdInput, assets: Assets): Promise<RenderAdResult> {
  const frame = makeFrame(input.ratio)
  const fonts = assets.fonts.fonts
  const palette = makePalette(parseColor(input.visual?.primaryColor), parseColor(input.visual?.secondaryColor), parseColor(input.visual?.accentColor))
  const copy = normalizeCopy(input.copy)
  const warnings = [...assets.warnings]
  if (!copy.headline) warnings.push('empty headline')
  const scene = await prepareScene(assets.scene, frame.W, frame.H)
  if (!TEMPLATES[input.format]) throw new Error(`unknown ad format: ${input.format}`)
  const family: LayoutFamily = input.layoutFamily && FAMILY_SPECS[input.layoutFamily] ? input.layoutFamily : 'bold_pill'
  const avoidBox = input.productBox && assets.sceneSize ? mapSceneBox(input.productBox, assets.sceneSize, frame.W, frame.H) : null
  const avoid = avoidBox ? [avoidBox] : []

  // 1) Layout: per placement variant, progressive type scale until everything fits; the first
  //    placement whose copy stays off the product box wins. With a product box, the family is
  //    also laid out inside each free region around it (left / right / above / below).
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
  let layout: TemplateLayout | null = null
  let scale = SCALES[0]
  let placement = candidates[0].placement
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
        product: assets.product ? { width: assets.product.width, height: assets.product.height } : undefined,
        logo: assets.logo ? { width: assets.logo.width, height: assets.logo.height } : undefined,
        format: input.format,
        placement: cand.base,
        avoid,
        ...(cand.region ? { region: { full: frame.safe } } : {}),
      }
      candidate = composeFamily(family, ctx)
      candScale = s
      if (layoutFits(candidate, f)) break
    }
    if (!candidate) continue
    const fits = layoutFits(candidate, f) && layoutFits(candidate, frame)
    const collision = avoid.length ? collisionArea(candidate, avoid) : 0
    const better =
      !best ||
      (fits && !best.fits) ||
      (fits === best.fits && collision < best.collision)
    if (better) best = { layout: candidate, scale: candScale, placement: cand.placement, fits, collision }
    if (fits && collision === 0) break
  }
  if (!best) throw new Error('layout failed')
  layout = best.layout
  scale = best.scale
  placement = best.placement
  const productBoxRespected = best.collision === 0
  if (!productBoxRespected) warnings.push('copy overlaps the product box in every placement of this family (least-overlapping placement used)')
  warnings.push(...layout.warnings)
  const texts = textNodes(layout)

  // 2) Product + logo layers.
  const layers: OverlayOptions[] = []
  let productBox: Box | null = null
  if (assets.product && layout.productBox && layout.productBox.w > 20 && layout.productBox.h > 20) {
    productBox = fitInside(assets.product, layout.productBox, layout.productValign)
    const png = await resizeLayer(assets.product, productBox.w, productBox.h)
    const shadow = await dropShadow(png, productBox.w, productBox.h, Math.max(6, Math.round(productBox.w * 0.025)), 0.32)
    if (shadow) layers.push({ input: shadow.png, left: productBox.x - shadow.pad, top: productBox.y - shadow.pad + Math.round(productBox.h * 0.02) })
    layers.push({ input: png, left: productBox.x, top: productBox.y })
  }
  let logoBox: Box | null = null
  const underExtra: RectNode[] = []
  if (assets.logo && layout.logoBox) {
    logoBox = layout.logoBox
    const png = await resizeLayer(assets.logo, logoBox.w, logoBox.h)
    // Put the logo on a small plate when it would not read on the scene.
    if (assets.logoColor) {
      const lb = logoBox
      // A logo sitting on a family's solid panel/card is judged against that fill, not the photo.
      const host = [...layout.nodes]
        .reverse()
        .find((n): n is RectNode => n.kind === 'rect' && n.layer === 'under' && !n.hole && (n.alpha ?? 1) >= 0.9 && inside(lb, n.box, 0))
      const bgL = host ? luminance(host.color) : (await regionStats(scene, logoBox, frame.W, frame.H)).p50
      if (contrastFromLuminance(luminance(assets.logoColor), bgL) < 3) {
        const plate = readableOn(assets.logoColor)
        const pad = 14
        underExtra.push({ kind: 'rect', layer: 'under', box: { x: logoBox.x - pad, y: logoBox.y - pad, w: logoBox.w + pad * 2, h: logoBox.h + pad * 2 }, color: plate, radius: 16, alpha: 0.92, shadow: 'soft' })
      }
    }
    layers.push({ input: png, left: logoBox.x, top: logoBox.y })
  }

  // 3) Scrim planning, then measure on the real composite and strengthen until ≥ 4.5:1.
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
  const underRects = [...layout.nodes.filter((n): n is RectNode => n.kind === 'rect' && n.layer === 'under'), ...underExtra]
  const composeBase = async () => {
    const under =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.W}" height="${frame.H}" viewBox="0 0 ${frame.W} ${frame.H}">${SHADOW_DEFS}` +
      plans.map((p, i) => zoneSvg(p, frame, i)).join('') +
      underRects.map(rectSvg).join('') +
      '</svg>'
    return sharp(scene)
      .composite([{ input: rasterize(under), left: 0, top: 0 }, ...layers])
      .png({ compressionLevel: 0 })
      .toBuffer()
  }
  const measured = new Map<TextNode, number>()
  let base = await composeBase()
  for (let attempt = 0; attempt < 6; attempt++) {
    let weak = false
    for (const plan of plans) {
      let worstC = Infinity
      for (const t of plan.texts) {
        const st = await regionStats(base, t.box, frame.W, frame.H)
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
    base = await composeBase()
  }

  // 4) Pills (CTA / offer / labels) must stand out from the scene: swap the fill when it blends in.
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

  // 5) Over layer: shapes/icons (SVG) + text (satori paths), one resvg pass.
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

  // 6) Report.
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
    logo: logoBox,
    scale,
    layoutFamily: family,
    placement,
    productBox: avoidBox,
    productBoxRespected,
    fonts: {
      heading: `${fonts.heading.family} ${fonts.heading.weight}`,
      body: `${fonts.body.family} ${fonts.body.weight}/${fonts.body.boldWeight}`,
      resolution: { heading: assets.fonts.heading, body: assets.fonts.body },
    },
    fits,
    warnings,
  }
  return { png, width: frame.W, height: frame.H, layoutReport, basePng: input.debug?.returnBase ? base : undefined }
}

/** Render one ad. */
export async function renderAd(input: RenderAdInput): Promise<RenderAdResult> {
  const assets = await loadAssets(input)
  return renderWithAssets(input, assets)
}

/** Render the same ad for several ratios (assets are decoded once). Defaults to 1:1, 4:5, 9:16. */
export async function renderAdAllRatios(
  input: Omit<RenderAdInput, 'ratio'>,
  ratios: AspectRatio[] = ALL_RATIOS,
): Promise<Array<RenderAdResult & { ratio: AspectRatio }>> {
  const assets = await loadAssets(input)
  const out: Array<RenderAdResult & { ratio: AspectRatio }> = []
  for (const ratio of ratios) out.push({ ratio, ...(await renderWithAssets({ ...input, ratio }, assets)) })
  return out
}

