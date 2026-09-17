import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  beginOrReplayShellImageJob,
  createMemoryImageJobStore,
  getImageJob,
  setImageJobScheduler,
  setImageJobStore,
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
})
