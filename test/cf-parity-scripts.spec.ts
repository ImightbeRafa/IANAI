import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJsonc } from '../scripts/parity/lib.mjs'
import { diffEnv, buildVercelNameTable } from '../scripts/parity/env-diff.mjs'
import { buildRouteTable } from '../scripts/parity/route-table.mjs'
import { VERCEL_ENV_NAMES } from '../scripts/parity/vercel-env-names.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('route-table', () => {
  const rows = buildRouteTable(ROOT)
  const byRoute = new Map(rows.map((r) => [r.route, r]))

  it('parse-pdf is a raw stream', () => {
    expect(byRoute.get('/api/parse-pdf')?.bodyParser).toBe('false (raw stream)')
  })

  it('extract-pdf allows 10mb', () => {
    expect(byRoute.get('/api/extract-pdf')?.bodyParser).toBe('10mb')
  })

  it('analyze-style allows 25mb', () => {
    expect(byRoute.get('/api/analyze-style')?.bodyParser).toBe('25mb')
  })

  it('bulk-posts has a 300s maxDuration', () => {
    expect(byRoute.get('/api/bulk-posts')?.maxDuration).toBe(300)
  })

  it('tilopay/webhook supports GET and POST', () => {
    const methods = byRoute.get('/api/tilopay/webhook')?.methods ?? []
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
  })

  it('mcp and generate-image use waitUntil', () => {
    expect(byRoute.get('/api/mcp')?.waitUntil).toBe(true)
    expect(byRoute.get('/api/generate-image')?.waitUntil).toBe(true)
  })

  it('never routes lib/, data/ or types/', () => {
    for (const row of rows) {
      expect(row.route.startsWith('/api/lib/')).toBe(false)
      expect(row.route.startsWith('/api/data/')).toBe(false)
      expect(row.route.startsWith('/api/types/')).toBe(false)
    }
  })

  it('detects the auth mechanism per handler, verified against source', () => {
    expect(byRoute.get('/api/mcp-guide-analysis')?.auth).toBe('CRON_SECRET bearer (401 without)')
    expect(byRoute.get('/api/tilopay/webhook')?.auth).toBe('query secret (403 without)')
    expect(byRoute.get('/api/chat')?.auth).toBe('user JWT (401 without)')
    expect(byRoute.get('/api/mcp-oauth-metadata')?.auth).toBe('public (no auth)')
    expect(byRoute.get('/api/mcp')?.auth).toContain('mcp OAuth bearer')
    expect(byRoute.get('/api/admin-usage')?.auth).toContain('admin JWT')
    expect(byRoute.get('/api/bulk-posts')?.auth).toBe('user JWT (401 without)')
    expect(byRoute.get('/api/ticket-events')?.auth).toContain('mixed')
  })

  it('every row has a PENDING cfResult and a parity tag', () => {
    for (const row of rows) {
      expect(row.cfResult).toBe('PENDING')
      expect(['[local, identical image]', '[needs browser session behind Access]']).toContain(row.tag)
    }
  })
})

describe('env-diff', () => {
  it('has zero missing/unforwarded names and only the two known-unused ones', () => {
    const result = diffEnv(ROOT)
    expect(result.missingFromContainer).toEqual([])
    expect(result.wranglerVarsNotForwarded).toEqual([])
    expect(result.unusedVercelNames).toEqual(['BFL_API_KEY', 'FAL_KEY'])
  })

  it('has the exact 17 audited Vercel env names', () => {
    expect(VERCEL_ENV_NAMES).toEqual([
      'TICKETS_EVENT_WEBHOOK_URL',
      'TICKETS_WEBHOOK_SECRET',
      'VITE_CREDITS_V1',
      'CREDITS_V1',
      'CRON_SECRET',
      'OPENAI_API_KEY',
      'FAL_KEY',
      'GEMINI_API_KEY',
      'TILOPAY_API_USER',
      'TILOPAY_API_PASSWORD',
      'SUPABASE_SERVICE_ROLE_KEY',
      'TILOPAY_WEBHOOK_SECRET',
      'TILOPAY_API_KEY',
      'BFL_API_KEY',
      'GROK_API_KEY',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
    ])
  })

  it('builds a per-name table: forwarded to container + read-in-code status', () => {
    const table = buildVercelNameTable(ROOT)
    expect(table).toHaveLength(17)
    expect(table.every((row) => row.forwardedToContainer)).toBe(true)

    const byName = new Map(table.map((row) => [row.name, row]))
    expect(byName.get('FAL_KEY')?.readInCode).toBe('no')
    expect(byName.get('BFL_API_KEY')?.readInCode).toBe('no')
    expect(byName.get('GROK_API_KEY')?.readInCode).toBe('api')
    expect(byName.get('VITE_SUPABASE_ANON_KEY')?.readInCode).toBe('src')
    expect(byName.get('VITE_SUPABASE_URL')?.readInCode).toBe('api+src')
  })
})

describe('parseJsonc', () => {
  it('strips line comments and trailing commas', () => {
    expect(parseJsonc('{"u":"https://x//y", // c\n "a":1,}')).toEqual({ u: 'https://x//y', a: 1 })
  })
})

describe('tilopay-webhook-replay guard', () => {
  it('refuses a non-local base URL without making a network call', () => {
    let threw = false
    try {
      execFileSync(
        process.execPath,
        [resolve(ROOT, 'scripts/parity/tilopay-webhook-replay.mjs'), '--base-url', 'https://advanceai.studio'],
        { encoding: 'utf8', timeout: 5_000 }
      )
    } catch (err: any) {
      threw = true
      expect(err.status).not.toBe(0)
      expect(String(err.stderr)).toContain('refusing non-local base URL')
    }
    expect(threw).toBe(true)
  })
})
