/**
 * Product fidelity — cut-out RECALL vs the source photo (P0 #4) and flat-lay detection (P1 #6).
 *
 * The fidelity score only measures what stayed in the cut-out (precision). A white tape roll or
 * two screws dropped on a light background never lowered it. Recall compares the cut-out mask with
 * an independent estimate of everything that is NOT background in the source photo:
 *
 *   background model  robust quadratic fit (per Lab channel, outliers rejected) of the pixels the
 *                     border flood marked as background → follows gradients / vignetting, and a
 *                     near-white piece never biases it (it is an outlier of the fit);
 *   foreground        ΔE to that model above a noise-adaptive threshold (≥ 4), opened, split into
 *                     connected components; specks, frame-touching blobs and SHADOW-like blobs
 *                     (darker than the surface, same hue, low ΔE) are not objects;
 *   recall            min(area recall, component recall, color-histogram coverage).
 *
 * Pure TS on raw work-resolution planes, no I/O.
 */
import { components, dilate, erode, median, type Component } from './pixels.js'

export interface ForegroundEstimate {
  w: number
  h: number
  /** Component label per pixel (0 = background / rejected). */
  labels: Int32Array
  /** Accepted object components (largest first). */
  comps: Component[]
  /** ΔE threshold used. */
  threshold: number
  /** Lab of the image (interleaved), kept for color coverage. */
  lab: Float32Array
  /**
   * Round 1: pixels of accepted objects that look like a soft shadow on the surface (darker, same
   * hue, low ΔE). A cut-out may drop them (shadow removal) without losing recall.
   */
  soft?: Uint8Array
}

export interface CutoutRecall {
  /** min(areaRecall, componentRecall, colorCoverage), 0–1. */
  recall: number
  areaRecall: number
  componentRecall: number
  colorCoverage: number
  /** Separate objects found in the source vs kept in the cut-out. */
  components: { source: number; kept: number }
}

/** Minimum recall for a cut-out to be used (else model retry → cutout_incomplete). */
export const MIN_CUTOUT_RECALL = 0.95

/** Solve a small dense linear system (Gaussian elimination, partial pivoting). */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-9) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

const basis = (x: number, y: number) => [1, x, y, x * x, x * y, y * y]

/** Robust quadratic background model per Lab channel from candidate background pixels. */
function fitBackground(lab: Float32Array, w: number, h: number, hint: Uint8Array): Float32Array | null {
  const n = w * h
  const idx: number[] = []
  let count = 0
  for (let i = 0; i < n; i++) if (hint[i]) count++
  if (count < 64) return null
  const step = Math.max(1, Math.floor(count / 5000))
  let k = 0
  for (let i = 0; i < n; i++) {
    if (!hint[i]) continue
    if (k++ % step === 0) idx.push(i)
  }
  const nx = (i: number) => ((i % w) / Math.max(1, w - 1)) * 2 - 1
  const ny = (i: number) => (Math.floor(i / w) / Math.max(1, h - 1)) * 2 - 1
  let use = idx.map(() => true)
  let coef: number[][] = []
  for (let iter = 0; iter < 3; iter++) {
    coef = []
    for (let c = 0; c < 3; c++) {
      const A = Array.from({ length: 6 }, () => new Array(6).fill(0))
      const b = new Array(6).fill(0)
      for (let s = 0; s < idx.length; s++) {
        if (!use[s]) continue
        const i = idx[s]
        const f = basis(nx(i), ny(i))
        const v = lab[i * 3 + c]
        for (let r = 0; r < 6; r++) {
          b[r] += f[r] * v
          for (let q = 0; q < 6; q++) A[r][q] += f[r] * f[q]
        }
      }
      const sol = solve(A, b)
      if (!sol) return null
      coef.push(sol)
    }
    // Reject outliers (pieces of the background color family, stains) for the next pass.
    const res = idx.map((i) => {
      const f = basis(nx(i), ny(i))
      let d2 = 0
      for (let c = 0; c < 3; c++) {
        let m = 0
        for (let r = 0; r < 6; r++) m += coef[c][r] * f[r]
        d2 += (lab[i * 3 + c] - m) ** 2
      }
      return Math.sqrt(d2)
    })
    const sigma = Math.max(0.8, 1.4826 * median(res))
    use = res.map((d) => d <= Math.max(2.5, 2.5 * sigma))
  }
  const model = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const f = basis(nx(i), ny(i))
    for (let c = 0; c < 3; c++) {
      let m = 0
      for (let r = 0; r < 6; r++) m += coef[c][r] * f[r]
      model[i * 3 + c] = m
    }
  }
  return model
}

/**
 * Everything that is not background in a clean-background photo, as object components. `hint` =
 * pixels believed to be background (e.g. the border flood); null → the outer 4% frame.
 */
export function estimateForeground(lab: Float32Array, w: number, h: number, hint: Uint8Array | null): ForegroundEstimate | null {
  const n = w * h
  let seed = hint
  if (!seed) {
    seed = new Uint8Array(n)
    const bw = Math.max(2, Math.round(0.04 * Math.min(w, h)))
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < bw || y < bw || x >= w - bw || y >= h - bw) seed[y * w + x] = 1
  }
  const model = fitBackground(lab, w, h, seed)
  if (!model) return null
  const delta = new Float32Array(n)
  const bgRes: number[] = []
  for (let i = 0; i < n; i++) {
    delta[i] = Math.hypot(lab[i * 3] - model[i * 3], lab[i * 3 + 1] - model[i * 3 + 1], lab[i * 3 + 2] - model[i * 3 + 2])
    if (seed[i] && i % 7 === 0) bgRes.push(delta[i])
  }
  const noise = 1.4826 * median(bgRes)
  const threshold = Math.max(4, 3 * noise + 1.5)
  let cand: Uint8Array = new Uint8Array(n)
  for (let i = 0; i < n; i++) cand[i] = delta[i] > threshold ? 1 : 0
  cand = dilate(erode(cand, w, h, 1), w, h, 1)
  const { labels, list } = components(cand, w, h)
  const minArea = Math.max(30, Math.round(0.00025 * n))
  const keep = new Set<number>()
  const comps: Component[] = []
  for (const c of list) {
    if (c.area < minArea) continue
    if (c.x0 <= 0 || c.y0 <= 0 || c.x1 >= w - 1 || c.y1 >= h - 1) continue
    // Shadow-like: darker than the surface, same hue, soft (a cast / contact shadow is not an object).
    let dL = 0
    let dC = 0
    let dE = 0
    let k = 0
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const i = y * w + x
        if (labels[i] !== c.label) continue
        dL += lab[i * 3] - model[i * 3]
        dC += Math.hypot(lab[i * 3 + 1] - model[i * 3 + 1], lab[i * 3 + 2] - model[i * 3 + 2])
        dE += delta[i]
        k++
      }
    }
    dL /= k
    dC /= k
    dE /= k
    if (dL < -2 && dL > -30 && dC < 6 && dE < 30) continue
    keep.add(c.label)
    comps.push(c)
  }
  const out = new Int32Array(n)
  const soft = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!keep.has(labels[i])) continue
    out[i] = labels[i]
    const dLi = lab[i * 3] - model[i * 3]
    const dCi = Math.hypot(lab[i * 3 + 1] - model[i * 3 + 1], lab[i * 3 + 2] - model[i * 3 + 2])
    if (dLi < -1.5 && dLi > -25 && dCi < 3) soft[i] = 1
  }
  return { w, h, labels: out, comps, threshold, lab, soft }
}

/** Separated object components a flat lay shows (each ≥ 0.2% of the frame). */
export function flatLayComponents(est: ForegroundEstimate): number {
  const min = 0.002 * est.w * est.h
  return est.comps.filter((c) => c.area >= min).length
}

/** Flat lay (top-down kit layout): ≥ 3 separated objects on a uniform background. */
export function isFlatLayEstimate(est: ForegroundEstimate | null): boolean {
  return Boolean(est && flatLayComponents(est) >= 3)
}

const colorBin = (L: number, a: number, b: number) => {
  const li = Math.max(0, Math.min(9, Math.floor(L / 10)))
  const ai = Math.max(0, Math.min(7, Math.floor((a + 64) / 16)))
  const bi = Math.max(0, Math.min(7, Math.floor((b + 64) / 16)))
  return (li * 8 + ai) * 8 + bi
}

/**
 * Recall of a work-resolution 0/1 mask vs the estimate. `scopeToMain`: single-product photos
 * only count objects that overlap the mask's own (padded) bbox — a prop or stain elsewhere is not
 * part of the product; flat lays count every object.
 */
export function cutoutRecall(est: ForegroundEstimate, mask: Uint8Array, opts: { scopeToMain?: boolean } = {}): CutoutRecall {
  const { w, h, labels } = est
  const near = dilate(mask, w, h, 2)
  let mx0 = w
  let my0 = h
  let mx1 = -1
  let my1 = -1
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue
    const x = i % w
    const y = (i - x) / w
    if (x < mx0) mx0 = x
    if (x > mx1) mx1 = x
    if (y < my0) my0 = y
    if (y > my1) my1 = y
  }
  const padX = Math.round(0.04 * w)
  const padY = Math.round(0.04 * h)
  const inScope = (c: Component) => !opts.scopeToMain || (mx1 >= 0 && c.x1 >= mx0 - padX && c.x0 <= mx1 + padX && c.y1 >= my0 - padY && c.y0 <= my1 + padY)
  const scoped = est.comps.filter(inScope)
  if (!scoped.length) return { recall: 1, areaRecall: 1, componentRecall: 1, colorCoverage: 1, components: { source: 0, kept: 0 } }
  const byLabel = new Map(scoped.map((c) => [c.label, { area: 0, hit: 0 }]))
  const histE = new Float64Array(640)
  const histM = new Float64Array(640)
  for (let i = 0; i < w * h; i++) {
    const s = byLabel.get(labels[i])
    const bin = colorBin(est.lab[i * 3], est.lab[i * 3 + 1], est.lab[i * 3 + 2])
    if (mask[i]) histM[bin]++
    if (!s) continue
    // A dropped soft shadow is not a missed piece of the product (round 1).
    if (est.soft?.[i] && !near[i]) continue
    s.area++
    histE[bin]++
    if (near[i]) s.hit++
  }
  let total = 0
  let hit = 0
  let kept = 0
  for (const s of byLabel.values()) {
    total += s.area
    hit += s.hit
    if (s.hit >= 0.5 * s.area) kept++
  }
  let massE = 0
  let covered = 0
  for (let b = 0; b < histE.length; b++) {
    if (!histE[b]) continue
    massE += histE[b]
    if (histM[b] >= 0.05 * histE[b]) covered += histE[b]
  }
  const areaRecall = total ? hit / total : 1
  const componentRecall = kept / scoped.length
  const colorCoverage = massE ? covered / massE : 1
  const r = (v: number) => Math.round(v * 1000) / 1000
  return {
    recall: r(Math.min(areaRecall, componentRecall, colorCoverage)),
    areaRecall: r(areaRecall),
    componentRecall: r(componentRecall),
    colorCoverage: r(colorCoverage),
    components: { source: scoped.length, kept },
  }
}

/** Add the estimate's objects the mask missed (flat lays: near-white pieces on a light surface). */
export function addMissedObjects(est: ForegroundEstimate, mask: Uint8Array, opts: { scopeToMain?: boolean } = {}): Uint8Array {
  const { w, h, labels } = est
  const out = mask.slice()
  const rec = new Map<number, { area: number; hit: number; c: Component }>()
  for (const c of est.comps) rec.set(c.label, { area: 0, hit: 0, c })
  for (let i = 0; i < w * h; i++) {
    const s = rec.get(labels[i])
    if (!s) continue
    s.area++
    if (mask[i]) s.hit++
  }
  let mx0 = w
  let my0 = h
  let mx1 = -1
  let my1 = -1
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue
    const x = i % w
    const y = (i - x) / w
    mx0 = Math.min(mx0, x)
    mx1 = Math.max(mx1, x)
    my0 = Math.min(my0, y)
    my1 = Math.max(my1, y)
  }
  const add = new Set<number>()
  for (const [label, s] of rec) {
    // Only objects the mask missed (≥ half outside); pieces touching the product stay as they are.
    if (s.hit >= 0.5 * s.area) continue
    if (opts.scopeToMain && !(s.c.x1 >= mx0 && s.c.x0 <= mx1 && s.c.y1 >= my0 && s.c.y0 <= my1)) continue
    add.add(label)
  }
  if (!add.size) return out
  for (let i = 0; i < w * h; i++) if (add.has(labels[i])) out[i] = 1
  return out
}

/** Flat lay from a cut-out's own alpha: ≥ 3 separated opaque components (each ≥ 1.5% of the opaque area). */
export function alphaIsFlatLay(alpha: Uint8Array | Buffer, w: number, h: number, channels = 4): boolean {
  const mask = new Uint8Array(w * h)
  let area = 0
  for (let i = 0; i < w * h; i++) {
    mask[i] = alpha[i * channels + (channels - 1)] >= 128 ? 1 : 0
    area += mask[i]
  }
  if (!area) return false
  const { list } = components(mask, w, h)
  return list.filter((c) => c.area >= 0.015 * area).length >= 3
}
