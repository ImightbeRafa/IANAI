import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CREATE_SESSION_COALESCE_MS,
  createSessionFlightKey,
  peekCreateSessionInFlightForTests,
  resetCreateSessionFlightsForTests,
  runCreateSessionSingleFlight,
} from '../src/features/chat-shell/chatShellCreateSessionGate'
import { createDeferred } from '../src/features/chat-shell/chatShellAsync'

afterEach(() => {
  resetCreateSessionFlightsForTests()
  vi.useRealTimers()
})

describe('runCreateSessionSingleFlight', () => {
  it('joins concurrent callers onto one create', async () => {
    const deferred = createDeferred<string | null>()
    const create = vi.fn(() => deferred.promise)
    const key = createSessionFlightKey('user-1', 'brand-1')

    const a = runCreateSessionSingleFlight(key, create)
    const b = runCreateSessionSingleFlight(key, create)
    expect(peekCreateSessionInFlightForTests(key)).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)

    deferred.resolve('session-a')
    await expect(a).resolves.toBe('session-a')
    await expect(b).resolves.toBe('session-a')
    expect(peekCreateSessionInFlightForTests(key)).toBe(false)
  })

  it('coalesces a second create within the post-success window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const create = vi.fn()
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    const key = createSessionFlightKey('user-1', 'brand-1')

    await expect(runCreateSessionSingleFlight(key, create)).resolves.toBe('session-1')
    await expect(runCreateSessionSingleFlight(key, create)).resolves.toBe('session-1')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('allows a new create after the coalesce window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const create = vi.fn()
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    const key = createSessionFlightKey('user-1', 'brand-1')

    await expect(runCreateSessionSingleFlight(key, create)).resolves.toBe('session-1')
    vi.setSystemTime(1_000_000 + CREATE_SESSION_COALESCE_MS + 1)
    await expect(runCreateSessionSingleFlight(key, create)).resolves.toBe('session-2')
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('isolates flights by user+brand key', async () => {
    const createA = vi.fn(async () => 'a')
    const createB = vi.fn(async () => 'b')
    await expect(
      runCreateSessionSingleFlight(createSessionFlightKey('u', 'brand-a'), createA)
    ).resolves.toBe('a')
    await expect(
      runCreateSessionSingleFlight(createSessionFlightKey('u', 'brand-b'), createB)
    ).resolves.toBe('b')
    expect(createA).toHaveBeenCalledTimes(1)
    expect(createB).toHaveBeenCalledTimes(1)
  })
})
