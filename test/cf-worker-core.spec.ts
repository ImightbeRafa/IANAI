import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CRON_PATHS, handleFetch, handleScheduled, type WorkerEnv } from '../cf/worker-core'
import { CONTAINER_ENV_KEYS, getContainerEnvVars } from '../cf/container-env.mjs'
import { cronsEnabled } from '../api/lib/crons-enabled'
import { parseJsonc, scanProcessEnvNames } from '../scripts/parity/lib.mjs'
import { VERCEL_ENV_NAMES } from '../scripts/parity/vercel-env-names.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function makeFakeContainer(impl?: (req: Request) => Promise<Response>) {
  return vi.fn(
    impl ??
      (async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
  )
}

// Round-6 operator review, item E: the full truth table, including the
// near-misses a naive `!== '1'` comparison would get wrong in the OPPOSITE
// direction (' 1 ' and '1\n' trim down to '1', so a non-trimming comparison
// would wrongly treat them as disabled when cronsEnabled correctly enables
// them — this is why api/mcp-guide-analysis.ts now calls this same function
// instead of its own comparison; see test/mcp-guide-analysis-auth.spec.ts
// for the handler-side half of this truth table).
const CRONS_ENABLED_TRUTH_TABLE: Array<[string, string | undefined, boolean]> = [
  ['unset', undefined, false],
  ['empty string', '', false],
  ["'0'", '0', false],
  ["'1'", '1', true],
  ["' 1 ' (trims to '1')", ' 1 ', true],
  ["'1\\n' (trims to '1')", '1\n', true],
  ["'true'", 'true', false],
  ["'TRUE'", 'TRUE', false],
  ["'yes'", 'yes', false],
  ["'01'", '01', false],
  ["'1.0'", '1.0', false],
]

describe('cronsEnabled (fail closed)', () => {
  it.each(CRONS_ENABLED_TRUTH_TABLE)('%s -> %s', (_label, value, expected) => {
    expect(cronsEnabled({ ENABLE_CRONS: value })).toBe(expected)
  })

  it('APP_ENV=preview does not change any result in the truth table', () => {
    for (const [, value, expected] of CRONS_ENABLED_TRUTH_TABLE) {
      expect(cronsEnabled({ APP_ENV: 'preview', ENABLE_CRONS: value })).toBe(expected)
    }
  })
})

describe('handleScheduled', () => {
  const env = (extra: Record<string, unknown> = {}): WorkerEnv =>
    ({ ASSETS: { fetch: vi.fn() }, ...extra }) as WorkerEnv

  // Gate truth table: every value here must be a no-op (0 container calls).
  // Only a value cronsEnabled() treats as true may ever reach the
  // container. This is the fail-closed guarantee SD-01 requires — a
  // truthy-but-wrong string like 'true' must never enable the preview
  // cron. Uses the SAME CRONS_ENABLED_TRUTH_TABLE as the pure-function
  // tests above (round-6 operator review, item E: "run through BOTH call
  // sites") — see test/mcp-guide-analysis-auth.spec.ts for the handler
  // gate's half of this same table.
  it.each(CRONS_ENABLED_TRUTH_TABLE.filter(([, , expected]) => !expected))(
    'is a no-op when ENABLE_CRONS is %s',
    async (_label, value) => {
      const fakeContainer = makeFakeContainer()
      const result = await handleScheduled(
        { cron: '* * * * *' },
        env({ ENABLE_CRONS: value, CRON_SECRET: 'x' }),
        fakeContainer
      )
      expect(fakeContainer).toHaveBeenCalledTimes(0)
      expect(result).toEqual({ skipped: true })
    }
  )

  it.each(CRONS_ENABLED_TRUTH_TABLE.filter(([, , expected]) => expected))(
    'calls the container exactly once when ENABLE_CRONS is %s',
    async (_label, value) => {
      const fakeContainer = makeFakeContainer()
      const result = await handleScheduled(
        { cron: '* * * * *' },
        env({ ENABLE_CRONS: value, CRON_SECRET: 'test-cron-secret' }),
        fakeContainer
      )
      expect(fakeContainer).toHaveBeenCalledTimes(1)
      expect(result.skipped).toBe(false)
    }
  )

  it.each([
    ['unset', undefined],
    ["'0'", '0'],
    ["'true'", 'true'],
  ])('stays a no-op with ENABLE_CRONS=%s even when APP_ENV=preview', async (_label, value) => {
    const fakeContainer = makeFakeContainer()
    const result = await handleScheduled(
      { cron: '* * * * *' },
      env({ APP_ENV: 'preview', ENABLE_CRONS: value, CRON_SECRET: 'x' }),
      fakeContainer
    )
    expect(fakeContainer).toHaveBeenCalledTimes(0)
    expect(result).toEqual({ skipped: true })
  })

  it('calls the container exactly once when ENABLE_CRONS is exactly "1"', async () => {
    const fakeContainer = makeFakeContainer()
    await handleScheduled(
      { cron: '* * * * *' },
      env({ ENABLE_CRONS: '1', CRON_SECRET: 'test-cron-secret' }),
      fakeContainer
    )
    expect(fakeContainer).toHaveBeenCalledTimes(1)
    const req = fakeContainer.mock.calls[0][0] as Request
    expect(req.url).toBe('http://container/api/mcp-guide-analysis')
    expect(req.method).toBe('GET')
    expect(req.headers.get('authorization')).toBe('Bearer test-cron-secret')
  })

  it('skips unknown cron expressions even with ENABLE_CRONS=1', async () => {
    const fakeContainer = makeFakeContainer()
    const result = await handleScheduled(
      { cron: '*/5 * * * *' },
      env({ ENABLE_CRONS: '1', CRON_SECRET: 'x' }),
      fakeContainer
    )
    expect(fakeContainer).toHaveBeenCalledTimes(0)
    expect(result).toEqual({ skipped: true })
  })

  it('rejects when ENABLE_CRONS=1 but CRON_SECRET is unset, and makes 0 calls', async () => {
    const fakeContainer = makeFakeContainer()
    await expect(
      handleScheduled({ cron: '* * * * *' }, env({ ENABLE_CRONS: '1' }), fakeContainer)
    ).rejects.toThrow(/CRON_SECRET not configured/)
    expect(fakeContainer).toHaveBeenCalledTimes(0)
  })

  it('rejects when the container responds with a non-2xx status', async () => {
    const fakeContainer = makeFakeContainer(async () => new Response('nope', { status: 401 }))
    await expect(
      handleScheduled({ cron: '* * * * *' }, env({ ENABLE_CRONS: '1', CRON_SECRET: 'x' }), fakeContainer)
    ).rejects.toThrow(/failed with status 401/)
  })
})

// None of the tests in this describe block are about the Access gate
// (that's test/cf-access-jwt.spec.ts's job, including the round-6 "enforce
// unless production" selector) — they're about routing/headers/IP
// forwarding, so every env here sets APP_ENV: 'production' to stay
// unaffected by the gate and keep testing exactly one thing at a time.
describe('handleFetch', () => {
  it('routes /api/* to the container and applies security headers', async () => {
    const fakeContainer = makeFakeContainer()
    const env: WorkerEnv = { ASSETS: { fetch: vi.fn() }, APP_ENV: 'production' }
    const res = await handleFetch(new Request('http://worker.test/api/chat'), env, fakeContainer)
    expect(fakeContainer).toHaveBeenCalledTimes(1)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
  })

  it('routes /api/ad-pack (any method, with query) to the container, never ASSETS', async () => {
    const fakeContainer = makeFakeContainer()
    const assetsFetch = vi.fn()
    const env: WorkerEnv = { ASSETS: { fetch: assetsFetch }, APP_ENV: 'production' }
    for (const method of ['OPTIONS', 'GET', 'POST']) {
      const res = await handleFetch(
        new Request('http://worker.test/api/ad-pack?packId=abc', {
          method,
          body: method === 'POST' ? '{"action":"start"}' : undefined,
        }),
        env,
        fakeContainer
      )
      expect(res.status).toBe(200)
    }
    expect(fakeContainer).toHaveBeenCalledTimes(3)
    expect(assetsFetch).toHaveBeenCalledTimes(0)
    const forwarded = fakeContainer.mock.calls[2][0] as Request
    expect(new URL(forwarded.url).pathname).toBe('/api/ad-pack')
    expect(new URL(forwarded.url).search).toBe('?packId=abc')
    expect(forwarded.method).toBe('POST')
    expect(await forwarded.text()).toBe('{"action":"start"}')
  })

  it('preserves a header the container already set', async () => {
    const fakeContainer = makeFakeContainer(
      async () =>
        new Response('ok', { status: 200, headers: { 'X-Frame-Options': 'SAMEORIGIN' } })
    )
    const env: WorkerEnv = { ASSETS: { fetch: vi.fn() }, APP_ENV: 'production' }
    const res = await handleFetch(new Request('http://worker.test/api/chat'), env, fakeContainer)
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it('routes both oauth-protected-resource paths to the container', async () => {
    const fakeContainer = makeFakeContainer()
    const env: WorkerEnv = { ASSETS: { fetch: vi.fn() }, APP_ENV: 'production' }
    await handleFetch(new Request('http://worker.test/.well-known/oauth-protected-resource'), env, fakeContainer)
    await handleFetch(
      new Request('http://worker.test/.well-known/oauth-protected-resource/api/mcp'),
      env,
      fakeContainer
    )
    expect(fakeContainer).toHaveBeenCalledTimes(2)
  })

  it('routes everything else to ASSETS and never calls the container', async () => {
    const fakeContainer = makeFakeContainer()
    const assetsFetch = vi.fn(
      async () => new Response('<html>spa</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    )
    const env: WorkerEnv = { ASSETS: { fetch: assetsFetch }, APP_ENV: 'production' }
    const res = await handleFetch(new Request('http://worker.test/chat/abc'), env, fakeContainer)
    expect(fakeContainer).toHaveBeenCalledTimes(0)
    expect(assetsFetch).toHaveBeenCalledTimes(1)
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('404s for a missing asset instead of the SPA html fallback', async () => {
    const fakeContainer = makeFakeContainer()
    const assetsFetch = vi.fn(
      async () => new Response('<html>spa</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    )
    const env: WorkerEnv = { ASSETS: { fetch: assetsFetch }, APP_ENV: 'production' }
    const res = await handleFetch(new Request('http://worker.test/assets/missing.js'), env, fakeContainer)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })

  it('passes through a real asset unchanged', async () => {
    const fakeContainer = makeFakeContainer()
    const assetsFetch = vi.fn(
      async () =>
        new Response("console.log('x')", { status: 200, headers: { 'content-type': 'text/javascript' } })
    )
    const env: WorkerEnv = { ASSETS: { fetch: assetsFetch }, APP_ENV: 'production' }
    const res = await handleFetch(new Request('http://worker.test/assets/app.js'), env, fakeContainer)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("console.log('x')")
  })

  it('gives 503 when the container throws', async () => {
    const fakeContainer = vi.fn(async () => {
      throw new Error('boom')
    })
    const env: WorkerEnv = { ASSETS: { fetch: vi.fn() }, APP_ENV: 'production' }
    const res = await handleFetch(new Request('http://worker.test/api/chat'), env, fakeContainer)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Container unavailable' })
  })

  describe('client IP headers forwarded to the container (SD-09)', () => {
    it('replaces a spoofed X-Forwarded-For / X-Real-IP with CF-Connecting-IP', async () => {
      const fakeContainer = makeFakeContainer()
      const env: WorkerEnv = { ASSETS: { fetch: vi.fn() }, APP_ENV: 'production' }
      const inbound = new Request('http://worker.test/api/chat', {
        headers: {
          'X-Forwarded-For': '6.6.6.6',
          'X-Real-IP': '6.6.6.6',
          'CF-Connecting-IP': '1.2.3.4',
        },
      })
      await handleFetch(inbound, env, fakeContainer)
      expect(fakeContainer).toHaveBeenCalledTimes(1)
      const forwarded = fakeContainer.mock.calls[0][0] as Request
      expect(forwarded.headers.get('X-Forwarded-For')).toBe('1.2.3.4')
      expect(forwarded.headers.get('X-Real-IP')).toBe('1.2.3.4')
      // The incoming Request object itself is never mutated.
      expect(inbound.headers.get('X-Forwarded-For')).toBe('6.6.6.6')
    })

    it('removes both headers entirely when CF-Connecting-IP is absent', async () => {
      const fakeContainer = makeFakeContainer()
      const env: WorkerEnv = { ASSETS: { fetch: vi.fn() }, APP_ENV: 'production' }
      const inbound = new Request('http://worker.test/api/chat', {
        headers: { 'X-Forwarded-For': '6.6.6.6', 'X-Real-IP': '6.6.6.6' },
      })
      await handleFetch(inbound, env, fakeContainer)
      const forwarded = fakeContainer.mock.calls[0][0] as Request
      expect(forwarded.headers.has('X-Forwarded-For')).toBe(false)
      expect(forwarded.headers.has('X-Real-IP')).toBe(false)
    })
  })
})

describe('getContainerEnvVars', () => {
  it('keeps only known string keys', () => {
    const result = getContainerEnvVars({
      GROK_API_KEY: 'g',
      FOO: 'x',
      ASSETS: {},
      CRON_SECRET: 'c',
      ENABLE_CRONS: '1',
      APP_ENV: 'preview',
      VERCEL_ENV: 'preview',
    })
    expect(result).toEqual({
      GROK_API_KEY: 'g',
      CRON_SECRET: 'c',
      ENABLE_CRONS: '1',
      APP_ENV: 'preview',
    })
  })

  // Round-6 operator review, item F: even if a Worker env somehow carried
  // ADVANCE_RUNTIME (it never should — wrangler.jsonc doesn't set it), the
  // Worker must never forward it to the container.
  it('drops ADVANCE_RUNTIME even if the Worker env has it', () => {
    const result = getContainerEnvVars({ ADVANCE_RUNTIME: 'cloudflare-container', APP_ENV: 'preview' })
    expect(result).toEqual({ APP_ENV: 'preview' })
  })
})

describe('env key coverage', () => {
  it('every Vercel name is in CONTAINER_ENV_KEYS', () => {
    for (const name of VERCEL_ENV_NAMES) {
      expect(CONTAINER_ENV_KEYS).toContain(name)
    }
  })

  // VERCEL_ENV and ADVANCE_RUNTIME are both read in api/ but deliberately
  // excluded from CONTAINER_ENV_KEYS — see the CONTAINER_ENV_KEYS header
  // comment in cf/container-env.mjs for why each is a documented exception
  // rather than an oversight.
  it('every process.env.X name read in api/ (other than VERCEL_ENV/ADVANCE_RUNTIME) is in CONTAINER_ENV_KEYS', () => {
    const names = scanProcessEnvNames(resolve(ROOT, 'api'))
    for (const name of names) {
      if (name === 'VERCEL_ENV' || name === 'ADVANCE_RUNTIME') continue
      expect(CONTAINER_ENV_KEYS).toContain(name)
    }
  })

  it('includes APP_ENV and ENABLE_CRONS, excludes VERCEL_ENV and DISABLE_CRONS', () => {
    expect(CONTAINER_ENV_KEYS).toContain('APP_ENV')
    expect(CONTAINER_ENV_KEYS).toContain('ENABLE_CRONS')
    expect(CONTAINER_ENV_KEYS).not.toContain('VERCEL_ENV')
    expect(CONTAINER_ENV_KEYS).not.toContain('DISABLE_CRONS')
  })

  // Round-6 operator review, item F: ADVANCE_RUNTIME must never be
  // forwarded by the Worker — server.mjs stamps it itself, unconditionally,
  // so no Worker var could spoof the handler's fail-closed 503 gate off.
  it('excludes ADVANCE_RUNTIME even though api/mcp-guide-analysis.ts reads it', () => {
    expect(CONTAINER_ENV_KEYS).not.toContain('ADVANCE_RUNTIME')
  })
})

describe('wrangler.jsonc', () => {
  const wrangler = parseJsonc(readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8')) as any

  it('top level', () => {
    expect(wrangler.workers_dev).toBe(false)
    expect(wrangler.preview_urls).toBe(false)
    expect(wrangler.vars).toEqual({ APP_ENV: 'production' })
  })

  it('env.preview', () => {
    expect(wrangler.env.preview.name).toBe('advance-ai-preview')
    expect(wrangler.env.preview.workers_dev).toBe(false)
    expect(wrangler.env.preview.preview_urls).toBe(false)
    expect(wrangler.env.preview.vars.APP_ENV).toBe('preview')
  })

  it('no env sets ENABLE_CRONS or DISABLE_CRONS in vars — fail closed until cutover', () => {
    expect(wrangler.vars.ENABLE_CRONS).toBeUndefined()
    expect(wrangler.vars.DISABLE_CRONS).toBeUndefined()
    expect(wrangler.env.preview.vars.ENABLE_CRONS).toBeUndefined()
    expect(wrangler.env.preview.vars.DISABLE_CRONS).toBeUndefined()
  })

  it('env.preview.triggers.crons is explicitly empty (top-level stays live for prod)', () => {
    expect(wrangler.env.preview.triggers.crons).toEqual([])
    expect(wrangler.triggers.crons).toEqual(['* * * * *'])
  })

  it('env.preview has ACCESS_TEAM_DOMAIN/ACCESS_AUD placeholders, not forwarded to the container', () => {
    expect(wrangler.env.preview.vars.ACCESS_TEAM_DOMAIN).toContain('REPLACE')
    expect(wrangler.env.preview.vars.ACCESS_AUD).toContain('REPLACE')
    expect(CONTAINER_ENV_KEYS).not.toContain('ACCESS_TEAM_DOMAIN')
    expect(CONTAINER_ENV_KEYS).not.toContain('ACCESS_AUD')
    expect(wrangler.vars.ACCESS_TEAM_DOMAIN).toBeUndefined()
    expect(wrangler.vars.ACCESS_AUD).toBeUndefined()
  })

  it.each([
    ['top level', wrangler],
    ['preview', wrangler.env.preview],
  ])('%s shares the same containers/assets/migrations shape', (_label, scope: any) => {
    expect(scope.containers[0].class_name).toBe('AdvanceAiContainer')
    expect(scope.durable_objects.bindings[0].name).toBe('ADVANCE_AI_CONTAINER')
    expect(scope.migrations[0].new_sqlite_classes).toEqual(['AdvanceAiContainer'])
    expect(scope.assets.run_worker_first).toBe(true)
    expect(scope.assets.not_found_handling).toBe('single-page-application')
  })

  it('every top-level cron is a key of CRON_PATHS', () => {
    for (const cron of wrangler.triggers.crons) {
      expect(Object.keys(CRON_PATHS)).toContain(cron)
    }
  })

  it('every vercel.json cron (schedule + path) is covered by a top-level wrangler cron via CRON_PATHS', () => {
    const vercel = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>
    }
    for (const { path, schedule } of vercel.crons ?? []) {
      expect(wrangler.triggers.crons).toContain(schedule)
      expect(CRON_PATHS[schedule]).toContain(path)
    }
  })
})
