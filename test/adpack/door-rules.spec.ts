/**
 * Door-level behaviour (web + MCP parity) for E1/E2 (edit rejections, forbidden hits),
 * G4/H6 (stable files per ratio, feed+story default, free resize) and G1 (create_ads routing).
 * Fakes only: no model calls, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/lib/auth')>()
  return {
    ...actual,
    requireAuth: vi.fn(async (req: { headers: Record<string, string | undefined> }) => {
      const m = /^Bearer test:(.+)$/.exec(req.headers.authorization ?? '')
      return m ? { id: m[1] } : null
    }),
  }
})

import handler, { setAdPackBackgroundScheduler } from '../../api/ad-pack'
import { setDefaultAdPackService } from '../../api/lib/adpack/service'
import type { AdPackStatusResponse } from '../../api/lib/adpack/http-types'
import { setMcpExecuteScheduler } from '../../api/lib/mcp/execute-job'
import { routeCreateAds } from '../../api/lib/mcp/create-ads'
import { PER_AD, USER_A, callMcp, callWeb, createDoorEnv, createMemoryMcpApprovalStore, mcpStartApproved, serum } from './door-harness'
import { BIZ_A, PROD_A, fakeLibrary, fakeSavedBrandDb } from './saved-brand-fakes'

beforeEach(() => {
  setAdPackBackgroundScheduler(() => {})
  setMcpExecuteScheduler(() => {})
})

afterEach(() => {
  setAdPackBackgroundScheduler(null)
  setDefaultAdPackService(null)
  setMcpExecuteScheduler((work) => {
    void work().catch(() => {})
  })
})

function env() {
  const e = { ...createDoorEnv(), approvalStore: createMemoryMcpApprovalStore() }
  setDefaultAdPackService(e.service)
  return e
}

/** Start via MCP (approved) and poll until finished; returns packId + final status payload. */
async function finishedPack(e: ReturnType<typeof env>, extra: Record<string, unknown> = {}) {
  const { started } = await mcpStartApproved(e, USER_A, { dna: serum.dna, offer: serum.offer, size: 2, ...extra })
  const packId = String(started.payload.packId)
  let status = await callMcp(e, USER_A, 'adpack_status', { packId })
  for (let i = 0; i < 5 && status.payload.moreWork; i++) status = await callMcp(e, USER_A, 'adpack_status', { packId })
  return { packId, status }
}

describe('G4 + H6: feed + story by default, stable files per ratio', () => {
  it('deliverable files carry ratio, url, width, height, format and placement; default ratios 4:5 + 9:16', async () => {
    const e = env()
    const { status } = await finishedPack(e)
    expect(status.payload.status).toBe('done')
    const ads = (status.payload.deliverable as { ads: Array<{ files: Array<Record<string, unknown>>; forbiddenHits: unknown[]; links: Record<string, string> }> }).ads
    expect(ads).toHaveLength(2)
    for (const ad of ads) {
      expect(Object.keys(ad.links)).toEqual(['4:5', '9:16'])
      expect(ad.files).toEqual([
        { ratio: '4:5', url: expect.stringMatching(/^https:\/\/storage\.test\/.*\.png$/), jpgUrl: expect.stringMatching(/^https:\/\/storage\.test\/.*\.jpg$/), width: 1080, height: 1350, format: 'png', placement: 'feed' },
        { ratio: '9:16', url: expect.stringMatching(/^https:\/\/storage\.test\/.*\.png$/), jpgUrl: expect.stringMatching(/^https:\/\/storage\.test\/.*\.jpg$/), width: 1080, height: 1920, format: 'png', placement: 'story' },
      ])
      // Public storage URLs, never signed / expiring.
      expect(ad.files.every((f) => !/token=|X-Amz-|sign/i.test(`${String(f.url)} ${String(f.jpgUrl)}`))).toBe(true)
      expect(ad.forbiddenHits).toEqual([])
    }
  })

  it('adpack_resize adds 1:1 for free (renderer only) — same through the web door', async () => {
    const e = env()
    const { packId, status } = await finishedPack(e)
    const itemId = (status.payload.deliverable as { ads: Array<{ itemId: string }> }).ads[0].itemId
    const modelCalls = e.gateway.totalCalls()
    const charges = e.charges.length
    const renders = e.renderer.calls.length

    const mcp = await callMcp(e, USER_A, 'adpack_resize', { packId, itemId, ratios: ['1:1'] })
    expect(mcp.isError).toBe(false)
    expect(mcp.payload).toMatchObject({ status: 'resized', added: ['1:1'], chargedCredits: 0 })
    const rendersAfter = (mcp.payload.item as { renders: Array<{ ratio: string; width: number; height: number; format: string }> }).renders
    expect(rendersAfter.map((r) => r.ratio)).toEqual(['4:5', '9:16', '1:1'])
    expect(rendersAfter[2]).toMatchObject({ width: 1080, height: 1080, format: 'png' })
    expect(e.renderer.calls.length).toBe(renders + 1)
    expect(e.gateway.totalCalls()).toBe(modelCalls)
    expect(e.charges.length).toBe(charges)
    expect(e.renderer.calls.at(-1)).toMatchObject({ ratio: '1:1', sceneImage: expect.stringMatching(/^https:\/\//) })

    // Web door: same service; ratios already there → nothing re-rendered.
    const web = await callWeb(handler, USER_A, { action: 'resize', packId, itemId, ratios: ['1:1', '9:16'] })
    expect(web.statusCode).toBe(200)
    expect(web.body).toMatchObject({ added: [], chargedCredits: 0 })
    expect(e.renderer.calls.length).toBe(renders + 1)

    // The finished deliverable now lists the new square file too.
    const after = await callMcp(e, USER_A, 'adpack_status', { packId })
    const ad = (after.payload.deliverable as { ads: Array<{ itemId: string; files: Array<{ ratio: string }> }> }).ads.find((a) => a.itemId === itemId)!
    expect(ad.files.map((f) => f.ratio)).toEqual(['4:5', '9:16', '1:1'])
  })

  it('resize rejects unknown ratios and unfinished ads', async () => {
    const e = env()
    const { packId, status } = await finishedPack(e)
    const itemId = (status.payload.deliverable as { ads: Array<{ itemId: string }> }).ads[0].itemId
    const bad = await callMcp(e, USER_A, 'adpack_resize', { packId, itemId, ratios: ['2:3'] }) // 16:9 is valid since WS1
    expect(bad.isError).toBe(true)
    expect((bad.payload.error as { code: string }).code).toBe('BAD_INPUT')
  })
})

describe('E1: edit rejections explain field, rule, limit, actual (web = MCP)', () => {
  it('same issues through both doors; MCP answers status=rejected instead of a bare error', async () => {
    const e = env()
    const { packId, status } = await finishedPack(e)
    const itemId = (status.payload.deliverable as { ads: Array<{ itemId: string }> }).ads[0].itemId
    const copy = { bullets: ['Niacinamida 5%', 'Se absorbe rápido', 'Textura ligera que se absorbe muy rápido de noche'], headline: 'Solo ₡1.000 hoy' }

    const mcp = await callMcp(e, USER_A, 'adpack_edit_text', { packId, itemId, copy })
    expect(mcp.isError).toBe(false)
    expect(mcp.payload).toMatchObject({ status: 'rejected', code: 'COPY_REJECTED', chargedCredits: 0 })
    const issues = mcp.payload.issues as Array<Record<string, unknown>>
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'bullets[2]', rule: 'too_long', limit: 6, actual: 8 }),
      expect.objectContaining({ field: 'headline', rule: 'number_mismatch', token: '1.000' }),
    ]))
    expect(String(mcp.payload.message)).toMatch(/headline: number_mismatch|bullets\[2\]: too_long/)

    const web = await callWeb(handler, USER_A, { action: 'edit_text', packId, itemId, copy })
    expect(web.statusCode).toBe(422)
    expect((web.body as { issues: unknown[] }).issues).toEqual(issues)
  })
})

describe('E2: forbidden phrases verified per ad', () => {
  it('generation runs two free repair rounds; an ad that still contains the phrase fails with a plain reason and is not charged', async () => {
    const e = env()
    // The fake copy model always writes "pedí el tuyo" in the caption.
    const { status } = await finishedPack(e, { forbiddenPhrases: ['pedí el tuyo'] })
    expect(status.payload.status).toBe('failed')
    const failures = status.payload.failures as Array<{ reason: string }>
    expect(failures).toHaveLength(2)
    expect(failures[0].reason).toBe('el texto usaba una frase prohibida de la marca')
    // generate + two free repair rounds per ad (P0 #2b), then no scene / no charge.
    expect(e.gateway.jsonCalls.length).toBe(6)
    expect(e.gateway.sceneCalls).toHaveLength(0)
    expect(e.charges).toHaveLength(0)
  })

  it('an owner edit that adds a forbidden claim is rejected with the field and phrase', async () => {
    const e = env()
    const { packId, status } = await finishedPack(e, { forbiddenClaims: ['resultados garantizados'] })
    const itemId = (status.payload.deliverable as { ads: Array<{ itemId: string }> }).ads[0].itemId
    const res = await callMcp(e, USER_A, 'adpack_edit_text', { packId, itemId, copy: { caption: `${'Piel suave cada noche, con aloe vera y sin sensación pegajosa.'} Resultados garantizados.` } })
    expect(res.payload.status).toBe('rejected')
    expect(res.payload.issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'caption', rule: 'forbidden_phrase', token: 'resultados garantizados' })]))
  })

  it('web status rows expose forbiddenHits (verified empty for shipped ads)', async () => {
    const e = env()
    const { packId } = await finishedPack(e, { forbiddenPhrases: ['milagroso'] })
    const web = await callWeb(handler, USER_A, { action: 'status', packId })
    const body = web.body as AdPackStatusResponse
    expect(body.items.every((i) => Array.isArray(i.forbiddenHits) && i.forbiddenHits.length === 0)).toBe(true)
  })
})

describe('G1: create_ads routes to the existing tools with the same approval', () => {
  it('mode pack → adpack_start; the create_ads retry with approvalRequestId runs exactly `count` ads', async () => {
    const e = env()
    const args = { brandId: undefined, mode: 'pack', count: 2 }
    // dna/offer path is not part of create_ads (saved brands only) — route check first.
    expect(routeCreateAds({ brandId: 'b1', offerId: 'o1', mode: 'pack', count: 2, brief: 'Día del Padre' })).toEqual({
      mode: 'pack',
      tool: 'adpack_start',
      args: { brandId: 'b1', offerId: 'o1', size: 2, brief: 'Día del Padre' },
    })
    const missing = await callMcp(e, USER_A, 'create_ads', args)
    expect(missing.isError).toBe(true)
    expect((missing.payload.error as { code: string }).code).toBe('BAD_INPUT')
  })

  it('maps single / carousel / edit and rejects inconsistent input before any approval', () => {
    expect(routeCreateAds({ brandId: 'b1', mode: 'single', ratios: ['1:1'] })).toMatchObject({ tool: 'adpack_start', args: { size: 1, ratios: ['1:1'] } })
    expect(() => routeCreateAds({ brandId: 'b1', mode: 'single', count: 2 })).toThrow(/exactly 1/)
    expect(routeCreateAds({ brandId: 'b1', mode: 'carousel', count: 4, ratios: ['4:5'], scriptId: 's1', brief: 'Minimal, navy' })).toEqual({
      mode: 'carousel',
      tool: 'execute_carousel_generate',
      args: { brandId: 'b1', slideCount: 4, aspectRatio: '4:5', designDirection: 'Minimal, navy', scriptId: 's1' },
    })
    expect(() => routeCreateAds({ brandId: 'b1', mode: 'carousel', ratios: ['4:5', '9:16'], scriptId: 's1' })).toThrow(/one ratio/)
    expect(() => routeCreateAds({ brandId: 'b1', mode: 'carousel' })).toThrow(/scriptId/)
    expect(routeCreateAds({ brandId: 'b1', mode: 'edit', productImageId: 'img1', brief: 'Fondo navy, luz cálida' })).toEqual({
      mode: 'edit',
      tool: 'execute_image_edit',
      args: { brandId: 'b1', editPrompt: 'Fondo navy, luz cálida', productImageId: 'img1' },
    })
    expect(() => routeCreateAds({ brandId: 'b1', mode: 'edit', brief: 'x' })).toThrow(/productImageId or imageUrl/)
    expect(() => routeCreateAds({ brandId: 'b1', mode: 'banner' })).toThrow(/mode must be/)
    // Pack mode forwards the WS2 adpack_start options (photo pool, chat corrections) unchanged.
    expect(routeCreateAds({
      brandId: 'b1', mode: 'pack', count: 2, productImageIds: ['p1', 'p2'], productImageIdsByAd: { '1': ['p2'] },
      saveToOffer: true, offerPatch: { excludes: ['Papel no incluido'] },
    }).args).toEqual({
      brandId: 'b1', size: 2, productImageIds: ['p1', 'p2'], productImageIdsByAd: { '1': ['p2'] },
      saveToOffer: true, offerPatch: { excludes: ['Papel no incluido'] },
    })
    // Same create_ads args → same routed args (the approval hash stays stable on retry).
    const a = routeCreateAds({ brandId: 'b1', mode: 'pack', count: 3, approvalRequestId: 'r1' })
    expect(a.args).toEqual({ brandId: 'b1', size: 3, approvalRequestId: 'r1' })
  })

  it('pack through create_ads (saved brand): approval under adpack_start, create_ads retry runs exactly `count` ads in es-CR voseo', async () => {
    const db = fakeSavedBrandDb()
    const e = { ...createDoorEnv({ savedBrandDb: db, library: fakeLibrary(db) }), approvalStore: createMemoryMcpApprovalStore() }
    const args = { brandId: BIZ_A, offerId: PROD_A, mode: 'pack', count: 2, locale: 'es-CR' }
    const prompt = await callMcp(e, USER_A, 'create_ads', args)
    expect(prompt.payload).toMatchObject({ status: 'approval_required', toolName: 'adpack_start', via: 'create_ads', routedTo: 'adpack_start', mode: 'pack' })
    expect(prompt.payload.approval).toMatchObject({ items: 2, unitCost: PER_AD, total: 2 * PER_AD })
    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await callMcp(e, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const started = await callMcp(e, USER_A, 'create_ads', { ...args, approvalRequestId })
    expect(started.payload).toMatchObject({ status: 'completed', packId: approvalRequestId, via: 'create_ads', quote: { size: 2 } })
    const pack = e.store.packs.get(approvalRequestId)!
    expect(pack.size).toBe(2)
    expect(pack.ratios).toEqual(['4:5', '9:16'])
    expect(pack.dna).toMatchObject({ locale: 'es-CR', register: 'voseo' })
  })
})
