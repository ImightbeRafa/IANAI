/**
 * MCP 0.26.0 part B (docs/mcp-quality.md): reference gate, asset roles + owner approval, preflight.
 * Owner rule: low-quality photos are ACCEPTED with a warning (and upscaled for free); hard errors only for unreachable / not-an-image;
 * duplicates are silently deduped; the preflight blocks (< 70) only when an essential is missing. No paid call anywhere (fakes).
 */
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../api/lib/auth.js', () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true })),
  incrementUsage: vi.fn(async () => ({ creditsCharged: 6 })),
  deductBonusImage: vi.fn(async () => undefined),
  quoteLegacyActionCredits: vi.fn(() => 6),
}))
vi.mock('../api/lib/usage-logger.js', () => ({ logApiUsage: vi.fn(async () => undefined), estimateTokens: vi.fn(() => 1) }))

import { incrementUsage } from '../api/lib/auth.js'
import { cachedVisionVerdict, estimateJpegQuality, gateReferences, inspectReferenceBytes, REFERENCE_GATE_CONFIG, storedVerdictSummary, type GateDeps } from '../api/lib/mcp/reference-gate'
import { effectiveAssetRole, mcpSetAssetRole, selectReferences } from '../api/lib/mcp/asset-tools'
import { runPreflight } from '../api/lib/mcp/preflight'
import { upscaleLowResRefs } from '../api/lib/mcp/web-image'
import { mcpExecuteImageGenerate } from '../api/lib/mcp/execute-tools'
import { createMemoryMcpApprovalStore } from '../api/lib/mcp/approval'
import { getMcpTool, MCP_REGISTRY_VERSION } from '../api/lib/mcp/tool-registry'
import type { McpArtifactStore, McpOwnedImage } from '../api/lib/mcp/artifact-store'
import type { McpOfferStore } from '../api/lib/mcp/offer-tools'
import type { McpDbClient } from '../api/lib/mcp/user-tools'
import { productOnWhite } from './adpack/fidelity-fixtures'

vi.setConfig({ testTimeout: 60_000 })
const durl = (b: Buffer, m = 'image/jpeg') => `data:${m};base64,${b.toString('base64')}`

/** A textured photo (noise + shapes) so dHash / quality behave like a real picture. */
async function photo(w: number, h: number, seed = 1, opts: { quality?: number; fmt?: 'jpeg' | 'png' } = {}): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3)
  let s = seed * 2654435761
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    s = (s * 1664525 + 1013904223) >>> 0
    const i = (y * w + x) * 3
    const v = 120 + 60 * Math.sin((x * (seed + 2)) / 37 + y / (23 + seed)) + ((s >>> 24) % 20)
    raw[i] = v; raw[i + 1] = (v + 40 * seed) % 255; raw[i + 2] = 255 - v
  }
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } })
  return opts.fmt === 'png' ? img.png().toBuffer() : img.jpeg({ quality: opts.quality ?? 92 }).toBuffer()
}

describe('reference gate (each reason)', () => {
  it('one config object holds every threshold', () => {
    expect(REFERENCE_GATE_CONFIG).toMatchObject({ MIN_LONG_SIDE: 1600, VERY_LOW_LONG_SIDE: 1080, PREFLIGHT_MIN_SCORE: 70, DHASH_NEAR_DUP_BITS: 1 })
  })

  it('low resolution is ACCEPTED with a clear warning and the free upscale flag (< 1600; < 1080 = very low)', async () => {
    const low = await inspectReferenceBytes(await photo(1200, 900), 'u')
    expect(low.ok).toBe(true)
    expect(low.upscale).toBe(true)
    expect(low.issues.map((i) => i.code)).toEqual(['low_resolution'])
    expect(low.issues[0].es).toMatch(/Foto de baja calidad: los resultados pueden salir peores\. Subí una foto más grande y nítida/)
    expect(low.issues[0].en).toMatch(/Low-quality photo/)
    const very = await inspectReferenceBytes(await photo(600, 800), 'u')
    expect(very.ok).toBe(true)
    expect(very.issues[0].code).toBe('very_low_resolution')
    const full = await inspectReferenceBytes(await photo(1700, 1700), 'u')
    expect(full.issues).toEqual([])
    expect(full.upscale).toBe(false)
  })

  it('heavy compression (JPEG quantization) is a warning, not a reject', async () => {
    const bad = await photo(1700, 1700, 3, { quality: 20 })
    expect(estimateJpegQuality(bad)).toBeLessThan(40)
    expect(estimateJpegQuality(await photo(400, 400, 3, { quality: 92 }))).toBeGreaterThan(85)
    const v = await inspectReferenceBytes(bad, 'u')
    expect(v.ok).toBe(true)
    expect(v.issues.map((i) => i.code)).toContain('heavy_compression')
  })

  it('a phone screenshot (screen size + flat status bar) is a warning', async () => {
    const W = 1170, H = 2532
    const body = await photo(W, H - 140, 5)
    const shot = await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } }).composite([{ input: body, top: 140, left: 0 }]).png().toBuffer()
    const v = await inspectReferenceBytes(shot, 'u')
    expect(v.ok).toBe(true)
    expect(v.issues.map((i) => i.code)).toContain('screenshot')
    expect((await inspectReferenceBytes(await photo(1700, 1700, 5), 'u')).issues.map((i) => i.code)).not.toContain('screenshot')
  })

  it('burned-in text / AI render: ONE vision classification (fake), cached by content hash in quality.gate — never paid twice', async () => {
    const bytes = await photo(1700, 1700, 7)
    const classify = vi.fn(async () => ({ verdict: { burnedInText: true, aiRender: true }, costUsd: 0.0002, model: 'gemini-2.5-flash' }))
    const persisted: Array<Record<string, unknown>> = []
    const paid: unknown[] = []
    const deps: GateDeps = { classify, persist: async (_r, patch) => { persisted.push(patch) }, onPaidCall: (c) => paid.push(c) }
    const first = await gateReferences([{ id: 'a1', url: durl(bytes) }], deps)
    expect(first.accepted[0].issues.map((i) => i.code)).toEqual(expect.arrayContaining(['burned_in_text', 'ai_render']))
    expect(first.accepted[0].ok).toBe(true)
    expect(classify).toHaveBeenCalledTimes(1)
    expect(paid).toHaveLength(1)
    const quality = persisted[0] as { gate: { hash: string } }
    expect(quality.gate.hash).toBe(first.accepted[0].contentHash)
    expect(cachedVisionVerdict(quality, first.accepted[0].contentHash)).toMatchObject({ burnedInText: true })
    const second = await gateReferences([{ id: 'a1', url: durl(bytes), quality }], deps)
    expect(classify).toHaveBeenCalledTimes(1) // cached
    expect(second.accepted[0].issues.map((i) => i.code)).toContain('burned_in_text')
  })

  it('HARD errors only: unreachable (404) and not-an-image', async () => {
    const load: GateDeps['load'] = async (url) => (url.includes('404') ? { failure: { url, status: 404, reason: 'HTTP 404' } } : url.includes('html') ? { failure: { url, reason: 'not an image (content-type "text/html")' } } : { dataUrl: url })
    const r = await gateReferences([{ id: 'x', url: 'https://cdn.test/404.jpg' }, { id: 'y', url: 'https://cdn.test/page.html' }, { id: 'z', url: durl(Buffer.from('not an image at all'), 'image/png') }], { load })
    expect(r.accepted).toHaveLength(0)
    expect(r.rejected.map((v) => v.issues[0].code)).toEqual(['unreachable', 'not_an_image', 'not_an_image'])
    expect(r.rejected[0].issues[0].severity).toBe('error')
  })

  it('duplicates: identical bytes are dropped; a resized / re-encoded shot or another angle is KEPT; the hero is never dropped', async () => {
    const a = await photo(1700, 1700, 9)
    const reencoded = await sharp(a).resize(1650, 1650).jpeg({ quality: 80 }).toBuffer()
    const other = await photo(1700, 1700, 2)
    const r = await gateReferences([{ id: 'a', url: durl(a) }, { id: 'a-copy', url: durl(a) }, { id: 'b', url: durl(other) }])
    expect(r.accepted.map((v) => v.id)).toEqual(['a', 'b'])
    expect(r.deduped).toEqual([{ dropped: 'a-copy', keptAs: 'a', distance: 0 }])
    // strict threshold (≤ 1 bit): only near-identical pixels; a protected hero is never dropped even when identical
    const p = await gateReferences([{ id: 'x', url: durl(a) }, { id: 'hero', url: durl(a), protect: true }])
    expect(p.accepted.map((v) => v.id)).toEqual(['x', 'hero'])
    const keep = await gateReferences([{ id: 'a', url: durl(a) }, { id: 'other-angle', url: durl(other) }, { id: 'a2', url: durl(reencoded) }])
    expect(keep.accepted.map((v) => v.id)).toContain('other-angle')
  })

  it('low-resolution refs are upscaled for free before generation (deterministic, never redrawn)', async () => {
    const small = await productOnWhite() // 600×800 product photo
    const out = await upscaleLowResRefs([durl(small), durl(await photo(1700, 1700, 4))])
    expect(out.notes).toEqual([{ from: '600x800', to: '1200x1600' }])
    const meta = await sharp(Buffer.from(out.urls[0].split(',')[1], 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 1600])
    expect(out.urls[1].startsWith('data:image/jpeg')).toBe(true) // ≥ 1600: untouched
  })

  it('list_assets view uses stored data only (no download): size from quality, cached vision flags', () => {
    expect(storedVerdictSummary({ width: 900, height: 700 })).toMatchObject({ checked: true, upscale: true, issues: [{ code: 'very_low_resolution' }] })
    expect(storedVerdictSummary({ gate: { hash: 'h', width: 2000, height: 1800, vision: { burnedInText: true, aiRender: false } } })).toMatchObject({ checked: true, upscale: false, contentHash: 'h', issues: [{ code: 'burned_in_text' }] })
    expect(storedVerdictSummary(null)).toMatchObject({ checked: false })
  })

  it('a vision verdict never changes the ranking (deterministic between the quote and the approved call)', async () => {
    const list: McpOwnedImage[] = [
      { id: 'p1', imageUrl: durl(await photo(1700, 1700, 1)), offerId: 'o1', kind: 'product' },
      { id: 'p2', imageUrl: durl(await photo(1800, 1800, 2)), offerId: 'o1', kind: 'product' },
    ]
    const flagged: GateDeps = { classify: async () => ({ verdict: { burnedInText: true, aiRender: true }, costUsd: 0, model: 'fake' }) }
    const failing: GateDeps = { classify: async () => { throw new Error('vision down') } }
    const picks = await Promise.all([flagged, failing].map(async (deps) => {
      const g = await gateReferences(list.map((a) => ({ id: a.id, url: a.imageUrl })), deps)
      return selectReferences({ assets: list, verdicts: new Map(g.accepted.map((v) => [v.id!, v])) }).picked.map((x) => x.id)
    }))
    expect(picks[0]).toEqual(picks[1])
  })
})

async function assets(): Promise<McpOwnedImage[]> {
  return [
    { id: 'hero', imageUrl: durl(await photo(1700, 1700, 1)), offerId: 'o1', kind: 'product', isPrimary: true },
    { id: 'pack', imageUrl: durl(await photo(1700, 1700, 2)), offerId: 'o1', kind: 'product', tags: ['caja'] },
    { id: 'life', imageUrl: durl(await photo(1700, 1700, 3)), offerId: 'o1', kind: 'context' },
  ]
}
const CTX = { offers: [{ id: 'o1', name: 'Sleeping Patches', productDescription: 'Parches para dormir' }], brandKit: { id: 'k', name: 'K', logoUrl: 'https://x/logo.png', primaryColor: '#000', fontPrimary: 'Inter' } } as never

describe('asset roles + varied selection (no approval step)', () => {
  it('roles: explicit asset_role wins; else box → packaging, context → lifestyle, product → product', () => {
    expect(effectiveAssetRole({ assetRole: 'unboxing', kind: 'product' })).toBe('unboxing')
    expect(effectiveAssetRole({ kind: 'product', tags: ['caja'] })).toBe('packaging')
    expect(effectiveAssetRole({ kind: 'context' })).toBe('lifestyle')
    expect(effectiveAssetRole({ kind: 'product', label: 'frente' })).toBe('product')
    expect(effectiveAssetRole({ kind: 'product', assetRole: null })).toBe('product') // missing 086 column = inferred
  })

  it('automatic pick = hero product + packaging + lifestyle, from all the brand photos', async () => {
    const pre = await runPreflight({ ctx: CTX, offerId: 'o1', assets: await assets(), copy: 'Dormí mejor\nEscribinos por WhatsApp' })
    expect(pre.selection.productIds).toEqual(['hero', 'pack'])
    expect(pre.selection.supportIds).toEqual(['life'])
    expect(pre.blocked).toBe(false)
    expect(pre.score).toBe(100) // no price anywhere: never penalised
  })

  it('prefers the best-quality photo as hero when there is no primary; a pack offer with only a box photo is not blocked', async () => {
    const list = (await assets()).map((a) => ({ ...a, isPrimary: false, tags: [] as string[] }))
    list[0] = { ...list[0], imageUrl: durl(await photo(800, 800, 1)) } // two product photos: the 1700 px one wins
    const verdicts = new Map((await gateReferences(list.map((a) => ({ id: a.id, url: a.imageUrl })))).accepted.map((v) => [v.id!, v]))
    expect(selectReferences({ assets: list, verdicts }).product[0].id).toBe('pack')
    const boxOnly: McpOwnedImage[] = [{ id: 'box', imageUrl: durl(await photo(1700, 1700, 5)), offerId: 'o1', kind: 'product', tags: ['caja'] }]
    const pre = await runPreflight({ ctx: CTX, offerId: 'o1', assets: boxOnly, copy: 'Hola' })
    expect(pre.selection.productIds).toEqual(['box'])
    expect(pre.blocked).toBe(false)
  })
})

describe('preflight scoring and blocking', () => {
  it('low photo quality alone never blocks: warnings + a lower score, still ≥ 70', async () => {
    const list = [{ id: 'tiny', imageUrl: durl(await photo(500, 500, 1, { quality: 15 })), offerId: 'o1', kind: 'product' as const }]
    const pre = await runPreflight({ ctx: { offers: CTX.offers, brandKit: null } as never, offerId: 'o1', assets: list, copy: 'Hola' })
    expect(pre.blocked).toBe(false)
    expect(pre.score).toBeGreaterThanOrEqual(70)
    expect(pre.score).toBeLessThan(100)
    expect(pre.warnings.join(' ')).toMatch(/Foto de baja calidad/)
    expect(pre.items.find((i) => i.key === 'reference_quality')?.ok).toBe(false)
  })

  it('essentials = product photo, offer name, brief / copy — a missing price is never an item, never a block', async () => {
    const pre = await runPreflight({ ctx: { offers: [{ id: 'o1', name: 'X' }], brandKit: null } as never, offerId: 'o1', assets: await assets(), copy: 'Hola' })
    expect(pre.items.map((i) => i.key)).not.toContain('price')
    expect(pre.items.filter((i) => i.essential).map((i) => i.key)).toEqual(['product_photo', 'offer_name', 'brief'])
    expect(pre.blocked).toBe(false)
    const none = await runPreflight({ ctx: { offers: [{ id: 'o1', name: '' }], brandKit: null } as never, offerId: 'o1', assets: [] })
    expect(none.blocked).toBe(true)
    expect(none.score).toBeLessThan(70)
    expect(none.missingEssentials).toEqual(['product_photo', 'offer_name', 'brief'])
    expect(none.message).toMatch(/import_image/)
    expect(none.message).toMatch(/1600 px/)
    expect(none.message).not.toMatch(/approve_asset|price/)
  })

  it('execute_image_generate refuses BEFORE any quote / approval / charge when no usable product photo exists', async () => {
    const db: McpDbClient = {
      async listBusinessesForUser() { return [{ id: 'b1', name: 'B' }] },
      async getBusinessForUser() { return { id: 'b1', name: 'B', userId: 'u1' } },
      async listOffersForBrand() { return [{ id: 'o1', name: 'Sleeping Patches' }] },
      async getBrandKitForBrand() { return null },
    }
    const dead: McpOwnedImage[] = [{ id: 'hero', imageUrl: durl(Buffer.from('not an image'), 'image/png'), offerId: 'o1', kind: 'product' }]
    const artifactStore = { async listOwnedAssets() { return dead }, async getOwnedProductImage(o: { imageId: string }) { return dead.find((a) => a.id === o.imageId) ?? null } } as unknown as McpArtifactStore
    vi.mocked(incrementUsage).mockClear()
    await expect(mcpExecuteImageGenerate({ db, approvalStore: createMemoryMcpApprovalStore(), artifactStore, user: { id: 'u1' }, args: { brandId: 'b1', offerId: 'o1', copy: 'Hola', productImageId: 'hero' } })).rejects.toThrow(/import_image/)
    expect(vi.mocked(incrementUsage)).not.toHaveBeenCalled()
  })
})

describe('set_asset_role (free) — no approval tools', () => {
  function store(over: Partial<McpOfferStore> = {}) {
    const patches: Array<Record<string, unknown>> = []
    const s = {
      async getProductImage() { return { id: 'i1', product_id: 'o1', kind: 'product' } },
      async getOfferById({ userId }: { userId: string }) { return userId === 'owner' ? { id: 'o1', business_id: 'b1' } : null },
      async updateProductImage({ patch }: { patch: Record<string, unknown> }) { patches.push(patch); return { id: 'i1', product_id: 'o1', ...patch } },
      ...over,
    } as unknown as McpOfferStore
    return { s, patches }
  }
  it('validates the six roles; missing 086 column → MIGRATION_PENDING (generation unaffected); other users refused', async () => {
    const { s, patches } = store()
    await expect(mcpSetAssetRole({ store: s, user: { id: 'owner' }, args: { productImageId: 'i1', assetRole: 'hero' } })).rejects.toThrow(/product, b-roll/)
    const ok = await mcpSetAssetRole({ store: s, user: { id: 'owner' }, args: { productImageId: 'i1', assetRole: 'lifestyle' } })
    expect((ok.asset as { assetRole: string }).assetRole).toBe('lifestyle')
    expect(patches[0]).toEqual({ asset_role: 'lifestyle' })
    await expect(mcpSetAssetRole({ store: s, user: { id: 'intruder' }, args: { productImageId: 'i1', assetRole: 'product' } })).rejects.toThrow(/not found/)
    const pending = store({ async updateProductImage() { throw Object.assign(new Error('column "asset_role" does not exist'), { code: '42703' }) } }).s
    await expect(mcpSetAssetRole({ store: pending, user: { id: 'owner' }, args: { productImageId: 'i1', assetRole: 'product' } })).rejects.toMatchObject({ code: 'MIGRATION_PENDING' })
  })
  it('registered at 0.26.0: approve_asset / unapprove_asset are gone; preflight tells the bot to call it first', () => {
    expect(MCP_REGISTRY_VERSION).toBe('0.26.0')
    expect(getMcpTool('approve_asset')).toBeUndefined()
    expect(getMcpTool('unapprove_asset')).toBeUndefined()
    for (const name of ['set_asset_role', 'adpack_preflight']) expect(getMcpTool(name)).toMatchObject({ requiresApproval: false, consumesAdvanceCredits: false, enabled: true })
    expect(getMcpTool('adpack_preflight')?.description).toMatch(/CALL THIS FIRST/)
    expect(getMcpTool('adpack_preflight')?.description).toMatch(/NOT required/)
    expect(getMcpTool('execute_image_generate')?.description).toMatch(/charged ONLY if it actually runs/)
  })
})

describe('price only when the copy carries one', () => {
  it('copyHasPrice', async () => {
    const { copyHasPrice } = await import('../api/lib/mcp/web-image')
    expect(copyHasPrice('Dormí mejor\n₡9.900\nEscribinos')).toBe(true)
    expect(copyHasPrice('Dormí mejor\nEscribinos por WhatsApp')).toBe(false)
  })
})
