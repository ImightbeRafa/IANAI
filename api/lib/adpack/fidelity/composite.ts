/**
 * Product fidelity — deterministic composite of a real-product cut-out onto a plate (A1).
 *
 *   plate ← cast shadow (alpha-derived, offset away from the light) ← contact shadow
 *         ← product (cut-out pixels, scaled to the box with its aspect kept)
 *
 * Harmonization is deliberately small so the product's shape and detail pixels stay
 * essentially identical: one global per-channel gain toward the plate's white balance,
 * capped at ±6% and luminance-neutral, plus a ≤ 2 px light wrap on the silhouette edge.
 * sharp only; same inputs → same bytes.
 */
import sharp, { type OverlayOptions } from 'sharp'
import type { Box } from '../render/types.js'
import type { LightDirection } from '../types.js'
import { erode } from './pixels.js'

/** Hard cap of the per-channel gain (spec: ≤ 6%; 4% keeps ΔE well under the fidelity threshold on tinted plates). */
export const HARMONIZE_MAX_GAIN = 0.04
/** How far toward the plate cast the product moves (0–1, before the cap). Small on purpose. */
export const HARMONIZE_STRENGTH = 0.3
export const LIGHT_WRAP_PX = 2

export interface PlacedProduct {
  box: Box
  /** Cut-out resized to box.w × box.h (RGBA PNG), before harmonization. Fidelity reference. */
  placed: Buffer
  role: 'hero' | 'part'
}

export interface CompositeOptions {
  /** Plate / base canvas (any format sharp reads). */
  base: Buffer
  products: Array<{ cutout: Buffer; box: Box; role?: 'hero' | 'part' }>
  light?: LightDirection
  harmonize?: boolean
  shadow?: boolean
  lightWrap?: boolean
}

export interface CompositeResult {
  png: Buffer
  placements: PlacedProduct[]
  /** Per-channel gains applied (1 = none). */
  gains: [number, number, number]
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

async function mean(buf: Buffer, region: Box, W: number, H: number): Promise<[number, number, number]> {
  const left = Math.max(0, Math.floor(region.x))
  const top = Math.max(0, Math.floor(region.y))
  const width = Math.max(1, Math.min(W - left, Math.ceil(region.w)))
  const height = Math.max(1, Math.min(H - top, Math.ceil(region.h)))
  // stats() reads the input image, not the pipeline: materialize the crop first.
  const crop = await sharp(buf).extract({ left, top, width, height }).removeAlpha().png().toBuffer()
  const st = await sharp(crop).stats()
  return [st.channels[0].mean, st.channels[1].mean, st.channels[2].mean]
}

/** Gains that move the product a little toward the plate's color cast; luminance-neutral, capped. */
export function harmonizeGains(plateMean: [number, number, number], strength = HARMONIZE_STRENGTH): [number, number, number] {
  const avg = (plateMean[0] + plateMean[1] + plateMean[2]) / 3 || 1
  const raw = plateMean.map((c) => Math.pow(Math.max(1, c) / avg, strength)) as [number, number, number]
  const lum = 0.299 * raw[0] + 0.587 * raw[1] + 0.114 * raw[2]
  return raw.map((g) => {
    const n = g / lum
    return Math.max(1 - HARMONIZE_MAX_GAIN, Math.min(1 + HARMONIZE_MAX_GAIN, n))
  }) as [number, number, number]
}

async function shadowLayers(placed: Buffer, box: Box, light: LightDirection, W: number, H: number): Promise<OverlayOptions[]> {
  const { data: alpha, info } = await sharp(placed).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  // Footprint: x-extent of the opaque pixels in the lowest 6% of the object.
  let yBottom = -1
  for (let y = h - 1; y >= 0 && yBottom < 0; y--) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 128) { yBottom = y; break }
  if (yBottom < 0) return []
  const band = Math.max(2, Math.round(h * 0.06))
  let fx0 = w
  let fx1 = -1
  for (let y = Math.max(0, yBottom - band); y <= yBottom; y++) {
    for (let x = 0; x < w; x++) if (alpha[y * w + x] > 128) { if (x < fx0) fx0 = x; if (x > fx1) fx1 = x }
  }
  const layers: OverlayOptions[] = []
  // 1) Cast shadow: the silhouette, blurred and offset away from the light.
  const blur = Math.max(4, Math.round(Math.min(w, h) * 0.04))
  const pad = Math.ceil(blur * 3)
  const dx = light === 'left' ? Math.round(w * 0.05) : light === 'right' ? -Math.round(w * 0.05) : 0
  const dy = Math.round(h * 0.025)
  const castAlpha = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#000000' })
    .blur(blur)
    .linear(0.22, 0)
    .extractChannel(0)
    .raw()
    .toBuffer()
  const cast = await sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 3, background: '#000000' } })
    .joinChannel(castAlpha, { raw: { width: w + pad * 2, height: h + pad * 2, channels: 1 } })
    .png()
    .toBuffer()
  layers.push({ input: cast, left: box.x - pad + dx, top: box.y - pad + dy })
  // 2) Contact shadow: a soft dark ellipse under the footprint.
  const fw = Math.max(8, fx1 - fx0 + 1)
  const ew = Math.round(fw * 1.08)
  const eh = Math.max(6, Math.round(Math.max(h * 0.05, fw * 0.08)))
  const eBlur = Math.max(3, Math.round(eh * 0.45))
  const ePad = eBlur * 3
  const cx = box.x + fx0 + fw / 2 + dx * 0.4
  const cy = box.y + yBottom + 1
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ew + ePad * 2}" height="${eh + ePad * 2}">` +
    `<ellipse cx="${ew / 2 + ePad}" cy="${eh / 2 + ePad}" rx="${ew / 2}" ry="${eh / 2}" fill="#000" fill-opacity="0.5"/></svg>`
  const contact = await sharp(Buffer.from(svg)).blur(eBlur).png().toBuffer()
  layers.push({ input: contact, left: Math.round(cx - ew / 2 - ePad), top: Math.round(cy - eh / 2 - ePad) })
  // Clip to canvas: sharp rejects overlays that extend past the base → crop each one.
  return Promise.all(layers.map((l) => clipOverlay(l, W, H))).then((ls) => ls.filter((l): l is OverlayOptions => Boolean(l)))
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

/** Gains + ≤ 2 px light wrap on the silhouette edge; interior pixels only see the global gain. */
async function harmonizeProduct(placed: Buffer, plateUnder: Buffer, gains: [number, number, number], wrap: boolean): Promise<Buffer> {
  const { data, info } = await sharp(placed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const out = Buffer.from(data)
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = Math.max(0, Math.min(255, Math.round(data[i * 4] * gains[0])))
    out[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(data[i * 4 + 1] * gains[1])))
    out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(data[i * 4 + 2] * gains[2])))
  }
  if (wrap) {
    const solid = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] >= 128 ? 1 : 0
    const inner = erode(solid, w, h, LIGHT_WRAP_PX)
    const under = await sharp(plateUnder).resize(w, h, { fit: 'fill' }).removeAlpha().toColourspace('srgb').blur(6).raw().toBuffer()
    // Distance-ish weight: 1 px from the edge → 0.22, 2 px → 0.11.
    const inner1 = erode(solid, w, h, 1)
    for (let i = 0; i < w * h; i++) {
      if (!solid[i] || inner[i]) continue
      const k = inner1[i] ? 0.11 : 0.22
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(out[i * 4 + c] * (1 - k) + under[i * 3 + c] * k)
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

/** Composite real-product cut-outs onto a base canvas. */
export async function compositeProducts(opts: CompositeOptions): Promise<CompositeResult> {
  const meta = await sharp(opts.base).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  const light = opts.light ?? 'left'
  const base = await sharp(opts.base).removeAlpha().png({ compressionLevel: 0 }).toBuffer()
  const placements: PlacedProduct[] = []
  const shadowOverlays: OverlayOptions[] = []
  const productOverlays: OverlayOptions[] = []
  let gains: [number, number, number] = [1, 1, 1]
  if (opts.harmonize !== false && opts.products.length) {
    const b = opts.products[0].box
    const around = { x: b.x - b.w * 0.3, y: b.y - b.h * 0.15, w: b.w * 1.6, h: b.h * 1.3 }
    gains = harmonizeGains(await mean(base, around, W, H))
  }
  for (const p of opts.products) {
    const box = { x: Math.round(p.box.x), y: Math.round(p.box.y), w: Math.max(1, Math.round(p.box.w)), h: Math.max(1, Math.round(p.box.h)) }
    const placed = await sharp(p.cutout).ensureAlpha().resize(box.w, box.h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
    placements.push({ box, placed, role: p.role ?? (placements.length ? 'part' : 'hero') })
    if (opts.shadow !== false) shadowOverlays.push(...(await shadowLayers(placed, box, light, W, H)))
    let final: Buffer = placed
    if (opts.harmonize !== false) {
      const ux = Math.max(0, box.x)
      const uy = Math.max(0, box.y)
      const uw = Math.max(1, Math.min(W - ux, box.w))
      const uh = Math.max(1, Math.min(H - uy, box.h))
      const under = await sharp(base).extract({ left: ux, top: uy, width: uw, height: uh }).png().toBuffer()
      final = await harmonizeProduct(placed, under, gains, opts.lightWrap !== false)
    }
    const clipped = await clipOverlay({ input: final, left: box.x, top: box.y }, W, H)
    if (clipped) productOverlays.push(clipped)
  }
  const png = await sharp(base)
    .composite([...shadowOverlays, ...productOverlays])
    .png({ compressionLevel: 0 })
    .toBuffer()
  return { png, placements, gains }
}
