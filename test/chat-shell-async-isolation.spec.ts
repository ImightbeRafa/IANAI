import { describe, expect, it } from 'vitest'
import {
  addInFlightSession,
  createDeferred,
  isLiveThread,
  isSessionSending,
  planBrandSwitch,
  removeInFlightSession,
  selectionsEqual,
} from '../src/features/chat-shell/chatShellAsync'

/** Minimal stand-in for the thread gate used by useChatSessionThread. */
function createThreadGate() {
  let sessionId: string | null = null
  let generation = 0
  let loadRequest = 0
  let offerRequest = 0
  let inFlight = new Set<string>()
  let messages: string[] = []
  let offers: string[] = []
  let error: string | null = null
  let composer = ''

  return {
    get sessionId() {
      return sessionId
    },
    get generation() {
      return generation
    },
    get loadRequest() {
      return loadRequest
    },
    get messages() {
      return messages
    },
    get offers() {
      return offers
    },
    get error() {
      return error
    },
    get composer() {
      return composer
    },
    get sending() {
      return isSessionSending(inFlight, sessionId)
    },
    bind(next: string | null) {
      sessionId = next
      generation += 1
      loadRequest += 1
      if (!next) {
        messages = []
        offers = []
        error = null
        composer = ''
      }
      return { sessionId, generation, loadRequest }
    },
    capture() {
      return {
        sessionId: sessionId as string,
        generation,
        loadRequest,
        offerRequest,
      }
    },
    beginSend(originSessionId: string) {
      inFlight = addInFlightSession(inFlight, originSessionId)
    },
    endSend(originSessionId: string) {
      inFlight = removeInFlightSession(inFlight, originSessionId)
    },
    async runSend(
      origin: { sessionId: string; generation: number },
      work: Promise<{ ok: true; bubble: string } | { ok: false; error: string; text: string }>
    ) {
      this.beginSend(origin.sessionId)
      try {
        const result = await work
        if (!isLiveThread(sessionId, generation, origin.sessionId, origin.generation)) {
          return
        }
        if (result.ok) {
          messages = [...messages, result.bubble]
        } else {
          composer = result.text
          error = result.error
        }
      } finally {
        this.endSend(origin.sessionId)
      }
    },
    async runLoad(requestId: number, work: Promise<string[]>) {
      const msgs = await work
      if (requestId !== loadRequest) return
      messages = msgs
    },
    async runOffer(origin: { sessionId: string; generation: number }, work: Promise<string>) {
      const requestId = ++offerRequest
      const productId = await work
      if (requestId !== offerRequest) return
      if (!isLiveThread(sessionId, generation, origin.sessionId, origin.generation)) return
      offers = [productId]
    },
  }
}

describe('chatShellAsync helpers', () => {
  it('isLiveThread requires matching session and generation', () => {
    expect(isLiveThread('a', 1, 'a', 1)).toBe(true)
    expect(isLiveThread('b', 1, 'a', 1)).toBe(false)
    expect(isLiveThread('a', 2, 'a', 1)).toBe(false)
    expect(isLiveThread(null, 2, 'a', 1)).toBe(false)
  })

  it('scopes sending to the active session only', () => {
    let inFlight = addInFlightSession(new Set(), 'a')
    expect(isSessionSending(inFlight, 'a')).toBe(true)
    expect(isSessionSending(inFlight, 'b')).toBe(false)
    inFlight = removeInFlightSession(inFlight, 'a')
    expect(isSessionSending(inFlight, 'a')).toBe(false)
  })

  it('selectionsEqual compares brand and session', () => {
    expect(
      selectionsEqual(
        { brandId: 'b1', sessionId: 's1' },
        { brandId: 'b1', sessionId: 's1' }
      )
    ).toBe(true)
    expect(
      selectionsEqual(
        { brandId: 'b1', sessionId: 's1' },
        { brandId: 'b1', sessionId: 's2' }
      )
    ).toBe(false)
  })
})

describe('thread async isolation races', () => {
  it('ignores A send success after switching to B', async () => {
    const gate = createThreadGate()
    gate.bind('A')
    const origin = gate.capture()
    const deferred = createDeferred<{ ok: true; bubble: string }>()

    const sendPromise = gate.runSend(origin, deferred.promise)
    gate.bind('B')
    deferred.resolve({ ok: true, bubble: 'from-A' })
    await sendPromise

    expect(gate.sessionId).toBe('B')
    expect(gate.messages).toEqual([])
    expect(gate.sending).toBe(false)
  })

  it('ignores A send failure after switching to B', async () => {
    const gate = createThreadGate()
    gate.bind('A')
    const origin = gate.capture()
    const deferred = createDeferred<{ ok: false; error: string; text: string }>()

    const sendPromise = gate.runSend(origin, deferred.promise)
    gate.bind('B')
    deferred.resolve({ ok: false, error: 'boom', text: 'retry me' })
    await sendPromise

    expect(gate.sessionId).toBe('B')
    expect(gate.messages).toEqual([])
    expect(gate.error).toBeNull()
    expect(gate.composer).toBe('')
    expect(gate.sending).toBe(false)
  })

  it('allows B send while A remains pending', async () => {
    const gate = createThreadGate()
    gate.bind('A')
    const originA = gate.capture()
    const deferredA = createDeferred<{ ok: true; bubble: string }>()
    const sendA = gate.runSend(originA, deferredA.promise)

    gate.bind('B')
    expect(gate.sending).toBe(false)

    const originB = gate.capture()
    const deferredB = createDeferred<{ ok: true; bubble: string }>()
    const sendB = gate.runSend(originB, deferredB.promise)
    expect(gate.sending).toBe(true)

    deferredB.resolve({ ok: true, bubble: 'from-B' })
    await sendB
    expect(gate.messages).toEqual(['from-B'])

    deferredA.resolve({ ok: true, bubble: 'from-A' })
    await sendA
    expect(gate.messages).toEqual(['from-B'])
  })

  it('rejects A→B→A stale generation', async () => {
    const gate = createThreadGate()
    gate.bind('A')
    const originA1 = gate.capture()
    const deferred = createDeferred<{ ok: true; bubble: string }>()
    const sendPromise = gate.runSend(originA1, deferred.promise)

    gate.bind('B')
    gate.bind('A') // back to A, but newer generation
    deferred.resolve({ ok: true, bubble: 'stale-A' })
    await sendPromise

    expect(gate.sessionId).toBe('A')
    expect(gate.messages).toEqual([])
  })

  it('keeps null thread empty after deferred load', async () => {
    const gate = createThreadGate()
    gate.bind('A')
    const { loadRequest } = gate.capture()
    const deferred = createDeferred<string[]>()
    const loadPromise = gate.runLoad(loadRequest, deferred.promise)

    gate.bind(null)
    deferred.resolve(['stale-msg'])
    await loadPromise

    expect(gate.sessionId).toBeNull()
    expect(gate.messages).toEqual([])
  })

  it('ignores stale primary-offer result after A→B', async () => {
    const gate = createThreadGate()
    gate.bind('A')
    const origin = gate.capture()
    const deferred = createDeferred<string>()
    const offerPromise = gate.runOffer(origin, deferred.promise)

    gate.bind('B')
    deferred.resolve('product-from-A')
    await offerPromise

    expect(gate.offers).toEqual([])
  })

  it('keeps click made while businesses hydrate (epoch gate)', async () => {
    let epoch = 0
    let activeSession: string | null = null
    const deferred = createDeferred<string[]>()

    const hydrateEpoch = epoch
    const hydratePromise = (async () => {
      const list = await deferred.promise
      if (epoch !== hydrateEpoch) return { applied: false as const, list }
      activeSession = list[0] ?? null
      return { applied: true as const, list }
    })()

    // User clicks B while hydrate is in flight.
    epoch += 1
    activeSession = 'B'

    deferred.resolve(['A', 'B', 'C'])
    const result = await hydratePromise

    expect(result.applied).toBe(false)
    expect(activeSession).toBe('B')
  })

  it('does not seed stale Quick brand into the wrong list', async () => {
    let epoch = 0
    let activeBrand = 'brand-1'
    let sessions: Array<{ id: string; business_id: string }> = [
      { id: 'old', business_id: 'brand-1' },
    ]
    const createEpoch = epoch
    const deferred = createDeferred<{ id: string; business_id: string }>()

    const createPromise = (async () => {
      const session = await deferred.promise
      // Epoch + brand check before setSessions (Codex P2#1).
      if (epoch !== createEpoch) return
      if (activeBrand !== session.business_id) return
      sessions = [session, ...sessions.filter((s) => s.id !== session.id)]
    })()

    // User switches brand while Quick create is in flight.
    epoch += 1
    activeBrand = 'brand-2'
    sessions = [{ id: 'brand2-s', business_id: 'brand-2' }]

    deferred.resolve({ id: 'quick-new', business_id: 'brand-1' })
    await createPromise

    expect(sessions.map((s) => s.id)).toEqual(['brand2-s'])
    expect(sessions.every((s) => s.business_id === 'brand-2')).toBe(true)
  })

  it('switches instantly when the destination folder already has a session cache', () => {
    expect(planBrandSwitch(undefined)).toEqual({ instant: false, sessionId: null })
    expect(planBrandSwitch([])).toEqual({ instant: true, sessionId: null })
    expect(planBrandSwitch([{ id: 's-luna' }, { id: 's-old' }])).toEqual({
      instant: true,
      sessionId: 's-luna',
    })
  })
})
