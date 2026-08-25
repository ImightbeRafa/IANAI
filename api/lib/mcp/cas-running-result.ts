/**
 * Shared CAS predicate for reclaiming stale running MCP execute jobs.
 * Prod UPDATE must encode the same conditions in one atomic statement —
 * check-then-write can clobber a completed result_json back to running.
 */

export function matchesRunningCasExpectation(
  resultJson: unknown,
  expectedStartedAtMs: number
): boolean {
  if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) return false
  const row = resultJson as { status?: unknown; startedAtMs?: unknown }
  return row.status === 'running' && Number(row.startedAtMs) === expectedStartedAtMs
}
