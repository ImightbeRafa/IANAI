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
