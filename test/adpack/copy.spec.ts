import { describe, expect, it } from 'vitest'
import { SCENE_NO_TEXT_CLAUSE, sceneBriefRequestsText } from '../../api/lib/adpack/copy-shared'
import { buildCopyPrompt, buildOfferLine, generateAdCopy, generatePackCopy, offerLineFor } from '../../api/lib/adpack/copy'
import { confirmedFacts, mergeFacts, unconfirmedFacts } from '../../api/lib/adpack/facts'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import { BENCHMARK_OFFERS } from '../fixtures/adpack/benchmark-offers'
import { fakeGateway, type JsonCall } from './fake-gateway'
import { caseById, goodSerumCopy } from './helpers'

const serum = caseById('beauty-serum')
const serumAngles = planAngles({ dna: serum.dna, offer: serum.offer })

const HEADLINES = [
  '¿Poros que se notan en fotos?',
  'Brillo en zona T, controlado',
  'Rutina nocturna de dos gotas',
  'Textura pareja sin pegajoso',
  'Sérums que no notaste',
  'Piel mixta, fórmula ligera',
  'Aloe con niacinamida',
  'Tu noche, tu cuidado',
  'Dos frascos, mejor precio',
  'Absorción rapidísima',
]
const CAPTION_OPENERS = [
  'Las fotos de cerca delatan los poros abiertos.',
  'A media tarde la frente ya brilla.',
  'Una rutina que cabe antes de dormir.',
  'Querés sentir la cara suave al tacto.',
  'Probaste otros frascos sin ver cambios.',
  'Tu piel mixta pide algo liviano.',
  'El aloe calma mientras trabajás de noche.',
  'Cuidarte no tiene que tomar horas.',
  'Llevate pareja y ahorrás.',
  'Se absorbe enseguida, cero residuo.',
]

const SUBLINES = [
  'Niacinamida 5% para fotos de cerca',
  'Control del brillo hasta la tarde',
  'Antes de dormir, sobre piel limpia',
  'Suavidad que se siente al tacto',
  'Fórmula distinta a lo que probaste',
  'Ligera para piel mixta',
  'Aloe vera que calma',
  'Un paso que no cuesta cumplir',
  'Pareja de frascos para compartir',
  'Cero residuo en la almohada',
]

function angleIndex(call: JsonCall): number {
  const m = call.user.match(/\(a(\d{2})-/)
  return m ? Number(m[1]) - 1 : 0
}

function goodHandler(call: JsonCall) {
  const i = angleIndex(call)
  const base = goodSerumCopy()
  return {
    ...base,
    headline: HEADLINES[i],
    subline: SUBLINES[i],
    caption: `${CAPTION_OPENERS[i]} Con aloe vera, sin sensación pegajosa. Envíos a todo Costa Rica por Correos. Escribinos y pedí el tuyo.${
      call.user.includes('FORMATO: before_after') ? ' Resultados pueden variar.' : ''
    }`,
    offerLine: 'MODEL SHOULD NOT SET THIS ₡1',
    sceneBrief: 'Amber dropper bottle on wet stone, soft light, empty space at the top.',
  }
}

describe('offer line', () => {
  it('is deterministic and built only from confirmed price/bundle/shipping', () => {
    for (const c of BENCHMARK_OFFERS) {
      const a = offerLineFor(c.dna, c.offer, c.dna.language)
      expect(offerLineFor(c.dna, c.offer, c.dna.language)).toBe(a)
      const facts = mergeFacts(c.dna, c.offer)
      const hasPrice = confirmedFacts(facts).some((f) => f.key === 'price' || f.key === 'bundle')
      if (!hasPrice) expect(a).toBeUndefined()
      else expect(a!.length).toBeLessThanOrEqual(70)
      for (const u of unconfirmedFacts(facts)) if (a) expect(a).not.toContain(u.value)
    }
    expect(offerLineFor(serum.dna, serum.offer, 'es')).toBe('₡12.900 · 2 por ₡22.000')
    const mat = caseById('health-yoga-mat')
    expect(offerLineFor(mat.dna, mat.offer, 'es')).toBe('₡18.900 · Antes ₡22.900')
    const books = caseById('kids-books')
    expect(offerLineFor(books.dna, books.offer, 'es')).toBe('₡19.500')
    expect(offerLineFor(caseById('services-moving').dna, caseById('services-moving').offer, 'es')).toBeUndefined()
  })

  it('fits the badge budget: drops plain shipping first, keeps short free shipping', () => {
    const fact = (key: 'price' | 'shipping' | 'compare_at_price' | 'bundle', value: string) => ({ key, value, source: 'offer_form' as const, confirmed: true })
    expect(buildOfferLine([fact('price', '₡9.900'), fact('shipping', 'Envío gratis GAM')], 'es')).toBe('₡9.900 · Envío gratis GAM')
    expect(buildOfferLine([fact('price', '₡9.900'), fact('compare_at_price', '₡12.900'), fact('shipping', 'Envío gratis en la GAM desde 3 unidades')], 'es')).toBe('₡9.900 · Antes ₡12.900')
    expect(buildOfferLine([fact('price', '₡9.900'), fact('shipping', 'Envíos a todo Costa Rica por Correos')], 'es')).toBe('₡9.900')
  })

  it('ignores any offer line the model writes', async () => {
    const gw = fakeGateway(goodHandler)
    const res = await generateAdCopy({ gateway: gw, dna: serum.dna, offer: serum.offer, angle: serumAngles[0], language: 'es' })
    expect(res.copy.offerLine).toBe('₡12.900 · 2 por ₡22.000')
  })
})

describe('copy prompt', () => {
  it('never contains unconfirmed fact values (all 30 fixtures × 10 angles)', () => {
    for (const c of BENCHMARK_OFFERS) {
      const facts = mergeFacts(c.dna, c.offer)
      const confirmedValues = confirmedFacts(facts).map((f) => f.value)
      const forbidden = unconfirmedFacts(facts)
        .map((f) => f.value)
        .filter((v) => !confirmedValues.some((cv) => cv.includes(v)))
      for (const angle of planAngles({ dna: c.dna, offer: c.offer })) {
        const p = buildCopyPrompt({ dna: c.dna, offer: c.offer, angle, language: c.dna.language })
        const text = `${p.system}\n${p.user}`
        for (const v of forbidden) expect(text, `${c.id}/${angle.id} leaks "${v}"`).not.toContain(v)
        for (const v of confirmedValues) expect(p.user).toContain(v)
      }
    }
  })

  it('carries IAN rules, archetype example, format layout, limits, forbidden phrases and disclaimer', () => {
    const p = buildCopyPrompt({ dna: serum.dna, offer: serum.offer, angle: serumAngles[0], language: 'es' })
    expect(p.system).toContain('MÉTODO IAN')
    expect(p.system).toContain('CERO SALUDOS')
    expect(p.system).toContain('≤ 6 palabras')
    expect(p.system).toContain('No hables de texto')
    expect(p.user).toContain('ALLOWLIST')
    expect(p.user).toContain('Venta directa')
    expect(p.user).toContain('FORMATO: offer_graphic')
    expect(p.user).toContain('piel perfecta')
    const ba = serumAngles.find((a) => a.format === 'before_after')!
    expect(buildCopyPrompt({ dna: serum.dna, offer: serum.offer, angle: ba, language: 'es' }).user).toContain('Resultados pueden variar.')
  })

  it('uses the right register instruction', () => {
    const byReg = (reg: 'voseo' | 'tuteo' | 'usted') => BENCHMARK_OFFERS.find((c) => c.dna.language === 'es' && c.dna.register === reg)!
    const sys = (c: (typeof BENCHMARK_OFFERS)[number]) =>
      buildCopyPrompt({ dna: c.dna, offer: c.offer, angle: planAngles({ dna: c.dna, offer: c.offer, size: 1 })[0], language: c.dna.language }).system
    expect(sys(byReg('voseo'))).toMatch(/REGISTRO: voseo[^\n]*tenés/)
    expect(sys(byReg('tuteo'))).toMatch(/REGISTRO: tuteo[^\n]*tienes/)
    expect(sys(byReg('usted'))).toMatch(/REGISTRO: usted[^\n]*escríbanos/)
    const en = BENCHMARK_OFFERS.find((c) => c.dna.language === 'en')!
    expect(sys(en)).toContain('REGISTER: direct second person')
    expect(sys(en)).not.toContain('REGISTRO')
  })
})

describe('generateAdCopy', () => {
  it('makes exactly one model call and returns a clean, checked copy', async () => {
    const gw = fakeGateway(goodHandler)
    const res = await generateAdCopy({ gateway: gw, dna: serum.dna, offer: serum.offer, angle: serumAngles[0], language: 'es', model: 'm1' })
    expect(gw.calls).toHaveLength(1)
    expect(gw.calls[0].model).toBe('m1')
    expect(res.check.issues).toEqual([])
    expect(res.copy.usedFactKeys).toEqual(expect.arrayContaining(['price', 'bundle', 'ingredients_materials']))
    expect(res.copy.sceneBrief.endsWith(SCENE_NO_TEXT_CLAUSE)).toBe(true)
  })

  it('strips text requests from the scene brief, caps lists, truncates captions on word boundaries', async () => {
    const longCaption = `${'Rutina simple con niacinamida y aloe para piel mixta. '.repeat(14)}final`
    const gw = fakeGateway(() => ({
      ...goodSerumCopy(),
      bullets: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'],
      caption: longCaption,
      sceneBrief: 'Bottle on marble with morning light. Add bold text saying 50% OFF on top. Put the brand logo in the corner.',
      usedFactKeys: ['price', 'result_claim', 'nonsense'],
    }))
    const res = await generateAdCopy({ gateway: gw, dna: serum.dna, offer: serum.offer, angle: serumAngles[0], language: 'es' })
    expect(res.copy.sceneBrief).toContain('Bottle on marble')
    expect(res.copy.sceneBrief).not.toContain('50%')
    expect(res.copy.sceneBrief).not.toMatch(/brand logo in the corner/)
    expect(sceneBriefRequestsText(res.copy.sceneBrief)).toBe(false)
    expect(res.copy.bullets).toHaveLength(4)
    expect(res.copy.caption.length).toBeLessThanOrEqual(600)
    expect(longCaption.startsWith(res.copy.caption)).toBe(true)
    expect(res.copy.caption.endsWith('.')).toBe(true)
    expect(res.copy.usedFactKeys).not.toContain('result_claim')
    expect(res.copy.usedFactKeys).not.toContain('nonsense')
  })

  it('reports (does not silently truncate) an over-long headline', async () => {
    const gw = fakeGateway(() => ({ ...goodSerumCopy(), headline: 'El sérum que tu piel mixta estaba esperando hace años' }))
    const res = await generateAdCopy({ gateway: gw, dna: serum.dna, offer: serum.offer, angle: serumAngles[0], language: 'es' })
    expect(res.copy.headline).toBe('El sérum que tu piel mixta estaba esperando hace años')
    expect(res.check.issues.some((i) => i.code === 'too_long' && i.field === 'headline')).toBe(true)
  })
})

describe('generatePackCopy', () => {
  it('runs in parallel with a concurrency limit and returns partial success', async () => {
    const gw = fakeGateway((call) => {
      if (angleIndex(call) === 3) throw new Error('model timeout')
      if (angleIndex(call) === 6) return null
      return goodHandler(call)
    }, 5)
    const res = await generatePackCopy({ gateway: gw, dna: serum.dna, offer: serum.offer, angles: serumAngles, language: 'es', concurrency: 3, repair: false })
    expect(gw.maxInFlight).toBeLessThanOrEqual(3)
    expect(gw.maxInFlight).toBeGreaterThan(1)
    expect(res.items).toHaveLength(10)
    expect(res.items.map((x) => x.angleId)).toEqual(serumAngles.map((a) => a.id))
    expect(res.okCount).toBe(8)
    expect(res.failedCount).toBe(2)
    const failed = res.items.filter((x) => !x.ok)
    expect(failed.map((x) => x.angleId)).toEqual([serumAngles[3].id, serumAngles[6].id])
    expect(failed[0].ok === false && failed[0].error).toBe('model timeout')
    for (const x of res.items) if (x.ok) expect(x.check.issues).toEqual([])
  })

  it('repairs failing ads once (targeted) and flags pack duplicates', async () => {
    const gw = fakeGateway((call) => {
      if (call.system.includes('Corrige SOLO')) return { headline: 'Cuidado nocturno real' }
      const out = goodHandler(call)
      // Angle 2 duplicates angle 1's headline; angle 5 greets.
      if (angleIndex(call) === 1) out.headline = HEADLINES[0]
      if (angleIndex(call) === 4) out.headline = 'Hola, sérums que no notaste'
      return out
    })
    const res = await generatePackCopy({ gateway: gw, dna: serum.dna, offer: serum.offer, angles: serumAngles, language: 'es' })
    const repairCalls = gw.calls.filter((c) => c.system.includes('Corrige SOLO'))
    expect(repairCalls).toHaveLength(2)
    const okItems = res.items.filter((x) => x.ok)
    expect(okItems).toHaveLength(10)
    const repaired = okItems.filter((x) => x.ok && x.repaired)
    expect(repaired).toHaveLength(2)
    // Second repair yields the same headline as the first → one remains flagged as duplicate.
    const stillBad = okItems.filter((x) => x.ok && !x.check.ok)
    expect(stillBad.length).toBeLessThanOrEqual(1)
    expect(res.costUsd).toBeCloseTo(0.012, 5)
  })
})
