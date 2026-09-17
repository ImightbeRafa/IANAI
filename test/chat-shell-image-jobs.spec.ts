import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  beginOrReplayShellImageJob,
  canAccessShellImageJob,
  createMemoryImageJobStore,
  getImageJob,
  overlayShellImageJobUserId,
  setImageJobScheduler,
  setImageJobStore,
  type ShellImageJob,
} from '../api/lib/image-jobs'

const JOB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('L5 shell image async jobs', () => {
  beforeEach(() => {
    setImageJobStore(createMemoryImageJobStore())
    setImageJobScheduler((work) => {
      void work()
    })
  })

  afterEach(() => {
    setImageJobScheduler((work) => {
      void work().catch(() => undefined)
    })
  })

  it('returns running, completes on poll, and replays without a second charge', async () => {
    let charges = 0
    let scheduled: Promise<void> = Promise.resolve()
    setImageJobScheduler((work) => {
      scheduled = work()
    })
    const first = await beginOrReplayShellImageJob({
      jobId: JOB_ID,
      userId: 'user-a',
      run: async () => {
        charges += 1
        return {
          statusCode: 200,
          body: {
            status: 'Ready',
            result: { sample: 'data:image/jpeg;base64,abc' },
            generationId: JOB_ID,
          },
        }
      },
    })
    expect(first.body.status).toBe('running')
    expect(first.body.jobId).toBe(JOB_ID)
    expect(first.claimed).toBe(true)

    await scheduled
    const completed = await getImageJob(JOB_ID)
    expect(completed?.status).toBe('completed')
    expect(completed?.payload.result).toEqual({ sample: 'data:image/jpeg;base64,abc' })
    expect(charges).toBe(1)

    const replay = await beginOrReplayShellImageJob({
      jobId: JOB_ID,
      userId: 'user-a',
      run: async () => {
        charges += 1
        return { statusCode: 200, body: { status: 'Ready' } }
      },
    })
    expect(replay.replayed).toBe(true)
    expect(replay.body.generationId).toBe(JOB_ID)
    expect(replay.body.result).toEqual({ sample: 'data:image/jpeg;base64,abc' })
    expect(charges).toBe(1)
  })

  it('denies replay when another user owns the generationId', async () => {
    const store = createMemoryImageJobStore()
    await store.set(ownedJob('user-a', {
      status: 'completed',
      payload: { status: 'Ready', result: { sample: 'secret-image' } },
    }))
    setImageJobStore(store)

    const denied = await beginOrReplayShellImageJob({
      jobId: JOB_ID,
      userId: 'user-b',
      run: async () => ({ statusCode: 200, body: { status: 'Ready' } }),
    })
    expect(denied.httpStatus).toBe(403)
    expect(denied.body).toEqual({ error: 'Access denied' })
    expect(denied.body).not.toHaveProperty('result')
    expect(denied.replayed).toBe(false)
    expect(denied.claimed).toBe(false)
  })

  it('fails closed when job userId is missing', async () => {
    const store = createMemoryImageJobStore()
    await store.set(ownedJob('', {
      status: 'completed',
      payload: { status: 'Ready', result: { sample: 'orphan-secret' } },
    }))
    setImageJobStore(store)

    const denied = await beginOrReplayShellImageJob({
      jobId: JOB_ID,
      userId: 'user-a',
      run: async () => ({ statusCode: 200, body: { status: 'Ready' } }),
    })
    expect(denied.httpStatus).toBe(403)
    expect(denied.body).toEqual({ error: 'Access denied' })
    expect(denied.body).not.toHaveProperty('result')
  })

  it('returns 403 on a lost claim when the winner is another user', async () => {
    const inner = createMemoryImageJobStore()
    const winnerJob = ownedJob('user-a', {
      status: 'running',
      payload: { status: 'running', result: { sample: 'race-secret' } },
    })
    setImageJobStore({
      get: async () => null,
      set: inner.set,
      claim: async () => ({ claimed: false, job: winnerJob }),
    })

    const denied = await beginOrReplayShellImageJob({
      jobId: JOB_ID,
      userId: 'user-b',
      run: async () => ({ statusCode: 200, body: { status: 'Ready', result: { leaked: true } } }),
    })
    expect(denied.httpStatus).toBe(403)
    expect(denied.body).toEqual({ error: 'Access denied' })
    expect(denied.body).not.toHaveProperty('result')
    expect(denied.claimed).toBe(false)
    expect(denied.replayed).toBe(false)
  })

  it('replays a lost claim for the same owner without leaking a 403', async () => {
    const inner = createMemoryImageJobStore()
    const winnerJob = ownedJob('user-a', {
      status: 'running',
      payload: { status: 'running', jobId: JOB_ID, generationId: JOB_ID },
    })
    setImageJobStore({
      get: async () => null,
      set: inner.set,
      claim: async () => ({ claimed: false, job: winnerJob }),
    })

    const replay = await beginOrReplayShellImageJob({
      jobId: JOB_ID,
      userId: 'user-a',
      run: async () => ({ statusCode: 200, body: { status: 'Ready' } }),
    })
    expect(replay.httpStatus).toBe(200)
    expect(replay.claimed).toBe(false)
    expect(replay.body.status).toBe('running')
    expect(replay.body.jobId).toBe(JOB_ID)
  })
})

describe('SD-01 shell image job ownership', () => {
  it('prefers the DB user_id column over JSON userId', () => {
    const fromJson = ownedJob('attacker-from-json')
    const overlaid = overlayShellImageJobUserId(fromJson, 'owner-from-column')
    expect(overlaid.userId).toBe('owner-from-column')
    expect(overlayShellImageJobUserId(fromJson, '').userId).toBe('attacker-from-json')
    expect(overlayShellImageJobUserId(fromJson, '  owner-from-column  ').userId).toBe('owner-from-column')
  })

  it('fail-closes canAccess when owner or requester is missing', () => {
    const owned = ownedJob('user-a')
    expect(canAccessShellImageJob(owned, 'user-a')).toBe(true)
    expect(canAccessShellImageJob(owned, 'user-b')).toBe(false)
    expect(canAccessShellImageJob(owned, '')).toBe(false)
    expect(canAccessShellImageJob(ownedJob(''), 'user-a')).toBe(false)
    expect(canAccessShellImageJob(null, 'user-a')).toBe(false)
  })
})

function ownedJob(
  userId: string,
  overrides: Partial<ShellImageJob> = {},
): ShellImageJob {
  const now = Date.now()
  return {
    jobId: JOB_ID,
    userId,
    status: 'completed',
    payload: {},
    charged: true,
    startedAtMs: now,
    updatedAtMs: now,
    ...overrides,
  }
}
