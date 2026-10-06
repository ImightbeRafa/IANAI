# Cloudflare Containers: architecture and operations

**Status:** Phase 1 (this PR) is code + docs only. Nothing is deployed, there
are no DB migrations, and `vercel.json` stays byte-for-byte unchanged. Vercel
prod and Preview keep working from this branch unmodified. See
`docs/operations/cloudflare-parity-checklist.md` for what is and isn't proven
yet, and `scripts/parity/README.md` for the parity tooling.

This revision folds in a security review (SecureDog) that FAILED High on the
first cut — see §6 (cron fail-closed), §11 (Access JWT gate, decision
reversed to ADD it), and §13 (deviations) for what changed and why.

## 1. Architecture

A Cloudflare Worker (`src/cf-container-worker.ts`) serves the built SPA
(`dist/`) as Static Assets and forwards everything under `/api/*` (plus the
two `oauth-protected-resource` rewrites) to a single named Cloudflare
Container instance running the existing Vercel-style `api/**` handlers,
unchanged, behind a plain `node:http` adapter (`server.mjs`).

```
request → Worker (cf/worker-core.ts: handleFetch)
             ├─ APP_ENV==='preview' only: cf/access-jwt.ts gate (§11) — 403 without a valid Cloudflare Access JWT
             ├─ /api/*, /.well-known/oauth-protected-resource[/api/mcp] → Container (server.mjs → api/**.js)
             └─ everything else                                        → env.ASSETS (dist/, SPA fallback)
```

This follows the "Betsy" pattern: `AdvanceAiContainer extends Container` from
`@cloudflare/containers`, routed with `getContainer()` — which always routes
to the **same one named instance** (no load balancing; `max_instances: 2` in
`wrangler.jsonc` is rollout headroom for a container recycle/restart, not
added capacity — see §2's `wrangler.jsonc` row). The cron trigger
(`* * * * *`) calls `handleScheduled`, which — only when `ENABLE_CRONS==='1'`
(§6) — forwards to `GET /api/mcp-guide-analysis` with `Authorization: Bearer
<CRON_SECRET>`, the same header shape Vercel Cron already sends.
`handleScheduled` is never subject to the Access JWT gate (crons aren't
browser requests); it's governed purely by `ENABLE_CRONS` (§6).

## 2. File map

| Path | What |
|---|---|
| `server.mjs` | Node adapter: Vercel-compatible req/res helpers, routes `/api/<segments>.js` from `dist-api/`, static/SPA fallback, `waitUntil` tracking + SIGTERM drain, per-route deadlines (§8), Node `requestTimeout`/`headersTimeout` (§8), a 10 MiB cap on raw-stream (`bodyParser:false`) handlers (§7). |
| `cf/http-rules.mjs` (+ `.d.mts`) | CSP/security headers, path classification (`isApiPath`, `isContainerPath`, `isSpaFallbackPath`, `rewriteToApi`), `parseSizeLimit`. Imported by both `server.mjs` (Node) and the Worker (bundled by wrangler). |
| `cf/container-env.mjs` (+ `.d.mts`) | `CONTAINER_ENV_KEYS` (names only), `getContainerEnvVars`, `cronsEnabled` (fail-closed on `ENABLE_CRONS==='1'`, §6). |
| `cf/access-jwt.ts` | Cloudflare Access JWT verification (`verifyAccessJwt`) for the preview-only gate (§11). WebCrypto only, no new dependency, no `cloudflare:*` import. |
| `cf/worker-core.ts` | Pure Worker logic (`handleFetch`, `handleScheduled`, `withSecurityHeaders`) — no `cloudflare:*` imports, so it's unit-testable with a fake container fetch. Also strips/replaces `X-Forwarded-For`/`X-Real-IP` with `CF-Connecting-IP` before forwarding to the container (§12). |
| `src/cf-container-worker.ts` | Thin Betsy-pattern wrapper: the `AdvanceAiContainer` class and the real Worker `fetch`/`scheduled` exports. Excluded from the root `tsconfig.json`; typechecked separately via `tsconfig.cf-worker.json` / `npm run typecheck:worker`. |
| `scripts/build-api.mjs` | esbuild, per file, `api/**/*.ts` → `dist-api/**/*.js` (ESM, types stripped only, `node_modules` external). Also emits `dist-api/_route-deadlines.json` (§8) — not routable (its name fails the API segment regex). `npm run build:api`. |
| `wrangler.jsonc` | Worker + Container + cron + Static Assets config, with `env.preview` repeating every block explicitly. `env.preview.triggers.crons` is explicitly `[]` (§6); `env.preview.vars` carries the non-secret `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` placeholders (§11), which are Worker-only and never forwarded to the container. |
| `Dockerfile` / `.dockerignore` | Builds `dist/` + `dist-api/` and runs `server.mjs` on port 8080. Base image pinned by digest (§14). |
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
docker run --rm -p 8080:8080 -e APP_ENV=preview advance-ai:local
```

Crons stay off by default (no `ENABLE_CRONS` set — §6); there's nothing to
pass for that anymore. Then run the parity scripts against that container
(see `scripts/parity/README.md`).

**Local container evidence:** the operator has now rebuilt and re-run the
sequence above against the current revision, image
`sha256:08029107de5fa4c986c147b839d970139d5a534d43d40a5b7956c09d5c674aa1`,
built from the pinned base
`node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`
(§14) — this run **does** cover the SD-01…SD-09 changes (`ENABLE_CRONS`
fail-closed, including the `/api/mcp-guide-analysis` 503-before-401 guard
confirmed live, the raw-stream cap via the delayed-reader fixture, `sharp`/
`pdf-parse`, the Tilopay replay, and a clean `SIGTERM` shutdown). The full
results are in `docs/operations/cloudflare-parity-checklist.md`.

An **older** run against commit `c42301b`, image
`sha256:a05d43e25efd6860b02bac70e976f6a406e08e82831ecaa4abf4a0ced1af1db1`,
predates all of those SD-01…SD-09 changes and is superseded by the run
above wherever the two overlap; it remains on record in the checklist
only for the parts it covers that weren't repeated in this round (the
actual background-job-draining proof for `waitUntil`, and the security-
headers/SPA/container-user checks).

## 4. Secrets

### 4a. Full name list (prod)

Names only — set with `wrangler secret put <NAME>` (add `--env preview` for
Preview, but see §4b for why Preview's list is deliberately smaller):

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GROK_API_KEY`, `XAI_API_KEY`,
`GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, `FAL_KEY`,
`BFL_API_KEY`, `TILOPAY_API_KEY`, `TILOPAY_API_USER`, `TILOPAY_API_PASSWORD`,
`TILOPAY_WEBHOOK_SECRET`, `TICKETS_EVENT_WEBHOOK_URL`,
`TICKETS_WEBHOOK_SECRET`, `CRON_SECRET`. Non-secret `vars` (`APP_ENV`,
`ENABLE_CRONS` once set at cutover, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) live
directly in `wrangler.jsonc`. See `scripts/parity/vercel-env-names.mjs` and
`cf/container-env.mjs` for the full name lists, and `npm run parity:env` to
diff them.

`FAL_KEY` and `BFL_API_KEY` are forwarded but currently unused by any code
path (`npm run parity:env` flags them as `unusedVercelNames`) — kept, not
dropped, in case either provider comes back.

### 4b. Minimal Preview secret set (SD-05)

Preview QA needs far fewer secrets than prod, and some of prod's secrets
must **never** be on Preview at all. Set only:

- **Supabase URL**, under the name the code actually reads first:
  `SUPABASE_URL` (`api/lib/supabase-admin.ts` reads `SUPABASE_URL`, falling
  back to `VITE_SUPABASE_URL` only if that's unset — set `SUPABASE_URL`
  directly rather than relying on the fallback).
- **Exactly one service key**: `SUPABASE_SECRET_KEY`. The code checks this
  one first (`supabaseAdminKey = process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY`) and only falls back to
  `SUPABASE_SERVICE_ROLE_KEY` if it's unset — don't set both.
- The **`VITE_*` values** the frontend bakes in at build time:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_CREDITS_V1` if
  Preview QA needs credits-gated flows exercised (plus the matching
  `CREDITS_V1` for parity with the backend check).
- The **AI provider keys** actually exercised in QA:
  `GROK_API_KEY`/`XAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`.
- **Tilopay sandbox API credentials** (`TILOPAY_API_KEY`,
  `TILOPAY_API_USER`, `TILOPAY_API_PASSWORD`) if Tilopay sandbox
  `create-checkout` needs to be exercised — **or none at all** if it
  doesn't.

**Explicitly do NOT set on Preview:** `TILOPAY_WEBHOOK_SECRET`,
`CRON_SECRET`, `TICKETS_EVENT_WEBHOOK_URL`, `TICKETS_WEBHOOK_SECRET`. These
gate things that must not run against the shared AIIAN database from
Preview (webhook success-path writes, the cron worker, ticket relays) —
leaving them unset means the corresponding handlers fail closed (403/503)
rather than someone having to remember not to trigger them. The parity
checklist tags the specific checks this blocks as `[local signed fixture]`
— proven locally against the identical image with a locally generated test
secret and fixtures, never against Preview.

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

## 6. Cron: fail closed on `ENABLE_CRONS` (SD-01, was High)

The first cut of this gate used `DISABLE_CRONS` with a loose truthy check.
SecureDog failed that High: a typo'd or mis-cased value (`'true'` instead of
`'1'`, or simply forgetting to set it) could leave the gate open. The fix is
fail-closed in three independent layers:

1. **Worker `scheduled()`:** `cf/container-env.mjs`'s `cronsEnabled(env)`
   returns true **only** for the exact string `'1'` (after trim) —
   `undefined`, `''`, `'0'`, `'true'`, `'TRUE'`, `'yes'` are all false, with
   or without `APP_ENV=preview`. Neither `wrangler.jsonc` env block sets
   `ENABLE_CRONS` at all right now — it gets added, set to `"1"`, only at
   cutover (§15).
2. **`wrangler.jsonc` triggers:** `env.preview.triggers.crons` is
   explicitly `[]` (not inherited from the top-level `["* * * * *"]`) —
   Preview's Worker never even receives a scheduled event to evaluate.
   Belt-and-suspenders on top of (1).
3. **Handler-level guard:** `api/mcp-guide-analysis.ts` returns `503
   {"error":"Crons disabled on this runtime"}` when running on the CF
   container (`process.env.ADVANCE_RUNTIME === 'cloudflare-container'`,
   set only by `server.mjs`/the Dockerfile, never by Vercel) **and**
   `process.env.ENABLE_CRONS !== '1'`. This means even a direct `curl` to
   the container's `/api/mcp-guide-analysis` with a stolen/leaked
   `CRON_SECRET` can't run the worker while crons are disabled — the gate
   doesn't depend on the Worker's routing at all. The Vercel path (no
   `ADVANCE_RUNTIME`) is completely unaffected: same `authorizeCron()`
   check as before, same 200/401 behavior.

At cutover: set `ENABLE_CRONS: "1"` **and** a **CF-only `CRON_SECRET`**
(distinct from Vercel's) on the prod Worker in the same window as removing
the Vercel cron from `vercel.json` — never both live (§15). Preview never
gets `ENABLE_CRONS` set at all; its `CRON_SECRET` also stays unset, since
there's nothing to authorize there (§4b).

Two concurrent writers (if it ever happened) couldn't double-claim the
*same* pending row — the RPC's `FOR UPDATE SKIP LOCKED` prevents that — but
see §9 for a narrower residual risk around the final status update, which
this revision also closes.

## 7. Body limits, query, and cookies vs Vercel

- **Body limit:** default 4.5 MiB (4,718,592 bytes), matching Vercel's
  platform-wide cap. Per-handler `config.api.bodyParser.sizeLimit` (e.g.
  `'10mb'`, `'25mb'`) is now **actually enforced** — on Vercel today, the
  platform's 4.5 MB cap applied regardless of what a handler's `sizeLimit`
  said, so those higher limits were never effective. This is a deliberate
  improvement, not a regression; see `docs/operations/cloudflare-route-table.md`
  for which handlers configure a larger limit.
- **Raw-stream cap (SD-04):** `config.api.bodyParser: false` handlers
  (`api/parse-pdf.ts` today) are capped at **10 MiB** — a new ceiling Vercel
  never had (Vercel enforced nothing here; Cloudflare's own ~100 MB edge
  request cap was the only limit). A known `Content-Length` over 10 MiB is
  rejected with 413 before the handler ever runs; a chunked body that grows
  past 10 MiB while being read gets an explicit `'error'` on the handler's
  stream (never a falsely-successful truncated `'end'`), plus a 413 if
  headers aren't sent yet. The handler still reads the raw stream directly
  — the adapter only counts bytes alongside it, via a proxy that pulls from
  the real request itself (not `req.pipe()`/a bare early listener) so that
  a handler attaching its stream listeners *after* an await (`api/parse-
  pdf.ts` does `await supabase.auth.getUser(token)` first, same as every
  other handler) never loses chunks — or even the `'end'` event — that
  arrived during that await.
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

## 8. `waitUntil`, per-route deadlines, drain, and SIGTERM

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

**Per-route deadlines, matching Vercel's `maxDuration` (SD-04).** Earlier
revisions of this doc said "no per-handler max duration" — that's no longer
true. Each route gets a deadline equal to its Vercel `maxDuration`: a
module's own `export const maxDuration` (or `config.maxDuration`) wins if
present; otherwise `server.mjs` reads `dist-api/_route-deadlines.json`, a
manifest `scripts/build-api.mjs` generates at build time from
`vercel.json`'s `functions[...].maxDuration` (vercel.json itself isn't
shipped in the runtime image). A route with neither gets **300s**, Vercel's
Fluid-compute platform default. When a deadline elapses with no response
sent yet, the adapter responds `504 {"error":"Gateway Timeout"}` itself —
but it does **not** abort the handler: the handler keeps running (and any
`waitUntil` work it already scheduled keeps running to completion
independent of the request/response). If the handler eventually tries to
write a response after the 504 already went out, that write is a silent
no-op (the adapter wraps `res.end`/`res.write` to check `writableEnded`
first) instead of crashing the process with `ERR_STREAM_WRITE_AFTER_END`.

**Node server timeouts.** `server.requestTimeout` (default 120000ms) bounds
how long Node waits to finish *receiving* a request (headers + body) before
tearing down the socket; `server.headersTimeout` (default 30000ms) bounds
just the headers. 120s comfortably covers this app's largest body (25 MiB)
at ≳1.7 Mbit/s, well under typical upload speeds, and Cloudflare's own edge
buffers/forwards the request to the container so client-side slowness
before the edge doesn't count against this budget. Both are
env-overridable (`REQUEST_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`) — used by tests
that need a short timeout to fire quickly, not meant to be changed in
production.

## 9. Guide-analysis lock-safety — now lease-guarded (SD-06)

`processNextMcpUrlIntake` claims a row via the `claim_mcp_url_intake` RPC
(`supabase/migrations/072…sql`) using `FOR UPDATE SKIP LOCKED LIMIT 1` plus a
stale reclaim after `greatest(300s, 60s)`. Two concurrent runners therefore
claim *different* pending rows, never the same one — that part was already
safe. What this revision fixes: the final `ready`/`failed`/`pending_analysis`
update used to be keyed only by `id`, with no check that this runner still
held the lease. On Vercel, `maxDuration: 60` bounded a run short enough that
this rarely mattered; the container has no such kill (§8), so a run that
somehow took longer than the stale-reclaim window could have had its row
reclaimed by a second runner and then had its *own*, now-stale write
clobber the second runner's in-flight work. Both the success and failure
updates now add `.eq('status', 'processing').eq('claimed_at',
row.claimed_at)` — if a stale-reclaim has since moved `claimed_at`, the
update matches zero rows instead of overwriting newer work. See
`test/mcp-url-analysis-lease.spec.ts`.

This is on top of — not instead of — §6's `ENABLE_CRONS` gate, which is the
primary reason this worker won't run on Preview/un-cutover-prod at all.

## 10. Tilopay: no HMAC

`api/tilopay/webhook.ts` authenticates with a `?secret=` query parameter
compared against `TILOPAY_WEBHOOK_SECRET` — there is no HMAC signature, and
(see §14's "Pre-cutover hardening") the comparison itself is a plain `!==`,
not constant-time. `scripts/test-tilopay-webhook.js` (pre-existing, left
alone) describes an HMAC scheme that does not match this handler; treat it
as stale. The Cloudflare-side replay tooling
(`scripts/parity/tilopay-webhook-replay.mjs`) deliberately has **no
`--write` mode**: every POST that passes the real secret writes a
`payment_transactions` row (even a "no email" request writes an
`error_no_email` audit row) on the **shared AIIAN database**. Exercising
that success path needs an explicit Orchestrator OK and a dedicated test
identity, and is Phase 2 work done by a human — see
`docs/operations/cloudflare-parity-checklist.md` item 7. `TILOPAY_WEBHOOK_SECRET`
is never set on Preview at all (§4b), so the success path can't run there
even with Orchestrator sign-off — only against the identical image locally,
with a locally generated test secret (tagged `[local signed fixture]` in
the checklist).

## 11. Cloudflare Access JWT gate (SD-03 — decision reversed: ADD)

An earlier pass of this work deliberately left Access-awareness out of the
code ("nothing here validates `Cf-Access-Jwt-Assertion`"). SecureDog's
review reversed that decision: Preview needs an **actual** gate in front of
it, not just a plan to put Cloudflare Access in front of it later with no
verification on this side. `cf/access-jwt.ts` now verifies the
`Cf-Access-Jwt-Assertion` header **in the Worker**, before routing, **only
when `env.APP_ENV === 'preview'`** — production is completely unaffected,
and `scheduled()` never goes through this check at all (crons are governed
solely by §6).

What it checks, failing closed (403) on any failure:

- **RS256 only** — `alg: 'none'`, `'HS256'`, etc. are all rejected.
- **JWKS** fetched from `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`,
  cached in-module keyed by team domain; an unrecognized `kid` triggers
  exactly one refetch (to pick up key rotation) before giving up — no
  unbounded retry loop.
- **`aud`** (string or array) must contain `ACCESS_AUD`; **`iss`** must be
  exactly `https://<ACCESS_TEAM_DOMAIN>`.
- **`exp` is required** — a token with no `exp` claim, or a non-numeric
  one, is rejected; a token that never expires isn't acceptable for a gate
  like this. **`nbf` is optional** — checked (with the same 60s skew) only
  when present, matching how the JWT spec itself treats it.
- **`email`** must case-insensitively match a hardcoded allowlist
  (`ACCESS_ALLOWED_EMAILS` in `cf/access-jwt.ts`: `rafa04128@gmail.com`,
  `rafaeser@gmail.com`) — this is on top of, not instead of, Access's own
  policy enforcement; belt-and-suspenders against a misconfigured Access
  application.
- If `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are unset, empty, **or still contain
  the literal string `REPLACE`** (i.e. still the `wrangler.jsonc`
  placeholder), verification fails closed with **no network call at all** —
  there's deliberately no way to "fail open" just because the real values
  haven't been filled in yet.

**No bypass header, token, or environment override exists or will be
added.** A valid Cloudflare Access JWT is the only way through. The real
`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` values come with the Access application
once it exists (Phase 2, §15) — until then `wrangler.jsonc`'s placeholders
keep Preview failing closed by construction, even if someone deploys it
early.

## 12. Client IP forwarding (SD-09)

Before forwarding a request to the container, `cf/worker-core.ts` builds a
**new** `Request` (the inbound one is never mutated) with any inbound
`X-Forwarded-For`/`X-Real-IP` headers deleted, then both set from
`CF-Connecting-IP` — the header Cloudflare itself sets at the edge, which a
client cannot spoof — when present. If `CF-Connecting-IP` is absent (should
never happen on real Cloudflare traffic; happens in tests), both headers
are simply left unset rather than forwarding a value nobody can vouch for.
This stops a client from spoofing its apparent IP to anything rate-limiting
or audit logging in the container might trust.

## 13. Deviations from the original plan

- **Access JWT check added**, reversing the original "nothing Access-aware"
  decision — see §11. This is the one substantive scope change in this
  revision; everything else is a hardening fix to code that was already
  planned.
- **`run_worker_first: true`** (not a path array) on `assets` in
  `wrangler.jsonc` — kept from the original plan. With an array, asset
  requests never reach the Worker, so it couldn't add security headers,
  404 missing `/assets/*` files, or (now) apply the Access JWT gate to
  asset requests in preview. Costs one Worker invocation per asset request
  in exchange for all three.
- **`frame-src 'none'`** in the derived CSP (`cf/http-rules.mjs`) — kept
  from the original plan. `vercel.json`'s `frame-src` only ever allowed
  `https://vercel.live`; removing that token per the CSP-derivation rule
  leaves no sources, and `'none'` is the literal equivalent (dropping the
  directive entirely would loosen it to `default-src 'self'`).

## 14. Base image pin (SD-07)

Both Dockerfile stages pin `node:22-slim` by digest
(`sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`,
a multi-arch index digest) rather than floating on the tag, so an upstream
tag move can't silently change what's running. Refresh instructions are in
the Dockerfile's header comment.

### Pre-cutover hardening (not done in this PR — tracked, not implemented)

- **Pre-auth semaphore / concurrency cap on expensive routes.** Not added.
  A single container instance (§1) handling unlimited concurrent heavy
  requests (image generation, bulk jobs) has no backpressure today beyond
  whatever the provider APIs themselves impose.
- **`waitUntil` concurrency cap.** Not added. `server.mjs`'s background
  tracking (§8) has no ceiling on how many promises can be in flight at
  once; a burst of long-running jobs could accumulate unboundedly in the
  `pending` set before a drain.
- **Tilopay webhook secret compare is a plain `!==`, not constant-time**
  (pre-existing finding, SD-08, not changed in this PR). `api/mcp-guide-
  analysis.ts`'s `CRON_SECRET` check already uses `timingSafeEqual`
  (`api/mcp-guide-analysis.ts`'s `safeEqual`) — the Tilopay webhook
  (`api/tilopay/webhook.ts`'s `secret !== WEBHOOK_SECRET`) should switch to
  the same pattern before cutover.

## 15. Cutover / retirement checklist

1. **Enable crons together, not separately.** Set `ENABLE_CRONS: "1"` and a
   **CF-only `CRON_SECRET`** (distinct from Vercel's) on the **prod** Worker
   in the same deploy/maintenance window as removing the `crons` block from
   `vercel.json` (§6). Never let both be live. Immediately after, rotate
   Vercel's own `CRON_SECRET` (it's no longer needed there, and a leaked old
   value shouldn't still work anywhere).
2. **Rotate `TILOPAY_WEBHOOK_SECRET`** after cutover, once Vercel is no
   longer the webhook target — the old value should stop working anywhere
   it might have leaked to.
3. **Record and compare the deployed image digest** against what was
   actually parity-tested locally — `wrangler.jsonc`'s `containers[].image:
   "./Dockerfile"` means `wrangler deploy` rebuilds rather than pulling a
   pinned digest, so this doesn't happen automatically. See the earlier
   "Local container evidence" note in §3 for why this matters.
4. **Add the Cloudflare preview Worker hostname** to Supabase Auth's
   "Additional Redirect URLs" before preview QA needs real auth flows
   (OAuth/magic-link/reset all redirect back to the app origin). At
   **preview retirement**, remove that redirect URL again, and **delete the
   Cloudflare Access application** for Preview — a dead redirect URL or a
   stale Access app with no corresponding Worker is a standing
   open-redirect-adjacent surface with no upside once nothing resolves
   there anymore.
5. Only after Supabase redirect URLs exist and the real
   `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` values are set (§11): flip
   `workers_dev` from `false` to `true` for Preview.

See `docs/operations/cloudflare-parity-checklist.md` for the full pass/fail
list this unlocks, and `scripts/parity/README.md` for the supporting
tooling.
