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
import {
  buildStatusExtras,
  DELIVERABLE_CAPTION_MAX,
  DELIVERABLE_CAPTIONS_TEXT_MAX,
  estimateRemainingSeconds,
  failureReason,
} from '../../api/lib/adpack/status-summary'
import type { PackItem } from '../../api/lib/adpack/types'
import { drainBackground, queueBackgroundWork, restoreBackgroundWork } from './background-queue'
import { USER_A, callMcp, callWeb, createDoorEnv, createMemoryMcpApprovalStore, mcpStartApproved, serum } from './door-harness'
import { goodSerumCopy } from './helpers'

const PACK = '11111111-1111-4111-8111-111111111111'

function item(index: number, patch: Partial<PackItem> = {}): PackItem {
  return {
    id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
    packId: PACK,
    index,
    status: 'planned',
    angle: { format: 'hero_offer' } as PackItem['angle'],
    renders: [],
    attempts: 0,
    generationId: `g${index}`,
    updatedAt: '2026-10-08T00:00:00.000Z',
    ...patch,
  }
}

function doneItem(index: number, timings: PackItem['timings'] = { copyMs: 4_000, sceneMs: 20_000, sceneCheckMs: 4_000, renderMs: 2_000, chargeMs: 0 }): PackItem {
  return item(index, {
    status: 'done',
    copy: goodSerumCopy({ headline: `Titular ${index + 1}`, caption: `Caption del anuncio ${index + 1}` }),
    renders: (['1:1', '4:5', '9:16'] as const).map((ratio) => ({ ratio, width: 1, height: 1, imageUrl: `https://cdn.example/${index}-${ratio}.png` })),
    timings,
  })
}

describe('buildStatusExtras', () => {
  it('running pack: ES summary with ready count, plain-language failure and ETA from per-item timings', () => {
    const items = [
      ...Array.from({ length: 7 }, (_, i) => doneItem(i)),
      item(7, { status: 'failed', error: 'scene_product_mismatch after 3 attempts', copy: goodSerumCopy() }),
      item(8, { status: 'copy_ready' }),
      item(9, { status: 'planned' }),
    ]
    const x = buildStatusExtras({ packId: PACK, status: 'running', items, moreWork: true, language: 'es' })
    // copy_ready: 20+4+2+0 = 26 s; planned: 30 s → 56 s over 2 lanes = 28 s → 30 s.
    expect(x.etaSeconds).toBe(30)
    expect(x.summary).toBe('7/10 listos · 1 falló (producto no coincidía) · ~30 s restantes')
    expect(x.deliverable).toBeUndefined()
    expect(x.failures).toEqual([
      {
        itemId: items[7].id,
        index: 8,
        reason: 'producto no coincidía',
        retry: {
          tool: 'adpack_regenerate',
          arguments: { packId: PACK, itemId: items[7].id, mode: 'scene' },
          call: `adpack_regenerate {"packId":"${PACK}","itemId":"${items[7].id}","mode":"scene"}`,
        },
        attempts: 1,
      },
    ])
  })

  it('EN summary, copy failures retry with mode copy, minutes for long ETAs', () => {
    const items = [item(0, { status: 'failed', error: 'copy_check_failed: invented_number(headline)' }), ...Array.from({ length: 19 }, (_, i) => item(i + 1))]
    const x = buildStatusExtras({ packId: PACK, status: 'running', items, moreWork: true, language: 'en' })
    expect(x.failures![0]).toMatchObject({ reason: 'copy broke the facts rules', retry: { arguments: { mode: 'copy' } } })
    expect(x.summary).toMatch(/^0\/20 ready · 1 failed \(copy broke the facts rules\) · ~\d+ min left$/)
  })

  it('finished pack: deliverable with 1-based links + captions, numbered captionsText and deepLink; no ETA', () => {
    const items = [doneItem(0), doneItem(1), item(2, { status: 'failed', error: 'render_failed: boom', copy: goodSerumCopy() })]
    const x = buildStatusExtras({ packId: PACK, status: 'partial', items, moreWork: false, language: 'es', deepLink: 'https://advanceai.studio/chat?brand=b&adpack=p' })
    expect(x.summary).toBe('2/3 listos · 1 falló (no se pudo componer el anuncio) · pack terminado')
    expect(x.etaSeconds).toBeUndefined()
    expect(x.deliverable).toEqual({
      ads: [0, 1].map((i) => ({
        itemId: items[i].id,
        index: i + 1,
        format: 'hero_offer',
        headline: `Titular ${i + 1}`,
        caption: `Caption del anuncio ${i + 1}`,
        links: { '1:1': `https://cdn.example/${i}-1:1.png`, '4:5': `https://cdn.example/${i}-4:5.png`, '9:16': `https://cdn.example/${i}-9:16.png` },
        files: (['1:1', '4:5', '9:16'] as const).map((ratio) => ({ ratio, url: `https://cdn.example/${i}-${ratio}.png`, width: 1, height: 1, format: 'png', placement: ({ '1:1': 'square', '4:5': 'feed', '9:16': 'story' } as const)[ratio] })),
        forbiddenHits: [],
        attempts: 1,
      })),
      captionsText: '1. Anuncio 1 — Titular 1\nCaption del anuncio 1\n\n2. Anuncio 2 — Titular 2\nCaption del anuncio 2',
      deepLink: 'https://advanceai.studio/chat?brand=b&adpack=p',
    })
    expect(x.failures).toHaveLength(1)
  })

  it('caps caption sizes so the payload stays compact', () => {
    const huge = 'x'.repeat(5_000)
    const items = Array.from({ length: 20 }, (_, i) => ({ ...doneItem(i), copy: goodSerumCopy({ caption: huge }) }))
    const x = buildStatusExtras({ packId: PACK, status: 'done', items, moreWork: false, language: 'es' })
    expect(x.deliverable!.ads.every((a) => a.caption.length <= DELIVERABLE_CAPTION_MAX)).toBe(true)
    expect(x.deliverable!.captionsText.length).toBeLessThanOrEqual(DELIVERABLE_CAPTIONS_TEXT_MAX)
  })

  it('cancelled packs say so and never offer a deliverable', () => {
    const x = buildStatusExtras({ packId: PACK, status: 'cancelled', items: [doneItem(0), item(1)], moreWork: false, language: 'es' })
    expect(x.summary).toBe('1/2 listos · pack cancelado')
    expect(x.deliverable).toBeUndefined()
  })

  it('ETA uses defaults before any ad finished and is 0 when nothing is pending', () => {
    expect(estimateRemainingSeconds([item(0)])).toBeGreaterThanOrEqual(40)
    expect(estimateRemainingSeconds([doneItem(0)])).toBe(0)
    expect(failureReason(undefined, 'en')).toBe('unexpected error')
  })
})

describe('status summary through both doors', () => {
  beforeEach(() => {
    queueBackgroundWork(setAdPackBackgroundScheduler)
  })
  afterEach(() => {
    restoreBackgroundWork()
    setDefaultAdPackService(null)
  })

  it('a failed ad shows the same summary + failures (with the exact retry call) on web and MCP', async () => {
    const env = { ...createDoorEnv(), approvalStore: createMemoryMcpApprovalStore() }
    setDefaultAdPackService(env.service)
    const { started } = await mcpStartApproved(env, USER_A, { dna: serum.dna, offer: serum.offer, size: 3 })
    const packId = String(started.payload.packId)
    await drainBackground()
    const target = [...env.store.items.values()].find((i) => i.packId === packId && i.index === 1)!
    await env.store.updateItem(target.id, { status: 'failed', error: 'scene_product_mismatch after 3 attempts', renders: [] })
    await env.store.updatePack(packId, { status: 'partial' })

    const web = (await callWeb(handler, USER_A, { action: 'status', packId })).body as AdPackStatusResponse
    const mcp = (await callMcp(env, USER_A, 'adpack_status', { packId })).payload
    expect(web.summary).toBe('2/3 listos · 1 falló (producto no coincidía) · pack terminado')
    expect(mcp.summary).toBe(web.summary)
    expect(mcp.failures).toEqual(web.failures)
    expect(mcp.deliverable).toEqual(web.deliverable)
    expect(web.failures![0].retry.call).toBe(`adpack_regenerate {"packId":"${packId}","itemId":"${target.id}","mode":"scene"}`)
    expect(web.deliverable!.ads.map((a) => a.index)).toEqual([1, 3])
    expect(String(mcp.instructionsForGrok)).toContain('failures[].retry.call')

    // English on request, same through both doors.
    const webEn = (await callWeb(handler, USER_A, { action: 'status', packId, language: 'en' })).body as AdPackStatusResponse
    const mcpEn = (await callMcp(env, USER_A, 'adpack_status', { packId, language: 'en' })).payload
    expect(webEn.summary).toBe("2/3 ready · 1 failed (product didn't match) · pack finished")
    expect(mcpEn.summary).toBe(webEn.summary)
  })

  it('while running, MCP suggests a poll cadence from the ETA and returns compact rows without captions', async () => {
    const env = { ...createDoorEnv(), approvalStore: createMemoryMcpApprovalStore() }
    const { started } = await mcpStartApproved(env, USER_A, { dna: serum.dna, offer: serum.offer, size: 3 })
    const packId = String(started.payload.packId)
    const poll = Number(started.payload.pollAfterSeconds)
    expect(poll).toBeGreaterThanOrEqual(10)
    expect(poll).toBeLessThanOrEqual(30)
    expect(started.payload.retryAfterMs).toBe(poll * 1000)
    const future = new Date(Date.now() + 60_000).toISOString()
    for (const i of env.store.items.values()) i.leaseUntil = future
    const running = (await callMcp(env, USER_A, 'adpack_status', { packId })).payload
    expect(running).toMatchObject({ moreWork: true, nextTool: 'adpack_status' })
    expect(running.retryAfterMs).toBe(Number(running.retryAfterSeconds) * 1000)
    expect(running.backgroundKicked).toBeUndefined() // a worker holds the lease: nothing kicked
    expect(String(running.summary)).toMatch(/^0\/3 listos · ~\d+ s restantes$/)
    expect(typeof running.etaSeconds).toBe('number')
    expect(String(running.instructionsForGrok)).toContain(`~${running.retryAfterSeconds} s`)
    const rows = running.items as Array<Record<string, unknown>>
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => !('caption' in r) && !('copy' in r))).toBe(true)
    expect(running.deliverable).toBeUndefined()
    expect(JSON.stringify(running).length).toBeLessThan(4_000)
  })
})
