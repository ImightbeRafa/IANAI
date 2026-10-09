import { describe, expect, it } from 'vitest'
import { ALL_ANGLE_CATEGORIES, ANGLE_CATEGORIES, angleId, parseAngleId } from '../../api/lib/adpack/angle-catalog'
import { checkAdCopy } from '../../api/lib/adpack/check-copy'
import { CLICHE_PATTERNS, findCliches } from '../../api/lib/adpack/cliches'
import { generatePackCopy } from '../../api/lib/adpack/copy'
import { confirmedKeys, mergeFacts } from '../../api/lib/adpack/facts'
import { BLOCKING_COPY_CODES } from '../../api/lib/adpack/pack-runner'
import { angleFromId, planAngles } from '../../api/lib/adpack/plan-angles'
import type { BrandDna } from '../../api/lib/adpack/types'
import { BENCHMARK_OFFERS } from '../fixtures/adpack/benchmark-offers'
import { fakeGateway } from './fake-gateway'
import { caseById, goodSerumCopy } from './helpers'

const NON_PRODUCT = new Set(['services_local', 'finance', 'education'])

describe('angle catalog ids', () => {
  it('round-trips catalog ids and understands legacy planner ids', () => {
    expect(parseAngleId('regalo-desire-handheld_overlay')).toEqual({ category: 'regalo', hookType: 'desire', format: 'handheld_overlay', legacy: false })
    expect(parseAngleId(angleId('problema_solucion', 'pain', 'before_after'))?.category).toBe('problema_solucion')
    expect(parseAngleId('a03-venta_directa-pain-offer_graphic')).toMatchObject({ category: 'problema_solucion', hookType: 'pain', format: 'offer_graphic', archetype: 'venta_directa', legacy: true })
    expect(parseAngleId('angle_1')).toBeNull()
    expect(parseAngleId('regalo-nope-offer_graphic')).toBeNull()
  })

  it('has the 10 categories incl. gift, how it works, value, unboxing, real use, technical detail, comparison, season, problem→solution, social proof', () => {
    expect(new Set(ALL_ANGLE_CATEGORIES)).toEqual(new Set(['regalo', 'como_funciona', 'valor_precio', 'unboxing', 'uso_real', 'detalle_tecnico', 'comparacion', 'temporada', 'problema_solucion', 'prueba_social']))
    for (const c of ALL_ANGLE_CATEGORIES) {
      const spec = ANGLE_CATEGORIES[c]
      expect(findCliches(spec.frame.es('x'))).toEqual([])
      expect(findCliches(spec.frame.en('x'))).toEqual([])
      expect(spec.scene).not.toMatch(/\b(text|letters|logo)\b/i)
    }
  })
})

describe('planAngles uses the shared catalog', () => {
  for (const c of BENCHMARK_OFFERS) {
    it(`${c.id}: catalog ids, categories, rationale, no clichés, honest categories`, () => {
      const angles = planAngles({ dna: c.dna, offer: c.offer })
      const keys = confirmedKeys(mergeFacts(c.dna, c.offer))
      for (const a of angles) {
        const parsed = parseAngleId(a.id)
        expect(parsed, a.id).not.toBeNull()
        expect(parsed!.legacy).toBe(false)
        expect(parsed).toMatchObject({ category: a.category, hookType: a.hookType, format: a.format })
        expect(a.rationale && a.rationale.length).toBeGreaterThan(10)
        expect(a.sceneDirection).toBeTruthy()
        expect(findCliches(a.message)).toEqual([])
        if (a.category === 'prueba_social') expect(['proof_review', 'proof_number', 'certification'].some((k) => keys.has(k as never))).toBe(true)
        if (a.category === 'valor_precio') expect(keys.has('price') || keys.has('bundle')).toBe(true)
        if (a.category === 'temporada') throw new Error('season angle without a campaign brief')
      }
      expect(new Set(angles.map((a) => a.category)).size).toBeGreaterThanOrEqual(5)
      if (!NON_PRODUCT.has(c.dna.category)) expect(angles.some((a) => a.category === 'regalo'), 'gift angle').toBe(true)
    })
  }

  it('a campaign brief enables the season/date category', () => {
    const c = caseById('beauty-serum')
    const angles = planAngles({ dna: c.dna, offer: c.offer, size: 20, brief: 'Día de la Madre, foco en regalo' })
    expect(angles.some((a) => a.category === 'temporada')).toBe(true)
  })

  it('ids are stable across pack sizes (same angle → same id)', () => {
    const c = caseById('beauty-serum')
    const five = planAngles({ dna: c.dna, offer: c.offer, size: 5 }).map((a) => a.id)
    const ten = planAngles({ dna: c.dna, offer: c.offer, size: 10 }).map((a) => a.id)
    expect(ten.slice(0, 5)).toEqual(five)
  })
})

describe('angleFromId (catalog ids not in the plan)', () => {
  const c = caseById('beauty-serum')
  it('builds an honest angle for the offer', () => {
    const r = angleFromId({ id: 'regalo-desire-handheld_overlay', dna: c.dna, offer: c.offer })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.angle).toMatchObject({ id: 'regalo-desire-handheld_overlay', category: 'regalo', hookType: 'desire', format: 'handheld_overlay' })
      expect(r.angle.factKeys.length).toBeGreaterThan(0)
      expect(r.angle.rationale).toMatch(/Regalo/)
    }
  })
  it('refuses categories the facts cannot back', () => {
    const noProof: BrandDna = { ...c.dna, facts: c.dna.facts.filter((f) => !['proof_review', 'proof_number', 'certification'].includes(f.key)) }
    const offer = { ...c.offer, facts: c.offer.facts.filter((f) => !['proof_review', 'proof_number', 'certification', 'price', 'bundle'].includes(f.key)) }
    const noPriceDna = { ...noProof, facts: noProof.facts.filter((f) => f.key !== 'price' && f.key !== 'bundle') }
    expect(angleFromId({ id: 'prueba_social-social_proof-ugc_person', dna: noProof, offer }).ok).toBe(false)
    expect(angleFromId({ id: 'valor_precio-price_value-offer_graphic', dna: noPriceDna, offer }).ok).toBe(false)
    expect(angleFromId({ id: 'regalo-desire-offer_graphic', dna: { ...noProof, category: 'finance' }, offer }).ok).toBe(false)
  })
})

describe('cliché blocklist', () => {
  it('detects the generic hooks from the owner feedback, deterministically', () => {
    for (const t of ['Lo que pocos saben del sérum', 'Cómo entra en la rutina', 'Descubrí tu piel nueva', '¿Sabías que la niacinamida…?', 'El secreto para una piel pareja', 'What few people know', 'Discover your glow', 'A total game changer']) {
      expect(findCliches(t).length, t).toBeGreaterThan(0)
    }
    for (const t of ['Poros que se notan en fotos', 'Descubrimos un aloe local en Heredia', 'Dos gotas antes de dormir']) expect(findCliches(t), t).toEqual([])
    expect(CLICHE_PATTERNS.length).toBeGreaterThanOrEqual(20)
  })

  it('check-copy flags clichés as a repairable (non-blocking) issue on the right field', () => {
    const c = caseById('beauty-serum')
    const angle = planAngles({ dna: c.dna, offer: c.offer })[0]
    const res = checkAdCopy(goodSerumCopy({ headline: 'Lo que pocos saben', caption: `${goodSerumCopy().caption} ¿Sabías que es liviano?` }), { dna: c.dna, offer: c.offer, angle, language: 'es' })
    const hits = res.issues.filter((i) => i.code === 'cliche')
    expect(hits.map((i) => i.field).sort()).toEqual(['caption', 'headline'])
    expect(BLOCKING_COPY_CODES.has('cliche')).toBe(false)
    // Quoted customer words are theirs, not ours.
    const quoted = checkAdCopy(goodSerumCopy({ subline: '"Descubrí que sí funciona", dice Ana' }), { dna: c.dna, offer: c.offer, angle, language: 'es' })
    expect(quoted.issues.filter((i) => i.code === 'cliche')).toEqual([])
  })

  it('a cliché headline is replaced by the one targeted rewrite; the prompt bans clichés', async () => {
    const c = caseById('beauty-serum')
    const angle = planAngles({ dna: c.dna, offer: c.offer })[0]
    const gw = fakeGateway((call) => (call.system.includes('Corrige SOLO') ? { headline: 'Poros que se notan en fotos' } : goodSerumCopy({ headline: 'Lo que pocos saben' })))
    const res = await generatePackCopy({ gateway: gw, dna: c.dna, offer: c.offer, angles: [angle], language: 'es' })
    expect(gw.calls[0].system).toMatch(/Lo que pocos saben/)
    const repairs = gw.calls.filter((x) => x.system.includes('Corrige SOLO'))
    expect(repairs).toHaveLength(1)
    expect(repairs[0].user).toMatch(/cliche/)
    const item = res.items[0]
    expect(item.ok).toBe(true)
    if (item.ok) {
      expect(item.copy.headline).toBe('Poros que se notan en fotos')
      expect(item.check.issues.filter((i) => i.code === 'cliche')).toEqual([])
    }
  })
})
