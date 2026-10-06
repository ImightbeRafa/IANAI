// Single source of truth for the fail-closed cron gate (SD-01, SD-E):
// crons run ONLY when ENABLE_CRONS is the exact string '1' (after trim).
// Anything else — unset, '', '0', ' 1 '.length tricks aside, 'true', 'TRUE',
// 'yes', '01', '1.0', a stray newline — means crons stay off. This is
// deliberately not a loose truthy check: a typo or a truthy-but-wrong string
// must never accidentally enable the preview cron or the handler's worker.
//
// Lives under api/lib (not cf/) so scripts/build-api.mjs compiles it into
// dist-api/lib/crons-enabled.js — the Dockerfile runtime stage never copies
// cf/*, so this is the only way the SAME implementation can be read by both
// api/mcp-guide-analysis.ts (inside the container) and cf/worker-core.ts's
// handleScheduled (bundled into the Worker by wrangler, which imports this
// file directly from TS source — see cf/container-env.mjs for the
// Worker-side re-export).
export function cronsEnabled(source: Record<string, unknown> | undefined | null): boolean {
  return String(source?.ENABLE_CRONS ?? '').trim() === '1'
}
