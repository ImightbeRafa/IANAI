import { describe, expect, it } from 'vitest'
import { ingestWebsite, scanCommerceFacts } from '../../api/lib/adpack/dna/website'
import { fakeGateway, fixture, FIXED_NOW } from './dna-helpers'

const BASE = 'https://lumabotanica.example'

function siteFetch(extra: Record<string, string> = {}) {
  const pages: Record<string, string> = {
    [`${BASE}/`]: fixture('site-home.html'),
    [`${BASE}/envios`]: fixture('site-envios.html'),
    [`${BASE}/assets/theme.css`]: fixture('site-theme.css'),
    ...extra,
  }
  const requested: string[] = []
  const fetchText = async (url: string) => {
    requested.push(url)
    const body = pages[url]
    if (body === undefined) throw new Error(`404 ${url}`)
    return body
  }
  return { fetchText, requested }
}

const SYNTH = {
  facts: {
    businessName: 'Luma Botánica',
    offerName: 'Kit Piel Sensible',
    location: 'Heredia, Costa Rica',
    product_description: 'Jabones artesanales de avena y miel para piel sensible',
    tagline: 'Tu piel, sin químicos agresivos',
    icp: 'Personas con piel sensible que buscan productos naturales',
    main_problem: 'Irritación por jabones con químicos',
    key_objection: '¿Sirve para piel muy sensible?',
    expected_result: 'Piel calmada sin picazón',
    differentiation: 'Hecho a mano con avena local',
    brand_voice: 'Cercana y natural',
    tone_keywords: ['cálida', 'honesta'],
    primary_color: '#2f6b4f',
    accent_color: 'not-a-color',
    font_primary: 'Playfair Display',
    brand_visual: 'Tonos verdes, luz natural, flatlay',
    logo_url: `${BASE}/img/luma-logo.png`,
    reference_images: [`${BASE}/img/product-avena.jpg`, 'https://elsewhere.example/x.jpg'],
  },
  evidence: {
    businessName: { origin: 'web', confidence: 0.98, evidence: ['Luma Botánica'], sourceUrls: [`${BASE}/`] },
    offerName: { origin: 'web', confidence: 0.9, evidence: ['Kit Piel Sensible (3 jabones)'], sourceUrls: [`${BASE}/`] },
    location: { origin: 'web', confidence: 0.9, evidence: ['Hecho a mano en Heredia'], sourceUrls: [`${BASE}/`] },
    differentiation: { origin: 'inferred', confidence: 0.5, evidence: ['hecho a mano'], sourceUrls: [] },
    expected_result: { origin: 'missing', confidence: 0, evidence: [], sourceUrls: [] },
  },
}

describe('scanCommerceFacts', () => {
  it('extracts price, payment, shipping, delivery, guarantee, returns and proof with evidence', () => {
    const facts = scanCommerceFacts([
      { url: `${BASE}/`, text: 'Jabón ₡4.500 · Kit ₡12.900 · Crema ₡4.500. +1.200 clientes felices. Tenés garantía de satisfacción de 30 días.' },
      { url: `${BASE}/envios`, text: 'Hacemos envíos a todo el país. La entrega tarda de 2 a 4 días hábiles. Aceptamos SINPE Móvil y tarjetas de crédito. Devoluciones dentro de 15 días.' },
    ])
    const get = (key: string) => facts.find((f) => f.key === key)
    expect(get('price')?.value).toBe('₡4.500')
    expect(get('payment_methods')?.value).toBe('SINPE Móvil, tarjeta')
    expect(get('shipping')?.value).toMatch(/envíos a todo el país/i)
    expect(get('delivery_time')?.value).toBe('2 a 4 días hábiles')
    expect(get('guarantee')?.value).toMatch(/^garantía de satisfacción de 30 días/)
    expect(get('returns')?.value).toMatch(/^Devoluciones dentro de 15 días/)
    expect(get('proof_number')?.value).toBe('+1.200 clientes felices')
    expect(facts.every((f) => f.source === 'website' && !f.confirmed && f.evidence)).toBe(true)
  })

  it('returns nothing for text without commerce signals', () => {
    expect(scanCommerceFacts([{ url: `${BASE}/`, text: 'Bienvenidos a nuestro blog de recetas.' }])).toEqual([])
  })
})

describe('ingestWebsite', () => {
  it('reuses runSiteAnalysis with injected fetch + gateway and maps into a DnaPart', async () => {
    const { fetchText, requested } = siteFetch()
    const gateway = fakeGateway([{ match: 'Brand Kit', data: SYNTH, costUsd: 0.0123 }])
    const part = await ingestWebsite({ url: `${BASE}/`, gateway, fetchText, now: FIXED_NOW })

    expect(gateway.calls).toHaveLength(1)
    expect(gateway.calls[0].kind).toBe('json')
    expect(gateway.calls[0].user).toContain('LOGO CANDIDATES')
    expect(requested).toContain(`${BASE}/envios`)
    expect(part.costUsd).toBe(0.0123)
    expect(part.sourceEntry).toMatchObject({ kind: 'website', url: `${BASE}/`, ok: true, fetchedAt: '2026-10-07T12:00:00.000Z' })

    const get = (key: string) => part.facts.filter((f) => f.key === key)
    expect(get('brand_name')).toEqual([expect.objectContaining({ value: 'Luma Botánica', source: 'website', confirmed: true })])
    expect(get('offer_name')[0]).toMatchObject({ value: 'Kit Piel Sensible', confirmed: false })
    expect(get('differentiator')[0]).toMatchObject({ source: 'inferred', confirmed: false })
    expect(get('result_claim')).toEqual([]) // origin "missing" is skipped
    // Deterministic commerce scan over the crawled HTML.
    expect(get('price')[0].value).toBe('₡4.500')
    expect(get('payment_methods')[0].value).toBe('SINPE Móvil, tarjeta, transferencia')
    expect(get('delivery_time')[0].value).toBe('2 a 4 días hábiles')
    expect(get('guarantee')[0].evidence).toContain(`${BASE}/`)
    expect(get('returns')).toHaveLength(1)
    expect(part.facts.filter((f) => f.key !== 'brand_name').every((f) => !f.confirmed)).toBe(true)

    expect(part.visual).toMatchObject({
      primaryColor: '#2f6b4f',
      headingFont: 'Playfair Display',
      logoUrl: `${BASE}/img/luma-logo.png`,
      styleNotes: 'Tonos verdes, luz natural, flatlay',
    })
    expect(part.visual.accentColor).toMatch(/^#[0-9a-f]{3,6}$/)
    expect(part.referenceImageUrls).toEqual([`${BASE}/img/product-avena.jpg`])
    expect(part.voice).toBe('Cercana y natural · cálida, honesta')
    expect(part.pains).toEqual(['Irritación por jabones con químicos'])
    expect(part.oneLiner).toBe('Tu piel, sin químicos agresivos')
    expect(part.textSample).toMatch(/Querés probarlo/)
  })

  it('propagates crawl failure (orchestrator records it as a failed source)', async () => {
    const gateway = fakeGateway([{ match: 'Brand Kit', data: SYNTH }])
    const fetchText = async () => { throw new Error('ENOTFOUND') }
    await expect(ingestWebsite({ url: `${BASE}/`, gateway, fetchText })).rejects.toThrow(/ENOTFOUND/)
    expect(gateway.calls).toHaveLength(0)
  })

  it('rejects non-https and private URLs via the shared SSRF guard', async () => {
    const { fetchText } = siteFetch()
    await expect(ingestWebsite({ url: 'http://lumabotanica.example/', fetchText })).rejects.toThrow(/https/)
    await expect(ingestWebsite({ url: 'https://localhost/', fetchText })).rejects.toThrow(/not allowed/)
  })
})
