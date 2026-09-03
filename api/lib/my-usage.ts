export type UsageKind = 'guion' | 'post' | 'image' | 'pack'

export interface UsageLogInput {
  id: string
  generation_id?: string | null
  feature?: string | null
  success?: boolean | null
  error_message?: string | null
  created_at: string
  metadata?: Record<string, unknown> | null
}

export interface UsageLedgerInput {
  generation_id: string
  action?: string | null
  units?: number | null
  credits?: number | null
  created_at: string
}

export interface UsageHistoryItem {
  id: string
  at: string
  kind: UsageKind
  credits: number
  success: boolean
  action: string
}

function metaPack(metadata?: Record<string, unknown> | null): boolean {
  if (!metadata) return false
  if (typeof metadata.packId === 'string' && metadata.packId) return true
  const action = String(metadata.action || '')
  return /bulk|campaign|pack/i.test(action)
}

export function classifyUsageKind(input: {
  action?: string | null
  feature?: string | null
  units?: number | null
  metadata?: Record<string, unknown> | null
}): UsageKind {
  if (metaPack(input.metadata)) return 'pack'
  const action = input.action || ''
  const feature = input.feature || ''
  if (action.startsWith('carousel_') || feature.includes('carousel')) return 'post'
  if (
    action.startsWith('image_')
    || feature === 'image'
    || feature === 'edit'
    || feature === 'enhance'
    || feature === 'logo'
    || feature === 'ocr'
  ) {
    return 'image'
  }
  if (feature === 'reply') return 'post'
  return 'guion'
}

export function mergeUsageHistory(
  logs: UsageLogInput[],
  ledger: UsageLedgerInput[]
): UsageHistoryItem[] {
  const ledgerByGen = new Map<string, UsageLedgerInput>()
  for (const row of ledger) {
    if (!row.generation_id) continue
    const prev = ledgerByGen.get(row.generation_id)
    if (!prev || row.created_at > prev.created_at) ledgerByGen.set(row.generation_id, row)
  }

  const used = new Set<string>()
  const items: UsageHistoryItem[] = []

  for (const log of logs) {
    const gen = log.generation_id || ''
    const led = gen ? ledgerByGen.get(gen) : undefined
    if (gen) used.add(gen)
    const action = led?.action || log.feature || 'unknown'
    items.push({
      id: log.id,
      at: log.created_at,
      kind: classifyUsageKind({
        action: led?.action,
        feature: log.feature,
        units: led?.units,
        metadata: log.metadata,
      }),
      credits: Number(led?.credits || 0) || 0,
      success: log.success !== false,
      action,
    })
  }

  for (const row of ledger) {
    if (used.has(row.generation_id)) continue
    items.push({
      id: `ledger:${row.generation_id}`,
      at: row.created_at,
      kind: classifyUsageKind({
        action: row.action,
        units: row.units,
      }),
      credits: Number(row.credits || 0) || 0,
      success: true,
      action: row.action || 'unknown',
    })
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return items
}
