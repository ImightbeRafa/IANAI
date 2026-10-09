/**
 * Brand font resolver: makes the kit's heading/body fonts available to the renderer.
 *
 * Order per role (heading, body):
 *   1. uploaded custom font URL from the kit (`visual.headingFontUrl` / `bodyFontUrl`), TTF/OTF only;
 *   2. already registered (bundled, vendored in fonts/, or fetched earlier in this process);
 *   3. disk cache (`<os tmp>/adpack-fonts`, or `cacheDir`);
 *   4. Google Fonts by family name: CSS2 API requested with a legacy user agent so it answers
 *      with static TTF instances per weight; fallback to the google/fonts GitHub static TTFs.
 * Every network step has a timeout; failures are negative-cached for a while and the renderer
 * falls back to the closest bundled family (never throws). Glyph coverage (₡, accents, ¿¡, ñ)
 * is checked per font and reported; missing glyphs are drawn with the fallback face per glyph.
 *
 * Network only happens when a `fetch` is passed (the production adapter passes global fetch;
 * tests pass a fake). No `fetch` → bundled/registered/disk-cached fonts only.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DnaVisual } from '../types.js'
import { familyFonts, hasFamily, isSfnt, missingGlyphs, primaryFamilyName, registerFont, resolveFonts, type FontSource, type ResolvedFonts } from './fonts.js'

/** Characters every Spanish ad may need. */
export const GLYPH_SAMPLE = 'ÁÉÍÓÚÜÑáéíóúüñ¿¡₡$%·–“”0123456789'

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}>

export interface FontResolverOptions {
  /** Network fetch (omit / null → no network). */
  fetch?: FetchLike | null
  /** Disk cache folder; default `<os tmp>/adpack-fonts`; null disables the disk cache. */
  cacheDir?: string | null
  /** Per request timeout (ms). Default 5000. */
  timeoutMs?: number
  /** Overall budget for one ensureBrandFonts call (ms). Default 9000. */
  budgetMs?: number
  /** Weights fetched for a Google family. Default [400, 700]. */
  weights?: number[]
}

export interface FontRoleResolution {
  /** Brand font name as given (first family of the list). */
  requested?: string
  /** Family actually drawn. */
  family: string
  /** Where the drawn family came from. */
  source: FontSource | 'mapped' | 'default'
  /** Glyphs of GLYPH_SAMPLE the family lacks (drawn with Fira Sans). */
  missingGlyphs: string[]
  /** Why the brand font is not used, when it is not. */
  note?: string
}

export interface FontResolution {
  heading: FontRoleResolution
  body: FontRoleResolution
  fonts: ResolvedFonts
}

const DEFAULT_TIMEOUT = 5_000
const DEFAULT_BUDGET = 9_000
const NEGATIVE_TTL_MS = 15 * 60_000
/** Old desktop UA: Google Fonts CSS2 then serves `format('truetype')` URLs. */
const TTF_USER_AGENT = 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0'
const MAX_FONT_BYTES = 6 * 1024 * 1024

const negative = new Map<string, number>()
const inflight = new Map<string, Promise<boolean>>()

export function defaultFontCacheDir(): string {
  return join(tmpdir(), 'adpack-fonts')
}

const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '')
const pascal = (family: string) => family.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const WEIGHT_NAME: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }

/** Only plausible Google family names (letters, digits, spaces) go to the network. */
export function isFetchableFamilyName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9 ]{1,60}$/.test(name)
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await run(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBytes(fetchFn: FetchLike, url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const res = await fetchFn(url, { signal, headers: { 'User-Agent': TTF_USER_AGENT } })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_FONT_BYTES || !isSfnt(buf)) return null
      return buf
    })
  } catch {
    return null
  }
}

/** Parse a CSS2 response into {weight → ttf url}. */
export function parseGoogleCss(css: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const block of css.split('@font-face').slice(1)) {
    const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal'
    if (style !== 'normal') continue
    const weight = Number(/font-weight:\s*(\d{3})/.exec(block)?.[1] ?? 400)
    const url = /url\((https:\/\/[^)\s]+)\)\s*format\(['"]?(truetype|opentype)['"]?\)/.exec(block)?.[1] ?? /url\((https:\/\/[^)\s]+\.(?:ttf|otf))\)/.exec(block)?.[1]
    if (url && !out.has(weight)) out.set(weight, url)
  }
  return out
}

async function readCache(dir: string | null, family: string, weight: number): Promise<Buffer | null> {
  if (!dir) return null
  try {
    const buf = await readFile(join(dir, `${slug(family)}-${weight}.ttf`))
    return isSfnt(buf) ? buf : null
  } catch {
    return null
  }
}

async function writeCache(dir: string | null, family: string, weight: number, data: Buffer): Promise<void> {
  if (!dir) return
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${slug(family)}-${weight}.ttf`), data)
  } catch {
    // Read-only FS: memory registry is enough.
  }
}

function tryRegister(family: string, weight: number, data: Buffer, source: FontSource): boolean {
  try {
    registerFont(family, weight, data, source)
    return true
  } catch {
    return false
  }
}

/** Load a Google Font family (by name) into the registry. True when at least one weight loaded. */
async function loadGoogleFamily(family: string, opts: Required<Pick<FontResolverOptions, 'timeoutMs'>> & FontResolverOptions, deadline: number): Promise<boolean> {
  const dir = opts.cacheDir === undefined ? defaultFontCacheDir() : opts.cacheDir
  const weights = [...new Set(opts.weights ?? [400, 700])].sort()
  // Disk cache first.
  let loaded = 0
  for (const w of weights) {
    const cached = await readCache(dir, family, w)
    if (cached && tryRegister(family, w, cached, 'cache')) loaded++
  }
  if (loaded === weights.length) return true
  const fetchFn = opts.fetch
  if (!fetchFn || !isFetchableFamilyName(family)) return loaded > 0
  const remaining = () => Math.max(0, deadline - Date.now())

  // 1) Google Fonts CSS2 (static TTF instances per weight).
  const fam = encodeURIComponent(family).replace(/%20/g, '+')
  const cssUrls = [`https://fonts.googleapis.com/css2?family=${fam}:wght@${weights.join(';')}`, `https://fonts.googleapis.com/css2?family=${fam}`]
  for (const cssUrl of cssUrls) {
    if (remaining() < 200) break
    let css = ''
    try {
      css = await withTimeout(Math.min(opts.timeoutMs, remaining()), async (signal) => {
        const res = await fetchFn(cssUrl, { signal, headers: { 'User-Agent': TTF_USER_AGENT } })
        return res.ok ? res.text() : ''
      })
    } catch {
      css = ''
    }
    const urls = parseGoogleCss(css)
    if (!urls.size) continue
    for (const [w, url] of urls) {
      if (familyFonts(family).some((f) => f.weight === w) || remaining() < 200) continue
      const bytes = await fetchBytes(fetchFn, url, Math.min(opts.timeoutMs, remaining()))
      if (bytes && tryRegister(family, w, bytes, 'google')) {
        loaded++
        await writeCache(dir, family, w, bytes)
      }
    }
    if (loaded) return true
  }

  // 2) google/fonts GitHub static TTFs (ofl/<slug>/static/<Name>-<Weight>.ttf, then ofl/<slug>/<Name>-<Weight>.ttf).
  for (const w of weights) {
    if (familyFonts(family).some((f) => f.weight === w)) continue
    for (const path of [`ofl/${slug(family)}/static/${pascal(family)}-${WEIGHT_NAME[w] ?? 'Regular'}.ttf`, `ofl/${slug(family)}/${pascal(family)}-${WEIGHT_NAME[w] ?? 'Regular'}.ttf`]) {
      if (remaining() < 200) break
      const bytes = await fetchBytes(fetchFn, `https://raw.githubusercontent.com/google/fonts/main/${path}`, Math.min(opts.timeoutMs, remaining()))
      if (bytes && tryRegister(family, w, bytes, 'google')) {
        loaded++
        await writeCache(dir, family, w, bytes)
        break
      }
    }
  }
  return loaded > 0
}

/** Register an uploaded kit font (https/data URL, TTF/OTF). Family = the brand font name or a stable synthetic one. */
async function loadCustomFont(url: string, family: string, opts: FontResolverOptions & { timeoutMs: number }, deadline: number): Promise<boolean> {
  const dir = opts.cacheDir === undefined ? defaultFontCacheDir() : opts.cacheDir
  const cacheKey = `custom-${createHash('sha1').update(url).digest('hex').slice(0, 16)}`
  const cached = await readCache(dir, cacheKey, 400)
  if (cached) return tryRegister(family, weightFromFont(cached), cached, 'custom')
  let bytes: Buffer | null = null
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    if (comma > 0 && url.slice(0, comma).includes(';base64')) bytes = Buffer.from(url.slice(comma + 1), 'base64')
    if (bytes && !isSfnt(bytes)) bytes = null
  } else if (/^https:\/\//i.test(url) && opts.fetch) {
    bytes = await fetchBytes(opts.fetch, url, Math.min(opts.timeoutMs, Math.max(0, deadline - Date.now())))
  }
  if (!bytes) return false
  if (!tryRegister(family, weightFromFont(bytes), bytes, 'custom')) return false
  await writeCache(dir, cacheKey, 400, bytes)
  return true
}

function weightFromFont(bytes: Buffer): number {
  try {
    // Lazy import of the parser through registerFont would double-parse; read OS/2 weight cheaply instead.
    const numTables = bytes.readUInt16BE(4)
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      if (bytes.toString('latin1', rec, rec + 4) === 'OS/2') {
        const off = bytes.readUInt32BE(rec + 8)
        const w = bytes.readUInt16BE(off + 4)
        if (w >= 100 && w <= 1000) return Math.round(w / 100) * 100
      }
    }
  } catch {
    // fall through
  }
  return 400
}

async function ensureFamily(
  role: 'heading' | 'body',
  name: string | undefined,
  url: string | undefined,
  opts: FontResolverOptions & { timeoutMs: number },
  deadline: number,
): Promise<{ ok: boolean; family?: string; source?: FontSource; note?: string }> {
  if (url) {
    const family = name || `Brand ${role === 'heading' ? 'Heading' : 'Body'} ${createHash('sha1').update(url).digest('hex').slice(0, 6)}`
    if (hasFamily(family) && familyFonts(family).some((f) => f.source === 'custom')) return { ok: true, family, source: 'custom' }
    if (await loadCustomFont(url, family, opts, deadline)) return { ok: true, family, source: 'custom' }
    if (!name) return { ok: false, note: 'custom font URL could not be loaded (TTF/OTF over https only)' }
  }
  if (!name) return { ok: false }
  if (hasFamily(name)) return { ok: true, family: name, source: familyFonts(name)[0].source }
  const key = name.toLowerCase()
  const until = negative.get(key)
  if (until && until > Date.now()) return { ok: false, note: 'brand font unavailable (cached failure)' }
  let job = inflight.get(key)
  if (!job) {
    job = loadGoogleFamily(name, opts, deadline).finally(() => inflight.delete(key))
    inflight.set(key, job)
  }
  const ok = await job
  if (!ok) {
    if (opts.fetch) negative.set(key, Date.now() + NEGATIVE_TTL_MS)
    return { ok: false, note: opts.fetch ? 'not found on Google Fonts' : 'not bundled (font fetching off)' }
  }
  return { ok: true, family: name, source: familyFonts(name)[0]?.source ?? 'google' }
}

/**
 * Make the kit fonts available (custom upload → registered → disk cache → Google Fonts) and
 * resolve the families the renderer will draw. Never throws.
 */
export async function ensureBrandFonts(
  visual: Pick<DnaVisual, 'headingFont' | 'bodyFont' | 'headingFontUrl' | 'bodyFontUrl'> | undefined,
  options: FontResolverOptions = {},
): Promise<FontResolution> {
  const opts = { ...options, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT }
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET)
  const headingName = primaryFamilyName(visual?.headingFont)
  const bodyName = primaryFamilyName(visual?.bodyFont)
  const notes: { heading?: string; body?: string } = {}
  const [h, b] = await Promise.all([
    ensureFamily('heading', headingName, cleanUrl(visual?.headingFontUrl), opts, deadline).catch(() => ({ ok: false as const, note: 'font load failed' })),
    ensureFamily('body', bodyName, cleanUrl(visual?.bodyFontUrl), opts, deadline).catch(() => ({ ok: false as const, note: 'font load failed' })),
  ])
  if (!h.ok && h.note) notes.heading = h.note
  if (!b.ok && b.note) notes.body = b.note
  // A custom upload without a name registers under a synthetic family: resolve with that name.
  const fonts = resolveFonts({
    headingFont: (h.ok && h.family) || visual?.headingFont,
    bodyFont: (b.ok && b.family) || visual?.bodyFont,
  })
  const role = (requested: string | undefined, family: string, match: ResolvedFonts['match']['heading'], src: FontSource | undefined, weight: number, note?: string): FontRoleResolution => ({
    ...(requested ? { requested } : {}),
    family,
    source: match === 'exact' ? src ?? familyFonts(family)[0]?.source ?? 'bundled' : match,
    missingGlyphs: missingGlyphs(GLYPH_SAMPLE, family, weight),
    ...(note ? { note } : {}),
  })
  return {
    heading: role(headingName, fonts.heading.family, fonts.match.heading, h.ok ? h.source : undefined, fonts.heading.weight, notes.heading),
    body: role(bodyName, fonts.body.family, fonts.match.body, b.ok ? b.source : undefined, fonts.body.weight, notes.body),
    fonts,
  }
}

function cleanUrl(u: string | undefined): string | undefined {
  if (typeof u !== 'string') return undefined
  const s = u.trim()
  return /^https:\/\//i.test(s) || /^data:(font|application)\/[\w.+-]+;base64,/i.test(s) ? s : undefined
}

/** Tests: forget negative-cache entries. */
export function resetFontResolverState(): void {
  negative.clear()
  inflight.clear()
}
