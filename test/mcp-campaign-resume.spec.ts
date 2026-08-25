import { describe, expect, it } from 'vitest'
import {
  isCampaignCheckpoint,
  isCampaignChunkLeasable,
} from '../api/lib/mcp/bulk-tools'
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
})
