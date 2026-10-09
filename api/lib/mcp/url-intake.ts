/**
 * Persist GUIDE URL intake as pending_analysis (no credits), then — G3 — analyze it inline
 * within a time budget so it works with no cron:
 *
 *   workspace_save_url_context → insert pending → run inline (≤ MCP_URL_INLINE_BUDGET_MS)
 *     ├─ finished in time → { status: 'ready' | 'failed', analysis… }
 *     └─ still running    → { status: 'processing', jobId } (work continues in the background)
 *   workspace_url_context_status / get_execute_result { jobId } → current status; a pending or
 *     stale-lease row is analyzed inline again on the poll (poll-driven resume, like adpack).
 *
 * The cron worker keeps working unchanged (same claim/lease guards); inline runs only claim
 * the one row by id for its owner.
 */

import type { McpAuthUser, McpDbClient } from './user-tools.js'
import { validateMcpGuideIntake } from './guide-intake.js'

/** Inline analysis budget for a single MCP request (host timeouts are ~60 s). */
export const MCP_URL_INLINE_BUDGET_MS = 25_000
export const MCP_URL_POLL_AFTER_MS = 10_000

export type McpUrlIntakeStatus = 'pending_analysis' | 'processing' | 'ready' | 'failed'

export type McpUrlIntakeRow = {
  id: string
  businessId: string
  sourceUrl: string
  status: McpUrlIntakeStatus
  deepLink: string
}

export type McpUrlIntakeView = {
  id: string
  businessId: string
  sourceUrl: string
  status: McpUrlIntakeStatus
  errorMessage?: string | null
  /** Bounded analysis result (facts, warnings…) once ready. */
  analysis?: Record<string, unknown> | null
  warnings?: unknown[] | null
  appliedBrandKitId?: string | null
  attemptCount?: number
}

export type McpUrlIntakeStore = {
  insertPendingUrlIntake: (row: {
    userId: string
    businessId: string
    sourceUrl: string
  }) => Promise<{ id: string }>
  /** Owner-scoped read of one intake (G3 status). Optional: stores without it stay cron-only. */
  getUrlIntake?: (input: { id: string; userId: string }) => Promise<McpUrlIntakeView | null>
  /** Claim this intake by id (pending / stale lease) and analyze it now. Optional (G3). */
  runUrlIntakeInline?: (input: { id: string; userId: string }) => Promise<unknown>
}

/** Keeps a background promise alive after the response (waitUntil); injected by the host. */
export type McpBackgroundScheduler = (work: () => Promise<unknown>) => void

function deepLinkFor(appOrigin: string | undefined, brandId: string, intakeId: string): string {
  const origin = (appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return `${origin}/chat?brand=${encodeURIComponent(brandId)}&intake=${encodeURIComponent(intakeId)}`
}

type RaceOutcome = { done: true } | { done: false; pending: Promise<unknown> }

async function runWithBudget(work: () => Promise<unknown>, budgetMs: number): Promise<RaceOutcome> {
  const pending = work().catch((err) => {
    console.error('[mcp url intake] inline analysis failed', err instanceof Error ? err.message : err)
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), budgetMs)
  })
  const winner = await Promise.race([pending.then(() => 'done' as const), timeout])
  if (timer) clearTimeout(timer)
  return winner === 'done' ? { done: true } : { done: false, pending }
}

function viewPayload(view: McpUrlIntakeView, appOrigin: string | undefined): Record<string, unknown> {
  const finished = view.status === 'ready' || view.status === 'failed'
  return {
    id: view.id,
    jobId: view.id,
    businessId: view.businessId,
    sourceUrl: view.sourceUrl,
    status: view.status,
    deepLink: deepLinkFor(appOrigin, view.businessId, view.id),
    ...(view.status === 'ready' ? { analysis: view.analysis ?? null, warnings: view.warnings ?? [], appliedBrandKitId: view.appliedBrandKitId ?? null } : {}),
    ...(view.status === 'failed' ? { error: view.errorMessage ?? 'URL analysis failed' } : {}),
    ...(finished
      ? { moreWork: false, message: view.status === 'ready' ? 'URL analyzed; brand data filled where it was empty (fill-only).' : 'URL analysis failed; check the URL or try another page.' }
      : {
        moreWork: true,
        retryAfterMs: MCP_URL_POLL_AFTER_MS,
        nextTool: 'workspace_url_context_status',
        message: 'Analysis is running. Poll workspace_url_context_status { intakeId } (or get_execute_result { jobId }) in ~10 s; each poll continues the work, no cron needed.',
      }),
  }
}

/**
 * Status of one intake; a pending or stale row is analyzed inline (within the budget) first.
 * Returns null when the intake does not exist for this user.
 */
export async function getMcpUrlContextStatus(options: {
  store: McpUrlIntakeStore
  user: McpAuthUser
  intakeId: string
  appOrigin?: string
  budgetMs?: number
  schedule?: McpBackgroundScheduler
}): Promise<Record<string, unknown> | null> {
  if (!options.store.getUrlIntake) throw new Error('URL intake status is not available in this runtime')
  const read = () => options.store.getUrlIntake!({ id: options.intakeId, userId: options.user.id })
  let view = await read()
  if (!view) return null
  if ((view.status === 'pending_analysis' || view.status === 'processing') && options.store.runUrlIntakeInline) {
    // The inline claim skips a fresh lease ('in_progress'), so this never duplicates live work.
    const run = options.store.runUrlIntakeInline
    const outcome = await runWithBudget(() => run({ id: options.intakeId, userId: options.user.id }), options.budgetMs ?? MCP_URL_INLINE_BUDGET_MS)
    if (!outcome.done) options.schedule?.(() => outcome.pending)
    view = (await read()) ?? view
  }
  return viewPayload(view, options.appOrigin)
}

export async function saveMcpUrlContext(options: {
  db: McpDbClient
  store: McpUrlIntakeStore
  user: McpAuthUser
  brandId: string
  url: string
  appOrigin?: string
  /** Default true: analyze now within the budget (G3). false = only queue it (cron path). */
  wait?: boolean
  budgetMs?: number
  schedule?: McpBackgroundScheduler
}): Promise<McpUrlIntakeRow & Record<string, unknown>> {
  if (!options.user?.id) throw new Error('Authentication required')
  if (!options.brandId) throw new Error('brandId is required')

  const validated = validateMcpGuideIntake({ url: options.url, files: [] })
  if (!validated.ok || !validated.url) throw new Error(validated.ok ? 'URL required' : validated.error)

  const brand = await options.db.getBusinessForUser(options.user.id, options.brandId)
  if (!brand) throw new Error('Brand not found')

  const inserted = await options.store.insertPendingUrlIntake({
    userId: options.user.id,
    businessId: options.brandId,
    sourceUrl: validated.url,
  })

  const queued: McpUrlIntakeRow = {
    id: inserted.id,
    businessId: options.brandId,
    sourceUrl: validated.url,
    status: 'pending_analysis',
    deepLink: deepLinkFor(options.appOrigin, options.brandId, inserted.id),
  }
  if (options.wait === false || !options.store.runUrlIntakeInline || !options.store.getUrlIntake) return queued

  const status = await getMcpUrlContextStatus({
    store: options.store,
    user: options.user,
    intakeId: inserted.id,
    appOrigin: options.appOrigin,
    budgetMs: options.budgetMs,
    schedule: options.schedule,
  })
  return { ...queued, ...(status ?? {}), id: inserted.id } as McpUrlIntakeRow & Record<string, unknown>
}
