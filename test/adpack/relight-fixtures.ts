/**
 * Photo-like synthetic inputs for the relight / harmonization tests and QA (sharp only, seeded,
 * deterministic, no brands, no model calls): plates with a lit wall, a textured surface in
 * perspective, light falloff, depth-of-field blur, grain and JPEG; and products shaded like
 * studio photos (gradients, highlights, grain) on a white sweep.
 */
import sharp from 'sharp'

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gray noise plane (raw, 1 channel) of size w×h, blurred to `sigma`, scaled to ±amp around 128. */
async function noisePlane(w: number, h: number, seed: number, sigma: number, amp: number, stretchX = 1): Promise<Buffer> {
  const r = rng(seed)
  const sw = Math.max(2, Math.round(w / stretchX))
  const data = Buffer.alloc(sw * h)
  for (let i = 0; i < data.length; i++) data[i] = Math.round(128 + (r() - 0.5) * 2 * 100)
  let img = sharp(data, { raw: { width: sw, height: h, channels: 1 } })
  if (stretchX !== 1) img = sharp(await img.resize(w, h, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer(), { raw: { width: w, height: h, channels: 1 } })
  const blurred = sigma >= 0.3 ? await img.blur(sigma).raw().toBuffer() : await img.raw().toBuffer()
  // Re-normalize contrast to ±amp.
  let mn = 255
  let mx = 0
  for (const v of blurred) {
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const out = Buffer.alloc(w * h)
  for (let i = 0; i < w * h; i++) out[i] = Math.max(0, Math.min(255, Math.round(128 + ((blurred[i] - (mn + mx) / 2) / Math.max(1, (mx - mn) / 2)) * amp)))
  return out
}

export interface PlateSpec {
  name: string
  wallTop: string
  wallBottom: string
  surfaceNear: string
  surfaceFar: string
  /** Light comes from this side (bright falloff on the wall, darker opposite side). */
  light: 'left' | 'right' | 'top'
  /** Light color (wall hot spot). */
  lightColor: string
  /** 0–1 strength of the hot spot. */
  lightStrength: number
  /** Surface texture: wood grain / concrete speckle / smooth. */
  texture: 'wood' | 'concrete' | 'smooth'
  glossy?: boolean
  /** Grain σ in 8-bit levels. */
  grain: number
  /** Wall defocus σ (px). */
  wallBlur: number
  /** Horizon (surface top) as a fraction of the height. */
  horizon?: number
  seed?: number
}

export const PLATES: PlateSpec[] = [
  { name: 'warm-wood', wallTop: '#e9d8c0', wallBottom: '#cdb08c', surfaceNear: '#8a5a33', surfaceFar: '#a8744a', light: 'left', lightColor: '#ffd7a0', lightStrength: 0.55, texture: 'wood', grain: 3, wallBlur: 3, seed: 11 },
  { name: 'cool-concrete', wallTop: '#aab6c2', wallBottom: '#8a97a5', surfaceNear: '#7d848b', surfaceFar: '#9aa1a8', light: 'right', lightColor: '#d8e8ff', lightStrength: 0.45, texture: 'concrete', grain: 4, wallBlur: 2.5, seed: 23 },
  { name: 'dark-navy', wallTop: '#1d2a4a', wallBottom: '#121a30', surfaceNear: '#4a2d18', surfaceFar: '#6b4426', light: 'left', lightColor: '#ffcf8a', lightStrength: 0.6, texture: 'wood', grain: 5, wallBlur: 3.5, seed: 37 },
  { name: 'bright-studio', wallTop: '#f7f6f3', wallBottom: '#ecebe7', surfaceNear: '#e2e0db', surfaceFar: '#efede9', light: 'right', lightColor: '#ffffff', lightStrength: 0.3, texture: 'smooth', glossy: true, grain: 1.5, wallBlur: 1.5, seed: 41 },
  { name: 'pastel-pink', wallTop: '#f3c9cf', wallBottom: '#e6aab4', surfaceNear: '#d99aa5', surfaceFar: '#eab4bd', light: 'top', lightColor: '#fff4ec', lightStrength: 0.35, texture: 'smooth', grain: 2, wallBlur: 2, seed: 53 },
]

export async function realisticPlate(spec: PlateSpec, W = 1080, H = 1350): Promise<Buffer> {
  const horizon = Math.round(H * (spec.horizon ?? 0.6))
  const lx = spec.light === 'left' ? 0.12 : spec.light === 'right' ? 0.88 : 0.5
  const wall =
    '<defs>' +
    `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${spec.wallTop}"/><stop offset="1" stop-color="${spec.wallBottom}"/></linearGradient>` +
    `<radialGradient id="hot" cx="${lx}" cy="0.25" r="0.85"><stop offset="0" stop-color="${spec.lightColor}" stop-opacity="${spec.lightStrength}"/><stop offset="0.6" stop-color="${spec.lightColor}" stop-opacity="${spec.lightStrength * 0.25}"/><stop offset="1" stop-color="${spec.lightColor}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="side" x1="${spec.light === 'right' ? 1 : 0}" y1="0" x2="${spec.light === 'right' ? 0 : 1}" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${spec.light === 'top' ? 0.05 : 0.28}"/></linearGradient>` +
    '</defs>' +
    `<rect width="${W}" height="${H}" fill="url(#wall)"/><rect width="${W}" height="${H}" fill="url(#hot)"/><rect width="${W}" height="${H}" fill="url(#side)"/>`
  let wallPng = await sharp(svg(W, H, wall)).png().toBuffer()
  // Plaster texture on the wall (low frequency), then depth-of-field blur.
  const plaster = await noisePlane(W, H, (spec.seed ?? 1) * 3, 6, 10)
  wallPng = await overlayGray(wallPng, plaster, 0.5)
  wallPng = await sharp(wallPng).blur(Math.max(0.3, spec.wallBlur)).png().toBuffer()

  // Surface in perspective: far → near gradient, key-light falloff, texture.
  const surfH = H - horizon
  const surf =
    '<defs>' +
    `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${spec.surfaceFar}"/><stop offset="1" stop-color="${spec.surfaceNear}"/></linearGradient>` +
    `<linearGradient id="sl" x1="${spec.light === 'right' ? 1 : 0}" y1="0" x2="${spec.light === 'right' ? 0 : 1}" y2="0"><stop offset="0" stop-color="${spec.lightColor}" stop-opacity="${spec.light === 'top' ? 0.1 : 0.25}"/><stop offset="1" stop-color="#000" stop-opacity="${spec.light === 'top' ? 0.05 : 0.22}"/></linearGradient>` +
    (spec.glossy ? `<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.25" stop-color="#fff" stop-opacity="0"/></linearGradient>` : '') +
    '</defs>' +
    `<rect width="${W}" height="${surfH}" fill="url(#s)"/><rect width="${W}" height="${surfH}" fill="url(#sl)"/>` +
    (spec.glossy ? `<rect width="${W}" height="${surfH}" fill="url(#sheen)"/>` : '') +
    `<rect width="${W}" height="3" fill="#000" fill-opacity="0.18"/>`
  let surfPng = await sharp(svg(W, surfH, surf)).png().toBuffer()
  if (spec.texture === 'wood') surfPng = await overlayGray(surfPng, await noisePlane(W, surfH, (spec.seed ?? 1) * 5, 0.8, 26, 40), 0.85)
  if (spec.texture === 'concrete') surfPng = await overlayGray(surfPng, await noisePlane(W, surfH, (spec.seed ?? 1) * 7, 1.2, 18), 0.8)
  // Far part of the surface slightly out of focus.
  const far = await sharp(surfPng).extract({ left: 0, top: 0, width: W, height: Math.round(surfH * 0.3) }).blur(1.6).png().toBuffer()
  surfPng = await sharp(surfPng).composite([{ input: far, left: 0, top: 0 }]).png().toBuffer()
  let plate = await sharp(wallPng).composite([{ input: surfPng, left: 0, top: horizon }]).removeAlpha().png().toBuffer()
  // Vignette + sensor grain + JPEG, like a real photo.
  const vig = `<defs><radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/>`
  plate = await sharp(plate).composite([{ input: svg(W, H, vig) }]).png().toBuffer()
  plate = await addGrain(plate, spec.grain, (spec.seed ?? 1) * 13)
  return sharp(plate).jpeg({ quality: 86 }).toBuffer()
}

/** Soft-light-ish overlay of a gray texture (128 = no change) onto an RGB image. */
async function overlayGray(rgbPng: Buffer, grayRaw: Buffer, strength: number): Promise<Buffer> {
  const { data, info } = await sharp(rgbPng).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < info.width * info.height; i++) {
    const t = ((grayRaw[i] - 128) / 128) * strength
    for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.max(0, Math.min(255, Math.round(data[i * 3 + c] * (1 + t * 0.5))))
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()
}

export async function addGrain(png: Buffer, sigma: number, seed: number): Promise<Buffer> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const r = rng(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r())
  for (let i = 0; i < info.width * info.height; i++) {
    const n = gauss() * sigma
    for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.max(0, Math.min(255, Math.round(data[i * 3 + c] + n + gauss() * sigma * 0.3)))
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()
}

/** A studio-shot ceramic mug (cylinder shading, rim, handle, label) on a white sweep, JPEG. */
export async function mugPhoto(): Promise<Buffer> {
  const body =
    '<defs>' +
    '<linearGradient id="cyl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1b5e57"/><stop offset="0.28" stop-color="#2f8f84"/><stop offset="0.42" stop-color="#5fb8ab"/><stop offset="0.55" stop-color="#2f8f84"/><stop offset="1" stop-color="#123f3a"/></linearGradient>' +
    '<linearGradient id="lab" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c9b48a"/><stop offset="0.42" stop-color="#f4e6c4"/><stop offset="1" stop-color="#9c875e"/></linearGradient>' +
    '<radialGradient id="in" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0d2e2a"/><stop offset="1" stop-color="#1f6b62"/></radialGradient>' +
    '</defs>' +
    '<rect width="700" height="800" fill="#f6f5f2"/>' +
    // Solid handle lug (a see-through handle hole would keep the backdrop inside the cut-out).
    '<path d="M470 300 C 600 300, 600 520, 470 520 Z" fill="#1f6f66"/>' +
    '<path d="M470 340 C 545 345, 545 475, 470 480 Z" fill="#164f49"/>' +
    '<rect x="150" y="210" width="330" height="420" fill="url(#cyl)"/>' +
    '<ellipse cx="315" cy="630" rx="165" ry="34" fill="url(#cyl)"/>' +
    '<ellipse cx="315" cy="210" rx="165" ry="34" fill="#2a8378"/>' +
    '<ellipse cx="315" cy="212" rx="150" ry="27" fill="url(#in)"/>' +
    '<rect x="150" y="360" width="330" height="120" fill="url(#lab)"/>' +
    '<rect x="190" y="392" width="170" height="16" fill="#5a3b1a"/><rect x="190" y="420" width="120" height="10" fill="#5a3b1a"/><circle cx="420" cy="420" r="26" fill="#b6452c"/>' +
    '<rect x="215" y="230" width="14" height="380" fill="#ffffff" fill-opacity="0.35"/>'
  const flat = await sharp(svg(700, 800, body)).png().toBuffer()
  return sharp(await addGrain(flat, 2, 99)).jpeg({ quality: 92 }).toBuffer()
}

/** A small RC-plane-like toy: white folded paper wing, black chassis, wheels, white propellers. */
export async function planePhoto(): Promise<Buffer> {
  const body =
    '<defs>' +
    '<linearGradient id="wingL" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcdcdc"/></linearGradient>' +
    '<linearGradient id="wingR" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f2f2"/><stop offset="1" stop-color="#c9c9c9"/></linearGradient>' +
    '<linearGradient id="ch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3e"/><stop offset="1" stop-color="#121214"/></linearGradient>' +
    '</defs>' +
    // Light gray-blue sweep so the white wing separates from the backdrop.
    '<rect width="900" height="700" fill="#9db2c7"/>' +
    '<polygon points="450,180 110,420 450,380" fill="url(#wingL)"/>' +
    '<polygon points="450,180 790,420 450,380" fill="url(#wingR)"/>' +
    '<line x1="450" y1="180" x2="450" y2="380" stroke="#b9b9b9" stroke-width="4"/>' +
    '<rect x="380" y="360" width="140" height="80" rx="14" fill="url(#ch)"/>' +
    '<rect x="400" y="378" width="40" height="10" fill="#e23b3b"/>' +
    '<circle cx="395" cy="470" r="30" fill="#151515"/><circle cx="395" cy="470" r="12" fill="#8b8b8b"/>' +
    '<circle cx="505" cy="470" r="30" fill="#151515"/><circle cx="505" cy="470" r="12" fill="#8b8b8b"/>' +
    '<ellipse cx="250" cy="330" rx="70" ry="12" fill="#fafafa" stroke="#bdbdbd" stroke-width="2"/>' +
    '<ellipse cx="650" cy="330" rx="70" ry="12" fill="#fafafa" stroke="#bdbdbd" stroke-width="2"/>' +
    '<circle cx="250" cy="330" r="8" fill="#222"/><circle cx="650" cy="330" r="8" fill="#222"/>'
  const flat = await sharp(svg(900, 700, body)).png().toBuffer()
  return sharp(await addGrain(flat, 1.5, 7)).jpeg({ quality: 92 }).toBuffer()
}
