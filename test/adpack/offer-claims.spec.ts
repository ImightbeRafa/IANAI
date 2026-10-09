import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../../api/lib/usage-logger'
import { checkAdCopy } from '../../api/lib/adpack/check-copy'
import { buildCopyContext, factsAllowlistBlock } from '../../api/lib/adpack/copy-shared'
import { offerForItem } from '../../api/lib/adpack/pack-runner'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import { buildDnaFromSavedBrand } from '../../api/lib/adpack/saved-brand'
import type { AdCopy, BrandDna, OfferInput } from '../../api/lib/adpack/types'
import { orderProductImages } from '../../api/lib/product-image-order'
import { setMcpExecuteScheduler } from '../../api/lib/mcp/execute-job'
import { handleMcpJsonRpc } from '../../api/lib/mcp/protocol'
import { createMcpWorld } from '../helpers/mcp-world'
import { USER_A, USER_B, createDoorEnv, createMemoryMcpApprovalStore } from './door-harness'
import { BIZ_A, KIT_A, PROD_A, fakeLibrary } from './saved-brand-fakes'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

beforeEach(() => setMcpExecuteScheduler(() => {}))
afterEach(() => setMcpExecuteScheduler((work) => {
  void work().catch(() => {})
}))

const RC_PROFILE = {
  price: { amount: 14900, currency: 'CRC' },
  bundles: [{ qty: 2, amount: 29800, currency: 'CRC', label: '2 kits' }],
  shipping: { text: 'Envío gratis desde 2 kits', freeFromQty: 2 },
  includes: ['Control tipo gamepad'],
  excludes: ['Papel no incluido'],
  forbiddenClaims: ['armado en minutos'],
  verifiedClaims: [{ claim: 'El chasis viene armado', source: 'ficha del fabricante' }],
  ageMin: 8,
  lockProductAppearance: true,
  immutableAttributes: ['hélices blancas'],
}

async function rcSaved(profile: Record<string, unknown> = RC_PROFILE) {
  const world = createMcpWorld()
  const product = world.db.products.find((p) => p.id === PROD_A)!
  product.ad_profile = profile
  const res = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
  return { world, ...res }
}

function copyFor(dna: BrandDna, offer: OfferInput, patch: Partial<AdCopy>): { copy: AdCopy; check: ReturnType<typeof checkAdCopy> } {
  const angle = planAngles({ dna, offer, size: 3, language: 'es' })[0]
  const ctx = buildCopyContext(dna, offer, angle, 'es')
  const copy: AdCopy = {
    headline: 'Tu avión vuela hoy',
    bullets: ['Ideal para regalar'],
    cta: 'Pedilo ya',
    caption: 'Un avión de papel que vuela de verdad, para tardes al aire libre con la familia.',
    sceneBrief: 'Mesa de madera junto a una ventana con luz cálida.',
    usedFactKeys: [],
    ...(ctx.offerLine ? { offerLine: ctx.offerLine } : {}),
    ...patch,
  }
  return { copy, check: checkAdCopy(copy, { dna, offer, angle, language: 'es' }) }
}

const details = (check: ReturnType<typeof checkAdCopy>, prefix: string) =>
  check.issues.filter((i) => i.detail.startsWith(prefix)).map((i) => [i.field, i.detail.slice(0, 60)])

describe('verified facts from the offer ad profile (B5 / H7)', () => {
  it('turns ad_profile into confirmed DNA/offer facts with exact strings', async () => {
    const { dna, offer, notes } = await rcSaved()
    const confirmed = dna.facts.filter((f) => f.confirmed).map((f) => `${f.key}=${f.value}`)
    expect(confirmed).toEqual(expect.arrayContaining([
      'price=₡14.900', 'bundle=2 kits por ₡29.800', 'shipping=Envío gratis desde 2 kits', 'custom:age=Edad 8+',
      'custom:verified_claim=El chasis viene armado', 'custom:not_included=Papel no incluido',
    ]))
    // the profile price replaces the legacy re_price (₡12.900) — one price only
    expect(dna.facts.filter((f) => f.key === 'price').map((f) => f.value)).toEqual(['₡14.900'])
    expect(dna.facts.find((f) => f.key === 'shipping')?.value).toBe('Envío gratis desde 2 kits')
    expect(dna.forbiddenPhrases).toContain('armado en minutos')
    expect(offer).toMatchObject({ notIncluded: ['Papel'], strictClaims: true, productLock: { lockProductAppearance: true, immutableAttributes: ['hélices blancas'] } })
    expect(notes.some((n) => n.startsWith('price:'))).toBe(false)
  })

  it('flags claims that are not traceable to a confirmed fact (strict bank)', async () => {
    const { dna, offer } = await rcSaved()
    const bad = copyFor(dna, offer, {
      subline: 'Gratis con dos kits',
      bullets: ['Armás el chasis en minutos', 'Ideal para regalar'],
    }).check
    const hits = details(bad, 'untraceable_claim')
    expect(hits.map((h) => h[0])).toEqual(expect.arrayContaining(['subline', 'bullets']))
    expect(bad.ok).toBe(false)

    const good = copyFor(dna, offer, {
      subline: 'Envío gratis desde 2 kits',
      bullets: ['El chasis viene armado', 'Edad 8+'],
      caption: 'Un avión de papel que vuela de verdad. 2 kits por ₡29.800 y Envío gratis desde 2 kits. Papel no incluido.',
    }).check
    expect(details(good, 'untraceable_claim')).toEqual([])
    expect(details(good, 'not_included')).toEqual([])
  })

  it('flags copy saying an excluded item is included', async () => {
    const { dna, offer } = await rcSaved()
    const res = copyFor(dna, offer, { caption: 'Incluye papel para armar 10 aviones distintos en casa con tus hijos.' }).check
    expect(details(res, 'not_included').map((h) => h[0])).toEqual(['caption'])
  })

  it('keeps the previous behaviour without a verified-claims bank', async () => {
    const { dna, offer } = await rcSaved({ ...RC_PROFILE, verifiedClaims: undefined })
    expect(offer.strictClaims).toBeUndefined()
    const res = copyFor(dna, offer, { subline: 'Gratis con dos kits' }).check
    expect(details(res, 'untraceable_claim')).toEqual([])
  })

  it('tells the copy model about excluded items and the claims bank', async () => {
    const { dna, offer } = await rcSaved()
    const angle = planAngles({ dna, offer, size: 3, language: 'es' })[0]
    const block = factsAllowlistBlock(buildCopyContext(dna, offer, angle, 'es'))
    expect(block).toContain('NO INCLUIDO (nunca digas que viene incluido): Papel')
    expect(block).toContain('BANCO DE CLAIMS VERIFICADOS')
    expect(block).toContain('"Envío gratis desde 2 kits"')
  })
})

describe('product photo selection (C3)', () => {
  it('orders primary → hero tag → sharpest → newest', () => {
    const rows = [
      { id: 'new-blurry', created_at: '2026-10-08T00:00:00Z', quality: { sharpness: 0.2 } },
      { id: 'old-sharp', created_at: '2026-01-01T00:00:00Z', quality: { sharpness: 0.9 } },
      { id: 'hero', created_at: '2025-01-01T00:00:00Z', tags: ['hero'] },
      { id: 'primary', created_at: '2024-01-01T00:00:00Z', is_primary: true },
      { id: 'newest-no-quality', created_at: '2026-10-09T00:00:00Z' },
    ]
    expect(orderProductImages(rows).map((r) => r.id)).toEqual(['primary', 'hero', 'old-sharp', 'new-blurry', 'newest-no-quality'])
    expect(orderProductImages([{ id: 'a', created_at: '2026-01-01' }, { id: 'b', created_at: '2026-02-01' }]).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('uses the primary photo as hero, a productImageIds pool, and per-ad photos', async () => {
    const world = createMcpWorld()
    world.db.images.push(
      { id: 'img-blurry', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/whatsapp.jpg', kind: 'product', message_id: null, created_at: '2026-10-08T00:00:00Z' },
      { id: 'img-box', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/box.jpg', kind: 'product', message_id: null, tags: ['caja'] },
    )
    world.db.images.find((i) => i.id === 'img-prod')!.is_primary = true
    const def = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    expect(def.offer.productImageUrls[0]).toBe('https://cdn.example/serum.jpg')

    const pool = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A, productImageIds: ['img-box', 'img-prod'], productImageIdsByAd: { 2: ['img-blurry'] } })
    expect(pool.offer.productImageUrls).toEqual(['https://cdn.example/box.jpg', 'https://cdn.example/serum.jpg'])
    expect(pool.offer.productImageUrlsByAd).toEqual({ 1: ['https://cdn.example/whatsapp.jpg'] })
    expect(offerForItem(pool.offer, 1).productImageUrls).toEqual(['https://cdn.example/whatsapp.jpg'])
    expect(offerForItem(pool.offer, 0).productImageUrls[0]).toBe('https://cdn.example/box.jpg')

    await expect(buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A, productImageIds: ['img-gen'] })).rejects.toThrow(/not found on this offer/)
    await expect(buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A, productImageIds: ['img-ctx'] })).rejects.toThrow(/not found on this offer/)
  })
})

// ---------------------------------------------------------------------------
// MCP door: G2 (profile by id) + B2 (persist corrections)
// ---------------------------------------------------------------------------

function mcpEnv() {
  const world = createMcpWorld()
  const env = createDoorEnv({ savedBrandDb: world.db, library: fakeLibrary(world.db) })
  return { world, env, approvalStore: createMemoryMcpApprovalStore() }
}

async function call(e: ReturnType<typeof mcpEnv>, userId: string, name: string, args: Record<string, unknown>) {
  const rpc = await handleMcpJsonRpc({
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    user: { id: userId },
    db: e.world.mcpDb,
    approvalStore: e.approvalStore,
    adPackService: e.env.service,
    offerStore: e.world.offerStore,
    brandKitStore: e.world.kitStore,
    rehost: null,
  })
  const result = rpc.result as { content: Array<{ text: string }>; isError: boolean }
  return { isError: result.isError, payload: JSON.parse(result.content[0].text) as Record<string, unknown> }
}

describe('adpack tools by id (G2) + saveToOffer / saveToBrandKit (B2)', () => {
  it('adpack_from_brand returns a compact dnaSummary unless includeDna is true', async () => {
    const e = mcpEnv()
    const compact = await call(e, USER_A, 'adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A })
    expect(compact.isError).toBe(false)
    expect(compact.payload.dna).toBeUndefined()
    expect(compact.payload.dnaSummary).toMatchObject({ brandName: 'Alba Botánica Tica', language: 'es' })
    expect(JSON.stringify(compact.payload).length).toBeLessThan(JSON.stringify((await call(e, USER_A, 'adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A, includeDna: true })).payload).length)
    const full = await call(e, USER_A, 'adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A, includeDna: true })
    expect((full.payload.dna as BrandDna).version).toBe(1)
  })

  it('persists corrected offer facts before building the DNA and reports them', async () => {
    const e = mcpEnv()
    const res = await call(e, USER_A, 'adpack_from_brand', {
      brandId: BIZ_A,
      offerId: PROD_A,
      saveToOffer: true,
      offerPatch: { price: { amount: 14900, currency: 'CRC' }, excludes: ['Papel no incluido'], ageMin: 8 },
      saveToBrandKit: true,
      brandKitPatch: { register: 'usted', targetAudience: 'country' },
    })
    expect(res.isError).toBe(false)
    expect(res.payload.saved).toMatchObject({
      offer: { status: 'updated', offerId: PROD_A, adProfileSaved: true },
      brandKit: { status: 'updated', brandKitId: KIT_A, ignoredPlaceholders: [{ field: 'targetAudience', value: 'country' }] },
    })
    const summary = res.payload.dnaSummary as { register: string; confirmedFacts: Array<{ key: string; value: string }> }
    expect(summary.register).toBe('usted')
    expect(summary.confirmedFacts).toEqual(expect.arrayContaining([{ key: 'price', value: '₡14.900' }, { key: 'custom:age', value: 'Edad 8+' }]))
    expect(e.world.db.products.find((p) => p.id === PROD_A)!.ad_profile).toMatchObject({ ageMin: 8 })
    expect(e.env.charges).toHaveLength(0)
  })

  it('rejects patches without the save flag, other users, and patch-only creation', async () => {
    const e = mcpEnv()
    const noFlag = await call(e, USER_A, 'adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A, offerPatch: { ageMin: 8 } })
    expect(noFlag.payload.error).toMatchObject({ code: 'BAD_INPUT' })
    const noOffer = await call(e, USER_A, 'adpack_from_brand', { brandId: BIZ_A, saveToOffer: true, offerPatch: { ageMin: 8 } })
    expect(String((noOffer.payload.error as { message: string }).message)).toMatch(/needs offerId/)
    const other = await call(e, USER_B, 'adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A, saveToOffer: true, offerPatch: { ageMin: 8 } })
    expect(other.isError).toBe(true)
    expect(e.world.offerStore.writes).toBe(0)
  })

  it('adpack_start writes corrections once (first call), binds them to the approval and uses them in the pack', async () => {
    const e = mcpEnv()
    const args = {
      brandId: BIZ_A,
      offerId: PROD_A,
      size: 2,
      saveToOffer: true,
      offerPatch: { price: { amount: 14900, currency: 'CRC' } },
      productImageIds: ['img-prod'],
    }
    const prompt = await call(e, USER_A, 'adpack_start', args)
    expect(prompt.payload.status).toBe('approval_required')
    expect(prompt.payload.saved).toMatchObject({ offer: { adProfileSaved: true } })
    expect(prompt.payload.dna).toBeUndefined()
    const writes = e.world.offerStore.writes
    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await call(e, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const started = await call(e, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(started.isError).toBe(false)
    expect(e.world.offerStore.writes).toBe(writes)
    const pack = e.env.store.packs.get(String(started.payload.packId))!
    expect(pack.offer.facts.find((f) => f.key === 'price')?.value).toBe('₡14.900')
    expect(pack.offer.productImageUrls).toEqual(['https://cdn.example/serum.jpg'])
    // changing the corrections after approval is a different request
    const changed = await call(e, USER_A, 'adpack_start', { ...args, offerPatch: { price: { amount: 1, currency: 'CRC' } }, approvalRequestId })
    expect(changed.isError).toBe(true)
  })
})
