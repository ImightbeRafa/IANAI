/**
 * Bundled fonts for the Ad Pack renderer (OFL, see fonts/*-OFL.txt).
 *
 * Fonts are read from disk next to this module (`./fonts/*.ttf`). Each file is
 * referenced with a literal `new URL('./fonts/…', import.meta.url)` so bundlers /
 * file tracers (Vercel nft) pick them up. `ADPACK_FONTS_DIR` overrides the folder
 * (e.g. a Cloudflare container that copies the fonts somewhere else).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import type { DnaVisual } from '../types.js'

export type FamilyName = 'Poppins' | 'Fira Sans' | 'Archivo Black' | 'Anton' | 'DM Serif Display'

interface FontFile {
  family: FamilyName
  weight: 400 | 700 | 800
  file: string
  url: URL
}

const FONT_FILES: FontFile[] = [
  { family: 'Poppins', weight: 400, file: 'Poppins-Regular.ttf', url: new URL('./fonts/Poppins-Regular.ttf', import.meta.url) },
  { family: 'Poppins', weight: 700, file: 'Poppins-Bold.ttf', url: new URL('./fonts/Poppins-Bold.ttf', import.meta.url) },
  { family: 'Poppins', weight: 800, file: 'Poppins-ExtraBold.ttf', url: new URL('./fonts/Poppins-ExtraBold.ttf', import.meta.url) },
  { family: 'Fira Sans', weight: 400, file: 'FiraSans-Regular.ttf', url: new URL('./fonts/FiraSans-Regular.ttf', import.meta.url) },
  { family: 'Fira Sans', weight: 700, file: 'FiraSans-Bold.ttf', url: new URL('./fonts/FiraSans-Bold.ttf', import.meta.url) },
  { family: 'Fira Sans', weight: 800, file: 'FiraSans-ExtraBold.ttf', url: new URL('./fonts/FiraSans-ExtraBold.ttf', import.meta.url) },
  { family: 'Archivo Black', weight: 400, file: 'ArchivoBlack-Regular.ttf', url: new URL('./fonts/ArchivoBlack-Regular.ttf', import.meta.url) },
  { family: 'Anton', weight: 400, file: 'Anton-Regular.ttf', url: new URL('./fonts/Anton-Regular.ttf', import.meta.url) },
  { family: 'DM Serif Display', weight: 400, file: 'DMSerifDisplay-Regular.ttf', url: new URL('./fonts/DMSerifDisplay-Regular.ttf', import.meta.url) },
]

/** Fira Sans covers ₡ and other glyphs missing from the display faces; it is always the fallback. */
const FALLBACK_FAMILY: FamilyName = 'Fira Sans'

export interface FontRef {
  family: FamilyName
  weight: number
}

export interface ResolvedFonts {
  /** Headline / offer face. */
  heading: FontRef
  /** Body face (sublines, chips, CTA). Always a multi-weight sans. */
  body: FontRef & { boldWeight: number }
  /** How each brand font name was matched. */
  match: { heading: 'mapped' | 'default'; body: 'mapped' | 'default' }
}

interface LoadedFont {
  family: FamilyName
  weight: number
  data: Buffer
  font: opentype.Font
}

let loaded: LoadedFont[] | null = null

function fontPath(f: FontFile): string {
  const dir = process.env.ADPACK_FONTS_DIR
  if (dir) return join(dir, f.file)
  return fileURLToPath(f.url)
}

export function loadFonts(): LoadedFont[] {
  if (loaded) return loaded
  loaded = FONT_FILES.map((f) => {
    const data = readFileSync(fontPath(f))
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    return { family: f.family, weight: f.weight, data, font: opentype.parse(ab) }
  })
  return loaded
}

/** Font list in satori's expected shape. */
export function satoriFonts(): Array<{ name: string; data: Buffer; weight: 400 | 700 | 800; style: 'normal' }> {
  return loadFonts().map((f) => ({ name: f.family, data: f.data, weight: f.weight as 400 | 700 | 800, style: 'normal' as const }))
}

/** CSS font-family value with the glyph fallback appended. */
export function cssFamily(family: FamilyName): string {
  return family === FALLBACK_FAMILY ? `'${family}'` : `'${family}', '${FALLBACK_FAMILY}'`
}

function closestWeight(family: FamilyName, weight: number): LoadedFont {
  const list = loadFonts().filter((f) => f.family === family)
  return list.reduce((best, f) => (Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best), list[0])
}

/** Fonts tried per glyph, in the same order satori uses (requested family, then fallback). */
export function fontChain(ref: FontRef): opentype.Font[] {
  const chain = [closestWeight(ref.family, ref.weight).font]
  if (ref.family !== FALLBACK_FAMILY) chain.push(closestWeight(FALLBACK_FAMILY, ref.weight).font)
  return chain
}

const widthCache = new Map<string, number>()

/** Advance width (px) of a single-line string, with kerning and per-glyph fallback. */
export function measureText(text: string, ref: FontRef, fontSize: number): number {
  const key = `${ref.family}|${ref.weight}|${text}`
  let unit = widthCache.get(key)
  if (unit === undefined) {
    const chain = fontChain(ref)
    unit = 0
    let run = ''
    let runFont = chain[0]
    const flush = () => {
      if (run) unit! += runFont.getAdvanceWidth(run, 1000, { kerning: true })
      run = ''
    }
    for (const ch of Array.from(text)) {
      const f = /\s/.test(ch) ? runFont : chain.find((c) => c.charToGlyphIndex(ch) > 0) ?? chain[0]
      if (f !== runFont) {
        flush()
        runFont = f
      }
      run += ch
    }
    flush()
    if (widthCache.size > 20000) widthCache.clear()
    widthCache.set(key, unit)
  }
  return (unit * fontSize) / 1000
}

/** True when every non-space char has a glyph in the chain (used by tests / QA). */
export function hasAllGlyphs(text: string, ref: FontRef): boolean {
  const chain = fontChain(ref)
  return Array.from(text).every((ch) => /\s/.test(ch) || chain.some((c) => c.charToGlyphIndex(ch) > 0))
}

// ---------------------------------------------------------------------------
// Brand font name → bundled family
// ---------------------------------------------------------------------------

const CONDENSED = ['anton', 'bebas', 'oswald', 'league gothic', 'impact', 'condensed', 'fjalla', 'teko', 'staatliches', 'big shoulders', 'druk', 'compressed', 'narrow']
const HEAVY_DISPLAY = ['archivo', 'black', 'heavy', 'rubik', 'lilita', 'titan', 'bowlby', 'passion one', 'alfa slab', 'ultra', 'chunk', 'display']
const SERIF = ['serif', 'playfair', 'dm serif', 'lora', 'merriweather', 'georgia', 'times', 'garamond', 'baskerville', 'cormorant', 'bodoni', 'didot', 'libre caslon', 'crimson', 'prata', 'cinzel', 'fraunces', 'abril', 'spectral', 'pt serif', 'noto serif', 'source serif', 'eb garamond', 'tiempos', 'canela', 'recoleta']
const GEOMETRIC = ['poppins', 'montserrat', 'futura', 'gotham', 'avenir', 'nunito', 'raleway', 'quicksand', 'dm sans', 'outfit', 'sora', 'manrope', 'urbanist', 'josefin', 'jost', 'lexend', 'plus jakarta', 'figtree', 'kanit', 'comfortaa', 'varela', 'mulish', 'questrial', 'century gothic', 'circular', 'proxima', 'gilroy', 'sofia']
const HUMANIST = ['inter', 'roboto', 'open sans', 'lato', 'helvetica', 'arial', 'source sans', 'fira', 'ibm plex', 'work sans', 'noto sans', 'pt sans', 'ubuntu', 'segoe', 'sf pro', 'system', 'barlow', 'karla', 'hind', 'cabin', 'oxygen', 'asap', 'heebo', 'assistant', 'public sans', 'red hat', 'overpass', 'sans']

const includesAny = (s: string, list: string[]) => list.some((k) => s.includes(k))

/** Map a free-form brand font name to the closest bundled family, or null when unknown. */
export function matchFamily(name: string | undefined, role: 'heading' | 'body'): FamilyName | null {
  if (!name || typeof name !== 'string') return null
  const s = name.toLowerCase().replace(/["']/g, '').trim()
  if (!s) return null
  // Exact bundled names first.
  if (s.includes('anton')) return role === 'heading' ? 'Anton' : 'Poppins'
  if (s.includes('archivo black')) return role === 'heading' ? 'Archivo Black' : 'Poppins'
  if (s.includes('poppins')) return 'Poppins'
  if (s.includes('fira')) return 'Fira Sans'
  if (s.includes('dm serif')) return role === 'heading' ? 'DM Serif Display' : 'Fira Sans'
  if (includesAny(s, SERIF) && !s.includes('sans')) return role === 'heading' ? 'DM Serif Display' : 'Fira Sans'
  if (includesAny(s, CONDENSED)) return role === 'heading' ? 'Anton' : 'Fira Sans'
  if (includesAny(s, GEOMETRIC)) return 'Poppins'
  if (includesAny(s, HEAVY_DISPLAY)) return role === 'heading' ? 'Archivo Black' : 'Poppins'
  if (includesAny(s, HUMANIST)) return 'Fira Sans'
  return null
}

const HEADING_WEIGHT: Record<FamilyName, number> = {
  Poppins: 800,
  'Fira Sans': 800,
  'Archivo Black': 400,
  Anton: 400,
  'DM Serif Display': 400,
}

/** Resolve brand fonts to bundled families. Default: Poppins ExtraBold headings + Poppins body. */
export function resolveFonts(visual: Pick<DnaVisual, 'headingFont' | 'bodyFont'> | undefined): ResolvedFonts {
  const headingFamily = matchFamily(visual?.headingFont, 'heading')
  let bodyFamily = matchFamily(visual?.bodyFont, 'body')
  const bodyMatched = !!bodyFamily
  if (!bodyFamily) {
    // Pair body with the heading: humanist/serif → Fira Sans, otherwise Poppins.
    bodyFamily = headingFamily === 'Fira Sans' || headingFamily === 'DM Serif Display' ? 'Fira Sans' : 'Poppins'
  }
  if (bodyFamily !== 'Poppins' && bodyFamily !== 'Fira Sans') bodyFamily = 'Poppins'
  const heading = headingFamily ?? 'Poppins'
  return {
    heading: { family: heading, weight: HEADING_WEIGHT[heading] },
    body: { family: bodyFamily, weight: 400, boldWeight: 700 },
    match: { heading: headingFamily ? 'mapped' : 'default', body: bodyMatched ? 'mapped' : 'default' },
  }
}
