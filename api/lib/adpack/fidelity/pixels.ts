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
