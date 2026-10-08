import type { ModelGateway } from '../../api/lib/adpack/types'

export interface JsonCall {
  system: string
  user: string
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface FakeGateway extends ModelGateway {
  calls: JsonCall[]
  maxInFlight: number
}

/** No-network ModelGateway. `handler` returns the JSON `data` (or throws). */
export function fakeGateway(handler: (call: JsonCall, index: number) => unknown | Promise<unknown>, delayMs = 0): FakeGateway {
  let inFlight = 0
  const gw: FakeGateway = {
    calls: [],
    maxInFlight: 0,
    async json<T>(input: JsonCall) {
      const index = gw.calls.length
      gw.calls.push(input)
      inFlight++
      gw.maxInFlight = Math.max(gw.maxInFlight, inFlight)
      try {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        const data = (await handler(input, index)) as T
        return { data, costUsd: 0.001, model: input.model ?? 'fake-model' }
      } finally {
        inFlight--
      }
    },
    async visionJson() {
      throw new Error('visionJson not used in copy tests')
    },
    async scene() {
      throw new Error('scene not used in copy tests')
    },
  }
  return gw
}
