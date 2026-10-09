/**
 * F1 for bulk tools: what was approved (count + credits) is exactly what runs; a smaller angle
 * board or a missing selected angle answers PLAN_CHANGED and generates nothing. Fakes only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const board = vi.hoisted(() => ({ angles: [] as Array<Record<string, unknown>> }))
const runs = vi.hoisted(() => ({ scripts: 0 }))

vi.mock('../api/lib/bulk/store.js', () => ({
  listRecentScriptSummaries: vi.fn(async () => []),
  listProductRefUrls: vi.fn(async () => []),
  listStyleDnasForBrand: vi.fn(async () => ({ kitId: null, styleDnas: [] })),
  saveStyleDnaForBrand: vi.fn(),
}))

vi.mock('../api/lib/bulk/angle-orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/lib/bulk/angle-orchestrator.js')>()
  return { ...actual, orchestrateAngles: vi.fn(async () => ({ angles: board.angles, count: board.angles.length })) }
})

vi.mock('../api/lib/bulk/run-bulk.js', () => ({
  runBulkScripts: vi.fn(async () => {
    runs.scripts++
    return { items: [], succeeded: 0, charged: 0, packId: 'p', sessionId: 's' }
  }),
  runBulkPosts: vi.fn(),
  deepLinkForPack: vi.fn(() => 'https://advanceai.studio/chat'),
}))

import { mcpExecuteBulkScripts } from '../api/lib/mcp/bulk-tools'
import { createMemoryMcpApprovalStore } from '../api/lib/mcp/approval'
import { mcpConfirmExecute } from '../api/lib/mcp/confirm-execute'
import { getMcpExecuteResult, setMcpExecuteScheduler } from '../api/lib/mcp/execute-job'
import type { McpArtifactStore } from '../api/lib/mcp/artifact-store'
import type { McpDbClient } from '../api/lib/mcp/user-tools'

const db = {
  async getBusinessForUser(userId: string, brandId: string) {
    return userId === 'u1' && brandId === 'b1' ? { id: 'b1', name: 'Marca Demo', userId: 'u1' } : null
  },
  async listOffersForBrand() {
    return [{ id: 'o1', name: 'Oferta Demo' }]
  },
  async getBrandKitForBrand() {
    return null
  },
} as unknown as McpDbClient

const angle = (id: string) => ({ id, title: id, niche: 'n', whyItBuys: 'w', hookStyle: 'direct', frameworkHint: 'venta_directa' })

let work: Array<() => Promise<void>> = []
beforeEach(() => {
  work = []
  runs.scripts = 0
  setMcpExecuteScheduler((w) => {
    work.push(w)
  })
})
afterEach(() => {
  setMcpExecuteScheduler((w) => {
    void w().catch(() => {})
  })
})

async function approvedRun(args: Record<string, unknown>) {
  const approvalStore = createMemoryMcpApprovalStore()
  const base = { db, approvalStore, artifactStore: {} as McpArtifactStore, user: { id: 'u1' } }
  const prompt = await mcpExecuteBulkScripts({ ...base, args })
  const approvalRequestId = String(prompt.approvalRequestId)
  await mcpConfirmExecute({ approvalStore, user: { id: 'u1' }, args: { approvalRequestId, action: 'approve' } })
  await mcpExecuteBulkScripts({ ...base, args: { ...args, approvalRequestId } })
  for (const w of work) await w()
  const result = await getMcpExecuteResult({ approvalStore, userId: 'u1', jobId: approvalRequestId })
  return { prompt, result, record: await approvalStore.findById(approvalRequestId) }
}

describe('bulk F1 plan guard', () => {
  it('approval shows items × unitCost; a smaller board answers PLAN_CHANGED and generates nothing', async () => {
    board.angles = [angle('angle_1')]
    const { prompt, result, record } = await approvedRun({ brandId: 'b1', count: 2 })
    expect(prompt.approval).toMatchObject({ items: 2, unitCost: 3, total: 6 })
    expect(result).toMatchObject({ status: 'failed', code: 'PLAN_CHANGED', approved: { items: 2, total: 6 }, planned: { items: 1, total: 3 }, chargedCredits: 0 })
    expect(runs.scripts).toBe(0)
    expect(record?.status).toBe('denied')
  })

  it('selected angles missing from the board are never swapped for others', async () => {
    board.angles = [angle('angle_1'), angle('angle_2'), angle('angle_3')]
    const { result } = await approvedRun({ brandId: 'b1', angleIds: ['angle_2', 'angle_9'] })
    expect(result).toMatchObject({ status: 'failed', code: 'PLAN_CHANGED', approved: { items: 2 }, planned: { items: 1 } })
    expect(runs.scripts).toBe(0)
  })

  it('count defaults to the number of selected angles and runs exactly those', async () => {
    board.angles = [angle('angle_1'), angle('angle_2'), angle('angle_3')]
    const { prompt } = await approvedRun({ brandId: 'b1', angleIds: ['angle_3', 'angle_1'] })
    expect(prompt.approval).toMatchObject({ items: 2, total: 6 })
    expect(runs.scripts).toBe(1)
  })
})
