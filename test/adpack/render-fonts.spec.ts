import { describe, expect, it } from 'vitest'
import { copySpaceHint, hasAllGlyphs, makeFrame, matchFamily, measureText, resolveFonts, type FamilyName } from '../../api/lib/adpack/render/index'
import { fitText } from '../../api/lib/adpack/render/text'

const FAMILIES: FamilyName[] = ['Poppins', 'Fira Sans', 'Archivo Black', 'Anton', 'DM Serif Display']

describe('resolveFonts', () => {
  it('maps brand font names to the closest bundled family', () => {
    expect(matchFamily('Montserrat', 'heading')).toBe('Poppins')
    expect(matchFamily('Bebas Neue', 'heading')).toBe('Anton')
    expect(matchFamily('Oswald', 'heading')).toBe('Anton')
    expect(matchFamily('Playfair Display', 'heading')).toBe('DM Serif Display')
    expect(matchFamily('Playfair Display', 'body')).toBe('Fira Sans')
    // #9: Inter is bundled (OFL) — the kit's Inter is drawn as Inter, never swapped for Fira Sans.
    expect(matchFamily('Inter', 'body')).toBe('Inter')
    expect(matchFamily('Interstate', 'body')).toBe('Fira Sans')
    expect(resolveFonts({ headingFont: 'Space Grotesk', bodyFont: 'Inter' })).toMatchObject({
      heading: { family: 'Space Grotesk', weight: 700 },
      body: { family: 'Inter', weight: 400, boldWeight: 700 },
      match: { heading: 'exact', body: 'exact' },
    })
    expect(matchFamily('"Helvetica Neue", Arial', 'heading')).toBe('Fira Sans')
    expect(matchFamily('Archivo Black', 'heading')).toBe('Archivo Black')
    expect(matchFamily('Wingdings Fantasy XYZ', 'heading')).toBeNull()
  })

  it('falls back to Poppins and keeps body multi-weight', () => {
    expect(resolveFonts(undefined)).toMatchObject({ heading: { family: 'Poppins', weight: 800 }, body: { family: 'Poppins' }, match: { heading: 'default' } })
    const r = resolveFonts({ headingFont: 'Anton', bodyFont: 'Anton' })
    expect(r.heading.family).toBe('Anton')
    expect(['Poppins', 'Fira Sans']).toContain(r.body.family)
    expect(resolveFonts({ headingFont: 'Lora' }).body.family).toBe('Fira Sans')
  })
})

describe('glyph coverage', () => {
  it('every bundled family (with fallback) draws Spanish + ₡', () => {
    for (const family of FAMILIES) {
      for (const weight of [400, 700, 800]) expect(hasAllGlyphs('¿¡ÁÉÍÓÚÜÑ áéíóúüñ ₡9.900 · 2x1 – “ok” % $ €', { family, weight })).toBe(true)
    }
  })
})

describe('fitText', () => {
  const font = { family: 'Poppins' as const, weight: 800 }
  it('fits within width and line cap, shrinking as needed', () => {
    const f = fitText({ text: 'Una frase bastante larga para un titular de anuncio en redes', font, maxWidth: 600, maxLines: 3, maxSize: 120, minSize: 40, lineHeight: 1.1, balance: true })
    expect(f.fits).toBe(true)
    expect(f.lines.length).toBeLessThanOrEqual(3)
    expect(f.lines.join(' ')).toBe(f.text)
    for (const l of f.lines) expect(measureText(l, font, f.fontSize)).toBeLessThanOrEqual(600)
    expect(f.fontSize).toBeLessThan(120)
  })

  it('reports fits=false (and still never overflows) for an impossible token', () => {
    const f = fitText({ text: 'Supercalifragilisticoespialidosoextraordinariamente', font, maxWidth: 200, maxLines: 2, maxSize: 80, minSize: 40, lineHeight: 1.1 })
    expect(f.fits).toBe(false)
    for (const l of f.lines) expect(measureText(l, font, f.fontSize)).toBeLessThanOrEqual(200)
  })
})

describe('frames', () => {
  it('9:16 keeps text out of the top 14% / bottom 20%', () => {
    const f = makeFrame('9:16')
    expect(f.safe.y).toBeGreaterThanOrEqual(1920 * 0.14 - 1)
    expect(f.safe.y + f.safe.h).toBeLessThanOrEqual(1920 * 0.8 + 1)
    expect(copySpaceHint('offer_graphic', '9:16')).toMatch(/top/)
  })
})
