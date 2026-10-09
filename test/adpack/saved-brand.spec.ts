import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/lib/auth')>()
  return {
    ...actual,
    requireAuth: vi.fn(async (req: { headers: Record<string, string | undefined> }, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      const m = /^Bearer test:(.+)$/.exec(req.headers.authorization ?? '')
      if (!m) {
        res.status(401).json({ error: 'Unauthorized' })
        return null
      }
      return { id: m[1] }
    }),
  }
})

import handler, { setAdPackBackgroundScheduler } from '../../api/ad-pack'
import { buildCopyPrompt } from '../../api/lib/adpack/copy'
import { briefForPrompt, sanitizeBrief } from '../../api/lib/adpack/copy-shared'
import { buildDnaFromSavedBrand, concretePrice } from '../../api/lib/adpack/saved-brand'
import { setDefaultAdPackService } from '../../api/lib/adpack/service'
import type { AdPackStatusResponse } from '../../api/lib/adpack/http-types'
import { planAngles, refineAnglesWithLlm } from '../../api/lib/adpack/plan-angles'
import type { DnaFact, ModelGateway, PackItem } from '../../api/lib/adpack/types'
import { drainBackground, queueBackgroundWork, restoreBackgroundWork } from './background-queue'
import { getMcpTool, listEnabledMcpTools } from '../../api/lib/mcp/tool-registry'
import {
  USER_A,
  USER_B,
  callMcp,
  callWeb,
  createDoorEnv,
  createMemoryMcpApprovalStore,
  mcpStartApproved,
  type DoorEnv,
} from './door-harness'
import {
  BIZ_A,
  BIZ_B,
  KIT_A,
  KIT_A_OTHER,
  PROD_A,
  PROD_A_BUCKET,
  PROD_B,
  fakeLibrary,
  fakeSavedBrandDb,
  type FakeSavedDb,
} from './saved-brand-fakes'

beforeEach(() => {
  queueBackgroundWork(setAdPackBackgroundScheduler)
})

afterEach(() => {
  restoreBackgroundWork()
  setDefaultAdPackService(null)
})

function savedEnv() {
  const db = fakeSavedBrandDb()
  const library = fakeLibrary(db)
  const env = createDoorEnv({ savedBrandDb: db, library })
  return { ...env, db, library, approvalStore: createMemoryMcpApprovalStore() }
}

const fact = (facts: DnaFact[], key: string) => facts.filter((f) => f.key === key)

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

describe('buildDnaFromSavedBrand: saved brand → BrandDna + offer', () => {
  it('maps business, primary kit, offer form and product photos; typed values are confirmed, stored analysis is not', async () => {
    const db = fakeSavedBrandDb()
    const res = await buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    const { dna, offer } = res

    expect(res).toMatchObject({ brandId: BIZ_A, offerId: PROD_A, brandKitId: KIT_A, websiteUrl: 'https://alba.example', costUsd: 0 })
    expect(dna.brandName).toBe('Alba Botánica Tica')
    expect(dna.language).toBe('es')
    expect(dna.category).toBe('beauty')
    expect(offer).toMatchObject({ productId: PROD_A, name: 'Sérum Niacinamida 30 ml' })

    // Owner-typed facts: confirmed, source offer_form.
    expect(fact(dna.facts, 'price')).toEqual([expect.objectContaining({ value: '₡12.900', source: 'offer_form', confirmed: true })])
    expect(fact(offer.facts, 'price')).toEqual([expect.objectContaining({ value: '₡12.900', confirmed: true })])
    expect(fact(dna.facts, 'shipping')[0]).toMatchObject({ value: 'Envíos a todo Costa Rica por Correos', confirmed: true })
    expect(fact(dna.facts, 'guarantee')[0]).toMatchObject({ value: 'Cambio si te da reacción en los primeros 15 días', confirmed: true })
    expect(fact(dna.facts, 'usage_steps')[0]).toMatchObject({ value: '2 gotas en la noche sobre piel limpia', confirmed: true })
    expect(fact(dna.facts, 'location')[0]).toMatchObject({ value: 'Heredia, Costa Rica', confirmed: true })
    expect(fact(dna.facts, 'custom:sales_channel').map((f) => f.value)).toEqual(['Tienda online', 'Pedidos por mensaje'])
    expect(dna.facts.filter((f) => f.source === 'offer_form').every((f) => f.confirmed)).toBe(true)

    // Inferred (stored site analysis): never confirmed; the conflicting website price is demoted.
    const inferred = dna.facts.filter((f) => f.source === 'website' || f.source === 'inferred')
    expect(inferred.length).toBeGreaterThan(0)
    expect(inferred.every((f) => !f.confirmed)).toBe(true)
    expect(dna.facts.find((f) => f.value === '₡9.900')).toMatchObject({ confirmed: false, source: 'website' })
    expect(dna.facts.find((f) => f.value === 'Reduce poros en 7 días')).toMatchObject({ confirmed: false })
    expect(dna.facts.filter((f) => f.confirmed).map((f) => f.value)).not.toContain('₡9.900')

    // Brand kit: voice, phrases, colors (kit wins over the site), fonts, logo, references.
    expect(dna.voice).toContain('cercana, clara, sin exageraciones')
    expect(dna.voice).toContain('cálida')
    expect(dna.forbiddenPhrases).toEqual(expect.arrayContaining(['piel perfecta', 'milagro']))
    expect(dna.mustUsePhrases).toEqual(['Hecho en Heredia'])
    expect(dna.visual).toMatchObject({
      primaryColor: '#1f6f5c',
      secondaryColor: '#f4ede4',
      accentColor: '#e07a5f',
      headingFont: 'Playfair Display',
      bodyFont: 'Inter',
      logoUrl: 'https://cdn.example/alba-logo.png',
    })
    expect(dna.visual.styleNotes).toContain('luz natural')
    expect(dna.oneLiner).toBe('Sérum facial de niacinamida y aloe hecho en Heredia')
    // #22: near-duplicate audiences from several sources collapse into the most specific line (max 3).
    expect(dna.audience).toContain('Mujeres de 25 a 40 con piel mixta')
    expect(dna.audience).not.toContain('Mujeres 25–40')
    expect(dna.audience!.length).toBeLessThanOrEqual(3)
    expect(dna.pains).toEqual(expect.arrayContaining(['poros abiertos que se notan en fotos', 'brillo en la zona T a media tarde']))
    expect(dna.objections).toEqual(['ya probé sérums y no noté nada'])

    // Real product photo first; generated and non-https skipped; context → style refs only.
    expect(offer.productImageUrls).toEqual(['https://cdn.example/serum.jpg'])
    expect(dna.productImageUrls).toEqual(['https://cdn.example/serum.jpg'])
    expect(dna.referenceImageUrls).toEqual(expect.arrayContaining(['https://cdn.example/ref-1.jpg', 'https://cdn.example/style-1.jpg', 'https://cdn.example/context.jpg']))
    expect(JSON.stringify(dna)).not.toContain('generated.png')

    // Gaps are computed on confirmed facts.
    expect(res.gaps).toEqual(dna.gaps)
    expect(res.gaps).not.toContain('price')
    expect(res.gaps).not.toContain('guarantee')
    expect(res.gaps).toEqual(expect.arrayContaining(['payment_methods', 'proof_review']))
    expect(res.notes.join('\n')).toContain('stored site analysis')
  })

  it('never invents a price from a price bucket; the price stays a gap and the copy prompt has no offer line', async () => {
    const db = fakeSavedBrandDb()
    const res = await buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A_BUCKET })
    expect(fact(res.offer.facts, 'price')).toEqual([])
    expect(res.dna.facts.filter((f) => f.key === 'price' && f.confirmed)).toEqual([])
    expect(res.gaps).toContain('price')
    expect(res.notes.join('\n')).toMatch(/"medio" is not a concrete amount/)
    const angle = { id: 'a01-x', archetype: 'venta_directa', hookType: 'pain', format: 'offer_graphic', message: 'm', target: 't', factKeys: [] } as const
    const prompt = buildCopyPrompt({ dna: res.dna, offer: res.offer, angle: { ...angle, factKeys: [] }, language: 'es' })
    expect(prompt.system).toContain('No hay precio/oferta confirmados')
    expect(prompt.user).not.toContain('₡9.900')
  })

  it('accepts only concrete prices', () => {
    expect(concretePrice('₡12.900')).toBe('₡12.900')
    expect(concretePrice('9900 CRC')).toBe('9900 CRC')
    expect(concretePrice('$25')).toBe('$25')
    expect(concretePrice('medio')).toBeUndefined()
    expect(concretePrice('premium')).toBeUndefined()
    expect(concretePrice('₡5.000–₡10.000')).toBeUndefined()
    expect(concretePrice('desde ₡5.000')).toBeUndefined()
    expect(concretePrice('consultar')).toBeUndefined()
    expect(concretePrice(null)).toBeUndefined()
  })

  it('uses an explicitly selected linked kit; an unlinked / foreign kit is NOT_FOUND', async () => {
    const db = fakeSavedBrandDb()
    const res = await buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A, brandKitId: KIT_A_OTHER })
    expect(res.brandKitId).toBe(KIT_A_OTHER)
    expect(res.dna.visual.primaryColor).toBe('#000000')
    await expect(buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A, brandKitId: '99999999-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it("is owner-scoped: another user's brand or offer is NOT_FOUND", async () => {
    const db = fakeSavedBrandDb()
    await expect(buildDnaFromSavedBrand({ db, userId: USER_B, brandId: BIZ_A })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_B })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A, offerId: PROD_B })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('defaults to the most recent offer and works without a kit or photos (with notes)', async () => {
    const db: FakeSavedDb = fakeSavedBrandDb()
    db.kits = []
    db.images = []
    const res = await buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A })
    expect(res.offerId).toBe(PROD_A)
    expect(res.brandKitId).toBeUndefined()
    expect(res.offer.productImageUrls).toEqual([])
    expect(res.notes.join('\n')).toMatch(/brand_kit: missing/)
    expect(res.notes.join('\n')).toMatch(/missing:product_photo/)
  })

  it('refresh re-reads the stored website only when asked', async () => {
    const db = fakeSavedBrandDb()
    const refreshWebsite = vi.fn(async (url: string) => ({
      source: 'website' as const,
      sourceEntry: { kind: 'website' as const, url, fetchedAt: '2026-10-08T00:00:00.000Z', ok: true },
      facts: [{ key: 'payment_methods' as const, value: 'SINPE Móvil', source: 'website' as const, confirmed: false }],
      visual: {},
      costUsd: 0.003,
    }))
    const plain = await buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A, refreshWebsite })
    expect(refreshWebsite).not.toHaveBeenCalled()
    expect(plain.costUsd).toBe(0)
    const fresh = await buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A, refresh: true, refreshWebsite })
    expect(refreshWebsite).toHaveBeenCalledWith('https://alba.example', 'es')
    expect(fresh.costUsd).toBe(0.003)
    expect(fresh.dna.facts.find((f) => f.key === 'payment_methods')).toMatchObject({ confirmed: false })
  })
})

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

describe('campaign brief', () => {
  it('is sanitized, capped at 500 chars and loses numbers no confirmed fact backs', () => {
    expect(sanitizeBrief('  Black <b>Friday</b>\n\n{focus} on `bundles`  ')).toBe('Black b Friday /b focus on bundles')
    expect(sanitizeBrief('x'.repeat(900))!.length).toBeLessThanOrEqual(500)
    expect(sanitizeBrief('   ')).toBeUndefined()
    const confirmed: DnaFact[] = [{ key: 'price', value: '₡12.900', source: 'offer_form', confirmed: true }]
    const out = briefForPrompt('Black Friday 50% off, ₡12.900, envío en 24 horas', confirmed)
    expect(out).toContain('Black Friday')
    expect(out).toContain('₡12.900')
    expect(out).not.toMatch(/50/)
    expect(out).not.toMatch(/24/)
  })

  it('reaches the angle-refinement prompt as campaignContext (direction only), never as a fact', async () => {
    const db = fakeSavedBrandDb()
    const { dna, offer } = await buildDnaFromSavedBrand({ db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    const angles = planAngles({ dna, offer, size: 3, language: 'es' })
    const calls: Array<{ system: string; user: string }> = []
    const gateway = {
      async json<T>(input: { system: string; user: string }) {
        calls.push(input)
        return { data: { angles: [] } as T, costUsd: 0, model: 'fake' }
      },
    } as unknown as ModelGateway
    await refineAnglesWithLlm({ gateway, angles, dna, offer, brief: 'Black Friday 70% en combos' })
    const payload = JSON.parse(calls[0].user) as { campaignContext?: string }
    expect(payload.campaignContext).toContain('Black Friday')
    expect(payload.campaignContext).not.toContain('70')
    expect(calls[0].system).toContain('campaignContext')
  })
})

// ---------------------------------------------------------------------------
// Doors: dna_from_brand / adpack_from_brand and start by brandId
// ---------------------------------------------------------------------------

async function pollWebUntilDone(packId: string, userId = USER_A): Promise<AdPackStatusResponse> {
  let last: AdPackStatusResponse | null = null
  for (let i = 0; i < 6; i++) {
    await drainBackground()
    const res = await callWeb(handler, userId, { action: 'status', packId })
    last = res.body as AdPackStatusResponse
    if (!last.moreWork) break
  }
  return last as AdPackStatusResponse
}

async function pollMcpUntilDone(env: ReturnType<typeof savedEnv>, packId: string) {
  let last: Record<string, unknown> = {}
  for (let i = 0; i < 6; i++) {
    await drainBackground()
    last = (await callMcp(env, USER_A, 'adpack_status', { packId })).payload
    if (!last.moreWork) break
  }
  return last
}

function structure(env: DoorEnv, packId: string) {
  const pack = env.store.packs.get(packId)!
  const items = [...env.store.items.values()].filter((i) => i.packId === packId).sort((a, b) => a.index - b.index)
  return {
    status: pack.status,
    size: pack.size,
    businessId: pack.businessId,
    brandKitId: pack.brandKitId,
    brief: pack.brief,
    dna: pack.dna,
    offer: pack.offer,
    items: items.map((i: PackItem) => ({ index: i.index, status: i.status, angle: i.angle, copy: i.copy, renders: i.renders.length })),
  }
}

describe('saved-brand doors (web + MCP parity)', () => {
  it('dna_from_brand and adpack_from_brand return the same DNA, offer, gaps and quote; no credits', async () => {
    const web = savedEnv()
    setDefaultAdPackService(web.service)
    const w = await callWeb(handler, USER_A, { action: 'dna_from_brand', brandId: BIZ_A, offerId: PROD_A })
    expect(w.statusCode).toBe(200)
    const mcp = savedEnv()
    const m = await callMcp(mcp, USER_A, 'adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A, includeDna: true })
    expect(m.isError).toBe(false)
    const wb = w.body as Record<string, unknown>
    for (const key of ['dna', 'offer', 'gaps', 'notes', 'brandId', 'offerId', 'brandKitId', 'quote']) {
      expect(m.payload[key]).toEqual(wb[key])
    }
    expect(m.payload.nextTool).toBe('adpack_start')
    expect(String(m.payload.nextStep)).toContain(BIZ_A)
    expect(web.charges).toHaveLength(0)
    expect(mcp.charges).toHaveLength(0)
  })

  it("rejects another user's brand through both doors (NOT_FOUND, no approval, no pack)", async () => {
    const web = savedEnv()
    setDefaultAdPackService(web.service)
    const w1 = await callWeb(handler, USER_B, { action: 'dna_from_brand', brandId: BIZ_A })
    expect(w1.statusCode).toBe(404)
    expect((w1.body as { code: string }).code).toBe('NOT_FOUND')
    const w2 = await callWeb(handler, USER_B, { action: 'start', brandId: BIZ_A, offerId: PROD_A, size: 3 })
    expect(w2.statusCode).toBe(404)
    const w3 = await callWeb(handler, USER_A, { action: 'start', brandId: BIZ_A, offerId: PROD_B, size: 3 })
    expect(w3.statusCode).toBe(404)
    expect(web.store.packs.size).toBe(0)

    const mcp = savedEnv()
    const m1 = await callMcp(mcp, USER_B, 'adpack_from_brand', { brandId: BIZ_A })
    expect(m1.isError).toBe(true)
    expect((m1.payload.error as { code: string }).code).toBe('NOT_FOUND')
    const m2 = await callMcp(mcp, USER_B, 'adpack_start', { brandId: BIZ_A, offerId: PROD_A, size: 3 })
    expect(m2.isError).toBe(true)
    expect((m2.payload.error as { code: string }).code).toBe('NOT_FOUND')
    expect(mcp.store.packs.size).toBe(0)
  })

  it('start {brandId, offerId, size, brief} builds DNA server-side, runs to done identically through both doors and saves renders to the offer library', async () => {
    const brief = 'Black Friday: enfocá en el combo de 2, tono urgente. 50% off'
    const args = { brandId: BIZ_A, offerId: PROD_A, size: 10, brief }

    // ---- web
    const web = savedEnv()
    setDefaultAdPackService(web.service)
    const wStart = await callWeb(handler, USER_A, { action: 'start', ...args })
    expect(wStart.statusCode).toBe(200)
    const wPackId = (wStart.body as { packId: string }).packId
    const wStatus = await pollWebUntilDone(wPackId)

    // ---- MCP: approval prompt names the offer, then confirm → start
    const mcp = savedEnv()
    const { prompt, started } = await mcpStartApproved(mcp, USER_A, args)
    expect(prompt.payload).toMatchObject({ status: 'approval_required', offerName: 'Sérum Niacinamida 30 ml', brandName: 'Alba Botánica Tica' })
    expect(String(prompt.payload.userPrompt)).toContain('10 anuncios')
    expect(started.isError).toBe(false)
    const mPackId = String(started.payload.packId)
    expect(String(started.payload.deepLink)).toContain(`brand=${BIZ_A}`)
    const mStatus = await pollMcpUntilDone(mcp, mPackId)

    // ---- parity of the planned/finished pack
    const wS = structure(web, wPackId)
    const mS = structure(mcp, mPackId)
    expect(mS).toEqual(wS)
    expect(wS).toMatchObject({ status: 'done', size: 10, businessId: BIZ_A, brandKitId: KIT_A })
    expect(wS.offer.productId).toBe(PROD_A)
    expect(wS.offer.productImageUrls[0]).toBe('https://cdn.example/serum.jpg')
    expect(wS.items.every((i) => i.status === 'done' && i.renders === 2)).toBe(true)

    // Exact product (default with a photo): the image model only draws product-free plates (never sees the
    // product), and every ad composites the real cut-out of the saved photo with a passing fidelity score.
    expect(web.gateway.sceneCalls.length).toBeGreaterThanOrEqual(10)
    expect(web.gateway.sceneCalls.every((c) => c.refs.length === 0)).toBe(true)
    for (const item of web.store.items.values()) {
      if (item.packId !== wPackId) continue
      expect(item.scene?.kind).toBe('plate')
      expect(item.scene?.cutouts?.[0]?.sourceUrl).toBe('https://cdn.example/serum.jpg')
      expect(item.fidelity).toMatchObject({ passed: true, method: 'composite' })
    }
    expect(web.store.packs.get(wPackId)?.render?.productFidelity).toBe('exact')

    // ---- brief: stored sanitized, in every copy prompt as context, never a fact
    expect(wS.brief).toBe(brief)
    const copyPrompts = web.gateway.jsonCalls.filter((c) => c.user.includes('CONTEXTO DE CAMPAÑA'))
    expect(copyPrompts.length).toBeGreaterThanOrEqual(10)
    for (const c of copyPrompts) {
      expect(c.user).toContain('Black Friday')
      expect(c.user).not.toContain('50%')
      const allowlist = c.user.split('HECHOS CONFIRMADOS')[1]?.split('\n\n')[0] ?? ''
      expect(allowlist).not.toContain('Black Friday')
    }
    expect(JSON.stringify(wS.dna.facts)).not.toContain('Black Friday')
    expect(JSON.stringify(wS.offer)).not.toContain('Black Friday')

    // ---- results usable without the web UI
    expect(wStatus).toMatchObject({ status: 'done', moreWork: false, businessId: BIZ_A, offerId: PROD_A })
    expect(wStatus.deepLink).toBe(`https://advanceai.studio/chat?brand=${BIZ_A}&adpack=${wPackId}`)
    expect(wStatus.items.every((i) => i.libraryImageIds?.length === 2)).toBe(true)
    expect(mStatus.deepLink).toBe(`https://advanceai.studio/chat?brand=${BIZ_A}&adpack=${mPackId}`)
    const deliverable = mStatus.deliverable as { ads: Array<{ caption: string; links: Record<string, string> }>; captionsText: string; deepLink: string }
    expect(deliverable.ads).toHaveLength(10)
    for (const r of deliverable.ads) {
      expect(Object.keys(r.links).sort()).toEqual(['4:5', '9:16'])
      expect(Object.values(r.links).every((u) => u.startsWith('https://'))).toBe(true)
      expect(r.caption.length).toBeGreaterThan(20)
    }
    expect(deliverable.deepLink).toBe(mStatus.deepLink)
    expect(deliverable.captionsText).toMatch(/^1\. Anuncio 1/)
    expect(deliverable.captionsText).toContain('\n\n10. Anuncio 10')
    expect(deliverable.captionsText).toContain(deliverable.ads[9].caption)
    // Web status carries the same deliverable shape (shared builder).
    expect(wStatus.deliverable!.ads).toHaveLength(10)
    expect(wStatus.deliverable!.deepLink).toBe(wStatus.deepLink)
    expect(wStatus.summary).toBe(mStatus.summary)
    expect(String(mStatus.instructionsForGrok)).toContain(String(mStatus.deepLink))

    // product_images rows: 10 ads × 2 ratios (feed + story default), kind generated, linked to the offer, per door.
    for (const env of [web, mcp]) {
      expect(env.library.rows).toHaveLength(20)
      expect(env.library.rows.every((r) => r.kind === 'generated' && r.productId === PROD_A && r.userId === USER_A)).toBe(true)
      expect(new Set(env.library.rows.map((r) => r.imageUrl)).size).toBe(20)
    }
    expect(web.charges).toHaveLength(10)
    expect(mcp.charges).toHaveLength(10)
  }, 60_000)

  it('library persistence is idempotent per item and saves an edited version once', async () => {
    const env = savedEnv()
    setDefaultAdPackService(env.service)
    const start = await callWeb(handler, USER_A, { action: 'start', brandId: BIZ_A, offerId: PROD_A, size: 3 })
    const packId = (start.body as { packId: string }).packId
    const done = await pollWebUntilDone(packId)
    expect(done.status).toBe('done')
    expect(env.library.rows).toHaveLength(6)
    const calls = env.library.calls

    // More polls / advances never duplicate rows nor call the library again.
    await pollWebUntilDone(packId)
    await callWeb(handler, USER_A, { action: 'status', packId })
    await env.service.advance({ userId: USER_A, packId })
    expect(env.library.rows).toHaveLength(6)
    expect(env.library.calls).toBe(calls)

    // A lost write (marker missing) is repaired without duplicating rows.
    const item0 = [...env.store.items.values()].find((i) => i.packId === packId && i.index === 0)!
    await env.store.updateItem(item0.id, { libraryImages: undefined })
    // The status read schedules the (idempotent) repair off-request.
    await callWeb(handler, USER_A, { action: 'status', packId })
    await drainBackground()
    const repaired = (await callWeb(handler, USER_A, { action: 'status', packId })).body as AdPackStatusResponse
    expect(env.library.rows).toHaveLength(6)
    expect(repaired.items[0].libraryImageIds).toHaveLength(2)

    // Free text edit re-renders: the new version is saved once (3 new rows), old rows kept.
    const edit = await callWeb(handler, USER_A, { action: 'edit_text', packId, itemId: item0.id, copy: { headline: 'Tu rutina de noche' } })
    expect(edit.statusCode).toBe(200)
    const edited = (edit.body as { item: { libraryImageIds: string[] } }).item
    expect(env.library.rows).toHaveLength(8)
    expect(edited.libraryImageIds).toHaveLength(2)
    await callWeb(handler, USER_A, { action: 'status', packId })
    expect(env.library.rows).toHaveLength(8)
  })

  it('keeps the dna/offer path working and never saves into an offer the user does not own', async () => {
    const env = savedEnv()
    setDefaultAdPackService(env.service)
    const own = await env.service.dnaFromBrand({ userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    // Offer claims a product of USER_B: the pack runs, the library refuses, nothing is saved.
    const start = await callWeb(handler, USER_A, { action: 'start', dna: own.dna, offer: { ...own.offer, productId: PROD_B }, size: 2 })
    expect(start.statusCode).toBe(200)
    const packId = (start.body as { packId: string }).packId
    const status = await pollWebUntilDone(packId)
    expect(status.status).toBe('done')
    expect(env.library.rows).toHaveLength(0)
    expect(status.items.every((i) => !i.libraryImageIds)).toBe(true)
  })

  it('rejects a non-string brief and needs either brandId or dna + offer', async () => {
    const env = savedEnv()
    await expect(env.service.startPack({ userId: USER_A, source: 'web', brandId: BIZ_A, brief: 42 })).rejects.toMatchObject({ code: 'BAD_INPUT' })
    await expect(env.service.startPack({ userId: USER_A, source: 'web' })).rejects.toMatchObject({ code: 'BAD_INPUT' })
    await expect(env.service.startPack({ userId: USER_A, source: 'web', brandId: 'not-a-uuid' })).rejects.toMatchObject({ code: 'BAD_INPUT' })
  })
})

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('MCP registry: adpack_from_brand + happy path descriptions', () => {
  it('lists adpack_from_brand as a free guide tool and documents the happy path and guarantees', () => {
    expect(getMcpTool('adpack_from_brand')).toMatchObject({ risk: 'guide', requiresApproval: false, consumesAdvanceCredits: false, enabled: true })
    expect(listEnabledMcpTools().map((t) => t.name)).toContain('adpack_from_brand')
    const fromBrand = getMcpTool('adpack_from_brand')!.description
    for (const step of ['list_brands', 'adpack_from_brand', 'adpack_start {brandId, offerId, size, brief?}', 'confirm', 'adpack_status', 'deepLink']) {
      expect(fromBrand).toContain(step)
    }
    expect(fromBrand).toMatch(/only confirmed facts are used for prices\/claims/i)
    const start = getMcpTool('adpack_start')!.description
    expect(start).toMatch(/only confirmed facts are used for prices\/claims/i)
    expect(start).toContain('real product photo')
    expect(start).toContain('rendered exactly')
    expect(start).toContain('~2 min per 10 ads')
    expect(start).toContain('brandId')
    expect(getMcpTool('adpack_status')!.description).toContain('deepLink')
    // Poll cadence, stop condition, deliverable presentation, no invented ids, price gap.
    const status = getMcpTool('adpack_status')!.description
    expect(status).toContain('~20-30 s')
    expect(status).toContain('STOP as soon as moreWork=false')
    expect(status).toContain('captionsText')
    expect(status).toContain('failures[]')
    expect(start).toMatch(/Never invent brandId, offerId or approvalRequestId/)
    expect(start).toContain('missingPrice')
    expect(fromBrand).toContain('missingPrice=true')
    expect(getMcpTool('adpack_regenerate')!.description).toContain('failures[].retry.call')
  })

  it('adpack_from_brand flags a missing price and tells Grok to ask the user before starting', async () => {
    const env = savedEnv()
    const priced = await callMcp(env, USER_A, 'adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A })
    expect(priced.payload.missingPrice).toBe(false)
    expect(String(priced.payload.nextStep)).not.toMatch(/^BEFORE starting/)
    const bucket = await callMcp(env, USER_A, 'adpack_from_brand', { brandId: BIZ_A, offerId: PROD_A_BUCKET })
    expect(bucket.payload.gaps).toContain('price')
    expect(bucket.payload.missingPrice).toBe(true)
    expect(String(bucket.payload.nextStep)).toMatch(/^BEFORE starting: tell the user the offer has no concrete price/)
    expect(String(bucket.payload.nextStep)).toContain(`offerId: "${PROD_A_BUCKET}"`)
  })
})
