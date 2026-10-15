/**
 * Product fidelity — composite of real-product cut-outs onto a plate (A1), with the
 * deterministic relight stage (harmonize.ts) included by default in exact mode:
 *
 *   plate → light model (estimateLight) → shared grade on the plate
 *         ← reflection (glossy) ← cast shadow ← contact shadow + ground AO   (applyGroundEffects)
 *         ← product: defocus/grain match, partial white balance, directional shading + AO,
 *           same grade, light wrap, edge AA                                   (harmonizeLayer)
 *
 * Only light changes: the product's shape and detail pixels are never redrawn (every change is a
 * bounded smooth gain, a ≤ 4 % per-channel white balance, the shared grade, ≤ 3 px of edge light
 * and grain). `harmonize: false` = plain cut-out + ground shadows (legacy / generated mode).
 * sharp only; same inputs → same bytes.
 */
import sharp, { type OverlayOptions } from 'sharp'
import type { Box } from '../render/types.js'
import type { LightDirection, PlateSurface } from '../types.js'
import { matteLayer } from './matte.js'
import { applyGroundEffects, estimateLight, gradeFor, gradeRaw, harmonizeLayer, whiteBalanceGains, HARMONIZE_LIMITS, type Grade, type HarmonizeReport, type LightModel } from './harmonize.js'

/** Per-channel white-balance cap (owner rule: light may change, identity color may not). */
export const HARMONIZE_MAX_GAIN = HARMONIZE_LIMITS.wbMaxGain

export interface PlacedProduct {
  box: Box
  /** Cut-out resized to box.w × box.h (RGBA PNG), before harmonization. Fidelity reference. */
  placed: Buffer
  role: 'hero' | 'part'
  /** The (graded) plate under the box before shadows / product (RGB PNG, box size): fidelity background. */
  background?: Buffer
}

export interface CompositeOptions {
  /** Plate / base canvas (any format sharp reads). */
  base: Buffer
  products: Array<{ cutout: Buffer; box: Box; role?: 'hero' | 'part' }>
  light?: LightDirection
  surface?: PlateSurface
  /** Full deterministic relight stage (default true). False = plain cut-out + ground shadows. */
  harmonize?: boolean
  /** Ground shadows (contact + cast + AO). Default true. */
  shadow?: boolean
  lightWrap?: boolean
  /** Precomputed light model (the renderer estimates it on the clean plate). */
  lightModel?: LightModel
  /** Clean plate for the light estimate (default: base). */
  plate?: Buffer
  /** Apply the shared grade to the base too (default true; the renderer grades the plate itself, before panels). */
  gradeBase?: boolean
  /** Overhead plate + flat lay (P1 #6): drop shadow under every piece, no cast shadow / reflection. */
  topDown?: boolean
  /** Round 1b: feather + decontaminate the cut-out edge (default true). */
  matte?: boolean
}

export interface CompositeResult {
  png: Buffer
  placements: PlacedProduct[]
  /** Per-channel white-balance gains applied to the product (1 = none). */
  gains: [number, number, number]
  /** Light model used (null without one). */
  lightModel: LightModel | null
  grade: Grade | null
  harmonized: boolean
  reports: HarmonizeReport[]
}

/** Fit `size` inside `box` keeping aspect (never stretched). */
export function fitBox(size: { width: number; height: number }, box: Box, valign: 'center' | 'bottom' = 'bottom'): Box {
  const s = Math.min(box.w / size.width, box.h / size.height)
  const w = Math.max(1, Math.round(size.width * s))
  const h = Math.max(1, Math.round(size.height * s))
  const x = Math.round(box.x + (box.w - w) / 2)
  const y = Math.round(valign === 'bottom' ? box.y + box.h - h : box.y + (box.h - h) / 2)
  return { x, y, w, h }
}

/**
 * Hero + real parts inside one product box (offer_graphic / explainer, H3): the hero takes the
 * upper ~72%, parts sit in a row underneath. Only real cut-outs are placed — nothing is synthesized.
 */
export function layoutProductGroup(box: Box, hero: { width: number; height: number }, parts: Array<{ width: number; height: number }>, valign: 'center' | 'bottom' = 'bottom'): Box[] {
  if (!parts.length) return [fitBox(hero, box, valign)]
  const list = parts.slice(0, 3)
  const gap = Math.round(Math.min(box.w, box.h) * 0.04)
  const heroH = Math.round(box.h * 0.74)
  const rowY = box.y + heroH + gap
  const rowH = Math.max(1, box.y + box.h - rowY)
  // Parts read as accessories next to the hero: each cell ≤ 55% of the box width, row centered.
  const cellW = Math.min(Math.floor((box.w - gap * (list.length - 1)) / list.length), Math.round(box.w * 0.55))
  const rowW = cellW * list.length + gap * (list.length - 1)
  const rowX = box.x + Math.round((box.w - rowW) / 2)
  const heroBox = fitBox(hero, { x: box.x, y: box.y, w: box.w, h: heroH }, 'bottom')
  const partBoxes = list.map((p, i) => fitBox(p, { x: rowX + i * (cellW + gap), y: rowY, w: cellW, h: rowH }, 'bottom'))
  return [heroBox, ...partBoxes]
}

/** Crop an overlay so it lies fully inside a W×H canvas (sharp requires it). */
export async function clipOverlay(layer: OverlayOptions, W: number, H: number): Promise<OverlayOptions | null> {
  const input = layer.input as Buffer
  const meta = await sharp(input).metadata()
  const lw = meta.width ?? 0
  const lh = meta.height ?? 0
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const x0 = Math.max(0, left)
  const y0 = Math.max(0, top)
  const x1 = Math.min(W, left + lw)
  const y1 = Math.min(H, top + lh)
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  if (x0 === left && y0 === top && x1 - x0 === lw && y1 - y0 === lh) return layer
  const cropped = await sharp(input).extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 }).png().toBuffer()
  return { ...layer, input: cropped, left: x0, top: y0 }
}

/** Union of boxes. */
export function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Box-size RGB crop of a raw RGB canvas (out-of-canvas pixels repeat the nearest edge). */
function cropRaw(raw: Buffer, W: number, H: number, box: Box): Buffer {
  const out = Buffer.alloc(box.w * box.h * 3)
  for (let y = 0; y < box.h; y++) {
    const sy = Math.min(H - 1, Math.max(0, box.y + y))
    for (let x = 0; x < box.w; x++) {
      const sx = Math.min(W - 1, Math.max(0, box.x + x))
      const o = (sy * W + sx) * 3
      const d = (y * box.w + x) * 3
      out[d] = raw[o]
      out[d + 1] = raw[o + 1]
      out[d + 2] = raw[o + 2]
    }
  }
  return out
}

/** Composite real-product cut-outs onto a base canvas (exact mode: with the relight stage). */
export async function compositeProducts(opts: CompositeOptions): Promise<CompositeResult> {
  const { data: raw, info } = await sharp(opts.base).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const harmonize = opts.harmonize !== false
  const boxes = opts.products.map((p) => ({ x: Math.round(p.box.x), y: Math.round(p.box.y), w: Math.max(1, Math.round(p.box.w)), h: Math.max(1, Math.round(p.box.h)) }))
  let model: LightModel | null = opts.lightModel ?? null
  if (!model && boxes.length && (harmonize || opts.shadow !== false)) {
    model = await estimateLight(opts.plate ?? opts.base, unionBox(boxes), { light: opts.light ?? 'left', surface: opts.surface })
  }
  const grade = harmonize && model ? gradeFor(model) : null
  if (grade && opts.gradeBase !== false) gradeRaw(raw, 3, grade)

  const placements: PlacedProduct[] = []
  const layers: Array<{ placed: Buffer; rgba: Buffer; box: Box; background: Buffer }> = []
  for (let k = 0; k < opts.products.length; k++) {
    const box = boxes[k]
    const placed = await sharp(opts.products[k].cutout).ensureAlpha().resize(box.w, box.h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
    const rgba = await sharp(placed).ensureAlpha().raw().toBuffer()
    const background = cropRaw(raw, W, H, box)
    const bgPng = await sharp(background, { raw: { width: box.w, height: box.h, channels: 3 } }).png().toBuffer()
    placements.push({ box, placed, role: opts.products[k].role ?? (placements.length ? 'part' : 'hero'), background: bgPng })
    // Round 1b (B): feathered 1–2 px edge + colour decontamination on what is drawn (the fidelity
    // reference above stays the plain resized cut-out; interior pixels are identical).
    const matted = opts.matte === false ? placed : await matteLayer(placed)
    layers.push({ placed: matted, rgba, box, background })
  }

  // Ground effects go on the plate before the products (they sit under them).
  if (model && layers.length) {
    applyGroundEffects(
      raw,
      W,
      H,
      layers.map((l) => ({ rgba: l.rgba, w: l.box.w, h: l.box.h, box: { x: l.box.x, y: l.box.y } })),
      model,
      { shadow: opts.shadow !== false, reflection: harmonize && !opts.topDown, topDown: opts.topDown === true },
    )
  }

  const overlays: OverlayOptions[] = []
  const reports: HarmonizeReport[] = []
  for (let k = 0; k < layers.length; k++) {
    const l = layers[k]
    let final: Buffer = l.placed
    if (harmonize && model) {
      const res = await harmonizeLayer({ placed: l.placed, background: l.background, model, grade, seed: k * 7919 + l.box.x * 31 + l.box.y, lightWrap: opts.lightWrap !== false })
      final = res.png
      reports.push(res.report)
    }
    const clipped = await clipOverlay({ input: final, left: l.box.x, top: l.box.y }, W, H)
    if (clipped) overlays.push(clipped)
  }
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .composite(overlays)
    .png({ compressionLevel: 0 })
    .toBuffer()
  return {
    png,
    placements,
    gains: harmonize && model ? whiteBalanceGains(model) : [1, 1, 1],
    lightModel: model,
    grade,
    harmonized: Boolean(harmonize && model),
    reports,
  }
}
