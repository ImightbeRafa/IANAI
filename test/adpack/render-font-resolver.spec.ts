/**
 * Brand font resolver: bundled → registered → disk cache → Google Fonts (fake fetch only; no network),
 * uploaded kit fonts, glyph coverage with per-glyph fallback.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resetFontResolverState, parseGoogleCss, type FetchLike } from '../../api/lib/adpack/render/font-resolver'
import { measureText, missingGlyphs, resetRuntimeFonts } from '../../api/lib/adpack/render/fonts'
import { ensureBrandFonts, hasAllGlyphs, renderAd, resolveFonts } from '../../api/lib/adpack/render/index'
import { makeScene, SAMPLE_COPY } from './render-fixtures'

// Local OFL fixture bytes (bundled Poppins) stand in for a downloaded Google Font.
const fontFile = (f: string) => readFileSync(fileURLToPath(new URL(`../../api/lib/adpack/render/fonts/${f}`, import.meta.url)))
const REGULAR = fontFile('Poppins-Regular.ttf')
const BOLD = fontFile('Poppins-Bold.ttf')

const css = (family: string) => `
/* latin */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/fake/v1/regular.ttf) format('truetype');
}
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/fake/v1/bold.ttf) format('truetype');
}`

function fakeFetch(opts: { css?: (url: string) => string | null; files?: Record<string, Buffer>; hang?: boolean } = {}) {
  const calls: Array<{ url: string; ua?: string }> = []
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, ua: init?.headers?.['User-Agent'] })
    if (opts.hang) {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    const ok = (body: Buffer | string) => ({ ok: true, status: 200, text: async () => String(body), arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body).buffer : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)) as ArrayBuffer })
    const notFound = { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
    if (url.startsWith('https://fonts.googleapis.com/css2')) {
      const body = opts.css ? opts.css(url) : null
      return body ? ok(body) : notFound
    }
    const file = Object.entries(opts.files ?? {}).find(([k]) => url.endsWith(k))
    return file ? ok(file[1]) : notFound
  }
  return { fn, calls }
}

const tmpCache = () => mkdtempSync(join(tmpdir(), 'adpack-fonts-test-'))

afterEach(() => {
  resetRuntimeFonts()
  resetFontResolverState()
})

describe('parseGoogleCss', () => {
  it('reads one TTF url per normal-style weight', () => {
    const map = parseGoogleCss(css('Space Grotesk'))
    expect([...map.keys()]).toEqual([400, 700])
    expect(map.get(700)).toMatch(/bold\.ttf$/)
  })
})

describe('ensureBrandFonts', () => {
  it('bundled family: exact match, no network', async () => {
    const { fn, calls } = fakeFetch()
    const res = await ensureBrandFonts({ headingFont: 'Anton', bodyFont: 'Fira Sans' }, { fetch: fn, cacheDir: tmpCache() })
    expect(res.heading).toMatchObject({ family: 'Anton', source: 'bundled' })
    expect(res.body).toMatchObject({ family: 'Fira Sans', source: 'bundled' })
    expect(calls).toHaveLength(0)
  })

  it('A brand family that is not bundled resolves via Google Fonts CSS2 (TTF UA), caches to disk, reports glyph fallback', async () => {
    const cacheDir = tmpCache()
    const { fn, calls } = fakeFetch({ css: () => css('Brand Grotesk'), files: { 'regular.ttf': REGULAR, 'bold.ttf': BOLD } })
    const res = await ensureBrandFonts({ headingFont: "'Brand Grotesk', sans-serif", bodyFont: 'Brand Grotesk' }, { fetch: fn, cacheDir })
    expect(res.heading).toMatchObject({ requested: 'Brand Grotesk', family: 'Brand Grotesk', source: 'google' })
    expect(res.body.family).toBe('Brand Grotesk')
    expect(res.fonts.heading).toEqual({ family: 'Brand Grotesk', weight: 700 })
    expect(res.fonts.body).toMatchObject({ family: 'Brand Grotesk', weight: 400, boldWeight: 700 })
    expect(calls[0].url).toBe('https://fonts.googleapis.com/css2?family=Brand+Grotesk:wght@400;700')
    expect(calls[0].ua).toMatch(/Firefox\/27/)
    // The fixture face lacks ₡: it is reported and drawn per glyph with the fallback face.
    expect(res.heading.missingGlyphs).toContain('₡')
    expect(hasAllGlyphs('¿¡Ñ ₡9.900 áéíóú', { family: 'Brand Grotesk', weight: 700 })).toBe(true)
    expect(existsSync(join(cacheDir, 'brandgrotesk-400.ttf'))).toBe(true)
    expect(existsSync(join(cacheDir, 'brandgrotesk-700.ttf'))).toBe(true)

    // A fresh process (registry reset) without network loads it from the disk cache.
    resetRuntimeFonts()
    const again = await ensureBrandFonts({ headingFont: 'Brand Grotesk' }, { fetch: null, cacheDir })
    expect(again.heading).toMatchObject({ family: 'Brand Grotesk', source: 'cache' })
  })

  it('the renderer draws the headline in the fetched brand face', async () => {
    const { fn } = fakeFetch({ css: () => css('Brand Grotesk'), files: { 'regular.ttf': REGULAR, 'bold.ttf': BOLD } })
    const scene = await makeScene(600, 750, 'light')
    const r = await renderAd({ format: 'handheld_overlay', ratio: '4:5', sceneImage: scene, copy: SAMPLE_COPY, visual: { headingFont: 'Brand Grotesk', bodyFont: 'Inter' }, language: 'es', layoutFamily: 'editorial_minimal', fonts: { fetch: fn, cacheDir: tmpCache() } })
    expect(r.layoutReport.elements.find((e) => e.role === 'headline')!.fontFamily).toBe('Brand Grotesk')
    expect(r.layoutReport.fonts.resolution?.heading).toMatchObject({ family: 'Brand Grotesk', source: 'google' })
    expect(r.layoutReport.elements.find((e) => e.role === 'offer')!.text).toBe(SAMPLE_COPY.offerLine)
  })

  it('falls back to the google/fonts GitHub static TTFs when CSS2 has nothing', async () => {
    const { fn, calls } = fakeFetch({ css: () => null, files: { 'ofl/brandsans/static/BrandSans-Regular.ttf': REGULAR, 'ofl/brandsans/static/BrandSans-Bold.ttf': BOLD } })
    const res = await ensureBrandFonts({ headingFont: 'Brand Sans' }, { fetch: fn, cacheDir: tmpCache() })
    expect(res.heading).toMatchObject({ family: 'Brand Sans', source: 'google' })
    expect(calls.some((c) => c.url === 'https://raw.githubusercontent.com/google/fonts/main/ofl/brandsans/static/BrandSans-Bold.ttf')).toBe(true)
  })

  it('Space Grotesk is a bundled system font: exact match, no network, its own ₡ glyph', async () => {
    const { fn, calls } = fakeFetch({ css: () => css('Space Grotesk'), files: { 'regular.ttf': REGULAR, 'bold.ttf': BOLD } })
    const res = await ensureBrandFonts({ headingFont: "'Space Grotesk', sans-serif", bodyFont: 'Space Grotesk' }, { fetch: fn, cacheDir: tmpCache() })
    expect(calls).toHaveLength(0)
    expect(res.heading).toMatchObject({ requested: 'Space Grotesk', family: 'Space Grotesk', source: 'bundled' })
    expect(res.fonts.heading).toEqual({ family: 'Space Grotesk', weight: 700 })
    expect(res.fonts.body).toMatchObject({ family: 'Space Grotesk', weight: 400, boldWeight: 700 })
    // Offline too (no fetch at all): still the real face, never a mapped look-alike.
    const offline = await ensureBrandFonts({ headingFont: 'Space Grotesk' }, { cacheDir: tmpCache() })
    expect(offline.heading).toMatchObject({ family: 'Space Grotesk', source: 'bundled' })
    expect(resolveFonts({ headingFont: 'Space Grotesk' }).heading).toEqual({ family: 'Space Grotesk', weight: 700 })
  })

  it('Space Grotesk glyph coverage: es-CR copy incl. ₡ in the face itself; anything it lacks falls back per glyph', () => {
    for (const weight of [400, 700]) {
      expect(missingGlyphs('¿¡Ñ ñ ₡9.900 áéíóú ÁÉÍÓÚ ü € $ % · – — “”', 'Space Grotesk', weight)).toEqual([])
      expect(hasAllGlyphs('¿¡Ñ ₡14.900 · Envío gratis', { family: 'Space Grotesk', weight })).toBe(true)
    }
    // A glyph the face lacks (Cyrillic) is reported missing and drawn with the Fira Sans fallback.
    expect(missingGlyphs('Жж', 'Space Grotesk', 700)).toEqual(['Ж', 'ж'])
    expect(hasAllGlyphs('₡9.900 Жж', { family: 'Space Grotesk', weight: 700 })).toBe(true)
    // ₡ measures with Space Grotesk's own advance, not the fallback's.
    expect(measureText('₡', { family: 'Space Grotesk', weight: 700 }, 100)).not.toBeCloseTo(measureText('₡', { family: 'Fira Sans', weight: 700 }, 100), 3)
  })

  it('the renderer draws the headline in bundled Space Grotesk without any fetch', async () => {
    const scene = await makeScene(600, 750, 'light')
    const r = await renderAd({ format: 'handheld_overlay', ratio: '4:5', sceneImage: scene, copy: SAMPLE_COPY, visual: { headingFont: 'Space Grotesk', bodyFont: 'Space Grotesk' }, language: 'es', layoutFamily: 'editorial_minimal', fonts: { fetch: null, cacheDir: tmpCache() } })
    expect(r.layoutReport.elements.find((e) => e.role === 'headline')!.fontFamily).toBe('Space Grotesk')
    expect(r.layoutReport.fonts.resolution?.heading).toMatchObject({ family: 'Space Grotesk', source: 'bundled' })
  })

  it('without fetch: an unbundled grotesque maps to the closest bundled family (Fira Sans), never the rounded default', async () => {
    const res = await ensureBrandFonts({ headingFont: 'Brand Grotesk' }, { cacheDir: tmpCache() })
    expect(res.heading).toMatchObject({ family: 'Fira Sans', source: 'mapped' })
    expect(res.heading.note).toMatch(/not bundled/)
    expect(resolveFonts({ headingFont: 'Brand Grotesk' }).heading.family).toBe('Fira Sans')
  })

  it('unknown family on Google: mapped fallback + negative cache (no refetch)', async () => {
    const { fn, calls } = fakeFetch({ css: () => null })
    const a = await ensureBrandFonts({ headingFont: 'Totally Unknown Face' }, { fetch: fn, cacheDir: tmpCache() })
    expect(a.heading.source).toBe('default')
    const n = calls.length
    await ensureBrandFonts({ headingFont: 'Totally Unknown Face' }, { fetch: fn, cacheDir: tmpCache() })
    expect(calls.length).toBe(n)
  })

  it('hung network: gives up within the budget', async () => {
    const { fn } = fakeFetch({ hang: true })
    const t0 = Date.now()
    const res = await ensureBrandFonts({ headingFont: 'Slow Font' }, { fetch: fn, cacheDir: tmpCache(), timeoutMs: 80, budgetMs: 400 })
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(res.heading.source).toBe('default')
  })

  it('uploaded kit font (data URL) is used under the kit font name; WOFF2 is rejected', async () => {
    const dataUrl = `data:font/ttf;base64,${BOLD.toString('base64')}`
    const res = await ensureBrandFonts({ headingFont: 'Marca Display', headingFontUrl: dataUrl }, { cacheDir: tmpCache() })
    expect(res.heading).toMatchObject({ family: 'Marca Display', source: 'custom' })
    expect(res.fonts.heading.family).toBe('Marca Display')
    const woff2 = `data:font/woff2;base64,${Buffer.from('wOF2fake-font-bytes-000000').toString('base64')}`
    const bad = await ensureBrandFonts({ headingFont: 'Otra Marca', headingFontUrl: woff2 }, { cacheDir: tmpCache() })
    expect(bad.heading.family).not.toBe('Otra Marca')
  })

  it('names that are not plausible font families never hit the network', async () => {
    const { fn, calls } = fakeFetch({ css: () => css('x') })
    await ensureBrandFonts({ headingFont: 'https://evil.example/x.ttf?a=1' }, { fetch: fn, cacheDir: tmpCache() })
    expect(calls).toHaveLength(0)
  })
})
