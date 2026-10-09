/**
 * Product fidelity — pixel helpers shared by segmentation, compositing, scoring
 * and logo cleanup: sRGB → CIE Lab (D65), ΔE76, binary morphology and
 * connected components on raw masks. Pure TS, no I/O.
 */

const SRGB_TO_LINEAR = (() => {
  const t = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const s = i / 255
    t[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return t
})()

const fLab = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)

/** sRGB 0–255 → CIE Lab (D65 white). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = SRGB_TO_LINEAR[r & 255]
  const G = SRGB_TO_LINEAR[g & 255]
  const B = SRGB_TO_LINEAR[b & 255]
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883
  const fx = fLab(x)
  const fy = fLab(y)
  const fz = fLab(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Lab planes (L,a,b interleaved) for a raw RGB/RGBA buffer. */
export function labImage(data: Uint8Array | Buffer, channels: number, n: number): Float32Array {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const [L, a, b] = rgbToLab(data[i * channels], data[i * channels + 1], data[i * channels + 2])
    out[i * 3] = L
    out[i * 3 + 1] = a
    out[i * 3 + 2] = b
  }
  return out
}

/** CIE76 color difference between two Lab triples stored in arrays. */
export function deltaE(lab: Float32Array, i: number, L: number, a: number, b: number): number {
  const dl = lab[i * 3] - L
  const da = lab[i * 3 + 1] - a
  const db = lab[i * 3 + 2] - b
  return Math.sqrt(dl * dl + da * da + db * db)
}

export function deltaE3(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Luma (Rec. 601) 0–255. */
export const gray = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** Binary erosion (square structuring element of radius r) of a 0/1 mask. */
export function erode(mask: Uint8Array, w: number, h: number, r = 1): Uint8Array {
  if (r <= 0) return mask.slice()
  // Separable: horizontal then vertical min.
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1
      for (let k = -r; k <= r && v; k++) {
        const xx = x + k
        if (xx < 0 || xx >= w || !mask[y * w + xx]) v = 0
      }
      tmp[y * w + x] = v
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1
      for (let k = -r; k <= r && v; k++) {
        const yy = y + k
        if (yy < 0 || yy >= h || !tmp[yy * w + x]) v = 0
      }
      out[y * w + x] = v
    }
  }
  return out
}

/** Binary dilation (square, radius r). */
export function dilate(mask: Uint8Array, w: number, h: number, r = 1): Uint8Array {
  if (r <= 0) return mask.slice()
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -r; k <= r && !v; k++) {
        const xx = x + k
        if (xx >= 0 && xx < w && mask[y * w + xx]) v = 1
      }
      tmp[y * w + x] = v
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -r; k <= r && !v; k++) {
        const yy = y + k
        if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1
      }
      out[y * w + x] = v
    }
  }
  return out
}

export interface Component {
  label: number
  area: number
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 4-connected components of a 0/1 mask. `labels[i]` = component label (1-based), 0 = background. */
export function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; list: Component[] } {
  const labels = new Int32Array(w * h)
  const list: Component[] = []
  const stack = new Int32Array(w * h)
  let next = 0
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue
    next++
    const c: Component = { label: next, area: 0, x0: w, y0: h, x1: -1, y1: -1 }
    let sp = 0
    stack[sp++] = start
    labels[start] = next
    while (sp) {
      const i = stack[--sp]
      const x = i % w
      const y = (i - x) / w
      c.area++
      if (x < c.x0) c.x0 = x
      if (x > c.x1) c.x1 = x
      if (y < c.y0) c.y0 = y
      if (y > c.y1) c.y1 = y
      if (x > 0 && mask[i - 1] && !labels[i - 1]) (labels[i - 1] = next), (stack[sp++] = i - 1)
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) (labels[i + 1] = next), (stack[sp++] = i + 1)
      if (y > 0 && mask[i - w] && !labels[i - w]) (labels[i - w] = next), (stack[sp++] = i - w)
      if (y < h - 1 && mask[i + w] && !labels[i + w]) (labels[i + w] = next), (stack[sp++] = i + w)
    }
    list.push(c)
  }
  list.sort((a, b) => b.area - a.area)
  return { labels, list }
}

/** Which canvas borders a mask touches. */
export function bordersTouched(mask: Uint8Array, w: number, h: number): { top: boolean; bottom: boolean; left: boolean; right: boolean; count: number } {
  let top = false
  let bottom = false
  let left = false
  let right = false
  for (let x = 0; x < w; x++) {
    if (mask[x]) top = true
    if (mask[(h - 1) * w + x]) bottom = true
  }
  for (let y = 0; y < h; y++) {
    if (mask[y * w]) left = true
    if (mask[y * w + w - 1]) right = true
  }
  return { top, bottom, left, right, count: [top, bottom, left, right].filter(Boolean).length }
}

/** Median of a numeric array (copy-sorted). */
export function median(values: ArrayLike<number>): number {
  const a = Array.from(values).sort((x, y) => x - y)
  if (!a.length) return 0
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/** Lab samples of the outer `band`-pixel frame of an image (RGB/RGBA raw). */
export function borderLabSamples(lab: Float32Array, w: number, h: number, band = 2): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const step = Math.max(1, Math.floor((w + h) / 600))
  const push = (x: number, y: number) => {
    const i = y * w + x
    out.push([lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]])
  }
  for (let b = 0; b < band; b++) {
    for (let x = 0; x < w; x += step) {
      push(x, b)
      push(x, h - 1 - b)
    }
    for (let y = 0; y < h; y += step) {
      push(b, y)
      push(w - 1 - b, y)
    }
  }
  return out
}

/** Median Lab color + fraction of border samples within `tol` ΔE of it (uniformity 0–1). */
export function borderBackground(lab: Float32Array, w: number, h: number, tol: number): { lab: [number, number, number]; uniformity: number; spread: number } {
  const samples = borderLabSamples(lab, w, h)
  const bg: [number, number, number] = [median(samples.map((s) => s[0])), median(samples.map((s) => s[1])), median(samples.map((s) => s[2]))]
  const d = samples.map((s) => deltaE3(s, bg)).sort((a, b) => a - b)
  const within = d.filter((v) => v <= tol).length
  return { lab: bg, uniformity: samples.length ? within / samples.length : 0, spread: d[Math.floor(d.length * 0.75)] ?? 0 }
}

// ---------------------------------------------------------------------------
// Float-plane helpers (harmonization + fidelity metric)
// ---------------------------------------------------------------------------

/** sRGB 0–255 → linear 0–1 (LUT). */
export function srgbToLinear(v: number): number {
  return SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(v)))]
}

const LIN_LUT_SIZE = 16384
const LIN_TO_SRGB = (() => {
  const t = new Float32Array(LIN_LUT_SIZE + 1)
  for (let i = 0; i <= LIN_LUT_SIZE; i++) {
    const x = i / LIN_LUT_SIZE
    t[i] = 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)
  }
  return t
})()

/** Linear 0–1 → sRGB 0–255 (float; out-of-range input is clamped). LUT with linear interpolation. */
export function linearToSrgb(v: number): number {
  const x = (v <= 0 ? 0 : v >= 1 ? 1 : v) * LIN_LUT_SIZE
  const i = x | 0
  if (i >= LIN_LUT_SIZE) return 255
  const f = x - i
  return LIN_TO_SRGB[i] + (LIN_TO_SRGB[i + 1] - LIN_TO_SRGB[i]) * f
}

/** One horizontal + vertical box blur pass of radius r (edge-clamped), in place via `tmp`. */
function boxPass(src: Float32Array, dst: Float32Array, tmp: Float32Array, w: number, h: number, r: number): void {
  if (r < 1) {
    dst.set(src)
    return
  }
  const norm = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
}

/** Gaussian-like blur (3 box passes) of a float plane; sigma in px. Returns a new plane. */
export function blurPlane(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const out = new Float32Array(src)
  if (sigma < 0.3) return out
  // Box radius for 3 passes ≈ sigma (variance of a box of width 2r+1 is ((2r+1)^2-1)/12).
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5))
  const tmp = new Float32Array(w * h)
  const a = new Float32Array(w * h)
  boxPass(out, a, tmp, w, h, r)
  boxPass(a, out, tmp, w, h, r)
  boxPass(out, a, tmp, w, h, r)
  return a
}

/**
 * Normalized convolution: blur of `src` using only pixels where `weight` > 0 (e.g. inside a mask),
 * so values never bleed in from outside. Where no weight reaches, returns `fallback`.
 */
export function maskedBlur(src: Float32Array, weight: Float32Array | Uint8Array, w: number, h: number, sigma: number, fallback = 0): Float32Array {
  const num = new Float32Array(w * h)
  const den = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    num[i] = src[i] * weight[i]
    den[i] = weight[i]
  }
  const bn = blurPlane(num, w, h, sigma)
  const bd = blurPlane(den, w, h, sigma)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = bd[i] > 1e-4 ? bn[i] / bd[i] : fallback
  return out
}

/** maskedBlur of several planes sharing one weight (the denominator is blurred once). */
export function maskedBlurMany(srcs: Float32Array[], weight: Float32Array | Uint8Array, w: number, h: number, sigma: number, fallback = 0): Float32Array[] {
  const den = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) den[i] = weight[i]
  const bd = blurPlane(den, w, h, sigma)
  return srcs.map((src) => {
    const num = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) num[i] = src[i] * weight[i]
    const bn = blurPlane(num, w, h, sigma)
    const out = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) out[i] = bd[i] > 1e-4 ? bn[i] / bd[i] : fallback
    return out
  })
}

/** Chamfer (3-4) distance in px from each inside pixel to the nearest outside pixel (0 outside). */
export function distanceInside(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      // Outside the canvas counts as outside the mask.
      if (x === 0 || y === 0) v = Math.min(v, 3)
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      if (x === w - 1 || y === h - 1) v = Math.min(v, 3)
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4)
      }
      d[i] = v
    }
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3
  return d
}

/** Deterministic PRNG (mulberry32) → standard normal samples (Box–Muller). */
export function gaussianRng(seed: number): () => number {
  let a = seed >>> 0
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const s = spare
      spare = null
      return s
    }
    const u = Math.max(1e-12, uni())
    const v = uni()
    const m = Math.sqrt(-2 * Math.log(u))
    spare = m * Math.sin(2 * Math.PI * v)
    return m * Math.cos(2 * Math.PI * v)
  }
}
