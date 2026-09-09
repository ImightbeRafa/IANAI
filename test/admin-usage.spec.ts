import { describe, expect, it } from 'vitest'
import {
  aggregateDailyUsage,
  aggregateUsageSummary,
  aggregateUserUsageStats,
  buildCreditsByGenerationId,
  buildCreditsEconomics,
  buildUsageCoverage,
  estimateOfficialApiCostUsd,
  fetchAllPagedRows,
  paginateUsageLogs,
  resolveAdminUsageWindow,
  resolveUsageLogSource,
  type AdminUsageLogRow,
} from '../api/lib/admin-usage'
import { estimateGrokImageCostUsd } from '../api/lib/grok-models'

function log(partial: Partial<AdminUsageLogRow> & Pick<AdminUsageLogRow, 'id' | 'feature' | 'model' | 'created_at'>): AdminUsageLogRow {
  return {
    user_id: 'user-1',
    user_email: 'ryan@example.com',
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    estimated_cost_usd: 0.01,
    success: true,
    ...partial,
  }
}

describe('estimateOfficialApiCostUsd', () => {
  it('uses Imagine 2.0 $0.04/out + $0.01/input ref', () => {
    expect(
      estimateOfficialApiCostUsd(
        log({
          id: '1',
          feature: 'edit',
          model: 'grok-imagine',
          created_at: '2026-08-14T10:00:00.000Z',
          estimated_cost_usd: 0.12,
          metadata: { referenceCount: 2 },
        })
      )
    ).toBe(0.06)
  })

  it('uses Grok text $2/$6 per 1M below the 200k long-context band', () => {
    expect(
      estimateOfficialApiCostUsd(
        log({
          id: '2',
          feature: 'script',
          model: 'grok-4.6',
          created_at: '2026-08-14T10:00:00.000Z',
          input_tokens: 100_000,
          output_tokens: 100_000,
          estimated_cost_usd: 9,
        })
      )
    ).toBe(0.8)
  })

  it('uses Banana stored cost when tokens are missing', () => {
    expect(
      estimateOfficialApiCostUsd(
        log({
          id: '3',
          feature: 'image',
          model: 'nano-banana-pro',
          created_at: '2026-08-14T10:00:00.000Z',
          estimated_cost_usd: 0.134,
          input_tokens: 0,
          output_tokens: 0,
        })
      )
    ).toBe(0.134)
  })

  it('uses official Grok 4.3 $1.25/$2.50 not the 4.6 band', () => {
    expect(
      estimateOfficialApiCostUsd(
        log({
          id: '4',
          feature: 'script',
          model: 'grok-4.3',
          created_at: '2026-08-14T10:00:00.000Z',
          input_tokens: 100_000,
          output_tokens: 100_000,
          estimated_cost_usd: 8,
        })
      )
    ).toBe(0.375)
  })

  it('applies Grok long-context rates when prompt is >= 200k', () => {
    expect(
      estimateOfficialApiCostUsd(
        log({
          id: '5',
          feature: 'script',
          model: 'grok-4.6',
          created_at: '2026-08-14T10:00:00.000Z',
          input_tokens: 200_000,
          output_tokens: 1_000,
          estimated_cost_usd: 0.4,
        })
      )
    ).toBe(0.812)
  })

  it('uses Gemini 2.5 Flash $0.30/$2.50 including thinking as output', () => {
    expect(
      estimateOfficialApiCostUsd(
        log({
          id: '6',
          feature: 'brand_extraction',
          model: 'gemini-2.5-flash',
          created_at: '2026-08-14T10:00:00.000Z',
          input_tokens: 1_000_000,
          output_tokens: 500_000,
          estimated_cost_usd: 0.15,
          metadata: { thinkingTokens: 500_000 },
        })
      )
    ).toBe(2.8)
  })

  it('uses official Flash Image $0.039 + input tokens', () => {
    expect(
      estimateOfficialApiCostUsd(
        log({
          id: '7',
          feature: 'image',
          model: 'nano-banana',
          created_at: '2026-08-14T10:00:00.000Z',
          input_tokens: 1_000_000,
          output_tokens: 0,
          estimated_cost_usd: 0.02,
        })
      )
    ).toBe(0.339)
  })

  it('uses GPT Image 2 token split from metadata', () => {
    expect(
      estimateOfficialApiCostUsd(
        log({
          id: '8',
          feature: 'image',
          model: 'gpt-image-2',
          created_at: '2026-08-14T10:00:00.000Z',
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          metadata: { textInputTokens: 1_000_000, imageInputTokens: 1_000_000, imageOutputTokens: 1_000_000 },
        })
      )
    ).toBe(43)
  })
})

describe('estimateGrokImageCostUsd', () => {
  it('matches official Imagine 2.0 list', () => {
    expect(estimateGrokImageCostUsd({ outputImages: 1, referenceCount: 0 })).toBe(0.04)
    expect(estimateGrokImageCostUsd({ outputImages: 1, referenceCount: 2 })).toBe(0.06)
  })
})

describe('aggregateUsageSummary', () => {
  it('groups by model and feature and sums cost', () => {
    const summary = aggregateUsageSummary([
      log({ id: '1', feature: 'brand_extraction', model: 'gemini-2.5-flash', created_at: '2026-08-14T10:00:00.000Z', estimated_cost_usd: 0.02 }),
      log({ id: '2', feature: 'brand_extraction', model: 'gemini-2.5-flash', created_at: '2026-08-14T11:00:00.000Z', estimated_cost_usd: 0.03, success: false }),
      log({ id: '3', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T12:00:00.000Z', estimated_cost_usd: 0.10, input_tokens: 0, output_tokens: 0 }),
    ])

    expect(summary).toHaveLength(2)
    expect(summary[0]).toMatchObject({
      model: 'grok-4.6',
      feature: 'script',
      total_calls: 1,
      successful_calls: 1,
      failed_calls: 0,
      total_cost_usd: 0.1,
      estimated_api_cost_usd: 0.1,
    })
    expect(summary[1]).toMatchObject({
      model: 'gemini-2.5-flash',
      feature: 'brand_extraction',
      total_calls: 2,
      successful_calls: 1,
      failed_calls: 1,
      total_cost_usd: 0.05,
    })
  })

  it('joins credits charged via generation_id', () => {
    const credits = buildCreditsByGenerationId([
      { generation_id: 'g1', credits: 6 },
      { generation_id: 'g2', credits: 18 },
    ])
    const summary = aggregateUsageSummary(
      [
        log({
          id: '1',
          feature: 'image',
          model: 'grok-imagine',
          created_at: '2026-08-14T10:00:00.000Z',
          generation_id: 'g1',
          estimated_cost_usd: 0.08,
          metadata: { referenceCount: 1 },
        }),
        log({
          id: '2',
          feature: 'enhance',
          model: 'grok-imagine',
          created_at: '2026-08-14T11:00:00.000Z',
          generation_id: 'g2',
          estimated_cost_usd: 0.16,
          metadata: { referenceCount: 3 },
        }),
      ],
      credits
    )

    expect(summary.find((r) => r.feature === 'image')).toMatchObject({
      total_credits: 6,
      estimated_api_cost_usd: 0.05,
    })
    expect(summary.find((r) => r.feature === 'enhance')).toMatchObject({
      total_credits: 18,
      estimated_api_cost_usd: 0.07,
    })
  })
})

describe('buildCreditsEconomics', () => {
  it('totals credits vs estimated API $ and implied $/credit', () => {
    const rows = [
      log({
        id: '1',
        feature: 'image',
        model: 'grok-imagine',
        created_at: '2026-08-14T10:00:00.000Z',
        generation_id: 'g1',
        estimated_cost_usd: 0.04,
        metadata: { referenceCount: 0 },
      }),
    ]
    const economics = buildCreditsEconomics({
      rows,
      ledger: [{ generation_id: 'g1', credits: 6 }],
      creditsInCirculation: 100,
      creditCogsUsd: 0.01,
    })
    expect(economics.creditsConsumed).toBe(6)
    expect(economics.estimatedApiCostUsd).toBe(0.04)
    expect(economics.impliedUsdPerCredit).toBeCloseTo(0.04 / 6, 6)
    expect(economics.creditsInCirculation).toBe(100)
    expect(economics.estimateNote.toLowerCase()).toContain('not a provider invoice')
  })
})

describe('aggregateDailyUsage', () => {
  it('groups by UTC day and model', () => {
    const daily = aggregateDailyUsage([
      log({ id: '1', feature: 'url_fetch', model: 'web-scraper', created_at: '2026-08-13T23:00:00.000Z', estimated_cost_usd: 0 }),
      log({ id: '2', feature: 'url_fetch', model: 'web-scraper', created_at: '2026-08-14T01:00:00.000Z', estimated_cost_usd: 0 }),
      log({ id: '3', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T02:00:00.000Z', estimated_cost_usd: 0.2, input_tokens: 0, output_tokens: 0 }),
    ])

    expect(daily.map(row => `${row.day}:${row.model}:${row.total_calls}`)).toEqual([
      '2026-08-14:grok-4.6:1',
      '2026-08-14:web-scraper:1',
      '2026-08-13:web-scraper:1',
    ])
  })
})

describe('aggregateUserUsageStats', () => {
  it('counts ingest features separately and ignores failed rows', () => {
    const stats = aggregateUserUsageStats([
      log({ id: '1', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T10:00:00.000Z', estimated_cost_usd: 0.08, input_tokens: 0, output_tokens: 0 }),
      log({ id: '2', feature: 'script_edit', model: 'grok-4.6', created_at: '2026-08-14T11:00:00.000Z', estimated_cost_usd: 0.02, input_tokens: 0, output_tokens: 0 }),
      log({ id: '3', feature: 'brand_extraction', model: 'gemini-2.5-flash', created_at: '2026-08-14T12:00:00.000Z', estimated_cost_usd: 0.04, input_tokens: 0, output_tokens: 0 }),
      log({ id: '4', feature: 'url_fetch', model: 'web-scraper', created_at: '2026-08-14T13:00:00.000Z', estimated_cost_usd: 0 }),
      log({ id: '5', feature: 'image', model: 'nano-banana', created_at: '2026-08-14T14:00:00.000Z', estimated_cost_usd: 0.03, success: false }),
      log({ id: '6', feature: 'reply', model: 'grok-4.6', created_at: '2026-08-14T15:00:00.000Z', estimated_cost_usd: 0.01, input_tokens: 0, output_tokens: 0 }),
    ])

    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({
      user_id: 'user-1',
      script_calls: 2,
      ingest_calls: 2,
      image_calls: 0,
      other_calls: 1,
      total_calls: 5,
      total_cost_usd: 0.15,
    })
  })
})

describe('paginateUsageLogs', () => {
  it('filters by email and reports hasMore', () => {
    const rows = [
      log({ id: '1', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T12:00:00.000Z', user_email: 'a@x.com' }),
      log({ id: '2', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T11:00:00.000Z', user_email: 'b@x.com' }),
      log({ id: '3', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T10:00:00.000Z', user_email: 'a@x.com' }),
    ]

    const page = paginateUsageLogs(rows, { search: 'a@', offset: 0, limit: 1 })
    expect(page.logs).toHaveLength(1)
    expect(page.logs[0].id).toBe('1')
    expect(page.hasMore).toBe(true)

    const next = paginateUsageLogs(rows, { search: 'a@', offset: 1, limit: 1 })
    expect(next.logs[0].id).toBe('3')
    expect(next.hasMore).toBe(false)
  })

  it('filters by source and treats missing source as web', () => {
    const rows = [
      log({ id: '1', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T12:00:00.000Z', source: 'mcp' }),
      log({ id: '2', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T11:00:00.000Z' }),
      log({ id: '3', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T10:00:00.000Z', metadata: { source: 'cron' } }),
      log({ id: '4', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T09:00:00.000Z', source: 'legacy_preview_qa' }),
    ]

    const mcp = paginateUsageLogs(rows, { source: 'mcp', limit: 10 })
    expect(mcp.logs.map((row) => row.id)).toEqual(['1'])
    expect(mcp.logs[0].source).toBe('mcp')

    const web = paginateUsageLogs(rows, { source: 'web', limit: 10 })
    expect(web.logs.map((row) => row.id)).toEqual(['2'])

    const cron = paginateUsageLogs(rows, { source: 'cron', limit: 10 })
    expect(cron.logs.map((row) => row.id)).toEqual(['3'])

    const qa = paginateUsageLogs(rows, { source: 'legacy_preview_qa', limit: 10 })
    expect(qa.logs.map((row) => row.id)).toEqual(['4'])
  })
})

describe('resolveAdminUsageWindow', () => {
  it('omits start bound for lifetime', () => {
    const window = resolveAdminUsageWindow({ lifetime: true, endDate: '2026-09-09T00:00:00.000Z' })
    expect(window.lifetime).toBe(true)
    expect(window.startIso).toBeNull()
    expect(window.endIso).toBe('2026-09-09T00:00:00.000Z')
  })

  it('defaults to 30 days when start is omitted', () => {
    const window = resolveAdminUsageWindow({ endDate: '2026-09-09T00:00:00.000Z' })
    expect(window.lifetime).toBe(false)
    expect(window.startIso).toBe('2026-08-10T00:00:00.000Z')
  })
})

describe('fetchAllPagedRows', () => {
  it('walks pages until a short page and flags the safety cap', async () => {
    const pages = [
      Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` })),
      Array.from({ length: 2 }, (_, i) => ({ id: `b${i}` })),
    ]
    const first = await fetchAllPagedRows(async (from) => {
      const page = from === 0 ? pages[0] : pages[1]
      return { data: page, error: null }
    })
    expect(first.rows).toHaveLength(1002)
    expect(first.truncated).toBe(false)
  })
})

describe('buildUsageCoverage', () => {
  it('prefers the oldest created_at for lifetime windows', () => {
    const coverage = buildUsageCoverage({
      rows: [
        { created_at: '2026-08-14T10:00:00.000Z' },
        { created_at: '2025-03-01T00:00:00.000Z' },
      ],
      startIso: null,
      endIso: '2026-09-09T00:00:00.000Z',
      lifetime: true,
      truncated: false,
      oldestCreatedAt: '2025-01-15T00:00:00.000Z',
    })
    expect(coverage).toMatchObject({
      from: '2025-01-15T00:00:00.000Z',
      rowCount: 2,
      lifetime: true,
      truncated: false,
    })
  })
})

describe('resolveUsageLogSource', () => {
  it('prefers column, then metadata, then web', () => {
    expect(resolveUsageLogSource({ source: 'mcp', metadata: { source: 'web' } })).toBe('mcp')
    expect(resolveUsageLogSource({ source: null, metadata: { source: 'cron' } })).toBe('cron')
    expect(resolveUsageLogSource({ source: null, metadata: {} })).toBe('web')
  })
})

describe('mcp_tool audit exclusion', () => {
  it('excludes $0 mcp_tool audits from cost totals but keeps real MCP execute costs', () => {
    const rows = [
      log({
        id: 'audit',
        feature: 'mcp_tool',
        model: 'mcp',
        created_at: '2026-08-14T10:00:00.000Z',
        estimated_cost_usd: 0,
        source: 'mcp',
      }),
      log({
        id: 'exec',
        feature: 'script',
        model: 'grok-4.6',
        created_at: '2026-08-14T11:00:00.000Z',
        estimated_cost_usd: 0.12,
        source: 'mcp',
        input_tokens: 0,
        output_tokens: 0,
      }),
      log({
        id: 'web',
        feature: 'script',
        model: 'grok-4.6',
        created_at: '2026-08-14T12:00:00.000Z',
        estimated_cost_usd: 0.08,
        source: 'web',
        input_tokens: 0,
        output_tokens: 0,
      }),
    ]

    const summary = aggregateUsageSummary(rows)
    expect(summary.find((r) => r.feature === 'mcp_tool')).toBeUndefined()
    expect(summary.find((r) => r.feature === 'script')?.total_calls).toBe(2)
    expect(summary.find((r) => r.feature === 'script')?.total_cost_usd).toBe(0.2)

    const daily = aggregateDailyUsage(rows)
    expect(daily.find((r) => r.model === 'mcp')).toBeUndefined()
    expect(daily.find((r) => r.model === 'grok-4.6')?.total_cost_usd).toBe(0.2)

    const stats = aggregateUserUsageStats(rows)
    expect(stats[0]?.total_calls).toBe(2)
    expect(stats[0]?.total_cost_usd).toBe(0.2)
    expect(stats[0]?.other_calls).toBe(0)

    const mcpLogs = paginateUsageLogs(rows, { source: 'mcp', limit: 10 })
    expect(mcpLogs.logs.map((r) => r.id).sort()).toEqual(['audit', 'exec'])
  })
})
