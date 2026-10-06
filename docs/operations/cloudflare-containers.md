# Cloudflare Containers: architecture and operations

**Status:** Phase 1 (this PR) is code + docs only. Nothing is deployed, there
are no DB migrations, and `vercel.json` stays byte-for-byte unchanged. Vercel
prod and Preview keep working from this branch unmodified. See
`docs/operations/cloudflare-parity-checklist.md` for what is and isn't proven
yet, and `scripts/parity/README.md` for the parity tooling.

## 1. Architecture

A Cloudflare Worker (`src/cf-container-worker.ts`) serves the built SPA
(`dist/`) as Static Assets and forwards everything under `/api/*` (plus the
two `oauth-protected-resource` rewrites) to a single named Cloudflare
Container instance running the existing Vercel-style `api/**` handlers,
unchanged, behind a plain `node:http` adapter (`server.mjs`).

```
request → Worker (cf/worker-core.ts: handleFetch)
             ├─ /api/*, /.well-known/oauth-protected-resource[/api/mcp] → Container (server.mjs → api/**.js)
             └─ everything else                                        → env.ASSETS (dist/, SPA fallback)
```

This follows the "Betsy" pattern: `AdvanceAiContainer extends Container` from
`@cloudflare/containers`, routed with `getContainer()` (single instance, no
load balancing in Phase 1). The cron trigger (`* * * * *`) calls
`handleScheduled`, which forwards to `GET /api/mcp-guide-analysis` with
`Authorization: Bearer <CRON_SECRET>` — the same header Vercel Cron already
sends, so `api/mcp-guide-analysis.ts`'s auth check didn't need to change
behaviorally, just become timing-safe (§8).

## 2. File map

| Path | What |
|---|---|
| `server.mjs` | Node adapter: Vercel-compatible req/res helpers, routes `/api/<segments>.js` from `dist-api/`, static/SPA fallback, `waitUntil` tracking + SIGTERM drain. |
| `cf/http-rules.mjs` (+ `.d.mts`) | CSP/security headers, path classification (`isApiPath`, `isContainerPath`, `isSpaFallbackPath`, `rewriteToApi`), `parseSizeLimit`. Imported by both `server.mjs` (Node) and the Worker (bundled by wrangler). |
| `cf/container-env.mjs` (+ `.d.mts`) | `CONTAINER_ENV_KEYS` (names only), `getContainerEnvVars`, `cronsDisabled`. |
| `cf/worker-core.ts` | Pure Worker logic (`handleFetch`, `handleScheduled`, `withSecurityHeaders`) — no `cloudflare:*` imports, so it's unit-testable with a fake container fetch. |
| `src/cf-container-worker.ts` | Thin Betsy-pattern wrapper: the `AdvanceAiContainer` class and the real Worker `fetch`/`scheduled` exports. Excluded from the root `tsconfig.json`; typechecked separately via `tsconfig.cf-worker.json` / `npm run typecheck:worker`. |
| `scripts/build-api.mjs` | esbuild, per file, `api/**/*.ts` → `dist-api/**/*.js` (ESM, types stripped only, `node_modules` external). `npm run build:api`. |
| `wrangler.jsonc` | Worker + Container + cron + Static Assets config, with `env.preview` repeating every block explicitly. |
| `Dockerfile` / `.dockerignore` | Builds `dist/` + `dist-api/` and runs `server.mjs` on port 8080. |
| `scripts/parity/*` | Read-only/local-only parity tooling — see `scripts/parity/README.md`. |
| `api/lib/app-env.ts` | `resolveAppEnv`/`isProductionAppEnv`/`isPreviewAppEnv` — `APP_ENV`, falling back to `VERCEL_ENV`. |

## 3. Local build and run

```bash
npm run build                                       # tsc -b && vite build → dist/
npm run build:api                                   # esbuild api/**/*.ts → dist-api/
PORT=8080 API_DIR=dist-api STATIC_DIR=dist npm start # node server.mjs
curl -s localhost:8080/api/health
```

Or in Docker (no deploy; `linux/amd64` — add `--platform linux/amd64` on Apple
Silicon):

```bash
docker build --platform linux/amd64 -t advance-ai:local --build-arg VITE_APP_ENV=preview .
docker run --rm -p 8080:8080 -e APP_ENV=preview -e DISABLE_CRONS=1 advance-ai:local
```

Then run the parity scripts against that container (see
`scripts/parity/README.md`).

**Local container evidence:** this exact sequence has actually been run —
operator, 2026-10-06, image `sha256:a05d43e25efd6860b02bac70e976f6a406e08e82831ecaa4abf4a0ced1af1db1`,
no secrets, `APP_ENV=preview`, `DISABLE_CRONS=1`, bound to `127.0.0.1`. The
full results (route sweep, `sharp`/`pdf-parse` smoke tests, `waitUntil`
drain, headers/SPA/asset checks, Tilopay replay) are in
`docs/operations/cloudflare-parity-checklist.md`, including the caveat that
this doesn't yet prove identity with whatever Cloudflare actually deploys
(`containers[].image: "./Dockerfile"` means `wrangler deploy` rebuilds
rather than pulling this digest).

## 4. Secrets (names only — set with `wrangler secret put <NAME>`, add `--env preview` for Preview)

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GROK_API_KEY`, `XAI_API_KEY`,
`GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, `FAL_KEY`,
`BFL_API_KEY`, `TILOPAY_API_KEY`, `TILOPAY_API_USER`, `TILOPAY_API_PASSWORD`,
`TILOPAY_WEBHOOK_SECRET`, `TICKETS_EVENT_WEBHOOK_URL`,
`TICKETS_WEBHOOK_SECRET`, `CRON_SECRET`. Non-secret `vars` (`APP_ENV`,
`DISABLE_CRONS`, and the rest) live directly in `wrangler.jsonc`. See
`scripts/parity/vercel-env-names.mjs` and `cf/container-env.mjs` for the full
name lists, and `npm run parity:env` to diff them.

`FAL_KEY` and `BFL_API_KEY` are forwarded but currently unused by any code
path (`npm run parity:env` flags them as `unusedVercelNames`) — kept, not
dropped, in case either provider comes back.

## 5. Static Assets are host-built, not Docker-built

Cloudflare Workers Static Assets are uploaded from the **host-built**
`dist/` at deploy time, not from the Docker image. The deploy step must run,
e.g.:

```bash
VITE_APP_ENV=production VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... VITE_CREDITS_V1=... npm run build
npx wrangler@4 deploy
```

The Docker-built `dist/` is only the container's own fallback copy (used if
something inside the container needs to serve a static file directly) — it
is never what Cloudflare serves at the edge. The two builds must use
matching `VITE_*` values for a given environment; this is on the deploy
runbook, not automated here.

## 6. Cron gate and cutover order

`DISABLE_CRONS=1` in both the top-level and `env.preview` `vars` blocks of
`wrangler.jsonc` until cutover, because the **Vercel cron stays live** during
Phase 1/2. Two concurrent writers (Vercel's cron and the Cloudflare cron)
hitting `/api/mcp-guide-analysis` at the same time would both call
`processNextMcpUrlIntake`; the RPC's `FOR UPDATE SKIP LOCKED` claim means they
can't double-claim the *same* pending row, but see §8 for a narrower residual
risk. At cutover: flip `DISABLE_CRONS` to `"0"` on the Cloudflare side in the
**same window** as removing the Vercel cron from `vercel.json`, so there is
never a window with two active cron sources.

## 7. Body limits, query, and cookies vs Vercel

- **Body limit:** default 4.5 MiB (4,718,592 bytes), matching Vercel's
  platform-wide cap. Per-handler `config.api.bodyParser.sizeLimit` (e.g.
  `'10mb'`, `'25mb'`) is now **actually enforced** — on Vercel today, the
  platform's 4.5 MB cap applied regardless of what a handler's `sizeLimit`
  said, so those higher limits were never effective. This is a deliberate
  improvement, not a regression; see `docs/operations/cloudflare-route-table.md`
  for which handlers configure a larger limit. `config.api.bodyParser: false`
  means the adapter applies **no** limit at all — Cloudflare's own ~100 MB
  edge request cap is the only ceiling (`api/parse-pdf.ts`'s raw-stream
  path).
- **Query:** `querystring.parse` on the raw search string, which is what
  `url.parse(url, true).query` does internally on Vercel. Repeated keys
  become arrays; a bare `?flag` becomes `''`.
- **Cookies:** a small hand-rolled parser with `cookie@0.x` semantics (split
  on `;`, first occurrence wins, trim, strip surrounding quotes,
  `decodeURIComponent` when the value contains `%`, keeping the raw value on
  a decode error). The `cookie` package isn't a dependency.
- **Content-type normalization:** `split(';')[0].trim().toLowerCase()`
  instead of the throwing `content-type` npm package Vercel uses — a
  deliberate simplification, documented here as a deviation.
- **No ETag** on `res.send`/`res.json` responses (Vercel's dev server sets
  one; the adapter does not).

## 8. `waitUntil`, drain, and SIGTERM

Outside Vercel, `@vercel/functions`' `waitUntil()` is a no-op unless
something installs `globalThis[Symbol.for('@vercel/request-context')]`.
`server.mjs` installs exactly that shape once, tracking every background
promise in a `Set`. On `SIGTERM`/`SIGINT` it stops accepting new connections,
then waits (up to `SHUTDOWN_DRAIN_MS`, default 5 minutes) for all tracked
background work to settle before exiting 0 — so a container recycle doesn't
silently drop an in-flight image generation or MCP execute job. Users of
`waitUntil` today: `api/mcp.ts` (MCP `execute_*` jobs) and
`api/generate-image.ts` (chat-shell image jobs); both already attach
`.catch`.

**No per-handler max duration.** Vercel's `maxDuration` (60–300s depending on
the route, see the route table) no longer applies — Node's own
`requestTimeout` (300s, for *receiving* the request) and `headersTimeout`
(60s) are the only built-in ceilings, and there is no response timeout.
Long-running jobs (MCP execute, bulk campaign/posts, image generation,
carousel) can now run to completion instead of being cut off, which is an
improvement — but see the next point for the one place that assumed runs
would eventually be killed.

**Guide-analysis lock-safety (report only, no redesign in this PR):**
`processNextMcpUrlIntake` claims a row via the `claim_mcp_url_intake` RPC
(`supabase/migrations/072…sql`) using `FOR UPDATE SKIP LOCKED LIMIT 1` plus a
stale reclaim after `greatest(300s, 60s)`. Two concurrent runners therefore
claim *different* pending rows, never the same one. The residual risk: the
final `ready`/`failed` update is keyed only by `id`, without re-checking
`claimed_at` or status. On Vercel, `maxDuration: 60` bounded a run; the
container has no such kill, so a run that somehow took longer than 300s
could have its row reclaimed and processed twice, logging usage twice. The
merges are fill-only, so impact is low — this is exactly why §6 keeps
`DISABLE_CRONS=1` everywhere until cutover, and is worth re-checking before
flipping it.

## 9. Tilopay: no HMAC

`api/tilopay/webhook.ts` authenticates with a `?secret=` query parameter
compared against `TILOPAY_WEBHOOK_SECRET` — there is no HMAC signature.
`scripts/test-tilopay-webhook.js` (pre-existing, left alone) describes an
HMAC scheme that does not match this handler; treat it as stale. The
Cloudflare-side replay tooling (`scripts/parity/tilopay-webhook-replay.mjs`)
deliberately has **no `--write` mode**: every POST that passes the real
secret writes a `payment_transactions` row (even a "no email" request writes
an `error_no_email` audit row) on the **shared AIIAN database**. Exercising
that success path needs an explicit Orchestrator OK and a dedicated test
identity, and is Phase 2 work done by a human — see
`docs/operations/cloudflare-parity-checklist.md` item 7.

## 10. Phase 2 prerequisites (not this PR)

1. Add the Cloudflare preview Worker hostname to Supabase Auth's allowed
   redirect URLs (OAuth/magic-link/reset flows all redirect back to the app
   origin).
2. Put Cloudflare Access in front of the preview environment. There will
   **never** be an Access service token or bypass in this codebase — nothing
   here validates `Cf-Access-Jwt-Assertion` or does anything Access-aware;
   anything that must cross Access is a human doing it in a browser session.
3. Only after both of the above: flip `workers_dev` (and, separately at
   cutover, `DISABLE_CRONS`) from `false` to `true`/`"0"`.

See `docs/operations/cloudflare-parity-checklist.md` for the full pass/fail
list this unlocks, and `scripts/parity/README.md` for the supporting
tooling.
