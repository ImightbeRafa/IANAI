import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/lib/mcp/url-analysis-worker.js', () => ({
  processNextMcpUrlIntake: vi.fn(async () => ({ processed: false, reason: 'empty' })),
}))

import handler from '../api/mcp-guide-analysis'
import { processNextMcpUrlIntake } from '../api/lib/mcp/url-analysis-worker.js'

function fakeReqRes(method: string, headers: Record<string, string | string[] | undefined>) {
  const req = { method, headers } as any
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.body = body
      return res
    },
  }
  return { req, res }
}

describe('mcp-guide-analysis auth', () => {
  let prevSecret: string | undefined

  beforeEach(() => {
    prevSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = 's3cret-test'
    vi.mocked(processNextMcpUrlIntake).mockClear()
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prevSecret
  })

  it('GET with Bearer and no x-vercel-cron succeeds', async () => {
    const { req, res } = fakeReqRes('GET', { authorization: 'Bearer s3cret-test' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, processed: false, reason: 'empty' })
    expect(processNextMcpUrlIntake).toHaveBeenCalledTimes(1)
  })

  it('Vercel-style header (x-vercel-cron plus Bearer) succeeds', async () => {
    const { req, res } = fakeReqRes('GET', {
      authorization: 'Bearer s3cret-test',
      'x-vercel-cron': '1',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('POST with Bearer succeeds', async () => {
    const { req, res } = fakeReqRes('POST', { authorization: 'Bearer s3cret-test' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('wrong secret gives 401 and never calls the worker', async () => {
    const { req, res } = fakeReqRes('GET', { authorization: 'Bearer nope' })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
    expect(processNextMcpUrlIntake).not.toHaveBeenCalled()
  })

  it('a different-length secret gives 401 without throwing', async () => {
    const { req, res } = fakeReqRes('GET', { authorization: 'Bearer s3cret-testX' })
    await expect(handler(req, res)).resolves.toBeUndefined()
    expect(res.statusCode).toBe(401)
  })

  it('missing authorization header gives 401', async () => {
    const { req, res } = fakeReqRes('GET', {})
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('x-vercel-cron alone (no matching Bearer) gives 401', async () => {
    const { req, res } = fakeReqRes('GET', { 'x-vercel-cron': '1' })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('CRON_SECRET unset gives 401 even with Bearer undefined', async () => {
    delete process.env.CRON_SECRET
    const { req, res } = fakeReqRes('GET', { authorization: 'Bearer undefined' })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('PUT gives 405', async () => {
    const { req, res } = fakeReqRes('PUT', { authorization: 'Bearer s3cret-test' })
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('sets Cache-Control: no-store', async () => {
    const { req, res } = fakeReqRes('GET', { authorization: 'Bearer s3cret-test' })
    await handler(req, res)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
