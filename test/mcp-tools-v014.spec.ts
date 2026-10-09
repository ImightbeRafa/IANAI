/**
 * MCP 0.14 tool fixes from the real-test report (fakes only, no network, no model calls):
 * #12 Style DNA leak / detach / delete · #18 uploads · #19 no silent truncation ·
 * #20 list_assets photo audit · #22 update_brand / set_default_offer / audience dedupe.
 * Placeholder brand data only.
 */
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../api/lib/usage-logger'
import { handleMcpJsonRpc } from '../api/lib/mcp/protocol'
import { createMemoryMcpApprovalStore } from '../api/lib/mcp/approval'
import { mcpCreateUploadUrl, mcpFinalizeUpload, cleanLabelFromFilename } from '../api/lib/mcp/upload-tools'
import { safeFilename } from '../api/lib/mcp/asset-rehost'
import { middleTruncate, clipWithNotice, type TruncationNotice } from '../api/lib/mcp/text-limits'
import type { McpArtifactStore } from '../api/lib/mcp/artifact-store'
import { activeStyleDnaIds, parseBrandProfilePatch, readBrandProfile } from '../api/lib/brand-profile'
import { buildDnaFromSavedBrand } from '../api/lib/adpack/saved-brand'
import { dedupeAudiences } from '../api/lib/adpack/dna/part'
import { parseStringList, parseProductPhotos } from '../api/lib/adpack/service'
import { createDoorEnv, USER_A, USER_B } from './adpack/door-harness'
import { BIZ_A, KIT_A, PROD_A } from './adpack/saved-brand-fakes'
import { createMcpWorld } from './helpers/mcp-world'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

type World = ReturnType<typeof createMcpWorld>

function artifactStoreFor(world: World): McpArtifactStore {
  return {
    async listOwnedAssets({ userId, offerId, kind }) {
      return world.db.images
        .filter((i) => i.user_id === userId && (!offerId || i.product_id === offerId) && (!kind || i.kind === kind))
        .map((i) => ({
          id: String(i.id),
          imageUrl: String(i.image_url),
          offerId: String(i.product_id),
          label: (i.label as string | null) ?? null,
          kind: i.kind as 'product',
          tags: Array.isArray(i.tags) ? (i.tags as string[]) : [],
          role: (i.role as string | null) ?? null,
          isPrimary: i.is_primary === true,
          quality: (i.quality as Record<string, unknown> | null) ?? null,
          sourceUrl: (i.source_url as string | null) ?? null,
        }))
    },
  } as unknown as McpArtifactStore
}

function rpcFor(world: World, user = USER_A) {
  const approvalStore = createMemoryMcpApprovalStore()
  const env = createDoorEnv({ savedBrandDb: world.db })
  return async (name: string, args: Record<string, unknown>) => {
    const res = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      user: { id: user },
      db: world.mcpDb,
      offerStore: world.offerStore,
      brandKitStore: world.kitStore,
      approvalStore,
      artifactStore: artifactStoreFor(world),
      adPackService: env.service,
    })
    if (res.error) throw new Error(`rpc error ${res.error.message}`)
    const result = res.result as { content: Array<{ text: string }>; isError: boolean }
    return { isError: result.isError, payload: JSON.parse(result.content[0].text) as Record<string, any> }
  }
}

const kitA = (world: World) => world.db.kits.find((k) => k.id === KIT_A)!

describe('#12 Style DNA: no implicit leak, detach, delete, echo', () => {
  it('styleDnaIds [] is kept as an explicit "none" (null clears the selection)', () => {
    const opts = { assertUrl: (u: string) => u }
    const none = parseBrandProfilePatch({ styleDnaIds: [] }, null, opts).profile
    expect(none.styleDnaIds).toEqual([])
    expect(readBrandProfile(none)?.styleDnaIds).toEqual([])
    expect(parseBrandProfilePatch({ styleDnaIds: null }, none, opts).profile.styleDnaIds).toBeUndefined()
    expect(activeStyleDnaIds(['dna_1', 'dna_2'], { styleDnaIds: [] })).toEqual([])
    expect(activeStyleDnaIds(['dna_1', 'dna_2'], { styleDnaIds: ['dna_2'] })).toEqual(['dna_2'])
    expect(activeStyleDnaIds(['dna_1'], null)).toEqual(['dna_1'])
    expect(activeStyleDnaIds(['dna_1'], null, false)).toEqual([])
  })

  it('with styleDnaIds [] or useStyleDna:false the DNA carries no Style DNA notes or references', async () => {
    const world = createMcpWorld()
    const base = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    expect(base.dna.visual.styleNotes).toContain('fondos cálidos') // legacy: no selection → every kit DNA
    expect(base.dna.referenceImageUrls).toContain('https://cdn.example/style-1.jpg')
    expect(base.activeStyleDnaIds).toEqual(['dna_1'])

    const off = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A, useStyleDna: false })
    expect(off.dna.visual.styleNotes ?? '').not.toContain('fondos cálidos')
    expect(off.dna.visual.styleNotes).toContain('luz natural') // the kit's own visual notes stay
    expect(off.dna.referenceImageUrls ?? []).not.toContain('https://cdn.example/style-1.jpg')
    expect(off.activeStyleDnaIds).toEqual([])

    kitA(world).brand_profile = { styleDnaIds: [] }
    const none = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    expect(none.dna.visual.styleNotes ?? '').not.toContain('fondos cálidos')
    expect(none.activeStyleDnaIds).toEqual([])
  })

  it('adpack_from_brand / adpack_start accept useStyleDna:false; it conflicts with styleDnaId', async () => {
    const world = createMcpWorld()
    const rpc = rpcFor(world)
    const from = await rpc('adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A, useStyleDna: false })
    expect(from.isError).toBe(false)
    expect(from.payload.activeStyleDnaIds).toEqual([])
    expect(String(from.payload.dnaSummary.visual.styleNotes ?? '')).not.toContain('fondos cálidos')
    const clash = await rpc('adpack_start', { brandId: BIZ_A, offerId: PROD_A, size: 1, useStyleDna: false, styleDnaId: 'dna_1' })
    // The approval prompt is issued first; the conflict is enforced when the approved start runs.
    if (!clash.isError) {
      const approvalRequestId = clash.payload.approvalRequestId
      await rpc('confirm_execute', { approvalRequestId, action: 'approve' })
      const run = await rpc('adpack_start', { brandId: BIZ_A, offerId: PROD_A, size: 1, useStyleDna: false, styleDnaId: 'dna_1', approvalRequestId })
      expect(run.isError).toBe(true)
      expect(run.payload.error.message).toMatch(/conflicts with useStyleDna:false/)
    }
  })

  it('detach_style_dna keeps it on the kit but out of the selection; update_brand_kit echoes styleDnaIds', async () => {
    const world = createMcpWorld()
    const rpc = rpcFor(world)
    const res = await rpc('detach_style_dna', { brandKitId: KIT_A, styleDnaId: 'dna_1' })
    expect(res.payload).toMatchObject({ status: 'detached', styleDnaIds: [], activeStyleDnaIds: [] })
    expect((kitA(world).style_dnas as unknown[]).length).toBe(1)
    expect((kitA(world).brand_profile as { styleDnaIds: string[] }).styleDnaIds).toEqual([])
    const upd = await rpc('update_brand_kit', { brandId: BIZ_A, kitId: KIT_A, tagline: 'Sérum hecho en Heredia' })
    expect(upd.payload.kit).toMatchObject({ styleDnaIds: [], activeStyleDnaIds: [] })
    const back = await rpc('update_brand_kit', { brandId: BIZ_A, kitId: KIT_A, styleDnaIds: ['dna_1'] })
    expect(back.payload.kit).toMatchObject({ styleDnaIds: ['dna_1'], activeStyleDnaIds: ['dna_1'] })
    const missing = await rpc('detach_style_dna', { brandKitId: KIT_A, styleDnaId: 'nope' })
    expect(missing.isError).toBe(true)
  })

  it('delete_style_dna needs the exact name + in-chat approval, then removes it everywhere', async () => {
    const world = createMcpWorld()
    const rpc = rpcFor(world)
    const wrong = await rpc('delete_style_dna', { brandKitId: KIT_A, styleDnaId: 'dna_1', confirm: 'feed' })
    expect(wrong.isError).toBe(true)
    const prompt = await rpc('delete_style_dna', { brandKitId: KIT_A, styleDnaId: 'dna_1', confirm: 'Feed' })
    expect(prompt.payload).toMatchObject({ status: 'approval_required', toolName: 'delete_style_dna', quotedCreditCost: 0 })
    expect((kitA(world).style_dnas as unknown[]).length).toBe(1)
    const approvalRequestId = prompt.payload.approvalRequestId
    await rpc('confirm_execute', { approvalRequestId, action: 'approve' })
    const done = await rpc('delete_style_dna', { brandKitId: KIT_A, styleDnaId: 'dna_1', confirm: 'Feed', approvalRequestId })
    expect(done.payload).toMatchObject({ status: 'deleted', styleDnaId: 'dna_1', styleDnas: [] })
    expect(kitA(world).style_dnas).toEqual([])
    const other = rpcFor(world, USER_B)
    expect((await other('delete_style_dna', { brandKitId: KIT_A, styleDnaId: 'dna_1', confirm: 'Feed' })).isError).toBe(true)
  })
})

describe('#22 update_brand, set_default_offer, audience dedupe', () => {
  it('update_brand edits the brand; placeholders are never stored; too long is an error', async () => {
    const world = createMcpWorld()
    world.db.businesses.find((b) => b.id === BIZ_A)!.icp_description = 'country'
    const rpc = rpcFor(world)
    const placeholder = await rpc('update_brand', { brandId: BIZ_A, icpDescription: 'country' })
    expect(placeholder.payload).toMatchObject({ status: 'unchanged', ignoredPlaceholders: [{ field: 'icpDescription', value: 'country' }] })
    const ok = await rpc('update_brand', { brandId: BIZ_A, icpDescription: 'Papás y mamás de niños de 8 a 14 que buscan un regalo armable', location: 'San José, Costa Rica', doesShipping: true, salesChannels: ['messages', 'website'] })
    expect(ok.payload).toMatchObject({ status: 'updated', brand: { icpDescription: 'Papás y mamás de niños de 8 a 14 que buscan un regalo armable', location: 'San José, Costa Rica', doesShipping: true } })
    const biz = world.db.businesses.find((b) => b.id === BIZ_A)!
    expect(biz.icp_description).toBe('Papás y mamás de niños de 8 a 14 que buscan un regalo armable')
    const tooLong = await rpc('update_brand', { brandId: BIZ_A, location: 'x'.repeat(201) })
    expect(tooLong.isError).toBe(true)
    expect(tooLong.payload.error.message).toMatch(/201 characters; the maximum is 200/)
    expect((await rpcFor(world, USER_B)('update_brand', { brandId: BIZ_A, name: 'Otra' })).isError).toBe(true)
  })

  it('set_default_offer is used whenever offerId is omitted', async () => {
    const world = createMcpWorld()
    const rpc = rpcFor(world)
    const created = await rpc('create_offer', { brandId: BIZ_A, name: 'Kit Demo B' })
    const newest = String(created.payload.offer?.offerId ?? created.payload.offerId)
    // Without a default the newest offer wins…
    const before = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A })
    expect(before.offerId).toBe(newest)
    const set = await rpc('set_default_offer', { brandId: BIZ_A, offerId: PROD_A })
    expect(set.payload).toMatchObject({ status: 'updated', defaultOfferId: PROD_A, brandKitId: KIT_A })
    const after = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A })
    expect(after.offerId).toBe(PROD_A)
    const from = await rpc('adpack_from_brand', { brandId: BIZ_A })
    expect(from.payload.offerId).toBe(PROD_A)
    expect((await rpc('set_default_offer', { brandId: BIZ_A, offerId: '00000000-0000-4000-8000-000000000999' })).isError).toBe(true)
  })

  it('audiences from several sources collapse into the most specific lines (max 3)', () => {
    expect(dedupeAudiences([
      'Mujeres 25–40, todo el país',
      'Mujeres de 25 a 40 con piel mixta',
      'Mujeres 25–40',
      'Padres que buscan un regalo armable',
      'Padres buscando un regalo',
      'Hobbistas del aeromodelismo',
      'Coleccionistas',
    ])).toEqual(['Mujeres de 25 a 40 con piel mixta', 'Padres que buscan un regalo armable', 'Hobbistas del aeromodelismo'])
  })
})

async function realPhoto(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect x="300" y="250" width="600" height="400" rx="40" fill="#1f2937"/><rect x="380" y="330" width="440" height="60" fill="#ef4444"/></svg>'), top: 0, left: 0 }])
    .jpeg({ quality: 92 }).toBuffer())
}

describe('#18 uploads: role enum, label, tags, quality report, optional size', () => {
  it('create_upload_url accepts sizeBytes 0 / absent and the import_image role enum; finalize returns quality + tags + a clean label', async () => {
    const world = createMcpWorld()
    const user = { id: USER_A }
    await expect(mcpCreateUploadUrl({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, offerId: PROD_A, kind: 'product_photo', role: 'hero', filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: -1 } })).rejects.toThrow(/sizeBytes is optional/)
    const res = await mcpCreateUploadUrl({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, offerId: PROD_A, kind: 'product_photo', role: 'hero', tags: ['detalle'], filename: 'IMG_2041 avión-armado (final).JPG', contentType: 'image/jpeg', sizeBytes: 0 }, newId: () => 'u1' })
    const bytes = await realPhoto()
    world.offerStore.objects.set(String(res.path), { size: bytes.length, contentType: 'image/jpeg', bytes })
    const done = await mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: res.uploadId } })
    expect(done).toMatchObject({ status: 'finalized', role: 'hero', tags: ['hero', 'detalle'], isPrimary: true, label: 'avión armado final', width: 1200, height: 900 })
    expect(done.quality).toMatchObject({ width: 1200, height: 900 })
    const row = world.db.images.find((i) => i.id === done.productImageId)!
    expect(row).toMatchObject({ label: 'avión armado final', tags: ['hero', 'detalle'], is_primary: true })
    expect(String(row.label)).not.toMatch(/MCP upload/)
    await expect(mcpCreateUploadUrl({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, kind: 'logo', role: 'hero', filename: 'l.png', contentType: 'image/png' } })).rejects.toThrow(/variant/)
  })

  it('an explicit label wins; tag_product_image can rename a photo', async () => {
    const world = createMcpWorld()
    const user = { id: USER_A }
    const res = await mcpCreateUploadUrl({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, offerId: PROD_A, kind: 'product_photo', role: 'part', label: 'control tipo gamepad', filename: 'x.png', contentType: 'image/png' } })
    world.offerStore.objects.set(String(res.path), { size: 10, contentType: 'image/png' })
    const done = await mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: res.uploadId } })
    expect(done).toMatchObject({ label: 'control tipo gamepad', role: 'part', tags: ['part'], isPrimary: false, quality: null })
    expect(done.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/quality report unavailable/)]))
    const rpc = rpcFor(world)
    const tagged = await rpc('tag_product_image', { productImageId: done.productImageId, tags: ['part'], label: 'Control gamepad 2.4 GHz' })
    expect(tagged.payload.image).toMatchObject({ label: 'Control gamepad 2.4 GHz', tags: ['part'] })
    const long = await rpc('tag_product_image', { productImageId: done.productImageId, tags: ['part'], label: 'x'.repeat(161) })
    expect(long.isError).toBe(true)
    expect(cleanLabelFromFilename('IMG_20240101_123456.jpg')).toBe('')
  })
})

describe('#19 no silent truncation', () => {
  it('limits are errors (labels 160, props/attributes 160), never cuts', async () => {
    expect(() => parseStringList(['x'.repeat(161)], 'immutableAttributes')).toThrow(/immutableAttributes\[0\] is 161 characters; the maximum is 160/)
    expect(parseStringList(['hélices blancas y fuselaje de papel plegado a mano con refuerzo de cinta transparente en la punta'], 'immutableAttributes')![0].length).toBeGreaterThan(60)
    expect(() => parseProductPhotos([{ url: 'https://cdn.example/a.jpg', role: 'hero', label: 'y'.repeat(161) }], 'offer.productPhotos')).toThrow(/maximum is 160/)
    const world = createMcpWorld()
    const rpc = rpcFor(world)
    const imp = await rpc('import_image', { brandId: BIZ_A, offerId: PROD_A, url: 'https://cdn.example/a.jpg', kind: 'product_photo', role: 'hero', label: 'z'.repeat(161) })
    expect(imp.isError).toBe(true)
    expect(imp.payload.error.message).toMatch(/161 characters; the maximum is 160/)
  })

  it('stored file names keep the meaningful tail and extension (middle truncation)', () => {
    const name = safeFilename(`${'a'.repeat(70)}-avion-rc-armado-vista-lateral-final.jpg`)
    expect(name.length).toBeLessThanOrEqual(80)
    expect(name.endsWith('vista-lateral-final.jpg')).toBe(true)
    expect(name.startsWith('aaaa')).toBe(true)
    expect(middleTruncate('short.png', 80)).toBe('short.png')
    const notes: TruncationNotice[] = []
    expect(clipWithNotice('summary', 'palabra '.repeat(40), 200, notes).endsWith('…')).toBe(true)
    expect(notes).toEqual([{ field: 'summary', from: 320, to: 200 }])
  })

  it('technical specs keep up to 2000 characters; longer saved values are reported as truncated', async () => {
    const world = createMcpWorld()
    const product = world.db.products.find((p) => p.id === PROD_A)!
    product.technical_specs = `Envergadura 45 cm; batería 3.7 V; alcance 30 m; ${'detalle '.repeat(20)}; guía en ejemplo.test/guia`
    const ok = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    expect(ok.offer.facts.find((f) => f.key === 'custom:technical_specs')!.value).toContain('guía en ejemplo.test/guia')
    expect(ok.truncated).toBeUndefined()
    product.technical_specs = 'w'.repeat(2500)
    const long = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    expect(long.truncated).toEqual([{ field: 'products.technical_specs', from: 2500, to: 2000 }])
    expect(long.notes.join(' ')).toMatch(/truncated: products.technical_specs is 2500 characters/)
  })
})

describe('#20 list_assets: photo setup audit', () => {
  it('returns role, tags, isPrimary, quality, sourceUrl and label per product photo, plus kit assets', async () => {
    const world = createMcpWorld()
    world.db.images.push(
      { id: 'img-hero2', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/h.jpg', kind: 'product', label: 'avión armado', tags: ['hero'], is_primary: true, role: 'avión armado', quality: { width: 1200, height: 900, blurry: false }, source_url: 'https://drive.example/file/1' },
      { id: 'img-ctrl', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/c.jpg', kind: 'product', label: '[part] control', tags: [], is_primary: false },
    )
    kitA(world).brand_profile = { logoVariants: [{ url: 'https://cdn.example/logo-dark.png', variant: 'dark' }], winnerAdUrls: ['https://cdn.example/w.jpg'] }
    const rpc = rpcFor(world)
    const res = await rpc('list_assets', { brandId: BIZ_A, offerId: PROD_A })
    const hero = res.payload.assets.find((a: { id: string }) => a.id === 'img-hero2')
    expect(hero).toMatchObject({ role: 'hero', tags: ['hero'], isPrimary: true, quality: { width: 1200 }, sourceUrl: 'https://drive.example/file/1', label: 'avión armado', partName: 'avión armado' })
    const ctrl = res.payload.assets.find((a: { id: string }) => a.id === 'img-ctrl')
    expect(ctrl).toMatchObject({ role: 'part', label: 'control', isPrimary: false })
    expect(res.payload.kitAssets).toMatchObject({ brandKitId: KIT_A, logoUrl: 'https://cdn.example/alba-logo.png', logoVariants: [{ url: 'https://cdn.example/logo-dark.png', variant: 'dark' }], winnerAdUrls: ['https://cdn.example/w.jpg'] })
  })
})
