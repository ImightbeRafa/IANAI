import { describe, expect, it } from 'vitest'
import {
  approveMcpApprovalRequest,
  consumeMcpApprovalRequest,
  createMemoryMcpApprovalStore,
  denyMcpApprovalRequest,
  issueMcpApprovalRequest,
  MCP_APPROVAL_TTL_MS,
} from '../api/lib/mcp/approval'

describe('mcp web approval flow', () => {
  it('requires web approve before consume; denies replay and input drift', async () => {
    const store = createMemoryMcpApprovalStore()
    const input = { brandId: 'b1', language: 'es' }
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input,
      quotedCreditCost: 1,
      nowMs: 1_000,
      appOrigin: 'https://advanceai.studio',
    })
    expect(issued.status).toBe('approval_required')
    expect(issued.deepLink).toContain('/mcp/approve/')
    expect(issued.expiresAtMs - 1_000).toBe(MCP_APPROVAL_TTL_MS)

    const premature = await consumeMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input,
      nowMs: 2_000,
    })
    expect(premature.ok).toBe(false)

    const approved = await approveMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
      nowMs: 3_000,
    })
    expect(approved.ok).toBe(true)

    const ok = await consumeMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input: { ...input, approvalRequestId: issued.approvalRequestId },
      nowMs: 4_000,
    })
    expect(ok.ok).toBe(true)

    const replay = await consumeMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input,
      nowMs: 5_000,
    })
    expect(replay.ok).toBe(false)
  })

  it('denies after deny', async () => {
    const store = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input: { brandId: 'b1', aspectRatio: '9:16' },
      nowMs: 10,
    })
    const denied = await denyMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
      nowMs: 20,
    })
    expect(denied.ok).toBe(true)
    const consume = await consumeMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input: { brandId: 'b1', aspectRatio: '9:16' },
      nowMs: 30,
    })
    expect(consume.ok).toBe(false)
  })
})
