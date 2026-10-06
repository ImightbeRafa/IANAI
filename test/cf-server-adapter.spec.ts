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

    it('limit-10mb', async () => {
      const ok = await request('/api/limit-10mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(10_485_760),
      })
      expect(ok.status).toBe(200)

      const tooBig = await request('/api/limit-10mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(10_485_761),
      })
      expect(tooBig.status).toBe(413)
    })

    it('limit-25mb', async () => {
      const ok = await request('/api/limit-25mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(26_214_400),
      })
      expect(ok.status).toBe(200)

      const tooBig = await request('/api/limit-25mb', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(26_214_401),
      })
      expect(tooBig.status).toBe(413)
    }, 20_000)
  })

  describe('raw stream', () => {
    it('bypasses the limit entirely when bodyParser is false', async () => {
      const bytes = randomBytes(5_242_880)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const res = await request('/api/raw-stream', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: bytes,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ bodyIsUndefined: true, length: 5_242_880, sha256 })
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
})
