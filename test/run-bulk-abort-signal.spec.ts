import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Round-6 operator review, item C: runBulkScripts/runBulkPosts must stop
// BEFORE a new item's checkUsageLimit/generate/charge once the deadline
// signal is aborted — never mid-item — so already-charged items in the
// result stay intact and nothing needs a refund.

vi.mock('../api/lib/auth.js', () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true })),
  incrementUsage: vi.fn(async () => ({ creditsCharged: 1 })),
}))

vi.mock('../api/lib/bulk/generate-script.js', () => ({
  generateScriptForAngle: vi.fn(async ({ angle }: { angle: { id: string; title: string } }) => ({
    title: angle.title,
    content: `script for ${angle.id}`,
  })),
}))

vi.mock('../api/lib/usage-logger.js', () => ({
  logApiUsage: vi.fn(async () => undefined),
  estimateTokens: vi.fn(() => 1),
}))

import { checkUsageLimit } from '../api/lib/auth.js'
import { generateScriptForAngle } from '../api/lib/bulk/generate-script.js'
import { runBulkScripts } from '../api/lib/bulk/run-bulk.js'
import type { AngleBoardItem } from '../api/lib/bulk/types.js'

function fakeRuntime() {
  return {
    user: { id: 'user-1', email: 'user@test.com' },
    brandId: 'brand-1',
    offerId: 'offer-1',
    sessionId: 'session-1',
    language: 'en' as const,
    ctx: { brand: { name: 'Brand', icpDescription: '' }, offers: [{ id: 'offer-1', name: 'Offer' }], brandKit: null },
    artifactStore: {
      ensureExecuteSession: vi.fn(async () => ({ sessionId: 'session-1' })),
      saveScriptArtifact: vi.fn(async () => ({ scriptId: 'script-1', messageId: 'msg-1' })),
    },
    source: 'web' as const,
    packId: 'pack-1',
  }
}

function makeAngles(count: number): AngleBoardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `angle-${i}`,
    title: `Angle ${i}`,
    niche: 'niche',
    whyItBuys: 'why',
    hookStyle: 'hook',
    frameworkHint: 'hint',
  }))
}

describe('runBulkScripts abort signal', () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = 'test-key'
    vi.mocked(checkUsageLimit).mockClear()
    vi.mocked(generateScriptForAngle).mockClear()
  })

  afterEach(() => {
    delete process.env.XAI_API_KEY
  })

  it('an already-aborted signal stops before the first item: no items processed', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await runBulkScripts({
      runtime: fakeRuntime() as any,
      angles: makeAngles(5),
      signal: controller.signal,
    })

    expect(result.items).toHaveLength(0)
    expect(checkUsageLimit).not.toHaveBeenCalled()
    expect(generateScriptForAngle).not.toHaveBeenCalled()
  })

  it('aborting mid-run stops before the NEXT item, keeping already-charged items intact', async () => {
    const controller = new AbortController()
    let callCount = 0
    vi.mocked(generateScriptForAngle).mockImplementation(async ({ angle }: any) => {
      callCount += 1
      if (callCount === 2) controller.abort() // abort partway through, after this item's own work has started
      return { title: angle.title, content: `script for ${angle.id}` }
    })

    const result = await runBulkScripts({
      runtime: fakeRuntime() as any,
      angles: makeAngles(5),
      signal: controller.signal,
    })

    // Items 0 and 1 complete normally (abort happens during item 1's own
    // generate call, after which this item still finishes/charges) — the
    // loop only checks the signal at the TOP of each iteration, so item 1
    // itself is never interrupted mid-flight.
    expect(result.items).toHaveLength(2)
    expect(result.items.every((item) => !item.error)).toBe(true)
    expect(generateScriptForAngle).toHaveBeenCalledTimes(2)
  })

  it('no signal at all behaves exactly as before (all items processed)', async () => {
    const result = await runBulkScripts({
      runtime: fakeRuntime() as any,
      angles: makeAngles(3),
    })
    expect(result.items).toHaveLength(3)
    expect(generateScriptForAngle).toHaveBeenCalledTimes(3)
  })
})
