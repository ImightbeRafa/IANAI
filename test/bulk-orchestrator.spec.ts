import { describe, expect, it } from 'vitest'
import {
  clampBulkCount,
  fallbackAngleBoard,
  orchestrateAngles,
  parseAngleBoard,
  pickAngles,
} from '../api/lib/bulk/angle-orchestrator'
import { countExpandNeeded } from '../api/lib/bulk/expand-product-refs'
import {
  quoteBulkPosts,
  quoteBulkScripts,
  quoteCampaignPack,
  SCRIPT_CREDITS_EACH,
} from '../api/lib/bulk/quotes'
import { findStyleDna, parseStyleDnas } from '../api/lib/bulk/style-dna'
import { listEnabledMcpTools, getMcpTool, MCP_REGISTRY_VERSION } from '../api/lib/mcp/tool-registry'

const input = {
  brandName: 'Pura Sonrisa',
  offerName: 'Tiras',
  brandIcp: 'adults who want whiter teeth',
}

describe('bulk count clamp', () => {
  it('defaults and clamps 1–25', () => {
    expect(clampBulkCount(undefined)).toBe(10)
    expect(clampBulkCount(null)).toBe(10)
    expect(clampBulkCount('nope')).toBe(10)
    expect(clampBulkCount(0)).toBe(1)
    expect(clampBulkCount(-4)).toBe(1)
    expect(clampBulkCount(1)).toBe(1)
    expect(clampBulkCount(10)).toBe(10)
    expect(clampBulkCount(25)).toBe(25)
    expect(clampBulkCount(26)).toBe(25)
    expect(clampBulkCount(99.4)).toBe(25)
  })
})

describe('angle board parse + fallback', () => {
  it('parses JSON boards and skips clone niches', () => {
    const parsed = parseAngleBoard({
      angles: [
        { title: 'Nightlife glow', niche: 'nightlife', whyItBuys: 'photos tonight', hookStyle: 'night_reveal', frameworkHint: 'venta_directa' },
        { title: 'Same nightlife', niche: 'nightlife', whyItBuys: 'also photos', hookStyle: 'night_reveal', frameworkHint: 'storytelling' },
        { title: 'Creator closeup', niche: 'creators', whyItBuys: 'camera days', hookStyle: 'on_camera_proof', frameworkHint: 'storytelling' },
      ],
    }, 10)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].niche).toBe('nightlife')
    expect(parsed[1].niche).toBe('creators')
  })

  it('parses fenced JSON and candidate aliases', () => {
    const text = '```json\n{"candidates":[{"title":"Gym","niche":"gym","whyItBuys":"lift","hookStyle":"gap","frameworkHint":"educativo"}]}\n```'
    expect(parseAngleBoard(text, 3)[0].niche).toBe('gym')
  })

  it('builds deterministic fallback niches that are not word-swaps', () => {
    const board = fallbackAngleBoard(input, 5)
    const niches = board.map((item) => item.niche)
    expect(new Set(niches).size).toBe(5)
    expect(niches).toEqual(expect.arrayContaining(['nightlife', 'creators', 'gym', 'nurses', 'office']))
    expect(board[0].title).toContain('Tiras')
  })

  it('falls back when fetch fails or key is missing', async () => {
    const noKey = await orchestrateAngles({ ...input, count: 4 }, { apiKey: '' })
    expect(noKey.source).toBe('fallback')
    expect(noKey.angles).toHaveLength(4)

    const failingFetch: typeof fetch = async () => {
      throw new Error('network')
    }
    const failed = await orchestrateAngles({ ...input, count: 3, recentSummaries: ['old hook'] }, {
      apiKey: 'test-key',
      fetchFn: failingFetch,
    })
    expect(failed.source).toBe('fallback')
    expect(failed.avoidedNearDuplicates).toBe(true)
    expect(failed.angles).toHaveLength(3)
  })

  it('uses model JSON when fetch succeeds', async () => {
    const okFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            angles: [
              { title: 'Club night', niche: 'nightlife', whyItBuys: 'flash photos', hookStyle: 'reveal', frameworkHint: 'venta_directa' },
              { title: 'Reel day', niche: 'creators', whyItBuys: 'batch content', hookStyle: 'proof', frameworkHint: 'storytelling' },
            ],
          }),
        },
      }],
    }), { status: 200 })
    const board = await orchestrateAngles({ ...input, count: 2 }, {
      apiKey: 'test-key',
      fetchFn: okFetch,
    })
    expect(board.source).toBe('model')
    expect(board.angles.map((a) => a.niche)).toEqual(['nightlife', 'creators'])
  })

  it('auto-picks or honors selected ids', () => {
    const board = fallbackAngleBoard(input, 6)
    expect(pickAngles(board, null, 3)).toHaveLength(3)
    const picked = pickAngles(board, [board[2].id, board[4].id], 10)
    expect(picked.map((a) => a.id)).toEqual([board[2].id, board[4].id])
  })
})

describe('bulk quote math', () => {
  it('quotes scripts at 3 each', () => {
    expect(SCRIPT_CREDITS_EACH).toBe(3)
    expect(quoteBulkScripts(10).totalCredits).toBe(30)
    expect(quoteBulkScripts(1).totalCredits).toBe(3)
    expect(quoteBulkScripts(0).totalCredits).toBe(0)
  })

  it('quotes posts 6 or 24 by model plus expand', () => {
    expect(quoteBulkPosts({ count: 10, imageModel: 'grok-imagine' }).totalCredits).toBe(60)
    expect(quoteBulkPosts({ count: 2, imageModel: 'nano-banana-pro' }).totalCredits).toBe(48)
    expect(quoteBulkPosts({ count: 10, imageModel: 'grok-imagine', expandCount: 2 }).totalCredits).toBe(72)
  })

  it('quotes a campaign pack as scripts + posts + expand', () => {
    const quote = quoteCampaignPack({
      scriptCount: 10,
      imageCount: 10,
      imageModel: 'grok-imagine',
      expandCount: 2,
    })
    expect(quote.totalCredits).toBe(30 + 60 + 12)
    expect(quote.lines.map((l) => l.action)).toEqual(['script', 'image', 'expand_ref'])
  })

  it('counts expand only when refs are few', () => {
    expect(countExpandNeeded(0)).toBe(3)
    expect(countExpandNeeded(1)).toBe(2)
    expect(countExpandNeeded(2)).toBe(0)
    expect(countExpandNeeded(5)).toBe(0)
  })
})

describe('style dna parse', () => {
  it('normalizes a list and finds by id', () => {
    const list = parseStyleDnas([
      { id: 'organic-1', name: 'UGC kitchen', kind: 'organic', referenceUrls: ['https://x/a'], notes: 'warm' },
      { name: '', kind: 'ads' },
      { name: 'Paid polish', kind: 'ads' },
    ])
    expect(list).toHaveLength(2)
    expect(list[1].id).toBe('dna_3')
    expect(findStyleDna(list, 'organic-1')?.kind).toBe('organic')
  })
})

describe('mcp registry bulk tools', () => {
  it('lists guide + execute bulk tools on 0.8.x', () => {
    expect(MCP_REGISTRY_VERSION).toMatch(/^0\.9\./)
    const names = listEnabledMcpTools().map((tool) => tool.name)
    expect(names).toContain('guide_bulk_angles')
    expect(names).toContain('execute_bulk_scripts')
    expect(names).toContain('execute_bulk_posts')
    expect(names).toContain('execute_campaign_pack')
    expect(names).toContain('list_style_dnas')
    expect(names).toContain('set_style_dna')
    expect(getMcpTool('guide_bulk_angles')?.consumesAdvanceCredits).toBe(false)
    expect(getMcpTool('guide_bulk_angles')?.requiresApproval).toBe(false)
    expect(getMcpTool('execute_bulk_scripts')?.requiresApproval).toBe(true)
    expect(getMcpTool('execute_bulk_scripts')?.consumesAdvanceCredits).toBe(true)
    expect(getMcpTool('execute_campaign_pack')?.requiresApproval).toBe(true)
  })
})
