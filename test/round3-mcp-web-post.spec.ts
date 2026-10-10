import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/lib/url-safety', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/lib/url-safety')>()
  return {
    ...orig,
    fetchPublicUrl: vi.fn(async (url: string) => {
      if (url.includes('dead.test')) return new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } })
      if (url.includes('html.test')) return new Response('<html>hi</html>', { status: 200, headers: { 'content-type': 'text/html' } })
      return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), { status: 200, headers: { 'content-type': 'image/png' } })
    }),
  }
})

import { buildWebPostSourcePrompt, runWebPostGrokImage } from '../api/lib/web-post-image'
import { fetchPublicImageDetailed } from '../api/lib/fetch-image-data-url'
import { rehostReferenceImages } from '../api/lib/mcp/rehost-references'
import { offerLockFromRow, pickAccessoryPhotos } from '../api/lib/mcp/web-image'
import { safeZoneMargins } from '../api/lib/mcp/safe-zones'
import { findSeparatorLines, tidyCopySeparators } from '../api/lib/mcp/image-postcheck'
import { handleMcpJsonRpc } from '../api/lib/mcp/protocol'

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const ref = (n: number) => `${PX}#p${n}`
let calls: Array<{ url: string; body: Record<string, any> }> = []
beforeEach(() => {
  process.env.GROK_API_KEY = 'test-key'
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const base = {
  apiKey: 'k', aspectRatio: '3:4', language: 'es' as const, copy: 'Armá el tuyo', palette: ['#0b3d91'], brandVoice: 'cercano',
  brandName: 'Prototipo', offerId: 'o1', productRow: { name: 'Avión', technical_specs: 'planeador blanco', product_category: 'juguete' },
}

describe('round 3 — web request stays byte-identical, MCP rules are opt-in', () => {
  const args = {
    language: 'es' as const, postStyle: 'venta-directa' as const, textDensity: 'hard' as const, userCopy: 'Hola', palette: '#0b3d91', brandVoice: 'cercano',
    brandVisual: 'sólido', businessContext: 'ctx\nEscena: gimnasio', hasProductRefs: true, hasSceneRef: false, productSilhouette: null, lockedOfferPrice: null,
    hasBrandLogo: false, ctaStrength: 'sales' as const, productRow: { name: 'Avión' },
  }
  it('without mcp rules the prompt has none of the round-3 additions', () => {
    const p = buildWebPostSourcePrompt(args)
    for (const marker of ['ESCENA OBLIGATORIA', 'ZONAS SEGURAS', 'PROHIBIDO añadir objetos', 'NO alteres forma']) expect(p).not.toContain(marker)
  })
  it('with mcp rules and a scene, the scene is a binding block outside the factual context', () => {
    const p = buildWebPostSourcePrompt({ ...args, mcp: { strict: true, scene: 'Gimnasio oscuro con banco de madera', ratio: '4:5', accessoryLabels: [], forbidExtraProps: true, allowedProps: [] } })
    expect(p).toContain('ESCENA OBLIGATORIA DEL PEDIDO')
    expect(p).toContain('Gimnasio oscuro con banco de madera')
    expect(p.indexOf('ESCENA OBLIGATORIA')).toBeLessThan(p.indexOf('Contexto factual'))
  })
  it('safe-zone margins: 9:16 reserves more than 4:5; both reserve the bottom for the IG caption', () => {
    const a = safeZoneMargins('4:5'); const b = safeZoneMargins('9:16')
    expect(a.bottom).toBeGreaterThanOrEqual(0.08)
    expect(b.top).toBeGreaterThan(a.top)
    expect(b.bottom).toBeGreaterThan(a.bottom)
  })
})

describe('round 3 — props policy and accessory references', () => {
  it('offerLockFromRow forbids any prop that is not in the lock/reference list', () => {
    const lock = offerLockFromRow({ ad_profile: { lockProductAppearance: true, immutableAttributes: ['hélices rojas'], allowedProps: ['pilas AA'] } } as never)
    expect(lock.forbidExtraProps).toBe(true)
    expect(lock.allowedProps).toEqual(['pilas AA'])
  })

  it('product photo stays first; real box/controller photos are attached next; logo keeps its style slot; total ≤ 3', async () => {
    const out = await runWebPostGrokImage({
      ...base, productUrls: [ref(1)], accessoryUrls: [ref(2), ref(3)], logoUrl: ref(4),
      mcp: { strict: true, scene: null, ratio: '4:5', accessoryLabels: ['caja', 'control'], forbidExtraProps: true, allowedProps: [] },
    })
    expect(out.referencesUsed).toEqual(['product', 'accessory', 'logo'])
    expect(calls[0].body.images).toHaveLength(3)
    expect(String(calls[0].body.prompt)).toMatch(/caja/)
  })

  it('without accessory photos the prompt says the box/controller must NOT be drawn', async () => {
    await runWebPostGrokImage({ ...base, productUrls: [ref(1)], logoUrl: null, mcp: { strict: true, scene: null, ratio: '4:5', accessoryLabels: [], forbidExtraProps: true, allowedProps: [] } })
    expect(String(calls[0].body.prompt)).toMatch(/PROHIBIDO añadir objetos que no estén en las fotos de referencia/)
  })

  it('web (no mcp) with the same inputs sends no accessory and no strict block', async () => {
    await runWebPostGrokImage({ ...base, productUrls: [ref(1)], logoUrl: null })
    const p = String(calls[0].body.prompt)
    expect(p).not.toMatch(/PROHIBIDO añadir objetos|ZONAS SEGURAS|ESCENA OBLIGATORIA/)
  })

  it('pickAccessoryPhotos selects box/controller roles, never the hero or generated images', () => {
    const picked = pickAccessoryPhotos([
      { id: 'hero', imageUrl: 'h', isPrimary: true, label: 'Avión' },
      { id: 'box', imageUrl: 'b', label: 'caja de empaque', tags: ['box'] },
      { id: 'gen', imageUrl: 'g', kind: 'generated', label: 'caja' },
      { id: 'rnd', imageUrl: 'r', label: 'otra' },
    ], { excludeIds: [] })
    expect(picked.map((p) => p.id)).toEqual(['box'])
  })
})

describe('round 3 — dead asset URLs', () => {
  it('error names the failing URL and the HTTP status', async () => {
    await expect(runWebPostGrokImage({ ...base, productUrls: ['https://dead.test/pouch.webp'] })).rejects.toThrow(/https:\/\/dead\.test\/pouch\.webp → HTTP 404/)
    expect(calls).toHaveLength(0) // never calls xAI (no charge) when the product truth cannot be loaded
  })
  it('an HTML page is reported as not an image', async () => {
    const r = await fetchPublicImageDetailed('https://html.test/x')
    expect(r).toMatchObject({ failure: { reason: expect.stringContaining('not an image') } })
  })
  it('a dead KIT/accessory photo is skipped and reported, not fatal', async () => {
    const out = await runWebPostGrokImage({ ...base, productUrls: [ref(1)], kitReferenceUrls: ['https://dead.test/k.webp'], logoUrl: null })
    expect(out.referenceWarnings[0]).toMatchObject({ url: 'https://dead.test/k.webp', status: 404 })
  })
  it('rehostReferenceImages copies photos into Advance storage and keeps the original on failure', async () => {
    const rehost = vi.fn(async ({ url }: { url: string }) => {
      if (url.includes('dead')) throw new Error('HTTP 404')
      return { url: `https://store.test/post-images/u1/uploads/${encodeURIComponent(url)}`, rehosted: true, sourceUrl: url }
    })
    const r = await rehostReferenceImages(['https://ok.test/a.webp', 'https://dead.test/b.webp'], 'u1', rehost as never)
    expect(r.urls[0]).toContain('post-images/u1/uploads')
    expect(r.urls[1]).toBe('https://dead.test/b.webp')
    expect(r.warnings[0]).toContain('dead.test/b.webp')
  })
})

describe('round 3 — text QA and tool schema', () => {
  it('flags orphan separators and normalises them', () => {
    const copy = 'Un regalo\nPapel y 3 pilas AA no incluidos ·\n· Desde 8 años\nTexto · con medio'
    const lines = findSeparatorLines(copy)
    expect(lines).toHaveLength(2)
    expect(tidyCopySeparators(copy).copy).toBe('Un regalo\nPapel y 3 pilas AA no incluidos\nDesde 8 años\nTexto · con medio')
  })
  it('publishes exact enums for postStyle / ctaStrength / textDensity and copy as a plain string', async () => {
    const listed = await handleMcpJsonRpc({ body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, user: { id: 'u1' }, db: {} as never })
    const tool = (listed.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, any> } }> }).tools.find((t) => t.name === 'execute_image_generate')!
    const p = tool.inputSchema.properties
    expect(p.postStyle.enum).toEqual(['venta-directa', 'anuncio-conversion'])
    expect(p.ctaStrength.enum).toEqual(['none', 'soft', 'brand_mention', 'sales'])
    expect(p.textDensity.enum).toBeTruthy()
    expect(p.copy.type).toBe('string')
    expect(p.autoRetry.type).toBe('boolean')
    expect(p.scene.description).toMatch(/binding|obligatori/i)
  })
})
