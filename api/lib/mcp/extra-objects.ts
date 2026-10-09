/**
 * Free, local, warning-only "objects that are not in the references" heuristic.
 *
 * Grok sometimes adds props (a blue USB cable, a coloured box, a gamepad) that no reference photo contains. Without a detector
 * model the most reliable local signal is COLOUR NOVELTY: a saturated hue that covers a small-but-visible share of the
 * scene (≥ 0.5 %; a hue covering > 10 % is the wall / table / the scene itself) and appears in none of the reference photos, the brand
 * palette or the logo. Grey / white / black props (screwdriver, propellers) are invisible to this check — it is a flag to
 * look, never proof, and it only ever raises a warning (never blocks, retries or changes charges).
 */
import sharp from 'sharp'
import { labImage } from '../adpack/fidelity/pixels.js'

export type ExtraObjectsFinding = {
  suspected: boolean
  /** Hue clusters in the image that no reference / palette / logo explains. */
  count: number
  /** Clusters explained by the `allowedProps` the caller listed. */
  budget: number
  clusters: Array<{ hue: string; share: number }>
  note: string
}

export type NormalizedProductBox = { x0: number; y0: number; x1: number; y1: number }

const W = 160
const BINS = 24
const MIN_CHROMA = 36
// Lab hue angle (a = red→green axis, b = yellow→blue axis), 15° bins starting at +a.
const HUE_NAMES = ['red-pink', 'red', 'red', 'red-orange', 'orange', 'orange-yellow', 'yellow', 'yellow', 'yellow-green', 'green', 'green', 'green', 'teal-green', 'teal', 'cyan', 'cyan-blue', 'blue', 'blue', 'blue', 'blue', 'violet', 'magenta', 'pink', 'red-pink']

function hueBin(a: number, b: number): number {
  const deg = (Math.atan2(b, a) * 180) / Math.PI
  return Math.floor((((deg % 360) + 360) % 360) / (360 / BINS)) % BINS
}

async function hueShares(bytes: Buffer, skip?: (x: number, y: number, w: number, h: number) => boolean): Promise<{ shares: Float64Array; total: number }> {
  const { data, info } = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).removeAlpha().resize({ width: W }).raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const lab = labImage(data, 3, w * h)
  const counts = new Float64Array(BINS)
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (skip?.(x, y, w, h)) continue
      total++
      const i = y * w + x
      const L = lab[i * 3]
      const a = lab[i * 3 + 1]
      const b = lab[i * 3 + 2]
      if (L < 12 || L > 94 || Math.hypot(a, b) < MIN_CHROMA) continue
      counts[hueBin(a, b)]++
    }
  }
  return { shares: counts.map((c) => (total ? c / total : 0)), total }
}

export async function checkExtraObjects(input: {
  generated: Buffer
  /** Reference photos (product, accessories, kit, logo) as bytes. */
  references: Buffer[]
  /** Located product box (fractions of the image), excluded from the scan. */
  productBox?: NormalizedProductBox | null
  /** Props the caller explicitly allowed. */
  allowedCount: number
}): Promise<ExtraObjectsFinding> {
  const known = new Set<number>()
  const addKnown = (bin: number) => { for (const d of [-1, 0, 1]) known.add((bin + d + BINS) % BINS) }
  for (const ref of input.references.slice(0, 5)) {
    try {
      const { shares } = await hueShares(ref)
      shares.forEach((s, bin) => { if (s >= 0.003) addKnown(bin) })
    } catch { /* an unreadable reference just explains nothing */ }
  }
  // The brand palette explains hues too, but only the SMALL ones it names that a wall/table does not already cover;
  // palette colours are therefore not treated as "known" (a navy brand wall would otherwise hide a blue cable).
  const box = input.productBox
  const { shares } = await hueShares(input.generated, (x, y, w, h) => {
    const fy = y / h
    if (fy < 0.12 || fy > 0.88) return true // header / footer: logo, headline, CTA
    return Boolean(box && x / w >= box.x0 - 0.12 && x / w <= box.x1 + 0.12 && fy >= box.y0 - 0.12 && fy <= box.y1 + 0.12)
  })
  const clusters: ExtraObjectsFinding['clusters'] = []
  // Hues next to a dominant one (> 10 % = the wall / table / surface) are that surface's own shading, not an object.
  const dominant = new Set<number>()
  shares.forEach((s2, bin) => { if (s2 > 0.1) for (const d of [-1, 0, 1]) dominant.add((bin + d + BINS) % BINS) })
  for (let bin = 0; bin < BINS; bin++) {
    const share = shares[bin] || 0
    if (known.has(bin) || dominant.has(bin) || share < 0.005) continue
    clusters.push({ hue: HUE_NAMES[bin], share: Math.round(share * 1000) / 10 })
  }
  // merge neighbouring bins that name the same colour
  const merged = clusters.filter((c, i) => i === 0 || c.hue !== clusters[i - 1].hue)
  const budget = input.allowedCount
  const suspected = merged.length > budget
  return {
    suspected,
    count: merged.length,
    budget,
    clusters: merged,
    note: suspected
      ? `colour(s) ${merged.map((c) => `${c.hue} (${c.share}%)`).join(', ')} appear next to the product but in no reference photo, logo or brand palette: a prop may have been invented (heuristic; grey/white objects are not detected)`
      : 'no unexplained colours next to the product (heuristic)',
  }
}
