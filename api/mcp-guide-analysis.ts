/**
 * Cron / manual trigger for MCP GUIDE URL analysis worker.
 * Auth: Authorization: Bearer <CRON_SECRET> (or Vercel Cron header).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { timingSafeEqual } from 'node:crypto'
import { processNextMcpUrlIntake } from './lib/mcp/url-analysis-worker.js'
import { getDeadlineSignal } from './lib/request-deadline.js'
import { cronsEnabled } from './lib/crons-enabled.js'
import { runAdPackCronSweep } from './lib/adpack/cron-sweep.js'

export const maxDuration = 60

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// server.mjs sets this; Vercel never does. Used only to fail closed on the
// CF container when crons haven't been enabled there (see SD-01):
// api/mcp-guide-analysis.ts never keys off anything Vercel-specific, so the
// Vercel path (no ADVANCE_RUNTIME) is completely unaffected by this gate.
function isCloudflareContainerRuntime(): boolean {
  return process.env.ADVANCE_RUNTIME === 'cloudflare-container'
}

function authorizeCron(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const raw = req.headers.authorization
  const auth = (Array.isArray(raw) ? raw[0] : raw) || ''
  // Vercel Cron and the Cloudflare cron Worker both send
  // Authorization: Bearer <CRON_SECRET>; x-vercel-cron is not required.
  return safeEqual(auth, `Bearer ${secret}`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  // Round-6 operator review, item E: uses the SAME shared cronsEnabled()
  // the Worker's handleScheduled gate uses (api/lib/crons-enabled.ts) —
  // not a second, slightly different `!== '1'` comparison. The raw
  // comparison this replaced disagreed with cronsEnabled() on inputs like
  // ' 1 ' or '1\n' (cronsEnabled trims; `!== '1'` does not), which would
  // have let the Worker gate and this handler gate reach different
  // conclusions about whether crons are enabled for the exact same value.
  if (isCloudflareContainerRuntime() && !cronsEnabled(process.env)) {
    res.status(503).json({ error: 'Crons disabled on this runtime' })
    return
  }
  if (!authorizeCron(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  let result: Awaited<ReturnType<typeof processNextMcpUrlIntake>> | null = null
  let failure: string | null = null
  try {
    result = await processNextMcpUrlIntake(getDeadlineSignal(req))
  } catch (err) {
    failure = err instanceof Error ? err.message : 'Worker failed'
    console.error('mcp-guide-analysis', failure)
  }
  // #14c: the same minute tick resumes stale Ad Packs (bounded, background work, never throws).
  const sweep = await runAdPackCronSweep()
  const resumed = 'resumed' in sweep && sweep.resumed.length ? { adpackResumed: sweep.resumed } : {}
  if (failure !== null) {
    res.status(500).json({ ok: false, error: failure, ...resumed })
    return
  }
  res.status(200).json({ ok: true, ...result, ...resumed })
}
