import { describe, expect, it } from 'vitest'
import {
  analyzeInstagramPosts,
  fetchInstagramProfile,
  IG_APP_ID,
  IG_LIMITED_NOTE,
  ingestInstagram,
  normalizeInstagramHandle,
  parseBioFacts,
  parseCountText,
  parseInstagramHtml,
  splitBioLines,
} from '../../api/lib/adpack/dna/instagram'
import { fakeFetch, fakeGateway, fixture, FIXED_NOW } from './dna-helpers'

const API = 'https://www.instagram.com/api/v1/users/web_profile_info/'
const PROFILE = 'https://www.instagram.com/lumabotanica.cr/'

describe('normalizeInstagramHandle', () => {
  it.each([
    ['@lumabotanica.cr', 'lumabotanica.cr'],
    ['LumaBotanica.CR', 'lumabotanica.cr'],
    ['https://www.instagram.com/lumabotanica.cr/', 'lumabotanica.cr'],
    ['instagram.com/lumabotanica.cr?igsh=abc123', 'lumabotanica.cr'],
    ['https://instagram.com/lumabotanica.cr/reels/', 'lumabotanica.cr'],
    ['https://www.instagram.com/stories/lumabotanica.cr/123/', 'lumabotanica.cr'],
    ['  @@luma_botanica  ', 'luma_botanica'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeInstagramHandle(input)).toBe(expected)
  })

  it.each([
    'https://www.instagram.com/p/Cx123/',
    'https://www.instagram.com/explore/',
    'https://evil.example/instagram.com/luma',
    'not a handle!',
    'luma..botanica',
    '',
  ])('rejects %s', (input) => {
    expect(normalizeInstagramHandle(input)).toBeNull()
  })
})

describe('bio parsing', () => {
  it('splits emoji-led segments and extracts shipping/payment/location/contact facts', () => {
    const bio = '🌿 Jabones artesanales para piel sensible\n🚚 Envíos a todo Costa Rica 24-48h 💳 SINPE Móvil y tarjeta\n📍 Heredia • 📲 Pedidos al WhatsApp 8888-0000'
    const lines = splitBioLines(bio)
    expect(lines).toEqual([
      '🌿 Jabones artesanales para piel sensible',
      '🚚 Envíos a todo Costa Rica 24-48h',
      '💳 SINPE Móvil y tarjeta',
      '📍 Heredia',
      '📲 Pedidos al WhatsApp 8888-0000',
    ])
    const facts = parseBioFacts(lines)
    const byKey = (key: string) => facts.filter((f) => f.key === key).map((f) => f.value)
    expect(byKey('shipping')).toEqual(['Envíos a todo Costa Rica 24-48h'])
    expect(byKey('delivery_time')).toEqual(['Envíos a todo Costa Rica 24-48h'])
    expect(byKey('payment_methods')).toEqual(['SINPE Móvil y tarjeta'])
    expect(byKey('location')).toEqual(['Heredia'])
    expect(byKey('contact_channel')).toEqual(['Pedidos al WhatsApp 8888-0000'])
    expect(facts.every((f) => f.source === 'instagram' && f.confirmed === false)).toBe(true)
    expect(facts[0].evidence).toMatch(/^bio: /)
  })

  it('parses public count text', () => {
    expect(parseCountText('12,3 mil')).toBe(12300)
    expect(parseCountText('298M')).toBe(298_000_000)
    expect(parseCountText('1,553')).toBe(1553)
    expect(parseCountText('1.2K')).toBe(1200)
  })

  it('reads name, counts, bio and link from public profile HTML', () => {
    const parsed = parseInstagramHtml(fixture('ig-profile.html'), 'lumabotanica.cr')
    expect(parsed.found).toBe(true)
    expect(parsed.name).toBe('Luma Botánica')
    expect(parsed.followerCount).toBe(12300)
    expect(parsed.postsCount).toBe(245)
    expect(parsed.externalUrl).toBe('https://lumabotanica.example/')
    expect(parsed.bioLines).toHaveLength(5)
    expect(parsed.posts).toEqual([])
  })
})

describe('fetchInstagramProfile', () => {
  it('uses web_profile_info when it works (with the web app id header)', async () => {
    const fetch = fakeFetch({
      [API]: { body: fixture('ig-web-profile-info.json') },
      [PROFILE]: { body: fixture('ig-profile.html') },
    })
    const profile = await fetchInstagramProfile({ url: 'https://instagram.com/lumabotanica.cr', fetchImpl: fetch.impl })
    expect(profile.tier).toBe('web_profile_info')
    expect(profile.posts).toHaveLength(3)
    expect(profile.posts[0].caption).toContain('₡12.900')
    expect(profile.posts[2].isVideo).toBe(true)
    expect(profile.followerCount).toBe(12345)
    expect(profile.isBusiness).toBe(true)
    const apiReq = fetch.requests.find((r) => r.url.startsWith(API))
    expect(apiReq?.headers['x-ig-app-id']).toBe(IG_APP_ID)
    expect(apiReq?.url).toContain('username=lumabotanica.cr')
    // One request per tier, no retries.
    expect(fetch.requests).toHaveLength(2)
  })

  it('degrades to bio-only HTML when web_profile_info fails', async () => {
    const fetch = fakeFetch({
      [API]: { status: 401, body: '{"message":"login required"}' },
      [PROFILE]: { body: fixture('ig-profile.html') },
    })
    const profile = await fetchInstagramProfile({ handle: '@lumabotanica.cr', fetchImpl: fetch.impl })
    expect(profile.tier).toBe('html')
    expect(profile.posts).toEqual([])
    expect(profile.bioLines.length).toBeGreaterThan(0)
    expect(profile.errors.join(' ')).toMatch(/HTTP 401/)
  })

  it('treats non-JSON / network errors as optional', async () => {
    const fetch = fakeFetch({
      [API]: { body: '<html>not json</html>' },
      [PROFILE]: { body: fixture('ig-profile.html') },
    })
    const profile = await fetchInstagramProfile({ handle: 'lumabotanica.cr', fetchImpl: fetch.impl })
    expect(profile.tier).toBe('html')
    expect(profile.errors[0]).toMatch(/non-JSON/)
  })

  it('returns tier none on login wall + api failure, and times out hanging requests', async () => {
    const fetch = fakeFetch({
      [API]: { hang: true },
      [PROFILE]: { body: fixture('ig-login-wall.html') },
    })
    const t0 = Date.now()
    const profile = await fetchInstagramProfile({ handle: 'lumabotanica.cr', fetchImpl: fetch.impl, timeoutMs: 50 })
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(profile.tier).toBe('none')
    expect(profile.errors.join(' ')).toMatch(/timeout/)
    expect(profile.errors.join(' ')).toMatch(/login wall/)
  })

  it('rejects invalid handles before any request', async () => {
    const fetch = fakeFetch({})
    await expect(fetchInstagramProfile({ url: 'https://www.instagram.com/p/abc/', fetchImpl: fetch.impl })).rejects.toThrow(/Invalid/)
    expect(fetch.requests).toHaveLength(0)
  })
})

describe('ingestInstagram', () => {
  it('bio-only result carries the limited note and candidate facts', async () => {
    const fetch = fakeFetch({ [API]: { status: 429 }, [PROFILE]: { body: fixture('ig-profile.html') } })
    const gateway = fakeGateway([])
    const part = await ingestInstagram({ url: '@lumabotanica.cr', fetchImpl: fetch.impl, gateway, now: FIXED_NOW })
    expect(part.sourceEntry).toEqual({
      kind: 'instagram',
      url: PROFILE,
      fetchedAt: '2026-10-07T12:00:00.000Z',
      ok: true,
      note: IG_LIMITED_NOTE.es,
    })
    expect(gateway.calls).toHaveLength(0)
    expect(part.facts.find((f) => f.key === 'brand_name')?.value).toBe('Luma Botánica')
    expect(part.facts.find((f) => f.key === 'custom:link_in_bio')?.value).toBe('https://lumabotanica.example/')
    expect(part.facts.some((f) => f.key === 'payment_methods')).toBe(true)
  })

  it('analyzes posts through visionJson when posts are available', async () => {
    const fetch = fakeFetch({ [API]: { body: fixture('ig-web-profile-info.json') }, [PROFILE]: { status: 500 } })
    const gateway = fakeGateway([{
      match: 'Instagram posts',
      costUsd: 0.004,
      data: {
        formats: ['offer_graphic', 'ugc_person', 'not_a_format'],
        styleNotes: 'Fondos verdes suaves, luz natural, tipografía serif',
        claims: [
          { key: 'price', value: '₡12.900', evidence: 'post #1 caption' },
          { key: 'Kit size', value: '3 jabones', evidence: 'post #1' },
          { key: 'price', value: '' },
        ],
        customerPhrases: ['Desde que lo uso ya no me pica la piel'],
      },
    }])
    const part = await ingestInstagram({ url: 'lumabotanica.cr', fetchImpl: fetch.impl, gateway, now: FIXED_NOW })
    expect(gateway.calls).toHaveLength(1)
    expect(gateway.calls[0].kind).toBe('visionJson')
    expect(gateway.calls[0].images).toHaveLength(3)
    expect(part.visual.formatsSeen).toEqual(['offer_graphic', 'ugc_person'])
    expect(part.customerPhrases).toEqual(['Desde que lo uso ya no me pica la piel'])
    const price = part.facts.find((f) => f.key === 'price')
    expect(price).toMatchObject({ value: '₡12.900', source: 'instagram', confirmed: false, evidence: 'post #1 caption' })
    expect(part.facts.some((f) => f.key === 'custom:kit_size')).toBe(true)
    expect(part.costUsd).toBe(0.004)
    expect(part.sourceEntry.ok).toBe(true)
    expect(part.sourceEntry.note).toMatch(/3 posts/)
  })

  it('keeps bio facts when post analysis fails', async () => {
    const fetch = fakeFetch({ [API]: { body: fixture('ig-web-profile-info.json') } })
    const gateway = fakeGateway([{ match: 'Instagram posts', data: {}, fail: true }])
    const part = await ingestInstagram({ url: 'lumabotanica.cr', fetchImpl: fetch.impl, gateway, now: FIXED_NOW })
    expect(part.facts.some((f) => f.key === 'shipping')).toBe(true)
    expect(part.notes?.[0]).toMatch(/post analysis failed/)
  })

  it('marks the source not ok when nothing public is readable', async () => {
    const fetch = fakeFetch({ [API]: { throws: 'ECONNRESET' }, [PROFILE]: { throws: 'ECONNRESET' } })
    const part = await ingestInstagram({ url: 'lumabotanica.cr', fetchImpl: fetch.impl, now: FIXED_NOW, language: 'en' })
    expect(part.sourceEntry.ok).toBe(false)
    expect(part.sourceEntry.note).toMatch(/Instagram unavailable/)
    expect(part.facts).toEqual([])
  })
})

describe('analyzeInstagramPosts', () => {
  it('uses text json when there are captions but no images and skips empty input', async () => {
    const gateway = fakeGateway([{ match: 'Instagram posts', data: { formats: ['explainer'], claims: [], customerPhrases: [] } }])
    const empty = await analyzeInstagramPosts({ gateway, images: [], captions: [] })
    expect(empty.costUsd).toBe(0)
    expect(gateway.calls).toHaveLength(0)
    const res = await analyzeInstagramPosts({ gateway, images: ['http://insecure.example/a.jpg'], captions: ['Cómo usar tu jabón en 3 pasos'] })
    expect(gateway.calls[0].kind).toBe('json')
    expect(res.formatsSeen).toEqual(['explainer'])
  })
})
