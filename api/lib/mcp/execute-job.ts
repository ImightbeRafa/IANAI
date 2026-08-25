/**
 * MCP EXECUTE async jobs — claim running → background generate → poll get_execute_result.
 * jobId === approvalRequestId (one job per approval).
 */

import type { McpApprovalRecord, McpApprovalStore } from './approval.js'

export const MCP_EXECUTE_RETRY_AFTER_MS = 2_000
export const MCP_EXECUTE_STALE_MS = 120_000

export type McpExecuteJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export type McpExecuteJobHandle = {
  status: McpExecuteJobStatus
  jobId: string
  approvalRequestId: string
  toolName?: string
  retryAfterMs?: number
  quotedCreditCost?: number | null
  chargedCredits: number
  usage: {
    quotedCredits: number | null
    chargedCredits: number
  }
  message?: string
  error?: string
  startedAtMs?: number
}

export type ScheduleMcpExecuteWork = (work: () => Promise<void>) => void

let scheduleImpl: ScheduleMcpExecuteWork = (work) => {
  void work().catch((err) => {
    console.error('mcp execute job (unscheduled)', err instanceof Error ? err.message : err)
  })
}

/** Tests can force inline await; production wires waitUntil / worker kick. */
export function setMcpExecuteScheduler(fn: ScheduleMcpExecuteWork): void {
  scheduleImpl = fn
}

export function scheduleMcpExecuteWork(work: () => Promise<void>): void {
  scheduleImpl(work)
}

export function isMcpExecuteJobPayload(value: unknown): value is Record<string, unknown> & {
  status: string
} {
  return !!value && typeof value === 'object' && typeof (value as { status?: unknown }).status === 'string'
}

export function readChargedCredits(payload: Record<string, unknown> | null | undefined): number {
  if (!payload) return 0
  if (typeof payload.chargedCredits === 'number') return payload.chargedCredits
  if (typeof payload.charged === 'number') return payload.charged
  if (typeof payload.creditsCharged === 'number') return payload.creditsCharged
  return 0
}

export function buildRunningJobHandle(options: {
  approvalRequestId: string
  toolName: string
  quotedCreditCost?: number | null
  startedAtMs?: number
}): McpExecuteJobHandle {
  const quoted = options.quotedCreditCost ?? null
  return {
    status: 'running',
    jobId: options.approvalRequestId,
    approvalRequestId: options.approvalRequestId,
    toolName: options.toolName,
    retryAfterMs: MCP_EXECUTE_RETRY_AFTER_MS,
    quotedCreditCost: quoted,
    chargedCredits: 0,
    usage: { quotedCredits: quoted, chargedCredits: 0 },
    startedAtMs: options.startedAtMs ?? Date.now(),
    message:
      'Generation started. Poll get_execute_result with this jobId (or retry this tool with the same approvalRequestId) until status=completed. Do not start a second approval.',
  }
}

export function asJobHandleFromStored(
  approvalRequestId: string,
  stored: unknown,
  fallbackToolName?: string
): McpExecuteJobHandle | Record<string, unknown> | null {
  if (!isMcpExecuteJobPayload(stored)) return null
  const status = stored.status
  if (status === 'running' || status === 'queued') {
    const quoted =
      typeof stored.quotedCreditCost === 'number'
        ? stored.quotedCreditCost
        : null
    return {
      status: status as McpExecuteJobStatus,
      jobId: typeof stored.jobId === 'string' ? stored.jobId : approvalRequestId,
      approvalRequestId,
      toolName:
        typeof stored.toolName === 'string' ? stored.toolName : fallbackToolName,
      retryAfterMs: MCP_EXECUTE_RETRY_AFTER_MS,
      quotedCreditCost: quoted,
      chargedCredits: 0,
      usage: { quotedCredits: quoted, chargedCredits: 0 },
      startedAtMs:
        typeof stored.startedAtMs === 'number' ? stored.startedAtMs : undefined,
      message:
        typeof stored.message === 'string'
          ? stored.message
          : 'Still generating — poll get_execute_result.',
    }
  }
  if (status === 'failed') {
    return {
      status: 'failed',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName:
        typeof stored.toolName === 'string' ? stored.toolName : fallbackToolName,
      chargedCredits: 0,
      usage: {
        quotedCredits:
          typeof stored.quotedCreditCost === 'number' ? stored.quotedCreditCost : null,
        chargedCredits: 0,
      },
      error: typeof stored.error === 'string' ? stored.error : 'Execute failed',
      message: 'Generation failed. Approval may still be reusable if not consumed.',
    }
  }
  // completed (or legacy completed payload without explicit status)
  const row = { ...stored } as Record<string, unknown>
  const charged = readChargedCredits(row)
  if (row.chargedCredits == null) row.chargedCredits = charged
  if (!row.usage || typeof row.usage !== 'object') {
    row.usage = {
      quotedCredits:
        typeof row.quotedCreditCost === 'number' ? row.quotedCreditCost : null,
      chargedCredits: charged,
    }
  }
  if (typeof row.jobId !== 'string') row.jobId = approvalRequestId
  if (typeof row.approvalRequestId !== 'string') row.approvalRequestId = approvalRequestId
  return row
}

/**
 * Atomically mark an approved approval as running (result_json was empty).
 * Returns null if another request already claimed it.
 */
export async function claimMcpExecuteJob(
  store: McpApprovalStore,
  options: {
    approvalRequestId: string
    toolName: string
    quotedCreditCost?: number | null
    nowMs?: number
  }
): Promise<{ claimed: true; handle: McpExecuteJobHandle } | { claimed: false; existing: unknown }> {
  const nowMs = options.nowMs ?? Date.now()
  const handle = buildRunningJobHandle({
    approvalRequestId: options.approvalRequestId,
    toolName: options.toolName,
    quotedCreditCost: options.quotedCreditCost,
    startedAtMs: nowMs,
  })

  const existingRow = await store.findById(options.approvalRequestId)
  if (existingRow?.resultJson != null && !isStaleRunningJob(existingRow.resultJson, nowMs)) {
    return { claimed: false, existing: existingRow.resultJson }
  }
  if (existingRow?.resultJson != null && isStaleRunningJob(existingRow.resultJson, nowMs)) {
    const updated = await store.storeResult(options.approvalRequestId, handle, nowMs)
    if (updated) return { claimed: true, handle }
    return { claimed: false, existing: existingRow.resultJson }
  }

  const claimFn = store.claimEmptyResult
  if (!claimFn) {
    await store.storeResult(options.approvalRequestId, handle, nowMs)
    return { claimed: true, handle }
  }
  const claimed = await claimFn(options.approvalRequestId, handle, nowMs)
  if (!claimed) {
    const row = await store.findById(options.approvalRequestId)
    return { claimed: false, existing: row?.resultJson ?? null }
  }
  return { claimed: true, handle }
}

export function isStaleRunningJob(stored: unknown, nowMs = Date.now()): boolean {
  if (!isMcpExecuteJobPayload(stored)) return false
  if (stored.status !== 'running' && stored.status !== 'queued') return false
  const started =
    typeof stored.startedAtMs === 'number' ? stored.startedAtMs : null
  if (started == null) return false
  return nowMs - started > MCP_EXECUTE_STALE_MS
}

export async function getMcpExecuteResult(options: {
  approvalStore: McpApprovalStore
  userId: string
  jobId?: string
  approvalRequestId?: string
}): Promise<Record<string, unknown>> {
  const id = options.jobId || options.approvalRequestId || ''
  if (!id) throw new Error('jobId or approvalRequestId is required')
  const row = await options.approvalStore.findById(id)
  if (!row) throw new Error('Job not found')
  if (row.userId !== options.userId) throw new Error('Job user mismatch')
  if (row.resultJson == null) {
    if (row.status === 'approved') {
      return {
        status: 'queued',
        jobId: id,
        approvalRequestId: id,
        toolName: row.toolName,
        retryAfterMs: MCP_EXECUTE_RETRY_AFTER_MS,
        chargedCredits: 0,
        usage: {
          quotedCredits: row.quotedCreditCost,
          chargedCredits: 0,
        },
        message:
          'Approved but not started — retry the original execute_* tool with this approvalRequestId.',
      }
    }
    throw new Error('No job result yet')
  }
  const formatted = asJobHandleFromStored(id, row.resultJson, row.toolName)
  if (!formatted) throw new Error('Invalid job payload')
  return formatted as Record<string, unknown>
}

export function withChargedCredits<T extends Record<string, unknown>>(
  result: T,
  charged: number,
  quotedCreditCost?: number | null
): T & {
  chargedCredits: number
  charged: number
  usage: { quotedCredits: number | null; chargedCredits: number }
} {
  return {
    ...result,
    charged,
    chargedCredits: charged,
    usage: {
      quotedCredits: quotedCreditCost ?? (typeof result.quotedCreditCost === 'number' ? result.quotedCreditCost : null),
      chargedCredits: charged,
    },
  }
}

export type { McpApprovalRecord }
