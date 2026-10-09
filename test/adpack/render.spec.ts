import { beforeAll, describe, expect, it } from 'vitest'
import { ALL_FORMATS, renderAd } from '../../api/lib/adpack/render/index'
import type { AdFormat } from '../../api/lib/adpack/types'
import { assertPng, assertReport, hexLum, sampledContrast } from './render-assert'
import { makeBusyScene, makeScene, makeSolidScene, SAMPLE_COPY } from './render-fixtures'

let warm: Buffer

beforeAll(async () => {
  warm = await makeScene(1200, 1500, 'warm')
})

describe('contrast guard', () => {
  it('busy background gets a panel and the headline still reaches 4.5:1', async () => {
    const res = await renderAd({
      format: 'handheld_overlay',
      ratio: '9:16',
      sceneImage: await makeBusyScene(),
      copy: { ...SAMPLE_COPY, bullets: [] },
      visual: { primaryColor: '#e11d48', headingFont: 'Anton' },
      language: 'es',
      debug: { returnBase: true },
    })
    const head = res.layoutReport.elements.find((e) => e.role === 'headline')!
    expect(head.background).toMatchObject({ kind: 'scene', treatment: 'box' })
    expect(await sampledContrast(res.basePng!, head.box, head.color)).toBeGreaterThanOrEqual(4.5)
    assertReport(res.layoutReport, 'handheld_overlay', '9:16', { ...SAMPLE_COPY, bullets: [] })
  })

  it('picks dark text on white and light text on black', async () => {
    const copy = { ...SAMPLE_COPY, bullets: [] }
    const onWhite = await renderAd({ format: 'handheld_overlay', ratio: '1:1', sceneImage: await makeSolidScene('#ffffff'), copy, language: 'es' })
    const onBlack = await renderAd({ format: 'handheld_overlay', ratio: '1:1', sceneImage: await makeSolidScene('#000000'), copy, language: 'es' })
    const h1 = onWhite.layoutReport.elements.find((e) => e.role === 'headline')!
    const h2 = onBlack.layoutReport.elements.find((e) => e.role === 'headline')!
    expect(hexLum(h1.color)).toBeLessThan(0.1)
    expect(hexLum(h2.color)).toBeGreaterThan(0.9)
    expect(h1.contrast).toBeGreaterThan(10)
    expect(h2.contrast).toBeGreaterThan(10)
  })
})

describe('text fitting', () => {
  it('a long headline shrinks, stays within 3 lines and never overflows', async () => {
    const longHeadline = 'La crema de aguacate costarricense que hidrata, repara y protege tu piel todos los días del año sin falta'
    for (const format of ['offer_graphic', 'handheld_overlay', 'explainer'] as AdFormat[]) {
      const short = await renderAd({ format, ratio: '1:1', sceneImage: warm, copy: SAMPLE_COPY, language: 'es' })
      const long = await renderAd({ format, ratio: '1:1', sceneImage: warm, copy: { ...SAMPLE_COPY, headline: longHeadline }, language: 'es' })
      const hs = short.layoutReport.elements.find((e) => e.role === 'headline')!
      const hl = long.layoutReport.elements.find((e) => e.role === 'headline')!
      expect(hl.text).toBe(longHeadline)
      expect(hl.fontSize).toBeLessThan(hs.fontSize)
      expect(hl.lines.length).toBeLessThanOrEqual(3)
      assertReport(long.layoutReport, format, '1:1', { ...SAMPLE_COPY, headline: longHeadline })
    }
  })

  it('collapses whitespace but keeps every character (accents, ñ, ₡, ¿¡)', async () => {
    const res = await renderAd({
      format: 'offer_graphic',
      ratio: '4:5',
      sceneImage: warm,
      copy: { ...SAMPLE_COPY, headline: '  ¡Señora,   ¿ya   probó?  ', offerLine: '₡12.500  ·  2x1' },
      language: 'es',
    })
    const els = res.layoutReport.elements
    expect(els.find((e) => e.role === 'headline')!.text).toBe('¡Señora, ¿ya probó?')
    expect(els.find((e) => e.role === 'offer')!.text).toBe('₡12.500 · 2x1')
  })
})

describe('graceful degradation', () => {
  it('renders every format without logo, subline, bullets, offer or cut-out', async () => {
    const copy = { headline: 'Hecho para vos', bullets: [] as string[], cta: 'Comprá ya' }
    for (const format of ALL_FORMATS) {
      const res = await renderAd({ format, ratio: '1:1', sceneImage: warm, copy, language: 'es' })
      await assertPng(res, '1:1')
      assertReport(res.layoutReport, format, '1:1', { ...copy, subline: undefined, offerLine: undefined } as typeof SAMPLE_COPY)
      expect(res.layoutReport.logo).toBeNull()
      expect(res.layoutReport.product).toBeNull()
    }
  })

  it('skips an undecodable logo with a warning', async () => {
    const res = await renderAd({ format: 'offer_graphic', ratio: '1:1', sceneImage: warm, copy: SAMPLE_COPY, logo: Buffer.from('not an image'), language: 'es' })
    expect(res.layoutReport.logo).toBeNull()
    expect(res.layoutReport.warnings.join(' ')).toMatch(/logo/)
    assertReport(res.layoutReport, 'offer_graphic', '1:1')
  })

  it('accepts a data URL scene and English labels', async () => {
    const dataUrl = `data:image/jpeg;base64,${warm.toString('base64')}`
    const copy = { headline: 'From dull to glowing', bullets: ['Dry, tight skin', 'Soft, hydrated skin'], cta: 'Shop now', offerLine: '$19 · Free shipping' }
    const res = await renderAd({ format: 'before_after', ratio: '4:5', sceneImage: dataUrl, copy, language: 'en' })
    assertReport(res.layoutReport, 'before_after', '4:5', copy as typeof SAMPLE_COPY, 'en')
  })
})

describe('owner-edit chip tolerance (E1)', () => {
  it('a chip at the edit limit ("Kit ₡14.900 · Papel no incluido") fits in every ratio of the chip formats', async () => {
    const { EDIT_BULLET_LIMITS } = await import('../../api/lib/adpack/check-copy')
    const chip = 'Kit ₡14.900 · Papel no incluido'.padEnd(EDIT_BULLET_LIMITS.chars, '!')
    const copy = { ...SAMPLE_COPY, bullets: ['01 Doblá el papel', chip] }
    for (const format of ['offer_graphic', 'how_to_steps', 'explainer'] as AdFormat[]) {
      for (const ratio of ['4:5', '9:16', '1:1'] as const) {
        const res = await renderAd({ format, ratio, sceneImage: warm, copy, language: 'es' })
        await assertPng(res, ratio)
        assertReport(res.layoutReport, format, ratio, copy)
      }
    }
  })
})
