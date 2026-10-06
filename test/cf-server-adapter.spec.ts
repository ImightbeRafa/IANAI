import { randomBytes, createHash } from 'node:crypto'
import http from 'node:http'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startAdapter, type AdapterHandle } from './helpers/cf-server'
import { CF_CONTENT_SECURITY_POLICY } from '../cf/http-rules.mjs'

const API_DIR = resolve(new URL('./fixtures/cf-api', import.meta.url).pathname)
const STATIC_DIR = resolve(new URL('./fixtures/cf-static', import.meta.url).pathname)

let adapter: AdapterHandle

beforeAll(async () => {
  adapter = await startAdapter({ apiDir: API_DIR, staticDir: STATIC_DIR })
})

afterAll(async () => {
  await adapter.stop()
})

async function request(
  path: string,
  init?: RequestInit & { redirect?: RequestRedirect }
): Promise<Response> {
  return fetch(`${adapter.baseUrl}${path}`, init)
}

describe('cf server adapter', () => {
  describe('query', () => {
    it('parses repeated keys and bare flags', async () => {
      const res = await request('/api/echo?a=1&b=2&b=3&flag')
      const body = await res.json()
      expect(body.query).toEqual({ a: '1', b: ['2', '3'], flag: '' })
    })

    it('decodes percent-encoded unicode', async () => {
      const res = await request('/api/echo?q=hello%20world&x=%E2%9C%93')
      const body = await res.json()
      expect(body.query).toEqual({ q: 'hello world', x: '✓' })
    })
  })

  describe('body', () => {
    it('parses application/json', async () => {
      const res = await request('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: 1, y: [true] }),
      })
      const body = await res.json()
      expect(body.bodyType).toBe('object')
      expect(body.body).toEqual({ x: 1, y: [true] })
    })

    it('parses application/json with charset', async () => {
      const res = await request('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ x: 1, y: [true] }),
      })
      const body = await res.json()
      expect(body.bodyType).toBe('object')
      expect(body.body).toEqual({ x: 1, y: [true] })
    })

    it('gives {} for an empty JSON body', async () => {
      const res = await request('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '',
      })
      const body = await res.json()
      expect(body.body).toEqual({})
    })

    it('gives 400 Invalid JSON for malformed bodies', async () => {
      const res = await request('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad',
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid JSON' })
    })

    it('parses urlencoded bodies', async () => {
      const res = await request('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'a=1&a=2&b=x+y',
      })
      const body = await res.json()
      expect(body.body).toEqual({ a: ['1', '2'], b: 'x y' })
    })

    it('parses text/plain', async () => {
      const res = await request('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello',
      })
      const body = await res.json()
      expect(body.body).toBe('hello')
      expect(body.bodyType).toBe('string')
    })

    it('parses application/octet-stream as a Buffer', async () => {
      const res = await request('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: Uint8Array.from([1, 2, 3]),
      })
      const body = await res.json()
      expect(body.bodyType).toBe('buffer')
      expect(body.bodyLength).toBe(3)
    })

    it('gives undefined for multipart/form-data', async () => {
      const res = await request('/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=z' },
        body: 'irrelevant',
      })
      const body = await res.json()
      expect(body.bodyType).toBe('undefined')
    })

    it('gives an empty string body for GET with no content-type', async () => {
      const res = await request('/api/echo')
      const body = await res.json()
      expect(body.body).toBe('')
      expect(body.bodyType).toBe('string')
    })
  })

  describe('cookies', () => {
    it('parses and decodes cookies', async () => {
      const res = await request('/api/echo', {
        headers: { cookie: 'session=abc; theme=dark; enc=a%20b' },
      })
      const body = await res.json()
      expect(body.cookies).toEqual({ session: 'abc', theme: 'dark', enc: 'a b' })
    })

    it('gives {} with no cookie header', async () => {
      const res = await request('/api/echo')
      const body = await res.json()
      expect(body.cookies).toEqual({})
    })
  })

  describe('response helpers', () => {
    it('send-string', async () => {
      const res = await request('/api/respond?mode=send-string')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(res.headers.get('content-length')).toBe('5')
      expect(await res.text()).toBe('hello')
    })

    it('send-buffer', async () => {
      const res = await request('/api/respond?mode=send-buffer')
      expect(res.headers.get('content-type')).toBe('application/octet-stream')
      const buf = new Uint8Array(await res.arrayBuffer())
      expect(Array.from(buf)).toEqual([1, 2, 3])
    })

    it('send-object', async () => {
      const res = await request('/api/respond?mode=send-object')
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
      expect(await res.text()).toBe('{"a":1}')
    })

    it('status-json', async () => {
      const res = await request('/api/respond?mode=status-json')
      expect(res.status).toBe(201)
    })

    it('redirect default 307', async () => {
      const res = await request('/api/respond?mode=redirect', { redirect: 'manual' })
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe('/login')
    })

    it('redirect-301', async () => {
      const res = await request('/api/respond?mode=redirect-301', { redirect: 'manual' })
      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe('https://example.test/x')
    })

    it('end-204', async () => {
      const res = await request('/api/respond?mode=end-204')
      expect(res.status).toBe(204)
      expect(await res.text()).toBe('')
    })
  })

  describe('routing', () => {
    it('routes nested handlers', async () => {
      const res = await request('/api/nested/deep')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ nested: true })
    })

    it.each([
      '/api/nested/missing',
      '/api/does-not-exist',
      '/api/lib/helper',
      '/api/_bg-state',
      '/api/no-default',
    ])('gives 404 Not found for %s', async (path) => {
      const res = await request(path)
      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
      expect(await res.json()).toEqual({ error: 'Not found' })
    })

    it('does not leak server.mjs source via path traversal', async () => {
      const body = await new Promise<string>((resolvePromise, rejectPromise) => {
        const url = new URL(adapter.baseUrl)
        const req = http.request(
          { host: url.hostname, port: url.port, path: '/%2e%2e/server.mjs', method: 'GET' },
          (res) => {
            let data = ''
            res.on('data', (c) => (data += c))
            res.on('end', () => resolvePromise(data))
          }
        )
        req.on('error', rejectPromise)
        req.end()
      })
      expect(body).not.toContain('startServer')
    })
  })

  describe('limits (octet-stream)', () => {
    it('limit-default accepts exactly the default limit', async () => {
      const res = await request('/api/limit-default', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(4_718_592),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyType: 'buffer', length: 4_718_592 })
    })

    it('limit-default rejects one byte over', async () => {
      const res = await request('/api/limit-default', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(4_718_593),
      })
      expect(res.status).toBe(413)
      expect(await res.json()).toEqual({ error: 'Payload too large' })
    })

    it('limit-default rejects a chunked body over the limit with no content-length', async () => {
      const status = await new Promise<number>((resolvePromise, rejectPromise) => {
        const url = new URL(adapter.baseUrl)
        const req = http.request(
          {
            host: url.hostname,
            port: url.port,
            path: '/api/limit-default',
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
          },
          (res) => {
            res.on('data', () => {})
            res.on('end', () => resolvePromise(res.statusCode ?? 0))
          }
        )
        req.on('error', rejectPromise)
        req.write(Buffer.alloc(4_718_593))
        req.end()
      })
      expect(status).toBe(413)
    })

    // Round-6 operator review, item H: both bodies here are over
    // DEFAULT_BODY_LIMIT, so both requests need a Bearer header to get past
    // the pre-auth gate and exercise the 200/413 behavior these tests are
    // actually about (dedicated gate coverage is in its own describe block).
    it('limit-10mb', async () => {
      const ok = await request('/api/limit-10mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: new Uint8Array(10_485_760),
      })
      expect(ok.status).toBe(200)

      const tooBig = await request('/api/limit-10mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: new Uint8Array(10_485_761),
      })
      expect(tooBig.status).toBe(413)
    })

    it('limit-25mb', async () => {
      const ok = await request('/api/limit-25mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: new Uint8Array(26_214_400),
      })
      expect(ok.status).toBe(200)

      const tooBig = await request('/api/limit-25mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: new Uint8Array(26_214_401),
      })
      expect(tooBig.status).toBe(413)
    }, 20_000)
  })

  // Round-6 operator review, item H: every body here is over
  // DEFAULT_BODY_LIMIT (4.5 MiB), so each request now needs a (shape-only —
  // the adapter never validates it) Authorization: Bearer header to get
  // past the pre-auth gate before reaching the cap/limit behavior these
  // tests are actually about. See the dedicated "pre-auth gate" describe
  // block below for coverage of the gate itself.
  describe('raw stream', () => {
    it('bypasses the parsed-body limit when bodyParser is false (still under the 10 MiB raw-stream cap)', async () => {
      const bytes = randomBytes(5_242_880)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const res = await request('/api/raw-stream', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x', authorization: 'Bearer test-token' },
        body: bytes,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyIsUndefined: true, length: 5_242_880, sha256 })
    })

    it('accepts exactly 10 MiB on a raw stream, sha256 intact', async () => {
      const bytes = randomBytes(10_485_760)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const res = await request('/api/raw-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: bytes,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyIsUndefined: true, length: 10_485_760, sha256 })
    }, 20_000)

    it('rejects a raw stream one byte over 10 MiB (Content-Length known upfront)', async () => {
      const res = await request('/api/raw-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: randomBytes(10_485_761),
      })
      expect(res.status).toBe(413)
      expect(await res.json()).toEqual({ error: 'Payload too large' })
    }, 20_000)

    it('rejects a chunked raw stream over 10 MiB with no Content-Length', async () => {
      const status = await new Promise<number>((resolvePromise, rejectPromise) => {
        const url = new URL(adapter.baseUrl)
        const req = http.request(
          {
            host: url.hostname,
            port: url.port,
            path: '/api/raw-stream',
            method: 'POST',
            headers: {
              'content-type': 'application/octet-stream',
              'transfer-encoding': 'chunked',
              authorization: 'Bearer test-token',
            },
          },
          (res) => {
            res.on('data', () => {})
            res.on('end', () => resolvePromise(res.statusCode ?? 0))
          }
        )
        req.on('error', () => resolvePromise(0))
        req.write(Buffer.alloc(10_485_761))
        req.end()
      })
      expect(status).toBe(413)
    }, 20_000)
  })

  // These mirror api/parse-pdf.ts's real shape: an await (e.g.
  // supabase.auth.getUser) happens before the handler ever touches the
  // request stream, so the proxy counting bytes must never switch the
  // stream into flowing mode itself — only the handler's own later
  // req.on('data') may do that. See test/fixtures/cf-api/raw-stream-delayed.js.
  describe('raw stream (handler attaches listeners late, like parse-pdf.ts)', () => {
    it('a 5 MiB body sent well before the handler attaches still arrives with exact length and sha256', async () => {
      const bytes = randomBytes(5_242_880)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const res = await request('/api/raw-stream-delayed', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: bytes,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyIsUndefined: true, length: 5_242_880, sha256 })
    }, 20_000)

    it('accepts exactly 10 MiB with the handler attaching late', async () => {
      const bytes = randomBytes(10_485_760)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const res = await request('/api/raw-stream-delayed', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: bytes,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyIsUndefined: true, length: 10_485_760, sha256 })
    }, 20_000)

    it('rejects a chunked body over 10 MiB even though the handler attaches late', async () => {
      const status = await new Promise<number>((resolvePromise) => {
        const url = new URL(adapter.baseUrl)
        const req = http.request(
          {
            host: url.hostname,
            port: url.port,
            path: '/api/raw-stream-delayed',
            method: 'POST',
            headers: {
              'content-type': 'application/octet-stream',
              'transfer-encoding': 'chunked',
              authorization: 'Bearer test-token',
            },
          },
          (res) => {
            res.on('data', () => {})
            res.on('end', () => resolvePromise(res.statusCode ?? 0))
          }
        )
        req.on('error', () => resolvePromise(0))
        req.write(Buffer.alloc(10_485_761))
        req.end()
      })
      expect(status).toBe(413)
    }, 20_000)

    it('a tiny 3-byte body that finishes long before the handler attaches still arrives intact', async () => {
      const bytes = new Uint8Array([1, 2, 3])
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const res = await request('/api/raw-stream-delayed', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyIsUndefined: true, length: 3, sha256 })
    })
  })

  // Round-6 operator review, item D: the raw-stream pump's backpressure
  // handling was registering a fresh counter.once('drain', ...) every time
  // it hit backpressure while already waiting for a previous drain (because
  // 'readable' kept re-firing on the real stream during that wait) —
  // producing MaxListenersExceededWarning, and because pause()/resume() on
  // the real stream were themselves no-ops (no 'data' listener is ever
  // attached to it), the whole body still got buffered into the counting
  // PassThrough regardless of whether the consumer was ready for it.
  describe('raw stream backpressure (round-6 operator review, item D)', () => {
    it('a 9.5 MiB late-read upload produces no MaxListenersExceededWarning, and the body still arrives intact', async () => {
      const bytes = randomBytes(9_961_472) // 9.5 MiB, well under the 10 MiB cap
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const res = await request('/api/raw-stream-delayed', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
        body: bytes,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyIsUndefined: true, length: 9_961_472, sha256 })
      expect(adapter.output()).not.toContain('MaxListenersExceededWarning')
    }, 20_000)

    it('buffers only near a stream highWaterMark while the handler sleeps, not the whole body', async () => {
      const debugAdapter = await startAdapter({
        apiDir: API_DIR,
        staticDir: STATIC_DIR,
        env: { RAW_STREAM_DEBUG_MAX_BUFFERED: '1' },
      })
      try {
        const bytes = randomBytes(9_961_472)
        const res = await fetch(`${debugAdapter.baseUrl}/api/raw-stream-delayed`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-token' },
          body: bytes,
        })
        expect(res.status).toBe(200)
        await res.json()

        const match = /raw-stream max buffered bytes: (\d+)/.exec(debugAdapter.output())
        expect(match).not.toBeNull()
        const maxBuffered = Number(match?.[1])
        // Generously below the full 9.5 MiB body — proves backpressure
        // bounded memory instead of buffering everything while nobody was
        // reading (default stream highWaterMark is 16 KiB per side).
        expect(maxBuffered).toBeLessThan(2 * 1024 * 1024)
      } finally {
        await debugAdapter.stop()
      }
    }, 20_000)

    it('a slow consumer (real pauses between reads) does not deadlock, and the body arrives intact', async () => {
      const bytes = randomBytes(2_097_152) // 2 MiB — enough to cross backpressure several times with 5ms pauses
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const res = await request('/api/raw-stream-slow-consumer', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyIsUndefined: true, length: 2_097_152, sha256 })
    }, 20_000)
  })

  describe('route deadlines (per-route maxDuration)', () => {
    it('a handler that responds within its deadline gives 200', async () => {
      const res = await request('/api/slow?ms=50')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ slept: 50 })
    })

    it('a handler slower than its deadline gives 504, and the handler writing afterward does not crash the server', async () => {
      const res = await request('/api/slow?ms=700')
      expect(res.status).toBe(504)
      expect(await res.json()).toEqual({ error: 'Gateway Timeout' })

      // The fixture's own sleep(700) + res.json() call is still pending at
      // this point; give it time to run (and no-op) before proving the
      // server is still alive.
      await new Promise((r) => setTimeout(r, 800))
      const after = await request('/api/echo')
      expect(after.status).toBe(200)
    }, 10_000)

    it('a waitUntil job scheduled before the deadline still completes after the 504', async () => {
      const res = await request('/api/slow-waituntil?id=deadline1&ms=400')
      expect(res.status).toBe(504)

      let state: string | null = null
      for (let i = 0; i < 60 && state !== 'done'; i++) {
        await new Promise((r) => setTimeout(r, 50))
        const poll = await request('/api/bg-status?id=deadline1')
        state = (await poll.json()).state
      }
      expect(state).toBe('done')
    }, 10_000)
  })

  // Round-6 operator review, item C: once the deadline has fired (and sent
  // its own 504), a slow handler's later writes must be safe no-ops (never
  // a crash), and header-mutating calls specifically must not throw
  // Node's ERR_HTTP_HEADERS_SENT — this is distinct from the write-after-end
  // guard above, which only covered res.write/res.end.
  describe('response-write guard after the deadline (round-6 operator review, item C)', () => {
    it('a late res.status().json() after the 504 is a safe no-op, and the handler keeps running past it', async () => {
      const res = await request('/api/slow-late-write?id=latewrite1')
      expect(res.status).toBe(504)
      expect(await res.json()).toEqual({ error: 'Gateway Timeout' })

      let state: string | null = null
      for (let i = 0; i < 40 && state !== 'post-write-ran'; i++) {
        await new Promise((r) => setTimeout(r, 50))
        const poll = await request('/api/bg-status?id=latewrite1')
        state = (await poll.json()).state
      }
      expect(state).toBe('post-write-ran')

      const after = await request('/api/echo')
      expect(after.status).toBe(200)
    }, 10_000)
  })

  // Round-6 operator review, item C: the per-request AbortSignal
  // (api/lib/request-deadline.ts's getDeadlineSignal) is aborted only when
  // the deadline fires, never on a normal fast response.
  describe('deadline abort signal (round-6 operator review, item C)', () => {
    it('a slow handler sees signal.aborted and skips its charge', async () => {
      const res = await request('/api/slow-abort-signal?id=abortsig1&ms=300')
      expect(res.status).toBe(504)

      let state: string | null = null
      for (let i = 0; i < 40 && state !== 'charge-skipped'; i++) {
        await new Promise((r) => setTimeout(r, 50))
        const poll = await request('/api/bg-status?id=abortsig1')
        state = (await poll.json()).state
      }
      expect(state).toBe('charge-skipped')
    }, 10_000)

    it('a fast request never has its signal aborted, and the charge marker is set', async () => {
      const res = await request('/api/slow-abort-signal?id=abortsig2&ms=10')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ charged: true })
      const poll = await request('/api/bg-status?id=abortsig2')
      expect((await poll.json()).state).toBe('charged')
    })
  })

  describe('rewrites', () => {
    it.each([
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
    ])('rewrites %s to the mcp-oauth-metadata handler', async (path) => {
      const res = await request(path)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ fixture: 'mcp-oauth-metadata' })
    })

    it('falls back to the SPA for unmatched well-known paths', async () => {
      const res = await request('/.well-known/oauth-protected-resource/other')
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('fixture-spa')
    })
  })

  describe('SPA and static files', () => {
    it.each(['/', '/index.html', '/chat/abc'])('%s serves the SPA shell', async (path) => {
      const res = await request(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('fixture-spa')
      expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    })

    it('/api (no slash) falls back to the SPA', async () => {
      const res = await request('/api')
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('fixture-spa')
    })

    it('serves a static asset', async () => {
      const res = await request('/assets/app.js')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
      expect(await res.text()).toBe("console.log('fixture-app')")
    })

    it('404s for a missing asset instead of falling back to the SPA', async () => {
      const res = await request('/assets/missing.js')
      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).not.toMatch(/^text\/html/)
      expect(await res.text()).not.toContain('fixture-spa')
    })

    it('HEAD / gives an empty body', async () => {
      const res = await request('/', { method: 'HEAD' })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('')
    })

    it('POST /chat gives 405', async () => {
      const res = await request('/chat', { method: 'POST' })
      expect(res.status).toBe(405)
    })
  })

  describe('headers', () => {
    const expected: Array<[string, string]> = [
      ['x-content-type-options', 'nosniff'],
      ['x-frame-options', 'DENY'],
      ['x-xss-protection', '1; mode=block'],
      ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
      ['referrer-policy', 'strict-origin-when-cross-origin'],
      ['permissions-policy', 'camera=(), microphone=(self), geolocation=()'],
    ]

    it.each(['/api/echo', '/', '/assets/app.js', '/api/does-not-exist'])(
      'sets every security header on %s',
      async (path) => {
        const res = await request(path)
        for (const [name, value] of expected) {
          expect(res.headers.get(name)).toBe(value)
        }
        expect(res.headers.get('content-security-policy')).toBe(CF_CONTENT_SECURITY_POLICY)
      }
    )

    it('/api/echo has no cache-control', async () => {
      const res = await request('/api/echo')
      expect(res.headers.get('cache-control')).toBeNull()
    })
  })

  describe('health', () => {
    it('never touches handlers', async () => {
      const res = await request('/api/health')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        ok: true,
        service: 'advance-ai-api',
        appEnv: 'test',
        pendingBackground: expect.any(Number),
        uptimeSec: expect.any(Number),
      })
    })
  })

  describe('waitUntil', () => {
    it('tracks background work until it settles', async () => {
      const start = await request('/api/bg-start?id=t1&ms=400')
      expect(start.status).toBe(202)
      expect(await start.json()).toEqual({ id: 't1', state: 'pending' })

      const status = await request('/api/bg-status?id=t1')
      expect((await status.json()).state).toBe('pending')

      const health = await request('/api/health')
      expect((await health.json()).pendingBackground).toBeGreaterThanOrEqual(1)

      let state: string | null = null
      for (let i = 0; i < 60 && state !== 'done'; i++) {
        await new Promise((r) => setTimeout(r, 50))
        const poll = await request('/api/bg-status?id=t1')
        state = (await poll.json()).state
      }
      expect(state).toBe('done')
    }, 10_000)
  })

  describe('errors', () => {
    it('thrown handler errors give 500, and the server keeps running', async () => {
      const res = await request('/api/throws')
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Internal Server Error' })

      const after = await request('/api/echo')
      expect(after.status).toBe(200)
    })

    it('a floating rejection and a failed waitUntil are logged, not fatal', async () => {
      const res = await request('/api/rejects-later')
      expect(res.status).toBe(200)

      await new Promise((r) => setTimeout(r, 200))

      const after = await request('/api/echo')
      expect(after.status).toBe(200)
      expect(adapter.output()).toContain('[server] unhandledRejection')
      expect(adapter.output()).toContain('[server] waitUntil rejected')
    })
  })

  // Round-6 operator review, item H.
  describe('pre-auth gate on large bodies', () => {
    it('a large body (>4.5 MiB) to an elevated-limit route with no Authorization header gets 401 before reaching the handler', async () => {
      const res = await request('/api/limit-10mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(9 * 1024 * 1024),
      })
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Missing authorization' })
    }, 20_000)

    it('the same large body WITH a Bearer header reaches the handler normally', async () => {
      const res = await request('/api/limit-10mb', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          authorization: 'Bearer test-token',
        },
        body: new Uint8Array(9 * 1024 * 1024),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyType: 'buffer', length: 9 * 1024 * 1024 })
    }, 20_000)

    it('a small body (<4.5 MiB) with no Authorization header still reaches the handler as today', async () => {
      const res = await request('/api/limit-10mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(1024),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyType: 'buffer', length: 1024 })
    })

    it('a raw-stream (bodyParser:false) large body with no Authorization header gets 401', async () => {
      const res = await request('/api/raw-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: randomBytes(9 * 1024 * 1024),
      })
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Missing authorization' })
    }, 20_000)
  })

  // Round-6 operator review, item H.
  describe('trailing-slash normalization before the deadline-manifest lookup', () => {
    it('/api/slow-no-module-deadline/ (trailing slash) gets the manifest-configured deadline, not the 300s default', async () => {
      const manifestAdapter = await startAdapter({
        apiDir: resolve(new URL('./fixtures/cf-api-deadline-manifest', import.meta.url).pathname),
        staticDir: STATIC_DIR,
      })
      try {
        const start = Date.now()
        const res = await fetch(`${manifestAdapter.baseUrl}/api/slow-no-module-deadline/?ms=600`)
        expect(res.status).toBe(504)
        // Well under the 300s default — proves the 0.2s manifest entry for
        // '/api/slow-no-module-deadline' (no trailing slash) was matched
        // despite the request path having one.
        expect(Date.now() - start).toBeLessThan(5000)
      } finally {
        await manifestAdapter.stop()
      }
    }, 10_000)

    it('the same route without a trailing slash still gets the manifest deadline (sanity check)', async () => {
      const manifestAdapter = await startAdapter({
        apiDir: resolve(new URL('./fixtures/cf-api-deadline-manifest', import.meta.url).pathname),
        staticDir: STATIC_DIR,
      })
      try {
        const res = await fetch(`${manifestAdapter.baseUrl}/api/slow-no-module-deadline?ms=600`)
        expect(res.status).toBe(504)
      } finally {
        await manifestAdapter.stop()
      }
    }, 10_000)
  })

  // Round-6 operator review, item H: global in-flight body-bytes semaphore.
  //
  // Operator-found flake (round 7): the original version of the main test
  // here sent two independent fetch() uploads via Promise.all and hoped
  // they'd overlap in time. On localhost that's not guaranteed — fetch()
  // can fully receive and release the first upload's reservation before
  // the second request's headers even arrive at the server, so the test
  // sometimes saw [200, 200] instead of [200, 503]. Fixed by making the
  // overlap explicit instead of hoped-for: request A is opened with a
  // known Content-Length (reserving its full declared size immediately,
  // before any body bytes are even sent) and then deliberately held open
  // — only a small partial chunk is written, never `.end()` — so its
  // reservation stays held for as long as the test needs, with no race
  // against A's own completion. Only once B's rejection is observed do we
  // finish A's body and let it complete.
  describe('in-flight body-bytes semaphore', () => {
    it('a concurrent upload sent while another is held open gets 503, the budget fully releases afterward, and a follow-up succeeds', async () => {
      const semaphoreAdapter = await startAdapter({
        apiDir: API_DIR,
        staticDir: STATIC_DIR,
        env: { MAX_INFLIGHT_BODY_BYTES: String(2 * 1024 * 1024) },
      })
      try {
        const url = new URL(semaphoreAdapter.baseUrl)
        const fullBody = 1.5 * 1024 * 1024

        const reqA = http.request({
          host: url.hostname,
          port: url.port,
          path: '/api/limit-default',
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', 'content-length': fullBody },
        })
        const statusAPromise = new Promise<number>((resolvePromise, rejectPromise) => {
          reqA.on('response', (res) => {
            res.on('data', () => {})
            res.on('end', () => resolvePromise(res.statusCode ?? 0))
          })
          reqA.on('error', rejectPromise)
        })
        // Only part of the declared 1.5 MiB is actually sent — A's
        // upfront reservation (made the instant its headers/Content-Length
        // are parsed, independent of how much body has arrived) stays
        // held deterministically until this test calls reqA.end() below.
        await new Promise<void>((resolvePromise, rejectPromise) => {
          reqA.write(Buffer.alloc(64 * 1024), (err) => (err ? rejectPromise(err) : resolvePromise()))
        })
        // Safety margin, not a correctness requirement: gives the server
        // a moment to have processed A's headers. A's connection stays
        // open (body intentionally unfinished) regardless of how long
        // that actually takes, so this can't itself cause a false pass —
        // only an unnecessarily slow one.
        await new Promise((r) => setTimeout(r, 150))

        // A's reservation (1.5 MiB) + B's attempted reservation (1.5 MiB)
        // exceed the 2 MiB cap, so B must be rejected before it's allowed
        // to send its body.
        const b = await fetch(`${semaphoreAdapter.baseUrl}/api/limit-default`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: new Uint8Array(fullBody),
        })
        expect(b.status).toBe(503)
        expect(await b.json()).toEqual({ error: 'Server busy' })

        // Finish A's body now — its reservation releases on 'end'.
        reqA.end(Buffer.alloc(fullBody - 64 * 1024))
        expect(await statusAPromise).toBe(200)

        // The budget must be fully released now — A's (just finished) and
        // B's (which should never have been added in the first place,
        // since the reservation attempt itself failed).
        const followUp = await fetch(`${semaphoreAdapter.baseUrl}/api/limit-default`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: new Uint8Array(fullBody),
        })
        expect(followUp.status).toBe(200)
      } finally {
        await semaphoreAdapter.stop()
      }
    }, 20_000)

    it('the same thing with a CHUNKED body held open (no Content-Length known upfront)', async () => {
      const semaphoreAdapter = await startAdapter({
        apiDir: API_DIR,
        staticDir: STATIC_DIR,
        env: { MAX_INFLIGHT_BODY_BYTES: String(2 * 1024 * 1024) },
      })
      try {
        const url = new URL(semaphoreAdapter.baseUrl)

        const reqA = http.request({
          host: url.hostname,
          port: url.port,
          path: '/api/limit-default',
          method: 'POST',
          // No content-length -> Node sends this chunked. A's reservation
          // here grows incrementally per chunk as the server reads it
          // (not upfront), so enough has to actually arrive before B is
          // sent.
          headers: { 'content-type': 'application/octet-stream' },
        })
        const statusAPromise = new Promise<number>((resolvePromise, rejectPromise) => {
          reqA.on('response', (res) => {
            res.on('data', () => {})
            res.on('end', () => resolvePromise(res.statusCode ?? 0))
          })
          reqA.on('error', rejectPromise)
        })
        // 1.6 MiB written (never ended) leaves less than 0.5 MiB of room
        // under the 2 MiB cap — not enough for B's 1.5 MiB attempt.
        await new Promise<void>((resolvePromise, rejectPromise) => {
          reqA.write(Buffer.alloc(1.6 * 1024 * 1024), (err) => (err ? rejectPromise(err) : resolvePromise()))
        })
        await new Promise((r) => setTimeout(r, 150))

        const b = await fetch(`${semaphoreAdapter.baseUrl}/api/limit-default`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: new Uint8Array(1.5 * 1024 * 1024),
        })
        expect(b.status).toBe(503)
        expect(await b.json()).toEqual({ error: 'Server busy' })

        reqA.end()
        expect(await statusAPromise).toBe(200)
      } finally {
        await semaphoreAdapter.stop()
      }
    }, 20_000)

    it('an aborted client upload releases its reservation too', async () => {
      const semaphoreAdapter = await startAdapter({
        apiDir: API_DIR,
        staticDir: STATIC_DIR,
        env: { MAX_INFLIGHT_BODY_BYTES: String(2 * 1024 * 1024) },
      })
      try {
        const url = new URL(semaphoreAdapter.baseUrl)
        const declaredLength = 1.5 * 1024 * 1024

        await new Promise<void>((resolvePromise) => {
          const req = http.request({
            host: url.hostname,
            port: url.port,
            path: '/api/limit-default',
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', 'content-length': declaredLength },
          })
          req.on('error', () => resolvePromise())
          req.write(Buffer.alloc(500_000))
          // Abruptly close the connection instead of finishing the body —
          // the server must still release its reservation via the 'close'
          // safety net, not wait for 'end' (which will never come).
          setTimeout(() => {
            req.destroy()
            resolvePromise()
          }, 50)
        })

        // Give the server a moment to observe the closed connection.
        await new Promise((r) => setTimeout(r, 200))

        const followUp = await fetch(`${semaphoreAdapter.baseUrl}/api/limit-default`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: new Uint8Array(1.5 * 1024 * 1024),
        })
        expect(followUp.status).toBe(200)
      } finally {
        await semaphoreAdapter.stop()
      }
    }, 20_000)
  })
})
