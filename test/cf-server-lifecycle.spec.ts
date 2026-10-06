import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startAdapter } from './helpers/cf-server'

const API_DIR = resolve(new URL('./fixtures/cf-api', import.meta.url).pathname)

describe('cf server lifecycle', () => {
  it('drains background work on SIGTERM before exiting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-drain-'))
    const file = join(dir, 'drain.txt')
    const adapter = await startAdapter({ apiDir: API_DIR })

    const start = await fetch(`${adapter.baseUrl}/api/bg-start?id=d1&ms=500&file=${encodeURIComponent(file)}`)
    expect(start.status).toBe(202)

    const result = await adapter.stop()
    expect(result.code).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('done')
    expect(adapter.output()).toContain('[server] drained 1 background task(s)')

    rmSync(dir, { recursive: true, force: true })
  }, 10_000)

  it('gives up after SHUTDOWN_DRAIN_MS and still exits cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-drain-timeout-'))
    const file = join(dir, 'never.txt')
    const adapter = await startAdapter({ apiDir: API_DIR, env: { SHUTDOWN_DRAIN_MS: '100' } })

    const start = await fetch(`${adapter.baseUrl}/api/bg-start?id=d2&ms=5000&file=${encodeURIComponent(file)}`)
    expect(start.status).toBe(202)

    const startedAt = Date.now()
    const result = await adapter.stop()
    expect(Date.now() - startedAt).toBeLessThan(2000)
    expect(result.code).toBe(0)
    expect(existsSync(file)).toBe(false)
    expect(adapter.output()).toContain('[server] drain timeout with 1 pending')

    rmSync(dir, { recursive: true, force: true })
  }, 10_000)

  it('gives 404 instead of crashing when STATIC_DIR is missing', async () => {
    const adapter = await startAdapter({
      apiDir: API_DIR,
      staticDir: resolve(new URL('./fixtures/cf-static-missing', import.meta.url).pathname),
    })
    const res = await fetch(`${adapter.baseUrl}/chat/abc`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    await adapter.stop()
  })

  describe('request/headers timeouts (env-overridable for tests)', () => {
    it('a slow upload dripping chunks within REQUEST_TIMEOUT_MS still succeeds', async () => {
      const adapter = await startAdapter({ apiDir: API_DIR, env: { REQUEST_TIMEOUT_MS: '1500' } })
      const url = new URL(adapter.baseUrl)
      const body = JSON.stringify({ x: 1 })

      const status = await new Promise<number>((resolvePromise, rejectPromise) => {
        const req = http.request(
          {
            host: url.hostname,
            port: Number(url.port),
            path: '/api/echo',
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
          },
          (res) => {
            res.on('data', () => {})
            res.on('end', () => resolvePromise(res.statusCode ?? 0))
          }
        )
        req.on('error', rejectPromise)
        let i = 0
        const writeNext = () => {
          if (i >= body.length) {
            req.end()
            return
          }
          req.write(body[i])
          i++
          setTimeout(writeNext, 40)
        }
        writeNext()
      })

      expect(status).toBe(200)
      await adapter.stop()
    }, 10_000)

    it('a waitUntil job that outlives REQUEST_TIMEOUT_MS still completes', async () => {
      const adapter = await startAdapter({ apiDir: API_DIR, env: { REQUEST_TIMEOUT_MS: '300' } })

      const start = await fetch(`${adapter.baseUrl}/api/bg-start?id=rt1&ms=600`)
      expect(start.status).toBe(202)

      let state: string | null = null
      for (let i = 0; i < 60 && state !== 'done'; i++) {
        await new Promise((r) => setTimeout(r, 50))
        const poll = await fetch(`${adapter.baseUrl}/api/bg-status?id=rt1`)
        state = (await poll.json()).state
      }
      expect(state).toBe('done')
      await adapter.stop()
    }, 10_000)
  })
})
