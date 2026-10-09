import { planAngles } from '../../api/lib/adpack/plan-angles'
import type { AdCopy } from '../../api/lib/adpack/types'
import { BENCHMARK_OFFERS, type BenchmarkCase } from '../fixtures/adpack/benchmark-offers'

export function caseById(id: string): BenchmarkCase {
  const c = BENCHMARK_OFFERS.find((x) => x.id === id)
  if (!c) throw new Error(`no fixture ${id}`)
  return c
}

/** A clean, IAN-style copy for beauty-serum (uses confirmed facts only). */
export function goodSerumCopy(overrides: Partial<AdCopy> = {}): AdCopy {
  return {
    headline: '¿Poros que se notan en fotos?',
    subline: 'Niacinamida 5% y aloe vera, sin sensación pegajosa',
    bullets: ['Niacinamida 5%', 'Se absorbe rápido', '2 gotas de noche'],
    offerLine: '₡12.900 · 2 por ₡22.000',
    cta: 'Pedí el tuyo',
    caption:
      '¿Ya probaste sérums y no notaste nada? Este se aplica de noche sobre piel limpia y no deja sensación pegajosa. Envíos a todo Costa Rica por Correos y pagás con SINPE Móvil o tarjeta. Escribinos y pedí el tuyo.',
    script: {
      hook: 'Si los poros se te notan en cada foto, mirá esto.',
      development: 'Niacinamida 5% y aloe vera. Dos gotas en la noche sobre piel limpia y se absorbe rápido, sin dejar pegajoso.',
      cta: 'Escribinos y pedí el tuyo.',
    },
    sceneBrief:
      'Amber dropper bottle on a wet white stone, soft morning light, a few aloe leaves, clean empty space at the top. Leave clean empty space for the overlay. No added text, letters, numbers, logos, signs or watermarks anywhere in the scene (the product packaging may appear as it really is).',
    usedFactKeys: ['ingredients_materials', 'usage_steps', 'shipping', 'payment_methods', 'price', 'bundle'],
    ...overrides,
  }
}

/**
 * Plan position of the angle named in a copy prompt `(…angle id…)`. Ids are stable catalog ids
 * (`<category>-<hook>-<format>`), so fakes map them back to the beauty-serum plan order; ids of
 * other offers get first-seen positions after it (distinct per angle).
 */
let serumIds: string[] | null = null
const seen = new Map<string, number>()
export function angleIndexFromPrompt(user: string): number {
  serumIds ??= (() => {
    const c = caseById('beauty-serum')
    return planAngles({ dna: c.dna, offer: c.offer, size: 20 }).map((a) => a.id)
  })()
  const m = user.match(/\(([a-z_]+-[a-z_]+-[a-z_]+)\)/) ?? user.match(/\((a\d{2}-[a-z_-]+)\)/)
  if (!m) return 0
  const i = serumIds.indexOf(m[1])
  if (i >= 0) return i
  if (!seen.has(m[1])) seen.set(m[1], seen.size)
  return seen.get(m[1])!
}
