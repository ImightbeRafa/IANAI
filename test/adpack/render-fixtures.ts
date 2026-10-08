/**
 * Synthetic, text-free fixtures for the Ad Pack renderer (tests + scripts/adpack-render-samples.ts).
 * Everything is generated with sharp; no network, no model calls.
 */
import sharp from 'sharp'
import type { AdCopy, DnaVisual } from '../../api/lib/adpack/types'

export const SAMPLE_COPY: Pick<AdCopy, 'headline' | 'subline' | 'bullets' | 'offerLine' | 'cta'> = {
  headline: '¿Cansada de la piel seca?',
  subline: 'Crema de aguacate y caña, hecha en Costa Rica',
  bullets: ['Hidratación 24 h', 'Sin parabenos', 'Fórmula suave', 'Envío en 48 h'],
  offerLine: '₡9.900 · Envío gratis desde 2',
  cta: '¡Pedí la tuya!',
}

export const SAMPLE_VISUAL: DnaVisual = {
  primaryColor: '#0F5132',
  secondaryColor: '#14532d',
  accentColor: '#F4B400',
  headingFont: 'Montserrat',
  bodyFont: 'Montserrat',
}

/** Soft studio-like scene: vertical gradient + blurred "bokeh" blobs. */
export async function makeScene(w = 1200, h = 1500, tone: 'light' | 'dark' | 'warm' = 'warm'): Promise<Buffer> {
  const palettes = {
    light: ['#f8fafc', '#e2e8f0', '#cbd5e1'],
    dark: ['#0f172a', '#1e293b', '#334155'],
    warm: ['#fde68a', '#f59e0b', '#7c2d12'],
  }
  const [a, b, c] = palettes[tone]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>
      <filter id="bl"><feGaussianBlur stdDeviation="40"/></filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <g filter="url(#bl)" opacity="0.55">
      <circle cx="${w * 0.78}" cy="${h * 0.3}" r="${w * 0.18}" fill="#ffffff"/>
      <circle cx="${w * 0.2}" cy="${h * 0.75}" r="${w * 0.22}" fill="${c}"/>
      <circle cx="${w * 0.65}" cy="${h * 0.85}" r="${w * 0.12}" fill="${a}"/>
    </g>
    <ellipse cx="${w * 0.5}" cy="${h * 0.92}" rx="${w * 0.6}" ry="${h * 0.12}" fill="#000" opacity="0.18"/>
  </svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()
}

/** Busy high-contrast scene (checkerboard + noise) to force the contrast guard. */
export async function makeBusyScene(w = 1080, h = 1920): Promise<Buffer> {
  const cell = 48
  let rects = ''
  for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) if (((x + y) / cell) % 2 === 0) rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="#fff"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#e11d48"/>${rects}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export async function makeSolidScene(color: string, w = 1080, h = 1080): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer()
}

/** Transparent product cut-out (a jar with label band, no text). */
export async function makeProductCutout(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="760">
    <defs>
      <linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d1fae5"/><stop offset="0.45" stop-color="#ffffff"/><stop offset="1" stop-color="#a7f3d0"/></linearGradient>
      <linearGradient id="c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#065f46"/><stop offset="0.5" stop-color="#10b981"/><stop offset="1" stop-color="#064e3b"/></linearGradient>
    </defs>
    <rect x="110" y="40" width="380" height="150" rx="36" fill="url(#c)"/>
    <rect x="70" y="170" width="460" height="560" rx="90" fill="url(#b)"/>
    <rect x="70" y="360" width="460" height="190" fill="#0f5132" opacity="0.92"/>
    <circle cx="300" cy="455" r="58" fill="#f4b400"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Simple brand mark as SVG (exercise the SVG logo path). */
export function makeLogoSvg(): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="80" viewBox="0 0 260 80">
    <circle cx="40" cy="40" r="34" fill="#0f5132"/><path d="M24 44 C34 18, 52 18, 58 30 C50 32, 40 40, 36 56 Z" fill="#f4b400"/>
    <rect x="88" y="22" width="150" height="14" rx="7" fill="#0f5132"/><rect x="88" y="46" width="110" height="12" rx="6" fill="#14532d" opacity="0.7"/>
  </svg>`)
}
