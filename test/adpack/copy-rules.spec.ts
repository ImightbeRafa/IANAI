/**
 * E1 (rejections with reasons, fewer false rejections), E2 (forbidden phrases / claims verified
 * everywhere) and E3 (locale register as a hard rule). Deterministic checker only — no models.
 */
import { describe, expect, it } from 'vitest'
import { checkAdCopy, findForbiddenHits, isExclusionStatement } from '../../api/lib/adpack/check-copy'
import { buildCopyPrompt } from '../../api/lib/adpack/copy'
import { buildOfferLine, mergeFacts } from '../../api/lib/adpack/facts'
import { registerInstruction } from '../../api/lib/adpack/ian-rules'
import { BLOCKING_COPY_CODES, EDIT_BLOCKING_COPY_CODES } from '../../api/lib/adpack/pack-runner'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import { applyDnaOverrides, toCopyRejections } from '../../api/lib/adpack/service'
import type { AdAngle, AdCopy, BrandDna, OfferInput } from '../../api/lib/adpack/types'
import { caseById, goodSerumCopy } from './helpers'

const serum = caseById('beauty-serum')
const angle: AdAngle = planAngles({ dna: serum.dna, offer: serum.offer })[0]
const opts = { dna: serum.dna, offer: serum.offer, angle, language: 'es' as const }

/** A generic paper-plane kit (not a real customer brand). */
const kitDna: BrandDna = {
  ...serum.dna,
  brandName: 'Taller Demo',
  category: 'kids_baby',
  register: 'voseo',
  facts: [
    { key: 'brand_name', value: 'Taller Demo', source: 'user', confirmed: true },
    { key: 'custom:excluye', value: 'Papel no incluido', source: 'user', confirmed: false },
    { key: 'usage_steps', value: 'Doblá el papel, montá el chasis y volalo', source: 'user', confirmed: true },
  ],
  forbiddenPhrases: [],
}
const kitOffer: OfferInput = {
  name: 'Kit Avión de Papel',
  facts: [{ key: 'price', value: '₡14.900', source: 'offer_form', confirmed: true }],
  productImageUrls: [],
}
const stepsAngle: AdAngle = {
  id: 'a01-paso_a_paso-routine-how_to_steps',
  archetype: 'paso_a_paso',
  hookType: 'routine',
  format: 'how_to_steps',
  message: 'Armalo en pasos simples',
  target: 'armarlo fácil',
  factKeys: ['usage_steps', 'price'],
}
const kitOfferLine = buildOfferLine(mergeFacts(kitDna, kitOffer), 'es')

function kitCopy(overrides: Partial<AdCopy> = {}): AdCopy {
  return {
    headline: 'Tu avión en 3 pasos',
    subline: 'Doblá, montá y volalo hoy',
    bullets: ['01 Doblá el papel', '02 Montá el chasis', '03 Volalo'],
    offerLine: kitOfferLine,
    cta: 'Pedí el tuyo',
    caption: 'Un kit para armar tu avión de papel en casa: doblá el papel, montá el chasis y volalo en el patio. Escribinos y pedí el tuyo.',
    sceneBrief: 'Paper plane kit on a wooden desk, warm side light, clean empty space at the top. No added text, letters, numbers, logos, signs or watermarks anywhere in the scene.',
    usedFactKeys: ['usage_steps', 'price'],
    ...overrides,
  }
}
const kitOpts = { dna: kitDna, offer: kitOffer, angle: stepsAngle, language: 'es' as const }

describe('E1 rejections carry field, rule, limit, actual, token', () => {
  it('a chip over the limit reports bullets[i] with limit vs actual', () => {
    const res = checkAdCopy(goodSerumCopy({ bullets: ['Niacinamida 5%', 'Se absorbe rápido', 'Textura ligera que se absorbe muy rápido'] }), opts)
    const issue = res.issues.find((i) => i.code === 'too_long')!
    expect(issue).toMatchObject({ field: 'bullets', path: 'bullets[2]', limit: 4, actual: 7 })
    expect(toCopyRejections([issue])[0]).toMatchObject({ field: 'bullets[2]', baseField: 'bullets', rule: 'too_long', limit: 4, actual: 7 })
  })

  it('a chars-only overflow reports the char limit (26) and the actual length', () => {
    const res = checkAdCopy(goodSerumCopy({ bullets: ['Niacinamida 5%', 'Absorción ultrarrápida garantizadísima'] }), opts)
    expect(res.issues.find((i) => i.code === 'too_long' && i.path === 'bullets[1]')).toMatchObject({ limit: 26, actual: 38 })
  })

  it('fact rules name the offending token', () => {
    const res = checkAdCopy(goodSerumCopy({ headline: 'Sérum a ₡9.900 hoy' }), opts)
    expect(res.issues.find((i) => i.code === 'number_mismatch')).toMatchObject({ field: 'headline', token: '9.900' })
    const unconfirmed = checkAdCopy(goodSerumCopy({ caption: 'Reduce poros en 7 días con niacinamida 5% y aloe vera. Envíos a todo Costa Rica por Correos. Escribinos y pedí el tuyo.' }), opts)
    expect(unconfirmed.issues.find((i) => i.code === 'unconfirmed_fact')).toMatchObject({ field: 'caption', token: expect.any(String) })
  })

  it('script length issues point at script.hook / script.development / script.cta', () => {
    const long = Array.from({ length: 25 }, () => 'palabra').join(' ')
    const res = checkAdCopy(goodSerumCopy({ script: { hook: long, development: 'ok', cta: 'Pedí el tuyo' } }), opts)
    expect(res.issues.find((i) => i.code === 'too_long' && i.field === 'script')).toMatchObject({ path: 'script.hook', limit: 20, actual: 25 })
  })
})

describe('E1 legit edits are no longer rejected', () => {
  it('"01/02/03" step labels are structure, not facts', () => {
    expect(checkAdCopy(kitCopy(), kitOpts).issues).toEqual([])
    expect(checkAdCopy(kitCopy({ headline: 'Pasos 01 / 02 / 03' }), kitOpts).issues).toEqual([])
    // Position-matching leading numbers in any format ("1 Doblá" as the first chip).
    const offerAngle = { ...stepsAngle, format: 'offer_graphic' as const }
    expect(checkAdCopy(kitCopy({ bullets: ['1 Doblá el papel', '2 Montá el chasis'] }), { ...kitOpts, angle: offerAngle }).issues.filter((i) => i.code === 'number_mismatch')).toEqual([])
    // A real count still needs a fact.
    expect(checkAdCopy(kitCopy({ bullets: ['5 aviones distintos', '02 Montá el chasis'] }), { ...kitOpts, angle: offerAngle }).issues.map((i) => i.code)).toContain('number_mismatch')
  })

  it('"Kit ₡14.900 · Papel no incluido": confirmed price + a stated exclusion pass as an owner edit', () => {
    expect(isExclusionStatement('Papel no incluido')).toBe(true)
    const copy = kitCopy({ bullets: ['01 Doblá el papel', '02 Montá el chasis', 'Kit ₡14.900 · Papel no incluido'] })
    const edit = checkAdCopy(copy, { ...kitOpts, userEdit: true })
    expect(edit.issues.filter((i) => EDIT_BLOCKING_COPY_CODES.has(i.code))).toEqual([])
    // The model's stricter chip budget still applies to generated copy, with a precise reason.
    const generated = checkAdCopy(copy, kitOpts)
    expect(generated.issues).toEqual([expect.objectContaining({ code: 'too_long', path: 'bullets[2]', limit: 4, actual: 5 })])
  })

  it('an owner-written offer line is fine when every part is a confirmed fact or a stated exclusion', () => {
    const ok = checkAdCopy(kitCopy({ offerLine: 'Kit ₡14.900 · Papel no incluido' }), { ...kitOpts, userEdit: true })
    expect(ok.issues).toEqual([])
    const wrongPrice = checkAdCopy(kitCopy({ offerLine: 'Kit ₡12.900 · Papel no incluido' }), { ...kitOpts, userEdit: true })
    expect(wrongPrice.issues).toEqual([expect.objectContaining({ code: 'number_mismatch', field: 'offerLine', token: 'Kit ₡12.900' })])
    // Generated copy keeps the deterministic offer line.
    expect(checkAdCopy(kitCopy({ offerLine: 'Kit ₡14.900 · Papel no incluido' }), kitOpts).issues.map((i) => i.code)).toEqual(['number_mismatch'])
  })

  it('an exclusion not stated in the facts is still checked as a claim', () => {
    const res = checkAdCopy(kitCopy({ subline: 'Garantía no incluida, envío gratis' }), kitOpts)
    expect(res.issues.map((i) => i.code)).toContain('unconfirmed_fact')
  })
})

describe('E2 forbidden phrases and claims', () => {
  const dna: BrandDna = { ...serum.dna, forbiddenPhrases: ['milagroso'], forbiddenClaims: ['armado en minutos'] }

  it('are found on image text, caption, script and scene, with the exact field', () => {
    const copy = goodSerumCopy({
      bullets: ['Niacinamida 5%', 'Efecto milagroso'],
      caption: goodSerumCopy().caption + ' Queda armado en minutos.',
      script: { hook: 'Un sérum MILAGROSO para tus poros.', development: 'ok', cta: 'Pedí el tuyo' },
    })
    expect(findForbiddenHits(copy, dna).map((h) => [h.phrase, h.field])).toEqual([
      ['milagroso', 'bullets[1]'],
      ['milagroso', 'script.hook'],
      ['armado en minutos', 'caption'],
    ])
    const res = checkAdCopy(copy, { ...opts, dna })
    const forbidden = res.issues.filter((i) => i.code === 'forbidden_phrase')
    expect(forbidden.map((i) => i.path ?? i.field)).toEqual(['bullets[1]', 'script.hook', 'caption'])
    expect(forbidden.every((i) => BLOCKING_COPY_CODES.has(i.code))).toBe(true)
  })

  it('reach the copy prompt as a hard list', () => {
    const prompt = buildCopyPrompt({ dna, offer: serum.offer, angle, language: 'es' })
    expect(prompt.user).toContain('milagroso')
    expect(prompt.user).toContain('armado en minutos')
  })

  it('request-level lists merge with the kit list', () => {
    const merged = applyDnaOverrides({ ...serum.dna, forbiddenPhrases: ['barato'] }, { forbiddenPhrases: ['milagroso'], forbiddenClaims: ['cura'] })
    expect(merged.forbiddenPhrases).toEqual(['barato', 'milagroso'])
    expect(merged.forbiddenClaims).toEqual(['cura'])
  })
})

describe('E3 locale register as a hard rule', () => {
  const cr = applyDnaOverrides(serum.dna, { locale: 'es-cr' })

  it('es-CR normalizes and defaults to voseo', () => {
    expect(cr.locale).toBe('es-CR')
    expect(cr.register).toBe('voseo')
    expect(applyDnaOverrides(serum.dna, { locale: 'es-MX' }).register).toBe(serum.dna.register)
    expect(applyDnaOverrides(serum.dna, { locale: 'es-CR', register: 'usted' }).register).toBe('usted')
    expect(() => applyDnaOverrides(serum.dna, { locale: 'Costa Rica' })).toThrow(/locale/)
  })

  it('CR voseo copy passes', () => {
    expect(checkAdCopy(goodSerumCopy(), { ...opts, dna: cr }).issues).toEqual([])
  })

  it('tuteo in CR is blocking (locale_register), with the token and field', () => {
    const res = checkAdCopy(goodSerumCopy({ subline: 'Si tienes poros abiertos, esto es para ti', cta: 'Pídelo hoy' }), { ...opts, dna: cr })
    const hard = res.issues.filter((i) => i.code === 'locale_register')
    expect(hard.map((i) => [i.path ?? i.field, i.token?.toLowerCase()])).toEqual([['subline', 'tienes'], ['cta', 'pídelo']])
    expect(BLOCKING_COPY_CODES.has('locale_register')).toBe(true)
  })

  it('sentence-initial tuteo / usted imperatives are caught; the same word mid-sentence is not', () => {
    const start = checkAdCopy(goodSerumCopy({ headline: 'Descubre tu piel nueva' }), { ...opts, dna: cr })
    expect(start.issues.map((i) => i.code)).toContain('locale_register')
    const usted = checkAdCopy(goodSerumCopy({ subline: 'Aproveche la promo de hoy' }), { ...opts, dna: cr })
    expect(usted.issues.map((i) => i.code)).toContain('locale_register')
    const third = checkAdCopy(goodSerumCopy({ subline: 'Tu piel descubre la calma de noche' }), { ...opts, dna: cr })
    expect(third.issues.map((i) => i.code)).not.toContain('locale_register')
  })

  it('without a locale the register stays a soft note (not blocking)', () => {
    const res = checkAdCopy(goodSerumCopy({ subline: 'Si tienes poros abiertos, esto es para ti' }), opts)
    expect(res.issues.map((i) => i.code)).toContain('register')
    expect(res.issues.map((i) => i.code)).not.toContain('locale_register')
    expect(BLOCKING_COPY_CODES.has('register')).toBe(false)
  })

  it('the prompt states it as a hard constraint', () => {
    expect(registerInstruction('voseo', 'es', 'es-CR')).toMatch(/REGLA DURA \(locale es-CR\)/)
    expect(registerInstruction('voseo', 'es')).not.toMatch(/REGLA DURA/)
    expect(buildCopyPrompt({ dna: cr, offer: serum.offer, angle, language: 'es' }).system).toMatch(/REGLA DURA/)
  })
})
