/**
 * Round 9: free, local detector of thin saturated structures (a USB cable the model added next to the product). The colour-novelty check
 * (extra-objects.ts) missed the blue cable of round 8 post B because blue was "explained" by the box art. A cable is recognised by SHAPE:
 * a connected component of pixels clearly more saturated than (or of another hue than) the blurred background that is THIN (< 12 % of its pixels
 * survive a 2 px erosion), at least 8 % of the width long and ≥ 0.4 % of the picture. Heuristic, warning only. Whole extra products (a duplicate / redrawn product)
 * are found by feature match of the real product photo (extra-objects.findUnlistedObjects), not here.
 */
import sharp from 'sharp'
import { labImage } from '../adpack/fidelity/pixels.js'

export type SceneBlob = { box: { x0: number; y0: number; x1: number; y1: number }; area: number; touchesSide: boolean; thin?: boolean }
export type SceneObjectsReport = { cables: SceneBlob[] }

const WS = 400

function components(mask: Uint8Array, w: number, h: number): Array<{ x0: number; y0: number; x1: number; y1: number; n: number; idx: number[] }> {
  const seen = new Uint8Array(w * h)
  const out: Array<{ x0: number; y0: number; x1: number; y1: number; n: number; idx: number[] }> = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue
    const c = { x0: w, y0: h, x1: 0, y1: 0, n: 0, idx: [] as number[] }
    stack.push(s); seen[s] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w, y = (i / w) | 0
      c.n++; c.idx.push(i)
      if (x < c.x0) c.x0 = x
      if (x > c.x1) c.x1 = x
      if (y < c.y0) c.y0 = y
      if (y > c.y1) c.y1 = y
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1) }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1) }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w) }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w) }
    }
    out.push(c)
  }
  return out
}

function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const o = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) o[yy * w + xx] = 1 }
  }
  return o
}

export async function findThinStructures(bytes: Buffer, opts: { /** fraction of the height ignored at the top (header text / logo band in a picture that has them). */ ignoreTop?: number; ignoreBottom?: number } = {}): Promise<SceneObjectsReport> {
  const img = sharp(bytes).rotate().flatten({ background: '#ffffff' }).removeAlpha().resize({ width: WS })
  const { data, info } = await img.clone().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height
  const bg = await img.clone().blur(14).raw().toBuffer()
  const lab = labImage(data, 3, w * h)
  const labBg = labImage(bg, 3, w * h)
  const top = Math.round(h * (opts.ignoreTop ?? 0.1))
  const bottom = Math.round(h * (1 - (opts.ignoreBottom ?? 0.02)))
  const sat = new Uint8Array(w * h)
  for (let y = Math.max(1, top); y < Math.min(h - 1, bottom); y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const chroma = Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2])
    const chromaBg = Math.hypot(labBg[i * 3 + 1], labBg[i * 3 + 2])
    const hue = Math.atan2(lab[i * 3 + 2], lab[i * 3 + 1]), hueBg = Math.atan2(labBg[i * 3 + 2], labBg[i * 3 + 1])
    let dh = Math.abs(hue - hueBg); if (dh > Math.PI) dh = 2 * Math.PI - dh
    if (chroma > 30 && (chroma > chromaBg + 14 || (chromaBg > 8 && dh > Math.PI / 3)) && lab[i * 3] > 15 && lab[i * 3] < 92) sat[i] = 1
  }
  const N = w * h
  // thinness: share of a component's pixels that survive an erosion of 2 px (a 3–5 px wide cable vanishes, a printed panel / object face survives)
  const inv = new Uint8Array(N)
  for (let i = 0; i < N; i++) inv[i] = sat[i] ? 0 : 1
  const grown = dilate(inv, w, h, 2)
  const cables: SceneBlob[] = []
  for (const c of components(dilate(sat, w, h, 1), w, h)) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1
    let n = 0, survive = 0
    for (const i of c.idx) if (sat[i]) { n++; if (!grown[i]) survive++ }
    // share of a 4:5 frame of this width (independent of the crop height)
    const area = n / (w * w * 1.25)
    if (area < 0.0008 || Math.max(bw, bh) < w * 0.08) continue
    const thin = survive / Math.max(1, n)
    // ≥ 0.4 % of the picture: wood grain / printed strokes / pouch seams stay well below (≤ 0.26 % on the round-8 posts; the round-8 cable was 0.83 %)
    if (thin < 0.12 && area >= 0.004) cables.push({ box: { x0: c.x0 / w, y0: c.y0 / h, x1: (c.x1 + 1) / w, y1: (c.y1 + 1) / h }, area: Math.round(area * 10000) / 10000, touchesSide: c.x0 <= 1 || c.x1 >= w - 2, thin: true })
  }
  return { cables }
}
