// Pure, testable Worker logic. No `cloudflare:*` imports — the container fetch
// is injected so this can be unit-tested with a fake. src/cf-container-worker.ts
// is the thin Betsy-pattern wrapper that wires this up to the real bindings.
import {
  SECURITY_HEADERS,
  HTML_NO_CACHE,
  isHtmlEntryPath,
  isContainerPath,
} from './http-rules.mjs'
import { cronsDisabled } from './container-env.mjs'

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  CRON_SECRET?: string
  DISABLE_CRONS?: string
  APP_ENV?: string
  [key: string]: unknown
}

export type ContainerFetch = (request: Request, env: WorkerEnv) => Promise<Response>

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

export async function handleFetch(
  request: Request,
  env: WorkerEnv,
  containerFetch: ContainerFetch
): Promise<Response> {
  const pathname = new URL(request.url).pathname

  if (isContainerPath(pathname)) {
    let res: Response
    try {
      res = await containerFetch(request, env)
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

  if (cronsDisabled(env)) {
    console.log(`[cf-cron] skipped (DISABLE_CRONS) cron=${cron}`)
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
