/**
 * PARITY: the xAI request the WEB route (api/generate-image.ts, chat-shell "generar imagen", real handler)
 * sends equals the one the MCP image path (generateWebStyleImage → runWebPostGrokImage) sends for the same
 * brand/offer/photos/copy. Only xAI + auth/db edges are faked. With PARITY_OUT=<dir> it dumps both payloads.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LOGO_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const LOGO = `data:image/png;base64,${LOGO_B64}`
const KIT = {
  id: 'kit1', name: 'Prototipo', primary_color: '#0b3d91', secondary_color: '#ffffff', accent_color: '#f5a623',
  logo_url: LOGO, brand_voice: 'cercano, voseo', visual_style_notes: 'luz natural', reference_images: [] as string[],
  user_id: 'u1', font_primary: null, font_secondary: null, tagline: null, industry: null, target_audience: null,
  tone_keywords: [] as string[], must_use_phrases: [] as string[], forbidden_phrases: [] as string[], is_active: true, is_default: true, client_id: null,
}
const PRODUCT_ROW = {
  name: 'Avión Prototipo', product_description: 'Avión de papel con motores', description: null,
  technical_specs: 'Silueta: planeador blanco con hélices rojas', product_category: 'juguete', product_category_custom: null,
  offer: '₡14.900', price_range: null,
}

vi.mock('../api/lib/auth.js', () => ({
  requireAuth: vi.fn(async () => ({ id: 'u1', email: 'u@test.com' })),
  checkUsageLimit: vi.fn(async () => ({ allowed: true, remaining: 99, limit: 99 })),
  incrementUsage: vi.fn(async () => ({ creditsCharged: 6 })),
  deductBonusImage: vi.fn(async () => undefined),
  isAdminUser: vi.fn(async () => false),
}))
vi.mock('../api/lib/product-access.js', () => ({ userHasProductAccess: vi.fn(async () => true) }))
vi.mock('../api/lib/usage-logger.js', () => ({ logApiUsage: vi.fn(async () => undefined), estimateTokens: vi.fn(() => 1) }))
vi.mock('../api/lib/memory-helpers.js', () => ({ getMemoryInjection: vi.fn(async () => '') }))
vi.mock('../api/lib/supabase-admin.js', () => {
  const chain: Record<string, unknown> = {}
  const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, single: async () => ({ data: PRODUCT_ROW, error: null }), maybeSingle: async () => ({ data: PRODUCT_ROW, error: null }) }
  void chain
  return { supabaseAdmin: { from: () => q }, getSupabaseAdmin: () => null }
})
vi.mock('../api/lib/image-jobs.js', async (orig) => {
  const actual = await orig<typeof import('../api/lib/image-jobs')>()
  return { ...actual, getImageJob: vi.fn(async () => null) }
})
vi.mock('../api/lib/brand-kit.js', async (orig) => {
  const actual = await orig<typeof import('../api/lib/brand-kit')>()
  return {
    ...actual,
    resolveBrandKit: vi.fn(async () => KIT),
    fetchBrandLogoAsBase64: vi.fn(async () => ({ mimeType: 'image/png', data: LOGO_B64 })),
  }
})

import handler from '../api/generate-image'
import { generateWebStyleImage, buildMcpBusinessContext } from '../api/lib/mcp/web-image'
import type { McpBrandContext } from '../api/lib/mcp/user-tools'

async function photo(bg: string): Promise<string> {
  const b = await sharp({ create: { width: 64, height: 64, channels: 3, background: bg } }).png().toBuffer()
  return `data:image/png;base64,${b.toString('base64')}`
}

let xai: Array<{ url: string; body: Record<string, any> }> = []
beforeEach(() => {
  xai = []
  process.env.GROK_API_KEY = 'test-key'
  process.env.XAI_API_KEY = 'test-key'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    xai.push({ url, body: JSON.parse(init.body) })
    const jpg = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#668' } }).jpeg().toBuffer()
    return new Response(JSON.stringify({ data: [{ b64_json: jpg.toString('base64') }] }), { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

function fakeRes() {
  const state: { status: number; body: unknown } = { status: 200, body: null }
  const res: any = {
    setHeader() { return res }, status(c: number) { state.status = c; return res }, json(b: unknown) { state.body = b; return res }, end() { return res },
  }
  return { res, state }
}

const redact = (req: Record<string, any>) => {
  const out: Record<string, any> = JSON.parse(JSON.stringify(req))
  const hide = (r: { url: string }) => ({ url: `<image ${createHash('sha256').update(r.url).digest('hex').slice(0, 12)} ${r.url.length}b>` })
  if (out.image) out.image = hide(out.image)
  if (out.images) out.images = out.images.map(hide)
  return out
}

describe('web route ⇄ MCP: identical xAI request for the same input', () => {
  it.each([
    { name: 'prototipo-4x5-2photos-logo', ratio: '4:5', w: 1080, h: 1350 },
    { name: 'prototipo-9x16-2photos-logo', ratio: '9:16', w: 1080, h: 1920 },
  ])('$name', async ({ name, ratio, w, h }) => {
    const p1 = await photo('#c0392b')
    const p2 = await photo('#2980b9')
    const copy = 'Papel arriba. Motores abajo.\n₡14.900 · Envío a todo el país\nEscribinos por DM'
    const scene = 'taller de papá, luz de tarde'
    const offer = { id: 'f0f0f0f0-0000-4000-8000-000000000001', name: PRODUCT_ROW.name, price: '₡14.900', productDescription: PRODUCT_ROW.product_description, technicalSpecs: PRODUCT_ROW.technical_specs, type: 'juguete' }
    const businessContext = buildMcpBusinessContext({ language: 'es', scene, offer: offer as never })

    // WEB: the real handler, chat-shell body shape (mode post, venta-directa, hard density).
    const { res, state } = fakeRes()
    await handler({
      method: 'POST',
      headers: {},
      body: {
        action: 'generate', model: 'grok-imagine', mode: 'post', generationId: '11111111-1111-4111-8111-111111111111',
        productId: offer.id, brandKitId: 'kit1', prompt: copy, aspectRatio: ratio, width: w, height: h,
        language: 'es', textDensity: 'hard', postStyle: 'venta-directa', businessContext,
        input_image: p1, input_image_2: p2, referenceImageRoles: ['product', 'product'],
      },
    } as never, res)
    expect((state.body as { status?: string }).status).toBe('Ready')
    const web = xai.pop()!

    // MCP: same brand kit / offer / photos / copy through the shared bridge.
    const ctx = {
      brand: { id: 'b1', name: 'Prototipo' },
      offers: [offer],
      brandKit: { id: KIT.id, name: KIT.name, primaryColor: KIT.primary_color, secondaryColor: KIT.secondary_color, accentColor: KIT.accent_color, logoUrl: LOGO, brandVoice: KIT.brand_voice, visualStyleNotes: KIT.visual_style_notes, referenceImages: [] },
    } as unknown as McpBrandContext
    await generateWebStyleImage({ apiKey: 'test-key', ctx, offerId: offer.id, aspectRatio: ratio, copy, scene, productUrls: [p1, p2], mcpRules: false })
    const mcp = xai.pop()!

    expect(mcp.url).toBe(web.url)
    expect(mcp.url).toContain('/images/edits')
    expect(mcp.body).toEqual(web.body)

    if (process.env.PARITY_OUT) {
      mkdirSync(process.env.PARITY_OUT, { recursive: true })
      const dump = (who: string, r: typeof web) => writeFileSync(`${process.env.PARITY_OUT}/${name}.${who}.json`, JSON.stringify({ endpoint: r.url, request: redact(r.body), prompt: r.body.prompt }, null, 2))
      dump('web', web)
      dump('mcp', mcp)
      writeFileSync(`${process.env.PARITY_OUT}/${name}.prompt.txt`, String(web.body.prompt))
    }
  })
})
