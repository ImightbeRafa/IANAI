import { describe, expect, it } from 'vitest'
import {
  checkCompliance,
  complianceGuidance,
  getDisallowedFormats,
  getRequiredDisclaimer,
  isFormatAllowed,
} from '../../api/lib/adpack/compliance'
import type { BusinessCategory, DnaFact } from '../../api/lib/adpack/types'

const ids = (text: string, category: BusinessCategory, language: 'es' | 'en' = 'es', facts?: DnaFact[]) =>
  checkCompliance(text, category, language, { facts }).filter((i) => i.severity === 'block').map((i) => i.ruleId)

describe('health_wellness pack', () => {
  it('blocks cure/treat/prevent disease claims', () => {
    expect(ids('Cura la diabetes de forma natural', 'health_wellness')).toContain('health_disease_claim')
    expect(ids('Previene enfermedades del corazón', 'health_wellness')).toContain('health_disease_claim')
    expect(ids('Treats anxiety in days', 'health_wellness', 'en')).toContain('health_disease_claim')
  })
  it('blocks weight-loss promises and GLP-1/drug references', () => {
    expect(ids('Bajá 5 kilos en un mes', 'health_wellness')).toContain('weight_loss_promise')
    expect(ids('Quema grasa mientras dormís', 'health_wellness')).toContain('weight_loss_promise')
    expect(ids('Lose 10 pounds fast', 'health_wellness', 'en')).toContain('weight_loss_promise')
    expect(ids('El GLP-1 natural', 'health_wellness')).toContain('drug_glp1_reference')
    expect(ids('Better than Ozempic', 'health_wellness', 'en')).toContain('drug_glp1_reference')
  })
  it('blocks fake doctor endorsements unless a certification is confirmed', () => {
    expect(ids('Recomendado por médicos', 'health_wellness')).toContain('fake_expert_endorsement')
    expect(ids('Doctor-recommended formula', 'health_wellness', 'en')).toContain('fake_expert_endorsement')
    const cert: DnaFact = { key: 'certification', value: 'Avalado por el Colegio de Nutricionistas', source: 'user', confirmed: true }
    expect(ids('Recomendado por nutricionistas', 'health_wellness', 'es', [cert])).not.toContain('fake_expert_endorsement')
  })
  it('blocks body before/after and personal-attribute assertions', () => {
    expect(ids('Mirá este antes y después', 'health_wellness')).toContain('health_before_after')
    expect(ids('¿Tenés sobrepeso?', 'health_wellness')).toContain('health_personal_attribute')
    expect(getDisallowedFormats('health_wellness')).toContain('before_after')
    expect(isFormatAllowed('health_wellness', 'before_after')).toBe(false)
    expect(isFormatAllowed('fitness_sports', 'before_after')).toBe(false)
  })
})

describe('beauty pack', () => {
  it('allows before/after only with a disclaimer and never guaranteed results', () => {
    expect(isFormatAllowed('beauty', 'before_after')).toBe(true)
    expect(getRequiredDisclaimer('beauty', 'before_after', 'es')).toBe('Resultados pueden variar.')
    const without = checkCompliance('Antes y después de 4 semanas', 'beauty', 'es', { format: 'before_after' })
    expect(without.map((i) => i.ruleId)).toContain('missing_disclaimer')
    const withIt = checkCompliance('Antes y después. Resultados pueden variar.', 'beauty', 'es', { format: 'before_after' })
    expect(withIt.map((i) => i.ruleId)).not.toContain('missing_disclaimer')
    expect(ids('Resultados garantizados', 'beauty')).toContain('beauty_guaranteed_results')
    expect(ids('Guaranteed results', 'beauty', 'en')).toContain('beauty_guaranteed_results')
  })
})

describe('finance pack', () => {
  it('blocks guaranteed returns, risk-free and income promises', () => {
    expect(ids('Rendimientos garantizados del 12%', 'finance')).toContain('finance_guaranteed_returns')
    expect(ids('Invertí sin riesgo', 'finance')).toContain('finance_guaranteed_returns')
    expect(ids('Guaranteed returns every month', 'finance', 'en')).toContain('finance_guaranteed_returns')
    expect(ids('Double your money', 'finance', 'en')).toContain('finance_guaranteed_returns')
    expect(isFormatAllowed('finance', 'before_after')).toBe(false)
  })
})

describe('generic pack', () => {
  it('blocks fake scarcity and fabricated statistics/reviews unless confirmed', () => {
    expect(ids('Solo quedan 3 unidades', 'home_garden')).toContain('fake_scarcity')
    expect(ids('Only 5 left!', 'tech_electronics', 'en')).toContain('fake_scarcity')
    expect(ids('9 de cada 10 clientes lo recompran', 'home_garden')).toContain('fabricated_statistic')
    expect(ids('Más de 2.000 vendidos y +5000 clientes', 'tech_electronics')).toContain('fabricated_statistic')
    expect(ids('★★★★★ según nuestras clientas', 'beauty')).toContain('fabricated_review')
    const proof: DnaFact = { key: 'proof_number', value: '9 de cada 10 clientes lo recompran', source: 'user', confirmed: true }
    expect(ids('9 de cada 10 clientes lo recompran', 'home_garden', 'es', [proof])).not.toContain('fabricated_statistic')
    const unconfirmedProof: DnaFact = { ...proof, confirmed: false }
    expect(ids('9 de cada 10 clientes lo recompran', 'home_garden', 'es', [unconfirmedProof])).toContain('fabricated_statistic')
  })
  it('vague scarcity is only a warning', () => {
    const hits = checkCompliance('Últimas unidades', 'other', 'es')
    expect(hits.map((h) => [h.ruleId, h.severity])).toEqual([['vague_scarcity', 'warn']])
  })
  it('does not flag ordinary copy', () => {
    const benign = [
      ['Elimina grasa y sarro de la cocina', 'home_garden'],
      ['Jamón curado y quesos para compartir', 'food_beverage'],
      ['Tostamos cada lunes y enviamos esa misma semana', 'food_beverage'],
      ['Cambio de talla gratis en 30 días', 'fashion_apparel'],
      ['Clases de 45 minutos con entrenador', 'fitness_sports'],
      ['Rutina de noche más tranquila', 'health_wellness'],
    ] as const
    for (const [text, cat] of benign) expect(ids(text, cat)).toEqual([])
  })
  it('exposes prompt guidance per category', () => {
    expect(complianceGuidance('health_wellness', 'es').length).toBeGreaterThan(4)
    expect(complianceGuidance('finance', 'en').some((l) => /guaranteed returns/i.test(l))).toBe(true)
  })
})
