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
import { cachedVisionVerdict, dHash, estimateJpegQuality, gateReferences, hammingHex, inspectReferenceBytes, REFERENCE_GATE_CONFIG, type GateDeps } from '../api/lib/mcp/reference-gate'
import { effectiveAssetRole, isApproved, mcpSetAssetApproved, mcpSetAssetRole, selectApprovedReferences } from '../api/lib/mcp/asset-tools'
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
    expect(REFERENCE_GATE_CONFIG).toMatchObject({ MIN_LONG_SIDE: 1600, VERY_LOW_LONG_SIDE: 1080, PREFLIGHT_MIN_SCORE: 70 })
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

  it('duplicates (same hash or dHash near-duplicate) are silently dropped', async () => {
    const a = await photo(1700, 1700, 9)
    const nearDup = await sharp(a).resize(1650, 1650).jpeg({ quality: 80 }).toBuffer()
    const other = await photo(1700, 1700, 2)
    expect(hammingHex(await dHash(a), await dHash(nearDup))).toBeLessThanOrEqual(REFERENCE_GATE_CONFIG.DHASH_NEAR_DUP_BITS)
    const r = await gateReferences([{ id: 'a', url: durl(a) }, { id: 'a-copy', url: durl(a) }, { id: 'a-near', url: durl(nearDup) }, { id: 'b', url: durl(other) }])
    expect(r.accepted.map((v) => v.id)).toEqual(['a', 'b'])
    expect(r.deduped.map((d) => d.dropped)).toEqual(['a-copy', 'a-near'])
    expect(r.rejected).toHaveLength(0)
  })

  it('low-resolution refs are upscaled for free before generation (deterministic, never redrawn)', async () => {
    const small = await productOnWhite() // 600×800 product photo
    const out = await upscaleLowResRefs([durl(small), durl(await photo(1700, 1700, 4))])
    expect(out.notes).toEqual([{ from: '600x800', to: '1200x1600' }])
    const meta = await sharp(Buffer.from(out.urls[0].split(',')[1], 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 1600])
    expect(out.urls[1].startsWith('data:image/jpeg')).toBe(true) // ≥ 1600: untouched
  })
})

async function assets(): Promise<McpOwnedImage[]> {
  return [
    { id: 'hero', imageUrl: durl(await photo(1700, 1700, 1)), offerId: 'o1', kind: 'product', isPrimary: true, approved: true },
    { id: 'pack', imageUrl: durl(await photo(1700, 1700, 2)), offerId: 'o1', kind: 'product', tags: ['caja'], approved: true },
    { id: 'life', imageUrl: durl(await photo(1700, 1700, 3)), offerId: 'o1', kind: 'context', approved: true },
    { id: 'raw', imageUrl: durl(await photo(1700, 1700, 4)), offerId: 'o1', kind: 'product', approved: false },
  ]
}
const CTX = { offers: [{ id: 'o1', name: 'Sleeping Patches', price: '₡9.900', productDescription: 'Parches para dormir' }], brandKit: { id: 'k', name: 'K', logoUrl: 'https://x/logo.png', primaryColor: '#000', fontPrimary: 'Inter' } } as never

describe('asset roles + approved-only, varied selection', () => {
  it('roles: explicit asset_role wins; else box → packaging, context → lifestyle, product → product', () => {
    expect(effectiveAssetRole({ assetRole: 'unboxing', kind: 'product' })).toBe('unboxing')
    expect(effectiveAssetRole({ kind: 'product', tags: ['caja'] })).toBe('packaging')
    expect(effectiveAssetRole({ kind: 'context' })).toBe('lifestyle')
    expect(effectiveAssetRole({ kind: 'product', label: 'frente' })).toBe('product')
    expect(isApproved({ approved: false })).toBe(false)
    expect(isApproved({})).toBe(true) // a store without approval support (fakes)
  })

  it('automatic pick = hero product + packaging + lifestyle; never an unapproved asset', async () => {
    const list = await assets()
    const pre = await runPreflight({ ctx: CTX, offerId: 'o1', assets: list, copy: 'Dormí mejor\n₡9.900\nEscribinos por WhatsApp' })
    expect(pre.selection.productIds).toEqual(['hero', 'pack'])
    expect(pre.selection.supportIds).toEqual(['life'])
    expect([...pre.selection.productIds, ...pre.selection.supportIds]).not.toContain('raw')
    expect(pre.blocked).toBe(false)
    expect(pre.score).toBe(100)
  })

  it('prefers the best-quality approved photo as hero when there is no primary', async () => {
    const list = (await assets()).map((a) => ({ ...a, isPrimary: false, tags: [] as string[] }))
    list[0] = { ...list[0], imageUrl: durl(await photo(800, 800, 1)) } // two product photos: the 1700 px one wins
    const verdicts = new Map((await gateReferences(list.map((a) => ({ id: a.id, url: a.imageUrl })))).accepted.map((v) => [v.id!, v]))
    const sel = selectApprovedReferences({ assets: list, verdicts })
    expect(sel.product[0].id).toBe('pack')
  })
})

describe('preflight scoring and blocking', () => {
  it('low photo quality alone never blocks: warnings + a lower score, still ≥ 70', async () => {
    const list = [{ id: 'tiny', imageUrl: durl(await photo(500, 500, 1, { quality: 15 })), offerId: 'o1', kind: 'product' as const, approved: true }]
    const pre = await runPreflight({ ctx: { offers: CTX.offers, brandKit: null } as never, offerId: 'o1', assets: list, copy: 'Hola' })
    expect(pre.blocked).toBe(false)
    expect(pre.score).toBeGreaterThanOrEqual(70)
    expect(pre.score).toBeLessThan(100)
    expect(pre.warnings.join(' ')).toMatch(/Foto de baja calidad/)
    expect(pre.items.find((i) => i.key === 'reference_quality')?.ok).toBe(false)
  })

  it('missing essentials block (< 70) with an actionable message: no approved photo, no price', async () => {
    const list = (await assets()).map((a) => ({ ...a, approved: false }))
    const pre = await runPreflight({ ctx: { offers: [{ id: 'o1', name: 'X', productDescription: 'y' }], brandKit: null } as never, offerId: 'o1', assets: list })
    expect(pre.blocked).toBe(true)
    expect(pre.score).toBeLessThan(70)
    expect(pre.missingEssentials).toEqual(['product_photo', 'price'])
    expect(pre.message).toMatch(/approve_asset hero/)
    expect(pre.message).toMatch(/update_offer \{price/)
    const none = await runPreflight({ ctx: CTX, offerId: 'o1', assets: [] })
    expect(none.blocked).toBe(true)
    expect(none.message).toMatch(/import_image/)
    expect(none.message).toMatch(/1600 px/)
  })

  it('execute_image_generate refuses BEFORE any quote / approval / charge when no approved asset exists', async () => {
    const list = (await assets()).map((a) => ({ ...a, approved: false }))
    const db: McpDbClient = {
      async listBusinessesForUser() { return [{ id: 'b1', name: 'B' }] },
      async getBusinessForUser() { return { id: 'b1', name: 'B', userId: 'u1' } },
      async listOffersForBrand() { return [{ id: 'o1', name: 'Sleeping Patches', price: '₡9.900' }] },
      async getBrandKitForBrand() { return null },
    }
    const artifactStore = { async listOwnedAssets() { return list }, async getOwnedProductImage(o: { imageId: string }) { return list.find((a) => a.id === o.imageId) ?? null } } as unknown as McpArtifactStore
    const approvalStore = createMemoryMcpApprovalStore()
    vi.mocked(incrementUsage).mockClear()
    await expect(mcpExecuteImageGenerate({ db, approvalStore, artifactStore, user: { id: 'u1' }, args: { brandId: 'b1', offerId: 'o1', copy: 'Hola', productImageId: 'hero' } })).rejects.toThrow(/approve_asset hero/)
    expect(vi.mocked(incrementUsage)).not.toHaveBeenCalled()
  })
})

describe('approve_asset / unapprove_asset / set_asset_role (owner only, free)', () => {
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
  it('the owner approves (approved_at / approved_by set) and unapproves', async () => {
    const { s, patches } = store()
    const r = await mcpSetAssetApproved({ store: s, user: { id: 'owner' }, args: { productImageId: 'i1' }, approved: true })
    expect((r.asset as { approved: boolean }).approved).toBe(true)
    expect(patches[0]).toMatchObject({ approved: true, approved_by: 'owner' })
    expect(typeof patches[0].approved_at).toBe('string')
    await mcpSetAssetApproved({ store: s, user: { id: 'owner' }, args: { productImageId: 'i1' }, approved: false })
    expect(patches[1]).toEqual({ approved: false, approved_at: null, approved_by: null })
  })
  it('anyone but the owner is refused; migration 086 pending → MIGRATION_PENDING; set_asset_role validates the six roles', async () => {
    const { s } = store()
    await expect(mcpSetAssetApproved({ store: s, user: { id: 'intruder' }, args: { productImageId: 'i1' }, approved: true })).rejects.toThrow(/Only the brand owner/)
    const pending = store({ async updateProductImage() { throw Object.assign(new Error('column "approved" does not exist'), { code: '42703' }) } }).s
    await expect(mcpSetAssetApproved({ store: pending, user: { id: 'owner' }, args: { productImageId: 'i1' }, approved: true })).rejects.toMatchObject({ code: 'MIGRATION_PENDING' })
    await expect(mcpSetAssetRole({ store: s, user: { id: 'owner' }, args: { productImageId: 'i1', assetRole: 'hero' } })).rejects.toThrow(/product, b-roll/)
    const ok = await mcpSetAssetRole({ store: s, user: { id: 'owner' }, args: { productImageId: 'i1', assetRole: 'lifestyle' } })
    expect((ok.asset as { assetRole: string }).assetRole).toBe('lifestyle')
  })
  it('registered at 0.26.0: free, no approval; preflight tells the bot to call it first', () => {
    expect(MCP_REGISTRY_VERSION).toBe('0.26.0')
    for (const name of ['approve_asset', 'unapprove_asset', 'set_asset_role', 'adpack_preflight']) expect(getMcpTool(name)).toMatchObject({ requiresApproval: false, consumesAdvanceCredits: false, enabled: true })
    expect(getMcpTool('adpack_preflight')?.description).toMatch(/CALL THIS FIRST/)
    expect(getMcpTool('execute_image_generate')?.description).toMatch(/adpack_preflight/)
  })
})

describe('ad pack saved brand: only approved photos once migration 086 is applied', () => {
  it('rows carrying `approved` → only approved ones are product refs (and never the legacy product columns)', async () => {
    const { mapSavedBrand } = await import('../api/lib/adpack/saved-brand')
    const images = [
      { id: 'a', image_url: 'https://cdn.test/a.jpg', kind: 'product', approved: true, created_at: '2026-01-02' },
      { id: 'b', image_url: 'https://cdn.test/b.jpg', kind: 'product', approved: false, created_at: '2026-01-03' },
    ]
    const out = mapSavedBrand({ business: { id: 'b1', name: 'Marca' }, kit: null, product: { id: 'o1', name: 'Kit', ind_product_images: ['https://cdn.test/legacy.jpg'] }, images, fetchedAt: '2026-01-01' })
    expect(out.offer.productImageUrls).toEqual(['https://cdn.test/a.jpg'])
    const legacy = mapSavedBrand({ business: { id: 'b1', name: 'Marca' }, kit: null, product: { id: 'o1', name: 'Kit' }, images: images.map(({ approved: _a, ...r }) => r), fetchedAt: '2026-01-01' })
    expect(legacy.offer.productImageUrls?.length).toBe(2) // no approval column yet (pre-086 rows): unchanged; the MCP preflight fails closed instead
  })
})
