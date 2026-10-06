import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Keep both success and failure patches empty so the businesses/brand_kits
// update branches are skipped entirely — this test is about the
// mcp_url_intakes lease guard, not the merge logic (already covered by
// test/mcp-url-analysis-merge.spec.ts).
vi.mock('../api/lib/mcp/url-analysis-merge.js', () => ({
  buildFillOnlyBusinessPatch: vi.fn(() => ({})),
  buildFillOnlyBrandKitPatchWithReview: vi.fn(() => ({ patch: {}, reviewRequired: false, warnings: [] })),
  sanitizeWorkerError: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}))

vi.mock('../api/lib/site-analysis.js', () => ({
  SITE_ANALYSIS_MODEL: 'test-site-analysis-model',
  runSiteAnalysis: vi.fn(async () => ({
    analysis: {
      facts: {},
      evidence: {},
      pages: [],
      assets: { logoCandidates: [], faviconCandidates: [], imageCandidates: [], colors: [], fonts: [] },
      warnings: [],
    },
    usage: { input: 1, output: 1, thinking: 0 },
  })),
}))

vi.mock('../api/lib/usage-logger.js', () => ({
  logApiUsage: vi.fn(async () => undefined),
}))

vi.mock('../api/lib/url-safety.js', () => ({
  assertPublicHttpUrl: vi.fn(),
}))

vi.mock('../api/lib/supabase-admin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}))

import { getSupabaseAdmin } from '../api/lib/supabase-admin.js'
import { assertPublicHttpUrl } from '../api/lib/url-safety.js'
import { processNextMcpUrlIntake } from '../api/lib/mcp/url-analysis-worker.js'

const CLAIMED_AT = '2026-01-01T00:00:00.000Z'

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intake-1',
    user_id: 'user-1',
    business_id: 'biz-1',
    source_url: 'https://example.test/',
    status: 'processing',
    attempt_count: 1,
    claimed_at: CLAIMED_AT,
    ...overrides,
  }
}

// A fixed-result select chain: .eq()/.order()/.limit() all return itself,
// .maybeSingle() resolves to the given result. Good enough for the
// businesses and brand_kits reads, which this test doesn't care about.
function selectChain(result: { data: unknown; error: unknown }) {
  const builder: any = {
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => result,
  }
  return builder
}

interface UpdateRecord {
  patch: Record<string, unknown>
  eq: unknown[][]
}

function makeUpdateRecorder(records: UpdateRecord[], result: { error: unknown } = { error: null }) {
  return (patch: Record<string, unknown>) => {
    const record: UpdateRecord = { patch, eq: [] }
    records.push(record)
    const builder: any = {
      eq: (...args: unknown[]) => {
        record.eq.push(args)
        return builder
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    }
    return builder
  }
}

function makeFakeDb(row: ReturnType<typeof claimedRow>, intakeUpdates: UpdateRecord[]) {
  return {
    rpc: vi.fn(async () => ({ data: row, error: null })),
    from: vi.fn((table: string) => {
      if (table === 'businesses') {
        return { select: () => selectChain({ data: { id: 'biz-1', owner_id: 'user-1', name: 'Biz' }, error: null }) }
      }
      if (table === 'brand_kits') {
        return { select: () => selectChain({ data: { id: 'kit-1' }, error: null }) }
      }
      if (table === 'mcp_url_intakes') {
        return { update: makeUpdateRecorder(intakeUpdates) }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  }
}

describe('processNextMcpUrlIntake lease guard (SD-06)', () => {
  beforeEach(() => {
    vi.mocked(assertPublicHttpUrl).mockReset()
  })

  afterEach(() => {
    vi.mocked(getSupabaseAdmin).mockReset()
  })

  it('the success update filters on id, status=processing, and claimed_at=<row.claimed_at>', async () => {
    const row = claimedRow()
    const intakeUpdates: UpdateRecord[] = []
    const fakeDb = makeFakeDb(row, intakeUpdates)
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeDb as any)

    const result = await processNextMcpUrlIntake()

    expect(result).toEqual({ processed: true, intakeId: row.id, status: 'ready', brandKitId: 'kit-1' })
    expect(intakeUpdates).toHaveLength(1)
    expect(intakeUpdates[0].patch.status).toBe('ready')
    expect(intakeUpdates[0].eq).toEqual([
      ['id', row.id],
      ['status', 'processing'],
      ['claimed_at', row.claimed_at],
    ])
  })

  it('the failure update filters on id, status=processing, and claimed_at=<row.claimed_at>', async () => {
    const row = claimedRow({ attempt_count: 1 })
    const intakeUpdates: UpdateRecord[] = []
    const fakeDb = makeFakeDb(row, intakeUpdates)
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeDb as any)
    vi.mocked(assertPublicHttpUrl).mockImplementation(() => {
      throw new Error('blocked url')
    })

    const result = await processNextMcpUrlIntake()

    expect(result).toEqual({ processed: true, intakeId: row.id, status: 'failed' })
    expect(intakeUpdates).toHaveLength(1)
    expect(intakeUpdates[0].patch.status).toBe('pending_analysis')
    expect(intakeUpdates[0].patch.error_message).toBe('blocked url')
    expect(intakeUpdates[0].eq).toEqual([
      ['id', row.id],
      ['status', 'processing'],
      ['claimed_at', row.claimed_at],
    ])
  })

  it('the terminal failure update (max attempts) still carries the same lease filter', async () => {
    const row = claimedRow({ attempt_count: 3 })
    const intakeUpdates: UpdateRecord[] = []
    const fakeDb = makeFakeDb(row, intakeUpdates)
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeDb as any)
    vi.mocked(assertPublicHttpUrl).mockImplementation(() => {
      throw new Error('blocked url')
    })

    const result = await processNextMcpUrlIntake()

    expect(result).toEqual({ processed: true, intakeId: row.id, status: 'failed' })
    expect(intakeUpdates[0].patch.status).toBe('failed')
    expect(intakeUpdates[0].eq).toEqual([
      ['id', row.id],
      ['status', 'processing'],
      ['claimed_at', row.claimed_at],
    ])
  })
})
