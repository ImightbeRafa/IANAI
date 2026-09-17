import { describe, expect, it } from 'vitest'
import {
  durationMsFromMetadata,
  percentileNearestRank,
  usageTimingMetadata,
} from '../api/lib/usage-timings'

describe('L1 usage timing metadata', () => {
  it('writes durationMs and stageTimings for chat / image / MCP jobs', () => {
    const chat = usageTimingMetadata({
      durationMs: 4120,
      stageTimings: { anglesMs: 800, draftMs: 3100, skippedAngles: true },
      extra: { structuredPipeline: true },
    })
    expect(chat.durationMs).toBe(4120)
    expect(chat.stageTimings).toEqual({ anglesMs: 800, draftMs: 3100, skippedAngles: true })
    expect(chat.structuredPipeline).toBe(true)

    const image = usageTimingMetadata({
      durationMs: 18000,
      stageTimings: { imageMs: 18000 },
      extra: { action: 'generate' },
    })
    expect(image.durationMs).toBe(18000)
    expect((image.stageTimings as { imageMs: number }).imageMs).toBe(18000)

    const mcp = usageTimingMetadata({
      durationMs: 9000,
      stageTimings: { persistMs: 120 },
      extra: { action: 'mcp_execute_script_generate', source: 'mcp' },
    })
    expect(durationMsFromMetadata(mcp)).toBe(9000)
    expect(mcp.source).toBe('mcp')
  })

  it('computes nearest-rank p50/p90', () => {
    const sorted = [100, 200, 300, 400, 500]
    expect(percentileNearestRank(sorted, 50)).toBe(300)
    expect(percentileNearestRank(sorted, 90)).toBe(500)
    expect(percentileNearestRank([], 50)).toBeNull()
  })
})
