import type { VercelRequest } from '@vercel/node'

// Must match server.mjs's DEADLINE_SIGNAL_PROPERTY exactly — the two files
// can't share an import (server.mjs is plain Node; this is compiled by
// scripts/build-api.mjs into dist-api/lib/request-deadline.js), so keep this
// string in sync by hand if it ever changes.
const DEADLINE_SIGNAL_PROPERTY = '__cfDeadlineSignal'

/**
 * The per-request AbortSignal server.mjs sets, aborted only when its
 * per-route deadline (matching Vercel's maxDuration) fires — never on a
 * normal finish/close. Vercel never sets this property, so this returns
 * undefined there and every caller's existing behavior is unchanged.
 *
 * Intended use: check `getDeadlineSignal(req)?.aborted` right before a
 * credit charge or DB write in a long-running handler, and skip it cleanly
 * (no throw, no charge, no write) if the client has already received a 504
 * from the adapter — the handler keeps running either way, this just avoids
 * doing paid/persistent work nobody can see the result of.
 */
export function getDeadlineSignal(req: VercelRequest): AbortSignal | undefined {
  const value = (req as unknown as Record<string, unknown>)[DEADLINE_SIGNAL_PROPERTY]
  return value instanceof AbortSignal ? value : undefined
}
