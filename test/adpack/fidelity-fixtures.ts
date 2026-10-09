/**
 * Synthetic images for the product-fidelity tests (sharp-generated, deterministic, no brands).
 */
import sharp from 'sharp'

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)

/** A detailed "bottle" product (cap, body, label band, stripes, dots): enough structure for SSIM. */
export function productSvgBody(ox = 0, oy = 0): string {
  return (
    `<g transform="translate(${ox},${oy})">` +
    '<rect x="210" y="110" width="180" height="90" rx="18" fill="#1f2937"/>' +
    '<rect x="228" y="122" width="144" height="12" fill="#4b5563"/>' +
    '<rect x="170" y="190" width="260" height="500" rx="44" fill="#0f766e"/>' +
    '<rect x="170" y="370" width="260" height="140" fill="#f59e0b"/>' +
    '<rect x="196" y="392" width="208" height="14" fill="#7c2d12"/>' +
    '<rect x="196" y="420" width="150" height="10" fill="#7c2d12"/>' +
    '<rect x="196" y="442" width="180" height="10" fill="#7c2d12"/>' +
    '<circle cx="300" cy="285" r="46" fill="#e0f2f1"/><circle cx="300" cy="285" r="22" fill="#0f766e"/>' +
    '<rect x="196" y="560" width="30" height="100" rx="12" fill="#14b8a6"/>' +
    '</g>'
  )
}

/** Studio photo: product on a clean white background (JPEG, like a phone/studio shot). */
export async function productOnWhite(): Promise<Buffer> {
  return sharp(svg(600, 800, `<rect width="600" height="800" fill="#fbfbfa"/>${productSvgBody()}`)).jpeg({ quality: 94 }).toBuffer()
}

/** Same product on a colored seamless backdrop with a soft vertical gradient. */
export async function productOnColor(): Promise<Buffer> {
  const bg = '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4d6dc"/><stop offset="1" stop-color="#ecc6ce"/></linearGradient></defs><rect width="600" height="800" fill="url(#g)"/>'
  return sharp(svg(600, 800, bg + productSvgBody())).jpeg({ quality: 94 }).toBuffer()
}

/** Product already cut out (transparent PNG). */
export async function productAlphaPng(): Promise<Buffer> {
  return sharp(svg(600, 800, productSvgBody())).png().toBuffer()
}

/** A "part": a gamepad-style controller on light gray (H3 multi-part). */
export async function partOnGray(): Promise<Buffer> {
  const body =
    '<rect width="640" height="420" fill="#eeeeee"/>' +
    '<rect x="120" y="120" width="400" height="180" rx="90" fill="#111827"/>' +
    '<rect x="190" y="185" width="60" height="18" fill="#f9fafb"/><rect x="211" y="164" width="18" height="60" fill="#f9fafb"/>' +
    '<circle cx="430" cy="175" r="16" fill="#ef4444"/><circle cx="465" cy="210" r="16" fill="#22c55e"/>'
  return sharp(svg(640, 420, body)).jpeg({ quality: 94 }).toBuffer()
}

/** Busy photo (noise everywhere): no clean background → the deterministic strategies fail. */
export async function busyPhoto(w = 480, h = 640): Promise<Buffer> {
  const data = Buffer.alloc(w * h * 3)
  let seed = 12345
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    data[i] = seed % 256
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
}

/** Busy scene of large random color blocks (cluttered background, at any resolution). */
export async function busyBlocks(w = 1200, h = 1600): Promise<Buffer> {
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000
  const cell = 80
  let body = ''
  for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="rgb(${Math.round(rnd() * 255)},${Math.round(rnd() * 255)},${Math.round(rnd() * 255)})"/>`
  return sharp(svg(w, h, body)).jpeg({ quality: 90 }).toBuffer()
}

/** Background plate: navy wall, wooden table, warm side light (no product). */
export async function syntheticPlate(w = 1080, h = 1920): Promise<Buffer> {
  const tableY = Math.round(h * 0.62)
  const body =
    '<defs>' +
    '<linearGradient id="wall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b3a67"/><stop offset="1" stop-color="#14203f"/></linearGradient>' +
    '<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a26b3e"/><stop offset="1" stop-color="#6e4424"/></linearGradient>' +
    '<radialGradient id="light" cx="0.15" cy="0.2" r="0.8"><stop offset="0" stop-color="#ffd9a0" stop-opacity="0.35"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>' +
    '</defs>' +
    `<rect width="${w}" height="${h}" fill="url(#wall)"/>` +
    `<rect y="${tableY}" width="${w}" height="${h - tableY}" fill="url(#wood)"/>` +
    Array.from({ length: 9 }, (_, i) => `<rect y="${tableY + 30 + i * 70}" width="${w}" height="3" fill="#5a361c" opacity="0.35"/>`).join('') +
    `<ellipse cx="${w * 0.12}" cy="${tableY - 90}" rx="70" ry="110" fill="#2f6b4f" opacity="0.9"/>` +
    `<rect width="${w}" height="${h}" fill="url(#light)"/>`
  return sharp(svg(w, h, body)).jpeg({ quality: 92 }).toBuffer()
}

/** A plate at Grok's 3:4 (used for 4:5 requests). */
export const syntheticPlate34 = () => syntheticPlate(900, 1200)

/** Logo: dark wordmark-ish shapes on an opaque WHITE square (the C5 bug). */
export async function whiteSquareLogoJpeg(): Promise<Buffer> {
  const body =
    '<rect width="400" height="400" fill="#ffffff"/>' +
    '<circle cx="200" cy="150" r="70" fill="#1e3a8a"/>' +
    '<rect x="90" y="250" width="220" height="34" rx="8" fill="#1e3a8a"/>' +
    '<rect x="120" y="300" width="160" height="20" rx="6" fill="#f97316"/>'
  return sharp(svg(400, 400, body)).jpeg({ quality: 90 }).toBuffer()
}

/** Dark logo with real transparency. */
export async function darkLogoPng(): Promise<Buffer> {
  const body = '<circle cx="120" cy="120" r="90" fill="#111827"/><rect x="60" y="230" width="120" height="30" fill="#1f2937"/>'
  return sharp(svg(240, 280, body)).png().toBuffer()
}

export const logoSvg = () =>
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect x="10" y="20" width="80" height="80" rx="20" fill="#0f766e"/><rect x="110" y="45" width="170" height="30" rx="6" fill="#0f766e"/></svg>')

/** Uniform dark scene. */
export async function darkScene(w = 1080, h = 1920): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#101418' } }).png().toBuffer()
}

export const dataUrl = (b: Buffer, mime = 'image/png') => `data:${mime};base64,${b.toString('base64')}`
