import { describe, expect, it } from 'vitest'
import { classifyCategory, detectLanguage, detectRegister, heuristicCategory } from '../../api/lib/adpack/dna/classify'
import { fakeGateway } from './dna-helpers'

describe('detectRegister', () => {
  it('detects voseo from verb forms', () => {
    expect(detectRegister('Pedí el tuyo hoy. ¿Querés piel suave? Tenés envío gratis.')).toBe('voseo')
    expect(detectRegister('Escribinos al WhatsApp y aprovechá la promo')).toBe('voseo')
  })

  it('detects tuteo and usted', () => {
    expect(detectRegister('¿Quieres piel suave? Tienes envío gratis, escríbenos.')).toBe('tuteo')
    expect(detectRegister('Contáctenos para agendar. Le ofrecemos atención personalizada para su empresa.')).toBe('usted')
  })

  it('falls back to voseo for CR/AR/UY hints without markers, tuteo otherwise', () => {
    expect(detectRegister('Jabones artesanales. Envíos con SINPE en Costa Rica.')).toBe('voseo')
    expect(detectRegister('Jabones artesanales hechos a mano.', 'AR')).toBe('voseo')
    expect(detectRegister('Jabones artesanales hechos a mano.')).toBe('tuteo')
    expect(detectRegister('Jabones artesanales, SINPE.', null)).toBe('tuteo')
  })

  it('does not treat nouns as tuteo markers', () => {
    expect(detectRegister('Reserva tu cita. La prueba gratis incluye una consulta.', 'CR')).toBe('voseo')
  })
})

describe('detectLanguage', () => {
  it('distinguishes es / en', () => {
    expect(detectLanguage('Free shipping on all orders. Shop the new collection for your skin.')).toBe('en')
    expect(detectLanguage('Envío gratis en todos los pedidos. Comprá la nueva colección para tu piel.')).toBe('es')
  })
})

describe('category', () => {
  it('heuristics classify clear cases', () => {
    expect(heuristicCategory('Skincare natural: serum facial y crema para piel sensible')).toBe('beauty')
    expect(heuristicCategory('Croquetas premium para perro y gato, accesorios para tu mascota')).toBe('pets')
    expect(heuristicCategory('Cafetería y repostería: café de especialidad, pasteles y pan')).toBe('food_beverage')
    expect(heuristicCategory('Hola')).toBeNull()
  })

  it('uses the LLM fallback only when inconclusive and validates its answer', async () => {
    const gateway = fakeGateway([{ match: 'Classify the business', data: { category: 'education' }, costUsd: 0.0002 }])
    const clear = await classifyCategory({ text: 'serum facial skincare maquillaje', gateway })
    expect(clear).toEqual({ category: 'beauty', method: 'heuristic', costUsd: 0 })
    expect(gateway.calls).toHaveLength(0)
    const vague = await classifyCategory({ text: 'Somos un equipo apasionado que ayuda a personas a lograr sus metas.', gateway })
    expect(vague).toEqual({ category: 'education', method: 'llm', costUsd: 0.0002 })

    const bad = fakeGateway([{ match: 'Classify the business', data: { category: 'spaceships' } }])
    expect((await classifyCategory({ text: 'Somos un equipo apasionado que ayuda a personas.', gateway: bad })).category).toBe('other')
    const failing = fakeGateway([{ match: 'Classify the business', data: {}, fail: true }])
    expect(await classifyCategory({ text: 'Somos un equipo apasionado que ayuda a personas.', gateway: failing })).toMatchObject({ category: 'other', method: 'default' })
  })
})
