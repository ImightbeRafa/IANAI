/**
 * Font registry for the Ad Pack renderer.
 *
 * Bundled OFL fonts (see fonts/*-OFL.txt) are read from disk next to this module
 * (`./fonts/*.ttf`). Each manifest file is referenced with a literal
 * `new URL('./fonts/…', import.meta.url)` so bundlers / file tracers (Vercel nft)
 * pick them up. `ADPACK_FONTS_DIR` overrides the folder (e.g. a Cloudflare
 * container that copies the fonts somewhere else).
 *
 * Space Grotesk (OFL) is part of the manifest: a bundled system font, never fetched.
 * Extra OFL TTF/OTF files dropped into the same folder (see README) are registered too, under the family name stored in the
 * font itself. Brand fonts fetched at runtime (Google Fonts / kit uploads, see
 * `font-resolver.ts`) are added with `registerFont`.
 *
 * Every text run is drawn with the requested family first and Fira Sans as the
 * per-glyph fallback (₡ and other glyphs missing from display faces).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import type { DnaVisual } from '../types.js'

/** Any registered family name (bundled, vendored or fetched at runtime). */
export type FamilyName = string

export type BundledFamily = 'Poppins' | 'Fira Sans' | 'Archivo Black' | 'Anton' | 'DM Serif Display' | 'Space Grotesk'

interface FontFile {
  family: BundledFamily
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
  // Space Grotesk (OFL, google/fonts; static 400/700 instanced by scripts/adpack-vendor-fonts.mjs): bundled system font.
  { family: 'Space Grotesk', weight: 400, file: 'SpaceGrotesk-Regular.ttf', url: new URL('./fonts/SpaceGrotesk-Regular.ttf', import.meta.url) },
  { family: 'Space Grotesk', weight: 700, file: 'SpaceGrotesk-Bold.ttf', url: new URL('./fonts/SpaceGrotesk-Bold.ttf', import.meta.url) },
]

export const BUNDLED_FAMILIES: BundledFamily[] = ['Poppins', 'Fira Sans', 'Archivo Black', 'Anton', 'DM Serif Display', 'Space Grotesk']

/** Fira Sans covers ₡ and other glyphs missing from the display faces; it is always the fallback. */
export const FALLBACK_FAMILY: BundledFamily = 'Fira Sans'

export type FontSource = 'bundled' | 'vendored' | 'google' | 'custom' | 'cache'

export interface FontRef {
  family: FamilyName
  weight: number
}

export interface ResolvedFonts {
  /** Headline / offer face. */
  heading: FontRef
  /** Body face (sublines, chips, CTA). Always has a regular and a bold weight (may be the same file). */
  body: FontRef & { boldWeight: number }
  /**
   * How each brand font name was matched: `exact` = the brand's own family is registered
   * (bundled, vendored, fetched or uploaded); `mapped` = closest bundled family; `default` = Poppins.
   */
  match: { heading: 'exact' | 'mapped' | 'default'; body: 'exact' | 'mapped' | 'default' }
}

export interface LoadedFont {
  family: FamilyName
  weight: number
  data: Buffer
  font: opentype.Font
  source: FontSource
}

/** family (lower-case) → weights */
const registry = new Map<string, LoadedFont[]>()
let bundledLoaded = false

const keyOf = (family: string) => family.trim().toLowerCase()

function fontsDir(): string {
  const dir = process.env.ADPACK_FONTS_DIR
  if (dir) return dir
  return dirname(fileURLToPath(FONT_FILES[0].url))
}

function fontPath(f: FontFile): string {
  const dir = process.env.ADPACK_FONTS_DIR
  if (dir) return join(dir, f.file)
  return fileURLToPath(f.url)
}

function toArrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

/** True for TrueType / OpenType (CFF) sfnt bytes. WOFF/WOFF2 are rejected (satori cannot draw them). */
export function isSfnt(data: Uint8Array): boolean {
  if (data.byteLength < 12) return false
  const tag = String.fromCharCode(data[0], data[1], data[2], data[3])
  return tag === 'OTTO' || tag === 'true' || (data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0)
}

/** Parse font bytes (throws on anything that is not a TTF/OTF). */
export function parseFont(data: Buffer): opentype.Font {
  if (!isSfnt(data)) throw new Error('font is not a TTF/OTF file')
  return opentype.parse(toArrayBuffer(data))
}

/** Family name stored in the font's name table (typographic family first). */
export function fontFamilyName(font: opentype.Font): string | undefined {
  const names = font.names as unknown as Record<string, Record<string, string> | undefined>
  const pick = (k: string) => (names[k] ? names[k]!.en || Object.values(names[k]!)[0] : undefined)
  return pick('typographicFamily') || pick('preferredFamily') || pick('fontFamily') || undefined
}

/** Weight from OS/2 usWeightClass (default 400). */
export function fontWeightClass(font: opentype.Font): number {
  const os2 = (font.tables as Record<string, { usWeightClass?: number } | undefined>).os2
  const w = os2?.usWeightClass
  return typeof w === 'number' && w >= 100 && w <= 1000 ? Math.round(w / 100) * 100 : 400
}

function addToRegistry(f: LoadedFont): LoadedFont {
  const k = keyOf(f.family)
  const list = registry.get(k) ?? []
  const i = list.findIndex((x) => x.weight === f.weight)
  if (i >= 0) list[i] = f
  else list.push(f)
  list.sort((a, b) => a.weight - b.weight)
  registry.set(k, list)
  satoriCache.clear()
  return f
}

function loadBundled(): void {
  if (bundledLoaded) return
  bundledLoaded = true
  const known = new Set<string>()
  for (const f of FONT_FILES) {
    const data = readFileSync(fontPath(f))
    addToRegistry({ family: f.family, weight: f.weight, data, font: parseFont(data), source: 'bundled' })
    known.add(f.file)
  }
  // Vendored extras: any other TTF/OTF in the folder, registered under its own family name.
  try {
    const dir = fontsDir()
    if (!existsSync(dir)) return
    for (const file of readdirSync(dir)) {
      if (known.has(file) || !/\.(ttf|otf)$/i.test(file)) continue
      try {
        const data = readFileSync(join(dir, file))
        const font = parseFont(data)
        const family = fontFamilyName(font)
        if (!family) continue
        addToRegistry({ family, weight: fontWeightClass(font), data, font, source: 'vendored' })
      } catch {
        // Unreadable extra font: ignore (never break rendering for a stray file).
      }
    }
  } catch {
    // Folder not listable (bundled single-file deploy): manifest fonts are enough.
  }
}

/** Register a font for the rest of the process (runtime-fetched / uploaded). Returns the loaded entry. */
export function registerFont(family: string, weight: number, data: Buffer, source: FontSource): LoadedFont {
  loadBundled()
  const font = parseFont(data)
  return addToRegistry({ family: family.trim(), weight: Math.round(weight / 100) * 100 || 400, data, font, source })
}

/** Tests: drop fonts registered at runtime (fetched / uploaded / disk cache); bundled + vendored stay. */
export function resetRuntimeFonts(): void {
  loadBundled()
  for (const [k, list] of registry) {
    const keep = list.filter((f) => f.source === 'bundled' || f.source === 'vendored')
    if (keep.length) registry.set(k, keep)
    else registry.delete(k)
  }
  satoriCache.clear()
  widthCache.clear()
}

/** Every registered font (bundled first). */
export function loadFonts(): LoadedFont[] {
  loadBundled()
  return [...registry.values()].flat()
}

/** Registered weights of a family (empty when unknown). Case-insensitive. */
export function familyFonts(family: string): LoadedFont[] {
  loadBundled()
  return registry.get(keyOf(family)) ?? []
}

export function hasFamily(family: string | undefined): boolean {
  return !!family && familyFonts(family).length > 0
}

/** Canonical (registered) spelling of a family name. */
export function canonicalFamily(family: string): string | undefined {
  return familyFonts(family)[0]?.family
}

const satoriCache = new Map<string, Array<{ name: string; data: Buffer; weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style: 'normal' }>>()

/**
 * Font list in satori's expected shape. With `families`, only those (plus the fallback)
 * are passed, which keeps satori fast when many runtime fonts are registered. The array
 * is memoized per family set (satori caches parsed fonts per array).
 */
export function satoriFonts(families?: string[]): Array<{ name: string; data: Buffer; weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style: 'normal' }> {
  loadBundled()
  const wanted = families ? [...new Set([...families, FALLBACK_FAMILY].map(keyOf))].sort() : null
  const cacheKey = wanted ? wanted.join('|') : '*'
  let list = satoriCache.get(cacheKey)
  if (!list) {
    const fonts = wanted ? wanted.flatMap((k) => registry.get(k) ?? []) : loadFonts()
    list = fonts.map((f) => ({ name: f.family, data: f.data, weight: Math.min(900, Math.max(100, f.weight)) as 400, style: 'normal' as const }))
    satoriCache.set(cacheKey, list)
  }
  return list
}

/** CSS font-family value with the glyph fallback appended. */
export function cssFamily(family: FamilyName): string {
  return keyOf(family) === keyOf(FALLBACK_FAMILY) ? `'${FALLBACK_FAMILY}'` : `'${canonicalFamily(family) ?? family}', '${FALLBACK_FAMILY}'`
}

function closestWeight(family: FamilyName, weight: number): LoadedFont {
  let list = familyFonts(family)
  if (!list.length) list = familyFonts(FALLBACK_FAMILY)
  return list.reduce((best, f) => (Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best), list[0])
}

/** Fonts tried per glyph, in the same order satori uses (requested family, then fallback). */
export function fontChain(ref: FontRef): opentype.Font[] {
  const chain = [closestWeight(ref.family, ref.weight).font]
  if (keyOf(ref.family) !== keyOf(FALLBACK_FAMILY)) chain.push(closestWeight(FALLBACK_FAMILY, ref.weight).font)
  return chain
}

const widthCache = new Map<string, number>()

/** Advance width (px) of a single-line string, with kerning and per-glyph fallback. */
export function measureText(text: string, ref: FontRef, fontSize: number): number {
  const key = `${keyOf(ref.family)}|${ref.weight}|${text}`
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

/** Characters (deduped) the family itself lacks; they are drawn with the fallback face. */
export function missingGlyphs(text: string, family: FamilyName, weight = 400): string[] {
  const own = closestWeight(family, weight).font
  const out: string[] = []
  for (const ch of Array.from(text)) {
    if (/\s/.test(ch) || out.includes(ch)) continue
    if (own.charToGlyphIndex(ch) <= 0) out.push(ch)
  }
  return out
}

// ---------------------------------------------------------------------------
// Brand font name → registered family (exact) or closest bundled family
// ---------------------------------------------------------------------------

const CONDENSED = ['anton', 'bebas', 'oswald', 'league gothic', 'impact', 'condensed', 'fjalla', 'teko', 'staatliches', 'big shoulders', 'druk', 'compressed', 'narrow']
const HEAVY_DISPLAY = ['archivo', 'black', 'heavy', 'rubik', 'lilita', 'titan', 'bowlby', 'passion one', 'alfa slab', 'ultra', 'chunk', 'display']
const SERIF = ['serif', 'playfair', 'dm serif', 'lora', 'merriweather', 'georgia', 'times', 'garamond', 'baskerville', 'cormorant', 'bodoni', 'didot', 'libre caslon', 'crimson', 'prata', 'cinzel', 'fraunces', 'abril', 'spectral', 'pt serif', 'noto serif', 'source serif', 'eb garamond', 'tiempos', 'canela', 'recoleta']
const GEOMETRIC = ['poppins', 'montserrat', 'futura', 'gotham', 'avenir', 'nunito', 'raleway', 'quicksand', 'dm sans', 'outfit', 'sora', 'manrope', 'urbanist', 'josefin', 'jost', 'lexend', 'plus jakarta', 'figtree', 'kanit', 'comfortaa', 'varela', 'mulish', 'questrial', 'century gothic', 'circular', 'proxima', 'gilroy', 'sofia']
const HUMANIST = ['inter', 'roboto', 'open sans', 'lato', 'helvetica', 'arial', 'source sans', 'fira', 'ibm plex', 'work sans', 'noto sans', 'pt sans', 'ubuntu', 'segoe', 'sf pro', 'system', 'barlow', 'karla', 'hind', 'cabin', 'oxygen', 'asap', 'heebo', 'assistant', 'public sans', 'red hat', 'overpass', 'grotesk', 'grotesque', 'neue haas', 'akzidenz', 'sans']

const includesAny = (s: string, list: string[]) => list.some((k) => s.includes(k))

/** First family of a CSS-ish font list ("'Space Grotesk', sans-serif" → "Space Grotesk"). */
export function primaryFamilyName(name: string | undefined): string | undefined {
  if (!name || typeof name !== 'string') return undefined
  const first = name.split(',')[0].replace(/["']/g, '').replace(/\s+/g, ' ').trim()
  if (!first || /^(sans-serif|serif|monospace|system-ui|cursive|fantasy)$/i.test(first)) return undefined
  return first.slice(0, 80)
}

/** Map a free-form brand font name to the closest bundled family, or null when unknown. */
export function matchFamily(name: string | undefined, role: 'heading' | 'body'): BundledFamily | null {
  if (!name || typeof name !== 'string') return null
  const s = name.toLowerCase().replace(/["']/g, '').trim()
  if (!s) return null
  // Exact bundled names first.
  if (s.includes('anton')) return role === 'heading' ? 'Anton' : 'Poppins'
  if (s.includes('archivo black')) return role === 'heading' ? 'Archivo Black' : 'Poppins'
  if (s.includes('poppins')) return 'Poppins'
  if (s.includes('fira')) return 'Fira Sans'
  if (s.includes('space grotesk')) return 'Space Grotesk'
  if (s.includes('dm serif')) return role === 'heading' ? 'DM Serif Display' : 'Fira Sans'
  if (includesAny(s, SERIF) && !s.includes('sans')) return role === 'heading' ? 'DM Serif Display' : 'Fira Sans'
  if (includesAny(s, CONDENSED)) return role === 'heading' ? 'Anton' : 'Fira Sans'
  if (includesAny(s, GEOMETRIC)) return 'Poppins'
  if (includesAny(s, HEAVY_DISPLAY)) return role === 'heading' ? 'Archivo Black' : 'Poppins'
  if (includesAny(s, HUMANIST)) return 'Fira Sans'
  return null
}

const HEADING_WEIGHT: Record<BundledFamily, number> = {
  Poppins: 800,
  'Fira Sans': 800,
  'Archivo Black': 400,
  Anton: 400,
  'DM Serif Display': 400,
  'Space Grotesk': 700,
}

/** Heaviest useful heading weight of a registered family (prefers 700–800). */
function headingWeightOf(family: string): number {
  const bundled = BUNDLED_FAMILIES.find((b) => keyOf(b) === keyOf(family))
  if (bundled) return HEADING_WEIGHT[bundled]
  const weights = familyFonts(family).map((f) => f.weight)
  const strong = weights.filter((w) => w >= 600 && w <= 900)
  if (strong.length) return strong.includes(700) ? 700 : strong[strong.length - 1]
  return weights[weights.length - 1] ?? 400
}

/** Body face needs a regular and a bold weight; a single-weight family uses that file for both. */
function bodyWeightsOf(family: string): { weight: number; boldWeight: number } {
  const weights = familyFonts(family).map((f) => f.weight)
  const regular = weights.reduce((best, w) => (Math.abs(w - 400) < Math.abs(best - 400) ? w : best), weights[0] ?? 400)
  const bolds = weights.filter((w) => w >= 600)
  const bold = bolds.length ? bolds.reduce((best, w) => (Math.abs(w - 700) < Math.abs(best - 700) ? w : best), bolds[0]) : regular
  return { weight: regular, boldWeight: bold }
}

/** Display-only bundled faces cannot carry body copy. */
const DISPLAY_ONLY = new Set(['anton', 'archivo black', 'dm serif display'])

/**
 * Resolve brand fonts against the registry: the brand's own family when it is registered
 * (bundled, vendored, fetched or uploaded — see `ensureBrandFonts`), else the closest bundled
 * family, else Poppins. Body is always a text face with regular + bold weights.
 */
export function resolveFonts(visual: Pick<DnaVisual, 'headingFont' | 'bodyFont'> | undefined): ResolvedFonts {
  loadBundled()
  const headingName = primaryFamilyName(visual?.headingFont)
  const bodyName = primaryFamilyName(visual?.bodyFont)

  let heading: string
  let headingMatch: ResolvedFonts['match']['heading']
  if (headingName && hasFamily(headingName)) {
    heading = canonicalFamily(headingName)!
    headingMatch = 'exact'
  } else {
    const mapped = matchFamily(headingName, 'heading')
    heading = mapped ?? 'Poppins'
    headingMatch = mapped ? 'mapped' : 'default'
  }

  let body: string | null = null
  let bodyMatch: ResolvedFonts['match']['body'] = 'default'
  if (bodyName && hasFamily(bodyName) && !DISPLAY_ONLY.has(keyOf(bodyName))) {
    body = canonicalFamily(bodyName)!
    bodyMatch = 'exact'
  } else if (bodyName) {
    const mapped = matchFamily(bodyName, 'body')
    if (mapped) {
      body = mapped
      bodyMatch = 'mapped'
    }
  }
  if (!body) {
    // Pair body with the heading: a registered text face is reused, humanist/serif → Fira Sans, else Poppins.
    if (headingMatch === 'exact' && !DISPLAY_ONLY.has(keyOf(heading)) && familyFonts(heading).length >= 1) body = heading
    else body = heading === 'Fira Sans' || heading === 'DM Serif Display' ? 'Fira Sans' : 'Poppins'
  }
  if (DISPLAY_ONLY.has(keyOf(body))) body = 'Poppins'
  const bw = bodyWeightsOf(body)
  return {
    heading: { family: heading, weight: headingWeightOf(heading) },
    body: { family: body, weight: bw.weight, boldWeight: bw.boldWeight },
    match: { heading: headingMatch, body: bodyMatch },
  }
}
