/**
 * #15 — the approval shows the per-ad plan BEFORE paying; approvals last 24 h (configurable);
 * an identical re-quote reuses the open approval instead of a new round. Fakes only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adPackApprovalTtlMs, MCP_APPROVAL_TTL_MS } from '../../api/lib/mcp/approval'
import { PER_AD, USER_A, callMcp, createDoorEnv, createMemoryMcpApprovalStore } from './door-harness'
import { BIZ_A, PROD_A, fakeLibrary, fakeSavedBrandDb } from './saved-brand-fakes'
import { drainBackground, queueBackgroundWork, restoreBackgroundWork } from './background-queue'

beforeEach(() => queueBackgroundWork())
afterEach(() => restoreBackgroundWork())

function savedEnv() {
  const db = fakeSavedBrandDb()
  // Two real photos with roles: hero (primary) + box.
  db.images.push(
    { id: 'img-hero', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/hero.jpg', kind: 'product', message_id: null, is_primary: true, tags: ['hero'], label: 'avión armado' },
    { id: 'img-box', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/box.jpg', kind: 'product', message_id: null, tags: ['caja'], label: 'caja' },
  )
  return { ...createDoorEnv({ savedBrandDb: db, library: fakeLibrary(db) }), approvalStore: createMemoryMcpApprovalStore() }
}

describe('#15 plan in the quote / approval', () => {
  it('the approval payload lists each ad (angle, why, layout family, planned photo, format, ratios) and the run follows it', async () => {
    const env = savedEnv()
    const args = { brandId: BIZ_A, offerId: PROD_A, size: 2, ratios: ['4:5', '9:16'] }
    const prompt = await callMcp(env, USER_A, 'adpack_start', args)
    expect(prompt.payload.status).toBe('approval_required')
    const plan = prompt.payload.plan as Array<Record<string, any>>
    expect(plan).toHaveLength(2)
    for (const [i, p] of plan.entries()) {
      expect(p).toMatchObject({ index: i + 1, angleId: expect.any(String), rationale: expect.any(String), layoutFamily: expect.any(String), format: expect.any(String), ratios: ['4:5', '9:16'] })
      expect(p.photo).toMatchObject({ url: expect.stringMatching(/^https:\/\//), productImageId: expect.any(String) })
    }
    // P1 #8: the hero is guaranteed in ad 1 (planned before approval); ad 2 uses the best pool photo.
    expect(plan[0].photo).toMatchObject({ productImageId: 'img-hero', source: 'hero' })
    expect(plan[1].photo).toMatchObject({ source: 'pool' })
    expect((prompt.payload.quote as { plan: unknown }).plan).toEqual(plan)
    // Approve and run: the started pack is exactly the quoted plan.
    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const started = await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    expect(started.payload.plan).toEqual(plan)
    const items = [...env.store.items.values()].filter((i) => i.packId === approvalRequestId).sort((a, b) => a.index - b.index)
    expect(items.map((i) => [i.angle.id, i.angle.layoutFamily])).toEqual(plan.map((p) => [p.angleId, p.layoutFamily]))
    await drainBackground()
  })

  it('per-ad photos are reported as the planned photo of that ad', async () => {
    const env = savedEnv()
    const prompt = await callMcp(env, USER_A, 'adpack_start', { brandId: BIZ_A, offerId: PROD_A, size: 2, productImageIdsByAd: { '2': ['img-box'] } })
    const plan = prompt.payload.plan as Array<Record<string, any>>
    expect(plan[1].photo).toMatchObject({ url: 'https://cdn.example/box.jpg', productImageId: 'img-box', source: 'per_ad' })
  })
})

describe('#15 approval TTL + identical re-quote', () => {
  it('Ad Pack approvals live 24 h by default (configurable); other tools keep 1 h', async () => {
    expect(adPackApprovalTtlMs({})).toBe(24 * 60 * 60 * 1000)
    expect(adPackApprovalTtlMs({ ADPACK_APPROVAL_TTL_HOURS: '48' })).toBe(48 * 60 * 60 * 1000)
    expect(adPackApprovalTtlMs({ ADPACK_APPROVAL_TTL_HOURS: 'nope' })).toBe(24 * 60 * 60 * 1000)
    expect(MCP_APPROVAL_TTL_MS).toBe(60 * 60 * 1000)
    const env = savedEnv()
    const t0 = Date.now()
    const prompt = await callMcp(env, USER_A, 'adpack_start', { brandId: BIZ_A, offerId: PROD_A, size: 2 })
    const expires = Number(prompt.payload.expiresAtMs)
    expect(expires - t0).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(prompt.payload.approval).toMatchObject({ items: 2, total: 2 * PER_AD })
  })

  it('identical arguments reuse the open approval (pending or approved); different arguments get a new one', async () => {
    const env = savedEnv()
    const args = { brandId: BIZ_A, offerId: PROD_A, size: 2 }
    const first = await callMcp(env, USER_A, 'adpack_start', args)
    const again = await callMcp(env, USER_A, 'adpack_start', { ...args })
    expect(again.payload.approvalRequestId).toBe(first.payload.approvalRequestId)
    expect(again.payload).toMatchObject({ reused: true, approvalStatus: 'pending', status: 'approval_required' })

    const approvalRequestId = String(first.payload.approvalRequestId)
    await callMcp(env, USER_A, 'confirm_execute', { approvalRequestId, action: 'approve' })
    const afterApprove = await callMcp(env, USER_A, 'adpack_start', { ...args })
    expect(afterApprove.payload).toMatchObject({ approvalRequestId, reused: true, approvalStatus: 'approved', nextTool: 'adpack_start' })
    expect(String(afterApprove.payload.instructionsForGrok)).toContain('do NOT ask again')

    const other = await callMcp(env, USER_A, 'adpack_start', { ...args, size: 3 })
    expect(other.payload.approvalRequestId).not.toBe(approvalRequestId)

    // Once it ran, the approval is used: the same arguments start a new round.
    await callMcp(env, USER_A, 'adpack_start', { ...args, approvalRequestId })
    await drainBackground()
    const fresh = await callMcp(env, USER_A, 'adpack_start', { ...args })
    expect(fresh.payload.approvalRequestId).not.toBe(approvalRequestId)
    expect(fresh.payload.reused).toBeUndefined()
  })
})
