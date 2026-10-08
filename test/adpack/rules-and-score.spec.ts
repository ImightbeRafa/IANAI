import { describe, expect, it } from 'vitest'
import { archetypeBlock, IAN_ARCHETYPES, IAN_CORE_RULES, REGISTER_MARKERS, registerInstruction } from '../../api/lib/adpack/ian-rules'
import { ALL_FORMATS, CATEGORY_PATTERNS, FORMAT_PATTERNS, headlineMaxWords, UNIVERSAL_AD_RULES } from '../../api/lib/adpack/patterns'
import { isFormatAllowed } from '../../api/lib/adpack/compliance'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import { scoreAdCopy } from '../../api/lib/adpack/score-copy'
import type { BusinessCategory } from '../../api/lib/adpack/types'
import { fakeGateway } from './fake-gateway'
import { caseById, goodSerumCopy } from './helpers'

const REAL_BRANDS = /patchhouse|pura sonrisa|deepclean|\bforge\b|\bsleep\b|\baura\b|ceradita|enceradit/i

describe('IAN rules', () => {
  it('has ES + EN core rules with the key principles', () => {
    expect(IAN_CORE_RULES.es).toMatch(/CERTEZA TOTAL/)
    expect(IAN_CORE_RULES.es).toMatch(/CERO SALUDOS/)
    expect(IAN_CORE_RULES.es).toMatch(/NO REITERACIÓN/)
    expect(IAN_CORE_RULES.en).toMatch(/TOTAL CERTAINTY/)
    expect(IAN_CORE_RULES.en).toMatch(/ZERO GREETINGS/)
  })

  it('covers every archetype with a formula and 1–2 generic examples', () => {
    for (const [key, spec] of Object.entries(IAN_ARCHETYPES)) {
      for (const lang of ['es', 'en'] as const) {
        expect(spec.formula[lang].length, key).toBeGreaterThan(20)
        expect(spec.examples[lang].length).toBeGreaterThanOrEqual(1)
        expect(spec.examples[lang].length).toBeLessThanOrEqual(2)
        expect(archetypeBlock(key as keyof typeof IAN_ARCHETYPES, lang)).toContain(spec.label[lang])
      }
    }
  })

  it('never hardcodes real customer brands', () => {
    const blob = JSON.stringify({ IAN_CORE_RULES, IAN_ARCHETYPES, CATEGORY_PATTERNS, FORMAT_PATTERNS, UNIVERSAL_AD_RULES })
    expect(blob).not.toMatch(REAL_BRANDS)
  })

  it('register helpers', () => {
    expect(registerInstruction('voseo', 'es')).toMatch(/vos.*tenés.*escribinos/)
    expect(registerInstruction('tuteo', 'es')).toMatch(/tú.*tienes.*escríbenos/)
    expect(registerInstruction('usted', 'es')).toMatch(/usted.*tiene.*escríbanos/)
    expect(registerInstruction(undefined, 'es')).toBe(registerInstruction('tuteo', 'es'))
    expect(registerInstruction('voseo', 'en')).toMatch(/^REGISTER:/)
    expect(REGISTER_MARKERS.voseo.test('Pedí el tuyo')).toBe(true)
    expect(REGISTER_MARKERS.tuteo.test('Pide el tuyo')).toBe(true)
    expect(REGISTER_MARKERS.usted.test('Escríbanos hoy')).toBe(true)
  })
})

describe('pattern library', () => {
  it('every category prefers only allowed formats first and has hooks/archetypes', () => {
    for (const [cat, p] of Object.entries(CATEGORY_PATTERNS)) {
      expect(p.formats.length).toBeGreaterThanOrEqual(4)
      expect(p.hooks.length).toBeGreaterThanOrEqual(5)
      expect(p.archetypes[0]).toBeDefined()
      for (const f of p.formats) expect(isFormatAllowed(cat as BusinessCategory, f), `${cat}/${f}`).toBe(true)
    }
  })
  it('every format has layout intent in both languages and a visual-only scene intent', () => {
    for (const f of ALL_FORMATS) {
      expect(FORMAT_PATTERNS[f].layout.es.length).toBeGreaterThan(20)
      expect(FORMAT_PATTERNS[f].layout.en.length).toBeGreaterThan(20)
      expect(FORMAT_PATTERNS[f].sceneIntent).not.toMatch(/\btext\b|\bheadline\b|\blogo\b/i)
    }
    expect(headlineMaxWords('explainer')).toBe(8)
    expect(headlineMaxWords('offer_graphic')).toBe(6)
  })
})

describe('scoreAdCopy', () => {
  const c = caseById('beauty-serum')
  const angle = planAngles({ dna: c.dna, offer: c.offer, size: 1 })[0]

  it('averages and clamps the rubric, returns reasons', async () => {
    const gw = fakeGateway((call) => {
      expect(call.system).toMatch(/MÉTODO IAN/)
      expect(call.user).toContain('₡12.900')
      expect(call.user).not.toContain('Reduce poros en 7 días')
      return {
        criteria: {
          hook_filters: 8,
          single_message: 9,
          tangible_benefit: 7,
          no_repetition: 8,
          cold_direct_cta: 15,
          on_image_brevity: 9,
          faithful_to_facts: 10,
          register: 9,
        },
        reasons: ['CTA podría ser más corto', ''],
      }
    })
    const res = await scoreAdCopy({ gateway: gw, copy: goodSerumCopy(), angle, dna: c.dna, offer: c.offer, language: 'es' })
    expect(res.criteria.cold_direct_cta).toBe(10)
    expect(res.score).toBe(8.8)
    expect(res.reasons).toEqual(['CTA podría ser más corto'])
  })

  it('falls back to overall when criteria are missing', async () => {
    const gw = fakeGateway(() => ({ overall: 6.5 }))
    const res = await scoreAdCopy({ gateway: gw, copy: goodSerumCopy(), angle, dna: c.dna, language: 'es' })
    expect(res.score).toBe(6.5)
    expect(res.reasons).toEqual([])
  })
})
