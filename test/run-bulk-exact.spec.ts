import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Bulk posts / campaign pack image step: productFidelity 'generated' (DEFAULT, the web-app Grok flow via
// api/lib/web-post-image.ts, every ratio works: 4:5 reframed) vs 'exact' (opt-in) which composites the real product pixels.

vi.mock('../api/lib/auth.js', () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true })),
  incrementUsage: vi.fn(async () => ({ creditsCharged: 6 })),
}))
vi.mock('../api/lib/usage-logger.js', () => ({
  logApiUsage: vi.fn(async () => undefined),
  estimateTokens: vi.fn(() => 1),
}))
import { runBulkPosts } from '../api/lib/bulk/run-bulk.js'
import type { AngleBoardItem } from '../api/lib/bulk/types.js'
import { productOnWhite, syntheticPlate } from './adpack/fidelity-fixtures'
import { runnerGateway } from './adpack/runner-fakes'

const angles: AngleBoardItem[] = [{ id: 'a1', title: 'Regalo', niche: 'regalo de cumpleaños', whyItBuys: 'why', hookStyle: 'hook', frameworkHint: 'hint' }]

async function runtime(extra: Record<string, unknown>) {
  const saved: Array<{ imageDataUrl: string; metadata: Record<string, unknown> }> = []
  const productUrl = `data:image/jpeg;base64,${(await productOnWhite()).toString('base64')}`
  const plateGw = runnerGateway()
  plateGw.scene = async (input) => {
    plateGw.sceneCalls.push({ prompt: input.prompt, refs: input.refs, styleRefs: [], ratio: input.ratio, draft: input.draft, startedAt: Date.now() })
    return { bytes: new Uint8Array(await syntheticPlate(900, 1200)), mimeType: 'image/jpeg', costUsd: 0.02, model: 'fake-plate', productLocked: false }
  }
  return {
    saved,
    plateGw,
    rt: {
      user: { id: 'user-1', email: 'u@test.com' },
      brandId: 'brand-1',
      offerId: 'offer-1',
      language: 'es' as const,
      ctx: { brand: { name: 'Marca Demo', icpDescription: '' }, offers: [{ id: 'offer-1', name: 'Kit Demo' }], brandKit: null },
      artifactStore: {
        ensureExecuteSession: vi.fn(async () => ({ sessionId: 's-1' })),
        saveImageArtifact: vi.fn(async (input: { imageDataUrl: string; metadata: Record<string, unknown> }) => {
          saved.push(input)
          return { imageUrl: 'https://storage.test/img.jpg', productImageId: 'pi-1', messageId: 'm-1' }
        }),
      },
      source: 'mcp' as const,
      packId: 'pack-1',
      aspectRatio: '4:5',
      productRefUrls: [productUrl],
      fidelityGateway: plateGw,
      ...extra,
    },
  }
}

const xaiCalls: Array<{ url: string; body: Record<string, any> }> = []

describe('runBulkPosts product fidelity', () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = 'test-key'
    xaiCalls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      xaiCalls.push({ url: String(_url), body })
      const [w, h] = body.aspect_ratio === '3:4' ? [900, 1200] : [1080, 1920]
      const jpg = await sharp({ create: { width: w, height: h, channels: 3, background: '#335577' } }).jpeg().toBuffer()
      return new Response(JSON.stringify({ data: [{ b64_json: jpg.toString('base64') }] }), { status: 200 })
    }))
  })
  afterEach(() => {
    delete process.env.XAI_API_KEY
  })

  it("'exact' (opt-in): real product composited on a plate, fidelity in the item + metadata, 4:5 output", async () => {
    const { rt, saved, plateGw } = await runtime({ productFidelity: 'exact' })
    const res = await runBulkPosts({ runtime: rt as never, angles })
    expect(res.succeeded).toBe(1)
    expect(xaiCalls).toHaveLength(0)
    expect(plateGw.sceneCalls[0].refs).toEqual([])
    // The relight stage is included (deterministic harmonization), and the product still passes.
    expect(res.items[0].fidelity).toMatchObject({ passed: true, method: 'harmonized' })
    expect(saved[0].metadata).toMatchObject({ productFidelity: 'exact', grokMode: 'exact_composite' })
    const meta = await sharp(Buffer.from(saved[0].imageDataUrl.split(',')[1], 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([1080, 1350])
  })

  it("default ('generated' = web path): Grok product-lock call, 4:5 generated at native 3:4 and reframed to an exact 4:5, post-check in the item", async () => {
    const { rt, saved } = await runtime({})
    const res = await runBulkPosts({ runtime: rt as never, angles })
    expect(res.succeeded).toBe(1)
    expect(xaiCalls).toHaveLength(1)
    expect(xaiCalls[0].url).toContain('/images/edits')
    expect(xaiCalls[0].body.aspect_ratio).toBe('3:4')
    expect(String(xaiCalls[0].body.prompt)).toMatch(/PRODUCT LOCK|PRODUCTO/i)
    const meta = await sharp(Buffer.from(saved[0].imageDataUrl.split(',')[1], 'base64')).metadata()
    expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 0.8)).toBeLessThan(0.005)
    expect(res.items[0].fidelity).toBeUndefined()
    expect(saved[0].metadata).toMatchObject({ grokMode: 'product_lock_scene', lockApplied: true })
    expect(res.items[0]).toHaveProperty('fidelityCheck')
    expect(res.items[0]).toHaveProperty('qa')
  })
})
