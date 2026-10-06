// Pure, testable Worker logic. No `cloudflare:*` imports — the container fetch
// is injected so this can be unit-tested with a fake. src/cf-container-worker.ts
// is the thin Betsy-pattern wrapper that wires this up to the real bindings.
import {
  SECURITY_HEADERS,
  HTML_NO_CACHE,
  isHtmlEntryPath,
  isContainerPath,
} from './http-rules.mjs'
import { cronsEnabled } from './container-env.mjs'
import { verifyAccessJwt, type AccessJwtVerifyDeps } from './access-jwt'

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  CRON_SECRET?: string
  ENABLE_CRONS?: string
  APP_ENV?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  [key: string]: unknown
}

export type ContainerFetch = (request: Request, env: WorkerEnv) => Promise<Response>

export type HandleFetchDeps = AccessJwtVerifyDeps

export const CRON_PATHS: Record<string, readonly string[]> = {
  '* * * * *': ['/api/mcp-guide-analysis'],
}

export function withSecurityHeaders(
  res: Response,
  pathname: string,
  { fromAssets }: { fromAssets: boolean }
): Response {
  const out = new Response(res.body, res)
  for (const [key, value] of SECURITY_HEADERS) {
    if (!out.headers.has(key)) out.headers.set(key, value)
  }
  if (fromAssets) {
    const contentType = out.headers.get('content-type') ?? ''
    if (isHtmlEntryPath(pathname) || contentType.startsWith('text/html')) {
      out.headers.set('Cache-Control', HTML_NO_CACHE)
    }
  }
  return out
}

// Builds a new Request for the container with the client-IP headers
// rewritten rather than trusted as-is: any inbound X-Forwarded-For /
// X-Real-IP is dropped (a client can set those to anything), then both are
// set from CF-Connecting-IP — the header Cloudflare itself sets at the edge
// and that a client cannot spoof — when present. If CF-Connecting-IP is
// absent (e.g. in tests), both headers are left unset rather than forwarding
// a possibly-spoofed value. The incoming Request is never mutated.
function withTrustedClientIpHeaders(request: Request): Request {
  const headers = new Headers(request.headers)
  headers.delete('X-Forwarded-For')
  headers.delete('X-Real-IP')
  const connectingIp = request.headers.get('CF-Connecting-IP')
  if (connectingIp) {
    headers.set('X-Forwarded-For', connectingIp)
    headers.set('X-Real-IP', connectingIp)
  }
  return new Request(request, { headers })
}

export async function handleFetch(
  request: Request,
  env: WorkerEnv,
  containerFetch: ContainerFetch,
  deps: HandleFetchDeps = {}
): Promise<Response> {
  // Preview only: every request (assets and container alike) must carry a
  // valid Cloudflare Access JWT. Production is completely unaffected — this
  // check doesn't even run there. scheduled() never calls this function, so
  // crons stay governed only by ENABLE_CRONS (see handleScheduled below).
  if (env.APP_ENV === 'preview') {
    const authorized = await verifyAccessJwt(request, env, deps)
    if (!authorized) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const pathname = new URL(request.url).pathname

  if (isContainerPath(pathname)) {
    let res: Response
    try {
      res = await containerFetch(withTrustedClientIpHeaders(request), env)
    } catch {
      res = Response.json({ error: 'Container unavailable' }, { status: 503 })
    }
    return withSecurityHeaders(res, pathname, { fromAssets: false })
  }

  let res = await env.ASSETS.fetch(request)
  if (pathname.startsWith('/assets/')) {
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.startsWith('text/html')) {
      res = new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }
  }
  return withSecurityHeaders(res, pathname, { fromAssets: true })
}

export async function handleScheduled(
  controller: { cron: string },
  env: WorkerEnv,
  containerFetch: ContainerFetch
): Promise<{ skipped: boolean; results?: unknown[] }> {
  const cron = controller.cron

  // Fail closed: only ENABLE_CRONS === '1' runs anything. See
  // cf/container-env.mjs's cronsEnabled for why this isn't a truthy check.
  if (!cronsEnabled(env)) {
    console.log(`[cf-cron] skipped (ENABLE_CRONS!=='1') cron=${cron}`)
    return { skipped: true }
  }

  const paths = CRON_PATHS[cron]
  if (!paths) {
    console.log('[cf-cron] unknown cron expression')
    return { skipped: true }
  }

  const secret = String(env.CRON_SECRET ?? '').trim()
  if (!secret) {
    throw new Error('CRON_SECRET not configured on Worker')
  }

  const results: Response[] = []
  for (const path of paths) {
    const r = await containerFetch(
      new Request(`http://container${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
      }),
      env
    )
    await r.arrayBuffer().catch(() => undefined)
    if (!r.ok) {
      throw new Error(`Cron ${cron} ${path} failed with status ${r.status}`)
    }
    results.push(r)
  }

  console.log('[cf-cron] ok')
  return { skipped: false, results }
}
