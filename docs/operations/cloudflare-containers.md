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
| `cf/container-env.mjs` (+ `.d.mts`) | `CONTAINER_ENV_KEYS` (names only, excludes `ADVANCE_RUNTIME` — round-6 item F), `getContainerEnvVars`. `cronsEnabled` moved out to `api/lib/crons-enabled.ts` (round-6 item E) — no longer exported from here. |
| `cf/access-jwt.ts` | Cloudflare Access JWT verification (`verifyAccessJwt`) for the preview-only gate (§11). WebCrypto only, no new dependency, no `cloudflare:*` import. |
| `cf/worker-core.ts` | Pure Worker logic (`handleFetch`, `handleScheduled`, `withSecurityHeaders`) — no `cloudflare:*` imports, so it's unit-testable with a fake container fetch. Also strips/replaces `X-Forwarded-For`/`X-Real-IP` with `CF-Connecting-IP` before forwarding to the container (§12). |
| `src/cf-container-worker.ts` | Thin Betsy-pattern wrapper: the `AdvanceAiContainer` class and the real Worker `fetch`/`scheduled` exports. Excluded from the root `tsconfig.json`; typechecked separately via `tsconfig.cf-worker.json` / `npm run typecheck:worker`. |
| `scripts/build-api.mjs` | esbuild, per file, `api/**/*.ts` → `dist-api/**/*.js` (ESM, types stripped only, `node_modules` external). Also emits `dist-api/_route-deadlines.json` (§8) — not routable (its name fails the API segment regex) — and copies non-TS runtime assets (`api/lib/adpack/render/fonts/**`, TTFs + OFL licenses) next to the compiled module so `new URL('./fonts/x.ttf', import.meta.url)` resolves. `npm run build:api`. |
| `wrangler.jsonc` | Worker + Container + cron + Static Assets config, with `env.preview` repeating every block explicitly. `env.preview.triggers.crons` is explicitly `[]` (§6); `env.preview.vars` carries the non-secret `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` placeholders (§11), which are Worker-only and never forwarded to the container. |
| `Dockerfile` / `.dockerignore` | Builds `dist/` + `dist-api/` and runs `server.mjs` on port 8080. Base image pinned by digest (§14). Runtime stage fails the build unless sharp, pdf-parse and `@resvg/resvg-js` (linux-x64-gnu) load and `scripts/adpack-render-smoke.mjs` renders one real Ad Pack PNG from `dist-api`. |
| `docs/operations/cloudflare-launch-checklist.md` | Step-by-step go-live (token, secrets, preview + Access, DNS cutover/rollback, crons, TiloPay, Vercel retirement). |
| `scripts/parity/*` | Read-only/local-only parity tooling — see `scripts/parity/README.md`. |
| `api/lib/app-env.ts` | `resolveAppEnv`/`isProductionAppEnv`/`isPreviewAppEnv` — `APP_ENV`, falling back to `VERCEL_ENV`. Imported directly by `cf/worker-core.ts` for the Access gate selector (§11, round-6 item A). |
| `api/lib/crons-enabled.ts` | The one shared `cronsEnabled` implementation (round-6 item E) — imported directly by `cf/worker-core.ts` (bundled into the Worker) and by `api/mcp-guide-analysis.ts` (compiled into `dist-api/lib/` for the container). |
| `api/lib/request-deadline.ts` | `getDeadlineSignal(req)` — reads the per-request `AbortSignal` `server.mjs` sets on deadline (§8, round-6 item C); `undefined` on Vercel. |

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
sequence above against the **current revision**, image
`sha256:81fb6224346b85108d71a01fb40e353eb60acf47a3f32fe72e9e5309820825f6`,
built from the pinned base
`node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`
(§14) — this run covers the round-6 operator-review items (A–J): the cron
guard still 503s even with `ADVANCE_RUNTIME=vercel` deliberately set on the
container (item F); the pre-auth gate against real routes with no Bearer
(item H); the raw-stream backpressure fix with zero
`MaxListenersExceededWarning` lines, including the 9.5 MiB case that
originally reproduced it (item D); the deadline abort signal and the
late-write-after-504 guard, both via real fixtures in the image (item C);
the in-flight body-bytes semaphore under a small injected cap (item H);
`/api/chat/`'s trailing slash routing (item H; the deadline-manifest value
itself is proven by vitest, not this smoke — see the checklist); and
`sharp`/`pdf-parse`/the Tilopay replay/`SIGTERM` drain, unchanged. The full
results are in `docs/operations/cloudflare-parity-checklist.md`.

The **previous** run, image
`sha256:08029107de5fa4c986c147b839d970139d5a534d43d40a5b7956c09d5c674aa1`,
covered the SD-01…SD-09 changes (`ENABLE_CRONS` fail-closed, including the
`/api/mcp-guide-analysis` 503-before-401 guard confirmed live, the
raw-stream cap via the delayed-reader fixture, `sharp`/`pdf-parse`, the
Tilopay replay, and a clean `SIGTERM` shutdown) and is superseded by the
current run above wherever the two overlap; it remains on record in the
checklist for the parts it covers that weren't repeated this round (the
actual background-job-draining proof for `waitUntil`, and the
security-headers/SPA/container-user checks).

The **oldest** run against commit `c42301b`, image
`sha256:a05d43e25efd6860b02bac70e976f6a406e08e82831ecaa4abf4a0ced1af1db1`,
predates all of the above and is superseded by both newer runs wherever
they overlap; it remains on record for the same reason the previous run
does.

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

**State this plainly, not just by implication: Preview holds the PROD
AIIAN Supabase service-role/secret key (`SUPABASE_SECRET_KEY`), because the
database is shared — there is no separate "Preview database."** Every
write Preview QA makes (chat generations, image generations, the credits
ledger, MCP intakes, Storage uploads) lands in the exact same `lstzfxsdmggkoaxfawny`
project prod reads from. This is a deliberate, already-made decision (see
`docs/operations/chat-shell-environments.md` and the "AIIAN" policy
referenced in AGENTS.md), not an oversight to fix here — but it means the
barriers below are load-bearing, not cosmetic:

- **Cloudflare Access (§11)** is the only thing standing between an
  anonymous internet request and a handler that can write to prod data.
- **The minimal secret set below** is the second barrier — every secret
  that would let Preview trigger a *irreversible or billable* side effect
  on infrastructure Preview shouldn't touch (a cron run, a real webhook
  write, a real ticket relay) is simply never configured there at all, so
  the corresponding handler fails closed by construction rather than by
  convention.
- **QA discipline is the third barrier, and it's a process control, not a
  technical one:** QA must touch only a dedicated test brand/user it
  created for this purpose, and must clean up (delete test rows/images) it
  creates afterward. Nothing in this PR enforces that technically — Access
  + the secret set stop Preview from reaching things it shouldn't; they do
  not stop a signed-in QA session from writing real-looking rows into the
  real database under a test identity.

Given all of that, Preview QA needs far fewer secrets than prod, and some
of prod's secrets must **never** be on Preview at all. Set only:

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

**Explicitly do NOT set on Preview — the full list:** `CRON_SECRET`,
`TILOPAY_WEBHOOK_SECRET`, `TICKETS_EVENT_WEBHOOK_URL`,
`TICKETS_WEBHOOK_SECRET`, `ENABLE_CRONS`, `ADVANCE_RUNTIME`. The first four
gate things that must not run against the shared AIIAN database from
Preview (webhook success-path writes, the cron worker, ticket relays) —
leaving them unset means the corresponding handlers fail closed (403/503)
rather than someone having to remember not to trigger them. The parity
checklist tags the specific checks this blocks as `[local signed fixture]`
— proven locally against the identical image with a locally generated test
secret and fixtures, never against Preview. `ENABLE_CRONS` is never a
secret but belongs on this list anyway: Preview's Worker never needs its
own live cron, and `env.preview.triggers.crons` being `[]` already makes
the point moot (§6). `ADVANCE_RUNTIME` isn't a `wrangler secret put` value
at all — it's set by `server.mjs`/the Dockerfile unconditionally on every
boot (round-6 operator review, item F) — listed here only so this is the
single place that enumerates every CF-runtime-only marker, not because
anyone could set it via Worker config even if they tried.

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

1. **Worker `scheduled()`:** `api/lib/crons-enabled.ts`'s `cronsEnabled(env)`
   (round-6 operator review, item E — the ONE shared implementation; see
   below) returns true **only** for the exact string `'1'` (after trim) —
   `undefined`, `''`, `'0'`, `' 1 '` (trims to `'1'` → true), `'1\n'` (same),
   `'true'`, `'TRUE'`, `'yes'`, `'01'`, `'1.0'` are all false except the two
   trim-to-`'1'` cases, with or without `APP_ENV=preview`. Neither
   `wrangler.jsonc` env block sets `ENABLE_CRONS` at all right now — it gets
   added, set to `"1"`, only at cutover (§15).
2. **`wrangler.jsonc` triggers:** `env.preview.triggers.crons` is
   explicitly `[]` (not inherited from the top-level `["* * * * *"]`) —
   Preview's Worker never even receives a scheduled event to evaluate.
   Belt-and-suspenders on top of (1).
3. **Handler-level guard:** `api/mcp-guide-analysis.ts` returns `503
   {"error":"Crons disabled on this runtime"}` when running on the CF
   container (`process.env.ADVANCE_RUNTIME === 'cloudflare-container'`,
   set only by `server.mjs`/the Dockerfile, **unconditionally** on every
   boot since round-6 operator review item F — never by Vercel) **and**
   the SAME `cronsEnabled(process.env)` from (1) is false — not a second,
   independent `!== '1'` string comparison, which (before this round)
   disagreed with (1) on inputs like `' 1 '`/`'1\n'` that trim down to
   `'1'`. This means even a direct `curl` to the container's
   `/api/mcp-guide-analysis` with a stolen/leaked `CRON_SECRET` can't run
   the worker while crons are disabled — the gate doesn't depend on the
   Worker's routing at all. The Vercel path (no `ADVANCE_RUNTIME`) is
   completely unaffected: same `authorizeCron()` check as before, same
   200/401 behavior.

**One shared implementation, not two (round-6 operator review, item E).**
`api/lib/crons-enabled.ts` is the only place this trim-and-exact-match
logic lives. It's imported directly by `cf/worker-core.ts` (bundled into
the Worker by wrangler) and by `api/mcp-guide-analysis.ts` (compiled into
`dist-api/lib/crons-enabled.js` by `scripts/build-api.mjs`, since the
Dockerfile runtime stage never copies `cf/*`). `cf/container-env.mjs` no
longer exports its own `cronsEnabled` at all — it was removed rather than
kept as a thin re-export, because `cf/container-env.mjs` is loaded by
plain, unbundled Node in `scripts/parity/env-diff.mjs`, which can't resolve
an extensionless import of a `.ts` file the way the Worker bundle and
vitest's transform both can.

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
- **Global in-flight body-bytes semaphore (round-6 operator review, item
  H).** A single container instance (§1) handling many concurrent uploads
  previously had no aggregate backpressure beyond each request's own
  per-route limit. `server.mjs` now tracks total bytes committed to
  in-flight request bodies — parsed and raw-stream alike — across ALL
  concurrent requests, capped at `MAX_INFLIGHT_BODY_BYTES` (default 256
  MiB, env-overridable). A known `Content-Length` reserves its declared
  size upfront; a chunked body (no `Content-Length`) reserves
  incrementally as chunks arrive. Either way, a reservation that would
  exceed the cap gets `503 {"error":"Server busy"}` instead of being read;
  the reservation releases exactly once — on the body finishing, erroring,
  or the connection closing — never leaked and never double-released.
- **Pre-auth gate on large bodies (round-6 operator review, item H).** For
  any route configured above the default 4.5 MiB limit (the raw-stream
  10 MiB cap, or a `sizeLimit` like `'10mb'`/`'25mb'`), once the actual or
  declared body size crosses 4.5 MiB, the adapter requires an
  `Authorization: Bearer <something>` header to be **present** (shape
  only — the adapter never validates the token; the handler's own auth
  check still runs normally afterward) before reading further. No header
  → `401 {"error":"Missing authorization"}`, without draining the rest of
  a large unauthenticated upload first. A small body on the same route, or
  a large body WITH the header, is unaffected.
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
shipped in the runtime image) — keyed by route with no trailing slash
(round-6 operator review, item H: a request to `/api/chat/`, trailing
slash included, is normalized before this lookup too, or it silently fell
back to the 300s default instead of chat's real 120s). A route with
neither gets **300s**, Vercel's Fluid-compute platform default. When a
deadline elapses with no response sent yet, the adapter responds
`504 {"error":"Gateway Timeout"}` itself — but it does **not** abort the
handler: the handler keeps running (and any `waitUntil` work it already
scheduled keeps running to completion independent of the request/response).

**After a 504, every further write from the handler is a safe no-op
(round-6 operator review, item C — extended, not just the original
write/end guard).** `res.write`/`res.end` already no-op once the response
is `writableEnded`; this revision extends the same idea to
`res.setHeader`/`res.writeHead`/`res.removeHeader`/`res.appendHeader` (Node
throws `ERR_HTTP_HEADERS_SENT` on these specifically, unlike write/end,
which Node itself already tolerates) and to `res.json`/`res.send`/
`res.redirect` (which now check `res.headersSent` — or an internal
`timedOut` flag, covering the vanishingly narrow window between the
deadline firing and headers actually flipping to sent — and short-circuit
before attempting anything). None of this applies to a still-open,
not-yet-timed-out response: `res.write` mid-SSE-stream (`api/chat.ts`
today doesn't stream, but the guard doesn't special-case any route) keeps
working exactly as before.

**A per-request `AbortSignal`, exposed via `api/lib/request-deadline.ts`'s
`getDeadlineSignal(req)` (round-6 operator review, item C).** Aborted ONLY
when the deadline fires, never on a normal finish/close. Vercel never sets
the underlying property, so `getDeadlineSignal` returns `undefined` there
and every caller's behavior is unchanged. Wired into the handlers whose
charge/write points were straightforward to find and gate:

- `api/chat.ts` — checked right before `logApiUsage`/`incrementUsage`,
  once after the structured-pipeline branch and once after the plain Grok
  call; both charges happen strictly *after* the (potentially long) AI
  call, so skipping them on abort never needs a refund.
- `api/generate-carousel.ts` — checked once, before the per-slide
  `incrementUsage` loop; same "charge happens after the work" shape.
- `api/bulk-posts.ts` / `api/bulk-campaign.ts` / `api/bulk-scripts.ts` —
  the signal is passed into `runBulkScripts`/`runBulkPosts`
  (`api/lib/bulk/run-bulk.ts`), which check it at the TOP of each
  per-angle loop iteration, before that item's own `checkUsageLimit`/
  generate/charge. Stopping there never needs a refund either: every item
  already pushed into the result stayed fully charged, and the handlers'
  existing partial-success response shape already covers "fewer items
  than requested" for other reasons.
- `api/mcp-guide-analysis.ts` → `processNextMcpUrlIntake` — see §9 below.

**Deliberately NOT wired, and why (this is the "skip it, document it"
case the task explicitly allows):** `api/mcp.ts`'s MCP `execute_*` jobs and
`api/generate-image.ts`'s chat-shell image jobs both do their real work
inside `waitUntil`, whose lifecycle is already independent of the
request/response (that's the whole point of `waitUntil` — see above). The
deadline firing on the *request* doesn't mean the *background job* should
stop; wiring the request's `AbortSignal` into waitUntil'd work would
conflate two different lifecycles for no benefit. These two keep their
existing `.catch`-based safety net and nothing else.

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

## 9. Guide-analysis lock-safety — now lease-guarded (SD-06), extended one step earlier (round-6 operator review, item G)

`processNextMcpUrlIntake` claims a row via the `claim_mcp_url_intake` RPC
(`supabase/migrations/072…sql`) using `FOR UPDATE SKIP LOCKED LIMIT 1` plus a
stale reclaim after `greatest(300s, 60s)`. Two concurrent runners therefore
claim *different* pending rows, never the same one — that part was already
safe. What SD-06 fixed: the final `ready`/`failed`/`pending_analysis`
update used to be keyed only by `id`, with no check that this runner still
held the lease. On Vercel, `maxDuration: 60` bounded a run short enough that
this rarely mattered; the container has no such kill (§8), so a run that
somehow took longer than the stale-reclaim window could have had its row
reclaimed by a second runner and then had its *own*, now-stale write
clobber the second runner's in-flight work. Both the success and failure
updates add `.eq('status', 'processing').eq('claimed_at',
row.claimed_at)` — if a stale-reclaim has since moved `claimed_at`, the
update matches zero rows instead of overwriting newer work.

**This round closes the same gap one step earlier and makes "zero rows" an
observable outcome, not an inferred one.** Three additions:

1. A **lease recheck right before the brand-kit write** (the `businesses`/
   `brand_kits` update/insert), not just before the final status update —
   `runSiteAnalysis` can itself run long; if a stale-reclaim happened
   *during* that call, writing the kit afterward without rechecking would
   race the second runner's in-flight work the same way the final-update
   bug used to.
2. **`.select('id')` on both the success and failure updates**, so a
   zero-row match (lease lost) is read from the actual response instead of
   assumed never to happen — and `logApiUsage` is now skipped in that
   case, rather than logging a usage event for a write that never landed.
3. An **optional deadline `AbortSignal`** (`api/lib/request-deadline.ts`,
   §8), checked at the same two points above — a timed-out run stops
   cleanly (no kit write, no final update, no usage log) rather than
   racing a write the client can no longer see the result of.

Any of these three stopping early leaves the row exactly where a crash
would have left it — `status='processing'`, original `claimed_at` — so the
existing stale-reclaim window is what picks it back up, not this function
retrying internally. See `test/mcp-url-analysis-lease.spec.ts` — a mocked
Supabase client, not a real database (the parity checklist tags this
`[unit (mocked)]`, with a real-DB concurrent-runner check still PENDING).

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

## 11. Cloudflare Access JWT gate (SD-03 — decision reversed: ADD; selector + JWKS caching hardened, round-6 operator review, items A/B)

An earlier pass of this work deliberately left Access-awareness out of the
code ("nothing here validates `Cf-Access-Jwt-Assertion`"). SecureDog's
review reversed that decision: Preview needs an **actual** gate in front of
it, not just a plan to put Cloudflare Access in front of it later with no
verification on this side. `cf/access-jwt.ts` now verifies the
`Cf-Access-Jwt-Assertion` header **in the Worker**, before routing.

**Gate selector, inverted (item A).** The original selector enforced
**only when `env.APP_ENV === 'preview'` exactly** — which fails **open**
for every other value: unset, a typo, a future staging-like env name
nobody anticipated here would all have skipped the gate silently. It now
enforces on **every env except production** —
`!isProductionAppEnv({ APP_ENV: env.APP_ENV })`, the exact same
trim+lowercase normalization `api/lib/app-env.ts` already uses elsewhere,
imported directly rather than re-implemented as a second string
comparison. Production remains completely unaffected (no header required,
no network call attempted at all), and `scheduled()` never goes through
this check regardless of env (crons are governed solely by §6).

What it checks, failing closed (403) on any failure:

- **RS256 only** — `alg: 'none'`, `'HS256'`, etc. are all rejected.
- **JWKS**, fetched from `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`
  and cached in-module keyed by team domain, hardened in this round (item
  B):
  - Cached keys carry a **~1 hour TTL** — even a previously-known `kid`
    triggers a refetch once that elapses, not only on a cache miss.
  - An unrecognized `kid` is throttled to **at most one refetch attempt
    per team domain per 60 seconds** — a negative cache, not a retry
    budget. A flood of requests with a bogus or not-yet-rotated-in `kid`
    causes one fetch, not one per request.
  - Concurrent misses on the same uncached `kid` share **one in-flight
    fetch promise** instead of each starting their own.
  - All of the above timing goes through the injectable `deps.now` (a
    test-only cache-reset export, `__resetJwksCacheForTests`, also
    exists, documented in the file).
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

- **`waitUntil` concurrency cap.** Still not added. `server.mjs`'s
  background tracking (§8) has no ceiling on how many promises can be in
  flight at once; a burst of long-running jobs could accumulate
  unboundedly in the `pending` set before a drain. (Item H's semaphore —
  see §7 — bounds in-flight REQUEST BODY bytes, not in-flight background
  job count — a different resource, not a substitute for this. The
  pre-auth semaphore / concurrency cap that used to be listed here is
  **done**, not pending — round-6 operator review, item H.)
- **Tilopay webhook secret compare is a plain `!==`, not constant-time**
  (pre-existing finding, SD-08, still not changed in this PR).
  `api/mcp-guide-analysis.ts`'s `CRON_SECRET` check already uses
  `timingSafeEqual` (`api/mcp-guide-analysis.ts`'s `safeEqual`) — the
  Tilopay webhook (`api/tilopay/webhook.ts`'s `secret !== WEBHOOK_SECRET`)
  should switch to the same pattern before cutover.
- **Deadline `AbortSignal` deliberately not wired into `api/mcp.ts` or
  `api/generate-image.ts` (round-6 operator review, item C — see §8 for
  the full reasoning).** Both do their real work inside `waitUntil`, a
  lifecycle that's already independent of the request/response; wiring
  the request's abort signal into background work would conflate two
  different lifecycles. Not a gap to close before cutover — a deliberate
  scope boundary, listed here so it's not mistaken for an oversight. **Note
  this doesn't make them unsafe on their own**: like every handler that
  doesn't check the signal at all (not just these two), §8's general
  guarantee still applies — the adapter's deadline never aborts a handler,
  it only stops waiting for one. A handler with no signal check simply
  keeps running to completion after a 504 has already gone out, exactly as
  it would if the signal didn't exist — it just can't skip its own
  charge/write in that case, which is the whole reason items C/G wire the
  signal into the handlers where that charge/write point was easy to find
  and gate (§8's list) rather than wiring it everywhere by default.
- **Lease-lost / deadline-exceeded early exits in
  `processNextMcpUrlIntake` (§9) are only proven against a mocked
  Supabase client.** A real two-runner race against the shared AIIAN
  database has never been exercised (and can't be, safely, outside
  Preview). Needs a real-DB check once Preview exists.

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
