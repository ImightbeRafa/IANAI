import { describe, expect, it } from 'vitest'
import {
  createMemoryMcpApprovalStore,
} from '../api/lib/mcp/approval'
import {
  buildMcpApprovalRequiredPayload,
  issueMcpChatApproval,
} from '../api/lib/mcp/approval-prompt'
import { mcpConfirmExecute } from '../api/lib/mcp/confirm-execute'
import { handleMcpJsonRpc, MCP_SERVER_INFO } from '../api/lib/mcp/protocol'
import { listEnabledMcpTools } from '../api/lib/mcp/tool-registry'
import { MCP_MUTATION_POLICY } from '../api/lib/mcp/user-tools'

describe('mcp in-chat approval (confirm_execute)', () => {
  it('exposes confirm_execute and chat-first policy', () => {
    expect(MCP_SERVER_INFO.version).toBe('0.9.1')
    expect(MCP_MUTATION_POLICY.executeApprovalSurface).toBe('grok_chat')
    expect(listEnabledMcpTools().some((t) => t.name === 'confirm_execute')).toBe(true)
  })

  it('buildMcpApprovalRequiredPayload leads with chat prompt, not raw deepLink', () => {
    const payload = buildMcpApprovalRequiredPayload({
      approvalRequestId: 'req-1',
      expiresAtMs: 9_000,
      deepLink: 'https://advanceai.studio/mcp/approve/req-1',
      toolName: 'execute_script_generate',
      quotedCreditCost: 3,
      language: 'es',
      boundInput: { brandId: 'b1' },
    })
    expect(payload.status).toBe('approval_required')
    expect(payload.approvalSurface).toBe('grok_chat')
    expect(payload.nextTool).toBe('confirm_execute')
    expect(String(payload.userPrompt)).toContain('confirmación requerida')
    expect(String(payload.userPrompt)).toContain('sí')
    expect(payload).not.toHaveProperty('deepLink')
    expect(payload.optionalAdvancePage).toContain('/mcp/approve/req-1')
    expect(String(payload.message)).not.toMatch(/Open deepLink/i)
    expect(String(payload.instructionsForGrok)).toContain('Do NOT paste')
  })

  it('issueMcpChatApproval + confirm_execute approve/deny round-trip', async () => {
    const store = createMemoryMcpApprovalStore()
    const user = { id: 'user-a' }
    const pending = await issueMcpChatApproval({
      approvalStore: store,
      userId: user.id,
      toolName: 'execute_image_generate',
      input: { brandId: 'b1' },
      quotedCreditCost: 6,
      language: 'en',
    })
    expect(pending.status).toBe('approval_required')
    expect(String(pending.userPrompt)).toContain('confirmation required')

    const approved = await mcpConfirmExecute({
      approvalStore: store,
      user,
      args: {
        approvalRequestId: pending.approvalRequestId as string,
        action: 'approve',
      },
    })
    expect(approved.status).toBe('approved')
    expect(approved.nextStep).toBe('retry_original_tool')
    expect(String(approved.message)).toContain('retry')
    expect(String(approved.message)).not.toMatch(/Open deepLink/i)

    const store2 = createMemoryMcpApprovalStore()
    const pending2 = await issueMcpChatApproval({
      approvalStore: store2,
      userId: user.id,
      toolName: 'execute_script_generate',
      input: { brandId: 'b1' },
      quotedCreditCost: 3,
    })
    const denied = await mcpConfirmExecute({
      approvalStore: store2,
      user,
      args: {
        approvalRequestId: pending2.approvalRequestId as string,
        decision: 'cancelar',
      },
    })
    expect(denied.status).toBe('denied')
  })

  it('tools/call confirm_execute works through the host', async () => {
    const store = createMemoryMcpApprovalStore()
    const pending = await issueMcpChatApproval({
      approvalStore: store,
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input: { brandId: 'b1' },
      quotedCreditCost: 3,
    })

    const res = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'confirm_execute',
          arguments: {
            approvalRequestId: pending.approvalRequestId,
            action: 'sí',
          },
        },
      },
      user: { id: 'user-a' },
      db: {
        async listBusinessesForUser() { return [] },
        async getBusinessForUser() { return null },
        async listOffersForBrand() { return [] },
        async getBrandKit() { return null },
      },
      approvalStore: store,
    })
    expect(res.result).toMatchObject({ isError: false })
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text
    expect(text).toContain('"status": "approved"')
  })
})
