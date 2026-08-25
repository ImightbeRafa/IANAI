import { describe, expect, it } from 'vitest'
import {
  isCampaignCheckpoint,
  isCampaignChunkLeasable,
  resumeMcpCampaignPack,
} from '../api/lib/mcp/bulk-tools'
import { createMemoryMcpApprovalStore, type McpApprovalRecord } from '../api/lib/mcp/approval'
import { MCP_EXECUTE_STALE_MS } from '../api/lib/mcp/execute-job'

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

  it('a leased chunk runs inline and persists either a script checkpoint or failure', async () => {
    const store = await stored(checkpoint())
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
            scripts: [{ angleId: 'a1', scriptId: 'script-1', charged: 3 }],
          },
          leased.startedAtMs + 1
        )
      },
    })
    const result = (await store.findById('approval-1'))?.resultJson
    expect(result).toMatchObject({ chunkState: 'ready', nextIndex: 1 })
    expect((result as { scripts: unknown[] }).scripts).toHaveLength(1)
  })

  it('reclaims a stale lease and retries generation instead of no-op', async () => {
    const stale = checkpoint({ chunkState: 'working', startedAtMs: 1 })
    const store = await stored(stale)
    let runs = 0
    await resumeMcpCampaignPack({
      ...dependencies,
      approvalStore: store,
      runChunk: async ({ approvalStore, checkpoint: leased }) => {
        runs += 1
        await approvalStore.compareAndSwapRunningResult?.(
          leased.approvalRequestId,
          leased.startedAtMs,
          { ...leased, status: 'failed', error: 'provider timed out' },
          leased.startedAtMs + 1
        )
      },
    })
    expect(runs).toBe(1)
    expect((await store.findById('approval-1'))?.resultJson).toMatchObject({
      status: 'failed',
      error: 'provider timed out',
    })
  })

  it('does not clobber a completed result while attempting to lease', async () => {
    const store = await stored({ ...checkpoint(), status: 'completed' })
    let runs = 0
    await resumeMcpCampaignPack({
      ...dependencies,
      approvalStore: store,
      runChunk: async () => { runs += 1 },
    })
    expect(runs).toBe(0)
    expect((await store.findById('approval-1'))?.resultJson).toMatchObject({ status: 'completed' })
  })
})
