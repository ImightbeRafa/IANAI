export type UsageStageTimings = {
  anglesMs?: number
  draftMs?: number
  streamlineMs?: number
  imageMs?: number
  persistMs?: number
  skippedAngles?: boolean
}

export function usageTimingMetadata(options: {
  durationMs: number
  stageTimings?: UsageStageTimings
  extra?: Record<string, unknown>
}): Record<string, unknown> {
  const stageTimings = options.stageTimings
    ? Object.fromEntries(
      Object.entries(options.stageTimings).filter(([, value]) => value !== undefined)
    )
    : undefined
  return {
    ...(options.extra || {}),
    durationMs: options.durationMs,
    ...(stageTimings && Object.keys(stageTimings).length > 0 ? { stageTimings } : {}),
  }
}

export function percentileNearestRank(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const clamped = Math.min(100, Math.max(0, p))
  const rank = Math.ceil((clamped / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]
}

export function durationMsFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as { durationMs?: unknown }).durationMs
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}
