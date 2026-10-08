import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ModelGateway } from '../../api/lib/adpack/types'

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/adpack/${name}`, import.meta.url)), 'utf8')
}

export const FIXED_NOW = () => new Date('2026-10-07T12:00:00.000Z')

type Call = { kind: 'json' | 'visionJson'; system: string; user: string; images?: string[] }

/** Fake gateway: route by a substring of the system prompt. Unmatched calls throw. */
export function fakeGateway(routes: Array<{ match: string | RegExp; data: unknown; costUsd?: number; fail?: boolean; delayMs?: number }>): ModelGateway & { calls: Call[] } {
  const calls: Call[] = []
  const answer = async (call: Call) => {
    calls.push(call)
    const route = routes.find((r) => (typeof r.match === 'string' ? call.system.includes(r.match) : r.match.test(call.system)))
    if (!route) throw new Error(`fake gateway: no route for ${call.system.slice(0, 60)}`)
    if (route.delayMs) await new Promise((resolve) => setTimeout(resolve, route.delayMs))
    if (route.fail) throw new Error('fake model failure')
    return { data: route.data as never, costUsd: route.costUsd ?? 0.001, model: 'fake-model' }
  }
  return {
    calls,
    json: (input) => answer({ kind: 'json', system: input.system, user: input.user }),
    visionJson: (input) => answer({ kind: 'visionJson', system: input.system, user: input.user, images: input.images }),
    scene: async () => { throw new Error('scene not used in DNA tests') },
  }
}

export type FakeRoute = { status?: number; body?: string; throws?: string; hang?: boolean }

/** Fake fetch keyed by URL prefix; records requests and honors AbortSignal for hanging routes. */
export function fakeFetch(routes: Record<string, FakeRoute>) {
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url, headers: (init?.headers || {}) as Record<string, string> })
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix))
    const route = key ? routes[key] : { status: 404, body: '' }
    if (route.throws) throw new Error(route.throws)
    if (route.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    return new Response(route.body ?? '', { status: route.status ?? 200 })
  }
  return { impl, requests }
}
