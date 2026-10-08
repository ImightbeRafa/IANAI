import { describe, expect, it } from 'vitest'
import { ingestBrandDna } from '../../api/lib/adpack/dna/ingest'
import { ingestUploads } from '../../api/lib/adpack/dna/uploads'
import { fakeFetch, fakeGateway, fixture, FIXED_NOW } from './dna-helpers'

const BASE = 'https://lumabotanica.example'
const API = 'https://www.instagram.com/api/v1/users/web_profile_info/'
const PROFILE = 'https://www.instagram.com/lumabotanica.cr/'

const pages: Record<string, string> = {
  [`${BASE}/`]: fixture('site-home.html'),
  [`${BASE}/envios`]: fixture('site-envios.html'),
  [`${BASE}/assets/theme.css`]: fixture('site-theme.css'),
}
const websiteFetchText = async (url: string) => {
  if (pages[url] === undefined) throw new Error(`404 ${url}`)
  return pages[url]
}

const SYNTH = {
  facts: { businessName: 'Luma Botánica', tagline: 'Tu piel, sin químicos agresivos', product_description: 'Jabones artesanales para piel sensible, skincare natural' },
  evidence: { businessName: { origin: 'web', confidence: 0.98, evidence: ['Luma Botánica'], sourceUrls: [`${BASE}/`] } },
}

describe('ingestBrandDna', () => {
  it('merges website + instagram + uploads and sums cost', async () => {
    const gateway = fakeGateway([
      { match: 'Brand Kit', data: SYNTH, costUsd: 0.01 },
      { match: 'Instagram posts', data: { formats: ['offer_graphic'], claims: [], customerPhrases: ['Ya no me pica'] }, costUsd: 0.004 },
      { match: 'customer reviews', data: { customerPhrases: ['Me cambió la piel'], proof: [{ key: 'proof_review', value: '"Me cambió la piel"', evidence: 'shot 1' }] }, costUsd: 0.002 },
    ])
    const fetch = fakeFetch({ [API]: { body: fixture('ig-web-profile-info.json') }, [PROFILE]: { body: fixture('ig-profile.html') } })
    const res = await ingestBrandDna({
      gateway,
      websiteUrl: `${BASE}/`,
      instagramUrl: '@lumabotanica.cr',
      uploads: [
        { kind: 'product_photo', url: 'https://storage.example/kit.png' },
        { kind: 'logo', url: 'https://storage.example/logo.png' },
        { kind: 'review_screenshot', url: 'https://storage.example/review1.png' },
      ],
      websiteFetchText,
      fetchImpl: fetch.impl,
      now: FIXED_NOW,
    })
    const { dna } = res
    expect(dna.brandName).toBe('Luma Botánica')
    expect(dna.sources.map((s) => [s.kind, s.ok])).toEqual([['upload', true], ['website', true], ['instagram', true]])
    expect(res.costUsd).toBeCloseTo(0.016, 6)
    expect(dna.category).toBe('beauty')
    expect(dna.register).toBe('voseo')
    expect(dna.productImageUrls).toEqual(['https://storage.example/kit.png'])
    expect(dna.visual.logoUrl).toBe('https://storage.example/logo.png')
    expect(dna.customerPhrases).toEqual(expect.arrayContaining(['Me cambió la piel', 'Ya no me pica']))
    expect(dna.facts.find((f) => f.key === 'payment_methods')).toBeTruthy()
    expect(dna.gaps).not.toContain('price')
    expect(typeof res.timingsMs.website).toBe('number')
    expect(typeof res.timingsMs.instagram).toBe('number')
    expect(res.timingsMs.total).toBeGreaterThanOrEqual(0)
  })

  it('partial success: website times out, instagram throws, uploads still land', async () => {
    const gateway = fakeGateway([])
    const res = await ingestBrandDna({
      gateway,
      websiteUrl: `${BASE}/`,
      instagramUrl: 'https://www.instagram.com/p/not-a-profile/',
      uploads: [{ kind: 'product_photo', url: 'https://storage.example/kit.png' }],
      websiteAnalyze: () => new Promise(() => { /* never resolves */ }),
      offerForm: { name: 'Kit Piel Sensible', facts: { price: '₡12.900' } },
      timeoutsMs: { website: 50 },
      now: FIXED_NOW,
    })
    const { dna } = res
    const website = dna.sources.find((s) => s.kind === 'website')
    const instagram = dna.sources.find((s) => s.kind === 'instagram')
    expect(website).toMatchObject({ ok: false, url: `${BASE}/` })
    expect(website?.note).toMatch(/timed out/)
    expect(instagram).toMatchObject({ ok: false })
    expect(instagram?.note).toMatch(/Invalid Instagram/)
    expect(dna.sources.find((s) => s.kind === 'upload')?.ok).toBe(true)
    expect(dna.productImageUrls).toEqual(['https://storage.example/kit.png'])
    expect(dna.facts.find((f) => f.key === 'price')).toMatchObject({ value: '₡12.900', confirmed: true })
    expect(res.timingsMs.website).toBeLessThan(2_000)
  })

  it('works with no sources at all (manual facts only)', async () => {
    const res = await ingestBrandDna({
      gateway: fakeGateway([{ match: 'Classify the business', data: { category: 'services_local' } }]),
      userFacts: [{ key: 'brand_name', value: 'Taller Norte' }, { key: 'price', value: '$40' }],
      language: 'es',
      now: FIXED_NOW,
    })
    expect(res.dna.brandName).toBe('Taller Norte')
    expect(res.dna.category).toBe('services_local')
    expect(res.dna.gaps).toEqual(['payment_methods', 'guarantee', 'proof_review'])
    expect(res.dna.notes).toBeUndefined()
    expect(res.dna.sources).toEqual([])
  })
})

describe('ingestUploads', () => {
  it('routes kinds: photos/logo without model, reviews/ref ads/docs via gateway, isolates failures', async () => {
    const gateway = fakeGateway([
      { match: 'customer reviews', data: { customerPhrases: ['Llegó al día siguiente'], proof: [{ key: 'proof_number', value: '4,9/5 (320 reseñas)', evidence: 'shot' }, { key: 'price', value: '₡1' }] } },
      { match: 'reference ad images', data: {}, fail: true },
      { match: 'extract business facts', data: { facts: [{ key: 'returns', value: 'Cambios en 15 días', evidence: 'FAQ' }], audience: ['Mamás primerizas'] } },
    ])
    const part = await ingestUploads({
      gateway,
      now: FIXED_NOW,
      items: [
        { kind: 'product_photo', url: 'https://storage.example/a.png' },
        { kind: 'product_photo', url: 'https://storage.example/a.png' },
        { kind: 'logo', url: 'https://storage.example/logo.png' },
        { kind: 'review_screenshot', url: 'https://storage.example/r.png' },
        { kind: 'reference_ad', url: 'https://storage.example/ad.png' },
        { kind: 'document', text: 'FAQ: Cambios en 15 días.', name: 'faq.txt' },
      ],
    })
    expect(part.productImageUrls).toEqual(['https://storage.example/a.png'])
    expect(part.visual.logoUrl).toBe('https://storage.example/logo.png')
    expect(part.customerPhrases).toEqual(['Llegó al día siguiente'])
    // Review screenshots can only contribute proof facts, never prices.
    expect(part.facts.map((f) => f.key)).toEqual(['proof_number', 'returns'])
    expect(part.facts.every((f) => f.source === 'upload' && !f.confirmed)).toBe(true)
    expect(part.audience).toEqual(['Mamás primerizas'])
    expect(part.notes?.[0]).toMatch(/reference ads/)
    expect(part.sourceEntry.ok).toBe(true)
  })
})
