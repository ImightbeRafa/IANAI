/**
 * Shared CAS / store guards for MCP execute job result_json.
 * Prod UPDATE must encode these in one atomic statement —
 * check-then-write can clobber a completed result_json back to running.
 */

export function readExecuteResultStatus(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) return null
  const status = (resultJson as { status?: unknown }).status
  return typeof status === 'string' ? status : null
}

export function matchesRunningCasExpectation(
  resultJson: unknown,
  expectedStartedAtMs: number
): boolean {
  if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) return false
  const row = resultJson as { status?: unknown; startedAtMs?: unknown }
  return row.status === 'running' && Number(row.startedAtMs) === expectedStartedAtMs
}

/**
 * Refuse writes that would flip a terminal success back to an in-flight marker.
 * Completed must never become running/queued via storeResult or reclaim.
 */
export function canStoreExecuteResult(current: unknown, next: unknown): boolean {
  const nextStatus = readExecuteResultStatus(next)
  if (nextStatus !== 'running' && nextStatus !== 'queued') return true
  const currentStatus = readExecuteResultStatus(current)
  if (currentStatus === 'completed') return false
  return true
}
