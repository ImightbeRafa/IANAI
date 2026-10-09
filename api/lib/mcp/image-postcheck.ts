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
    colourDeltaE: number
    silhouetteIoU: number
    refParts: number
    genParts: number
    scale: number
    referenceIndex: number
  }
}

export type FidelityCheckResult =
  | { status: 'ok'; score: number; details: FidelityWarning['details'] }
  | { status: 'warning'; score: number; warning: FidelityWarning }
  | { status: 'skipped'; reason: string }

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

async function compareOne(tpl: RefTemplate, generated: Buffer, referenceIndex: number): Promise<{ score: number; details: FidelityWarning['details'] }> {
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
 * Compare a generated image with the product reference photo(s). Warning only; the best-matching
 * reference decides (a kit with several photos is fine if the image matches one of them).
 */
export async function checkGeneratedProductFidelity(input: {
  referenceDataUrls: string[]
  generatedDataUrl: string
}): Promise<FidelityCheckResult> {
  try {
    const generated = dataUrlBytes(input.generatedDataUrl)
    if (!generated) return { status: 'skipped', reason: 'generated image is not inline' }
    const skips: string[] = []
    let best: { score: number; details: FidelityWarning['details'] } | null = null
    for (let i = 0; i < input.referenceDataUrls.length; i++) {
      const bytes = dataUrlBytes(input.referenceDataUrls[i])
      if (!bytes) { skips.push('reference not inline'); continue }
      const tpl = await buildTemplate(bytes)
      if (typeof tpl === 'string') { skips.push(tpl); continue }
      const res = await compareOne(tpl, generated, i)
      if (!best || res.score > best.score) best = res
    }
    if (!best) return { status: 'skipped', reason: skips[0] || 'no product reference to compare' }
    const d = best.details
    const reasons: string[] = []
    if (d.colourDeltaE > POSTCHECK_THRESHOLD.colourDeltaE) reasons.push(`product colour differs from the reference (ΔE ${d.colourDeltaE} > ${POSTCHECK_THRESHOLD.colourDeltaE})`)
    if (d.silhouetteIoU < POSTCHECK_THRESHOLD.silhouetteIoU) reasons.push(`product shape differs from the reference (silhouette match ${d.silhouetteIoU} < ${POSTCHECK_THRESHOLD.silhouetteIoU})`)
    if (Math.abs(d.genParts - d.refParts) >= POSTCHECK_THRESHOLD.partDiff) reasons.push(`part count changed (reference ${d.refParts}, generated ${d.genParts})`)
    if (best.score < POSTCHECK_THRESHOLD.score && reasons.length === 0) reasons.push(`overall product match ${best.score} < ${POSTCHECK_THRESHOLD.score}`)
    if (reasons.length === 0) return { status: 'ok', score: best.score, details: d }
    return {
      status: 'warning',
      score: best.score,
      warning: { code: 'fidelity_warning', reason: reasons.join('; '), score: best.score, details: d },
    }
  } catch (err) {
    return { status: 'skipped', reason: `fidelity check unavailable: ${err instanceof Error ? err.message : 'error'}` }
  }
}

// ---------------------------------------------------------------------------
// Safety-net QA (heuristic, warning only)
// ---------------------------------------------------------------------------

export type McpImageQa = {
  ratioOk: boolean
  textPresent: 'yes' | 'no' | 'not_requested'
  logo: 'attached' | 'none' | 'not_requested'
  safeZones: 'not_checked'
  warnings: string[]
}

/** Edge density (0–1) of a horizontal band: text-like high-frequency content. */
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

export async function runMcpImageQa(input: {
  generatedDataUrl: string
  requestedRatio: string
  copyRequested: boolean
  logoAttached: boolean
  logoExpected: boolean
}): Promise<McpImageQa> {
  const warnings: string[] = []
  let ratioOk = true
  let textPresent: McpImageQa['textPresent'] = input.copyRequested ? 'yes' : 'not_requested'
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
  }
  const logo: McpImageQa['logo'] = input.logoAttached ? 'attached' : input.logoExpected ? 'none' : 'not_requested'
  if (logo === 'none') warnings.push('the brand kit has no logo to stamp')
  return { ratioOk, textPresent, logo, safeZones: 'not_checked', warnings }
}

