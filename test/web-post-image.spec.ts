import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  buildWebGrokRequest,
  buildWebPostSourcePrompt,
  getAspectRatio,
  postWebGrokWithClampRetry,
  resolveWebGrokApi,
  runWebPostGrokImage,
  selectWebPostReferenceUrls,
  toWebGrokAspectRatio,
} from '../api/lib/web-post-image'
import { buildSlimGrokPostPrompt, prepareGrokImagePrompt } from '../api/lib/grok-image-prompt'
import { buildLogoStampRules, buildPostCtaGuardrails, resolveLockedOfferPrice, resolveProductSilhouette } from '../api/lib/product-creative-rules'
import { selectGrokReferenceBudget } from '../api/lib/image-prompt-context'
import { resolveGrokImageApiMode } from '../api/lib/grok-image-generate'
import { generateWebStyleImage, offerLockFromRow } from '../api/lib/mcp/web-image'
import { parseWebPostArgs } from '../api/lib/mcp/execute-tools'
import { resolveToolProductFidelity } from '../api/lib/adpack/fidelity/pipeline'
import type { McpBrandContext } from '../api/lib/mcp/user-tools'

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const ref = (n: number) => `${PX}#p${n}`
const LOGO = `${PX}#logo`
const OFFER = {
  id: 'off-1',
  name: 'Avión Prototipo',
  price: '₡14.900',
  productDescription: 'Avión de papel con motores',
  technicalSpecs: 'Silueta: planeador de unicel blanco con dos hélices rojas',
  type: 'juguete',
}
const CTX: McpBrandContext = {
  brand: { id: 'b1', name: 'Prototipo' } as McpBrandContext['brand'],
  offers: [OFFER] as McpBrandContext['offers'],
  brandKit: {
    id: 'kit1', name: 'Prototipo', primaryColor: '#0b3d91', secondaryColor: '#ffffff', accentColor: '#f5a623',
    logoUrl: LOGO, brandVoice: 'cercano, voseo', visualStyleNotes: 'colores sólidos, luz natural',
    referenceImages: [ref(9)],
  },
  brandKits: [],
  latestGuideIntake: null,
} as unknown as McpBrandContext

let calls: Array<{ url: string; body: Record<string, any> }> = []
function mockXai(responses: Array<{ ok: boolean; status?: number; text?: string }> = [{ ok: true }]) {
  calls = []
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    const r = responses[Math.min(i++, responses.length - 1)]
    if (r.ok) return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), { status: 200 })
    return new Response(r.text || 'bad', { status: r.status || 400 })
  }))
}
beforeEach(() => { process.env.GROK_API_KEY = 'test-key' })
afterEach(() => { vi.unstubAllGlobals() })

describe('web-post-image parity: the extracted builders equal the original inline web code', () => {
  // Reconstruction of the pre-extraction inline code in api/generate-image.ts (git 71e421b).
  function legacy(opts: { w: number; h: number; productUrls: string[]; logo: string | null; support: string[]; lang: 'es' | 'en'; copy: string }) {
    const row = { name: OFFER.name, product_description: OFFER.productDescription, technical_specs: OFFER.technicalSpecs, product_category: 'juguete', offer: '₡14.900' }
    const refs = selectGrokReferenceBudget([
      ...opts.productUrls.map((url) => ({ url, role: 'product' as const })),
      ...(opts.logo ? [{ url: opts.logo, role: 'style' as const }] : []),
      ...opts.support.map((url) => ({ url, role: 'scene' as const })),
    ], 3).map((r) => r.url)
    const prompt = buildSlimGrokPostPrompt({
      language: opts.lang, postStyle: 'venta-directa', productSubStyle: null, textDensity: 'hard', userCopy: opts.copy,
      palette: '#0b3d91, #fff', brandVoice: 'cercano', brandVisual: 'sólido', businessContext: 'ctx',
      hasProductRefs: opts.productUrls.length > 0, hasSceneRef: opts.support.length > 0,
      productSilhouette: resolveProductSilhouette(row, opts.lang, 'Prototipo', { productId: null, brandKitId: null }),
      lockedOfferPrice: resolveLockedOfferPrice(row, 'Prototipo', { productId: null, brandKitId: null }),
      logoStampRules: buildLogoStampRules(opts.lang, Boolean(opts.logo), { bloomSku: false }),
      ctaGuardrails: buildPostCtaGuardrails(opts.lang, 'sales'),
      hasBrandLogo: Boolean(opts.logo), category: 'juguete', offerName: OFFER.name, scriptContext: opts.copy,
    })
    const prepared = prepareGrokImagePrompt(prompt, { preferTail: opts.copy })
    let aspect = getAspectRatio(opts.w, opts.h)
    const SUP = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20', 'auto']
    if (!SUP.includes(aspect)) aspect = ({ '4:5': '3:4', '5:4': '4:3' } as Record<string, string>)[aspect] || '1:1'
    const api = resolveGrokImageApiMode({ action: 'generate', productReferenceCount: opts.productUrls.length, referenceCount: refs.length })
    const req: Record<string, unknown> = { model: 'grok-imagine-image-2.0', prompt: prepared.prompt, n: 1, response_format: 'b64_json', aspect_ratio: aspect, resolution: '2k', quality: 'medium' }
    if (refs.length === 1) req.image = { url: refs[0], type: 'image_url' }
    else if (refs.length > 1) req.images = refs.map((url) => ({ url, type: 'image_url' }))
    else if (opts.logo && api.mode === 'compose') req.image = { url: opts.logo, type: 'image_url' }
    return { endpoint: api.endpoint, req }
  }

  function viaLib(opts: { w: number; h: number; productUrls: string[]; logo: string | null; support: string[]; lang: 'es' | 'en'; copy: string }) {
    const row = { name: OFFER.name, product_description: OFFER.productDescription, technical_specs: OFFER.technicalSpecs, product_category: 'juguete', offer: '₡14.900' }
    const scope = { productId: null, brandKitId: null }
    const refs = selectWebPostReferenceUrls({ productUrls: opts.productUrls, logoDataUrl: opts.logo, supportUrls: opts.support })
    const source = buildWebPostSourcePrompt({
      language: opts.lang, postStyle: 'venta-directa', textDensity: 'hard', userCopy: opts.copy, palette: '#0b3d91, #fff',
      brandVoice: 'cercano', brandVisual: 'sólido', businessContext: 'ctx', hasProductRefs: opts.productUrls.length > 0,
      hasSceneRef: opts.support.length > 0, productSilhouette: resolveProductSilhouette(row, opts.lang, 'Prototipo', scope),
      lockedOfferPrice: resolveLockedOfferPrice(row, 'Prototipo', scope), hasBrandLogo: Boolean(opts.logo), ctaStrength: 'sales', productRow: row,
    })
    const prepared = prepareGrokImagePrompt(source, { preferTail: opts.copy })
    const api = resolveWebGrokApi(opts.productUrls.length, refs.length)
    return { endpoint: api.endpoint, req: buildWebGrokRequest({ prompt: prepared.prompt, aspectRatio: toWebGrokAspectRatio(getAspectRatio(opts.w, opts.h)), referenceUrls: refs, logoDataUrl: opts.logo, api }) }
  }

  const cases = [
    { w: 1080, h: 1350, productUrls: [ref(1)], logo: LOGO, support: [], lang: 'es' as const, copy: 'Papel arriba. Motores abajo. ₡14.900' },
    { w: 1080, h: 1920, productUrls: [ref(1), ref(2)], logo: LOGO, support: [ref(7)], lang: 'es' as const, copy: 'Armalo vos' },
    { w: 1080, h: 1080, productUrls: [], logo: LOGO, support: [], lang: 'en' as const, copy: 'Fly it' },
    { w: 1080, h: 1440, productUrls: [ref(1), ref(2), ref(3), ref(4)], logo: null, support: [], lang: 'es' as const, copy: '' },
  ]
  it.each(cases)('same endpoint + request for %#', (c) => {
    expect(viaLib(c)).toEqual(legacy(c))
  })

  it('4:5 is sent to Grok as 3:4, exactly like the web route', () => {
    expect(toWebGrokAspectRatio(getAspectRatio(1080, 1350))).toBe('3:4')
    expect(toWebGrokAspectRatio('9:16')).toBe('9:16')
  })

  it('the web route imports the shared lib and no longer carries its own copy of the builders', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../api/generate-image.ts', import.meta.url), 'utf8')
    expect(src).toContain("from './lib/web-post-image.js'")
    expect(src).toContain('buildWebPostSourcePrompt(')
    expect(src).toContain('postWebGrokWithClampRetry(')
    expect(src).not.toContain('buildSlimGrokPostPrompt(')
    expect(src).not.toMatch(/grokRequest\.images\s*=/)
  })
})

describe('runWebPostGrokImage (mocked xAI)', () => {
  const base = {
    apiKey: 'k', aspectRatio: '3:4', language: 'es' as const, copy: 'Armá el tuyo. ₡14.900. Escribinos por DM',
    palette: ['#0b3d91'], brandVoice: 'cercano', brandName: 'Prototipo', offerId: 'off-1',
    productRow: { name: 'Avión Prototipo', offer: '₡14.900', technical_specs: 'Silueta: planeador blanco con dos hélices rojas', product_category: 'juguete' },
    productUrls: [ref(1), ref(2)], logoUrl: LOGO,
  }

  it('product photos → /images/edits product lock; prompt carries copy, price, CTA guardrails, logo stamp rules and lock fields', async () => {
    mockXai()
    const out = await runWebPostGrokImage({ ...base, lockProductAppearance: true, immutableAttributes: ['hélices rojas', 'cuerpo blanco'] })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/images/edits')
    expect(out.lockApplied).toBe(true)
    const body = calls[0].body
    expect(body.model).toBe('grok-imagine-image-2.0')
    expect(body.aspect_ratio).toBe('3:4')
    // 2 product photos + logo as the last reference, budget 3
    expect(body.images).toHaveLength(3)
    expect(body.images[2].url).toContain('#logo'.slice(0, 1) === '#' ? 'base64' : '')
    const p = String(body.prompt)
    expect(p).toContain('Armá el tuyo')
    expect(p).toContain('₡14.900')
    expect(p).toMatch(/PRODUCT LOCK|PRODUCTO/i)
    expect(p).toMatch(/logo/i)
    expect(p).toMatch(/Escribinos|CTA/i)
    expect(p).toContain('hélices rojas')
    expect(p).toMatch(/PRODUCTO BLOQUEADO/)
  })

  it('no product photo → /images/generations compose', async () => {
    mockXai()
    const out = await runWebPostGrokImage({ ...base, productUrls: [], logoUrl: null })
    expect(calls[0].url).toContain('/images/generations')
    expect(out.lockApplied).toBe(false)
  })

  it('auto-appends brand-kit reference photos as product refs (2+ photos, 4 slots max)', async () => {
    mockXai()
    const out = await runWebPostGrokImage({ ...base, productUrls: [ref(1)], logoUrl: null, kitReferenceUrls: [ref(8), ref(9), ref(10), ref(11)] })
    expect(out.referenceCount).toBe(3) // 1 confirmed + 3 kit, then the 3-ref budget
    expect(calls[0].body.images).toHaveLength(3)
    expect(out.productReferenceDataUrls.length).toBe(4)
  })

  it('retries once with the aggressive clamp when Grok rejects the prompt length', async () => {
    mockXai([{ ok: false, status: 400, text: 'prompt length exceeds the maximum allowed length of 8000' }, { ok: true }])
    const out = await runWebPostGrokImage({ ...base, copy: 'x'.repeat(2000) })
    expect(calls).toHaveLength(2)
    expect(out.retriedWithClamp).toBe(true)
    expect(String(calls[1].body.prompt).length).toBeLessThanOrEqual(String(calls[0].body.prompt).length)
  })

  it('throws the xAI error (no silent success) when the retry also fails', async () => {
    mockXai([{ ok: false, status: 500, text: '{"error":{"message":"boom"}}' }])
    await expect(runWebPostGrokImage(base)).rejects.toThrow(/boom/)
  })

  it('postWebGrokWithClampRetry does not retry on other errors', async () => {
    mockXai([{ ok: false, status: 429, text: 'rate' }])
    const r = await postWebGrokWithClampRetry({ endpoint: 'https://x.test/e', apiKey: 'k', sourcePrompt: 'p', preferTail: '', buildRequest: (prompt) => ({ prompt }) })
    expect(calls).toHaveLength(1)
    expect(r.retried).toBe(false)
  })
})

describe('MCP defaults and inputs', () => {
  it('productFidelity defaults to generated (web path) with or without a product photo; exact is opt-in', () => {
    expect(resolveToolProductFidelity(undefined, true)).toBe('generated')
    expect(resolveToolProductFidelity(undefined, false)).toBe('generated')
    expect(resolveToolProductFidelity('exact', true)).toBe('exact')
    expect(() => resolveToolProductFidelity('exact', false)).toThrow(/needs a product photo/)
  })

  it('parseWebPostArgs validates copy/density/style/cta/lock', () => {
    expect(parseWebPostArgs({ copy: ' Hola ', textDensity: 'medium', postStyle: 'anuncio-conversion', ctaStrength: 'soft', immutableAttributes: ['a', ' b '], lockProductAppearance: true }))
      .toEqual({ copy: 'Hola', textDensity: 'medium', postStyle: 'anuncio-conversion', ctaStrength: 'soft', immutableAttributes: ['a', 'b'], lockProductAppearance: true, autoRetry: false, layoutCap: true, enforceSafeZones: true })
    expect(() => parseWebPostArgs({ textDensity: 'huge' })).toThrow()
    expect(() => parseWebPostArgs({ postStyle: 'x' })).toThrow()
  })

  it('reads the offer lock from ad_profile', () => {
    expect(offerLockFromRow({ ad_profile: { lockProductAppearance: true, immutableAttributes: ['hélices rojas'] } }))
      .toEqual({ lockProductAppearance: true, immutableAttributes: ['hélices rojas'], allowedProps: [], forbidExtraProps: true })
    expect(offerLockFromRow({ ad_profile: { allowedProps: ['hoja A4'] } }).allowedProps).toEqual(['hoja A4'])
    // MCP: no object outside the lock / references / scene / allowed list, whatever the row says.
    expect(offerLockFromRow(null)).toEqual({ forbidExtraProps: true })
  })
})

describe('generateWebStyleImage (MCP bridge, mocked xAI)', () => {
  it('4:5 is generated at 3:4 and reframed to an exact 4:5, with kit logo + brand kit + offer in the request', async () => {
    const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#7a8c6a' } }).jpeg().toBuffer()
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
    }))
    const out = await generateWebStyleImage({
      apiKey: 'k', ctx: CTX, offerId: 'off-1', aspectRatio: '4:5', copy: 'Papel arriba. Motores abajo.', scene: 'taller de papá',
      productUrls: [ref(1)], lock: { lockProductAppearance: true, immutableAttributes: ['hélices rojas'] },
    })
    expect(calls[0].body.aspect_ratio).toBe('3:4')
    const meta = await sharp(Buffer.from(out.generated.imageDataUrl.split(',')[1], 'base64')).metadata()
    expect(Math.abs((meta.width! / meta.height!) - 0.8)).toBeLessThan(0.01)
    const p = String(calls[0].body.prompt)
    expect(p).toContain('Papel arriba. Motores abajo.')
    expect(p).toContain('₡14.900')
    expect(p).toContain('hélices rojas')
    expect(calls[0].body.images.length).toBeGreaterThanOrEqual(2) // product + kit ref/logo
    expect(out.qa.logo).toBe('attached')
    expect(out.copySource).toBe('copy')
  })

  it('falls back to the offer name + price when no copy is given, and says so', async () => {
    mockXai()
    const out = await generateWebStyleImage({ apiKey: 'k', ctx: CTX, offerId: 'off-1', aspectRatio: '9:16', productUrls: [ref(1)] })
    expect(out.copySource).toBe('offer_default')
    expect(String(calls[0].body.prompt)).toContain('Avión Prototipo — ₡14.900')
  })
})
