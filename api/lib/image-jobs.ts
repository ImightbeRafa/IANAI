/**
 * Chat-shell image jobs — generationId is the job id (MCP-style claim + poll).
 * Memory store for tests; optional supabase persist via mcp_approval_tokens
 * (tool_name = web_generate_image) so waitUntil + poll survive isolates.
 */

import { createHash } from 'node:crypto'
import { getSupabaseAdmin } from './supabase-admin.js'

const SHELL_IMAGE_TOOL = 'web_generate_image'
const SHELL_IMAGE_TTL_MS = 60 * 60 * 1000

export type ShellImageJobStatus = 'running' | 'completed' | 'failed'

export type ShellImageJob = {
  jobId: string
  userId: string
  status: ShellImageJobStatus
  payload: Record<string, unknown>
  charged: boolean
  startedAtMs: number
  updatedAtMs: number
}

export type ShellImageJobStore = {
  get: (jobId: string) => Promise<ShellImageJob | null>
  set: (job: ShellImageJob) => Promise<void>
  /** CAS: insert only when missing. Returns the stored row (claimed or existing). */
  claim: (job: ShellImageJob) => Promise<{ claimed: boolean; job: ShellImageJob }>
}

const memory = new Map<string, ShellImageJob>()

export function createMemoryImageJobStore(): ShellImageJobStore {
  const map = new Map<string, ShellImageJob>()
  return {
    async get(jobId) {
      return map.get(jobId) || null
    },
    async set(job) {
      map.set(job.jobId, { ...job, updatedAtMs: Date.now() })
    },
    async claim(job) {
      const existing = map.get(job.jobId)
      if (existing) return { claimed: false, job: existing }
      const stored = { ...job, updatedAtMs: Date.now() }
      map.set(job.jobId, stored)
      return { claimed: true, job: stored }
    },
  }
}

function tokenHashForJob(jobId: string): string {
  return createHash('sha256').update(`${SHELL_IMAGE_TOOL}:${jobId}`).digest('hex')
}

function asShellImageJob(value: unknown): ShellImageJob | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Partial<ShellImageJob>
  if (typeof rec.jobId !== 'string' || typeof rec.status !== 'string') return null
  if (rec.status !== 'running' && rec.status !== 'completed' && rec.status !== 'failed') return null
  return {
    jobId: rec.jobId,
    userId: typeof rec.userId === 'string' ? rec.userId : '',
    status: rec.status,
    payload: rec.payload && typeof rec.payload === 'object' ? rec.payload as Record<string, unknown> : {},
    charged: rec.charged === true,
    startedAtMs: typeof rec.startedAtMs === 'number' ? rec.startedAtMs : Date.now(),
    updatedAtMs: typeof rec.updatedAtMs === 'number' ? rec.updatedAtMs : Date.now(),
  }
}

async function supabaseGetJob(jobId: string): Promise<ShellImageJob | null> {
  const db = getSupabaseAdmin()
  if (!db || !jobId) return null
  const { data, error } = await db
    .from('mcp_approval_tokens')
    .select('result_json, user_id')
    .eq('id', jobId)
    .eq('tool_name', SHELL_IMAGE_TOOL)
    .maybeSingle()
  if (error || !data) return null
  const parsed = asShellImageJob(data.result_json)
  if (parsed) return parsed
  return null
}

async function supabaseSetJob(job: ShellImageJob): Promise<void> {
  const db = getSupabaseAdmin()
  if (!db) return
  const now = new Date().toISOString()
  const expires = new Date(job.startedAtMs + SHELL_IMAGE_TTL_MS).toISOString()
  const { error } = await db.from('mcp_approval_tokens').upsert({
    id: job.jobId,
    token_hash: tokenHashForJob(job.jobId),
    user_id: job.userId || '00000000-0000-0000-0000-000000000000',
    tool_name: SHELL_IMAGE_TOOL,
    input_hash: job.jobId,
    input_json: { generationId: job.jobId },
    quoted_credit_cost: null,
    status: job.status === 'failed' ? 'denied' : job.status === 'completed' ? 'consumed' : 'approved',
    created_at: new Date(job.startedAtMs).toISOString(),
    expires_at: expires,
    result_json: job,
    result_stored_at: now,
  }, { onConflict: 'id' })
  if (error) {
    console.warn('shell image job persist failed', error.message)
  }
}

let store: ShellImageJobStore = {
  async get(jobId) {
    const local = memory.get(jobId)
    if (local) return local
    const remote = await supabaseGetJob(jobId)
    if (remote) memory.set(jobId, remote)
    return remote
  },
  async set(job) {
    const stored = { ...job, updatedAtMs: Date.now() }
    memory.set(job.jobId, stored)
    await supabaseSetJob(stored)
  },
  async claim(job) {
    const local = memory.get(job.jobId)
    if (local) return { claimed: false, job: local }
    const remote = await supabaseGetJob(job.jobId)
    if (remote) {
      memory.set(job.jobId, remote)
      return { claimed: false, job: remote }
    }
    const stored = { ...job, updatedAtMs: Date.now() }
    memory.set(job.jobId, stored)
    const db = getSupabaseAdmin()
    if (!db) return { claimed: true, job: stored }
    const { error } = await db.from('mcp_approval_tokens').insert({
      id: stored.jobId,
      token_hash: tokenHashForJob(stored.jobId),
      user_id: stored.userId || '00000000-0000-0000-0000-000000000000',
      tool_name: SHELL_IMAGE_TOOL,
      input_hash: stored.jobId,
      input_json: { generationId: stored.jobId },
      quoted_credit_cost: null,
      status: 'approved',
      created_at: new Date(stored.startedAtMs).toISOString(),
      expires_at: new Date(stored.startedAtMs + SHELL_IMAGE_TTL_MS).toISOString(),
      result_json: stored,
      result_stored_at: new Date(stored.updatedAtMs).toISOString(),
    })
    if (error) {
      const winner = await supabaseGetJob(job.jobId)
      if (winner) {
        memory.set(job.jobId, winner)
        return { claimed: false, job: winner }
      }
      console.warn('shell image job claim persist failed', error.message)
    }
    return { claimed: true, job: stored }
  },
}

type ImageJobScheduler = (work: () => Promise<void>) => void

let scheduleImpl: ImageJobScheduler = (work) => {
  void work().catch((err) => {
    console.error('shell image job (unscheduled)', err instanceof Error ? err.message : err)
  })
}

export function setImageJobStore(next: ShellImageJobStore): void {
  store = next
}

export function setImageJobScheduler(fn: ImageJobScheduler): void {
  scheduleImpl = fn
}

export function scheduleImageJob(work: () => Promise<void>): void {
  scheduleImpl(work)
}

export async function getImageJob(jobId: string): Promise<ShellImageJob | null> {
  if (!jobId) return null
  return store.get(jobId)
}

export async function claimImageJob(options: {
  jobId: string
  userId: string
}): Promise<{ claimed: boolean; job: ShellImageJob }> {
  const now = Date.now()
  return store.claim({
    jobId: options.jobId,
    userId: options.userId,
    status: 'running',
    payload: { status: 'running', jobId: options.jobId, generationId: options.jobId },
    charged: false,
    startedAtMs: now,
    updatedAtMs: now,
  })
}

export async function completeImageJob(
  jobId: string,
  payload: Record<string, unknown>,
  options?: { charged?: boolean }
): Promise<ShellImageJob> {
  const existing = await store.get(jobId)
  const now = Date.now()
  const job: ShellImageJob = {
    jobId,
    userId: existing?.userId || '',
    status: 'completed',
    payload: {
      ...payload,
      status: 'completed',
      jobId,
      generationId: typeof payload.generationId === 'string' ? payload.generationId : jobId,
    },
    charged: options?.charged ?? existing?.charged ?? true,
    startedAtMs: existing?.startedAtMs || now,
    updatedAtMs: now,
  }
  await store.set(job)
  return job
}

export async function failImageJob(jobId: string, error: string): Promise<ShellImageJob> {
  const existing = await store.get(jobId)
  const now = Date.now()
  const job: ShellImageJob = {
    jobId,
    userId: existing?.userId || '',
    status: 'failed',
    payload: {
      status: 'failed',
      jobId,
      generationId: jobId,
      error,
    },
    charged: false,
    startedAtMs: existing?.startedAtMs || now,
    updatedAtMs: now,
  }
  await store.set(job)
  return job
}

export function jobToHttpPayload(job: ShellImageJob): Record<string, unknown> {
  if (job.status === 'running') {
    return { status: 'running', jobId: job.jobId, generationId: job.jobId }
  }
  return { ...job.payload, jobId: job.jobId }
}

export function isReplayableCompletedJob(job: ShellImageJob | null): boolean {
  return job?.status === 'completed' && !!job.payload
}

export type ShellImageJobRunResult = {
  statusCode: number
  body: Record<string, unknown>
}

export type BeginShellImageJobResult = {
  httpStatus: number
  body: Record<string, unknown>
  claimed: boolean
  replayed: boolean
}

/**
 * Claim + schedule, or replay a completed/running job for the same generationId.
 * The scheduled `run` must charge credits; replay must not call `run`.
 */
export async function beginOrReplayShellImageJob(options: {
  jobId: string
  userId: string
  run: () => Promise<ShellImageJobRunResult>
}): Promise<BeginShellImageJobResult> {
  const existing = await getImageJob(options.jobId)
  if (existing && existing.userId && existing.userId !== options.userId) {
    return {
      httpStatus: 403,
      body: { error: 'Access denied' },
      claimed: false,
      replayed: false,
    }
  }
  if (isReplayableCompletedJob(existing) && existing) {
    return {
      httpStatus: 200,
      body: jobToHttpPayload(existing),
      claimed: false,
      replayed: true,
    }
  }
  if (existing?.status === 'running') {
    return {
      httpStatus: 200,
      body: jobToHttpPayload(existing),
      claimed: false,
      replayed: false,
    }
  }
  const { claimed, job } = await claimImageJob({ jobId: options.jobId, userId: options.userId })
  if (!claimed) {
    return {
      httpStatus: 200,
      body: jobToHttpPayload(job),
      claimed: false,
      replayed: isReplayableCompletedJob(job),
    }
  }
  scheduleImageJob(async () => {
    try {
      const result = await options.run()
      const payload = result.body && typeof result.body === 'object' ? result.body : {}
      if (result.statusCode >= 400) {
        await failImageJob(options.jobId, String(payload.error || 'Image generation failed'))
        return
      }
      await completeImageJob(options.jobId, payload, { charged: true })
    } catch (err) {
      await failImageJob(
        options.jobId,
        err instanceof Error ? err.message : 'Image generation failed'
      )
    }
  })
  return {
    httpStatus: 200,
    body: { status: 'running', jobId: options.jobId, generationId: options.jobId },
    claimed: true,
    replayed: false,
  }
}
