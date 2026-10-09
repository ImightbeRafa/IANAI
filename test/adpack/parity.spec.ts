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
import { setDefaultAdPackService } from '../../api/lib/adpack/service'
import type { AdPackStatusResponse } from '../../api/lib/adpack/http-types'
import type { PackItem } from '../../api/lib/adpack/types'
import { listEnabledMcpTools, getMcpTool, MCP_REGISTRY_VERSION } from '../../api/lib/mcp/tool-registry'
import { handleMcpJsonRpc, MCP_SERVER_INFO } from '../../api/lib/mcp/protocol'
import { setMcpExecuteScheduler } from '../../api/lib/mcp/execute-job'
import {
  PER_AD,
  USER_A,
  USER_B,
  callMcp,
  callWeb,
  createDoorEnv,
  createMemoryMcpApprovalStore,
  mcpDb,
  mcpStartApproved,
  mockReqRes,
  serum,
  type DoorEnv,
} from './door-harness'

let webBackground: Array<() => Promise<unknown>> = []
let mcpBackground: Array<() => Promise<void>> = []

beforeEach(() => {
  webBackground = []
  mcpBackground = []
  // Background work is captured, never run implicitly: progress must come from polls.
  setAdPackBackgroundScheduler((work) => {
    webBackground.push(work)
  })
  setMcpExecuteScheduler((work) => {
    mcpBackground.push(work)
  })
})

afterEach(() => {
  setAdPackBackgroundScheduler(null)
  setDefaultAdPackService(null)
  setMcpExecuteScheduler((work) => {
    void work().catch(() => {})
  })
})

function webEnv(options: { credits?: number } = {}) {
  const env = createDoorEnv(options)
  setDefaultAdPackService(env.service)
  return env
}

function mcpEnv(options: { credits?: number } = {}) {
  const env = createDoorEnv(options)
  return { ...env, approvalStore: createMemoryMcpApprovalStore() }
}

/** Pack structure without per-pack ids / URLs / timestamps. */
function structure(env: DoorEnv, packId: string) {
  const pack = env.store.packs.get(packId)!
  const items = [...env.store.items.values()].filter((i) => i.packId === packId).sort((a, b) => a.index - b.index)
  return {
    status: pack.status,
    size: pack.size,
    ratios: pack.ratios,
    quotedCredits: pack.quotedCredits,
    dna: pack.dna,
    offer: pack.offer,
    items: items.map((i: PackItem) => ({
      index: i.index,
      status: i.status,
      angle: i.angle,
      copy: i.copy,
      renders: i.renders.map((r) => ({ ratio: r.ratio, width: r.width, height: r.height })),
      attempts: i.attempts,
      charged: Boolean(i.chargedAt),
      productLocked: i.scene?.productLocked,
    })),
  }
}

const startArgs = (dna: unknown) => ({ dna, offer: serum.offer, size: 10, ratios: ['1:1', '4:5', '9:16'] })

describe('ad pack parity: web handler vs MCP dispatch', () => {
  it('produces identical DNA, angles, packs, progress, renders, credits and edits through both doors', async () => {
    // ---- web door
    const web = webEnv()
    const wIngest = await callWeb(handler, USER_A, { action: 'dna_ingest', websiteUrl: 'serum.example' })
    expect(wIngest.statusCode).toBe(200)
    const wDna = (wIngest.body as { dna: unknown }).dna
    const wConfirm = await callWeb(handler, USER_A, { action: 'dna_confirm', dna: wDna, edits: [{ op: 'add', key: 'custom:tagline', value: 'Piel suave cada noche' }] })
    const wDna2 = (wConfirm.body as { dna: unknown }).dna
    const wAngles = await callWeb(handler, USER_A, { action: 'angles', dna: wDna2, offer: serum.offer, size: 10 })
    const wQuote = await callWeb(handler, USER_A, { action: 'quote', dna: wDna2, offer: serum.offer, size: 10 })
    const wStart = await callWeb(handler, USER_A, { action: 'start', ...startArgs(wDna2) })
    expect(wStart.statusCode).toBe(200)
    const wPackId = (wStart.body as { packId: string }).packId
    expect(webBackground).toHaveLength(1) // scheduled, but dropped
    const wPlanned = structure(web, wPackId)
    const wStatus1 = await callWeb(handler, USER_A, { action: 'status', packId: wPackId })
    const wStatus2 = await callWeb(handler, USER_A, { action: 'status', packId: wPackId })
    const wItem0 = (wStatus2.body as AdPackStatusResponse).items[0]
    const wEdit = await callWeb(handler, USER_A, { action: 'edit_text', packId: wPackId, itemId: wItem0.id, copy: { headline: 'Piel suave cada noche' } })
    expect(wEdit.statusCode).toBe(200)

    // ---- MCP door
    const mcp = mcpEnv()
    const mIngest = await callMcp(mcp, USER_A, 'adpack_dna_ingest', { websiteUrl: 'serum.example' })
    expect(mIngest.isError).toBe(false)
    const mConfirm = await callMcp(mcp, USER_A, 'adpack_dna_confirm', { dna: mIngest.payload.dna, edits: [{ op: 'add', key: 'custom:tagline', value: 'Piel suave cada noche' }] })
    const mDna2 = mConfirm.payload.dna
    const mAngles = await callMcp(mcp, USER_A, 'adpack_angles', { dna: mDna2, offer: serum.offer, size: 10 })
    const mQuote = await callMcp(mcp, USER_A, 'adpack_quote', { dna: mDna2, offer: serum.offer, size: 10 })
    const { started } = await mcpStartApproved(mcp, USER_A, startArgs(mDna2))
    expect(started.isError).toBe(false)
    const mPackId = String(started.payload.packId)
    expect(mcpBackground).toHaveLength(1)
    const mPlanned = structure(mcp, mPackId)
    const mStatus1 = await callMcp(mcp, USER_A, 'adpack_status', { packId: mPackId })
    const mStatus2 = await callMcp(mcp, USER_A, 'adpack_status', { packId: mPackId })
    const mItem0 = (mStatus2.payload.deliverable as { ads: Array<{ itemId: string }> }).ads[0]
    const mEdit = await callMcp(mcp, USER_A, 'adpack_edit_text', { packId: mPackId, itemId: mItem0.itemId, copy: { headline: 'Piel suave cada noche' } })
    expect(mEdit.isError).toBe(false)

    // ---- parity
    expect(mIngest.payload.dna).toEqual(wDna)
    expect(mDna2).toEqual(wDna2)
    expect(mAngles.payload.angles).toEqual((wAngles.body as { angles: unknown }).angles)
    expect({ size: mQuote.payload.size, credits: mQuote.payload.credits, perAd: mQuote.payload.perAd, angleIds: mQuote.payload.angleIds }).toEqual(wQuote.body)
    expect(wQuote.body).toMatchObject({ size: 10, credits: 10 * PER_AD, perAd: PER_AD })
    expect((wQuote.body as { angleIds: string[] }).angleIds).toHaveLength(10)
    expect((started.payload.quote as { credits: number }).credits).toBe((wStart.body as { quote: { credits: number } }).quote.credits)

    // Same planned structure (pack created from the same inputs).
    expect(mPlanned).toEqual(wPlanned)
    expect(wPlanned.items.every((i) => i.status === 'planned')).toBe(true)

    // Same status progression (poll-driven: background work never ran).
    const w1 = wStatus1.body as AdPackStatusResponse
    const w2 = wStatus2.body as AdPackStatusResponse
    expect(w1.progress).toEqual(mStatus1.payload.progress)
    expect(w2.progress).toEqual(mStatus2.payload.progress)
    // Shared builder: identical summary / deliverable through both doors (ids and URLs differ per pack).
    const scrub = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'ID').replace(/https:\/\/[^"]+/g, 'URL'))
    expect(mStatus1.payload.summary).toBe(w1.summary)
    expect(w1.summary).toBe('10/10 listos · pack terminado')
    expect(scrub(mStatus1.payload.deliverable)).toEqual(scrub(w1.deliverable))
    expect(w1.deliverable!.ads.map((a) => a.headline)).toEqual(w1.items.map((i) => i.headline))
    expect(mStatus1.payload.items).toBeUndefined() // finished: the deliverable replaces per-ad rows
    expect(w2.status).toBe('done')
    expect(mStatus2.payload.status).toBe('done')
    expect(w2.moreWork).toBe(false)
    expect(mStatus2.payload.moreWork).toBe(false)
    expect(w2.chargedCredits).toBe(mStatus2.payload.chargedCredits)

    // Same final pack (minus the edit), same renders, same credits.
    const wFinal = structure(web, wPackId)
    const mFinal = structure(mcp, mPackId)
    expect(mFinal).toEqual(wFinal)
    expect(wFinal.items.reduce((s, i) => s + i.renders.length, 0)).toBe(30)
    expect(web.storage.uploads.length).toBe(mcp.storage.uploads.length)
    expect(web.charges).toHaveLength(10)
    expect(mcp.charges).toHaveLength(10)
    expect(web.charges.every((c) => c.source === 'web' && c.packId === wPackId)).toBe(true)
    expect(mcp.charges.every((c) => c.source === 'mcp' && c.packId === mPackId)).toBe(true)
    expect(web.credits.remaining).toBe(mcp.credits.remaining)
    expect(web.store.packs.get(wPackId)!.source).toBe('web')
    expect(mcp.store.packs.get(mPackId)!.source).toBe('mcp')
    // Usage logged per charged ad with the door as source.
    expect(web.logs.filter((l) => l.feature === 'image')).toHaveLength(10)
    expect(mcp.logs.filter((l) => l.feature === 'image').every((l) => l.source === 'mcp')).toBe(true)

    // Same edit-text result (free: no new charges).
    const wEdited = (wEdit.body as { item: { headline: string; renders: unknown[]; status: string } }).item
    const mEdited = mEdit.payload.item as { headline: string; renders: unknown[]; status: string }
    expect(mEdited.headline).toBe(wEdited.headline)
    expect(wEdited.headline).toBe('Piel suave cada noche')
    expect(mEdited.renders.length).toBe(wEdited.renders.length)
    expect(mEdit.payload.copy).toEqual((wEdit.body as { item: { copy: unknown } }).item.copy)
    expect(web.charges).toHaveLength(10)
    expect(mcp.charges).toHaveLength(10)
    expect(structure(mcp, mPackId)).toEqual(structure(web, wPackId))
  })
})

describe('POST /api/ad-pack', () => {
  it('handles CORS preflight and requires auth', async () => {
    webEnv()
    const pre = mockReqRes({ method: 'OPTIONS', userId: null })
    await handler(pre.req, pre.res)
    expect(pre.state.statusCode).toBe(200)
    expect(pre.state.headers['Access-Control-Allow-Origin']).toBe('*')

    const anon = await callWeb(handler, null, { action: 'quote', size: 10 })
    expect(anon.statusCode).toBe(401)
  })

  it('rejects unknown actions and bad input with BAD_INPUT', async () => {
    webEnv()
    const unknown = await callWeb(handler, USER_A, { action: 'explode' })
    expect(unknown.statusCode).toBe(400)
    expect((unknown.body as { code: string }).code).toBe('BAD_INPUT')
    const noDna = await callWeb(handler, USER_A, { action: 'start', offer: serum.offer })
    expect(noDna.statusCode).toBe(400)
    expect((noDna.body as { code: string }).code).toBe('BAD_INPUT')
    const badRatio = await callWeb(handler, USER_A, { action: 'start', dna: serum.dna, offer: serum.offer, ratios: ['16:9'] })
    expect((badRatio.body as { code: string }).code).toBe('BAD_INPUT')
    const noSource = await callWeb(handler, USER_A, { action: 'dna_ingest' })
    expect((noSource.body as { code: string }).code).toBe('BAD_INPUT')
  })

  it("enforces ownership: another user's packId is NOT_FOUND", async () => {
    const env = webEnv()
    const start = await callWeb(handler, USER_A, { action: 'start', ...startArgs(serum.dna) })
    const packId = (start.body as { packId: string }).packId
    for (const action of ['status', 'cancel']) {
      const res = await callWeb(handler, USER_B, { action, packId })
      expect(res.statusCode).toBe(404)
      expect((res.body as { code: string }).code).toBe('NOT_FOUND')
    }
    const itemId = [...env.store.items.values()][0].id
    const edit = await callWeb(handler, USER_B, { action: 'edit_text', packId, itemId, copy: { headline: 'Hola' } })
    expect(edit.statusCode).toBe(404)
    const regen = await callWeb(handler, USER_B, { action: 'regenerate', packId, itemId })
    expect(regen.statusCode).toBe(404)
    const garbage = await callWeb(handler, USER_A, { action: 'status', packId: 'not-a-uuid' })
    expect(garbage.statusCode).toBe(404)
    expect(env.store.packs.get(packId)!.status).toBe('planned')
    expect(env.gateway.totalCalls()).toBe(0)
  })

  it('returns INSUFFICIENT_CREDITS before creating a pack', async () => {
    const env = webEnv({ credits: 5 * PER_AD })
    const res = await callWeb(handler, USER_A, { action: 'start', ...startArgs(serum.dna) })
    expect(res.statusCode).toBe(402)
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_CREDITS', creditsRequired: 10 * PER_AD, remaining: 5 * PER_AD })
    expect(env.store.packs.size).toBe(0)
    expect(webBackground).toHaveLength(0)
  })

  it('status advances progress even when background work never ran', async () => {
    const env = webEnv()
    const start = await callWeb(handler, USER_A, { action: 'start', ...startArgs(serum.dna) })
    const packId = (start.body as { packId: string }).packId
    expect(webBackground).toHaveLength(1)
    expect(env.gateway.totalCalls()).toBe(0)
    const status = await callWeb(handler, USER_A, { action: 'status', packId })
    const body = status.body as AdPackStatusResponse
    expect(body.progress.done).toBe(10)
    expect(body.status).toBe('done')
    expect(body.items.every((i) => i.renders.length === 3 && i.charged)).toBe(true)
    expect(body.chargedCredits).toBe(10 * PER_AD)
    // Nothing left to do → no further background scheduling.
    expect(webBackground).toHaveLength(1)
  })

  it('status does not run inline while another worker holds a lease; background work completes the pack', async () => {
    const env = webEnv()
    const start = await callWeb(handler, USER_A, { action: 'start', ...startArgs(serum.dna) })
    const packId = (start.body as { packId: string }).packId
    const future = new Date(Date.now() + 60_000).toISOString()
    for (const item of env.store.items.values()) item.leaseUntil = future
    const leased = await callWeb(handler, USER_A, { action: 'status', packId })
    expect((leased.body as AdPackStatusResponse).leaseActive).toBe(true)
    expect((leased.body as AdPackStatusResponse).progress.done).toBe(0)
    expect(env.gateway.totalCalls()).toBe(0)
    for (const item of env.store.items.values()) delete item.leaseUntil
    await Promise.all(webBackground.map((w) => w()))
    expect(env.store.packs.get(packId)!.status).toBe('done')
  })

  it('cancel stops the pack', async () => {
    const env = webEnv()
    const start = await callWeb(handler, USER_A, { action: 'start', ...startArgs(serum.dna) })
    const packId = (start.body as { packId: string }).packId
    const cancel = await callWeb(handler, USER_A, { action: 'cancel', packId })
    expect(cancel.body).toEqual({ packId, status: 'cancelled' })
    const status = await callWeb(handler, USER_A, { action: 'status', packId })
    const body = status.body as AdPackStatusResponse
    expect(body.status).toBe('cancelled')
    expect(body.moreWork).toBe(false)
    await Promise.all(webBackground.map((w) => w()))
    expect(env.gateway.totalCalls()).toBe(0)
    expect(env.charges).toHaveLength(0)
  })

  it('regenerate checks credits, resets one ad and charges it once more', async () => {
    const env = webEnv()
    const start = await callWeb(handler, USER_A, { action: 'start', ...startArgs(serum.dna) })
    const packId = (start.body as { packId: string }).packId
    const done = (await callWeb(handler, USER_A, { action: 'status', packId })).body as AdPackStatusResponse
    const target = done.items[3]
    const regen = await callWeb(handler, USER_A, { action: 'regenerate', packId, itemId: target.id, mode: 'scene' })
    expect(regen.statusCode).toBe(200)
    expect(regen.body).toMatchObject({ item: { status: 'copy_ready', attempts: 1, charged: false }, quote: { size: 1, credits: PER_AD } })
    const after = (await callWeb(handler, USER_A, { action: 'status', packId })).body as AdPackStatusResponse
    expect(after.status).toBe('done')
    expect(env.charges).toHaveLength(11)

    env.credits.remaining = 0
    const broke = await callWeb(handler, USER_A, { action: 'regenerate', packId, itemId: target.id })
    expect(broke.statusCode).toBe(402)
  })

  it('edit_text rejects unrendered ads and copy that breaks the rules', async () => {
    const env = webEnv()
    const start = await callWeb(handler, USER_A, { action: 'start', ...startArgs(serum.dna) })
    const packId = (start.body as { packId: string }).packId
    const itemId = [...env.store.items.values()][0].id
    const early = await callWeb(handler, USER_A, { action: 'edit_text', packId, itemId, copy: { headline: 'Hola' } })
    expect(early.statusCode).toBe(409)
    expect((early.body as { code: string }).code).toBe('NOT_READY')
    await callWeb(handler, USER_A, { action: 'status', packId })
    const lie = await callWeb(handler, USER_A, { action: 'edit_text', packId, itemId, copy: { headline: 'Solo ₡1.000 hoy' } })
    expect(lie.statusCode).toBe(422)
    expect((lie.body as { code: string; issues: unknown[] }).code).toBe('COPY_REJECTED')
    expect((lie.body as { issues: unknown[] }).issues.length).toBeGreaterThan(0)
  })
})

describe('MCP adpack_* tools', () => {
  it('registers the new tools at 0.10.0 and keeps existing ones', async () => {
    expect(MCP_REGISTRY_VERSION).toBe('0.10.0')
    expect(MCP_SERVER_INFO.version).toBe('0.10.0')
    expect(getMcpTool('adpack_start')).toMatchObject({ risk: 'execute', requiresApproval: true, consumesAdvanceCredits: true })
    expect(getMcpTool('adpack_regenerate')).toMatchObject({ risk: 'execute', requiresApproval: true, consumesAdvanceCredits: true })
    expect(getMcpTool('adpack_dna_ingest')).toMatchObject({ risk: 'guide', requiresApproval: false, consumesAdvanceCredits: false })
    expect(getMcpTool('adpack_dna_confirm')?.risk).toBe('sync_write')
    expect(getMcpTool('adpack_angles')?.risk).toBe('guide')
    expect(getMcpTool('adpack_status')?.risk).toBe('read')
    expect(getMcpTool('adpack_edit_text')).toMatchObject({ risk: 'sync_write', consumesAdvanceCredits: false })
    const listed = await handleMcpJsonRpc({ body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, user: { id: USER_A }, db: mcpDb })
    const tools = (listed.result as { tools: Array<{ name: string; inputSchema: { required?: string[] } }> }).tools
    const names = tools.map((t) => t.name)
    for (const name of ['adpack_from_brand', 'adpack_dna_ingest', 'adpack_dna_confirm', 'adpack_angles', 'adpack_quote', 'adpack_start', 'adpack_status', 'adpack_edit_text', 'adpack_regenerate']) {
      expect(names).toContain(name)
    }
    expect(names).toContain('execute_campaign_pack')
    expect(names).toContain('confirm_execute')
    // adpack_start takes either brandId (+ offerId) or dna + offer: neither pair is schema-required.
    expect(tools.find((t) => t.name === 'adpack_start')?.inputSchema.required).toBeUndefined()
    expect(tools.find((t) => t.name === 'adpack_status')?.inputSchema.required).toEqual(['packId'])
    expect(listEnabledMcpTools().filter((t) => t.name.startsWith('adpack_'))).toHaveLength(10)
    expect(names).toContain('adpack_resize')
    expect(names).toContain('create_ads')
  })

  it('adpack_start requires in-chat approval; after confirm it returns packId and is idempotent', async () => {
    const env = mcpEnv()
    const args = startArgs(serum.dna)
    const prompt = await callMcp(env, USER_A, 'adpack_start', args)
    expect(prompt.payload).toMatchObject({ status: 'approval_required', toolName: 'adpack_start', quotedCreditCost: 10 * PER_AD, nextTool: 'confirm_execute' })
    expect(String(prompt.payload.userPrompt)).toContain('10 anuncios')
    expect(env.store.packs.size).toBe(0)

    const approvalRequestId = String(prompt.payload.approvalRequestId)
    const early = await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(early.isError).toBe(true)
    expect(env.store.packs.size).toBe(0)

    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const started = await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(started.isError).toBe(false)
    expect(started.payload).toMatchObject({ status: 'completed', packId: approvalRequestId, nextTool: 'adpack_status' })
    expect(env.store.packs.get(approvalRequestId)?.source).toBe('mcp')
    expect(mcpBackground).toHaveLength(1)

    const again = await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(again.payload).toMatchObject({ packId: approvalRequestId, replayed: true })
    expect(env.store.packs.size).toBe(1)

    // A different input cannot reuse the approval.
    const tampered = await callMcp(env, USER_A, 'adpack_start', { ...args, size: 20, approvalRequestId })
    expect(tampered.isError).toBe(true)

    // Background work (when the host keeps it) completes the pack.
    await Promise.all(mcpBackground.map((w) => w()))
    expect(env.store.packs.get(approvalRequestId)!.status).toBe('done')
    expect(env.charges).toHaveLength(10)
  })

  it('adpack_start surfaces INSUFFICIENT_CREDITS after approval without creating a pack', async () => {
    const env = mcpEnv({ credits: 0 })
    const { started } = await mcpStartApproved(env, USER_A, startArgs(serum.dna))
    expect(started.isError).toBe(true)
    expect((started.payload.error as { code: string }).code).toBe('INSUFFICIENT_CREDITS')
    expect(env.store.packs.size).toBe(0)
  })

  it("adpack_status polls resume work and hide other users' packs", async () => {
    const env = mcpEnv()
    const { started } = await mcpStartApproved(env, USER_A, startArgs(serum.dna))
    const packId = String(started.payload.packId)
    const other = await callMcp(env, USER_B, 'adpack_status', { packId })
    expect(other.isError).toBe(true)
    expect((other.payload.error as { code: string }).code).toBe('NOT_FOUND')

    const status = await callMcp(env, USER_A, 'adpack_status', { packId })
    expect(status.payload).toMatchObject({ packId, status: 'done', moreWork: false, summary: '10/10 listos · pack terminado' })
    const ads = (status.payload.deliverable as { ads: Array<{ index: number; headline: string; caption: string; links: Record<string, string> }> }).ads
    expect(ads).toHaveLength(10)
    expect(ads.map((a) => a.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(ads.every((a) => a.headline && a.caption && Object.keys(a.links).length === 3)).toBe(true)
    expect(Object.keys(ads[0].links)).toEqual(['1:1', '4:5', '9:16'])
    expect(status.payload.retryAfterMs).toBeUndefined()
    expect(String(status.payload.instructionsForGrok)).toContain('No vuelvas a llamar adpack_status')
  })

  it('adpack_regenerate requires approval and charges one more ad; adpack_edit_text is free', async () => {
    const env = mcpEnv()
    const { started } = await mcpStartApproved(env, USER_A, startArgs(serum.dna))
    const packId = String(started.payload.packId)
    const status = await callMcp(env, USER_A, 'adpack_status', { packId })
    const itemId = (status.payload.deliverable as { ads: Array<{ itemId: string }> }).ads[2].itemId

    const edit = await callMcp(env, USER_A, 'adpack_edit_text', { packId, itemId, copy: { cta: 'Pedilo hoy' } })
    expect(edit.isError).toBe(false)
    expect(edit.payload).toMatchObject({ chargedCredits: 0, copy: { cta: 'Pedilo hoy' } })
    expect(env.charges).toHaveLength(10)

    const prompt = await callMcp(env, USER_A, 'adpack_regenerate', { packId, itemId })
    expect(prompt.payload).toMatchObject({ status: 'approval_required', quotedCreditCost: PER_AD })
    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const regen = await callMcp(env, USER_A, 'adpack_regenerate', { packId, itemId, approvalRequestId })
    expect(regen.payload).toMatchObject({ status: 'completed', packId, item: { itemId, status: 'copy_ready' } })
    const after = await callMcp(env, USER_A, 'adpack_status', { packId })
    expect(after.payload.status).toBe('done')
    expect(env.charges).toHaveLength(11)
  })
})
