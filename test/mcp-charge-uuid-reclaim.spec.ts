import { describe, expect, it } from 'vitest'
import {
  deterministicGenerationUuid,
  generationUuidFromApproval,
  isUuid,
} from '../api/lib/credits/generation-id'
import {
  approveMcpApprovalRequest,
  createMemoryMcpApprovalStore,
  issueMcpApprovalRequest,
  storeMcpApprovalResult,
} from '../api/lib/mcp/approval'
import { canStoreExecuteResult, matchesRunningCasExpectation } from '../api/lib/mcp/cas-running-result'
import {
  asJobHandleFromStored,
  claimMcpExecuteJob,
  getMcpExecuteResult,
  isArtifactsSavedChargeFailure,
  isReclaimableExecuteJob,
  MCP_EXECUTE_STALE_MS,
  shouldReplayStoredExecuteResult,
} from '../api/lib/mcp/execute-job'

describe('deterministic generation UUIDs', () => {
  it('produces stable RFC UUIDs distinct by key', () => {
    const seed = '11111111-2222-4333-8444-555555555555'
    const a = generationUuidFromApproval(seed, 'script:1')
    const b = generationUuidFromApproval(seed, 'script:1')
    const c = generationUuidFromApproval(seed, 'script:2')
    expect(isUuid(a)).toBe(true)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(deterministicGenerationUuid(seed, 'carousel')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })
})

describe('charge-failure reclaim + poll', () => {
  it('does not reclaim artifactsSaved charge failures (no regen storm)', () => {
    const failed = {
      status: 'failed',
      failureStage: 'charge',
      artifactsSaved: true,
      resumeMode: 'charge_only',
      slides: [{ imageUrl: 'https://cdn.example/a.jpg', productImageId: 'img1' }],
      error: 'Credit charge failed: UNAVAILABLE',
    }
    expect(isArtifactsSavedChargeFailure(failed)).toBe(true)
    expect(isReclaimableExecuteJob(failed)).toBe(false)
    expect(shouldReplayStoredExecuteResult(failed)).toBe(true)
    const formatted = asJobHandleFromStored('appr-1', failed, 'execute_carousel_generate') as Record<string, unknown>
    expect(formatted.status).toBe('failed')
    expect(formatted.slides).toEqual(failed.slides)
    expect(formatted.artifactsSaved).toBe(true)
  })

  it('CAS reclaim does not overwrite a completed result with running', async () => {
    const store = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_bulk_scripts',
      input: { brandId: 'b1' },
      quotedCreditCost: 9,
    })
    await approveMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
    })

    const startedAtMs = Date.now() - MCP_EXECUTE_STALE_MS - 1_000
    await store.storeResult(issued.approvalRequestId, {
      status: 'running',
      jobId: issued.approvalRequestId,
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_bulk_scripts',
      startedAtMs,
      chargedCredits: 0,
    }, startedAtMs)

    // Worker finishes first
    await storeMcpApprovalResult(store, {
      approvalRequestId: issued.approvalRequestId,
      result: {
        status: 'completed',
        jobId: issued.approvalRequestId,
        approvalRequestId: issued.approvalRequestId,
        toolName: 'execute_bulk_scripts',
        chargedCredits: 9,
        items: [{ scriptId: 's1' }],
      },
    })

    const claim = await claimMcpExecuteJob(store, {
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_bulk_scripts',
      quotedCreditCost: 9,
    })
    expect(claim.claimed).toBe(false)
    const polled = await getMcpExecuteResult({
      approvalStore: store,
      userId: 'user-a',
      jobId: issued.approvalRequestId,
    })
    expect(polled.status).toBe('completed')
    expect(polled.chargedCredits).toBe(9)
  })
})

describe('prod CAS race (check-then-write vs atomic JSON filters)', () => {
  it('matchesRunningCasExpectation rejects completed (predicate used by DB filters)', () => {
    const startedAtMs = 1_700_000_000_000
    expect(matchesRunningCasExpectation({
      status: 'running',
      startedAtMs,
    }, startedAtMs)).toBe(true)
    expect(matchesRunningCasExpectation({
      status: 'completed',
      startedAtMs,
      chargedCredits: 9,
    }, startedAtMs)).toBe(false)
    expect(matchesRunningCasExpectation({
      status: 'running',
      startedAtMs: startedAtMs - 1,
    }, startedAtMs)).toBe(false)
  })

  /**
   * Simulates the broken prod path Codex flagged: SELECT then UPDATE filtered only by
   * id+approved. A completed write between check and update clobbers the job.
   * The atomic path uses matchesRunningCasExpectation on the current row (same as
   * result_json->>status / startedAtMs filters) and must not clobber.
   */
  it('atomic CAS refuses to clobber completed when a race lands between check and write', () => {
    const startedAtMs = Date.now() - MCP_EXECUTE_STALE_MS - 1_000
    const completed = {
      status: 'completed',
      chargedCredits: 12,
      slides: [{ imageUrl: 'https://cdn.example/slide.jpg' }],
    }
    const reclaimRunning = {
      status: 'running',
      startedAtMs: Date.now(),
      chargedCredits: 0,
    }

    type Row = { status: string; resultJson: unknown }

    // --- Broken check-then-write documents the race Codex found ---
    const brokenRow: Row = {
      status: 'approved',
      resultJson: { status: 'running', startedAtMs, chargedCredits: 0 },
    }
    {
      const seen = brokenRow.resultJson
      expect(matchesRunningCasExpectation(seen, startedAtMs)).toBe(true)
      brokenRow.resultJson = completed // race: worker completes
      // Unconditional write filtered only by id + approved — THE BUG
      if (brokenRow.status === 'approved') brokenRow.resultJson = reclaimRunning
      expect(brokenRow.resultJson).toEqual(reclaimRunning)
    }

    // --- Fixed atomic CAS (predicate in the same step as the write) ---
    const row: Row = {
      status: 'approved',
      resultJson: { status: 'running', startedAtMs, chargedCredits: 0 },
    }
    // Race lands BEFORE atomic CAS evaluates the predicate
    row.resultJson = completed
    const swapped =
      row.status === 'approved'
      && matchesRunningCasExpectation(row.resultJson, startedAtMs)
    if (swapped) row.resultJson = reclaimRunning
    expect(swapped).toBe(false)
    expect(row.resultJson).toEqual(completed)
    expect((row.resultJson as { status: string }).status).toBe('completed')
  })

  it('store.compareAndSwapRunningResult is a no-op when result is already completed', async () => {
    const store = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_carousel_generate',
      input: { brandId: 'b1' },
      quotedCreditCost: 24,
    })
    await approveMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
    })
    const startedAtMs = Date.now() - MCP_EXECUTE_STALE_MS - 5_000
    await store.storeResult(issued.approvalRequestId, {
      status: 'running',
      startedAtMs,
      chargedCredits: 0,
    }, startedAtMs)
    await store.storeResult(issued.approvalRequestId, {
      status: 'completed',
      chargedCredits: 24,
      slides: [{ imageUrl: 'https://cdn.example/x.jpg' }],
    }, Date.now())

    const cas = store.compareAndSwapRunningResult!
    const swapped = await cas(
      issued.approvalRequestId,
      startedAtMs,
      { status: 'running', startedAtMs: Date.now(), chargedCredits: 0 },
      Date.now()
    )
    expect(swapped).toBeNull()
    const row = await store.findById(issued.approvalRequestId)
    expect((row?.resultJson as { status: string }).status).toBe('completed')
    expect((row?.resultJson as { chargedCredits: number }).chargedCredits).toBe(24)
  })

  it('storeResult and claim refuse completed → running clobber', async () => {
    expect(canStoreExecuteResult(
      { status: 'completed', chargedCredits: 9 },
      { status: 'running', startedAtMs: Date.now(), chargedCredits: 0 }
    )).toBe(false)
    expect(canStoreExecuteResult(
      { status: 'running', startedAtMs: 1 },
      { status: 'completed', chargedCredits: 9 }
    )).toBe(true)

    const store = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_bulk_scripts',
      input: { brandId: 'b1' },
      quotedCreditCost: 9,
    })
    await approveMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
    })

    const completed = {
      status: 'completed' as const,
      jobId: issued.approvalRequestId,
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_bulk_scripts',
      chargedCredits: 9,
      items: [{ scriptId: 's1', content: 'ok' }],
    }
    await store.storeResult(issued.approvalRequestId, completed, Date.now())

    const clobber = await store.storeResult(
      issued.approvalRequestId,
      { status: 'running', startedAtMs: Date.now(), chargedCredits: 0 },
      Date.now()
    )
    expect(clobber).toBeNull()

    const claim = await claimMcpExecuteJob(store, {
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_bulk_scripts',
      quotedCreditCost: 9,
    })
    expect(claim.claimed).toBe(false)

    const row = await store.findById(issued.approvalRequestId)
    expect(row?.resultJson).toEqual(completed)
    expect((row?.resultJson as { status: string }).status).toBe('completed')

    const polled = await getMcpExecuteResult({
      approvalStore: store,
      userId: 'user-a',
      jobId: issued.approvalRequestId,
    })
    expect(polled.status).toBe('completed')
    expect(polled.chargedCredits).toBe(9)
  })
})
