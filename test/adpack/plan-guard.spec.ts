/**
 * F1 — approved quantity and cost are exactly what runs (no silent 2 → 1), and F2 — the
 * approval carries a neutral, structured plan. Both doors; no model calls (fakes only).
 *
 * Real-run bug (2026-10-08): "2 ads for 12 credits" approved, 1 ad for 6 produced. Root cause:
 * the approval quoted `size` while ignoring `angleIds`, and start filtered a re-plan of only
 * `size` angles by ids that came from a bigger board (ids are index-based: a05 does not exist
 * in a 2-angle plan), so the selection shrank silently.
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
import { planAngles, resolvePackAngles, MAX_PACK_SIZE, AnglePlanError } from '../../api/lib/adpack/plan-angles'
import type { BrandDna, BusinessCategory, OfferInput } from '../../api/lib/adpack/types'
import { setMcpExecuteScheduler } from '../../api/lib/mcp/execute-job'
import type { McpApprovalStore } from '../../api/lib/mcp/approval'
import { PER_AD, USER_A, callMcp, callWeb, createDoorEnv, createMemoryMcpApprovalStore, serum } from './door-harness'

let mcpBackground: Array<() => Promise<void>> = []

beforeEach(() => {
  mcpBackground = []
  setAdPackBackgroundScheduler(() => {})
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

function mcpEnv(approvalStore?: McpApprovalStore) {
  const env = createDoorEnv()
  return { ...env, approvalStore: approvalStore ?? createMemoryMcpApprovalStore() }
}

describe('F1 root cause: angle ids from a bigger board', () => {
  it('a re-plan of `size` angles does not contain ids picked from a bigger board (old filter dropped them)', () => {
    const board = planAngles({ dna: serum.dna, offer: serum.offer, size: 10 })
    const pick = [board[0].id, board[4].id]
    const replanOfTwo = planAngles({ dna: serum.dna, offer: serum.offer, size: 2 }).map((a) => a.id)
    // What the old start did: filter the size-2 re-plan by the selection → 1 ad.
    expect(replanOfTwo.filter((id) => pick.includes(id))).toHaveLength(1)
    // The resolver behind quote, approval and start keeps both.
    expect(resolvePackAngles({ dna: serum.dna, offer: serum.offer, size: 2, angleIds: pick }).map((a) => a.id)).toEqual(pick)
  })

  it('the planner is prefix-stable, so ids from any board size resolve to the same angles', () => {
    const small = planAngles({ dna: serum.dna, offer: serum.offer, size: 3 })
    const big = planAngles({ dna: serum.dna, offer: serum.offer, size: MAX_PACK_SIZE })
    expect(big.slice(0, 3)).toEqual(small)
  })

  it('unknown angle ids fail at quote time with a clear reason (never a smaller pack)', () => {
    expect(() => resolvePackAngles({ dna: serum.dna, offer: serum.offer, size: 2, angleIds: ['angle_1', 'a01-nope'] })).toThrow(AnglePlanError)
  })
})

describe('F1 planAngles always returns exactly `size`', () => {
  const minimal = (category: BusinessCategory): { dna: BrandDna; offer: OfferInput } => ({
    dna: { version: 1, brandName: 'Marca Demo', category, language: 'es', register: 'voseo', facts: [], visual: {}, gaps: [], sources: [] },
    offer: { name: 'Producto Demo', facts: [], productImageUrls: [] },
  })
  const categories: BusinessCategory[] = ['beauty', 'health_wellness', 'food_beverage', 'fashion_apparel', 'home_garden', 'tech_electronics', 'fitness_sports', 'pets', 'kids_baby', 'services_local', 'education', 'finance', 'other']

  it.each(categories)('%s with no facts: 20 distinct angles (ids and messages)', (category) => {
    const { dna, offer } = minimal(category)
    const angles = resolvePackAngles({ dna, offer, size: MAX_PACK_SIZE })
    expect(angles).toHaveLength(MAX_PACK_SIZE)
    expect(new Set(angles.map((a) => a.id)).size).toBe(MAX_PACK_SIZE)
    expect(new Set(angles.map((a) => a.message)).size).toBe(MAX_PACK_SIZE)
  })
})

describe('F1 + F2 through the MCP door', () => {
  it('2 approved → exactly 2 ads planned for 12 credits (selection from a 10-angle board)', async () => {
    const env = mcpEnv()
    const board = await callMcp(env, USER_A, 'adpack_angles', { dna: serum.dna, offer: serum.offer, size: 10 })
    const angles = board.payload.angles as Array<{ id: string }>
    const angleIds = [angles[0].id, angles[4].id]
    const args = { dna: serum.dna, offer: serum.offer, size: 2, angleIds }

    const prompt = await callMcp(env, USER_A, 'adpack_start', args)
    expect(prompt.payload.status).toBe('approval_required')
    expect(prompt.payload.approval).toMatchObject({ items: 2, unitCost: PER_AD, total: 2 * PER_AD, currency: 'credits' })
    expect(typeof (prompt.payload.approval as { expiresAt: string }).expiresAt).toBe('string')
    expect(prompt.payload.quote).toMatchObject({ size: 2, credits: 2 * PER_AD, angleIds })
    // F2: neutral and structured — no persona, no link.
    const text = String(prompt.payload.userPrompt)
    expect(text).toMatch(/2 × 6 = 12 créditos/)
    expect(text).not.toMatch(/Grok|Yo \(|https?:\/\//)
    expect(prompt.payload).not.toHaveProperty('optionalAdvancePage')

    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const started = await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(started.payload).toMatchObject({ status: 'running', quote: { size: 2, credits: 2 * PER_AD } })
    const items = [...env.store.items.values()].filter((i) => i.packId === approvalRequestId)
    expect(items.map((i) => i.angle.id)).toEqual(angleIds)

    await Promise.all(mcpBackground.map((w) => w()))
    expect(env.charges).toHaveLength(2)
  })

  it('unknown angle ids are rejected before any approval is issued', async () => {
    const env = mcpEnv()
    const res = await callMcp(env, USER_A, 'adpack_start', { dna: serum.dna, offer: serum.offer, size: 2, angleIds: ['angle_1', 'angle_2'] })
    expect(res.isError).toBe(true)
    expect(res.payload.error).toMatchObject({ code: 'BAD_INPUT', reason: 'unknown_angle_ids', unknownAngleIds: ['angle_1', 'angle_2'] })
    expect(env.store.packs.size).toBe(0)
  })

  it('a plan that differs from the approval answers PLAN_CHANGED, runs nothing and retires the approval', async () => {
    const memory = createMemoryMcpApprovalStore()
    // Simulate an approval recorded for 1 ad (6 credits) while the plan now has 2 ads.
    const shrunk: McpApprovalStore = {
      ...memory,
      async findById(id) {
        const row = await memory.findById(id)
        return row ? { ...row, quotedCreditCost: PER_AD } : null
      },
    }
    const env = mcpEnv(shrunk)
    const args = { dna: serum.dna, offer: serum.offer, size: 2 }
    const prompt = await callMcp(env, USER_A, 'adpack_start', args)
    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const res = await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(res.isError).toBe(false)
    expect(res.payload).toMatchObject({
      status: 'plan_changed',
      code: 'PLAN_CHANGED',
      approved: { items: 1, total: PER_AD },
      planned: { items: 2, total: 2 * PER_AD },
      chargedCredits: 0,
    })
    expect(env.store.packs.size).toBe(0)
    expect(env.charges).toHaveLength(0)
    expect((await memory.findById(approvalRequestId))?.status).toBe('denied')
    // The retired approval can never run the other plan.
    const again = await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(again.isError).toBe(true)
    expect(env.store.packs.size).toBe(0)
  })

  it('adpack_regenerate approval is structured too (1 × 6)', async () => {
    const env = mcpEnv()
    const prompt = await callMcp(env, USER_A, 'adpack_start', { dna: serum.dna, offer: serum.offer, size: 1 })
    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    await callMcp(env, USER_A, 'adpack_start', { dna: serum.dna, offer: serum.offer, size: 1, approvalRequestId })
    await Promise.all(mcpBackground.map((w) => w()))
    const itemId = [...env.store.items.values()][0].id
    const regen = await callMcp(env, USER_A, 'adpack_regenerate', { packId: approvalRequestId, itemId })
    expect(regen.payload.approval).toMatchObject({ items: 1, unitCost: PER_AD, total: PER_AD })
  })
})

describe('F1 through the web door (parity)', () => {
  it('start with an approved plan that no longer matches → 409 PLAN_CHANGED, nothing created', async () => {
    const env = createDoorEnv()
    setDefaultAdPackService(env.service)
    const res = await callWeb(handler, USER_A, { action: 'start', dna: serum.dna, offer: serum.offer, size: 2, approved: { items: 1, total: PER_AD } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ code: 'PLAN_CHANGED', approved: { items: 1, total: PER_AD }, planned: { items: 2, total: 2 * PER_AD, unitCost: PER_AD } })
    expect(env.store.packs.size).toBe(0)

    const ok = await callWeb(handler, USER_A, { action: 'start', dna: serum.dna, offer: serum.offer, size: 2, approved: { items: 2, total: 2 * PER_AD } })
    expect(ok.statusCode).toBe(200)
    expect(env.store.packs.size).toBe(1)
  })

  it('quote with angleIds quotes exactly the selection, like MCP adpack_quote', async () => {
    const env = createDoorEnv()
    setDefaultAdPackService(env.service)
    const board = planAngles({ dna: serum.dna, offer: serum.offer, size: 10 })
    const angleIds = [board[1].id, board[7].id, board[9].id]
    const web = await callWeb(handler, USER_A, { action: 'quote', dna: serum.dna, offer: serum.offer, size: 3, angleIds })
    const mcp = await callMcp({ ...env, approvalStore: createMemoryMcpApprovalStore() }, USER_A, 'adpack_quote', { dna: serum.dna, offer: serum.offer, size: 3, angleIds })
    expect(web.body).toMatchObject({ size: 3, credits: 3 * PER_AD, perAd: PER_AD, angleIds })
    // #15: the per-ad plan (angle, why, layout family, format, photo, ratios) comes with the quote.
    const plan = (web.body as { plan: Array<Record<string, unknown>> }).plan
    expect(plan.map((p) => p.angleId)).toEqual(angleIds)
    for (const p of plan) expect(p).toMatchObject({ index: expect.any(Number), rationale: expect.any(String), layoutFamily: expect.any(String), format: expect.any(String), ratios: ['4:5', '9:16'] })
    expect(mcp.payload).toEqual(web.body)
  })
})
