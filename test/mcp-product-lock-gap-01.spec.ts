import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureProductLockPrompt,
  partitionGrokFirstGenRefs,
  runGrokPostFirstGen,
} from '../api/lib/grok-image-generate'
import {
  GROK_IMAGE_EDITS_URL,
  GROK_IMAGE_GENERATIONS_URL,
} from '../api/lib/grok-models'
import { hasProductPixelLockLanguage } from '../api/lib/product-pixel-lock'
import { normalizeImageReferenceRole } from '../api/lib/image-prompt-context'
import { partitionOwnedImageRefs } from '../api/lib/mcp/execute-tools'
import type { McpOwnedImage } from '../api/lib/mcp/artifact-store'

/** 1×1 PNG — data URLs skip the SSRF fetch so only the xAI request is mocked. */
const PRODUCT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const SUPPORT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxgAAAQ6wH+8wW3OQAAAABJRU5ErkJggg=='
const GENERATED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAD0lEQVR42mNgYGD4z0AEYBxgAAD4AQH+2n8HAAAAAElFTkSuQmCC'

const TINY_B64 = 'aaa'

type CapturedGrokRequest = {
  url: string
  body: {
    prompt?: string
    aspect_ratio?: string
    resolution?: string
    quality?: string
    image?: { url?: string; type?: string }
    images?: Array<{ url?: string; type?: string }>
  }
}

function stubGrokFetch(): { captured: CapturedGrokRequest[]; fetchMock: ReturnType<typeof vi.fn> } {
  const captured: CapturedGrokRequest[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body || '{}')) as CapturedGrokRequest['body']
    captured.push({ url, body })
    return new Response(JSON.stringify({ data: [{ b64_json: TINY_B64 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { captured, fetchMock }
}

describe('partitionGrokFirstGenRefs', () => {
  it('uses explicit product/support split when productReferenceUrls is passed', () => {
    expect(partitionGrokFirstGenRefs({
      productReferenceUrls: ['https://cdn.example/sku.jpg'],
      supportReferenceUrls: ['https://cdn.example/logo.png'],
      referenceImageUrls: ['https://cdn.example/legacy.jpg'],
    })).toEqual({
      productUrls: ['https://cdn.example/sku.jpg'],
      supportUrls: ['https://cdn.example/logo.png'],
    })
  })

  it('treats legacy referenceImageUrls as product refs when the split is omitted', () => {
    expect(partitionGrokFirstGenRefs({
      referenceImageUrls: ['https://cdn.example/sku.jpg'],
    })).toEqual({
      productUrls: ['https://cdn.example/sku.jpg'],
      supportUrls: [],
    })
  })

  it('keeps empty product list as compose (support-only / no product ref)', () => {
    expect(partitionGrokFirstGenRefs({
      productReferenceUrls: [],
      supportReferenceUrls: ['https://cdn.example/scene.jpg'],
    })).toEqual({
      productUrls: [],
      supportUrls: ['https://cdn.example/scene.jpg'],
    })
  })
})

describe('MCP / bulk Grok first-gen lock (GAP-01 D6 / D7 / E3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('D6: product ref → POST /images/edits + PRODUCT LOCK; product is the first image', async () => {
    const { captured } = stubGrokFetch()
    const result = await runGrokPostFirstGen({
      apiKey: 'test-key',
      prompt: 'Photoreal lifestyle ad still for PatchHouse featuring Focus patches.',
      aspectRatio: '9:16',
      productReferenceUrls: [PRODUCT_PNG],
      language: 'es',
    })

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe(GROK_IMAGE_EDITS_URL)
    expect(hasProductPixelLockLanguage(captured[0].body.prompt || '')).toBe(true)
    expect(captured[0].body.prompt).toMatch(/PRODUCT LOCK/)
    expect(captured[0].body.prompt).toMatch(/PROHIBIDO redibujar/)
    expect(captured[0].body.image?.url).toBe(PRODUCT_PNG)
    expect(captured[0].body.images).toBeUndefined()
    expect(captured[0].body.aspect_ratio).toBe('9:16')
    expect(captured[0].body.resolution).toBe('2k')
    expect(captured[0].body.quality).toBe('medium')
    expect(result.mode).toBe('product_lock_scene')
    expect(result.endpoint).toBe(GROK_IMAGE_EDITS_URL)
    expect(result.lockApplied).toBe(true)
  })

  it('D6 mixed: product stays the edits base when a support/logo ref is also attached', async () => {
    const { captured } = stubGrokFetch()
    await runGrokPostFirstGen({
      apiKey: 'test-key',
      prompt: 'Photoreal lifestyle ad still for PatchHouse featuring Focus patches.',
      aspectRatio: '9:16',
      productReferenceUrls: [PRODUCT_PNG],
      supportReferenceUrls: [SUPPORT_PNG],
      language: 'es',
    })
    expect(captured[0].url).toBe(GROK_IMAGE_EDITS_URL)
    expect(captured[0].body.image).toBeUndefined()
    expect(captured[0].body.images).toEqual([
      { url: PRODUCT_PNG, type: 'image_url' },
      { url: SUPPORT_PNG, type: 'image_url' },
    ])
    expect(hasProductPixelLockLanguage(captured[0].body.prompt || '')).toBe(true)
  })

  it('D7: no product ref → POST /images/generations compose, no PRODUCT LOCK', async () => {
    const { captured } = stubGrokFetch()
    const result = await runGrokPostFirstGen({
      apiKey: 'test-key',
      prompt: 'Photoreal lifestyle ad still for PatchHouse. Typographic editorial, no fake SKU.',
      aspectRatio: '9:16',
      productReferenceUrls: [],
      language: 'es',
    })

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe(GROK_IMAGE_GENERATIONS_URL)
    expect(hasProductPixelLockLanguage(captured[0].body.prompt || '')).toBe(false)
    expect(captured[0].body.image).toBeUndefined()
    expect(captured[0].body.images).toBeUndefined()
    expect(result.mode).toBe('compose')
    expect(result.endpoint).toBe(GROK_IMAGE_GENERATIONS_URL)
    expect(result.lockApplied).toBe(false)
  })

  it('D7: context/support refs only stay on /generations (logo never the edit base)', async () => {
    const { captured } = stubGrokFetch()
    const result = await runGrokPostFirstGen({
      apiKey: 'test-key',
      prompt: 'Editorial scene with brand palette. Do not invent a pouch.',
      aspectRatio: '9:16',
      productReferenceUrls: [],
      supportReferenceUrls: [SUPPORT_PNG],
    })

    expect(captured[0].url).toBe(GROK_IMAGE_GENERATIONS_URL)
    expect(hasProductPixelLockLanguage(captured[0].body.prompt || '')).toBe(false)
    expect(captured[0].body.image?.url).toBe(SUPPORT_PNG)
    expect(result.mode).toBe('compose')
    expect(result.lockApplied).toBe(false)
  })

  it('E3: bulk product refs use the same edits + lock request shape', async () => {
    const { captured } = stubGrokFetch()
    await runGrokPostFirstGen({
      apiKey: 'test-key',
      prompt: 'Photoreal lifestyle ad still for PatchHouse. Buyer niche: nightlife.',
      aspectRatio: '9:16',
      productReferenceUrls: [PRODUCT_PNG],
      language: 'es',
    })
    expect(captured[0].url).toBe(GROK_IMAGE_EDITS_URL)
    expect(hasProductPixelLockLanguage(captured[0].body.prompt || '')).toBe(true)
    expect(captured[0].body.image?.url).toBe(PRODUCT_PNG)
  })

  it('injects lock when the caller prompt omitted it', () => {
    const injected = ensureProductLockPrompt('thin lifestyle prompt', {
      language: 'es',
      hasProductRefs: true,
    })
    expect(hasProductPixelLockLanguage(injected)).toBe(true)
    expect(ensureProductLockPrompt('thin lifestyle prompt', { hasProductRefs: false }))
      .toBe('thin lifestyle prompt')
  })
})

describe('MCP owned-ref role split (product vs context)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('kind=product and explicit productImageId are product; context/scene are support', () => {
    expect(normalizeImageReferenceRole({ kind: 'product', label: 'Focus packshot' })).toBe('product')
    expect(normalizeImageReferenceRole({ kind: 'context', label: 'baño escena' })).toBe('scene')
    expect(normalizeImageReferenceRole({ kind: 'context', label: 'style layout' })).toBe('style')
  })

  it('SD-01: productImageId SKU is first edits base even when a generated ref is listed first', async () => {
    const generated: McpOwnedImage = {
      id: 'img-generated',
      imageUrl: GENERATED_PNG,
      offerId: 'offer-1',
      kind: 'generated',
      label: 'prior ad',
    }
    const sku: McpOwnedImage = {
      id: 'img-sku',
      imageUrl: PRODUCT_PNG,
      offerId: 'offer-1',
      kind: 'product',
      label: 'Focus packshot',
    }
    const split = partitionOwnedImageRefs({
      images: [generated, sku],
      productImageId: 'img-sku',
    })
    expect(split.productUrls[0]).toBe(PRODUCT_PNG)
    expect(split.productUrls).toEqual([PRODUCT_PNG, GENERATED_PNG])

    const { captured } = stubGrokFetch()
    const result = await runGrokPostFirstGen({
      apiKey: 'test-key',
      prompt: 'Photoreal lifestyle ad still for PatchHouse featuring Focus patches.',
      aspectRatio: '9:16',
      productReferenceUrls: split.productUrls,
      supportReferenceUrls: split.supportUrls,
      language: 'es',
    })
    expect(captured[0].url).toBe(GROK_IMAGE_EDITS_URL)
    expect(captured[0].body.images?.[0]?.url).toBe(PRODUCT_PNG)
    expect(captured[0].body.images?.[1]?.url).toBe(GENERATED_PNG)
    expect(hasProductPixelLockLanguage(captured[0].body.prompt || '')).toBe(true)
    expect(result.lockApplied).toBe(true)
    expect(result.mode).toBe('product_lock_scene')
  })
})
