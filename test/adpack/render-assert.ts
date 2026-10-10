/** Independent assertions for the renderer tests (no renderer internals reused). */
import sharp from 'sharp'
import { expect } from 'vitest'
import { RATIO_SIZE, type Box, type LayoutReport, type RenderAdResult } from '../../api/lib/adpack/render/index'
import type { AdFormat, AspectRatio } from '../../api/lib/adpack/types'
import { SAMPLE_COPY } from './render-fixtures'

// --- independent helpers (do not reuse renderer internals) -------------------

const lin = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
export const hexLum = (hex: string) => lum(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))
export const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** Contrast of `textHex` against the worst 5% of background pixels under `box` in `png`. */
export async function sampledContrast(png: Buffer, box: Box, textHex: string): Promise<number> {
  const { data, info } = await sharp(png)
    .extract({ left: Math.max(0, Math.floor(box.x)), top: Math.max(0, Math.floor(box.y)), width: Math.ceil(box.w), height: Math.ceil(box.h) })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const ls: number[] = []
  for (let i = 0; i < info.width * info.height; i++) ls.push(lum(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]))
  ls.sort((a, b) => a - b)
  const t = hexLum(textHex)
  const worst = t > 0.5 ? ls[Math.floor(ls.length * 0.95)] : ls[Math.floor(ls.length * 0.05)]
  return ratio(t, worst)
}

const within = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1

export const BULLETS_DRAWN: Record<AdFormat, number> = {
  offer_graphic: 4,
  before_after: 2,
  how_to_steps: 4,
  variant_card: 4,
  ugc_person: 0,
  handheld_overlay: 0,
  explainer: 4,
}

const dropSeparators = (s: string) => s.replace(/\s*·\s*/g, ' ').replace(/\s+/g, ' ').trim()

export function assertReport(report: LayoutReport, format: AdFormat, r: AspectRatio, copy = SAMPLE_COPY, language: 'es' | 'en' = 'es') {
  const { width, height } = RATIO_SIZE[r]
  expect(report.width).toBe(width)
  expect(report.height).toBe(height)
  expect(report.fits).toBe(true)
  const canvas = { x: 0, y: 0, w: width, h: height }
  const byRole = (role: string) => report.elements.filter((e) => e.role === role)

  // Exact strings, by construction.
  expect(byRole('headline').map((e) => e.text)).toEqual([copy.headline])
  if (copy.subline) expect(byRole('subline').map((e) => e.text)).toEqual([copy.subline])
  else expect(byRole('subline')).toHaveLength(0)
  expect(byRole('cta').map((e) => e.text)).toEqual(copy.cta ? [copy.cta] : [])
  // Round-1 P6: a price sticker may carry the shipping part in a ribbon (a second offer block).
  if (copy.offerLine) expect(byRole('offer').map((e) => e.text).join(' · ')).toBe(copy.offerLine)
  else expect(byRole('offer')).toHaveLength(0)
  expect(byRole('bullet').map((e) => e.text).sort()).toEqual(copy.bullets.slice(0, BULLETS_DRAWN[format]).sort())
  const labels = byRole('label').map((e) => e.text)
  if (format === 'before_after') expect(labels).toEqual(language === 'en' ? ['Before', 'After'] : ['Antes', 'Después'])
  else expect(labels).toEqual([])
  const steps = byRole('step_number').map((e) => e.text)
  expect(steps).toEqual(format === 'how_to_steps' ? copy.bullets.slice(0, 4).map((_, i) => String(i + 1)) : [])

  for (const e of report.elements) {
    expect(e.fits).toBe(true)
    // Lines are the exact text; an offer line may drop its " · " where a line breaks (round-1 P6).
    expect(dropSeparators(e.lines.join(' '))).toBe(dropSeparators(e.text))
    expect(within(e.box, canvas)).toBe(true)
    expect(within(e.box, report.safeArea)).toBe(true)
    expect(e.contrast).toBeGreaterThanOrEqual(4.5)
    expect(e.fontSize).toBeGreaterThanOrEqual(14)
  }
  // No two text blocks collide, and the product never covers text.
  const els = report.elements
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) expect(overlaps(els[i].box, els[j].box), `${els[i].role} vs ${els[j].role}`).toBe(false)
    if (report.product) expect(overlaps(els[i].box, report.product), `${els[i].role} vs product`).toBe(false)
  }
  if (r === '9:16') {
    // Meta Stories/Reels safe zones.
    for (const e of els) {
      expect(e.box.y).toBeGreaterThanOrEqual(Math.round(height * 0.14) - 1)
      expect(e.box.y + e.box.h).toBeLessThanOrEqual(height - Math.round(height * 0.2) + 1)
    }
  }
}

export async function assertPng(res: RenderAdResult, r: AspectRatio) {
  expect(res.png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  const meta = await sharp(res.png).metadata()
  expect(meta.format).toBe('png')
  expect(meta.width).toBe(RATIO_SIZE[r].width)
  expect(meta.height).toBe(RATIO_SIZE[r].height)
  expect(res.width).toBe(RATIO_SIZE[r].width)
  expect(res.height).toBe(RATIO_SIZE[r].height)
}

