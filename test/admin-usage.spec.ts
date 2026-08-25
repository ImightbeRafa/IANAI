import { describe, expect, it } from 'vitest'
import {
  aggregateDailyUsage,
  aggregateUsageSummary,
  aggregateUserUsageStats,
  paginateUsageLogs,
  resolveUsageLogSource,
  type AdminUsageLogRow,
} from '../api/lib/admin-usage'

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

describe('aggregateUsageSummary', () => {
  it('groups by model and feature and sums cost', () => {
    const summary = aggregateUsageSummary([
      log({ id: '1', feature: 'brand_extraction', model: 'gemini-2.5-flash', created_at: '2026-08-14T10:00:00.000Z', estimated_cost_usd: 0.02 }),
      log({ id: '2', feature: 'brand_extraction', model: 'gemini-2.5-flash', created_at: '2026-08-14T11:00:00.000Z', estimated_cost_usd: 0.03, success: false }),
      log({ id: '3', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T12:00:00.000Z', estimated_cost_usd: 0.10 }),
    ])

    expect(summary).toHaveLength(2)
    expect(summary[0]).toMatchObject({
      model: 'grok-4.6',
      feature: 'script',
      total_calls: 1,
      successful_calls: 1,
      failed_calls: 0,
      total_cost_usd: 0.1,
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
})

describe('aggregateDailyUsage', () => {
  it('groups by UTC day and model', () => {
    const daily = aggregateDailyUsage([
      log({ id: '1', feature: 'url_fetch', model: 'web-scraper', created_at: '2026-08-13T23:00:00.000Z', estimated_cost_usd: 0 }),
      log({ id: '2', feature: 'url_fetch', model: 'web-scraper', created_at: '2026-08-14T01:00:00.000Z', estimated_cost_usd: 0 }),
      log({ id: '3', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T02:00:00.000Z', estimated_cost_usd: 0.2 }),
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
      log({ id: '1', feature: 'script', model: 'grok-4.6', created_at: '2026-08-14T10:00:00.000Z', estimated_cost_usd: 0.08 }),
      log({ id: '2', feature: 'script_edit', model: 'grok-4.6', created_at: '2026-08-14T11:00:00.000Z', estimated_cost_usd: 0.02 }),
      log({ id: '3', feature: 'brand_extraction', model: 'gemini-2.5-flash', created_at: '2026-08-14T12:00:00.000Z', estimated_cost_usd: 0.04 }),
      log({ id: '4', feature: 'url_fetch', model: 'web-scraper', created_at: '2026-08-14T13:00:00.000Z', estimated_cost_usd: 0 }),
      log({ id: '5', feature: 'image', model: 'nano-banana', created_at: '2026-08-14T14:00:00.000Z', estimated_cost_usd: 0.03, success: false }),
      log({ id: '6', feature: 'reply', model: 'grok-4.6', created_at: '2026-08-14T15:00:00.000Z', estimated_cost_usd: 0.01 }),
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
    ]

    const mcp = paginateUsageLogs(rows, { source: 'mcp', limit: 10 })
    expect(mcp.logs.map((row) => row.id)).toEqual(['1'])
    expect(mcp.logs[0].source).toBe('mcp')

    const web = paginateUsageLogs(rows, { source: 'web', limit: 10 })
    expect(web.logs.map((row) => row.id)).toEqual(['2'])

    const cron = paginateUsageLogs(rows, { source: 'cron', limit: 10 })
    expect(cron.logs.map((row) => row.id)).toEqual(['3'])
  })
})

describe('resolveUsageLogSource', () => {
  it('prefers column, then metadata, then web', () => {
    expect(resolveUsageLogSource({ source: 'mcp', metadata: { source: 'web' } })).toBe('mcp')
    expect(resolveUsageLogSource({ source: null, metadata: { source: 'cron' } })).toBe('cron')
    expect(resolveUsageLogSource({ source: null, metadata: {} })).toBe('web')
  })
})
