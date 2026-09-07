/**
 * Module-level single-flight for Chat nuevo creates.
 * Survives React Strict Mode remounts (instance refs reset; this map does not).
 * Joins concurrent callers; coalesces a short post-success window to absorb ghost clicks.
 */

const inFlight = new Map<string, Promise<string | null>>()
const recentOk = new Map<string, { sessionId: string; atMs: number }>()

/** Absorb delayed second handler / ghost click after the first insert settles. */
export const CREATE_SESSION_COALESCE_MS = 2000

export function createSessionFlightKey(userId: string, brandId: string): string {
  return `${userId}:${brandId}`
}

/**
 * Run at most one create per key at a time. Concurrent callers await the same promise.
 * After success, repeats within CREATE_SESSION_COALESCE_MS return the same session id
 * without invoking `create` again.
 */
export function runCreateSessionSingleFlight(
  key: string,
  create: () => Promise<string | null>,
  nowMs: number = Date.now()
): Promise<string | null> {
  const existing = inFlight.get(key)
  if (existing) return existing

  const recent = recentOk.get(key)
  if (recent && nowMs - recent.atMs < CREATE_SESSION_COALESCE_MS) {
    return Promise.resolve(recent.sessionId)
  }

  const settled = (async (): Promise<string | null> => {
    try {
      const sessionId = await create()
      if (sessionId) {
        recentOk.set(key, { sessionId, atMs: Date.now() })
      }
      return sessionId
    } finally {
      inFlight.delete(key)
    }
  })()

  inFlight.set(key, settled)
  return settled
}

/** Test-only: clear module gates between cases. */
export function resetCreateSessionFlightsForTests(): void {
  inFlight.clear()
  recentOk.clear()
}

export function peekCreateSessionInFlightForTests(key: string): boolean {
  return inFlight.has(key)
}
