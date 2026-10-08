import { describe, expect, it } from 'vitest'
import { checkAdCopy, repairAdCopy } from '../../api/lib/adpack/check-copy'
import { SCENE_NO_TEXT_CLAUSE } from '../../api/lib/adpack/copy-shared'
import { canonicalNumber, extractNumericClaims } from '../../api/lib/adpack/facts'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import type { AdAngle, AdCopy, CopyCheckIssue } from '../../api/lib/adpack/types'
import { fakeGateway } from './fake-gateway'
import { caseById, goodSerumCopy } from './helpers'

const serum = caseById('beauty-serum')
const angle: AdAngle = planAngles({ dna: serum.dna, offer: serum.offer })[0]
const opts = { dna: serum.dna, offer: serum.offer, angle, language: 'es' as const }

function codes(copy: AdCopy, extra: Partial<typeof opts> & { otherCopies?: AdCopy[] } = {}): Array<[CopyCheckIssue['code'], CopyCheckIssue['field']]> {
  return checkAdCopy(copy, { ...opts, ...extra }).issues.map((i) => [i.code, i.field])
}

describe('number normalization', () => {
  it('treats ₡/$, dots and commas consistently', () => {
    expect(canonicalNumber('12.900')).toBe('12900')
    expect(canonicalNumber('12,900')).toBe('12900')
    expect(canonicalNumber('1.234,50')).toBe('1234.5')
    expect(canonicalNumber('9.90')).toBe('9.9')
    expect(extractNumericClaims('₡12.900 o 12900 o $12,900').map((c) => c.value)).toEqual(['12900', '12900', '12900'])
    expect(extractNumericClaims('2–4 días, 48h, 20%, 10 mil').map((c) => c.value)).toEqual(['2', '4', '48', '20', '10000'])
    expect(extractNumericClaims('llega en dos días').map((c) => c.value)).toEqual(['2'])
  })
})

describe('checkAdCopy', () => {
  it('passes a clean copy', () => {
    const res = checkAdCopy(goodSerumCopy(), opts)
    expect(res.issues).toEqual([])
    expect(res.ok).toBe(true)
  })

  it('accepts number formats that match confirmed facts and structural counts', () => {
    const copy = goodSerumCopy({ subline: 'Dos por 22000 colones', bullets: ['1. Limpiá', '2. Aplicá 2 gotas', 'Paso 3: dormí'] })
    expect(codes(copy)).toEqual([])
  })

  it('flags unconfirmed facts (value from an unconfirmed fact)', () => {
    const c = codes(goodSerumCopy({ caption: 'Reduce poros en 7 días con niacinamida 5% y aloe vera. Envíos a todo Costa Rica por Correos. Escribinos y pedí el tuyo.' }))
    expect(c).toContainEqual(['unconfirmed_fact', 'caption'])
  })

  it('flags numbers that match no fact', () => {
    expect(codes(goodSerumCopy({ headline: 'Sérum a ₡9.900 hoy' }))).toContainEqual(['number_mismatch', 'headline'])
    expect(codes(goodSerumCopy({ subline: 'Llega en 24 horas a tu casa' }))).toContainEqual(['number_mismatch', 'subline'])
    expect(codes(goodSerumCopy({ bullets: ['40% de descuento'] }))).toContainEqual(['number_mismatch', 'bullets'])
  })

  it('flags free/guarantee claims without backing facts', () => {
    expect(codes(goodSerumCopy({ subline: 'Envío gratis a todo el país' }))).toContainEqual(['unconfirmed_fact', 'subline'])
    expect(codes(goodSerumCopy({ subline: 'Con garantía de satisfacción' }))).toContainEqual(['unconfirmed_fact', 'subline'])
  })

  it('flags a tampered offer line and unconfirmed usedFactKeys', () => {
    expect(codes(goodSerumCopy({ offerLine: '₡9.900 · Envío gratis' }))).toContainEqual(['number_mismatch', 'offerLine'])
    expect(codes(goodSerumCopy({ usedFactKeys: ['result_claim'] }))).toContainEqual(['unconfirmed_fact', 'usedFactKeys'])
  })

  it('flags length limits and empty fields', () => {
    const c = codes(
      goodSerumCopy({
        headline: 'El sérum que tu piel mixta estaba esperando desde siempre',
        subline: 'Una fórmula ligera con niacinamida y aloe vera que se absorbe rápido y no deja nada',
        bullets: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'],
        cta: '',
        caption: 'Corto.',
      })
    )
    expect(c).toContainEqual(['too_long', 'headline'])
    expect(c).toContainEqual(['too_long', 'subline'])
    expect(c).toContainEqual(['too_long', 'bullets'])
    expect(c).toContainEqual(['empty_field', 'cta'])
    expect(c).toContainEqual(['empty_field', 'caption'])
    expect(codes(goodSerumCopy({ cta: 'Escribinos ya mismo por mensaje directo' }))).toContainEqual(['too_long', 'cta'])
    expect(codes(goodSerumCopy({ caption: 'palabra '.repeat(90) }))).toContainEqual(['too_long', 'caption'])
  })

  it('flags greetings', () => {
    expect(codes(goodSerumCopy({ caption: '¡Hola! ' + goodSerumCopy().caption }))).toContainEqual(['greeting', 'caption'])
    expect(codes(goodSerumCopy({ headline: 'Bienvenidos a tu nueva piel' }))).toContainEqual(['greeting', 'headline'])
  })

  it('flags placeholders', () => {
    expect(codes(goodSerumCopy({ bullets: ['Talla [TALLA]'] }))).toContainEqual(['placeholder', 'bullets'])
    expect(codes(goodSerumCopy({ subline: 'Solo por ₡XXX' }))).toContainEqual(['placeholder', 'subline'])
    expect(codes(goodSerumCopy({ caption: goodSerumCopy().caption + ' Llega en ___ días.' }))).toContainEqual(['placeholder', 'caption'])
    expect(codes(goodSerumCopy({ cta: 'Escribí a {whatsapp}' }))).toContainEqual(['placeholder', 'cta'])
  })

  it('flags forbidden phrases and text requests in the scene brief', () => {
    expect(codes(goodSerumCopy({ subline: 'Para una piel perfecta cada mañana' }))).toContainEqual(['forbidden_phrase', 'subline'])
    expect(codes(goodSerumCopy({ sceneBrief: 'Bottle on marble. Add a big headline text saying SALE on top.' }))).toContainEqual([
      'forbidden_phrase',
      'sceneBrief',
    ])
    expect(codes(goodSerumCopy({ sceneBrief: `Bottle on marble. ${SCENE_NO_TEXT_CLAUSE}` }))).toEqual([])
  })

  it('flags compliance issues', () => {
    expect(codes(goodSerumCopy({ subline: 'Elimina el acné en una semana' }))).toContainEqual(['compliance', 'subline'])
    expect(codes(goodSerumCopy({ caption: goodSerumCopy().caption + ' Resultados garantizados.' }))).toContainEqual(['compliance', 'caption'])
    expect(codes(goodSerumCopy({ subline: 'Recomendado por dermatólogos' }))).toContainEqual(['compliance', 'subline'])
  })

  it('requires the beauty before/after disclaimer', () => {
    const ba: AdAngle = { ...angle, id: 'ba', format: 'before_after', archetype: 'desvalidar_alternativas', hookType: 'comparison' }
    expect(codes(goodSerumCopy(), { angle: ba })).toContainEqual(['compliance', 'caption'])
    expect(codes(goodSerumCopy({ caption: goodSerumCopy().caption + ' Resultados pueden variar.' }), { angle: ba })).toEqual([])
  })

  it('blocks disallowed formats (health before/after)', () => {
    const h = caseById('health-magnesium')
    const ba: AdAngle = { id: 'x', archetype: 'venta_directa', hookType: 'comparison', format: 'before_after', message: 'm', target: 't', factKeys: [] }
    const res = checkAdCopy(
      {
        headline: 'Noches más tranquilas',
        bullets: [],
        cta: 'Pedí el tuyo',
        caption: 'Citrato de magnesio, sin azúcar añadida. 1 cucharada en un vaso de agua 30 minutos antes de dormir. Escribinos.',
        sceneBrief: 'Glass of water on a nightstand.',
        usedFactKeys: [],
        offerLine: '₡14.500',
      },
      { dna: h.dna, offer: h.offer, angle: ba, language: 'es' }
    )
    expect(res.issues.some((i) => i.code === 'compliance' && i.detail.startsWith('format_not_allowed'))).toBe(true)
  })

  it('flags near-duplicates vs other copies', () => {
    const other = goodSerumCopy({ caption: 'Otra caption completamente distinta sobre rutina nocturna, textura pareja y frascos de vidrio ámbar.' })
    const c = codes(goodSerumCopy({ headline: '¿Poros que se notan en las fotos?' }), { otherCopies: [other] })
    expect(c).toContainEqual(['duplicate_message', 'headline'])
    const c2 = codes(goodSerumCopy({ headline: 'Brillo de media tarde, fuera' }), { otherCopies: [goodSerumCopy({ headline: 'Rutina corta que sí cumplís' })] })
    expect(c2).toContainEqual(['duplicate_message', 'caption'])
  })
})

describe('repairAdCopy', () => {
  it('rewrites only failing fields with one call and re-checks', async () => {
    const bad = goodSerumCopy({ headline: 'Hola, el sérum que tu piel mixta estaba esperando' })
    const issues = checkAdCopy(bad, opts).issues
    expect(issues.length).toBeGreaterThan(0)
    const gw = fakeGateway((call) => {
      expect(call.user).toContain('headline')
      expect(call.user).not.toContain('Reduce poros en 7 días')
      return { headline: 'Brillo en la zona T', caption: 'IGNORED should not replace caption because it is not failing' }
    })
    const res = await repairAdCopy({ gateway: gw, copy: bad, issues, ...opts })
    expect(gw.calls).toHaveLength(1)
    expect(res.repaired).toBe(true)
    expect(res.copy.headline).toBe('Brillo en la zona T')
    expect(res.copy.caption).toBe(bad.caption)
    expect(res.copy.offerLine).toBe(bad.offerLine)
    expect(res.check.ok).toBe(true)
  })

  it('makes no call when nothing fails, and survives gateway errors', async () => {
    const gw = fakeGateway(() => ({}))
    const ok = await repairAdCopy({ gateway: gw, copy: goodSerumCopy(), issues: [], ...opts })
    expect(gw.calls).toHaveLength(0)
    expect(ok.check.ok).toBe(true)
    const broken = fakeGateway(() => {
      throw new Error('down')
    })
    const bad = goodSerumCopy({ headline: '' })
    const res = await repairAdCopy({ gateway: broken, copy: bad, issues: checkAdCopy(bad, opts).issues, ...opts })
    expect(res.repaired).toBe(false)
    expect(res.error).toBe('down')
    expect(res.check.ok).toBe(false)
  })
})
