import { afterEach, describe, expect, it } from 'vitest'
import {
  isCampaignCheckpoint,
  isCampaignChunkLeasable,
  MCP_CAMPAIGN_MAX_STALE_RECLAIMS,
  resumeMcpCampaignPack,
} from '../api/lib/mcp/bulk-tools'
import { createMemoryMcpApprovalStore, type McpApprovalRecord } from '../api/lib/mcp/approval'
import {
  MCP_EXECUTE_STALE_MS,
  setMcpExecuteScheduler,
} from '../api/lib/mcp/execute-job'

function checkpoint(overrides: Record<string, unknown> = {}) {
  return {
    status: 'running',
    jobId: 'approval-1',
    approvalRequestId: 'approval-1',
    toolName: 'execute_campaign_pack',
    startedAtMs: 10_000,
    chunkState: 'ready',
    phase: 'scripts',
    nextIndex: 0,
    reclaimCount: 0,
    quotedCreditCost: 36,
    chargedCredits: 0,
    usage: { quotedCredits: 36, chargedCredits: 0 },
    angles: [{ id: 'a1' }, { id: 'a2' }],
    scripts: [],
    posts: [],
    expandedRefs: [],
    retryAfterMs: 2_000,
    statusMessage: 'running',
    message: 'durable',
    ...overrides,
  }
}

describe('durable campaign chunk leases', () => {
  afterEach(() => {
    setMcpExecuteScheduler((work) => {
      void work().catch(() => {})
    })
  })

  it('leases a persisted ready chunk immediately', () => {
    expect(isCampaignCheckpoint(checkpoint())).toBe(true)
    expect(isCampaignChunkLeasable(checkpoint(), 10_001)).toBe(true)
  })

  it('does not duplicate active work, but reclaims it beyond host maxDuration', () => {
    const working = checkpoint({ chunkState: 'working' })
    expect(isCampaignChunkLeasable(working, 10_000 + MCP_EXECUTE_STALE_MS)).toBe(false)
    expect(isCampaignChunkLeasable(working, 10_001 + MCP_EXECUTE_STALE_MS)).toBe(true)
  })

  it('rejects malformed or terminal payloads', () => {
    expect(isCampaignCheckpoint(checkpoint({ status: 'completed' }))).toBe(false)
    expect(isCampaignChunkLeasable({ status: 'running' })).toBe(false)
  })

  async function stored(resultJson: unknown) {
    const store = createMemoryMcpApprovalStore()
    const row: McpApprovalRecord = {
      id: 'approval-1', tokenHash: 'token', userId: 'user-1',
      toolName: 'execute_campaign_pack', inputHash: 'input',
      inputJson: { brandId: 'brand-1', offerId: 'offer-1' }, quotedCreditCost: 36,
      status: 'approved', createdAtMs: 1, expiresAtMs: Number.MAX_SAFE_INTEGER,
      consumedAtMs: null, approvedAtMs: 1, deniedAtMs: null,
      resultJson, resultStoredAtMs: 1,
    }
    await store.insert(row)
    return store
  }

  const dependencies = {
    db: {} as never,
    artifactStore: {} as never,
    user: { id: 'user-1' },
    jobId: 'approval-1',
  }

  it('schedules a leased chunk off-request and persists the checkpoint without awaiting generate', async () => {
    const store = await stored(checkpoint())
    let scheduled = 0
    let runStarted = false
    setMcpExecuteScheduler((work) => {
      scheduled += 1
      // Do not run work inline — proves resume returns without awaiting generate.
      void work
    })
    await resumeMcpCampaignPack({
      ...dependencies,
      approvalStore: store,
      runChunk: async () => {
        runStarted = true
      },
    })
    expect(scheduled).toBe(1)
    expect(runStarted).toBe(false)
    expect((await store.findById('approval-1'))?.resultJson).toMatchObject({
      chunkState: 'working',
      reclaimCount: 0,
    })
  })

  it('a scheduled chunk persists either a script checkpoint or failure when work runs', async () => {
    const store = await stored(checkpoint())
    setMcpExecuteScheduler((work) => {
      void work()
    })
    await resumeMcpCampaignPack({
      ...dependencies,
      approvalStore: store,
      runChunk: async ({ approvalStore, checkpoint: leased }) => {
        await approvalStore.compareAndSwapRunningResult?.(
          leased.approvalRequestId,
          leased.startedAtMs,
          {
            ...leased,
            chunkState: 'ready',
            nextIndex: 1,
            scripts: [{ angleId: 'a1', scriptId: 'script-1', content: 'full script', charged: 3 }],
            chargedCredits: 3,
          },
          leased.startedAtMs + 1
        )
      },
    })
    // Allow microtask flush for scheduled work
    await Promise.resolve()
    await Promise.resolve()
    const result = (await store.findById('approval-1'))?.resultJson
    expect(result).toMatchObject({ chunkState: 'ready', nextIndex: 1, chargedCredits: 3 })
    expect((result as { scripts: unknown[] }).scripts).toHaveLength(1)
  })

  it('reclaims a stale lease and reschedules generation', async () => {
    const stale = checkpoint({ chunkState: 'working', startedAtMs: 1, reclaimCount: 0 })
    const store = await stored(stale)
    let runs = 0
    setMcpExecuteScheduler((work) => {
      void work()
    })
    await resumeMcpCampaignPack({
      ...dependencies,
      approvalStore: store,
      runChunk: async ({ approvalStore, checkpoint: leased }) => {
        runs += 1
        expect(leased.reclaimCount).toBe(1)
        await approvalStore.compareAndSwapRunningResult?.(
          leased.approvalRequestId,
          leased.startedAtMs,
          { ...leased, status: 'failed', error: 'provider timed out' },
          leased.startedAtMs + 1
        )
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(runs).toBe(1)
    expect((await store.findById('approval-1'))?.resultJson).toMatchObject({
      status: 'failed',
      error: 'provider timed out',
    })
  })

  it('terminal-fails after too many stale reclaim attempts', async () => {
    const stale = checkpoint({
      chunkState: 'working',
      startedAtMs: 1,
      reclaimCount: MCP_CAMPAIGN_MAX_STALE_RECLAIMS,
    })
    const store = await stored(stale)
    let runs = 0
    setMcpExecuteScheduler((work) => {
      void work()
    })
    await resumeMcpCampaignPack({
      ...dependencies,
      approvalStore: store,
      runChunk: async () => {
        runs += 1
      },
    })
    expect(runs).toBe(0)
    expect((await store.findById('approval-1'))?.resultJson).toMatchObject({
      status: 'failed',
    })
  })

  it('does not clobber a completed result while attempting to lease', async () => {
    const store = await stored({ ...checkpoint(), status: 'completed' })
    let runs = 0
    setMcpExecuteScheduler((work) => {
      void work()
    })
    await resumeMcpCampaignPack({
      ...dependencies,
      approvalStore: store,
      runChunk: async () => { runs += 1 },
    })
    expect(runs).toBe(0)
    expect((await store.findById('approval-1'))?.resultJson).toMatchObject({ status: 'completed' })
  })
})
