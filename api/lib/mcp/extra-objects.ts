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
import { locateProduct, projectReferenceBox } from './feature-match.js'

export type ExtraObjectsFinding = {
  suspected: boolean
  /** Hue clusters in the image that no reference / palette / logo explains. */
  count: number
  /** Clusters explained by the `allowedProps` the caller listed. */
  budget: number
  clusters: Array<{ hue: string; share: number; /** Where those pixels sit (fractions of the picture) — the layout keeps the CTA / text off it. */ box?: NormalizedProductBox }>
  /** Soft light regions ignored as lighting (a window's sun glow), not props. */
  ignoredGlows?: string[]
  note: string
}

export type NormalizedProductBox = { x0: number; y0: number; x1: number; y1: number }

const W = 160
const BINS = 24
const LCLASS = 3
/** lightness class of a Lab L: 0 dark, 1 mid, 2 light — a bright blue cable is not the same "colour" as a navy wall. */
const lClass = (L: number) => (L < 34 ? 0 : L < 64 ? 1 : 2)
/** Saturation floor of a colour that can be an object. A scene-only picture (no drawn text / logo) can use the sensitive floor; a picture where the model also drew text keeps the strict one (printed text / badges are saturated too). */
const MIN_CHROMA = { scene: 22, strict: 36 } as const
// Lab hue angle (a = red→green axis, b = yellow→blue axis), 15° bins starting at +a.
const HUE_NAMES = ['red-pink', 'red', 'red', 'red-orange', 'orange', 'orange-yellow', 'yellow', 'yellow', 'yellow-green', 'green', 'green', 'green', 'teal-green', 'teal', 'cyan', 'cyan-blue', 'blue', 'blue', 'blue', 'blue', 'violet', 'magenta', 'pink', 'red-pink']

function hueBin(a: number, b: number): number {
  const deg = (Math.atan2(b, a) * 180) / Math.PI
  return Math.floor((((deg % 360) + 360) % 360) / (360 / BINS)) % BINS
}

type Shares = { shares: Float64Array; chroma: Float64Array; total: number; /** Share of the pixels of each bin that sit within 3 px of a HARD edge (a glow is soft: ≈ 0). */ edgy: Float64Array; boxes: Array<{ x0: number; y0: number; x1: number; y1: number } | null> }

async function hueShares(bytes: Buffer, minChroma: number, skip?: (x: number, y: number, w: number, h: number) => boolean): Promise<Shares> {
  const { data, info } = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).removeAlpha().resize({ width: W }).raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const lab = labImage(data, 3, w * h)
  const counts = new Float64Array(BINS * LCLASS)
  const chromaSum = new Float64Array(BINS * LCLASS)
  const edgyCount = new Float64Array(BINS * LCLASS)
  const boxes: Shares['boxes'] = Array.from({ length: BINS * LCLASS }, () => null)
  // hard-edge map: |dL| over 2 px > 8, dilated by 3 px
  const hard = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    if (Math.abs(lab[(i + 1) * 3] - lab[(i - 1) * 3]) + Math.abs(lab[(i + w) * 3] - lab[(i - w) * 3]) > 8) hard[i] = 1
  }
  const near = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hard[y * w + x]) continue
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) near[yy * w + xx] = 1 }
  }
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (skip?.(x, y, w, h)) continue
      total++
      const i = y * w + x
      const L = lab[i * 3]
      const a = lab[i * 3 + 1]
      const b = lab[i * 3 + 2]
      if (L < 12 || L > 94 || Math.hypot(a, b) < minChroma) continue
      const k = hueBin(a, b) * LCLASS + lClass(L)
      counts[k]++
      chromaSum[k] += Math.hypot(a, b)
      if (near[i]) edgyCount[k]++
      const bx = boxes[k]
      if (!bx) boxes[k] = { x0: x / w, y0: y / h, x1: (x + 1) / w, y1: (y + 1) / h }
      else { bx.x0 = Math.min(bx.x0, x / w); bx.y0 = Math.min(bx.y0, y / h); bx.x1 = Math.max(bx.x1, (x + 1) / w); bx.y1 = Math.max(bx.y1, (y + 1) / h) }
    }
  }
  return { shares: counts.map((c) => (total ? c / total : 0)), chroma: chromaSum.map((c, i) => (counts[i] ? c / counts[i] : 0)), total, edgy: edgyCount.map((c, i) => (counts[i] ? c / counts[i] : 0)), boxes }
}

export async function checkExtraObjects(input: {
  generated: Buffer
  /** Reference photos (product, accessories, kit, logo) as bytes. */
  references: Buffer[]
  /** Located product box (fractions of the image), excluded from the scan. */
  productBox?: NormalizedProductBox | null
  /** Props the caller explicitly allowed. */
  allowedCount: number
  /** 'scene' = the picture has no model-drawn text / logo (composite flow): sensitive. 'strict' (default) = the model also drew text, whose colours must not read as props. */
  mode?: 'scene' | 'strict'
}): Promise<ExtraObjectsFinding> {
  const floor = MIN_CHROMA[input.mode ?? 'strict']
  const known = new Set<number>()
  const key = (bin: number, lc: number) => ((bin + BINS) % BINS) * LCLASS + lc
  const addKnown = (idx: number) => {
    const bin = Math.floor(idx / LCLASS)
    const lc = idx % LCLASS
    for (const d of [-1, 0, 1]) known.add(key(bin + d, lc))
  }
  for (const ref of input.references.slice(0, 5)) {
    try {
      const { shares } = await hueShares(ref, floor)
      shares.forEach((s2, idx) => { if (s2 >= 0.003) addKnown(idx) })
    } catch { /* an unreadable reference just explains nothing */ }
  }
  // The brand palette explains hues too, but only the SMALL ones it names that a wall/table does not already cover;
  // palette colours are therefore not treated as "known" (a navy brand wall would otherwise hide a blue cable).
  const box = input.productBox
  const { shares, chroma, edgy, boxes } = await hueShares(input.generated, floor, (x, y, w, h) => {
    const fy = y / h
    if (fy < 0.12 || fy > 0.88) return true // header / footer
    return Boolean(box && x / w >= box.x0 - 0.12 && x / w <= box.x1 + 0.12 && fy >= box.y0 - 0.12 && fy <= box.y1 + 0.12)
  })
  // The surface (wall / table) is judged on the WHOLE picture (less the header / footer), not only outside the product box.
  const whole = await hueShares(input.generated, floor, (_x, y, _w, h) => y / h < 0.12 || y / h > 0.88)
  const clusters: ExtraObjectsFinding['clusters'] = []
  const glows: string[] = []
  // A hue FAMILY (the bin and its neighbours, any lightness) that covers > 10 % of the picture — in the scanned area or in the whole picture — is a surface
  // (wall / table / floor). Its highlights and shadows (other lightness classes) are shading, not objects; only a colour clearly MORE saturated than the
  // surface of its family (a bright blue cable on a navy wall: ~1.5x) can still be an object.
  const family = (sh: Float64Array, ch: Float64Array, bin: number) => {
    let share = 0
    let chroma = 0
    for (const d of [-1, 0, 1]) for (let lc = 0; lc < LCLASS; lc++) { const k = key(bin + d, lc); share += sh[k]; chroma += sh[k] * ch[k] }
    return { share, chroma: share ? chroma / share : 0 }
  }
  for (let idx = 0; idx < BINS * LCLASS; idx++) {
    const share = shares[idx] || 0
    if (known.has(idx) || share < 0.004) continue
    const bin = Math.floor(idx / LCLASS)
    const fr = family(shares, chroma, bin)
    const fw = family(whole.shares, whole.chroma, bin)
    const surfaceShare = Math.max(fr.share, fw.share)
    const surfaceChroma = fw.share >= fr.share ? fw.chroma : fr.chroma
    if (surfaceShare > 0.1 && chroma[idx] < surfaceChroma * 1.3) continue
    // Lighting, not a prop: a LIGHT region whose pixels are almost never near a hard edge is a soft glow (window sun, lamp halo, bloom).
    // …or a LIGHT region in the upper half that runs into the left / right frame edge: the window / lamp light of the set (a prop sits on the table, lower down).
    const bb = boxes[idx]
    // (also a small plant / lit curtain hugging a side edge in the upper half: set dressing, never a loose prop; a long thin cable spans the picture so its box is large and does not qualify)
    const edgeSet = Boolean(bb && (bb.y0 + bb.y1) / 2 <= 0.45 && (bb.x1 - bb.x0) * (bb.y1 - bb.y0) <= 0.12 && (bb.x0 < 0.03 || bb.x1 > 0.97))
    const edgeLight = Boolean(bb && idx % LCLASS === 2 && (bb.y0 + bb.y1) / 2 <= 0.42 && (bb.x0 < 0.03 || bb.x1 > 0.97)) || edgeSet
    if ((idx % LCLASS === 2 && edgy[idx] < 0.12) || edgeLight) { glows.push(`${HUE_NAMES[bin]} (${Math.round(share * 1000) / 10}%)`); continue }
    clusters.push({ hue: HUE_NAMES[bin], share: Math.round(share * 1000) / 10, ...(boxes[idx] ? { box: boxes[idx]! } : {}) })
  }
  // merge neighbouring bins that name the same colour (and lightness classes of the same hue)
  const byHue = new Map<string, { share: number; box?: NormalizedProductBox }>()
  for (const c of clusters) {
    const cur = byHue.get(c.hue)
    const box = cur?.box && c.box ? { x0: Math.min(cur.box.x0, c.box.x0), y0: Math.min(cur.box.y0, c.box.y0), x1: Math.max(cur.box.x1, c.box.x1), y1: Math.max(cur.box.y1, c.box.y1) } : cur?.box ?? c.box
    byHue.set(c.hue, { share: Math.round(((cur?.share ?? 0) + c.share) * 10) / 10, ...(box ? { box } : {}) })
  }
  const merged = [...byHue.entries()].map(([hue, v]) => ({ hue, share: v.share, ...(v.box ? { box: v.box } : {}) }))
  const budget = input.allowedCount
  const suspected = merged.length > budget
  return {
    suspected,
    count: merged.length,
    budget,
    clusters: merged,
    ...(glows.length ? { ignoredGlows: glows } : {}),
    note: suspected
      ? `colour(s) ${merged.map((c) => `${c.hue} (${c.share}%)`).join(', ')} appear next to the product but in no reference photo, logo or brand palette: a prop may have been invented (heuristic; grey/white objects are not detected)`
      : 'no unexplained colours next to the product (heuristic)',
  }
}

export type UnlistedObject = { label: string; inliers: number; box: NormalizedProductBox }

/** Words (≥ 4 letters, accents stripped) of a prop name / photo label. */
const words = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4)

/** true when a photo label names one of the allowed props (shared word of ≥ 4 letters). */
export function labelMatchesAllowed(label: string, allowed: string[]): boolean {
  const a = new Set(allowed.flatMap(words))
  return words(label).some((w) => a.has(w))
}

/**
 * Real offer photos (box, contents …) whose object is NOT listed in `allowedProps` and that nevertheless show up in the generated
 * scene (feature match of the photo against the picture, free and local). Warning only: "the TOPGT box is in the scene but the
 * allowed list does not name it".
 */
export async function findUnlistedObjects(input: { generated: Buffer; objects: Array<{ label: string; bytes: Buffer }>; minInliers?: number }): Promise<UnlistedObject[]> {
  const out: UnlistedObject[] = []
  for (const o of input.objects.slice(0, 4)) {
    try {
      const found = await locateProduct(o.bytes, input.generated)
      if (!found.located || found.located.inliers < (input.minInliers ?? 18)) continue
      out.push({ label: o.label, inliers: found.located.inliers, box: projectReferenceBox(found.ref, found.gen, found.located.transform) })
    } catch { /* heuristic only */ }
  }
  return out
}
