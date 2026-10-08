import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkScene } from '../../api/lib/adpack/check-scene'
import { createModelGateway, extractJson, withCostLedger } from '../../api/lib/adpack/gateway'
import { imageSize } from '../../api/lib/adpack/image-size'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import { buildScenePrompt, generateScene, SCENE_STRICT_NO_TEXT } from '../../api/lib/adpack/scene'
import { createMemoryPackStore } from '../../api/lib/adpack/store-memory'
import { runGrokPostFirstGen } from '../../api/lib/grok-image-generate'
import { GROK_IMAGE_GENERATIONS_URL, estimateGrokImageCostUsd } from '../../api/lib/grok-models'
import { BENCHMARK_OFFERS } from '../fixtures/adpack/benchmark-offers'
import { goodSerumCopy } from './helpers'
import { PNG_1X1, PRODUCT_REF, runnerGateway } from './runner-fakes'

describe('buildScenePrompt', () => {
  it('always has the no-text clause and never the on-image copy (30 fixtures × 10 angles)', () => {
    for (const c of BENCHMARK_OFFERS) {
      for (const angle of planAngles({ dna: c.dna, offer: c.offer })) {
        const headline = `Oferta ${c.dna.brandName} hoy`
        const copy = goodSerumCopy({
          headline,
          cta: 'Escribinos ya',
          sceneBrief: `Product on a table, ${headline} mood, warm light.`,
        })
        const prompt = buildScenePrompt({ copy, angle, dna: c.dna, offer: c.offer })
        expect(prompt).toContain(SCENE_STRICT_NO_TEXT)
        expect(prompt.toLowerCase()).not.toContain(headline.toLowerCase())
        expect(prompt).not.toContain('Escribinos ya')
        expect(prompt).toMatch(/upper third/)
      }
    }
  })

  it('mentions the product lock and the style anchor only when present', () => {
    const c = BENCHMARK_OFFERS[0]
    const angle = planAngles({ dna: c.dna, offer: c.offer })[0]
    const copy = goodSerumCopy()
    const plain = buildScenePrompt({ copy, angle, dna: c.dna, offer: c.offer })
    expect(plain).not.toMatch(/style reference/)
    expect(plain).toMatch(/Product to show/)
    const locked = buildScenePrompt({ copy, angle, dna: c.dna, offer: { ...c.offer, productImageUrls: [PRODUCT_REF] }, anchor: { imageUrl: 'https://x.test/a.png' } })
    expect(locked).toMatch(/attached product photo/)
    expect(locked).toMatch(/style reference/)
  })

  it('generateScene requests 9:16, passes product refs + anchor and reads dimensions', async () => {
    const c = BENCHMARK_OFFERS[0]
    const angle = planAngles({ dna: c.dna, offer: c.offer })[0]
    const gw = runnerGateway()
    const res = await generateScene({
      gateway: gw,
      copy: goodSerumCopy(),
      angle,
      dna: c.dna,
      offer: { ...c.offer, productImageUrls: [PRODUCT_REF] },
      anchor: { imageUrl: 'https://x.test/anchor.png' },
    })
    expect(gw.sceneCalls[0]).toMatchObject({ ratio: '9:16', draft: true, refs: [PRODUCT_REF], styleRefs: ['https://x.test/anchor.png'] })
    expect(res).toMatchObject({ width: 1, height: 1, productLocked: true })
  })
})

describe('checkScene', () => {
  it('productMatches is null without a reference', async () => {
    const gw = runnerGateway({ vision: () => ({ productMatches: true, strayText: false, headlineSpace: true, score: 0.8 }) })
    const res = await checkScene({ gateway: gw, sceneImage: PRODUCT_REF, language: 'es' })
    expect(res.productMatches).toBeNull()
    expect(res.ok).toBe(true)
    expect(gw.visionCalls[0].images).toHaveLength(1)
  })

  it('flags stray text and mismatched product; clamps score', async () => {
    const gw = runnerGateway({ vision: () => ({ productMatches: 'no', strayText: true, headlineSpace: true, score: 8 }) })
    const res = await checkScene({ gateway: gw, sceneImage: PRODUCT_REF, productRef: PRODUCT_REF, language: 'en' })
    expect(res).toMatchObject({ ok: false, productMatches: false, strayText: true, score: 0.8 })
  })
})

describe('gateway helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('extractJson strips fences and finds the first object', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure! {"a":{"b":"}"}} trailing')).toEqual({ a: { b: '}' } })
    expect(extractJson('[1,2]')).toEqual([1, 2])
    expect(() => extractJson('nope')).toThrow(/not_json/)
  })

  it('createModelGateway requires keys', () => {
    expect(() => createModelGateway({ env: {} })).toThrow(/XAI_API_KEY.*GEMINI_API_KEY/)
    expect(() => createModelGateway({ env: { GROK_API_KEY: 'k', GEMINI_API_KEY: 'g' } })).not.toThrow()
  })

  it('json retries once with a JSON nudge and sums cost', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const replies = ['Here you go: not json', '```json\n{"ok":true}\n```']
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ output_text: replies[bodies.length - 1], usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 })
    }))
    const gw = createModelGateway({ env: { XAI_API_KEY: 'k', GEMINI_API_KEY: 'g' } })
    const res = await gw.json<{ ok: boolean }>({ system: 's', user: 'u' })
    expect(res.data).toEqual({ ok: true })
    expect(bodies).toHaveLength(2)
    expect(bodies[0].model).toBe('grok-4.5')
    expect(JSON.stringify(bodies[1].input)).toMatch(/Return ONLY the JSON/)
    expect(res.costUsd).toBeCloseTo(2 * (1000 * 2 + 100 * 6) / 1_000_000, 8)
  })

  it('scene: draft compose at 1k, decodes bytes; ledger records the call', async () => {
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG_1X1).toString('base64') }] }), { status: 200 })
    }))
    const gw = withCostLedger(createModelGateway({ env: { XAI_API_KEY: 'k', GEMINI_API_KEY: 'g' } }))
    const res = await gw.scene({ prompt: 'A bottle on stone.', refs: [], ratio: '9:16', draft: true })
    expect(bodies[0].url).toBe(GROK_IMAGE_GENERATIONS_URL)
    expect(bodies[0].body).toMatchObject({ resolution: '1k', quality: 'medium', aspect_ratio: '9:16' })
    expect(res.mimeType).toBe('image/png')
    expect(imageSize(res.bytes)).toEqual({ width: 1, height: 1 })
    expect(res.productLocked).toBe(false)
    expect(gw.ledger).toHaveLength(1)
    expect(gw.ledger[0]).toMatchObject({ kind: 'scene', ok: true, costUsd: 0.02 })
  })
})

describe('runGrokPostFirstGen resolution/quality options', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub() {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ data: [{ b64_json: 'aaa' }] }), { status: 200 })
    }))
    return bodies
  }

  it('defaults are unchanged (2k / medium, $0.04 list price)', async () => {
    const bodies = stub()
    const res = await runGrokPostFirstGen({ apiKey: 'k', prompt: 'A bottle.', aspectRatio: '1:1' })
    expect(bodies[0]).toMatchObject({ resolution: '2k', quality: 'medium' })
    expect(res).toMatchObject({ resolution: '2k', quality: 'medium', estimatedCostUsd: 0.04 })
    expect(estimateGrokImageCostUsd({ referenceCount: 1 })).toBe(0.05)
  })

  it('accepts draft 1k / low', async () => {
    const bodies = stub()
    const res = await runGrokPostFirstGen({ apiKey: 'k', prompt: 'A bottle.', aspectRatio: '1:1', resolution: '1k', quality: 'low' })
    expect(bodies[0]).toMatchObject({ resolution: '1k', quality: 'low' })
    expect(res).toMatchObject({ resolution: '1k', quality: 'low', estimatedCostUsd: 0.02 })
  })
})

describe('memory store', () => {
  it('leases atomically, skips excluded ids and clears leases on undefined', async () => {
    const store = createMemoryPackStore()
    const mk = (index: number) => ({
      id: `i${index}`,
      packId: 'p',
      index,
      status: 'planned' as const,
      angle: {} as never,
      renders: [],
      attempts: 0,
      generationId: `g${index}`,
      updatedAt: '',
    })
    await store.createPack({ id: 'p', userId: 'u' } as never, [mk(0), mk(1), mk(2)])
    const [a, b] = await Promise.all([store.leaseItems('p', 1, 1000), store.leaseItems('p', 1, 1000)])
    expect([a[0].id, b[0].id]).toEqual(['i0', 'i1'])
    expect(await store.leaseItems('p', 5, 1000, { excludeIds: ['i2'] })).toEqual([])
    await store.updateItem('i0', { leaseUntil: undefined })
    expect((await store.leaseItems('p', 5, 1000)).map((i) => i.id)).toEqual(['i0', 'i2'])
    expect(await store.getPack('p', 'someone-else')).toBeNull()
  })
})
