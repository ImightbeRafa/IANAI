/**
 * Rules added after the live benchmark (2026-10-08): scene-brief sanitizing per clause,
 * step-number stripping, chip/CTA length by content words + chars, register drift,
 * same-opener headlines, numeric customer quotes kept out of the prompt, full-bleed
 * vision check, per-format setting rotation, before/after split at 9:16.
 */
import { describe, expect, it } from 'vitest'
import { checkAdCopy, sameOpener } from '../../api/lib/adpack/check-copy'
import { checkScene } from '../../api/lib/adpack/check-scene'
import { buildCopyPrompt } from '../../api/lib/adpack/copy'
import { SCENE_NO_TEXT_CLAUSE, sanitizeSceneBrief, stripStepNumber } from '../../api/lib/adpack/copy-shared'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import { renderAd } from '../../api/lib/adpack/render/index'
import { buildScenePrompt, SCENE_SETTINGS, sceneSetting } from '../../api/lib/adpack/scene'
import type { AdAngle, CopyCheckIssue } from '../../api/lib/adpack/types'
import { contentWordCount } from '../../api/lib/adpack/util'
import { caseById, goodSerumCopy } from './helpers'
import { makeScene } from './render-fixtures'
import { PRODUCT_REF, runnerGateway } from './runner-fakes'

const serum = caseById('beauty-serum')
const angle: AdAngle = planAngles({ dna: serum.dna, offer: serum.offer })[0]
const opts = { dna: serum.dna, offer: serum.offer, angle, language: 'es' as const }
const codes = (issues: CopyCheckIssue[]) => issues.map((i) => `${i.code}:${i.field}`)

describe('sanitizeSceneBrief (per clause)', () => {
  it('keeps the visual part of a sentence that also mentions text space', () => {
    const out = sanitizeSceneBrief('Amber bottle on a bathroom shelf, morning light, empty space at the top for text.', 'FALLBACK')
    expect(out).toContain('Amber bottle on a bathroom shelf, morning light')
    expect(out).not.toMatch(/for text/)
    expect(out).not.toContain('FALLBACK')
    expect(out.endsWith(SCENE_NO_TEXT_CLAUSE)).toBe(true)
  })

  it('still drops text requests and falls back when nothing visual is left', () => {
    expect(sanitizeSceneBrief('Add a big headline saying SALE, logo in the corner.', 'FALLBACK')).toContain('FALLBACK')
  })
})

describe('step numbers', () => {
  it('strips leading numbering the template already draws', () => {
    expect(stripStepNumber('1. Limpiá tu piel')).toBe('Limpiá tu piel')
    expect(stripStepNumber('Paso 2: Aplicá 2 gotas')).toBe('Aplicá 2 gotas')
    expect(stripStepNumber('3) Dormí')).toBe('Dormí')
    expect(stripStepNumber('2 gotas de noche')).toBe('2 gotas de noche')
    expect(stripStepNumber('1-2 gotas')).toBe('1-2 gotas')
  })
})

describe('chip / CTA length', () => {
  it('counts content words, with a character cap', () => {
    expect(contentWordCount('Niacinamida 5% y aloe vera')).toBe(4)
    expect(contentWordCount('Escribinos para pedir el tuyo')).toBe(3)
    const ok = checkAdCopy(goodSerumCopy({ bullets: ['Niacinamida 5% y aloe vera'], cta: 'Escribinos para pedirlo' }), opts)
    expect(codes(ok.issues)).not.toContain('too_long:bullets')
    expect(codes(ok.issues)).not.toContain('too_long:cta')
    const long = checkAdCopy(goodSerumCopy({ bullets: ['Niacinamida pura para pieles mixtas'], cta: 'Escribinos ahora mismo por mensaje' }), opts)
    expect(codes(long.issues)).toContain('too_long:bullets')
    expect(codes(long.issues)).toContain('too_long:cta')
  })
})

describe('register drift', () => {
  it('flags voseo in an usted brand, ignores quoted customer words', () => {
    const studio = caseById('beauty-studio')
    const a = planAngles({ dna: studio.dna, offer: studio.offer })[0]
    const o = { dna: studio.dna, offer: studio.offer, angle: a, language: 'es' as const }
    const base = { headline: '¿Maquillarse a las 6 a.m.?', bullets: [], cta: 'Escríbanos hoy', caption: 'Lifting con keratina en una sesión de 60 minutos. Escríbanos por WhatsApp.', sceneBrief: 'Salon chair, soft light.', usedFactKeys: [] }
    expect(codes(checkAdCopy({ ...base, offerLine: undefined }, o).issues).filter((c) => c.startsWith('register'))).toEqual([])
    expect(codes(checkAdCopy({ ...base, cta: 'Escribinos hoy' }, o).issues)).toContain('register:cta')
    expect(codes(checkAdCopy({ ...base, caption: `${base.caption} "¿Vos lo probaste?", dice una clienta.` }, o).issues)).not.toContain('register:caption')
  })
})

describe('same-opener headlines', () => {
  it('flags two headlines that start the same way', () => {
    expect(sameOpener('No compres sérum sin saber esto', 'No compres sérum sin efecto')).toBe(true)
    expect(sameOpener('¿Poros que se notan?', 'Poros abiertos en fotos')).toBe(false)
    const res = checkAdCopy(goodSerumCopy({ headline: 'No compres limpiador que no rinde' }), {
      ...opts,
      otherCopies: [goodSerumCopy({ headline: 'No compres botellas que duran poco' })],
    })
    expect(codes(res.issues)).toContain('duplicate_message:headline')
  })
})

describe('caption repetition', () => {
  it('flags a caption that restates a chip word for word', () => {
    const res = checkAdCopy(goodSerumCopy({ caption: 'Sin sensación pegajosa: 2 gotas de noche y listo. Escribinos y pedí el tuyo.' }), opts)
    expect(codes(res.issues)).toContain('duplicate_message:caption')
    expect(codes(checkAdCopy(goodSerumCopy(), opts).issues)).not.toContain('duplicate_message:caption')
  })
})

describe('copy prompt', () => {
  it('uses a CTA example in the brand register', () => {
    const shampoo = caseById('beauty-shampoo') // tuteo
    const a = planAngles({ dna: shampoo.dna, offer: shampoo.offer })[0]
    const p = buildCopyPrompt({ dna: shampoo.dna, offer: shampoo.offer, angle: a, language: 'es' })
    expect(p.system).toContain('"Escríbenos para pedir"')
    expect(p.system).not.toContain('"Escribinos para pedir"')
  })

  it('keeps customer quotes with unbacked numbers out of the prompt', () => {
    const shampoo = caseById('beauty-shampoo')
    const a = planAngles({ dna: shampoo.dna, offer: shampoo.offer })[0]
    const p = buildCopyPrompt({ dna: shampoo.dna, offer: shampoo.offer, angle: a, language: 'es' })
    expect(p.user).not.toMatch(/Frases reales de clientes[^\n]*dos meses/)
  })
})

describe('scene prompt + check', () => {
  it('rotates settings per format and names the product in plain words', () => {
    const cleaner = caseById('home-cleaner')
    const a = planAngles({ dna: cleaner.dna, offer: cleaner.offer })[0]
    const p0 = buildScenePrompt({ copy: goodSerumCopy(), angle: a, dna: cleaner.dna, offer: cleaner.offer, variation: 0 })
    expect(p0).toContain('home and household brand')
    expect(p0).not.toContain('home garden')
    expect(p0).toContain(cleaner.offer.name)
    expect(p0).toMatch(/full-bleed/)
    for (const list of Object.values(SCENE_SETTINGS)) expect(new Set(list).size).toBe(list.length)
    expect(sceneSetting('offer_graphic', 0)).not.toBe(sceneSetting('offer_graphic', 1))
    expect(sceneSetting('offer_graphic', SCENE_SETTINGS.offer_graphic.length)).toBe(sceneSetting('offer_graphic', 0))
  })

  it('treats blank bars / letterboxing as a failed scene', async () => {
    const gw = runnerGateway({ vision: () => ({ productMatches: true, strayText: false, borders: true, headlineSpace: true, score: 0.8 }) })
    const res = await checkScene({ gateway: gw, sceneImage: PRODUCT_REF, productRef: PRODUCT_REF, language: 'es' })
    expect(res).toMatchObject({ ok: false, borders: true })
  })
})

describe('before_after at 9:16', () => {
  it('splits left/right like the scene (labels side by side)', async () => {
    const scene = await makeScene(1080, 1920, 'warm')
    const copy = { headline: 'Grasa que no sale', bullets: ['Esponja y fuerza', '1 tapa por litro'], cta: 'Escribinos hoy', offerLine: '₡5.900' }
    const res = await renderAd({ format: 'before_after', ratio: '9:16', sceneImage: scene, copy, language: 'es' })
    const labels = res.layoutReport.elements.filter((e) => e.role === 'label')
    expect(labels).toHaveLength(2)
    expect(Math.abs(labels[0].box.y - labels[1].box.y)).toBeLessThan(40)
    expect(labels[0].box.x + labels[0].box.w).toBeLessThan(540)
    expect(labels[1].box.x).toBeGreaterThan(540)
  })
})
