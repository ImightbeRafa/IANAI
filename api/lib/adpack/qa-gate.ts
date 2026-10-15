/**
 * Round 1b — automated QA gate (QUALITY-BAR.md hard-fail list), run on every exact render before
 * anything is shown. Deterministic, no model calls. Each metric has a measured value, a threshold
 * and a hard flag; a render with any hard failure is never delivered (the runner retries with an
 * alternate layout / family first, then reports the ratio as failed).
 *
 *   edge_roughness   cut-out silhouette jaggedness (perimeter vs smoothed perimeter) + leftover
 *                    backdrop share; studio-bleed renders have no cut edge (0 by construction)
 *   shadow_present   soft shadow tone under the product base (contact shadow / AO)
 *   sharpness        product edge acutance vs the headline's (soft / upscaled product next to crisp
 *                    type fails) + enlargement factor cap
 *   safe_zones       every text element + logo inside the IG UI-safe zones (4:5 margins; 9:16 top
 *                    250 px / bottom 340 px)
 *   product_framing  product inside the canvas, ≥ min share of the canvas, no copy over it
 *   text_overflow    every element fits; lines rebuild the text; no line starting/ending in "·";
 *                    no orphaned short last headline word
 *   required_facts   every required fact on the image (price) or in the caption
 *   logo             logo present, large enough, self-contained badge or ≥ 3:1 contrast
 *   headline         article / bare-noun rule + ambiguous (lossy) claims
 *   contrast         every text element ≥ 4.5:1
 */
import sharp from 'sharp'
import { findBareNounHeadline, findLossyClaim } from './check-copy.js'
import { checkOneIdeaHeadline } from './headline-rules.js'
import type { AspectRatio } from './types.js'

export type QaMetricId = 'edge_roughness' | 'shadow_present' | 'sharpness' | 'safe_zones' | 'product_framing' | 'text_overflow' | 'required_facts' | 'logo' | 'headline' | 'contrast'

export interface QaMetric {
  id: QaMetricId
  /** Measured value (null = not measurable on this render). */
  value: number | null
  /** Human-readable threshold ("≤ 0.32", "≥ 0.45"). */
  threshold: string
  passed: boolean
  hard: boolean
  detail?: string
}

export interface QaGateResult {
  passed: boolean
  /** Share of metrics passed, 0–1 (3 decimals). */
  score: number
  metrics: QaMetric[]
  failed: QaMetricId[]
}

export const QA_THRESHOLDS = {
  edgeRoughnessMax: 0.45,
  backgroundLeakMax: 0.02,
  shadowShareMin: 0.06,
  sharpnessRatioMin: 0.35,
  upscaleMax: 1.6,
  productShareMin: 0.1,
  /** Logo legibility: min area (px²) and min side (px) on a 1080-wide canvas (round-1's 88×50 chip = 4.4k px²). */
  logoMinArea: 9000,
  logoMinSide: 56,
  logoMinContrast: 3,
  minContrast: 4.5,
  ig: {
    '4:5': { top: 54, bottom: 54, side: 54 },
    '1:1': { top: 54, bottom: 54, side: 54 },
    '9:16': { top: 250, bottom: 340, side: 54 },
    '16:9': { top: 54, bottom: 54, side: 72 },
  } as Record<AspectRatio, { top: number; bottom: number; side: number }>,
} as const

interface Box { x: number; y: number; w: number; h: number }

/** The subset of the renderer's LayoutReport the gate reads (kept structural for tests). */
export interface QaLayoutReport {
  width: number
  height: number
  elements: Array<{ role: string; text: string; lines: string[]; box: Box; contrast: number; fits: boolean }>
  productBox?: Box | null
  productBoxRespected?: boolean
  textOverProduct?: boolean
  logo?: Box | null
  logoSelfContained?: boolean
  logoContrast?: number
  bleed?: { scale: number; edgesTouched: string[] }
}

export interface QaRequiredFact {
  key: string
  value: string
  /** Must be on the image (price), not only in the caption. */
  onImage?: boolean
}

export interface QaGateInput {
  png: Uint8Array | Buffer
  ratio: AspectRatio
  report: QaLayoutReport
  /** Hero placement's resized layer (RGBA) — the cut-out edge is measured on its alpha. */
  heroPlaced?: Uint8Array | Buffer
  /** Studio bleed render (no cut edge). */
  bleed?: boolean
  /** Leftover backdrop share of the cut-out (fidelity). */
  backgroundLeak?: number
  requiredFacts?: QaRequiredFact[]
  caption?: string
  headline?: string
  /** Allowed verbatim claims (ambiguous-claim check). */
  claims?: string[]
  /** Round 1c: studio ads need a one-idea headline (≤ 9 words / 48 chars, ≤ 2 sentences, no empty adjectives). */
  oneIdeaHeadline?: boolean
  /** Brand name: with no logo asset, a large text wordmark of the brand name stands in (and is reported as such). */
  brandName?: string
  /** Fact matcher (the runner passes claims.textCarriesFact); default: normalized substring / digits. */
  matchFact?: (text: string, fact: QaRequiredFact) => boolean
}

const r3 = (v: number) => Math.round(v * 1000) / 1000
const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Pixel metrics
// ---------------------------------------------------------------------------

/**
 * Silhouette roughness: area between the binarized alpha and its σ≈2.5 px smoothed contour, per
 * px of perimeter (≈ mean stair-step / tear amplitude in px). Torn wing tips, jaggies and leftover
 * speckles add area the smooth contour does not have. ~0.1–0.25 clean matte; > 0.5 jagged.
 * Measured at placement size (what the viewer sees), capped at 1200 px.
 */
export async function edgeRoughness(rgba: Uint8Array | Buffer): Promise<number | null> {
  const meta = await sharp(Buffer.from(rgba)).metadata()
  if (!meta.width || !meta.height) return null
  const scale = Math.min(1, 1200 / Math.max(meta.width, meta.height))
  const w = Math.max(8, Math.round(meta.width * scale))
  const h = Math.max(8, Math.round(meta.height * scale))
  const a = await sharp(Buffer.from(rgba)).ensureAlpha().resize(w, h, { fit: 'fill' }).extractChannel(3).raw().toBuffer()
  const bin = Buffer.alloc(w * h)
  for (let i = 0; i < a.length; i++) bin[i] = a[i] >= 128 ? 255 : 0
  const sm = await sharp(bin, { raw: { width: w, height: h, channels: 1 } }).blur(2.5).extractChannel(0).raw().toBuffer()
  let perim = 0
  let diff = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    if ((bin[i] >= 128) !== (sm[i] >= 128)) diff++
    if (bin[i] < 128) continue
    if (bin[i - 1] < 128 || bin[i + 1] < 128 || bin[i - w] < 128 || bin[i + w] < 128) perim++
  }
  if (!perim) return null
  return r3(diff / perim)
}

async function grey(png: Uint8Array | Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(Buffer.from(png)).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

function clip(b: Box, w: number, h: number): Box | null {
  const x0 = Math.max(0, Math.floor(b.x))
  const y0 = Math.max(0, Math.floor(b.y))
  const x1 = Math.min(w, Math.ceil(b.x + b.w))
  const y1 = Math.min(h, Math.ceil(b.y + b.h))
  return x1 - x0 >= 4 && y1 - y0 >= 4 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

function pct(values: number[], p: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
}

/** Edge acutance ≈ 1 / edge width: p99 gradient magnitude over the region's p99–p1 range. */
export function acutance(g: { data: Buffer; w: number; h: number }, box: Box): number | null {
  const b = clip(box, g.w, g.h)
  if (!b) return null
  const grads: number[] = []
  const lum: number[] = []
  for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
    for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
      const i = y * g.w + x
      const gx = g.data[i + 1] - g.data[i - 1]
      const gy = g.data[i + g.w] - g.data[i - g.w]
      grads.push(Math.hypot(gx, gy) / 2)
      lum.push(g.data[i])
    }
  }
  const range = pct(lum, 0.99) - pct(lum, 0.01)
  if (range < 24) return null
  return r3(pct(grads, 0.995) / range)
}

/** Soft-shadow share in a band under the product base (pixels 3–45 % darker than the canvas, low chroma). */
export async function shadowShare(png: Uint8Array | Buffer, product: Box, heroPlaced?: Uint8Array | Buffer): Promise<{ share: number; ref: number } | null> {
  const { data, info } = await sharp(Buffer.from(png)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const bandTop = Math.round(product.y + product.h * 0.82)
  const bandBot = Math.min(H, Math.round(product.y + product.h + product.h * 0.06))
  const x0 = Math.max(0, Math.round(product.x))
  const x1 = Math.min(W, Math.round(product.x + product.w))
  if (bandBot - bandTop < 3 || x1 - x0 < 8) return null
  // Canvas reference: same rows, left and right of the product box.
  const refL: number[] = []
  const gap = Math.round(product.w * 0.04)
  for (let y = bandTop; y < bandBot; y++) {
    for (const xs of [[Math.max(0, x0 - gap - 40), Math.max(0, x0 - gap)], [Math.min(W, x1 + gap), Math.min(W, x1 + gap + 40)]]) {
      for (let x = xs[0]; x < xs[1]; x++) {
        const i = (y * W + x) * 3
        refL.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      }
    }
  }
  if (!refL.length) return null
  const ref = pct(refL, 0.5)
  let alpha: Buffer | null = null
  if (heroPlaced) {
    alpha = await sharp(Buffer.from(heroPlaced)).ensureAlpha().resize(Math.max(1, Math.round(product.w)), Math.max(1, Math.round(product.h)), { fit: 'fill' }).extractChannel(3).raw().toBuffer()
  }
  let shadow = 0
  let total = 0
  for (let y = bandTop; y < bandBot; y++) {
    for (let x = x0; x < x1; x++) {
      if (alpha) {
        const ax = x - Math.round(product.x)
        const ay = y - Math.round(product.y)
        if (ay >= 0 && ay < Math.round(product.h) && ax >= 0 && ax < Math.round(product.w) && alpha[ay * Math.round(product.w) + ax] > 25) continue
      }
      const i = (y * W + x) * 3
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])
      total++
      if (ref <= 40 ? l >= ref + 5 && l <= ref + 110 && chroma <= 40 : l <= ref * 0.97 && l >= ref * 0.55 && chroma <= 40) shadow++
    }
  }
  if (!total) return null
  return { share: r3(shadow / total), ref: Math.round(ref) }
}

const normKey = (t: string) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '')

// ---------------------------------------------------------------------------
// Layout metrics (pure)
// ---------------------------------------------------------------------------

export function safeZoneViolations(report: QaLayoutReport, ratio: AspectRatio): string[] {
  const z = QA_THRESHOLDS.ig[ratio] ?? QA_THRESHOLDS.ig['4:5']
  const W = report.width
  const H = report.height
  const out: string[] = []
  const check = (name: string, b: Box) => {
    if (b.x < z.side - 0.5 || b.x + b.w > W - z.side + 0.5 || b.y < z.top - 0.5 || b.y + b.h > H - z.bottom + 0.5) out.push(`${name} outside IG ${ratio} safe zone`)
  }
  for (const e of report.elements) check(`${e.role} "${e.text.slice(0, 24)}"`, e.box)
  if (report.logo) check('logo', report.logo)
  return out
}

const SEP_RE = /^[·•|\-–—]$/

export function textOverflowIssues(report: QaLayoutReport): string[] {
  const out: string[] = []
  for (const e of report.elements) {
    if (!e.fits) out.push(`${e.role} does not fit`)
    const joined = e.lines.join(' ').replace(/\s+/g, ' ').trim()
    const dropSep = (s: string) => s.replace(/\s*[·•]\s*/g, ' ').replace(/\s+/g, ' ').trim()
    if (dropSep(joined) !== dropSep(e.text.replace(/\s+/g, ' ').trim())) out.push(`${e.role} clipped ("${e.text.slice(0, 30)}")`)
    for (const l of e.lines) {
      const t = l.trim()
      if (/[·•]$/.test(t) || /^[·•]/.test(t) || SEP_RE.test(t)) out.push(`${e.role} line dangles a separator ("${t}")`)
    }
    if (e.role === 'headline' && e.lines.length > 1) {
      const last = e.lines[e.lines.length - 1].trim()
      if (!/\s/.test(last) && last.replace(/[^\p{L}\p{N}]/gu, '').length <= 3) out.push(`headline orphan "${last}"`)
    }
  }
  return out
}

/** Digits-insensitive match helper: "₡14.900" also matches "₡14 900" / "14.900". */
function factFound(hay: string, value: string): boolean {
  const h = norm(hay)
  const v = norm(value)
  if (!v) return true
  if (h.includes(v)) return true
  const digits = v.replace(/[^\d]/g, '')
  if (digits.length >= 3 && h.replace(/[^\d]/g, ' ').split(/\s+/).join('').includes(digits)) {
    // number present; also require the non-numeric words (if any) to appear
    const words = v.replace(/[\d.,₡$€]/g, ' ').split(/\s+/).filter((w) => w.length > 3)
    return words.every((w) => h.includes(w))
  }
  return false
}

export function missingFacts(report: QaLayoutReport, facts: QaRequiredFact[], caption = '', match?: (text: string, fact: QaRequiredFact) => boolean): string[] {
  const onImage = report.elements.map((e) => e.text).join(' \n ')
  const found = (hay: string, f: QaRequiredFact) => factFound(hay, f.value) || Boolean(match?.(hay, f))
  const out: string[] = []
  for (const f of facts) {
    const ok = f.onImage ? found(onImage, f) : found(onImage, f) || found(caption, f)
    if (!ok) out.push(`${f.key}${f.onImage ? ' (on image)' : ''}: "${f.value}"`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export async function runQaGate(input: QaGateInput): Promise<QaGateResult> {
  const T = QA_THRESHOLDS
  const { report, ratio } = input
  const metrics: QaMetric[] = []
  const product = report.productBox ?? null

  // 1) Edge roughness + leftover backdrop.
  if (input.bleed) {
    metrics.push({ id: 'edge_roughness', value: 0, threshold: `≤ ${T.edgeRoughnessMax}`, passed: true, hard: true, detail: 'studio bleed: no cut edge (photo backdrop faded into the canvas)' })
  } else {
    const rough = input.heroPlaced ? await edgeRoughness(input.heroPlaced) : null
    const leak = input.backgroundLeak
    const leakOk = leak === undefined || leak <= T.backgroundLeakMax
    const roughOk = rough !== null && rough <= T.edgeRoughnessMax
    metrics.push({ id: 'edge_roughness', value: rough, threshold: `≤ ${T.edgeRoughnessMax}; leak ≤ ${T.backgroundLeakMax}`, passed: roughOk && leakOk, hard: true, detail: `${rough === null ? 'no cut-out to measure' : `roughness ${rough}`}${leak !== undefined ? `, leftover backdrop ${leak}` : ''}` })
  }

  // 2) Shadow under the product.
  const sh = product ? await shadowShare(input.png, product, input.bleed ? undefined : input.heroPlaced) : null
  metrics.push({ id: 'shadow_present', value: sh?.share ?? null, threshold: `≥ ${T.shadowShareMin}`, passed: Boolean(sh && sh.share >= T.shadowShareMin), hard: true, detail: sh ? `soft-shadow share ${sh.share} under the base (canvas L ${sh.ref})` : 'no product box' })

  // 3) Sharpness: product acutance vs headline acutance.
  const g = await grey(input.png)
  const head = report.elements.find((e) => e.role === 'headline') ?? report.elements[0]
  const aP = product ? acutance(g, product) : null
  const aT = head ? acutance(g, head.box) : null
  const ratioPT = aP !== null && aT ? r3(aP / aT) : null
  const up = report.bleed?.scale ?? 1
  const sharpOk = ratioPT !== null && ratioPT >= T.sharpnessRatioMin && up <= T.upscaleMax
  metrics.push({ id: 'sharpness', value: ratioPT, threshold: `product/text ≥ ${T.sharpnessRatioMin}; enlargement ≤ ${T.upscaleMax}x`, passed: sharpOk, hard: true, detail: `product ${aP ?? 'n/a'} vs text ${aT ?? 'n/a'}${up > 1 ? `, enlarged ${up}x (Lanczos resample, not super-res)` : ''}` })

  // 4) Safe zones.
  const sz = safeZoneViolations(report, ratio)
  metrics.push({ id: 'safe_zones', value: sz.length, threshold: '0 violations', passed: sz.length === 0, hard: true, ...(sz.length ? { detail: sz.slice(0, 3).join('; ') } : {}) })

  // 5) Product framing.
  const share = product ? r3((product.w * product.h) / (report.width * report.height)) : 0
  const bled = report.bleed?.edgesTouched ?? []
  const cropped = product ? (product.x < -1 && !bled.includes('left')) || (product.y < -1 && !bled.includes('top')) || (product.x + product.w > report.width + 1 && !bled.includes('right')) || (product.y + product.h > report.height + 1 && !bled.includes('bottom')) : true
  const covered = report.textOverProduct === true || report.productBoxRespected === false
  metrics.push({ id: 'product_framing', value: share, threshold: `share ≥ ${T.productShareMin}, not cropped, no copy over it`, passed: Boolean(product) && share >= T.productShareMin && !cropped && !covered, hard: true, detail: `share ${share}${cropped ? ', cropped' : ''}${covered ? ', copy over product' : ''}` })

  // 6) Text overflow / clipping.
  const tx = textOverflowIssues(report)
  metrics.push({ id: 'text_overflow', value: tx.length, threshold: '0 issues', passed: tx.length === 0, hard: true, ...(tx.length ? { detail: tx.slice(0, 3).join('; ') } : {}) })

  // 7) Required facts.
  const miss = missingFacts(report, input.requiredFacts ?? [], input.caption, input.matchFact)
  metrics.push({ id: 'required_facts', value: miss.length, threshold: '0 missing', passed: miss.length === 0, hard: true, ...(miss.length ? { detail: `missing ${miss.join('; ')}` } : {}) })

  // 8) Logo.
  const lb = report.logo
  const area = lb ? lb.w * lb.h : 0
  const sizeOk = Boolean(lb) && area >= T.logoMinArea * (report.width / 1080) ** 2 && Math.min(lb!.w, lb!.h) >= T.logoMinSide * (report.width / 1080)
  let logoOk = sizeOk && Boolean(report.logoSelfContained || (report.logoContrast ?? 0) >= T.logoMinContrast)
  // No logo asset: a text wordmark of the brand name (≥ 36 px at 1080 w, contrast ≥ 4.5) names the brand.
  const wm = !lb && input.brandName ? report.elements.find((e) => normKey(e.text) === normKey(input.brandName!) && e.box.h >= 36 * (report.width / 1080) && e.contrast >= T.minContrast) : undefined
  if (wm) logoOk = true
  metrics.push({ id: 'logo', value: area, threshold: `area ≥ ${T.logoMinArea}px², side ≥ ${T.logoMinSide}px; badge or contrast ≥ ${T.logoMinContrast}`, passed: logoOk, hard: true, detail: lb ? `${lb.w}x${lb.h}px, ${report.logoSelfContained ? 'self-contained badge' : `contrast ${report.logoContrast ?? 'n/a'}`}` : wm ? `text wordmark "${wm.text}" (no logo asset), contrast ${wm.contrast}` : 'logo missing' })

  // 9) Headline rules.
  const headline = input.headline ?? head?.text ?? ''
  const bare = findBareNounHeadline(headline)
  const claimLines = [headline, ...report.elements.filter((e) => e.role === 'subline' || e.role === 'bullet').map((e) => e.text)]
  let lossy: { line: string; dropped: string[] } | null = null
  for (const line of claimLines) {
    const hit = line ? findLossyClaim(line, input.claims ?? []) : null
    if (hit) { lossy = { line, dropped: hit.dropped }; break }
  }
  const oneIdea = input.oneIdeaHeadline ? checkOneIdeaHeadline(headline, input.claims ?? []).filter((i) => i.code !== 'bare_noun' && i.code !== 'ambiguous_claim') : []
  metrics.push({ id: 'headline', value: (bare ? 1 : 0) + (lossy ? 1 : 0) + oneIdea.length, threshold: input.oneIdeaHeadline ? 'article present, no ambiguous claim, one short idea (≤ 9 words / 48 chars)' : 'article present, no ambiguous claim', passed: !bare && !lossy && !oneIdea.length, hard: true, ...(bare ? { detail: `missing article: "${bare.match}" → "${bare.fix}"` } : lossy ? { detail: `ambiguous claim "${lossy.line}" (drops: ${lossy.dropped.join(', ')})` } : oneIdea.length ? { detail: `not one idea: ${oneIdea[0].detail}` } : {}) })

  // 10) Contrast.
  const worst = report.elements.length ? Math.min(...report.elements.map((e) => e.contrast)) : 0
  metrics.push({ id: 'contrast', value: r3(worst), threshold: `≥ ${T.minContrast}`, passed: worst >= T.minContrast, hard: true })

  const failed = metrics.filter((m) => !m.passed && m.hard).map((m) => m.id)
  return { passed: failed.length === 0, score: r3(metrics.filter((m) => m.passed).length / metrics.length), metrics, failed }
}

/** One-line summary for status output ("qa 10/10" or "qa 8/10 ✗ shadow_present, sharpness"). */
export function qaSummaryLine(r: Pick<QaGateResult, 'metrics' | 'failed'>): string {
  const ok = r.metrics.filter((m) => m.passed).length
  return `qa ${ok}/${r.metrics.length}${r.failed.length ? ` ✗ ${r.failed.join(', ')}` : ''}`
}
