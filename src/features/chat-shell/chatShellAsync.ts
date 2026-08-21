import type { ChatShellSelection } from './chatShellPersistence'

/** True when a captured async op still belongs to the live thread. */
export function isLiveThread(
  liveSessionId: string | null,
  liveGeneration: number,
  originSessionId: string,
  originGeneration: number
): boolean {
  return (
    liveSessionId === originSessionId &&
    liveGeneration === originGeneration
  )
}

/** Cached folder lists switch immediately; a miss waits for the session fetch. */
export function planBrandSwitch(cachedSessions: { id: string }[] | undefined): {
  instant: boolean
  sessionId: string | null
} {
  if (cachedSessions === undefined) return { instant: false, sessionId: null }
  return { instant: true, sessionId: cachedSessions[0]?.id ?? null }
}

export function selectionsEqual(
  a: ChatShellSelection,
  b: ChatShellSelection
): boolean {
  return a.brandId === b.brandId && a.sessionId === b.sessionId
}

export function addInFlightSession(
  current: ReadonlySet<string>,
  sessionId: string
): Set<string> {
  if (current.has(sessionId)) return new Set(current)
  const next = new Set(current)
  next.add(sessionId)
  return next
}

export function removeInFlightSession(
  current: ReadonlySet<string>,
  sessionId: string
): Set<string> {
  if (!current.has(sessionId)) return new Set(current)
  const next = new Set(current)
  next.delete(sessionId)
  return next
}

export function isSessionSending(
  inFlight: ReadonlySet<string>,
  sessionId: string | null
): boolean {
  return Boolean(sessionId && inFlight.has(sessionId))
}

/** Test helper: externally resolvable promise. */
export function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
