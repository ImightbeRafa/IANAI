import { describe, expect, it } from 'vitest'
import { getDeadlineSignal } from '../api/lib/request-deadline.js'

// Round-6 operator review, item C, "Vercel path unchanged" case. This is a
// unit test (not a real-HTTP one, unlike the rest of item C's coverage in
// test/cf-server-adapter.spec.ts) because the thing being proven — Vercel
// never sets the magic property server.mjs sets — has no Vercel runtime to
// exercise here at all; a plain object is the honest way to represent that.
describe('getDeadlineSignal (unit)', () => {
  it('returns undefined when the magic property is absent, exactly like a real Vercel request', () => {
    const fakeVercelReq = { method: 'GET', headers: {}, query: {} } as unknown as Parameters<
      typeof getDeadlineSignal
    >[0]
    expect(getDeadlineSignal(fakeVercelReq)).toBeUndefined()
  })

  it('returns the AbortSignal when server.mjs has set it', () => {
    const controller = new AbortController()
    const fakeReq = { __cfDeadlineSignal: controller.signal } as unknown as Parameters<typeof getDeadlineSignal>[0]
    expect(getDeadlineSignal(fakeReq)).toBe(controller.signal)
  })

  it('returns undefined for a non-AbortSignal value (defensive, should never happen in practice)', () => {
    const fakeReq = { __cfDeadlineSignal: 'not-a-signal' } as unknown as Parameters<typeof getDeadlineSignal>[0]
    expect(getDeadlineSignal(fakeReq)).toBeUndefined()
  })
})
