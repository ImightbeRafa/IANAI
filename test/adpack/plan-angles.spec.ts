import { describe, expect, it } from 'vitest'
import { getDisallowedFormats, isFormatAllowed } from '../../api/lib/adpack/compliance'
import { confirmedKeys, mergeFacts } from '../../api/lib/adpack/facts'
import { MAX_PACK_SIZE, planAngles, refineAnglesWithLlm } from '../../api/lib/adpack/plan-angles'
import { normalizeText } from '../../api/lib/adpack/util'
import { BENCHMARK_OFFERS } from '../fixtures/adpack/benchmark-offers'
import { fakeGateway } from './fake-gateway'

describe('benchmark fixtures', () => {
  it('has 30 fictional offers across ≥10 categories', () => {
    expect(BENCHMARK_OFFERS).toHaveLength(30)
    expect(new Set(BENCHMARK_OFFERS.map((c) => c.dna.category)).size).toBeGreaterThanOrEqual(10)
    expect(new Set(BENCHMARK_OFFERS.map((c) => c.id)).size).toBe(30)
    const withUnconfirmed = BENCHMARK_OFFERS.filter((c) => [...c.dna.facts, ...c.offer.facts].some((f) => !f.confirmed))
    expect(withUnconfirmed.length).toBeGreaterThanOrEqual(10)
    expect(BENCHMARK_OFFERS.filter((c) => c.dna.gaps.length > 0).length).toBeGreaterThanOrEqual(10)
  })
})

describe('planAngles', () => {
  for (const c of BENCHMARK_OFFERS) {
    it(`plans 10 distinct, compliant, fact-tied angles for ${c.id}`, () => {
      const angles = planAngles({ dna: c.dna, offer: c.offer })
      expect(angles).toHaveLength(10)

      // Deterministic
      expect(planAngles({ dna: c.dna, offer: c.offer })).toEqual(angles)

      // Unique (hookType, format) and messages
      const pairs = angles.map((a) => `${a.hookType}|${a.format}`)
      expect(new Set(pairs).size).toBe(angles.length)
      expect(new Set(angles.map((a) => normalizeText(a.message))).size).toBe(angles.length)
      expect(new Set(angles.map((a) => a.id)).size).toBe(angles.length)

      // Spread
      expect(new Set(angles.map((a) => a.archetype)).size).toBeGreaterThanOrEqual(2)
      expect(new Set(angles.map((a) => a.format)).size).toBeGreaterThanOrEqual(4)
      expect(new Set(angles.map((a) => a.hookType)).size).toBeGreaterThanOrEqual(4)
      expect(angles[0].archetype).toBe('venta_directa')

      // Compliance
      for (const a of angles) expect(isFormatAllowed(c.dna.category, a.format)).toBe(true)
      for (const bad of getDisallowedFormats(c.dna.category)) expect(angles.some((a) => a.format === bad)).toBe(false)

      // Fact keys exist and are confirmed
      const keys = confirmedKeys(mergeFacts(c.dna, c.offer))
      for (const a of angles) {
        expect(a.factKeys.length).toBeGreaterThan(0)
        for (const k of a.factKeys) expect(keys.has(k)).toBe(true)
      }

      // Targets from DNA lists (or fallback when lists are empty)
      const pool = new Set(
        [...(c.dna.pains ?? []), ...(c.dna.desires ?? []), ...(c.dna.objections ?? []), ...(c.dna.customerPhrases ?? []), ...(c.dna.audience ?? [])].map(
          (t) => t.trim()
        )
      )
      const fallback = c.dna.oneLiner ?? c.offer.name
      for (const a of angles) expect(pool.has(a.target) || a.target === fallback).toBe(true)

      // Hook types that need facts only appear when the facts are confirmed
      for (const a of angles) {
        if (a.hookType === 'price_value') expect(keys.has('price') || keys.has('bundle')).toBe(true)
        if (a.hookType === 'social_proof') expect(keys.has('proof_review') || keys.has('proof_number') || keys.has('certification')).toBe(true)
        if (a.archetype === 'variedad_productos' || a.format === 'variant_card') expect(keys.has('variants')).toBe(true)
      }
    })
  }

  it('overall uses every archetype and format across the benchmark', () => {
    const all = BENCHMARK_OFFERS.flatMap((c) => planAngles({ dna: c.dna, offer: c.offer }))
    expect(new Set(all.map((a) => a.archetype)).size).toBe(5)
    expect(new Set(all.map((a) => a.format)).size).toBe(7)
    expect(new Set(all.map((a) => a.hookType)).size).toBeGreaterThanOrEqual(9)
  })

  it('supports size 20 and clamps above the max', () => {
    for (const c of BENCHMARK_OFFERS) {
      const a20 = planAngles({ dna: c.dna, offer: c.offer, size: 20 })
      expect(a20).toHaveLength(20)
      expect(new Set(a20.map((a) => `${a.hookType}|${a.format}`)).size).toBe(20)
      expect(new Set(a20.map((a) => normalizeText(a.message))).size).toBe(20)
    }
    const c = BENCHMARK_OFFERS[0]
    expect(planAngles({ dna: c.dna, offer: c.offer, size: 99 })).toHaveLength(MAX_PACK_SIZE)
    expect(planAngles({ dna: c.dna, offer: c.offer, size: 3 })).toHaveLength(3)
  })

  it('seed is deterministic and can vary the plan', () => {
    const c = BENCHMARK_OFFERS[6]
    const a = planAngles({ dna: c.dna, offer: c.offer, seed: 'x' })
    expect(planAngles({ dna: c.dna, offer: c.offer, seed: 'x' })).toEqual(a)
    const variants = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => JSON.stringify(planAngles({ dna: c.dna, offer: c.offer, seed: s }))))
    expect(variants.size).toBeGreaterThan(1)
  })

  it('writes messages in the requested language', () => {
    const c = BENCHMARK_OFFERS.find((x) => x.dna.language === 'en')!
    const angles = planAngles({ dna: c.dna, offer: c.offer })
    expect(angles.every((a) => /^(From the concrete problem|The product in a real|To give as a gift|How it works|What you get|What comes in it|The confirmed technical|Versus the usual|For the campaign date|Verified proof)/.test(a.message))).toBe(true)
  })
})

describe('refineAnglesWithLlm', () => {
  const c = BENCHMARK_OFFERS[0]
  const angles = planAngles({ dna: c.dna, offer: c.offer, size: 4 })

  it('changes wording only and keeps structure', async () => {
    const gw = fakeGateway(() => ({
      angles: angles.map((a, i) => ({ id: a.id, message: `Mensaje afilado ${['uno', 'dos', 'tres', 'cuatro'][i]}`, target: `objetivo ${i}`, format: 'before_after' })),
    }))
    const res = await refineAnglesWithLlm({ gateway: gw, angles, dna: c.dna, offer: c.offer })
    expect(res.refined).toBe(4)
    res.angles.forEach((a, i) => {
      expect(a.message).toBe(`Mensaje afilado ${['uno', 'dos', 'tres', 'cuatro'][i]}`)
      expect({ ...a, message: angles[i].message, target: angles[i].target }).toEqual(angles[i])
    })
  })

  it('rejects refined text with unconfirmed numbers and survives model errors', async () => {
    const gw = fakeGateway(() => ({ angles: [{ id: angles[0].id, message: 'Reduce poros en 7 días garantizado', target: 'x' }] }))
    const res = await refineAnglesWithLlm({ gateway: gw, angles, dna: c.dna, offer: c.offer })
    expect(res.angles[0].message).toBe(angles[0].message)
    const broken = fakeGateway(() => {
      throw new Error('boom')
    })
    const res2 = await refineAnglesWithLlm({ gateway: broken, angles, dna: c.dna, offer: c.offer })
    expect(res2.angles).toEqual(angles)
    expect(res2.error).toBe('boom')
  })
})
