// Cloudflare Worker entry point (Betsy pattern). Not part of the SPA; excluded
// from the root tsconfig; checked by `tsconfig.cf-worker.json`.
//
// Static-only: no container and no scheduled() handler. Every path that used
// to be forwarded to the container (/api/* and the two oauth-protected-resource
// rewrites) gets a 503; everything else is served from Static Assets by
// handleFetch, unchanged (security headers, Access gate, /assets/* 404s).
import { handleFetch, type WorkerEnv } from '../cf/worker-core'

const containerFetch = async (_req: Request, _e: WorkerEnv) =>
  Response.json({ error: 'Service unavailable', detail: 'Advance AI app is offline' }, { status: 503 })

export default {
  fetch: (request: Request, e: WorkerEnv) => handleFetch(request, e, containerFetch),
}
