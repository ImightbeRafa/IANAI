import { describe, expect, it } from 'vitest'
import { classifyUsageKind, mergeUsageHistory } from '../api/lib/my-usage'

describe('classifyUsageKind', () => {
  it('maps scripts, images, posts, and packs', () => {
    expect(classifyUsageKind({ action: 'guion_oferta', feature: 'script' })).toBe('guion')
    expect(classifyUsageKind({ action: 'image_standard', feature: 'image' })).toBe('image')
    expect(classifyUsageKind({ action: 'carousel_slide_standard', feature: 'image' })).toBe('post')
    expect(classifyUsageKind({
      action: 'guion_oferta',
      feature: 'script',
      metadata: { packId: 'p1', action: 'bulk_script' },
    })).toBe('pack')
  })
})

describe('mergeUsageHistory', () => {
  it('joins ledger credits onto logs and keeps failures at 0 credits', () => {
    const items = mergeUsageHistory(
      [
        {
          id: 'log-ok',
          generation_id: 'g1',
          feature: 'script',
          success: true,
          created_at: '2026-09-03T12:00:00.000Z',
        },
        {
          id: 'log-fail',
          generation_id: 'g2',
          feature: 'image',
          success: false,
          error_message: 'timeout',
          created_at: '2026-09-03T12:01:00.000Z',
        },
      ],
      [
        {
          generation_id: 'g1',
          action: 'guion_oferta',
          units: 1,
          credits: 15,
          created_at: '2026-09-03T12:00:00.000Z',
        },
      ]
    )
    expect(items[0]).toMatchObject({ id: 'log-fail', kind: 'image', credits: 0, success: false })
    expect(items[1]).toMatchObject({ id: 'log-ok', kind: 'guion', credits: 15, success: true })
  })

  it('includes ledger-only rows without inventing other users', () => {
    const items = mergeUsageHistory(
      [],
      [{
        generation_id: 'solo',
        action: 'image_pro',
        units: 1,
        credits: 24,
        created_at: '2026-09-03T10:00:00.000Z',
      }]
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'image', credits: 24, success: true })
  })
})
