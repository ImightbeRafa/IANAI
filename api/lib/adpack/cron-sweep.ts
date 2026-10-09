/**
 * Minute-cron hook (#14c): resume Ad Packs nobody is advancing. Called from the EXISTING cron
 * handler (`api/mcp-guide-analysis.ts`, behind ENABLE_CRONS on the CF container) — no new route,
 * no new schedule. Bounded per tick (ADPACK_SWEEP_LIMIT packs); each resumed pack gets the same
 * self-continuing, lease-safe background loop as a fresh start (waitUntil keeps it alive).
 *
 * Never throws: a sweep failure must not fail the URL-intake cron.
 */
import { waitUntil } from '@vercel/functions'
import { getSupabaseAdmin } from '../supabase-admin.js'
import { ADPACK_SWEEP_LIMIT, type SweepResult } from './background.js'

export async function runAdPackCronSweep(options: { limit?: number } = {}): Promise<SweepResult | { skipped: string }> {
  // No service role in this runtime (tests, preview without secrets): nothing to sweep, no network.
  if (!getSupabaseAdmin()) return { skipped: 'db_unavailable' }
  try {
    // Lazy: the ad-pack engine pulls in sharp/satori; keep the cron cold start lean when idle.
    const { getDefaultAdPackService } = await import('./service.js')
    return await getDefaultAdPackService().sweepStale({
      limit: options.limit ?? ADPACK_SWEEP_LIMIT,
      schedule: (work) => {
        waitUntil(work().catch((err) => console.error('[adpack] sweep slice failed', err instanceof Error ? err.message : err)))
      },
    })
  } catch (err) {
    console.error('[adpack] cron sweep failed', err instanceof Error ? err.message : err)
    return { skipped: 'error' }
  }
}
