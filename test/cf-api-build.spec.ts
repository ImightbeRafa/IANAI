import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startAdapter } from './helpers/cf-server'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DIST_API = resolve(ROOT, 'dist-api')

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-api.mjs'], { cwd: ROOT, stdio: 'pipe' })
}, 120_000)

describe('build-api.mjs', () => {
  it('compiles the expected files', () => {
    expect(existsSync(resolve(DIST_API, 'mcp-oauth-metadata.js'))).toBe(true)
    expect(existsSync(resolve(DIST_API, 'parse-pdf.js'))).toBe(true)
    expect(existsSync(resolve(DIST_API, 'tilopay/webhook.js'))).toBe(true)
    expect(existsSync(resolve(DIST_API, 'lib/auth.js'))).toBe(true)
    expect(existsSync(resolve(DIST_API, 'data/image-presets.js'))).toBe(true)
  })

  it('does not emit api/types', () => {
    expect(existsSync(resolve(DIST_API, 'types'))).toBe(false)
  })

  it('emits a route-deadline manifest matching vercel.json maxDuration for real routes', () => {
    const manifestPath = resolve(DIST_API, '_route-deadlines.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    // From vercel.json's functions[...].maxDuration directly.
    expect(manifest['/api/chat']).toBe(120)
    expect(manifest['/api/bulk-posts']).toBe(300)
    expect(manifest['/api/generate-image']).toBe(180)
    expect(manifest['/api/analyze-site']).toBe(60)
    // api/mcp-guide-analysis.ts also exports `maxDuration = 60` itself —
    // module export and vercel.json agree here, either source gives 60.
    expect(manifest['/api/mcp-guide-analysis']).toBe(60)
    // Not in vercel.json's functions block at all -> the 300s default.
    expect(manifest['/api/admin-billing']).toBe(300)
    for (const value of Object.values(manifest)) {
      expect(typeof value).toBe('number')
    }
  })

  it('the route-deadline manifest is not routable through the real server', async () => {
    const adapter = await startAdapter({
      apiDir: DIST_API,
      staticDir: resolve(ROOT, 'test/fixtures/cf-static-missing'),
    })
    try {
      const res = await fetch(`${adapter.baseUrl}/api/_route-deadlines`)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Not found' })
    } finally {
      await adapter.stop()
    }
  })

  it('parse-pdf.js has a raw-stream config and a default export', () => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import * as m from './dist-api/parse-pdf.js'; console.log(JSON.stringify(m.config)); console.log(typeof m.default)",
      ],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8' }
    )
    const [configLine, typeLine] = output.trim().split('\n')
    expect(configLine).toBe('{"api":{"bodyParser":false}}')
    expect(typeLine).toBe('function')
  })

  it('extract-pdf.js has a 10mb sizeLimit and a default export', () => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import * as m from './dist-api/extract-pdf.js'; console.log(JSON.stringify(m.config)); console.log(typeof m.default)",
      ],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8' }
    )
    const [configLine, typeLine] = output.trim().split('\n')
    expect(configLine).toBe('{"api":{"bodyParser":{"sizeLimit":"10mb"}}}')
    expect(typeLine).toBe('function')
  })
})

describe('build-api end to end (real handlers, no DB)', () => {
  let adapter: Awaited<ReturnType<typeof startAdapter>>

  afterEach(async () => {
    await adapter?.stop()
  })

  it('serves mcp-oauth-metadata with no DB', async () => {
    adapter = await startAdapter({
      apiDir: DIST_API,
      staticDir: resolve(ROOT, 'test/fixtures/cf-static-missing'),
      env: {
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        CRON_SECRET: 'test-cron',
      },
    })

    const metadata = await fetch(`${adapter.baseUrl}/.well-known/oauth-protected-resource`)
    expect(metadata.status).toBe(200)
    const metadataBody = await metadata.json()
    expect(metadataBody.resource).toBe('https://advanceai.studio/api/mcp')
    expect(metadataBody.authorization_servers).toEqual(['https://example.supabase.co/auth/v1'])
    expect(metadata.headers.get('cache-control')).toBe('public, max-age=300')
  }, 20_000)

  // server.mjs sets ADVANCE_RUNTIME=cloudflare-container whenever it's run
  // directly (which is exactly what startAdapter does), so hitting the real
  // compiled handler through the real adapter exercises SD-01's fail-closed
  // gate for real, not just as a unit test against the handler function.
  it('mcp-guide-analysis 503s on the CF container runtime without ENABLE_CRONS', async () => {
    adapter = await startAdapter({
      apiDir: DIST_API,
      staticDir: resolve(ROOT, 'test/fixtures/cf-static-missing'),
      env: { VITE_SUPABASE_URL: 'https://example.supabase.co', CRON_SECRET: 'test-cron' },
    })

    const res = await fetch(`${adapter.baseUrl}/api/mcp-guide-analysis`, {
      headers: { Authorization: 'Bearer test-cron' },
    })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Crons disabled on this runtime' })
  }, 20_000)

  it('mcp-guide-analysis behaves normally on the CF container runtime once ENABLE_CRONS=1', async () => {
    adapter = await startAdapter({
      apiDir: DIST_API,
      staticDir: resolve(ROOT, 'test/fixtures/cf-static-missing'),
      env: {
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        CRON_SECRET: 'test-cron',
        ENABLE_CRONS: '1',
      },
    })

    const unauth = await fetch(`${adapter.baseUrl}/api/mcp-guide-analysis`)
    expect(unauth.status).toBe(401)
    expect(await unauth.json()).toEqual({ error: 'Unauthorized' })

    const authed = await fetch(`${adapter.baseUrl}/api/mcp-guide-analysis`, {
      headers: { Authorization: 'Bearer test-cron' },
    })
    expect(authed.status).toBe(200)
    expect(await authed.json()).toEqual({ ok: true, processed: false, reason: 'db_unavailable' })
  }, 20_000)

  it('the route-deadline manifest itself is not routable as an API path', async () => {
    adapter = await startAdapter({
      apiDir: DIST_API,
      staticDir: resolve(ROOT, 'test/fixtures/cf-static-missing'),
    })
    const res = await fetch(`${adapter.baseUrl}/api/_route-deadlines.json`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  }, 20_000)
})
