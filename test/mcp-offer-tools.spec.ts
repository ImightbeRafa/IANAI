import { describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../api/lib/usage-logger'
import { formatMoney, offerProfileFacts, parseOfferAdProfile, readOfferAdProfile, excludedItem } from '../api/lib/adpack/offer-profile'
import { mcpCreateOffer, mcpSetPrimaryProductImage, mcpTagProductImage, mcpUpdateOffer } from '../api/lib/mcp/offer-tools'
import { handleMcpJsonRpc } from '../api/lib/mcp/protocol'
import { getMcpTool } from '../api/lib/mcp/tool-registry'
import { BIZ_A, BIZ_B, PROD_A, PROD_B } from './adpack/saved-brand-fakes'
import { USER_A, USER_B } from './adpack/door-harness'
import { createMcpWorld } from './helpers/mcp-world'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

const rcPlane = {
  brandId: BIZ_A,
  name: 'Avión RC de papel',
  description: 'Kit de avión a control remoto con ala de papel',
  price: { amount: 14900, currency: 'CRC' },
  bundles: [{ qty: 2, price: 29800, label: '2 kits' }],
  shipping: { text: 'Envío gratis desde 2 kits', freeFromQty: 2 },
  includes: ['Chasis armado', 'Control tipo gamepad'],
  excludes: ['Papel no incluido'],
  forbiddenClaims: ['armado en minutos'],
  verifiedClaims: [{ claim: 'Vuela hasta 50 m', source: 'prueba del dueño 2026-10' }],
  cta: { text: 'Pedilo por WhatsApp', channels: ['whatsapp', 'web'] },
  ageMin: 8,
  immutableAttributes: ['ala de papel blanca', 'hélices blancas'],
  lockProductAppearance: true,
  locale: 'es-CR',
}

async function call(world: ReturnType<typeof createMcpWorld>, userId: string, name: string, args: Record<string, unknown>) {
  const rpc = await handleMcpJsonRpc({
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    user: { id: userId },
    db: world.mcpDb,
    offerStore: world.offerStore,
    brandKitStore: world.kitStore,
    rehost: null,
  })
  const result = rpc.result as { content: Array<{ text: string }>; isError: boolean }
  return { isError: result.isError, payload: JSON.parse(result.content[0].text) as Record<string, unknown> }
}

describe('offer ad profile (pure)', () => {
  it('formats CRC and USD exactly', () => {
    expect(formatMoney({ amount: 29800, currency: 'CRC' })).toBe('₡29.800')
    expect(formatMoney({ amount: 1250000, currency: 'CRC' })).toBe('₡1.250.000')
    expect(formatMoney({ amount: 25, currency: 'USD' })).toBe('$25')
    expect(formatMoney({ amount: 1250.5, currency: 'USD' })).toBe('$1,250.50')
  })

  it('validates strictly', () => {
    const bad = (raw: Record<string, unknown>) => () => parseOfferAdProfile(raw)
    expect(bad({ price: { amount: '14.900', currency: 'CRC' } })).toThrow(/price.amount: must be a number/)
    expect(bad({ price: { amount: 14900.5, currency: 'CRC' } })).toThrow(/whole colones/)
    expect(bad({ price: { amount: 10.123, currency: 'USD' } })).toThrow(/2 decimals/)
    expect(bad({ price: { amount: 100, currency: 'EUR' } })).toThrow(/CRC or USD/)
    expect(bad({ price: { amount: -1, currency: 'CRC' } })).toThrow(/greater than 0/)
    expect(bad({ price: { amount: 100, currency: 'CRC' }, compareAtPrice: 90 })).toThrow(/higher than price/)
    expect(bad({ bundles: [{ qty: 1, price: 100 }] })).toThrow(/qty: must be between 2/)
    expect(bad({ bundles: [{ qty: 2, price: 100 }] })).toThrow(/currency is required/)
    expect(bad({ cta: { channels: ['telegram'] } })).toThrow(/web, whatsapp or dm/)
    expect(bad({ ageMin: 120 })).toThrow(/between 0 and 99/)
    expect(bad({ verifiedClaims: [{ claim: 'Dura 2 horas' }] })).toThrow(/source: is required/)
    expect(bad({ includes: ['x'.repeat(161)] })).toThrow(/at most 160/)
    expect(bad({ locale: 'spanish' })).toThrow(/es-CR/)
  })

  it('turns the profile into confirmed facts with the exact strings (B5 / H7)', () => {
    const { profile } = parseOfferAdProfile(rcPlane)
    const out = offerProfileFacts(profile, 'es')
    const values = out.facts.map((f) => `${f.key}=${f.value}`)
    expect(values).toEqual(expect.arrayContaining([
      'price=₡14.900',
      'bundle=2 kits por ₡29.800',
      'shipping=Envío gratis desde 2 kits',
      'custom:includes=Chasis armado',
      'custom:not_included=Papel no incluido',
      'custom:verified_claim=Vuela hasta 50 m',
      'custom:cta=Pedilo por WhatsApp',
      'contact_channel=WhatsApp',
      'custom:age=Edad 8+',
    ]))
    // shipping text already says "gratis": no synthesized rule
    expect(values.some((v) => v.startsWith('custom:free_shipping_rule'))).toBe(false)
    expect(out.facts.every((f) => f.confirmed && f.source === 'offer_form')).toBe(true)
    expect(out.forbiddenPhrases).toEqual(['armado en minutos'])
    expect(out.notIncluded).toEqual(['Papel'])
    expect(out.strictClaims).toBe(true)
    expect(out.productLock).toEqual({ lockProductAppearance: true, immutableAttributes: ['ala de papel blanca', 'hélices blancas'], allowedProps: [] })
    expect(excludedItem('Sin baterías')).toBe('baterías')
  })

  it('round-trips the stored profile exactly', () => {
    const { profile } = parseOfferAdProfile(rcPlane, null, { now: () => new Date('2026-10-08T00:00:00Z') })
    const stored = JSON.parse(JSON.stringify(profile))
    expect(readOfferAdProfile(stored)).toEqual(profile)
    expect(readOfferAdProfile({ price: { amount: 'bad' }, ageMin: 8 })).toEqual({ ageMin: 8 })
    expect(readOfferAdProfile({})).toBeNull()
  })

  it('drops placeholder values and reports them', () => {
    const res = parseOfferAdProfile({ includes: ['N/A', 'Control'], cta: { text: 'TBD' } })
    expect(res.profile.includes).toEqual(['Control'])
    expect(res.profile.cta).toBeUndefined()
    expect(res.ignoredPlaceholders.map((p) => p.value)).toEqual(['N/A', 'TBD'])
  })
})

describe('create_offer / update_offer (B1)', () => {
  it('registers both as free sync writes at 0.11', () => {
    for (const name of ['create_offer', 'update_offer', 'set_primary_product_image', 'tag_product_image', 'set_primary_brand_kit', 'create_upload_url', 'finalize_upload']) {
      expect(getMcpTool(name)).toMatchObject({ risk: 'sync_write', requiresApproval: false, consumesAdvanceCredits: false, enabled: true })
    }
  })

  it('creates an owned offer with structured facts and mirrors the price into the form field', async () => {
    const world = createMcpWorld()
    const res = await mcpCreateOffer({ db: world.mcpDb, store: world.offerStore, user: { id: USER_A }, args: rcPlane })
    expect(res.status).toBe('created')
    expect(res.adProfileSaved).toBe(true)
    const offer = res.offer as Record<string, unknown>
    expect(offer.price).toBe('₡14.900')
    expect(offer.confirmedFacts).toEqual(expect.arrayContaining([{ key: 'bundle', value: '2 kits por ₡29.800' }, { key: 'custom:age', value: 'Edad 8+' }]))
    const row = world.db.products.find((p) => p.id === offer.offerId)!
    expect(row).toMatchObject({ owner_id: USER_A, business_id: BIZ_A, name: 'Avión RC de papel', type: 'product', re_price: '₡14.900', shipping_info: 'Envío gratis desde 2 kits' })
    expect((row.ad_profile as Record<string, unknown>).ageMin).toBe(8)
  })

  it("rejects another user's brand and offer (owner-scoped)", async () => {
    const world = createMcpWorld()
    await expect(mcpCreateOffer({ db: world.mcpDb, store: world.offerStore, user: { id: USER_B }, args: rcPlane })).rejects.toThrow('Brand not found')
    await expect(mcpUpdateOffer({ db: world.mcpDb, store: world.offerStore, user: { id: USER_A }, args: { brandId: BIZ_A, offerId: PROD_B, name: 'x' } })).rejects.toThrow('Offer not found')
    await expect(mcpUpdateOffer({ db: world.mcpDb, store: world.offerStore, user: { id: USER_A }, args: { brandId: BIZ_B, offerId: PROD_B, name: 'x' } })).rejects.toThrow('Brand not found')
    expect(world.offerStore.writes).toBe(0)
  })

  it('validates input: name required, no placeholder names, bad type, nothing to update', async () => {
    const world = createMcpWorld()
    const user = { id: USER_A }
    await expect(mcpCreateOffer({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A } })).rejects.toThrow(/name is required/)
    await expect(mcpCreateOffer({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, name: 'Producto' } })).rejects.toThrow(/name is required/)
    await expect(mcpCreateOffer({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, name: 'Kit avión', type: 'gadget' } })).rejects.toThrow(/type must be one of/)
    await expect(mcpUpdateOffer({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, offerId: PROD_A } })).rejects.toThrow(/Nothing to update/)
    await expect(mcpUpdateOffer({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, offerId: PROD_A, price: { amount: 'diez', currency: 'CRC' } } })).rejects.toThrow(/must be a number/)
  })

  it('merges updates over the saved profile; null clears a key; placeholders are not stored', async () => {
    const world = createMcpWorld()
    const user = { id: USER_A }
    await mcpUpdateOffer({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, offerId: PROD_A, price: { amount: 12900, currency: 'CRC' }, ageMin: 8 } })
    const res = await mcpUpdateOffer({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, offerId: PROD_A, ageMin: null, targetAudience: 'country', excludes: ['Papel no incluido'] } })
    const row = world.db.products.find((p) => p.id === PROD_A)!
    const profile = row.ad_profile as Record<string, unknown>
    expect(profile.price).toEqual({ amount: 12900, currency: 'CRC' })
    expect(profile.ageMin).toBeUndefined()
    expect(profile.excludes).toEqual(['Papel no incluido'])
    expect(row.target_audience).toBeNull()
    expect(res.ignoredPlaceholders).toEqual([{ field: 'targetAudience', value: 'country' }])
  })

  it('degrades when migration 085 is not applied: classic fields + mirrors saved, structured part reported pending', async () => {
    const world = createMcpWorld({ caps: { adProfile: false } })
    const res = await mcpCreateOffer({ db: world.mcpDb, store: world.offerStore, user: { id: USER_A }, args: rcPlane })
    expect(res).toMatchObject({ status: 'created', adProfileSaved: false, migrationPending: '085_offer_profile_brand_profile_images' })
    expect(String((res.warnings as string[])[0])).toMatch(/not applied yet/)
    const row = world.db.products.find((p) => p.id === (res.offer as { offerId: string }).offerId)!
    expect(row.ad_profile).toBeUndefined()
    expect(row.re_price).toBe('₡14.900')
    expect(row.shipping_info).toBe('Envío gratis desde 2 kits')
  })

  it('degrades on a stale capability cache (store answers PGRST204) without crashing', async () => {
    const world = createMcpWorld({ caps: { adProfile: false } })
    world.offerStore.capabilities = async () => ({ adProfile: true, imageMeta: true, archive: true, brandProfile: true })
    const res = await mcpUpdateOffer({ db: world.mcpDb, store: world.offerStore, user: { id: USER_A }, args: { brandId: BIZ_A, offerId: PROD_A, price: { amount: 9900, currency: 'CRC' } } })
    expect(res.adProfileSaved).toBe(false)
    expect(world.db.products.find((p) => p.id === PROD_A)!.re_price).toBe('₡9.900')
  })

  it('dispatches through tools/call and surfaces BAD_INPUT codes', async () => {
    const world = createMcpWorld()
    const ok = await call(world, USER_A, 'create_offer', rcPlane)
    expect(ok.isError).toBe(false)
    expect(ok.payload.status).toBe('created')
    const bad = await call(world, USER_A, 'update_offer', { brandId: BIZ_A, offerId: PROD_A, bundles: [{ qty: 0, price: 1 }] })
    expect(bad.isError).toBe(true)
    expect(bad.payload.error).toMatchObject({ code: 'BAD_INPUT' })
    const listed = await handleMcpJsonRpc({ body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, user: { id: USER_A }, db: world.mcpDb })
    const tools = (listed.result as { tools: Array<{ name: string; inputSchema: { required?: string[]; properties?: Record<string, unknown> } }> }).tools
    expect(tools.find((t) => t.name === 'create_offer')?.inputSchema.required).toEqual(['brandId', 'name'])
    expect(Object.keys(tools.find((t) => t.name === 'update_offer')!.inputSchema.properties!)).toEqual(expect.arrayContaining(['price', 'bundles', 'shipping', 'excludes', 'verifiedClaims', 'ageMin', 'lockProductAppearance']))
  })
})

describe('product photo management (C3)', () => {
  it('sets one primary photo per offer and refuses generated images', async () => {
    const world = createMcpWorld()
    world.db.images.push({ id: 'img-prod-2', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/serum-2.jpg', kind: 'product', message_id: null, is_primary: true })
    const res = await mcpSetPrimaryProductImage({ store: world.offerStore, user: { id: USER_A }, args: { offerId: PROD_A, productImageId: 'img-prod' } })
    expect(res.image).toMatchObject({ productImageId: 'img-prod', isPrimary: true })
    expect(world.db.images.filter((i) => i.is_primary === true).map((i) => i.id)).toEqual(['img-prod'])
    await expect(mcpSetPrimaryProductImage({ store: world.offerStore, user: { id: USER_A }, args: { offerId: PROD_A, productImageId: 'img-gen' } })).rejects.toThrow(/Only real product photos/)
    await expect(mcpSetPrimaryProductImage({ store: world.offerStore, user: { id: USER_B }, args: { offerId: PROD_A, productImageId: 'img-prod' } })).rejects.toThrow('Product image not found')
    await expect(mcpSetPrimaryProductImage({ store: world.offerStore, user: { id: USER_A }, args: { offerId: 'other', productImageId: 'img-prod' } })).rejects.toThrow(/does not belong/)
  })

  it('tags photos with the allowed vocabulary and a role', async () => {
    const world = createMcpWorld()
    const res = await mcpTagProductImage({ store: world.offerStore, user: { id: USER_A }, args: { productImageId: 'img-prod', tags: ['hero', 'detalle', 'hero'], role: 'control' } })
    expect(res.image).toMatchObject({ tags: ['hero', 'detalle'], role: 'control' })
    await expect(mcpTagProductImage({ store: world.offerStore, user: { id: USER_A }, args: { productImageId: 'img-prod', tags: ['blurry'] } })).rejects.toThrow(/Unknown tag/)
  })

  it('reports MIGRATION_PENDING (no write) before 085', async () => {
    const world = createMcpWorld({ caps: { imageMeta: false } })
    const res = await call(world, USER_A, 'set_primary_product_image', { offerId: PROD_A, productImageId: 'img-prod' })
    expect(res.isError).toBe(true)
    expect(res.payload.error).toMatchObject({ code: 'MIGRATION_PENDING' })
    expect(String((res.payload.error as { message: string }).message)).toMatch(/085/)
    const tag = await call(world, USER_A, 'tag_product_image', { productImageId: 'img-prod', tags: ['hero'] })
    expect(tag.payload.error).toMatchObject({ code: 'MIGRATION_PENDING' })
    expect(world.db.images.some((i) => 'tags' in i)).toBe(false)
  })
})

describe('bulk / campaign productImageIds pool (C3)', () => {
  it('maps the pool onto productImageId (hero) + referenceImageIds', async () => {
    const { withProductImageIdsAlias } = await import('../api/lib/mcp/bulk-tools')
    expect(withProductImageIdsAlias({ brandId: 'b', productImageIds: ['p1', 'p2', 'p3'] })).toEqual({ brandId: 'b', productImageId: 'p1', referenceImageIds: ['p2', 'p3'] })
    expect(withProductImageIdsAlias({ productImageIds: ['p1', 'p2'], productImageId: 'p9', referenceImageIds: ['r1'] })).toEqual({ productImageId: 'p9', referenceImageIds: ['p1', 'p2', 'r1'] })
    expect(withProductImageIdsAlias({ productImageId: 'p1' })).toEqual({ productImageId: 'p1' })
  })
})
