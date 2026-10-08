import { describe, expect, it } from 'vitest'
import { confirmFacts } from '../../api/lib/adpack/dna/confirm'
import { buildBrandDna, computeGaps, mergeFacts, normalizeFactValue } from '../../api/lib/adpack/dna/merge'
import { makeFact, type DnaPart } from '../../api/lib/adpack/dna/part'

const at = '2026-10-07T12:00:00.000Z'

function part(source: DnaPart['source'], extra: Partial<DnaPart> = {}): DnaPart {
  const kind = source
  return {
    source,
    sourceEntry: { kind, fetchedAt: at, ok: true },
    facts: [],
    visual: {},
    costUsd: 0,
    ...extra,
  }
}

const website = part('website', {
  brandName: 'Luma Botánica',
  oneLiner: 'Tu piel, sin químicos agresivos',
  voice: 'Cercana y natural',
  pains: ['Irritación por jabones con químicos'],
  facts: [
    makeFact('brand_name', 'Luma Botánica', 'website', 'title', true),
    makeFact('price', '₡12.900', 'website', 'home'),
    makeFact('payment_methods', 'SINPE Móvil, tarjeta', 'website', '/envios'),
    makeFact('proof_number', '+1.200 clientes felices', 'website'),
    makeFact('differentiator', 'Hecho a mano', 'inferred'),
  ],
  visual: { primaryColor: '#2f6b4f', logoUrl: 'https://lumabotanica.example/logo.png', headingFont: 'Playfair Display' },
  textSample: '¿Querés probarlo? Pedí el tuyo. Jabones artesanales para piel sensible, skincare natural.',
})

const instagram = part('instagram', {
  brandName: 'Luma Botánica 🌿',
  facts: [
    makeFact('brand_name', 'Luma Botánica 🌿', 'instagram'),
    makeFact('price', '₡11.900', 'instagram', 'post #1'),
    makeFact('payment_methods', 'SINPE móvil, tarjeta', 'instagram', 'bio'),
    makeFact('shipping', 'Envíos a todo Costa Rica 24-48h', 'instagram', 'bio'),
    makeFact('proof_number', '4.9★ en reseñas', 'instagram'),
  ],
  visual: { styleNotes: 'verdes suaves', formatsSeen: ['offer_graphic', 'ugc_person'], logoUrl: 'https://cdn.example/pp.jpg' },
  customerPhrases: ['Ya no me pica la piel'],
})

const uploads = part('upload', {
  productImageUrls: ['https://storage.example/kit.png'],
  facts: [makeFact('guarantee', 'Garantía 30 días', 'upload', 'doc')],
  visual: { logoUrl: 'https://storage.example/logo.png', formatsSeen: ['how_to_steps', 'offer_graphic'] },
})

describe('normalizeFactValue', () => {
  it('treats formatting variants as the same value', () => {
    expect(normalizeFactValue('price', '₡12.900')).toBe(normalizeFactValue('price', '₡ 12,900'))
    expect(normalizeFactValue('payment_methods', 'SINPE Móvil, tarjeta')).toBe(normalizeFactValue('payment_methods', 'sinpe movil tarjeta'))
  })
})

describe('mergeFacts', () => {
  it('keeps the higher-precedence value, demotes conflicts to custom alternates and notes them', () => {
    const { facts, notes } = mergeFacts([
      makeFact('price', '₡11.900', 'instagram', 'post'),
      makeFact('price', '₡12.900', 'website', 'home'),
      makeFact('price', '₡12.900', 'upload'),
    ])
    expect(facts[0]).toMatchObject({ key: 'price', value: '₡12.900', source: 'upload', confirmed: false, evidence: 'home' })
    expect(facts[1]).toMatchObject({ key: 'custom:price_alt_1', value: '₡11.900', source: 'instagram', confirmed: false })
    expect(facts[1].evidence).toMatch(/conflicts with price="₡12.900"/)
    expect(notes).toEqual(['conflict:price: "₡12.900" (upload) vs "₡11.900" (instagram)'])
  })

  it('forces confirmed=false for non-user sources and true for user/offer_form', () => {
    const { facts } = mergeFacts([
      makeFact('guarantee', 'x', 'website', undefined, true),
      makeFact('price', '₡1', 'offer_form', undefined, false),
      makeFact('brand_name', 'Luma', 'website', undefined, true),
      makeFact('brand_name', 'Luma', 'instagram', undefined, true),
    ])
    expect(facts.find((f) => f.key === 'guarantee')?.confirmed).toBe(false)
    expect(facts.find((f) => f.key === 'price')?.confirmed).toBe(true)
    expect(facts.filter((f) => f.key === 'brand_name')).toEqual([expect.objectContaining({ source: 'website', confirmed: true })])
  })

  it('keeps distinct values for multi-value keys without conflicts', () => {
    const { facts, notes } = mergeFacts([
      makeFact('proof_review', '"Me encantó"', 'upload'),
      makeFact('proof_review', '"Llegó rapidísimo"', 'upload'),
      makeFact('proof_review', '"me encanto"', 'instagram'),
    ])
    expect(facts.map((f) => f.value)).toEqual(['"Me encantó"', '"Llegó rapidísimo"'])
    expect(notes).toEqual([])
  })
})

describe('buildBrandDna', () => {
  it('applies precedence user > offer_form > upload > website > instagram and computes gaps', () => {
    const dna = buildBrandDna({
      website,
      instagram,
      uploads,
      offerForm: { name: 'Kit Piel Sensible', facts: { price: '₡12.500' }, productImageUrls: ['https://storage.example/hero.png'] },
      userFacts: [{ key: 'delivery_time', value: '2 a 4 días hábiles' }],
    })
    expect(dna.version).toBe(1)
    expect(dna.brandName).toBe('Luma Botánica')
    const price = dna.facts.filter((f) => f.key === 'price')
    expect(price).toEqual([expect.objectContaining({ value: '₡12.500', source: 'offer_form', confirmed: true })])
    expect(dna.facts.filter((f) => f.key.startsWith('custom:price_alt')).map((f) => f.value)).toEqual(['₡12.900', '₡11.900'])
    expect(dna.notes?.some((n) => n.startsWith('conflict:price:'))).toBe(true)
    expect(dna.facts.find((f) => f.key === 'delivery_time')).toMatchObject({ source: 'user', confirmed: true })
    expect(dna.facts.find((f) => f.key === 'offer_name')).toMatchObject({ value: 'Kit Piel Sensible', confirmed: true })
    // payment_methods: website and instagram agree after normalization → one fact, no conflict.
    expect(dna.facts.filter((f) => f.key === 'payment_methods')).toHaveLength(1)
    expect(dna.notes?.some((n) => n.startsWith('conflict:payment_methods'))).toBe(false)
    expect(dna.notes?.some((n) => n.startsWith('conflict:brand_name'))).toBe(false)

    expect(dna.visual.logoUrl).toBe('https://storage.example/logo.png') // upload > website > instagram
    expect(dna.visual.primaryColor).toBe('#2f6b4f')
    expect(dna.visual.styleNotes).toBe('verdes suaves')
    expect(dna.visual.formatsSeen).toEqual(['how_to_steps', 'offer_graphic', 'ugc_person'])
    expect(dna.productImageUrls).toEqual(['https://storage.example/hero.png', 'https://storage.example/kit.png'])
    expect(dna.customerPhrases).toEqual(['Ya no me pica la piel'])
    expect(dna.oneLiner).toBe('Tu piel, sin químicos agresivos')
    expect(dna.language).toBe('es')
    expect(dna.register).toBe('voseo')
    expect(dna.category).toBe('beauty')
    expect(dna.sources.map((s) => s.kind)).toEqual(['upload', 'website', 'instagram'])
    // All important facts present → no gaps.
    expect(dna.gaps).toEqual([])
  })

  it('reports gaps for an Instagram-only brand and never confirms its facts', () => {
    const dna = buildBrandDna({ instagram: part('instagram', { brandName: 'Moka Lab', facts: [makeFact('shipping', 'Envíos 24h', 'instagram')] }) })
    expect(dna.brandName).toBe('Moka Lab')
    expect(dna.gaps).toEqual(['price', 'payment_methods', 'guarantee', 'proof_review'])
    expect(dna.facts.every((f) => !f.confirmed)).toBe(true)
    expect(dna.oneLiner).toBe('Moka Lab')
  })

  it('is deterministic', () => {
    const input = { website, instagram, uploads, userFacts: [{ key: 'price' as const, value: '₡9.900' }] }
    expect(JSON.stringify(buildBrandDna(input))).toBe(JSON.stringify(buildBrandDna(input)))
  })

  it('skips the delivery gap for service categories', () => {
    expect(computeGaps({ category: 'services_local', facts: [], customerPhrases: [] })).toEqual(['price', 'payment_methods', 'guarantee', 'proof_review'])
  })
})

describe('confirmFacts', () => {
  const base = buildBrandDna({ website, instagram })

  it('confirms, edits, adds and removes facts and recomputes gaps', () => {
    expect(base.gaps).toContain('guarantee')
    const next = confirmFacts(base, [
      { op: 'confirm', key: 'payment_methods' },
      { op: 'edit', key: 'price', value: '₡12.900' },
      { op: 'add', key: 'guarantee', value: 'Garantía de 30 días' },
      { op: 'remove', key: 'differentiator' },
    ])
    expect(next.facts.find((f) => f.key === 'payment_methods')?.confirmed).toBe(true)
    expect(next.facts.filter((f) => f.key === 'price')).toEqual([{ key: 'price', value: '₡12.900', source: 'user', confirmed: true }])
    // Settled conflict: alternates + note removed.
    expect(next.facts.some((f) => f.key.startsWith('custom:price_alt'))).toBe(false)
    expect(next.notes?.some((n) => n.startsWith('conflict:price')) ?? false).toBe(false)
    expect(next.facts.some((f) => f.key === 'differentiator')).toBe(false)
    expect(next.gaps).not.toContain('guarantee')
    // Input untouched.
    expect(base.facts.find((f) => f.key === 'payment_methods')?.confirmed).toBe(false)
  })

  it('confirming an alternate promotes it to the base key', () => {
    const next = confirmFacts(base, [{ op: 'confirm', key: 'custom:price_alt_1' }])
    expect(next.facts.filter((f) => f.key === 'price')).toEqual([expect.objectContaining({ value: '₡11.900', source: 'user', confirmed: true })])
    expect(next.facts.some((f) => f.key === 'custom:price_alt_1')).toBe(false)
  })

  it('edits one value of a multi-value key and updates brandName on brand edits', () => {
    const next = confirmFacts(base, [
      { op: 'edit', key: 'proof_number', value: '+1.300 clientes', previousValue: '+1.200 clientes felices' },
      { op: 'edit', key: 'brand_name', value: 'Luma Botánica CR' },
    ])
    expect(next.facts.filter((f) => f.key === 'proof_number').map((f) => f.value)).toEqual(['4.9★ en reseñas', '+1.300 clientes'])
    expect(next.brandName).toBe('Luma Botánica CR')
  })
})
