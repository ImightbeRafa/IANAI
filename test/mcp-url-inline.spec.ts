/**
 * G3 — workspace_save_url_context works with no cron: inline analysis within a budget, then a
 * jobId that workspace_url_context_status / get_execute_result resolve by running the work
 * inline on poll. Fakes only (no Supabase, no model, no network).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMcpUrlContextStatus, saveMcpUrlContext, type McpUrlIntakeStore, type McpUrlIntakeView } from '../api/lib/mcp/url-intake'
import { handleMcpJsonRpc } from '../api/lib/mcp/protocol'
import { createMemoryMcpApprovalStore } from '../api/lib/mcp/approval'
import { setMcpExecuteScheduler } from '../api/lib/mcp/execute-job'
import { claimMcpUrlIntakeById } from '../api/lib/mcp/url-analysis-worker'
import type { McpDbClient } from '../api/lib/mcp/user-tools'

const USER = 'user-1'
const BRAND = 'brand-1'

const db = {
  async getBusinessForUser(userId: string, brandId: string) {
    return userId === USER && brandId === BRAND ? { id: BRAND, name: 'Marca Demo', userId: USER } : null
  },
} as unknown as McpDbClient

/** Memory intake store; `analyze` decides how long one inline run takes and how it ends. */
function memoryStore(analyze: (attempt: number) => Promise<'ready' | 'failed' | 'hang'>) {
  const rows = new Map<string, McpUrlIntakeView & { userId: string }>()
  let runs = 0
  const store: McpUrlIntakeStore & { runs: () => number; rows: typeof rows } = {
    rows,
    runs: () => runs,
    async insertPendingUrlIntake(row) {
      const id = `intake-${rows.size + 1}`
      rows.set(id, { id, userId: row.userId, businessId: row.businessId, sourceUrl: row.sourceUrl, status: 'pending_analysis' })
      return { id }
    },
    async getUrlIntake({ id, userId }) {
      const row = rows.get(id)
      if (!row || row.userId !== userId) return null
      const { userId: _u, ...view } = row
      return view
    },
    async runUrlIntakeInline({ id, userId }) {
      const row = rows.get(id)
      if (!row || row.userId !== userId || row.status === 'ready' || row.status === 'failed') return { processed: false }
      runs++
      row.status = 'processing'
      const outcome = await analyze(runs)
      if (outcome === 'hang') return new Promise(() => {})
      row.status = outcome
      if (outcome === 'ready') row.analysis = { facts: { brandName: 'Marca Demo' }, warnings: [] }
      else row.errorMessage = 'fetch failed'
      return { processed: true, status: outcome }
    },
  }
  return store
}

afterEach(() => {
  setMcpExecuteScheduler((work) => {
    void work().catch(() => {})
  })
})

describe('G3 URL context without the cron', () => {
  it('finishes inline within the budget and returns the analysis', async () => {
    const store = memoryStore(async () => 'ready')
    const res = await saveMcpUrlContext({ db, store, user: { id: USER }, brandId: BRAND, url: 'https://example.com', budgetMs: 1_000 })
    expect(res).toMatchObject({ id: 'intake-1', jobId: 'intake-1', status: 'ready', moreWork: false, analysis: { facts: { brandName: 'Marca Demo' } } })
    expect(store.runs()).toBe(1)
  })

  it('past the budget returns a jobId; work keeps running in the background; a poll resolves it', async () => {
    let release: (v: 'ready') => void = () => {}
    const store = memoryStore((attempt) => (attempt === 1 ? new Promise((r) => { release = r }) : Promise.resolve('ready')))
    const scheduled: Array<() => Promise<unknown>> = []
    const res = await saveMcpUrlContext({ db, store, user: { id: USER }, brandId: BRAND, url: 'https://example.com', budgetMs: 10, schedule: (w) => scheduled.push(w) })
    expect(res).toMatchObject({ status: 'processing', jobId: 'intake-1', moreWork: true, nextTool: 'workspace_url_context_status' })
    expect(scheduled).toHaveLength(1) // kept alive (waitUntil), not dropped
    release('ready')
    await scheduled[0]()
    const polled = await getMcpUrlContextStatus({ store, user: { id: USER }, intakeId: 'intake-1', budgetMs: 1_000 })
    expect(polled).toMatchObject({ status: 'ready', moreWork: false })
  })

  it('a pending intake (e.g. the background task was dropped) is analyzed by the poll itself', async () => {
    const store = memoryStore(async () => 'ready')
    await saveMcpUrlContext({ db, store, user: { id: USER }, brandId: BRAND, url: 'https://example.com', wait: false })
    expect(store.rows.get('intake-1')?.status).toBe('pending_analysis')
    const polled = await getMcpUrlContextStatus({ store, user: { id: USER }, intakeId: 'intake-1', budgetMs: 1_000 })
    expect(polled).toMatchObject({ status: 'ready' })
    expect(store.runs()).toBe(1)
    // Other users never see it.
    expect(await getMcpUrlContextStatus({ store, user: { id: 'user-2' }, intakeId: 'intake-1' })).toBeNull()
  })

  it('failures are reported, not retried forever by the poll', async () => {
    const store = memoryStore(async () => 'failed')
    const res = await saveMcpUrlContext({ db, store, user: { id: USER }, brandId: BRAND, url: 'https://example.com', budgetMs: 1_000 })
    expect(res).toMatchObject({ status: 'failed', error: 'fetch failed', moreWork: false })
    await getMcpUrlContextStatus({ store, user: { id: USER }, intakeId: 'intake-1' })
    expect(store.runs()).toBe(1)
  })

  it('stores without the inline methods keep the queued (cron) behaviour', async () => {
    const store: McpUrlIntakeStore = { async insertPendingUrlIntake() { return { id: 'q1' } } }
    const res = await saveMcpUrlContext({ db, store, user: { id: USER }, brandId: BRAND, url: 'https://example.com' })
    expect(res).toEqual({ id: 'q1', businessId: BRAND, sourceUrl: 'https://example.com/', status: 'pending_analysis', deepLink: 'https://advanceai.studio/chat?brand=brand-1&intake=q1' })
  })

  it('MCP: workspace_url_context_status and get_execute_result { jobId } both resolve the intake', async () => {
    setMcpExecuteScheduler(() => {})
    const store = memoryStore(async (attempt) => (attempt === 1 ? 'hang' : 'ready'))
    const call = (name: string, args: Record<string, unknown>) =>
      handleMcpJsonRpc({
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
        user: { id: USER },
        db,
        urlIntakeStore: store,
        approvalStore: createMemoryMcpApprovalStore(),
      }).then((r) => JSON.parse((r.result as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>)

    const saved = await call('workspace_save_url_context', { brandId: BRAND, url: 'https://example.com', wait: false })
    expect(saved).toMatchObject({ id: 'intake-1', status: 'pending_analysis' })
    // First poll: the inline run hangs past the 25 s budget → 'processing' + keep polling.
    vi.useFakeTimers()
    const pending = call('workspace_url_context_status', { intakeId: 'intake-1' })
    await vi.advanceTimersByTimeAsync(26_000)
    const first = await pending
    vi.useRealTimers()
    expect(first).toMatchObject({ status: 'processing', moreWork: true })
    // Simulate the stale lease being reclaimable, then poll through get_execute_result.
    store.rows.get('intake-1')!.status = 'pending_analysis'
    const viaJob = await call('get_execute_result', { jobId: 'intake-1' })
    expect(viaJob).toMatchObject({ status: 'ready', toolName: 'workspace_save_url_context' })
    const viaStatus = await call('workspace_url_context_status', { intakeId: 'intake-1' })
    expect(viaStatus).toMatchObject({ status: 'ready' })
  })
})

describe('claimMcpUrlIntakeById (no RPC, owner-scoped CAS)', () => {
  function fakeDb(row: Record<string, unknown> | null, claimWins = true) {
    const updates: Array<{ patch: Record<string, unknown>; filters: unknown[][] }> = []
    const db = {
      updates,
      from: () => ({
        select: () => {
          const q: any = { eq: () => q, maybeSingle: async () => ({ data: row, error: null }) }
          return q
        },
        update: (patch: Record<string, unknown>) => {
          const rec = { patch, filters: [] as unknown[][] }
          updates.push(rec)
          const q: any = {
            eq: (...a: unknown[]) => { rec.filters.push(['eq', ...a]); return q },
            is: (...a: unknown[]) => { rec.filters.push(['is', ...a]); return q },
            select: async () => ({ data: claimWins ? [{ ...row, status: 'processing', claimed_at: patch.claimed_at }] : [], error: null }),
          }
          return q
        },
      }),
    }
    return db
  }
  const base = { id: 'i1', user_id: USER, business_id: BRAND, source_url: 'https://example.com', attempt_count: 0 }

  it('claims a pending row with a CAS on status + null claimed_at', async () => {
    const db = fakeDb({ ...base, status: 'pending_analysis', claimed_at: null })
    const claimed = await claimMcpUrlIntakeById(db as never, { id: 'i1', userId: USER, nowMs: Date.parse('2026-10-08T00:00:00Z') })
    expect(claimed).toMatchObject({ id: 'i1', status: 'processing' })
    expect(db.updates[0].patch).toMatchObject({ status: 'processing', attempt_count: 1, claimed_at: '2026-10-08T00:00:00.000Z' })
    expect(db.updates[0].filters).toEqual(expect.arrayContaining([['eq', 'user_id', USER], ['eq', 'status', 'pending_analysis'], ['is', 'claimed_at', null]]))
  })

  it('skips a fresh lease, a final row and a lost race', async () => {
    const now = Date.parse('2026-10-08T00:01:00Z')
    expect(await claimMcpUrlIntakeById(fakeDb({ ...base, status: 'processing', claimed_at: '2026-10-08T00:00:30Z' }) as never, { id: 'i1', userId: USER, nowMs: now })).toEqual({ skipped: 'in_progress' })
    expect(await claimMcpUrlIntakeById(fakeDb({ ...base, status: 'ready', claimed_at: null }) as never, { id: 'i1', userId: USER, nowMs: now })).toEqual({ skipped: 'already_final' })
    expect(await claimMcpUrlIntakeById(fakeDb(null) as never, { id: 'i1', userId: USER, nowMs: now })).toEqual({ skipped: 'not_found' })
    expect(await claimMcpUrlIntakeById(fakeDb({ ...base, status: 'pending_analysis', claimed_at: null }, false) as never, { id: 'i1', userId: USER, nowMs: now })).toEqual({ skipped: 'lease_lost' })
    // A stale lease (older than the window) is reclaimable.
    const stale = fakeDb({ ...base, status: 'processing', claimed_at: '2026-10-07T00:00:00Z' })
    expect(await claimMcpUrlIntakeById(stale as never, { id: 'i1', userId: USER, nowMs: now })).toMatchObject({ status: 'processing' })
    expect(stale.updates[0].filters).toEqual(expect.arrayContaining([['eq', 'claimed_at', '2026-10-07T00:00:00Z']]))
  })
})
