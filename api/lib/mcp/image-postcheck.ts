/**
 * MCP image post-check (warning only — never blocks, never refunds, never retries).
 *
 * The web flow redraws the product under the PRODUCT LOCK contract with no verification.
 * For the MCP path we add a free, local, model-free comparison between the generated image and
 * the reference product photo, reusing the pixel primitives of the ad-pack fidelity code
 * (Lab conversion, background flood, connected components):
 *   1. segment the reference product (uniform-backdrop flood; skipped if the backdrop is not uniform),
 *   2. find it in the generated image (multi-scale colour template match, lighting tolerant),
 *   3. compare mean colour (ΔE, gain-corrected), silhouette IoU and part count at that location.
 * Anything off produces `fidelity_warning` with a reason and a 0–1 score so the caller can discard it.
 *
 * Plus a cheap safety-net `qa` block: exact-ratio check, a text-presence heuristic when copy was
 * requested, and whether the brand logo reference was attached. Heuristics, not OCR.
 */
import sharp from 'sharp'
import { components, deltaE3, erode, labImage } from '../adpack/fidelity/pixels.js'
import { floodBackground } from '../adpack/fidelity/segment.js'
import { GEN_WIDTH as FEATURE_GEN_WIDTH, compareLocatedRegion, locateProduct, projectReferenceBox } from './feature-match.js'
import { safeZoneMargins } from './safe-zones.js'

export { safeZoneMargins }

export const POSTCHECK_THRESHOLD = {
  /** Gain-corrected mean ΔE76 of the product colour. */
  colourDeltaE: 16,
  /** Silhouette IoU at the matched location. */
  silhouetteIoU: 0.45,
  /** Part-count difference that counts as "a part appeared/disappeared". */
  partDiff: 1,
  /** Overall score below this warns. */
  score: 0.55,
} as const

const REF_SIDE = 160
const GEN_WIDTH = 200
const MIN_PART_SHARE = 0.03
const SCALES = [0.1, 0.13, 0.17, 0.22, 0.28, 0.35, 0.43, 0.52, 0.62, 0.74, 0.88]

export type FidelityWarning = {
  code: 'fidelity_warning'
  /** Human-readable reason(s). */
  reason: string
  /** 0 (different product) – 1 (same product). */
  score: number
  details: {
    method: 'features' | 'colour' | 'palette'
    referenceIndex: number
    /** true = the product was located by feature match, so the structural comparison is trusted. */
    confident: boolean
    inliers?: number
    /** Share (0–1) of the product's textured regions that still match the reference. */
    preserved?: number
    cells?: number
    scale?: number
    colourDeltaE?: number
    /** Fallback (angle differs / dark product): distinctive colour parts of the product found in the image. */
    parts?: { clusters: number; presence: number; missing: string[] }
    /** Located product box as fractions of the generated image (feature match only). */
    productBox?: { x0: number; y0: number; x1: number; y1: number }
  }
  /** Possible invented objects next to the product (heuristic, low confidence). */
  props?: PropsFinding
}

type LegacyColourDetails = { colourDeltaE: number; silhouetteIoU: number; refParts: number; genParts: number; scale: number; referenceIndex: number }

export type FidelityCheckResult =
  | { status: 'ok'; score: number; details: FidelityWarning['details'] }
  | { status: 'warning'; score: number; warning: FidelityWarning }
  /** Product not locatable (dark / low-texture / heavily changed): colour only, no shape verdict, no score. */
  | { status: 'unverified'; reason: string; details: FidelityWarning['details'] }
  | { status: 'skipped'; reason: string }

export type PropsFinding = { suspected: boolean; count: number; note: string }

type RefTemplate = {
  w: number
  h: number
  rgb: Buffer
  mask: Uint8Array
  palette: Array<[number, number, number]>
  parts: number
}

function dataUrlBytes(value: string): Buffer | null {
  const m = value.match(/^data:[^;]+;base64,(.+)$/)
  return m ? Buffer.from(m[1], 'base64') : null
}

function paletteOf(lab: Float32Array, mask: Uint8Array, n: number): Array<[number, number, number]> {
  const bins = new Map<number, { c: number; L: number; a: number; b: number }>()
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    const key = (Math.floor(lab[i * 3] / 14) * 64 + Math.floor((lab[i * 3 + 1] + 128) / 14)) * 64 + Math.floor((lab[i * 3 + 2] + 128) / 14)
    const e = bins.get(key) || { c: 0, L: 0, a: 0, b: 0 }
    e.c++
    e.L += lab[i * 3]
    e.a += lab[i * 3 + 1]
    e.b += lab[i * 3 + 2]
    bins.set(key, e)
  }
  return [...bins.values()]
    .sort((x, y) => y.c - x.c)
    .slice(0, 4)
    .map((e) => [e.L / e.c, e.a / e.c, e.b / e.c] as [number, number, number])
}

/** Per-pixel palette class (1-based) for pixels close (gain-corrected on L) to a palette entry, else 0. */
function likeMask(lab: Float32Array, n: number, palette: Array<[number, number, number]>, gain: number, tol = 20): Uint8Array {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3] - gain
    let bestD = tol
    for (let k = 0; k < palette.length; k++) {
      const p = palette[k]
      const dl = (L - p[0]) * 0.6
      const da = lab[i * 3 + 1] - p[1]
      const db = lab[i * 3 + 2] - p[2]
      const d = Math.sqrt(dl * dl + da * da + db * db)
      if (d <= bestD) {
        bestD = d
        out[i] = k + 1
      }
    }
  }
  return out
}

/** Parts = connected regions of each palette colour class (so touching red body + blue cap = 2). */
function countParts(classes: Uint8Array, w: number, h: number): number {
  let total = 0
  for (let i = 0; i < classes.length; i++) if (classes[i]) total++
  if (!total) return 0
  let parts = 0
  const maxClass = classes.reduce((m, v) => (v > m ? v : m), 0)
  for (let k = 1; k <= maxClass; k++) {
    const m = new Uint8Array(classes.length)
    for (let i = 0; i < classes.length; i++) m[i] = classes[i] === k ? 1 : 0
    const { list } = components(erode(m, w, h, 1), w, h)
    parts += list.filter((c) => c.area / total >= MIN_PART_SHARE).length
  }
  return parts
}

async function buildTemplate(photo: Buffer): Promise<RefTemplate | string> {
  const { data, info } = await sharp(photo).rotate().flatten({ background: '#ffffff' }).resize(REF_SIDE, REF_SIDE, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  const lab = labImage(data, 3, n)
  const flood = floodBackground(lab, info.width, info.height)
  if (typeof flood === 'string') return flood
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) mask[i] = flood.bg[i] ? 0 : 1
  const { list } = components(mask, info.width, info.height)
  if (!list.length) return 'no product found in the reference photo'
  const share = list.reduce((s, c) => s + c.area, 0) / n
  if (share < 0.04 || share > 0.92) return `reference product coverage ${Math.round(share * 100)}% is not measurable`
  // Crop to the product bounding box.
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1
  for (const c of list) {
    if (c.area / n < 0.001) continue
    x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1)
  }
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w < 8 || h < 8) return 'reference product too small'
  const rgb = Buffer.alloc(w * h * 3)
  const cm = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y + y0) * info.width + (x + x0)
      const d = y * w + x
      rgb[d * 3] = data[s * 3]; rgb[d * 3 + 1] = data[s * 3 + 1]; rgb[d * 3 + 2] = data[s * 3 + 2]
      cm[d] = mask[s]
    }
  }
  const clab = labImage(rgb, 3, w * h)
  const palette = paletteOf(clab, cm, w * h)
  const parts = countParts(likeMask(clab, w * h, palette, 0), w, h)
  return { w, h, rgb, mask: cm, palette, parts }
}

type Match = { dist: number; x: number; y: number; w: number; h: number; scale: number; gain: number }

function matchTemplate(genLab: Float32Array, gw: number, gh: number, resizedFor: (tw: number) => { w: number; h: number; lab: Float32Array; idx: Int32Array } | null): Match | null {
  let best: Match | null = null
  for (const s of SCALES) {
    const tw = Math.round(gw * s)
    const r = resizedFor(tw)
    if (!r || r.h >= gh || r.w >= gw || r.idx.length < 30) continue
    const step = Math.max(2, Math.round(r.w / 14))
    const pix = r.idx.length > 700 ? Math.ceil(r.idx.length / 700) : 1
    for (let oy = 0; oy + r.h <= gh; oy += step) {
      for (let ox = 0; ox + r.w <= gw; ox += step) {
        // lighting tolerant: remove the mean L offset, compare chroma + residual L.
        let sumDL = 0
        let cnt = 0
        for (let k = 0; k < r.idx.length; k += pix) {
          const t = r.idx[k]
          const tx = t % r.w
          const ty = (t - tx) / r.w
          const g = (oy + ty) * gw + (ox + tx)
          sumDL += genLab[g * 3] - r.lab[t * 3]
          cnt++
        }
        const gain = sumDL / cnt
        let acc = 0
        for (let k = 0; k < r.idx.length; k += pix) {
          const t = r.idx[k]
          const tx = t % r.w
          const ty = (t - tx) / r.w
          const g = (oy + ty) * gw + (ox + tx)
          const dl = (genLab[g * 3] - r.lab[t * 3] - gain) * 0.6
          const da = genLab[g * 3 + 1] - r.lab[t * 3 + 1]
          const db = genLab[g * 3 + 2] - r.lab[t * 3 + 2]
          acc += Math.sqrt(dl * dl + da * da + db * db)
        }
        const dist = acc / cnt
        if (!best || dist < best.dist) best = { dist, x: ox, y: oy, w: r.w, h: r.h, scale: s, gain }
      }
    }
  }
  return best
}


async function compareOne(tpl: RefTemplate, generated: Buffer, referenceIndex: number): Promise<{ score: number; details: LegacyColourDetails }> {
  const gen = await sharp(generated).rotate().flatten({ background: '#ffffff' }).resize({ width: GEN_WIDTH }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const gw = gen.info.width
  const gh = gen.info.height
  const genLab = labImage(gen.data, 3, gw * gh)
  const maskPng = await sharp(Buffer.from(tpl.mask.map((v) => (v ? 255 : 0))), { raw: { width: tpl.w, height: tpl.h, channels: 1 } }).png().toBuffer()
  const rgbPng = await sharp(tpl.rgb, { raw: { width: tpl.w, height: tpl.h, channels: 3 } }).png().toBuffer()
  const scaled = new Map<number, { w: number; h: number; lab: Float32Array; idx: Int32Array; rgb: Buffer; mask: Uint8Array } | null>()
  const sizes = SCALES.map((s) => Math.round(gw * s))
  for (const tw of sizes) {
    const th = Math.max(4, Math.round((tw * tpl.h) / tpl.w))
    const r = await sharp(rgbPng).resize(tw, th, { fit: 'fill' }).raw().toBuffer()
    const m = await sharp(maskPng).resize(tw, th, { fit: 'fill' }).raw().toBuffer()
    const lab = labImage(r, 3, tw * th)
    const idxList: number[] = []
    const mask = new Uint8Array(tw * th)
    for (let i = 0; i < tw * th; i++) if (m[i] > 127) { idxList.push(i); mask[i] = 1 }
    scaled.set(tw, { w: tw, h: th, lab, idx: Int32Array.from(idxList), rgb: r, mask })
  }
  const match = matchTemplate(genLab, gw, gh, (tw) => scaled.get(tw) || null)
  if (!match) return { score: 0, details: { colourDeltaE: 99, silhouetteIoU: 0, refParts: tpl.parts, genParts: 0, scale: 0, referenceIndex } }
  const sc = scaled.get(Math.round(gw * match.scale))!
  // Mean colour ΔE (gain-corrected) over the template mask.
  let m1: [number, number, number] = [0, 0, 0]
  let m2: [number, number, number] = [0, 0, 0]
  for (const t of sc.idx) {
    const tx = t % sc.w
    const ty = (t - tx) / sc.w
    const g = (match.y + ty) * gw + (match.x + tx)
    for (let c = 0; c < 3; c++) { m1[c] += sc.lab[t * 3 + c]; m2[c] += genLab[g * 3 + c] }
  }
  m1 = m1.map((v) => v / sc.idx.length) as [number, number, number]
  m2 = m2.map((v) => v / sc.idx.length) as [number, number, number]
  m2[0] -= match.gain
  const colourDeltaE = deltaE3(m1, m2)
  // Window analysis: palette-like pixels in the matched window, padded so product-coloured area that
  // spills outside the reference silhouette (a wider/taller product) counts against the shape.
  const pad = Math.round(Math.max(sc.w, sc.h) * 0.35)
  const px0 = Math.max(0, match.x - pad)
  const py0 = Math.max(0, match.y - pad)
  const px1 = Math.min(gw, match.x + sc.w + pad)
  const py1 = Math.min(gh, match.y + sc.h + pad)
  const pw = px1 - px0
  const ph = py1 - py0
  const win = new Float32Array(pw * ph * 3)
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const g = (py0 + y) * gw + (px0 + x)
    const d = y * pw + x
    win[d * 3] = genLab[g * 3]; win[d * 3 + 1] = genLab[g * 3 + 1]; win[d * 3 + 2] = genLab[g * 3 + 2]
  }
  const like = likeMask(win, pw * ph, tpl.palette, match.gain)
  const tplPadded = new Uint8Array(pw * ph)
  for (let y = 0; y < sc.h; y++) for (let x = 0; x < sc.w; x++) {
    if (sc.mask[y * sc.w + x]) tplPadded[(match.y - py0 + y) * pw + (match.x - px0 + x)] = 1
  }
  let inter = 0
  let uni = 0
  for (let i = 0; i < like.length; i++) {
    if (like[i] && tplPadded[i]) inter++
    if (like[i] || tplPadded[i]) uni++
  }
  const silhouetteIoU = uni ? inter / uni : 0
  const genParts = countParts(like, pw, ph)
  // Reference parts measured on the same scaled window with the same function.
  const refLike = likeMask(sc.lab, sc.w * sc.h, tpl.palette, 0)
  const refParts = countParts(refLike, sc.w, sc.h)
  const colourScore = Math.max(0, 1 - colourDeltaE / (POSTCHECK_THRESHOLD.colourDeltaE * 2))
  const iouScore = Math.min(1, silhouetteIoU / 0.8)
  const partScore = Math.abs(genParts - refParts) >= POSTCHECK_THRESHOLD.partDiff ? 0.3 : 1
  const score = Math.round((0.4 * colourScore + 0.4 * iouScore + 0.2 * partScore) * 100) / 100
  return {
    score,
    details: {
      colourDeltaE: Math.round(colourDeltaE * 10) / 10,
      silhouetteIoU: Math.round(silhouetteIoU * 100) / 100,
      refParts,
      genParts,
      scale: match.scale,
      referenceIndex,
    },
  }
}


/**
 * Fallback when the product cannot be located by feature match (dark / low-texture product, or a different camera angle):
 * view-invariant PART PRESENCE. The reference product's distinctive (chromatic) colour clusters — e.g. a yellow battery strip,
 * a red wire, a green cap — must all still exist in the generated image, and the dark/neutral palette must not have vanished.
 * It can prove a part disappeared (warning) but cannot prove the shape is intact, so it never claims more than that.
 */
export type PaletteFallback = { informative: boolean; clusters: number; missing: string[]; presence: number }

function hueName(a: number, b: number): string {
  const ang = (Math.atan2(b, a) * 180) / Math.PI
  const names: Array<[number, string]> = [[0, 'red/pink'], [40, 'orange/brown'], [85, 'yellow'], [135, 'green'], [185, 'teal/cyan'], [235, 'blue'], [290, 'violet'], [340, 'red/pink']]
  const a360 = (ang + 360) % 360
  let best = names[0][1]
  let bd = 999
  for (const [h, n] of names) { const d = Math.min(Math.abs(a360 - h), 360 - Math.abs(a360 - h)); if (d < bd) { bd = d; best = n } }
  return best
}

async function paletteFallback(tpl: RefTemplate, generated: Buffer): Promise<PaletteFallback> {
  const lab = labImage(tpl.rgb, 3, tpl.w * tpl.h)
  // Distinctive colours = chromatic pixels (chroma ≥ 28) grouped in 45° hue sectors; a sector counts from 0.3 % of the product.
  const sectors = new Map<number, { c: number; L: number; a: number; b: number }>()
  let total = 0
  for (let i = 0; i < tpl.w * tpl.h; i++) {
    if (!tpl.mask[i]) continue
    total++
    const a = lab[i * 3 + 1]
    const b = lab[i * 3 + 2]
    if (Math.hypot(a, b) < 28) continue
    const key = Math.floor(((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 / 45)
    const e = sectors.get(key) || { c: 0, L: 0, a: 0, b: 0 }
    e.c++; e.L += lab[i * 3]; e.a += a; e.b += b
    sectors.set(key, e)
  }
  const chromatic = [...sectors.values()]
    .filter((e) => e.c / Math.max(1, total) >= 0.003 && e.c >= 5)
    .sort((x, y) => y.c - x.c)
    .slice(0, 5)
    .map((e) => ({ share: e.c / total, L: e.L / e.c, a: e.a / e.c, b: e.b / e.c }))
  if (!chromatic.length) return { informative: false, clusters: 0, missing: [], presence: 1 }
  const gen = await sharp(generated).rotate().flatten({ background: '#ffffff' }).resize({ width: 320 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = gen.info.width * gen.info.height
  const glab = labImage(gen.data, 3, n)
  const missing: string[] = []
  let present = 0
  for (const c of chromatic) {
    let hits = 0
    for (let i = 0; i < n; i++) {
      const d = Math.hypot((glab[i * 3] - c.L) * 0.5, glab[i * 3 + 1] - c.a, glab[i * 3 + 2] - c.b)
      if (d <= 15) hits++
    }
    // a visible part of that colour: at least ~0.03 % of the picture (≈ 40 px at 320 px wide)
    if (hits / n >= 0.0003) present++
    else missing.push(hueName(c.a, c.b))
  }
  return { informative: true, clusters: chromatic.length, missing, presence: Math.round((present / chromatic.length) * 100) / 100 }
}

/** Minimum RANSAC inliers to trust the feature location (below this the product is "not located"). */
export const MIN_LOCATED_INLIERS = 15
/** Warn when less than this share of the product's textured regions still matches the reference. */
export const PRESERVED_MIN = 0.8
/** A comparison over fewer textured cells than this is not trusted. */
export const MIN_COMPARED_CELLS = 40

/**
 * Compare a generated image with the product reference photo(s). Warning only; the best-located
 * reference decides (a kit with several photos is fine if the image matches one of them).
 *
 *  - Located by feature match (strong, ≥15 inliers): masked structural comparison of the product
 *    region → warns when the product's own details (folds, gear, parts) no longer correlate.
 *  - Not located (dark / low-texture / heavily redrawn products): only the colour check can run, and
 *    the result is `unverified` — never a shape verdict, never a false "ok".
 */
export async function checkGeneratedProductFidelity(input: {
  referenceDataUrls: string[]
  generatedDataUrl: string
}): Promise<FidelityCheckResult> {
  try {
    const generated = dataUrlBytes(input.generatedDataUrl)
    if (!generated) return { status: 'skipped', reason: 'generated image is not inline' }
    const refs = input.referenceDataUrls.slice(0, 3)
    let best: { index: number; inliers: number; preserved: number; cells: number; scale: number; genH: number; bbox: { x0: number; y0: number; x1: number; y1: number } } | null = null
    let colour: { score: number; details: LegacyColourDetails } | null = null
    const skips: string[] = []
    for (let i = 0; i < refs.length; i++) {
      const bytes = dataUrlBytes(refs[i])
      if (!bytes) { skips.push('reference not inline'); continue }
      try {
        const found = await locateProduct(bytes, generated)
        if (found.located && found.located.inliers >= MIN_LOCATED_INLIERS) {
          const cmp = compareLocatedRegion(found.ref, found.gen, found.refKps, found.located.transform)
          if (cmp && cmp.cells >= MIN_COMPARED_CELLS && (!best || found.located.inliers > best.inliers)) {
            best = { index: i, inliers: found.located.inliers, preserved: cmp.preserved, cells: cmp.cells, scale: found.located.scale, genH: found.gen.h, bbox: cmp.bbox }
          }
        }
      } catch (err) {
        skips.push(`feature match unavailable: ${err instanceof Error ? err.message : 'error'}`)
      }
      if (i === 0 || !colour) {
        const tpl = await buildTemplate(bytes)
        if (typeof tpl === 'string') skips.push(tpl)
        else {
          const res = await compareOne(tpl, generated, i)
          if (!colour || res.score > colour.score) colour = res
        }
      }
    }
    let fallback: PaletteFallback | null = null
    if (!best) {
      for (let i = 0; i < refs.length && !fallback?.informative; i++) {
        const bytes = dataUrlBytes(refs[i])
        if (!bytes) continue
        try {
          const tpl = await buildTemplate(bytes)
          if (typeof tpl !== 'string') fallback = await paletteFallback(tpl, generated)
        } catch { /* fallback is best-effort */ }
      }
    }
    const colourDeltaE = colour?.details.colourDeltaE
    const colourBad = typeof colourDeltaE === 'number' && colourDeltaE > POSTCHECK_THRESHOLD.colourDeltaE
    const reasons: string[] = []
    if (best && best.preserved < PRESERVED_MIN) {
      reasons.push(`the product's shapes, parts or printed details differ from the reference photo (only ${Math.round(best.preserved * 100)}% of its textured regions match at the located position, < ${Math.round(PRESERVED_MIN * 100)}%): it may have been redrawn`)
    }
    if (colourBad) reasons.push(`product colour differs from the reference (ΔE ${colourDeltaE} > ${POSTCHECK_THRESHOLD.colourDeltaE})`)
    if (fallback?.informative && fallback.missing.length) {
      reasons.push(`distinctive parts of the product are missing from the image (${fallback.missing.join(', ')} not found; the shape could not be located, so only part colours were compared)`)
    }
    const details: FidelityWarning['details'] = {
      method: best ? 'features' : fallback?.informative ? 'palette' : 'colour',
      referenceIndex: best ? best.index : (colour?.details.referenceIndex ?? 0),
      confident: Boolean(best),
      ...(best ? { inliers: best.inliers, preserved: Math.round(best.preserved * 100) / 100, cells: best.cells, scale: Math.round(best.scale * 100) / 100, productBox: { x0: Math.max(0, best.bbox.x0 / FEATURE_GEN_WIDTH), y0: Math.max(0, best.bbox.y0 / best.genH), x1: Math.min(1, best.bbox.x1 / FEATURE_GEN_WIDTH), y1: Math.min(1, best.bbox.y1 / best.genH) } } : {}),
      ...(typeof colourDeltaE === 'number' ? { colourDeltaE } : {}),
      ...(fallback?.informative ? { parts: { clusters: fallback.clusters, presence: fallback.presence, missing: fallback.missing } } : {}),
    }
    const colourScore = colour ? Math.max(0, 1 - (colour.details.colourDeltaE) / (POSTCHECK_THRESHOLD.colourDeltaE * 2)) : 1
    const score = Math.round((best ? Math.min(best.preserved, colourScore) : fallback?.informative ? Math.min(colourScore, fallback.presence) : colourScore) * 100) / 100
    if (reasons.length) {
      return { status: 'warning', score, warning: { code: 'fidelity_warning', reason: reasons.join('; '), score, details } }
    }
    if (best) return { status: 'ok', score, details }
    // Fallback verdict: every distinctive part colour is still there (the angle differs, so the shape itself is not compared).
    if (fallback?.informative) return { status: 'ok', score, details }
    if (colour) {
      return { status: 'unverified', reason: 'product not located by feature match (dark, low-texture or heavily changed): only colour was compared, shape/details not verified — check it by eye', details }
    }
    return { status: 'skipped', reason: skips[0] || 'no product reference to compare' }
  } catch (err) {
    return { status: 'skipped', reason: `fidelity check unavailable: ${err instanceof Error ? err.message : 'error'}` }
  }
}

// ---------------------------------------------------------------------------
// Safety-net QA (heuristic, warning only)
// ---------------------------------------------------------------------------

export type SafeZoneIssue = { edge: 'top' | 'bottom' | 'left' | 'right'; kind: 'block_touches_edge' | 'text_in_unsafe_band'; detail: string; /** Text-like edge density inside the band (how deep the violation is); 1 for a block touching the edge. */ amount?: number }

export type McpImageQa = {
  ratioOk: boolean
  textPresent: 'yes' | 'no' | 'not_requested'
  logo: 'attached' | 'none' | 'not_requested'
  /** 'ok' = no UI block/text in the Instagram UI margins; 'violation' = see safeZoneIssues. */
  safeZones: 'ok' | 'violation' | 'not_checked'
  safeZoneIssues: SafeZoneIssue[]
  /** Copy lines that start or end with a separator (orphan "·"), as received. */
  separatorLines: Array<{ line: number; text: string; where: 'start' | 'end' }>
  /** Separator fixes applied to the copy before drawing it (e.g. a long "a · b" line split at the "·"). */
  copyNormalised: string[]
  /** Button-like flat blocks (rounded rectangles) detected; the copy asks for exactly ONE CTA. */
  ctaButtons: number
  /** true when 2+ button-like blocks were found: an invented second CTA is likely (heuristic; a text-only CTA is not detectable). */
  extraCtaRisk: boolean
  /** 'pass' | 'fail' — fail = a retryable defect (safe zones, orphan separators, missing text, extra CTA risk). */
  status: 'pass' | 'fail'
  /** Weighted defect score used to keep the better image after an auto-retry (0 = clean). */
  severity: number
  /** true when the brand kit has no usable logo asset: nothing was drawn in its place (never a text chip). */
  logoUnavailable?: boolean
  /** true when the code-composited CTA button could not find a calm spot in the bottom band (see compositeLayers.cta.busy). */
  ctaBusy?: boolean
  warnings: string[]
}

/** Lines of the copy that start or end with a separator glyph (never the "₡" / "+" of a price / number). */
export function findSeparatorLines(copy: string): McpImageQa['separatorLines'] {
  const out: McpImageQa['separatorLines'] = []
  copy.split(/\r?\n/).forEach((raw, i) => {
    const text = raw.trim()
    if (!text) return
    if (/^[·•|—–]\s/.test(text) || /^[·•|]$/.test(text)) out.push({ line: i + 1, text, where: 'start' })
    if (/\s[·•|—–]$/.test(text) || /[·•|]$/.test(text)) out.push({ line: i + 1, text, where: 'end' })
  })
  return out
}

/**
 * MCP copy hygiene: drop leading/trailing separators and split long "a · b" lines at the separator,
 * so Grok cannot wrap a line and leave the "·" orphaned at its end. Wording is never changed.
 */
export function tidyCopySeparators(copy: string, maxLine = 38): { copy: string; changes: string[] } {
  const changes: string[] = []
  const lines: string[] = []
  copy.split(/\r?\n/).forEach((raw, i) => {
    let text = raw.trim()
    const before = text
    text = text.replace(/^[\s·•|—–]+(?=\S)/, '').replace(/(?<=\S)[\s·•|—–]+$/, '')
    if (text !== before) changes.push(`line ${i + 1}: removed a leading/trailing separator`)
    if (text.length > maxLine && / [·•|] /.test(text)) {
      const parts = text.split(/ [·•|] /).map((t) => t.trim()).filter(Boolean)
      if (parts.length > 1 && parts.every((p) => p.length >= 6)) {
        changes.push(`line ${i + 1}: split at the separator into ${parts.length} lines`)
        lines.push(...parts)
        return
      }
    }
    lines.push(text)
  })
  return { copy: lines.join('\n'), changes }
}

/** Edge density (0–1) of horizontal bands: text-like high-frequency content. */
async function bandEdgeDensity(bytes: Buffer): Promise<{ top: number; bottom: number; mid: number; width: number; height: number }> {
  const { data, info } = await sharp(bytes).rotate().greyscale().resize({ width: 256 }).raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const dens = (y0: number, y1: number) => {
    let edges = 0
    let n = 0
    for (let y = Math.max(1, y0); y < Math.min(h, y1); y++) {
      for (let x = 1; x < w; x++) {
        const d = Math.abs(data[y * w + x] - data[y * w + x - 1])
        if (d > 48) edges++
        n++
      }
    }
    return n ? edges / n : 0
  }
  return { top: dens(0, Math.floor(h * 0.3)), bottom: dens(Math.floor(h * 0.7), h), mid: dens(Math.floor(h * 0.3), Math.floor(h * 0.7)), width: info.width, height: info.height }
}

/**
 * Safe-zone check (free, local). Two defects:
 *  - a flat UI block (CTA button) whose edge touches the canvas border: a flat horizontal/vertical run
 *    in the outermost rows/columns that contrasts with the pixels just inside it;
 *  - text-like edge energy inside the Instagram UI margin band (bottom/top).
 */
export async function checkSafeZones(bytes: Buffer, ratio: string): Promise<SafeZoneIssue[]> {
  const { data, info } = await sharp(bytes).rotate().removeAlpha().resize({ width: 200 }).raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const px = (x: number, y: number): [number, number, number] => [data[(y * w + x) * 3], data[(y * w + x) * 3 + 1], data[(y * w + x) * 3 + 2]]
  const dist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const issues: SafeZoneIssue[] = []
  const m = safeZoneMargins(ratio)

  // 1) flat block (CTA button) touching the top/bottom edge: a flat run in the outermost row that contrasts with
  //    the pixels `inset` rows inside AND is a bounded slab (2–14% of the height thick, then a sharp edge). A photo
  //    surface that simply continues to the border (table, floor) is thicker than that and is not flagged.
  const slab = (edge: 'top' | 'bottom') => {
    const dir = edge === 'bottom' ? -1 : 1
    // The button "touches" the edge when its outer rim is within 3% of the canvas of the border.
    for (let off = 0; off <= Math.max(2, Math.round(h * 0.03)); off++) {
      const y = edge === 'bottom' ? h - 2 - off : 1 + off
      if (y < 1 || y >= h - 1) break
      let run = 0
      let best = 0
      let bestEnd = 0
      for (let x = 1; x < w; x++) {
        const flat = dist(px(x, y), px(x - 1, y)) < 14
        if (flat) { run++; if (run > best) { best = run; bestEnd = x } } else run = 0
      }
      const span = best / w
      if (span < 0.12 || span > 0.92) continue
      // thickness measured at a column 10% in from the run's left end (clear of the label text)
      const col = Math.min(w - 1, Math.max(0, bestEnd - best + Math.round(best * 0.1)))
      const ref = px(col, y)
      let t = 0
      for (let k = 0; k < h; k++) {
        const yy = y + dir * k
        if (yy < 0 || yy >= h) break
        if (dist(px(col, yy), ref) < 30) t++
        else break
      }
      const next = y + dir * (t + 1)
      const sharpEdge = next >= 0 && next < h && dist(px(col, next), ref) > 60
      if (t >= Math.round(h * 0.02) && t <= Math.round(h * 0.14) && sharpEdge) {
        issues.push({ edge, kind: 'block_touches_edge', detail: `a flat block (~${Math.round(span * 100)}% of the width, e.g. the CTA button) touches the ${edge} edge`, amount: 1 })
        return
      }
    }
  }
  slab('bottom')
  // (a flat block at the top edge is usually the photo itself, not a button: only the bottom CTA is checked as a slab)

  // 2) text-like energy inside the unsafe bands (strong, dense, short transitions).
  const textBand = (y0: number, y1: number) => {
    let edges = 0
    let n = 0
    for (let y = Math.max(1, y0); y < Math.min(h, y1); y++) {
      for (let x = 1; x < w; x++) {
        const d = dist(px(x, y), px(x - 1, y))
        if (d > 110) edges++
        n++
      }
    }
    return n ? edges / n : 0
  }
  const bottomBand = textBand(Math.floor(h * (1 - m.bottom)), h)
  if (bottomBand > 0.035 && !issues.some((i) => i.edge === 'bottom')) issues.push({ edge: 'bottom', kind: 'text_in_unsafe_band', detail: `text-like content inside the bottom ${Math.round(m.bottom * 100)}% (Instagram UI zone)`, amount: Math.round(bottomBand * 1000) / 1000 })
  const topBand = textBand(0, Math.floor(h * m.top))
  if (topBand > 0.035 && !issues.some((i) => i.edge === 'top')) issues.push({ edge: 'top', kind: 'text_in_unsafe_band', detail: `text-like content inside the top ${Math.round(m.top * 100)}% (Instagram UI zone)`, amount: Math.round(topBand * 1000) / 1000 })
  return issues
}


/**
 * Count button-like flat blocks (CTA buttons): connected regions of one quantised colour whose bounding box is a wide, short
 * rounded-rectangle (aspect 2.2–9, 14–65 % of the width, 2.5–12 % of the height) and mostly filled (text leaves holes).
 * Heuristic: a CTA drawn as plain text is not detectable; a textured scene rarely forms such a block.
 */
export async function countCtaButtons(bytes: Buffer, opts: { logoBox?: { x0: number; y0: number; x1: number; y1: number } | null } = {}): Promise<number> {
  const { data, info } = await sharp(bytes).rotate().removeAlpha().resize({ width: 200 }).blur(0.8).raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const n = w * h
  const keyOf = new Int32Array(n)
  const counts = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const k = ((data[i * 3] >> 5) << 6) | ((data[i * 3 + 1] >> 5) << 3) | (data[i * 3 + 2] >> 5)
    keyOf[i] = k
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  let buttons = 0
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  for (const [k, c] of counts) {
    if (c / n < 0.004 || c / n > 0.14) continue
    const mask = new Uint8Array(n)
    for (let i = 0; i < n; i++) mask[i] = keyOf[i] === k ? 1 : 0
    const { list } = components(mask, w, h)
    for (const comp of list) {
      if (comp.area / n < 0.004) break
      const bw = comp.x1 - comp.x0 + 1
      const bh = comp.y1 - comp.y0 + 1
      const aspect = bw / bh
      if (aspect < 2.2 || aspect > 9 || bw / w < 0.14 || bw / w > 0.65 || bh / h < 0.025 || bh / h > 0.12) continue
      if (comp.area / (bw * bh) < 0.55) continue
      const dup = boxes.some((b) => Math.abs(b.x0 - comp.x0) < 8 && Math.abs(b.y0 - comp.y0) < 8)
      if (dup) continue
      // The brand logo plate is a rounded rectangle too: it is never a CTA (a plate that sits wholly in the top 18 % band,
      // or overlaps the located logo, is skipped).
      if (comp.y1 / h < 0.18) continue
      // A button never touches the left/right border (the safe-zone side margin is 5 %): a block that does is scene surface
      // (the round-5 table edge was counted as a second button).
      if (comp.x0 <= 1 || comp.x1 >= w - 2) continue
      const lb = opts.logoBox
      if (lb) {
        const ix = Math.max(0, Math.min(comp.x1 / w, lb.x1) - Math.max(comp.x0 / w, lb.x0))
        const iy = Math.max(0, Math.min(comp.y1 / h, lb.y1) - Math.max(comp.y0 / h, lb.y0))
        if (ix * iy > 0.4 * ((comp.x1 - comp.x0 + 1) / w) * ((comp.y1 - comp.y0 + 1) / h)) continue
      }
      boxes.push({ x0: comp.x0, y0: comp.y0, x1: comp.x1, y1: comp.y1 })
      buttons++
    }
  }
  return buttons
}

/** Best-effort: where the brand logo sits in the generated image (feature match), as fractions; null when not found. */
export async function locateLogoBox(logo: Buffer, generated: Buffer): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  try {
    const found = await locateProduct(logo, generated)
    if (!found.located || found.located.inliers < 12) return null
    const box = projectReferenceBox(found.ref, found.gen, found.located.transform)
    const bw = box.x1 - box.x0
    const bh = box.y1 - box.y0
    return bw > 0.04 && bw < 0.7 && bh > 0.01 && bh < 0.4 ? box : null
  } catch {
    return null
  }
}

/** Weighted defect score (0 = clean). Used to keep the BETTER image after the single auto-retry. */
export function qaSeverity(qa: Pick<McpImageQa, 'safeZoneIssues' | 'textPresent' | 'separatorLines' | 'ctaButtons'>): number {
  let v = 0
  for (const i of qa.safeZoneIssues) v += i.kind === 'block_touches_edge' ? 3 + Math.min(1, i.amount ?? 0) : 2 + Math.min(2, (i.amount ?? 0) * 20)
  if (qa.textPresent === 'no') v += 4
  v += qa.separatorLines.length
  if (qa.ctaButtons > 1) v += 2 * (qa.ctaButtons - 1)
  return Math.round(v * 100) / 100
}

export async function runMcpImageQa(input: {
  generatedDataUrl: string
  requestedRatio: string
  copyRequested: boolean
  logoAttached: boolean
  logoExpected: boolean
  /** The on-image copy as sent (for the separator check). */
  copy?: string
  /** Separator fixes already applied to the copy (reported, not flagged). */
  copyChanges?: string[]
  /** Where the brand logo sits (fractions of the image) when known: excluded from the button count. */
  logoBox?: { x0: number; y0: number; x1: number; y1: number } | null
}): Promise<McpImageQa> {
  const warnings: string[] = []
  let ratioOk = true
  let textPresent: McpImageQa['textPresent'] = input.copyRequested ? 'yes' : 'not_requested'
  let safeZones: McpImageQa['safeZones'] = 'not_checked'
  let safeZoneIssues: SafeZoneIssue[] = []
  let ctaButtons = 0
  const bytes = dataUrlBytes(input.generatedDataUrl)
  if (bytes) {
    try {
      const meta = await sharp(bytes).metadata()
      const m = input.requestedRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
      if (m && meta.width && meta.height) {
        const want = Number(m[1]) / Number(m[2])
        ratioOk = Math.abs(meta.width / meta.height - want) / want < 0.02
        if (!ratioOk) warnings.push(`image is ${meta.width}x${meta.height}, not ${input.requestedRatio}`)
      }
      if (input.copyRequested) {
        const bands = await bandEdgeDensity(bytes)
        // Text-like edge energy in the header/footer bands is the cheap proxy; photos alone rarely have it.
        textPresent = Math.max(bands.top, bands.bottom) > 0.02 ? 'yes' : 'no'
        if (textPresent === 'no') warnings.push('no text-like content detected in the header/footer although copy was requested (heuristic)')
      }
    } catch {
      /* heuristic only */
    }
    try {
      safeZoneIssues = await checkSafeZones(bytes, input.requestedRatio)
      safeZones = safeZoneIssues.length ? 'violation' : 'ok'
      for (const i of safeZoneIssues) warnings.push(`safe zone: ${i.detail}`)
    } catch {
      safeZones = 'not_checked'
    }
    try {
      ctaButtons = await countCtaButtons(bytes, { logoBox: input.logoBox })
    } catch { /* heuristic only */ }
  }
  const separatorLines = input.copy ? findSeparatorLines(input.copy) : []
  for (const l of separatorLines) warnings.push(`copy line ${l.line} ${l.where === 'end' ? 'ends' : 'starts'} with a separator ("${l.text.slice(0, 60)}")`)
  const logo: McpImageQa['logo'] = input.logoAttached ? 'attached' : input.logoExpected ? 'none' : 'not_requested'
  if (logo === 'none') warnings.push('the brand kit has no logo to stamp')
  const extraCtaRisk = ctaButtons > 1
  if (extraCtaRisk) warnings.push(`${ctaButtons} button-like blocks found: the copy has exactly one CTA, a second button may have been invented (heuristic)`)
  const status: McpImageQa['status'] = safeZones === 'violation' || separatorLines.length > 0 || textPresent === 'no' || extraCtaRisk ? 'fail' : 'pass'
  const severity = qaSeverity({ safeZoneIssues, textPresent, separatorLines, ctaButtons })
  return { ratioOk, textPresent, logo, safeZones, safeZoneIssues, separatorLines, copyNormalised: input.copyChanges ?? [], ctaButtons, extraCtaRisk, status, severity, warnings }
}
