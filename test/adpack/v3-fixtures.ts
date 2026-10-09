/**
 * Synthetic fixtures for the v3 real-test fixes (P0 #3/#4, P1 #6/#7). No real brands or photos.
 */
import sharp from 'sharp'

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)

/** Light warm surface with a soft vignette (a real top-down table shot is never perfectly flat). */
const lightSurface = (w: number, h: number) =>
  `<defs><radialGradient id="vg" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#ecebe6"/><stop offset="1" stop-color="#dedcd5"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#vg)"/>`

/**
 * Top-down kit flat lay on a light surface: a colored "airframe", a dark controller, a WHITE tape
 * roll and two WHITE screws (the pieces the report says were lost), each separated.
 */
export async function flatLayWithWhitePieces(): Promise<Buffer> {
  const body =
    lightSurface(1200, 900) +
    // airframe (blue wing + fuselage)
    '<rect x="140" y="170" width="520" height="90" rx="40" fill="#2563eb"/><rect x="360" y="90" width="80" height="420" rx="30" fill="#1d4ed8"/>' +
    // dark controller
    '<rect x="760" y="140" width="300" height="170" rx="70" fill="#1f2937"/><circle cx="840" cy="225" r="26" fill="#374151"/><circle cx="980" cy="225" r="26" fill="#374151"/>' +
    // white tape roll (ring)
    '<circle cx="300" cy="660" r="105" fill="#fbfbfa"/><circle cx="300" cy="660" r="48" fill="#e6e4de"/>' +
    // two white screws
    '<rect x="700" y="600" width="20" height="120" rx="6" fill="#f8f8f6"/><circle cx="710" cy="595" r="22" fill="#fafaf8"/>' +
    '<rect x="860" y="640" width="20" height="120" rx="6" fill="#f8f8f6"/><circle cx="870" cy="635" r="22" fill="#fafaf8"/>'
  return sharp(svg(1200, 900, body)).jpeg({ quality: 93 }).toBuffer()
}

/** Pieces of the flat lay by center (for per-piece assertions), in source pixels. */
export const FLAT_LAY_PIECES = {
  airframe: [400, 215],
  controller: [910, 225],
  tape: [300, 590],
  screw1: [710, 660],
  screw2: [870, 700],
} as const

/** Single dark product with a WHITE cap lying next to it on a light surface (2 objects → not a flat lay). */
export async function productWithWhiteCap(): Promise<Buffer> {
  const body =
    lightSurface(900, 1100) +
    '<rect x="300" y="250" width="260" height="600" rx="50" fill="#111827"/>' +
    '<rect x="585" y="680" width="180" height="180" rx="30" fill="#fbfbfa"/>'
  return sharp(svg(900, 1100, body)).jpeg({ quality: 93 }).toBuffer()
}

/** Matte black, low-texture product (gamepad-like) on a light studio background. */
export async function matteBlackProduct(): Promise<Buffer> {
  const body =
    '<rect width="900" height="700" fill="#f3f2ee"/>' +
    '<rect x="150" y="200" width="600" height="300" rx="140" fill="#141414"/>' +
    '<circle cx="300" cy="350" r="48" fill="#1b1b1b"/><circle cx="600" cy="320" r="18" fill="#202020"/><circle cx="640" cy="360" r="18" fill="#202020"/>' +
    '<rect x="420" y="300" width="60" height="16" rx="6" fill="#262626"/>'
  return sharp(svg(900, 700, body)).jpeg({ quality: 94 }).toBuffer()
}

/** Wall + tabletop plate whose table edge (horizon) sits at `edgeY` (fraction of the height). */
export async function wallTablePlate(w: number, h: number, edgeY: number): Promise<Buffer> {
  const y = Math.round(edgeY * h)
  const body =
    `<rect width="${w}" height="${h}" fill="#c9b8a3"/>` +
    `<rect x="0" y="${y}" width="${w}" height="${h - y}" fill="#8a6a4c"/>` +
    `<rect x="0" y="${y}" width="${w}" height="6" fill="#6e5238"/>`
  return sharp(svg(w, h, body)).png().toBuffer()
}

/** Flat surface texture for an overhead plate (no horizon). */
export async function overheadPlate(w: number, h: number): Promise<Buffer> {
  return sharp(svg(w, h, `<rect width="${w}" height="${h}" fill="#d9d2c5"/><rect x="0" y="0" width="${w}" height="${h}" fill="#cfc6b6" opacity="0.25"/>`)).png().toBuffer()
}
