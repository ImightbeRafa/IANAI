/**
 * MCP EXECUTE async jobs — claim running → background generate → poll get_execute_result.
 * jobId === approvalRequestId (one job per approval).
 */

import type { McpApprovalRecord, McpApprovalStore } from './approval.js'
import { MCP_HOST_MAX_DURATION_SEC } from '../organic-carousel.js'

export const MCP_EXECUTE_RETRY_AFTER_MS = 2_000
/** Must exceed host waitUntil/maxDuration so a still-running generate is not reclaimed (double charge). */
export const MCP_EXECUTE_STALE_MS = (MCP_HOST_MAX_DURATION_SEC + 10) * 1000 // 190s > 180s host cap

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
  /** Human status for Grok/CoS chat bubbles (ES + EN). */
  statusMessage?: string
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

/** Classify EXECUTE tool for human status copy. */
export function executeWorkKind(toolName: string):
  | 'script'
  | 'image'
  | 'edit'
  | 'enhance'
  | 'bulk_scripts'
  | 'bulk_posts'
  | 'carousel'
  | 'campaign'
  | 'generic' {
  switch (toolName) {
    case 'execute_script_generate':
      return 'script'
    case 'execute_image_generate':
      return 'image'
    case 'execute_image_edit':
      return 'edit'
    case 'execute_image_enhance':
      return 'enhance'
    case 'execute_bulk_scripts':
      return 'bulk_scripts'
    case 'execute_bulk_posts':
      return 'bulk_posts'
    case 'execute_carousel_generate':
      return 'carousel'
    case 'execute_campaign_pack':
      return 'campaign'
    default:
      return 'generic'
  }
}

/** Bilingual human status for Grok chat (CoS narrates; not a blocking widget). */
export function buildExecuteStatusMessage(
  toolName: string,
  status: McpExecuteJobStatus | 'completed' | string
): string {
  const kind = executeWorkKind(toolName)
  const nounEs =
    kind === 'script'
      ? 'un guion'
      : kind === 'image'
        ? 'una imagen'
        : kind === 'edit'
          ? 'una edición de imagen'
          : kind === 'enhance'
            ? 'una mejora de imagen'
            : kind === 'bulk_scripts'
              ? 'varios guiones'
              : kind === 'bulk_posts'
                ? 'varios posts'
                : kind === 'carousel'
                  ? 'un carrusel'
                  : kind === 'campaign'
                    ? 'un pack de campaña'
                    : 'tu solicitud'
  const nounEn =
    kind === 'script'
      ? 'a script'
      : kind === 'image'
        ? 'an image'
        : kind === 'edit'
          ? 'an image edit'
          : kind === 'enhance'
            ? 'an image enhance'
            : kind === 'bulk_scripts'
              ? 'bulk scripts'
              : kind === 'bulk_posts'
                ? 'bulk posts'
                : kind === 'carousel'
                  ? 'a carousel'
                  : kind === 'campaign'
                    ? 'a campaign pack'
                    : 'your request'

  if (status === 'running' || status === 'queued') {
    return `Advance está generando ${nounEs}… / Advance is generating ${nounEn}…`
  }
  if (status === 'failed') {
    return `Advance no pudo completar ${nounEs}. Puedes reintentar. / Advance could not finish ${nounEn}. You can retry.`
  }
  if (status === 'completed') {
    return `Advance terminó ${nounEs}. / Advance finished ${nounEn}.`
  }
  return `Advance: ${status}`
}

export function withStatusMessage<T extends Record<string, unknown>>(
  result: T,
  toolName: string
): T & { statusMessage: string; toolName: string } {
  const status = typeof result.status === 'string' ? result.status : 'completed'
  return {
    ...result,
    toolName: typeof result.toolName === 'string' ? result.toolName : toolName,
    statusMessage:
      typeof result.statusMessage === 'string' && result.statusMessage.trim()
        ? result.statusMessage
        : buildExecuteStatusMessage(toolName, status),
  }
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
    statusMessage: buildExecuteStatusMessage(options.toolName, 'running'),
    message:
      'Generation started. Poll get_execute_result with this jobId (or retry this tool with the same approvalRequestId) until status=completed. Do not start a second approval.',
  }
}

export function buildFailedJobResult(options: {
  approvalRequestId: string
  toolName: string
  error: string
  quotedCreditCost?: number | null
}): Record<string, unknown> {
  return withStatusMessage(
    {
      status: 'failed',
      jobId: options.approvalRequestId,
      approvalRequestId: options.approvalRequestId,
      toolName: options.toolName,
      chargedCredits: 0,
      usage: {
        quotedCredits: options.quotedCreditCost ?? null,
        chargedCredits: 0,
      },
      error: options.error,
      message: 'Generation failed. Approval may still be reusable if not consumed.',
    },
    options.toolName
  )
}

export function asJobHandleFromStored(
  approvalRequestId: string,
  stored: unknown,
  fallbackToolName?: string
): McpExecuteJobHandle | Record<string, unknown> | null {
  if (!isMcpExecuteJobPayload(stored)) return null
  const status = stored.status
  const toolName =
    typeof stored.toolName === 'string' ? stored.toolName : fallbackToolName || 'execute'
  if (status === 'running' || status === 'queued') {
    const quoted =
      typeof stored.quotedCreditCost === 'number'
        ? stored.quotedCreditCost
        : null
    const charged = readChargedCredits(stored)
    const statusMessage =
      typeof stored.statusMessage === 'string' && stored.statusMessage.trim()
        ? stored.statusMessage
        : buildExecuteStatusMessage(toolName, status)
    return {
      ...stored,
      status: status as McpExecuteJobStatus,
      jobId: typeof stored.jobId === 'string' ? stored.jobId : approvalRequestId,
      approvalRequestId,
      toolName,
      retryAfterMs:
        typeof stored.retryAfterMs === 'number'
          ? stored.retryAfterMs
          : MCP_EXECUTE_RETRY_AFTER_MS,
      quotedCreditCost: quoted,
      chargedCredits: charged,
      usage: {
        quotedCredits: quoted,
        chargedCredits: charged,
      },
      startedAtMs:
        typeof stored.startedAtMs === 'number' ? stored.startedAtMs : undefined,
      statusMessage,
      message:
        typeof stored.message === 'string'
          ? stored.message
          : 'Still generating — poll get_execute_result.',
    }
  }
  if (status === 'failed') {
    const base = {
      ...stored,
      status: 'failed' as const,
      jobId: approvalRequestId,
      approvalRequestId,
      toolName,
      chargedCredits: 0,
      usage: {
        quotedCredits:
          typeof stored.quotedCreditCost === 'number' ? stored.quotedCreditCost : null,
        chargedCredits: 0,
      },
      error: typeof stored.error === 'string' ? stored.error : 'Execute failed',
      message:
        typeof stored.message === 'string'
          ? stored.message
          : 'Generation failed. Approval may still be reusable if not consumed.',
    }
    return withStatusMessage(base as Record<string, unknown>, toolName)
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
  if (typeof row.toolName !== 'string') row.toolName = toolName
  if (typeof row.status !== 'string') row.status = 'completed'
  return withStatusMessage(row, toolName)
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
  if (existingRow?.resultJson != null && !isReclaimableExecuteJob(existingRow.resultJson, nowMs)) {
    return { claimed: false, existing: existingRow.resultJson }
  }
  if (existingRow?.resultJson != null && isReclaimableExecuteJob(existingRow.resultJson, nowMs)) {
    // Re-read then CAS: never clobber a completed result that landed mid-reclaim.
    const latest = await store.findById(options.approvalRequestId)
    if (!latest?.resultJson || !isReclaimableExecuteJob(latest.resultJson, nowMs)) {
      return { claimed: false, existing: latest?.resultJson ?? existingRow.resultJson }
    }
    const expectedStarted =
      isMcpExecuteJobPayload(latest.resultJson)
        && typeof latest.resultJson.startedAtMs === 'number'
        ? latest.resultJson.startedAtMs
        : null

    // Stale running → must CAS on startedAtMs (atomic in prod). Never bare storeResult.
    if (isStaleRunningJob(latest.resultJson, nowMs)) {
      const cas = store.compareAndSwapRunningResult
      if (!cas || expectedStarted == null) {
        return { claimed: false, existing: latest.resultJson }
      }
      const updated = await cas(options.approvalRequestId, expectedStarted, handle, nowMs)
      if (updated) return { claimed: true, handle }
      const after = await store.findById(options.approvalRequestId)
      return { claimed: false, existing: after?.resultJson ?? latest.resultJson }
    }

    // Failed (non charge-only) reclaim → write running only if store refuses completed clobber.
    const updated = await store.storeResult(options.approvalRequestId, handle, nowMs)
    if (updated) return { claimed: true, handle }
    const after = await store.findById(options.approvalRequestId)
    return { claimed: false, existing: after?.resultJson ?? latest.resultJson }
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

/** Failed jobs must stay retryable — never treat as terminal success / never consume. */
export function isFailedExecuteJob(stored: unknown): boolean {
  return isMcpExecuteJobPayload(stored) && stored.status === 'failed'
}

/** Artifacts landed but billing failed — poll must show them; do not regenerate. */
export function isArtifactsSavedChargeFailure(stored: unknown): boolean {
  if (!isFailedExecuteJob(stored)) return false
  const row = stored as Record<string, unknown>
  return row.artifactsSaved === true || row.failureStage === 'charge' || row.resumeMode === 'charge_only'
}

/** Reclaim when failed (retry) or when running+startedAtMs is past STALE (> host maxDuration). */
export function isReclaimableExecuteJob(stored: unknown, nowMs = Date.now()): boolean {
  // Charge-stage failure after save: reusable approval, but reclaim must NOT regenerate.
  // Poll/replay returns the failed payload (with artifact URLs/ids) until a charge-only retry lands.
  if (isArtifactsSavedChargeFailure(stored)) return false
  if (isFailedExecuteJob(stored)) return true
  return isStaleRunningJob(stored, nowMs)
}

/**
 * Replay runs BEFORE claim. Only return stored payloads that are still useful:
 * completed (success) or fresh running. Stale running / failed must NOT short-circuit
 * replay — otherwise a dead waitUntil leaves the approval stuck forever (under-delivery).
 */
export function shouldReplayStoredExecuteResult(stored: unknown, nowMs = Date.now()): boolean {
  if (stored == null) return false
  if (isReclaimableExecuteJob(stored, nowMs)) return false
  return true
}

export function isStaleRunningJob(stored: unknown, nowMs = Date.now()): boolean {
  if (!isMcpExecuteJobPayload(stored)) return false
  // Only status=running with startedAtMs older than host maxDuration (+ buffer)
  if (stored.status !== 'running') return false
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
      return withStatusMessage(
        {
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
        },
        row.toolName
      )
    }
    throw new Error('No job result yet')
  }
  const formatted = asJobHandleFromStored(id, row.resultJson, row.toolName)
  if (!formatted) throw new Error('Invalid job payload')
  const out = formatted as Record<string, unknown>
  if (isStaleRunningJob(row.resultJson)) {
    out.stale = true
    out.message =
      'Job appears stuck past host maxDuration. Retry the original execute_* tool with the same approvalRequestId to reclaim (no double charge — credits only on success).'
  }
  return out
}

export function withChargedCredits<T extends Record<string, unknown>>(
  result: T,
  charged: number,
  quotedCreditCost?: number | null,
  toolName?: string
): T & {
  chargedCredits: number
  charged: number
  usage: { quotedCredits: number | null; chargedCredits: number }
  statusMessage?: string
} {
  const base = {
    ...result,
    charged,
    chargedCredits: charged,
    usage: {
      quotedCredits: quotedCreditCost ?? (typeof result.quotedCreditCost === 'number' ? result.quotedCreditCost : null),
      chargedCredits: charged,
    },
  }
  const name =
    toolName ||
    (typeof result.toolName === 'string' ? result.toolName : undefined)
  if (!name) return base
  return withStatusMessage(base, name)
}

export type { McpApprovalRecord }
