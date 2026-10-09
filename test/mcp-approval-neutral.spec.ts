/**
 * F2 / item 6 — every approval prompt across the MCP tools is neutral and structured:
 * no "Yo (Grok)" / first-person agent voice, no web fallback link, and the payload always carries
 * approval { items, unitCost, total, currency, expiresAt, summary }.
 *
 * Two layers: (1) every tool that requires approval goes through ONE builder (static scan of
 * api/lib/mcp/*.ts — no hand-rolled approval_required payloads, no includeWebFallback), and the
 * builder output is checked for each of those tools in ES and EN; (2) a real adpack_start /
 * adpack_regenerate round-trip through the MCP entry (create_ads: the journey test).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setMcpExecuteScheduler } from '../api/lib/mcp/execute-job'
import { buildMcpApprovalRequiredPayload } from '../api/lib/mcp/approval-prompt'
import { MCP_TOOL_REGISTRY } from '../api/lib/mcp/tool-registry'
import { PER_AD, USER_A, callMcp, createDoorEnv, createMemoryMcpApprovalStore, mcpStartApproved, serum } from './adpack/door-harness'

const MCP_DIR = join(__dirname, '..', 'api', 'lib', 'mcp')
/** Source without comments (doc comments may quote the old persona wording as an example). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const sources = readdirSync(MCP_DIR).filter((f) => f.endsWith('.ts')).map((f) => ({ file: f, text: code(readFileSync(join(MCP_DIR, f), 'utf8')) }))

const PERSONA = /\bYo \(Grok\)|\bI \(Grok\)|\bYo,? Grok\b|\bsoy Grok\b|\bI am Grok\b|\bI'm Grok\b/i
const LINK = /https?:\/\//

function assertNeutral(payload: Record<string, unknown>) {
  const shown = [payload.userPrompt, payload.userPromptEs, payload.userPromptEn, payload.message].map(String).join('\n')
  expect(shown).not.toMatch(PERSONA)
  expect(shown).not.toMatch(/\bGrok\b/)
  expect(shown).not.toMatch(LINK)
  expect(payload).not.toHaveProperty('webFallbackUrl')
  expect(payload).not.toHaveProperty('deepLink')
  expect(payload).not.toHaveProperty('optionalAdvancePage')
  const approval = payload.approval as Record<string, unknown>
  expect(Object.keys(approval).sort()).toEqual(['currency', 'expiresAt', 'items', 'summary', 'total', 'unitCost'])
  expect(approval).toMatchObject({ items: expect.any(Number), unitCost: expect.any(Number), total: expect.any(Number), currency: 'credits', expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), summary: expect.any(String) })
  expect(Number(approval.items) * Number(approval.unitCost)).toBeCloseTo(Number(approval.total), 5)
}

describe('approval prompts are neutral and structured (static scan + builder)', () => {
  const approvalTools = MCP_TOOL_REGISTRY.filter((t) => t.requiresApproval).map((t) => t.name)

  it('no MCP source carries an agent persona or a hand-rolled approval payload', () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(PERSONA)
      if (file === 'approval.ts' || file === 'approval-prompt.ts') continue
      // approval_required payloads are only built by approval-prompt.ts (issueMcpChatApproval).
      expect(text, file).not.toMatch(/status:\s*['"]approval_required['"]/)
      expect(text, file).not.toMatch(/includeWebFallback:\s*true/)
      expect(text, file).not.toMatch(/webFallbackUrl/)
    }
  })

  it('every tool that issues approvals uses the shared builder', () => {
    const issuers = sources.filter(({ text }) => /issueMcpChatApproval\(/.test(text)).map((s) => s.file)
    expect(issuers.sort()).toEqual(['adpack-tools.ts', 'approval-prompt.ts', 'brand-kit-tools.ts', 'bulk-tools.ts', 'delete-tools.ts', 'execute-tools.ts'])
    // Every approval-requiring tool lives in one of those modules (create_ads routes to adpack/carousel/edit).
    const routed = new Set(['create_ads'])
    for (const name of approvalTools) {
      if (routed.has(name)) continue
      const owner = sources.find(({ file, text }) => file !== 'tool-registry.ts' && file !== 'protocol.ts' && text.includes(`'${name}'`) && /issueMcpChatApproval\(/.test(text))
      expect(owner, name).toBeTruthy()
    }
  })

  it.each(['es', 'en'] as const)('builder output for every approval tool (%s)', (language) => {
    for (const toolName of approvalTools) {
      const payload = buildMcpApprovalRequiredPayload({
        approvalRequestId: 'req-1',
        expiresAtMs: Date.UTC(2026, 9, 8, 18, 0),
        deepLink: 'https://advanceai.studio/mcp/approve/req-1',
        toolName,
        quotedCreditCost: toolName.startsWith('delete') || toolName === 'archive_brand' ? 0 : 12,
        items: toolName.startsWith('delete') || toolName === 'archive_brand' ? 1 : 2,
        language,
      })
      assertNeutral(payload)
      expect(String(payload.userPrompt)).toMatch(language === 'es' ? /Confirmación requerida/ : /Confirmation required/)
    }
  })
})

describe('approval prompts through the MCP entry (adpack_start, adpack_regenerate; create_ads: mcp-journey-content-agent.spec.ts)', () => {
  beforeAll(() => setMcpExecuteScheduler(() => {}))
  afterAll(() => setMcpExecuteScheduler((work) => {
    void work().catch(() => {})
  }))

  it('pack approvals are neutral, structured and exact', async () => {
    const e = { ...createDoorEnv(), approvalStore: createMemoryMcpApprovalStore() }
    const start = await callMcp(e, USER_A, 'adpack_start', { dna: serum.dna, offer: serum.offer, size: 2 })
    expect(start.payload.status).toBe('approval_required')
    assertNeutral(start.payload)
    expect(start.payload.approval).toMatchObject({ items: 2, unitCost: PER_AD, total: 2 * PER_AD })

    const { started } = await mcpStartApproved(e, USER_A, { dna: serum.dna, offer: serum.offer, size: 1 })
    const packId = String(started.payload.packId)
    let status = await callMcp(e, USER_A, 'adpack_status', { packId })
    for (let i = 0; i < 5 && status.payload.moreWork; i++) status = await callMcp(e, USER_A, 'adpack_status', { packId })
    const itemId = String((status.payload.deliverable as { ads: Array<{ itemId: string }> }).ads[0].itemId)
    const regen = await callMcp(e, USER_A, 'adpack_regenerate', { packId, itemId })
    expect(regen.payload.status).toBe('approval_required')
    assertNeutral(regen.payload)
    expect(regen.payload.approval).toMatchObject({ items: 1, unitCost: PER_AD, total: PER_AD })
  })
})
