import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

  afterAll(async () => {
    await adapter?.stop()
  })

  it('serves mcp-oauth-metadata and mcp-guide-analysis with no DB', async () => {
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

    const unauth = await fetch(`${adapter.baseUrl}/api/mcp-guide-analysis`)
    expect(unauth.status).toBe(401)
    expect(await unauth.json()).toEqual({ error: 'Unauthorized' })

    const authed = await fetch(`${adapter.baseUrl}/api/mcp-guide-analysis`, {
      headers: { Authorization: 'Bearer test-cron' },
    })
    expect(authed.status).toBe(200)
    expect(await authed.json()).toEqual({ ok: true, processed: false, reason: 'db_unavailable' })
  }, 20_000)
})
