import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Bulk posts / campaign pack image step: productFidelity 'exact' (default with product refs)
// composites the real product pixels; 'generated' keeps Grok but every ratio works (4:5 reframed).

vi.mock('../api/lib/auth.js', () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true })),
  incrementUsage: vi.fn(async () => ({ creditsCharged: 6 })),
}))
vi.mock('../api/lib/usage-logger.js', () => ({
  logApiUsage: vi.fn(async () => undefined),
  estimateTokens: vi.fn(() => 1),
}))
vi.mock('../api/lib/grok-image-generate.js', () => ({
  runGrokPostFirstGen: vi.fn(async (opts: { aspectRatio: string }) => {
    const [w, h] = opts.aspectRatio === '3:4' ? [900, 1200] : [1080, 1920]
    const png = await sharp({ create: { width: w, height: h, channels: 3, background: '#335577' } }).jpeg().toBuffer()
    return { imageDataUrl: `data:image/jpeg;base64,${png.toString('base64')}`, providerModel: 'grok-imagine', estimatedCostUsd: 0.07, resolution: '2k', quality: 'medium', aspectRatio: opts.aspectRatio, mode: 'product_lock_scene', lockApplied: true }
  }),
}))

import { runGrokPostFirstGen } from '../api/lib/grok-image-generate.js'
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

describe('runBulkPosts product fidelity', () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = 'test-key'
    vi.mocked(runGrokPostFirstGen).mockClear()
  })
  afterEach(() => {
    delete process.env.XAI_API_KEY
  })

  it('defaults to exact with product refs: real product composited on a plate, fidelity in the item + metadata, 4:5 output', async () => {
    const { rt, saved, plateGw } = await runtime({})
    const res = await runBulkPosts({ runtime: rt as never, angles })
    expect(res.succeeded).toBe(1)
    expect(runGrokPostFirstGen).not.toHaveBeenCalled()
    expect(plateGw.sceneCalls[0].refs).toEqual([])
    expect(res.items[0].fidelity).toMatchObject({ passed: true, method: 'composite' })
    expect(saved[0].metadata).toMatchObject({ productFidelity: 'exact', grokMode: 'exact_composite' })
    const meta = await sharp(Buffer.from(saved[0].imageDataUrl.split(',')[1], 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([1080, 1350])
  })

  it("'generated' keeps Grok, generates 4:5 at native 3:4 and reframes to an exact 4:5", async () => {
    const { rt, saved } = await runtime({ productFidelity: 'generated' })
    const res = await runBulkPosts({ runtime: rt as never, angles })
    expect(res.succeeded).toBe(1)
    expect(vi.mocked(runGrokPostFirstGen).mock.calls[0][0]).toMatchObject({ aspectRatio: '3:4' })
    const meta = await sharp(Buffer.from(saved[0].imageDataUrl.split(',')[1], 'base64')).metadata()
    expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 0.8)).toBeLessThan(0.005)
    expect(res.items[0].fidelity).toBeUndefined()
  })
})
