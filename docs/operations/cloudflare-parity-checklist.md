# Cloudflare parity checklist

**PENDING PREVIEW** — nothing in this document was run against a live
Cloudflare Preview deployment. Status defaults to **PENDING** for every
item. Two different kinds of "proven" appear below, and they are not the
same claim:

- **PASS (local)** — proven by a test in this PR's `test/` directory,
  running against `server.mjs` directly (no Docker), cited by file.
- **PASS (local container)** — proven by actually running the built Docker
  image (see "Local container run" box right below) and recording the real
  HTTP/exec results, cited to
  `/workspace/reports/advance-cf/logs/container-smoke.log`. Stronger than
  **PASS (local)** (it's the real image, not just the adapter source), but
  still not proof of Preview parity — see that box for why.

There will **never** be an Access service token or bypass in this codebase
(see §2 of `docs/operations/cloudflare-containers.md`) — anything tagged
`[needs browser session behind Access]` is a human, in a browser, doing it
by hand once Cloudflare Access is in front of the Preview environment.

Tags, exactly one per item:

- `[verified locally]` — proven today by **real code against real HTTP**:
  a test that spins up the actual `server.mjs` (via `startAdapter`) and
  makes real requests against it (`test/cf-server-adapter.spec.ts`,
  `test/cf-server-lifecycle.spec.ts`, `test/cf-api-build.spec.ts`), or a
  pure function/data check with no mocks at all (reading real compiled
  output, real `wrangler.jsonc`, scanning real source). Narrower than it
  used to read here (round-6 operator review, item I) — see
  `[unit (mocked)]` below for the tests that don't meet this bar.
- `[unit (mocked)]` — a vitest test against mocked `req`/`res`, a mocked
  Supabase client, a stubbed JWKS fetch, or a fake Worker binding
  (`ASSETS`/container `fetch`, both `vi.fn()`). Real assertions on real
  logic, but never a real HTTP round trip and never a real external
  dependency — weaker evidence than `[verified locally]`, and every row
  below that carries it also says what's still open because of that gap.
- `[local, identical image]` — must be re-run against the *same Docker image
  digest* as the Preview deployment (`docker build` once, deploy that
  digest, then run the same script/test against `docker run` of that
  digest) before it counts as proven for that image.
- `[needs browser session behind Access]` — crosses Cloudflare Access; a
  human does this in a browser. No automation, token, or bypass will be
  added for this.
- `[local signed fixture]` — proven locally against the identical Docker
  image using a locally generated test secret and fixtures — e.g. a
  throwaway `CRON_SECRET`/`TILOPAY_WEBHOOK_SECRET` set only for that one
  `docker run`, never a real one. This is distinct from `[local, identical
  image]`: these specific secrets are never set on Preview at all (SD-05,
  `docs/operations/cloudflare-containers.md` §4b — not "not yet filled in,"
  *by design*), so the thing being proven can **never** be exercised
  against Preview, only against a local instance of the identical image.

## Local container runs (operator, 2026-10-06: current revision = round-6 operator-review smoke; superseded runs kept below for the record)

**A current-revision run now exists, covering the round-6 operator-review
items (A–J).** The run below (image `81fb6224…`) supersedes the previous
round's run (image `08029107…`, now the "previous" run, kept for the
record) wherever the two overlap; `08029107…` itself superseded the
oldest run (image `a05d43e…`, commit `c42301b`, still kept for the record
below that). None of the three predates the pinned base digest
(`node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`),
which has been stable across all of them.

- **Build:** `sudo docker build --platform linux/amd64 -t advance-ai:r6 .`
  from the same pinned base
  `node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`.
- **Image ID (current revision, round-6 operator review):** `sha256:81fb6224346b85108d71a01fb40e353eb60acf47a3f32fe72e9e5309820825f6`
- **Image ID (previous run, round-5/SD-01…SD-09, kept for the record):** `sha256:08029107de5fa4c986c147b839d970139d5a534d43d40a5b7956c09d5c674aa1`
- **Image ID (oldest run, pre-SD-01…SD-09, kept for the record):** `sha256:a05d43e25efd6860b02bac70e976f6a406e08e82831ecaa4abf4a0ced1af1db1`
- **Run flags (current revision):** the main container was started with
  `-e APP_ENV=preview -e ADVANCE_RUNTIME=vercel` (**no secrets of any
  kind**) — a deliberate adversarial flag, not an oversight: it's evidence
  for item F (server.mjs stamps `ADVANCE_RUNTIME=cloudflare-container`
  unconditionally on boot, so a Worker-forwarded or otherwise-set env
  value can't spoof the cron guard off) — the cron guard still returned
  503 with this flag set (see §2 below). Bound to `127.0.0.1` only.
  Operator harness: `/workspace/reports/advance-cf/smoke/container-smoke-r6.sh`
  + `semaphore-hold.mjs` + `route-sweep.mjs`.
- **Evidence logs (operator-only, not in this repo):**
  - Current revision (`81fb6224…`):
    `/workspace/reports/advance-cf/logs/r6/container-smoke.log`.
  - Previous run (`08029107…`):
    `/workspace/reports/advance-cf/logs/r5/container-smoke.log` and
    `/workspace/reports/advance-cf/logs/r5/container-sweep.log`.
  - Oldest run (`a05d43e…`, commit `c42301b`):
    `/workspace/reports/advance-cf/logs/container-smoke.log`, produced by
    `/workspace/reports/advance-cf/smoke/container-smoke.sh` +
    `route-sweep.mjs`.

## 1. Every `/api/*` route

Generated from code by `scripts/parity/route-table.mjs`. Plain route/method/
body-limit table: `npm run parity:routes` →
`docs/operations/cloudflare-route-table.md`. The checklist table below
(adds Auth, Expected, CF result, Tag) is generated the same way —
`npm run parity:checklist` rewrites everything between the BEGIN/END
markers in this file from the current `api/**/*.ts` source. **Do not hand-
edit between the markers** — the next `npm run parity:checklist` would
overwrite it anyway. Auth detection is explained in
`scripts/parity/route-table.mjs`'s `detectAuth`/`AUTH_OVERRIDES` comments;
three routes (`/api/mcp-oauth-metadata`, `/api/mcp`, `/api/ticket-events`)
are hardcoded there because their real behavior was verified by reading the
handler, not by a generic regex.

CF result is always `PENDING` here — this script never runs against a live
container. `[local, identical image]` rows are the ones whose
unauthenticated/wrong-method behavior (401/403/405, no DB write) is the
thing worth checking, and that can be fully exercised against the container
with no secrets. `[needs browser session behind Access]` rows need a real
signed-in (and for 4 of them, admin) user to see the 200 path, which means a
human in a browser once Preview is behind Access.

<!-- BEGIN route-table-checklist (generated by scripts/parity/route-table.mjs --checklist; do not hand-edit) -->

| Route | Methods | Auth (detected) | Body parser | Vercel maxDuration | waitUntil | Expected (Vercel prod) | CF result | Tag |
|---|---|---|---|---|---|---|---|---|
| `/api/ad-pack` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 120 | yes | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/admin-billing` | GET, OPTIONS | admin JWT (401 unauth, 403 non-admin) | default (4.5mb) | default | no | 401 unauth; 403 non-admin; 200 JSON for an admin user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/admin-image-performance` | GET, OPTIONS | admin JWT (401 unauth, 403 non-admin) | default (4.5mb) | 60 | no | 401 unauth; 403 non-admin; 200 JSON for an admin user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/admin-referrals` | GET, OPTIONS | admin JWT (401 unauth, 403 non-admin) | default (4.5mb) | default | no | 401 unauth; 403 non-admin; 200 JSON for an admin user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/admin-usage` | GET, OPTIONS | admin JWT (401 unauth, 403 non-admin) | default (4.5mb) | 60 | no | 401 unauth; 403 non-admin; 200 JSON for an admin user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/analyze-site` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 60 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/analyze-style` | OPTIONS, POST | user JWT (401 without) | 25mb | 60 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/auto-fill` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/brand-kit` | GET, OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/bulk-angles` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 60 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/bulk-campaign` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 300 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/bulk-posts` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 300 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/bulk-scripts` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 180 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/chat-shell-open` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/chat` | POST | user JWT (401 without) | default (4.5mb) | 120 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/edit-script` | POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/ensure-image-bucket` | POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/extract-brand` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 30 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/extract-pdf` | OPTIONS, POST | user JWT (401 without) | 10mb | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/fetch-image` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 30 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/fetch-url` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/generate-carousel` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 240 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/generate-image` | GET, OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 180 | yes | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/mcp-approve` | GET, OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/mcp-guide-analysis` | GET, POST | CRON_SECRET bearer (401 without) | default (4.5mb) | 60 | no | 401 unauth; 200 JSON with Authorization: Bearer <CRON_SECRET>; non-matching method -> 405 | PENDING | [local, identical image] |
| `/api/mcp-oauth-metadata` | ANY | public (no auth) | default (4.5mb) | default | no | 200 JSON, no auth required | PENDING | [local, identical image] |
| `/api/mcp` | GET, OPTIONS, POST | mcp OAuth bearer (401 + WWW-Authenticate) | default (4.5mb) | 180 | yes | 401 + WWW-Authenticate unauth; 200 JSON-RPC with a valid Supabase bearer; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/my-usage` | GET, OPTIONS | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/ocr-image` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/parse-pdf` | OPTIONS, POST | user JWT (401 without) | false (raw stream) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/reflect-memory` | POST | user JWT (401 without) | default (4.5mb) | 30 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/reply-chat` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/streamline-script` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/synthesize-memory` | POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/ticket-events` | GET, OPTIONS, POST | mixed (see handler): GET = webhook bearer secret or admin JWT; POST = user JWT | default (4.5mb) | default | no | see handler; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/tilopay/confirm-boost` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/tilopay/create-checkout` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | default | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |
| `/api/tilopay/webhook` | GET, POST | query secret (403 without) | default (4.5mb) | default | no | 403 missing/wrong ?secret=; 200 (writes DB) with the real secret; non-matching method -> 405 | PENDING | [local, identical image] |
| `/api/transcribe-audio` | OPTIONS, POST | user JWT (401 without) | default (4.5mb) | 30 | no | 401 unauth; 200 JSON for a signed-in user; non-matching method -> 405 | PENDING | [needs browser session behind Access] |

<!-- END route-table-checklist -->

### Local container sweep (no auth, no secrets) — operator, 2026-10-06

Copied from
`/workspace/reports/advance-cf/logs/r6/container-smoke.log`'s route sweep
(`route-sweep.mjs`) against the **current-revision** image
`sha256:81fb6224346b85108d71a01fb40e353eb60acf47a3f32fe72e9e5309820825f6`,
container run with **no secrets at all**, `APP_ENV=preview`,
`ADVANCE_RUNTIME=vercel` (deliberately, item F — see the "Local container
runs" box above), `ENABLE_CRONS` unset. "Unauth request" is the method the
sweep actually sent with no `Authorization` header; "PUT status" is the
same route hit with `PUT` (also unauthenticated). The round-6 sweep is
**row-for-row identical** to the previous run's sweep (image `08029107…`,
`/workspace/reports/advance-cf/logs/r5/container-sweep.log`) — nothing in
this table changed between rounds, including `/api/mcp-guide-analysis`
still reading 503 despite `ADVANCE_RUNTIME=vercel` being set this time.
(That previous sweep in turn superseded the oldest one against image
`a05d43e…`, which predates SD-01's CF-runtime gate.)

| Route | Unauth request | Status | Body (first 80 chars) | PUT status |
|---|---|---|---|---|
| `/api/admin-billing` | GET | 401 | `{"error":"Missing authorization"}` | 405 |
| `/api/admin-image-performance` | GET | 401 | `{"error":"Missing authorization"}` | 405 |
| `/api/admin-referrals` | GET | 401 | `{"error":"Missing authorization"}` | 405 |
| `/api/admin-usage` | GET | 401 | `{"error":"Missing authorization"}` | 405 |
| `/api/analyze-site` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/analyze-style` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/auto-fill` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/brand-kit` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 401 |
| `/api/bulk-angles` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/bulk-campaign` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/bulk-posts` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/bulk-scripts` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/chat-shell-open` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/chat` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/edit-script` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/ensure-image-bucket` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/extract-brand` | POST | 401 | `{"error":"Missing authorization"}` | 405 |
| `/api/extract-pdf` | POST | 401 | `{"error":"Missing authorization"}` | 405 |
| `/api/fetch-image` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/fetch-url` | POST | 401 | `{"error":"Missing authorization"}` | 405 |
| `/api/generate-carousel` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/generate-image` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 401 |
| `/api/mcp-approve` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 401 |
| `/api/mcp-guide-analysis` | POST | 503 | `{"error":"Crons disabled on this runtime"}` | 405 |
| `/api/mcp-oauth-metadata` | GET | 200 | `{"resource":"https://advanceai.studio/api/mcp","authorization_servers":[],"scope` | 200 |
| `/api/mcp` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/my-usage` | GET | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/ocr-image` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/parse-pdf` | POST | 401 | `{"error":"Missing authorization"}` | 405 |
| `/api/reflect-memory` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/reply-chat` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/streamline-script` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/synthesize-memory` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |
| `/api/ticket-events` | POST | 500 | `{"error":"Server configuration error"}` | 500 |
| `/api/tilopay/confirm-boost` | POST | 500 | `{"error":"Server not configured"}` | 405 |
| `/api/tilopay/create-checkout` | POST | 500 | `{"error":"Server not configured. Missing SUPABASE_URL or SUPABASE_SECRET_KEY"}` | 405 |
| `/api/tilopay/webhook` | POST | 403 | `{"error":"Forbidden"}` | 405 |
| `/api/transcribe-audio` | POST | 401 | `{"error":"Missing or invalid Authorization header"}` | 405 |

**`/api/mcp-guide-analysis` now 503, not 401 — confirmed in the real image,
by design.** Against the oldest image this row read `401
{"error":"Unauthorized"}` (the plain `authorizeCron()` check). Against
image `08029107…` it reads `503 {"error":"Crons disabled on this
runtime"}` — SD-01's CF-runtime handler guard (§2 below) runs *before* the
auth check and fires first, since `ENABLE_CRONS` is unset in this run. This
is the intended fail-closed behavior, not a regression. **Re-confirmed on
the current-revision image (`81fb6224…`), this time with
`ADVANCE_RUNTIME=vercel` deliberately set on the container (item F) — still
503**, which is the stronger claim (see §2). **PASS (local container)**,
`[local, identical image]`, images `08029107…` and `81fb6224…`
(`/workspace/reports/advance-cf/logs/r6/container-smoke.log`, "route
sweep").

**PASS (local container)**, `[local, identical image]`, images
`08029107…` and `81fb6224…` (the round-6 sweep is row-for-row identical —
see the "Local container sweep" section above), for the
unauthenticated/wrong-method shape of every row: **34 of 38**
routes return 401 or 403 or 503 before any DB access (32 × 401, 1 × 503 for
`/api/mcp-guide-analysis`, plus `/api/tilopay/webhook`'s 403 from its
query-secret check); `/api/mcp-oauth-metadata` returns 200 (it's the public
OAuth discovery endpoint, by design — no auth to fail). **3 routes return
500** instead — `/api/ticket-events`, `/api/tilopay/confirm-boost`,
`/api/tilopay/create-checkout` — because their handlers check Supabase
configuration *before* checking auth, and this container had zero secrets
configured at all (not even `SUPABASE_URL`). That's a property of this
specific no-secrets smoke run, not a bug: the same three handlers would
500 the same way on Vercel if `SUPABASE_URL`/`SUPABASE_SECRET_KEY` were
unset there too. These three need a re-run with real preview secrets to
actually prove their 401/200 paths — either behind Access (browser
session) or locally with secrets injected.

PUT gives 405 on every route except five, and in every case that's existing
handler behavior, unchanged by the move off Vercel — the same handler code
ran on Vercel and would show the exact same quirks: `/api/brand-kit`,
`/api/generate-image`, and `/api/mcp-approve` return 401 instead of 405
because they check auth *before* checking method, so an unauthenticated PUT
still fails on auth first; `/api/ticket-events` returns 500 for the same
config-before-everything reason as above; `/api/mcp-oauth-metadata` returns
200 because it never inspects the method at all.

Status: **PENDING** for every row in the generated table above (as
generated) beyond what the local container sweep covers (unauthenticated
shape only). See item 5 for the body-limit sub-checks and item 7 for the
Tilopay webhook sub-checks, which apply to specific rows above.

## 2. Cron: every-minute fire, fail-closed `ENABLE_CRONS`, single writer, lock-safety (SD-01, was High)

SecureDog failed this High on the first cut: the original gate
(`DISABLE_CRONS`) used a loose truthy check, so a typo'd or mis-cased value
could leave it open. It's now fail-closed in three independent layers (see
`docs/operations/cloudflare-containers.md` §6 for the full writeup):

- **Worker `scheduled()` gate.** `cronsEnabled(env)` (now `api/lib/crons-enabled.ts`,
  the single shared implementation — round-6 operator review, item E) returns
  true **only** for the exact string `'1'` — the pure-function truth table
  (`undefined`, `''`, `'0'`, `' 1 '`, `'1\n'`, `'true'`, `'TRUE'`, `'yes'`,
  `'01'`, `'1.0'`) is **PASS (local)**, `test/cf-worker-core.spec.ts`
  (`cronsEnabled (fail closed)` describe block, importing directly from
  `api/lib/crons-enabled.ts`) — no mocks, pure string logic.
  `[verified locally]`. The
  `handleScheduled` truth table layered on top of it (same input values;
  only `'1'` gives exactly 1 call with the right `Authorization: Bearer
  <CRON_SECRET>` header; `'1'` with `CRON_SECRET` unset rejects with 0
  calls) is `test/cf-worker-core.spec.ts`'s `handleScheduled` describe
  block — but that test injects a fake container fetch (`vi.fn()`), not a
  real one, so (round-6 operator review, item I: this was previously
  mis-tagged `[verified locally]`) it's `[unit (mocked)]` — real logic,
  real assertions, but never a real HTTP round trip to a real container.
- **`wrangler.jsonc` triggers.** `env.preview.triggers.crons` is explicitly
  `[]`, not inherited from the top-level `["* * * * *"]`, and neither env
  block sets `ENABLE_CRONS` at all (it's added only at cutover) —
  **PASS (local)**, `test/cf-worker-core.spec.ts` (`wrangler.jsonc`
  describe block: the "no env sets ENABLE_CRONS or DISABLE_CRONS" and
  "env.preview.triggers.crons is explicitly empty" cases). `[verified
  locally]`
- **Handler-level guard.** `api/mcp-guide-analysis.ts` returns `503
  {"error":"Crons disabled on this runtime"}` when
  `process.env.ADVANCE_RUNTIME === 'cloudflare-container'` (set only by
  `server.mjs`/the Dockerfile, never Vercel) and the shared
  `cronsEnabled(process.env)` (round-6 operator review, item E — this
  handler no longer has its own separate `!== '1'` comparison) is false.
  Two different kinds of test back this, and they're tagged differently
  (round-6 operator review, item I — this bullet previously lumped both
  under one `[verified locally]` tag):
  - `test/mcp-guide-analysis-auth.spec.ts` ("CF container runtime gate
    (SD-01)" block, plus the full `cronsEnabled` truth table: no marker +
    Bearer + `x-vercel-cron` → 200 exactly as before; no marker + Bearer
    only → 200; CF marker with `ENABLE_CRONS` unset/`''`/`'0'`/`'true'`/
    `'TRUE'`/`'yes'`/`'01'`/`'1.0'` → 503, worker never called; CF marker
    with `ENABLE_CRONS=' 1 '`/`'1\n'` (trims to `'1'`) → 200, worker called,
    matching the Worker-side truth table; CF marker + `ENABLE_CRONS='1'` +
    valid Bearer → 200; CF marker + `ENABLE_CRONS='1'` + bad Bearer → 401)
    calls the handler directly against **mocked `req`/`res`** objects (a
    plain object literal, not a real HTTP request) — `[unit (mocked)]`.
  - `test/cf-api-build.spec.ts` (the same gate through the real compiled
    handler, via the real `server.mjs` started by `startAdapter` and a real
    `fetch()`: 503 without `ENABLE_CRONS`, 401 unauth / 200
    `db_unavailable` with `ENABLE_CRONS=1`, and 503 even when the adapter's
    own env carries `ADVANCE_RUNTIME=vercel` — item F's unconditional
    stamp) is real code against real HTTP — `[verified locally]`.
  Confirmed again against the previous round's real built image
  (`sha256:08029107de5fa4c986c147b839d970139d5a534d43d40a5b7956c09d5c674aa1`):
  both a plain unauthenticated request and a bogus `Bearer` + `x-vercel-cron`
  request return `503 {"error":"Crons disabled on this runtime"}` with
  `ENABLE_CRONS` unset, and the route sweep shows the same 503 (not the
  older image's 401) for `/api/mcp-guide-analysis`. **PASS (local
  container)**,
  `/workspace/reports/advance-cf/logs/r5/container-smoke.log` ("CF cron
  guard") and
  `/workspace/reports/advance-cf/logs/r5/container-sweep.log` ("route
  sweep"). `[local, identical image]`.
  **Round-6 operator review, item F — confirmed with an adversarial flag,
  not just absence of one.** The current-revision image
  (`sha256:81fb6224346b85108d71a01fb40e353eb60acf47a3f32fe72e9e5309820825f6`)
  was started with `-e ADVANCE_RUNTIME=vercel` set on the main container
  (deliberately, to try to spoof the marker) — the cron guard still
  returned `503 {"error":"Crons disabled on this runtime"}` for both the
  plain unauthenticated request and the bogus `Bearer` + `x-vercel-cron`
  request, proving `server.mjs` really does overwrite whatever
  `ADVANCE_RUNTIME` value it's started with rather than only setting it
  when unset. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("container
  started with -e ADVANCE_RUNTIME=vercel", "CF cron guard"). `[local,
  identical image]`. The
  remaining `ENABLE_CRONS='1'` + valid-secret 200 path still needs a
  locally generated test `CRON_SECRET` (never a real one — Preview never
  gets `CRON_SECRET` at all, `docs/operations/cloudflare-containers.md`
  §4b): Status **PENDING**, `[local signed fixture]`.
- **Never two writers.** `vercel.json`'s own `crons` block stays untouched
  (so Vercel's cron keeps firing exactly as before) — proven by
  `git diff --exit-code -- vercel.json` (one of this PR's DONE CHECKS)
  being empty, not by a vitest test. At cutover, `ENABLE_CRONS: "1"` plus a
  CF-only `CRON_SECRET` go on the prod Worker in the **same window** as
  removing `vercel.json`'s `crons` block — see "Cutover checklist
  additions" below.
- **Lock-safety — fixed, not just reported (SD-06), and extended one step
  earlier (round-6 operator review, item G).** `claim_mcp_url_intake` uses
  `FOR UPDATE SKIP LOCKED LIMIT 1` plus a stale reclaim after
  `greatest(300s, 60s)` (`supabase/migrations/072…sql`) — two concurrent
  runners claim *different* pending rows, never the same one; that part
  was already safe. What used to be a reported-only residual risk — the
  final `ready`/`failed` update being keyed only by `id`, with no lease
  check — is fixed: both updates add `.eq('status',
  'processing').eq('claimed_at', row.claimed_at).select('id')`, so a
  stale-reclaim update matches zero rows (observable via the returned row
  count, not just inferred) instead of clobbering newer work — and a
  zero-row result now skips `logApiUsage` too, rather than logging a
  write that never landed. This revision also adds a lease **recheck right
  before the brand-kit write**, not just before the final status update —
  closing the same race one step earlier — and an optional deadline
  `AbortSignal` (`api/lib/request-deadline.ts`) checked at both of those
  same two points, so a timed-out run stops cleanly instead of racing a
  write after the client already got its 504. **PASS (local)**,
  `test/mcp-url-analysis-lease.spec.ts` — a **mocked Supabase client**
  (plain object literals standing in for `.eq()`/`.select()`/`.update()`
  chains, asserting the exact filter chain and the lease-lost/deadline-
  aborted early-exit paths), not a real database — `[unit (mocked)]`
  (round-6 operator review, item I: this was previously tagged
  `[verified locally]`, which overstated it). Status for an actual
  concurrent-runner race against the real shared AIIAN database: PENDING,
  needs a real-DB check on Preview once it exists — no local/CI
  environment can safely reproduce two real runners racing the same row
  without secrets.

## 3. Long `waitUntil` jobs finish, no double credit charge

- `waitUntil` installed process-wide via `server.mjs`, tracked in a `Set`,
  drained on SIGTERM with a configurable timeout — **PASS (local)**,
  `test/cf-server-adapter.spec.ts` (waitUntil tracking + health
  `pendingBackground`) and `test/cf-server-lifecycle.spec.ts` (drains on
  SIGTERM; honors `SHUTDOWN_DRAIN_MS` timeout). `[verified locally]`
- The same mechanism inside the real image, using the real
  `@vercel/functions` from `node_modules` (not a test double): with
  `test/fixtures/cf-api` bind-mounted at `/app/fx` and `API_DIR=/app/fx`,
  `GET /api/bg-start?id=img1&ms=1500` returned `202 {"id":"img1","state":
  "pending"}`; `/api/health` showed `pendingBackground:1` while it was
  in flight; `/api/bg-status?id=img1` went from `pending` to `done` once
  the delay elapsed. A second job (`img2`, 3s) was started and the
  container was sent `SIGTERM`, logging `[server] drained 1 background
  task(s)` before exiting — the container waited for the in-flight job
  instead of dropping it. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/container-smoke.log` ("waitUntil
  inside the image"). `[local, identical image]` (older image, `a05d43e…`;
  this part of the check wasn't repeated against the current revision, so
  it still stands as the evidence for actually draining an in-flight job).
- On the current-revision image
  (`sha256:08029107de5fa4c986c147b839d970139d5a534d43d40a5b7956c09d5c674aa1`),
  the route sweep ended with a `SIGTERM` sent to the container: it logged
  `[server] shutting down` then `[server] drained 0 background task(s)` and
  exited cleanly (0, not more than 0, because the sweep itself never
  started a background job) — confirms the shutdown path itself still
  works with no error/hang on the current revision, complementing (not
  replacing) the older run's actual drained-task proof above. **PASS
  (local container)**,
  `/workspace/reports/advance-cf/logs/r5/container-sweep.log` ("SIGTERM
  drain"). `[local, identical image]`. Confirmed clean again on the
  current-revision image (`81fb6224…`): `[server] shutting down` /
  `[server] drained 0 background task(s)`, same no-error/no-hang result.
  **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("SIGTERM
  drain"). `[local, identical image]`.
- generate-image (180s), carousel (240s), bulk-posts/bulk-campaign (300s),
  MCP execute: all already attach `.catch` to their `waitUntil`'d promise
  (verified by source inspection, `api/mcp.ts:27`, `api/generate-image.ts:585`)
  and rely on job leases / `MCP_EXECUTE_STALE_MS`, not `maxDuration`, for
  safety — no code change needed since the container doesn't kill long
  requests. Whether a job that previously would have been cut off by
  Vercel's `maxDuration` now *completes* without double-charging needs a
  real long-running job behind Preview. Status: **PENDING**,
  `[needs browser session behind Access]` (or `[local, identical image]` if
  run against `docker run` with real provider keys instead — either way, not
  done in this PR).
- New in this revision (SD-04): a per-route deadline (§8 in the ops doc)
  responds `504` itself if a handler hasn't responded in time, but this is
  independent of `waitUntil` — a background job scheduled before the
  deadline fires keeps running and completes normally afterward, and the
  deadline mechanism never aborts the handler itself. **PASS (local)**,
  `test/cf-server-adapter.spec.ts` ("route deadlines (per-route
  maxDuration)" block: a `waitUntil` job scheduled before a 100ms deadline
  still shows `done` via `bg-status` well after the `504` was returned).
  `[verified locally]`
- **Round-6 operator review, item C — confirmed inside the real image.**
  A fixture handler that sleeps past its deadline, then calls
  `res.status(200).json({late:true})` anyway, gave `{"error":"Gateway
  Timeout"} 504` from the adapter and the fixture's own post-write marker
  (`{"id":"lw1","state":"post-write-ran"}`) still showed up on a follow-up
  poll — the late write was a safe no-op and the handler's code after it
  still ran to completion, not just in the vitest fixture. A second
  fixture reading `req.__cfDeadlineSignal` (the real image, the real
  `getDeadlineSignal` mechanism) showed `504` plus `{"id":"ab1","state":
  "charge-skipped"}` for a slow request past its deadline, and `{"charged":
  true} 200` plus `{"id":"ab2","state":"charged"}` for a fast one — the
  abort signal fires only when the deadline actually fires, same as the
  vitest coverage. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("late write
  after 504", "abort signal after 504", "abort signal, fast request").
  `[local, identical image]`.
- **Round-6 operator review, item D — confirmed inside the real image.**
  The container's own log was checked for `MaxListenersExceededWarning`
  after the late-read raw-stream fixtures ran (including the 9.5 MiB
  late-read case, the exact size that reproduced the original bug) and
  found **zero** warning lines. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("warnings
  in container log (expect none)": `0`). `[local, identical image]`.

## 4. sharp JPEG re-encode (`api/lib/generated-image-jpeg.ts`)

Inside the built image, `dist-api/lib/generated-image-jpeg.js`'s
`encodeGeneratedImageJpeg` was called on a real 64×48 PNG generated by
`sharp` itself, and the result was re-decoded to confirm it's a real JPEG:

```json
{"contentType":"image/jpeg","width":64,"height":48,"magic":"ffd8ff","format":"jpeg","arch":"x64","vips":"8.18.3"}
```

`magic: "ffd8ff"` is the JPEG SOI marker, `format: "jpeg"` comes from
re-decoding the output bytes, and `vips: "8.18.3"` confirms `sharp`'s
native binding loaded on `linux/amd64` inside the container. Re-confirmed
against the image `sha256:08029107de5fa4c986c147b839d970139d5a534d43d40a5b7956c09d5c674aa1`
with the identical result. **PASS (local container)**,
`/workspace/reports/advance-cf/logs/r5/container-smoke.log` ("sharp JPEG
re-encode"). `[local, identical image]`. Re-confirmed again against the
current-revision image
(`sha256:81fb6224346b85108d71a01fb40e353eb60acf47a3f32fe72e9e5309820825f6`),
identical output. **PASS (local container)**,
`/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("sharp JPEG
re-encode"). `[local, identical image]`.

The full `/api/generate-image` path with a real provider (Grok/Gemini/
OpenAI) producing the source image that then gets re-encoded still needs a
real request end to end. Status: **PENDING**, `[needs browser session
behind Access]`.

## 5. pdf-parse for `extract-pdf`/`parse-pdf`, 10/25 MB limits

- `parse-pdf.ts` is `bodyParser: false` (raw stream); `extract-pdf.ts` is
  `sizeLimit: '10mb'` — **PASS (local)**, `test/cf-api-build.spec.ts`
  (reads the compiled `dist-api/parse-pdf.js` / `extract-pdf.js` `config`
  exports directly) and `test/cf-parity-scripts.spec.ts`
  (`buildRouteTable` confirms the same from source). `[verified locally]`
- The adapter enforces exactly 10 MB / 25 MB (413 at limit+1, 200 at the
  limit) for the two limited routes, and the default 4.5 MB for everything
  else, including rejecting a chunked body with no `content-length` —
  **PASS (local)**, `test/cf-server-adapter.spec.ts` ("limits" and "raw
  stream" blocks). `[verified locally]`
- At exactly the limit, the full body must be accepted and handed to the
  real handler (`extract-pdf`, `analyze-style`, `chat`); at limit+1, the
  adapter must reject with 413. Run against the previous round's image
  (`sha256:08029107de5fa4c986c147b839d970139d5a534d43d40a5b7956c09d5c674aa1`),
  back when "accepted" happened to always mean exactly 401 (no pre-auth
  gate existed yet, so the handler's own auth check was the only thing
  that could answer):

  | route | limit (bytes) | at-limit status | +1 byte status |
  |---|---|---|---|
  | `/api/extract-pdf` | 10485760 | 401 (PASS) | 413 (PASS) |
  | `/api/analyze-style` | 26214400 | 401 (PASS) | 413 (PASS) |
  | `/api/chat` | 4718592 | 401 (PASS) | 413 (PASS) |

  exit 0. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r5/container-smoke.log`
  ("upload-limits.mjs"). `[local, identical image]`.
  **Operator-found bug, round-7/8 fix, re-run round-6 (this image):** once
  item H's pre-auth gate shipped, `extract-pdf`'s at-limit probe (sent with
  a dummy Bearer to get past that gate) started answering `500` on this
  no-secrets box — `requireAuth` never got a chance to reject the dummy
  token, because `createSupabaseAdmin`-style config checks run first in
  that handler and this container has zero secrets. `atLimitOk: atLimit
  === 401` was the wrong criterion all along: it happened to work only
  because every handler tried so far answered exactly 401. Fixed in
  `scripts/parity/upload-limits.mjs` to `atLimit !== 413 && atLimit !==
  503` for elevated-limit routes (any non-413/503 status proves the
  adapter accepted the full body) while `/api/chat` keeps the original
  exact-401 check (no dummy auth is ever sent there). Re-run against the
  current-revision image
  (`sha256:81fb6224346b85108d71a01fb40e353eb60acf47a3f32fe72e9e5309820825f6`):

  | route | limit (bytes) | at-limit status | +1 byte status | note |
  |---|---|---|---|---|
  | `/api/extract-pdf` | 10485760 | 500 (PASS) | 413 (PASS) | any non-413/503 status proves the adapter accepted the full at-limit body |
  | `/api/analyze-style` | 26214400 | 401 (PASS) | 413 (PASS) | any non-413/503 status proves the adapter accepted the full at-limit body |
  | `/api/chat` | 4718592 | 401 (PASS) | 413 (PASS) | default-limit route, no dummy auth sent: must be exactly 401 from the handler |

  exit 0. The `500` for `extract-pdf` is exactly the expected "handler
  reached, no secrets configured" result, not a failure. **PASS (local
  container)**, `/workspace/reports/advance-cf/logs/r6/container-smoke.log`
  ("upload-limits.mjs"). `[local, identical image]`.
- `pdf-parse` extracting text from a real, LibreOffice-generated PDF inside
  the image: `node --input-type=module -e "..."` against `pdf-parse`
  directly gave `{"numpages":1,"text":"Advance parity PDF ok\nSecond line
  for pdf-parse."}` — real text extraction, not a stub. Re-confirmed
  against image `08029107…` with the identical result. **PASS
  (local container)**,
  `/workspace/reports/advance-cf/logs/r5/container-smoke.log` ("pdf-parse
  on a real PDF"). `[local, identical image]`. Re-confirmed again against
  the current-revision image (`81fb6224…`), identical result. **PASS
  (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("pdf-parse
  on a real PDF"). `[local, identical image]`.
- `parse-pdf.ts` (the `bodyParser: false` raw-stream handler) hit with a raw
  `POST` of that same real **small** PDF and no `Authorization` header gave
  `{"error":"Missing authorization"} 401` — confirms the untouched-stream
  path reaches the real handler and the handler's own auth check runs
  normally (the body is small enough that item H's pre-auth gate never
  applies), not just that the adapter's body limiter leaves it alone.
  Re-confirmed against the current-revision image with the identical
  result. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("real
  /api/parse-pdf, small PDF, no auth"). `[local, identical image]`.
- **Round-6 operator review, item H — the pre-auth gate itself, against
  real routes, real bodies, no auth, on the current-revision image.** Once
  a body crosses `DEFAULT_BODY_LIMIT` (4.5 MiB) on an elevated-limit route
  with no `Authorization: Bearer` header present at all, the **adapter**
  now answers 401 before the handler (or the 413 size check) ever runs —
  distinct from the handler's own 401, and distinct from the pre-gate
  behavior this superseded (see the next bullet):
  - `/api/parse-pdf`, a real 6 MB body, no Bearer → `{"error":"Missing
    authorization"} 401` from the adapter (the harness recorded ~3.8 MB
    actually transmitted before the connection was cut — consistent with
    the adapter rejecting mid-stream rather than draining the rest).
  - `/api/extract-pdf`, a real 9 MiB JSON-ish body, no Bearer →
    `{"error":"Missing authorization"} 401` from the adapter.
  - `/api/analyze-style`, a real 9 MiB **chunked** body, no Bearer →
    `{"error":"Missing authorization"} 401` from the adapter.
  - `/api/parse-pdf`, 10 MiB + 1 with a known `Content-Length` and a
    **dummy Bearer** (needed to get past the gate and reach the real
    413 size check) → `{"error":"Payload too large"} 413`.
  **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("real
  /api/parse-pdf, 6 MB, NO Bearer", "real /api/extract-pdf, 9 MiB
  JSON-ish, NO Bearer", "real /api/analyze-style, 9 MiB chunked, NO
  Bearer", "real /api/parse-pdf, 10 MiB + 1, dummy Bearer"). `[local,
  identical image]`.
- **Superseded by the bullet above, kept for the record.** Before item H's
  pre-auth gate existed, the previous round found: a request with
  `Content-Length` set to 10 MiB + 1 (no auth at all) gave `{"error":
  "Payload too large"} 413` — the adapter's size cap rejected it before
  the handler's own auth check got a chance to run; a **chunked** body of
  10 MiB + 1 (no auth, no `Content-Length`) gave `{"error":"Missing
  authorization"} 401` instead of 413 — `parse-pdf.ts`'s own auth check
  ran synchronously and answered before the adapter had read enough of the
  chunked body to detect it was over the limit, so the 401 won the race.
  That race no longer exists for a large chunked body with no auth at all
  (the pre-auth gate now answers 401 first, deterministically, well before
  the race could happen) — this older result is not re-claimed as current
  behavior, just kept here as the "before" picture. **PASS (local
  container)**, `/workspace/reports/advance-cf/logs/r5/container-smoke.log`
  ("real /api/parse-pdf, 10 MiB + 1 with Content-Length" and "real
  /api/parse-pdf, 10 MiB + 1 chunked"). `[local, identical image]`.
- The delayed-reader raw-stream fixture
  (`test/fixtures/cf-api/raw-stream-delayed.js`, the same one
  `test/cf-server-adapter.spec.ts` uses, mounted as `API_DIR` inside the
  current-revision image so `server.mjs` from the real image runs it) was
  exercised directly against the real image, not just via vitest: a 3-byte
  body, a 5 MiB body, and an exactly-10-MiB body all came back `200` with
  the response's reported sha256 matching the locally computed sha256 of
  the same bytes (`bodyIsUndefined:true` confirms the handler's own
  `req.body` was never populated, as expected for a raw-stream route); the
  5 MiB body throttled to 1 MiB/s (handler attaches its listener late, same
  as real `parse-pdf.ts`) also came back `200` with an intact sha256,
  taking ~5s as expected; a **chunked** 10 MiB + 1 body against this
  fixture (no competing auth check to race against) gave `{"error":"Payload
  too large"} 413` — this is the proof that the chunked-body cap itself
  works, separate from the real-handler 401-wins-the-race case above.
  `/api/health` was confirmed still up afterward. **PASS (local
  container)**,
  `/workspace/reports/advance-cf/logs/r5/container-smoke.log` ("delayed-reader
  raw stream inside the image"). `[local, identical image]`.
- **Re-run against the current-revision image, with item D's backpressure
  fix and item H's pre-auth gate both exercised together.** Same fixture,
  extended: a 3-byte body, a 5 MiB body, a **9.5 MiB** body (the exact size
  that reproduced the `MaxListenersExceededWarning` bug item D fixed), and
  an exactly-10-MiB body all came back `200` with sha256 intact; the 5 MiB
  body throttled to 1 MiB/s again came back `200` with sha256 intact; the
  **same 5 MiB body with no `Authorization` header at all** now gave
  `{"error":"Missing authorization"} 401` (the pre-auth gate, item H —
  this specific case wasn't exercised against a real image before this
  round); a **chunked** 10 MiB + 1 body **with a dummy Bearer** (needed to
  get past the gate and reach the real 413 check) gave `{"error":"Payload
  too large"} 413`; the container's own log showed **zero**
  `MaxListenersExceededWarning` lines across all of this (item D); `/api/health`
  was confirmed still up afterward. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("late-read
  three.bin"/"five.bin"/"ninehalf.bin"/"ten.bin", "five.bin throttled",
  "five.bin NO Bearer", "over.bin chunked, dummy Bearer", "warnings in
  container log"). `[local, identical image]`.
- **Round-6 operator review, item H — global in-flight body-bytes
  semaphore, against the real image** (`MAX_INFLIGHT_BODY_BYTES=2097152`,
  a small injected cap, via `semaphore-hold.mjs`): request A (1.5 MiB)
  held open; request B (1.5 MiB) sent while A was still in flight →
  `503 {"error":"Server busy"}`; A then finished → `200
  {"bodyType":"buffer","length":1572864}`; a follow-up request C (1.5 MiB)
  → `200 {"bodyType":"buffer","length":1572864}`, confirming the budget
  fully released (A's own usage, and B's rejected attempt, which should
  never have been added to the budget at all). **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log` ("semaphore
  inside the image"). `[local, identical image]`.
- **Round-6 operator review, item H — trailing-slash deadline-manifest
  normalization.** `/api/chat/` (trailing slash) routed to the real
  `chat.js` handler and got `{"error":"Missing or invalid Authorization
  header"} 401` from the handler — confirming the route itself resolves
  correctly with a trailing slash against the real image. The
  deadline-manifest lookup normalization specifically (that `/api/chat/`
  gets `chat`'s real 120s deadline rather than silently falling back to
  the 300s default) is **not** provable by this smoke test — a 401 returns
  near-instantly regardless of which deadline applies, so this container
  run can't distinguish "got the right 120s deadline" from "got the wrong
  300s default." That normalization is proven by
  `test/cf-server-adapter.spec.ts`'s dedicated real-HTTP vitest test
  instead (a fixture with no module-level `maxDuration`, deadline supplied
  only via an injected manifest, hit with and without a trailing slash,
  both producing a `504` well under the 300s default). **PASS (local
  container)**, `/workspace/reports/advance-cf/logs/r6/container-smoke.log`
  ("/api/chat/ trailing slash"), route resolution only — `[local, identical
  image]`. **PASS (local)**, `test/cf-server-adapter.spec.ts` ("trailing-slash
  normalization before the deadline-manifest lookup" block) for the
  deadline value itself — `[verified locally]`.
- Authenticated parse/extract end-to-end (a real signed-in user uploading a
  PDF and getting real extracted content back) still needs a real request.
  Status: **PENDING**, `[needs browser session behind Access]`.
- **New in this revision (SD-04): a 10 MiB cap on `bodyParser: false` raw
  streams** — Vercel never enforced a limit here at all; this is a
  deliberate new ceiling. A known `Content-Length` over 10 MiB gets 413
  before the handler runs; a chunked body that grows past 10 MiB while
  being read gets an explicit stream error (never a falsely-successful
  truncated `'end'`), plus a 413 if headers aren't sent yet. **PASS
  (local)**, `test/cf-server-adapter.spec.ts` ("raw stream" block: exactly
  10 MiB with sha256 intact → 200; +1 byte with a known Content-Length →
  413; a chunked body with no Content-Length growing past 10 MiB → 413).
  The pre-existing 5 MiB raw-stream test — proving the cap doesn't affect
  bodies under it — still passes unmodified. `[verified locally]`
- **Operator-review fix, same revision:** the first cut counted bytes via a
  bare `req.on('data', ...)` attached *before* the handler ran, which
  switches the real stream into flowing mode immediately — since
  `api/parse-pdf.ts` (like every handler) does an `await` (`supabase.auth.
  getUser`) before ever touching the request stream, chunks, or even the
  `'end'` event, could fire with nobody listening, silently truncating or
  hanging the request in production. The fixture used to test it happened
  to read immediately, so this didn't show up. Fixed by pulling data via
  the real stream's own `'readable'` event (not `.pipe()`, which — proven
  empirically — breaks once the handler-facing `req.read`/`req.resume`/
  `req.pause` are repointed to the proxy, since Node's own flow-control
  calls those same public methods by name) into a counting `PassThrough`,
  with the handler's later `req.on(...)`/`req.read()`/etc. all redirected
  to that proxy instead of the real stream. **PASS (local)**,
  `test/cf-server-adapter.spec.ts` ("raw stream (handler attaches
  listeners late, like parse-pdf.ts)" block, using a new fixture
  (`test/fixtures/cf-api/raw-stream-delayed.js`) that sleeps 300ms before
  attaching any stream listener, exactly like the real handler): a 5 MiB
  body, exactly 10 MiB, a chunked body over 10 MiB, and a 3-byte body
  whose `'end'` fires long before the handler ever attaches — all behave
  identically to the "attaches immediately" fixture's results.
  `[verified locally]`
- **New in this revision (SD-04): per-route deadlines matching Vercel's
  `maxDuration`.** A handler slower than its deadline gets a `504` from the
  adapter itself (handler keeps running, any later write is a no-op, no
  crash); a handler within its deadline is unaffected. **PASS (local)**,
  `test/cf-server-adapter.spec.ts` ("route deadlines" block) and
  `test/cf-api-build.spec.ts` (the manifest `scripts/build-api.mjs`
  generates, `dist-api/_route-deadlines.json`, resolves every route to a
  number and is itself not routable as an API path). `[verified locally]`

## 6. Auth: login, signup, magic link, reset, Google OAuth

Grep evidence (`src/`):

```
$ grep -rn "signInWithPassword\|signUp(\|signInWithOtp\|resetPasswordForEmail\|signInWithOAuth\|provider: 'google'" src --include=*.ts --include=*.tsx
src/contexts/AuthContext.tsx:223:    const { error } = await supabase.auth.signUp({
src/contexts/AuthContext.tsx:237:    const { error } = await supabase.auth.signInWithPassword({ email, password })
src/contexts/AuthContext.tsx:243:    const { error } = await supabase.auth.signInWithOAuth({
src/contexts/AuthContext.tsx:244:      provider: 'google',
src/pages/ForgotPassword.tsx:19:      const { error } = await supabase.auth.resetPasswordForEmail(email, {
src/pages/Signup.tsx:79:      await signUp(email, password, fullName, referralCode || undefined)
```

No `signInWithOtp` (magic link) call anywhere in `src/` — **N/A**, not a
feature of this app today.

All of login, signup, reset, and Google OAuth go straight from the SPA to
Supabase Auth via `@supabase/supabase-js` — none of them are Vercel/CF
serverless functions, so none of this is affected by the host move itself.
What *is* affected: the redirect URLs Supabase sends users back to
(`window.location.origin` at call time) must be allowed in Supabase Auth's
redirect allowlist for whatever origin Preview/prod serves from next — see
`docs/operations/cloudflare-containers.md` §15 item 5. Status: **PENDING**,
`[needs browser session behind Access]`, with test accounts only, pending
the Supabase redirect URL addition and — now that §12's Access JWT gate is
live on Preview — a valid Access session too.

## 7. Tilopay webhook replays + sandbox create-checkout; Stripe

Grep evidence — no Stripe anywhere in this codebase:

```
$ grep -rni "stripe" api src --include=*.ts --include=*.tsx
(no matches)
```

**Stripe: N/A.**

Tilopay webhook (`api/tilopay/webhook.ts`) authenticates with `?secret=`
query equality against `TILOPAY_WEBHOOK_SECRET`, not HMAC (the pre-existing
`scripts/test-tilopay-webhook.js` describing HMAC is stale; left alone).
`scripts/parity/tilopay-webhook-replay.mjs`:

- The non-local-base-URL guard (refuses non-`localhost`/`127.0.0.1`/`::1`/
  `host.docker.internal` base URLs before any network call) is **PASS
  (local)**, `test/cf-parity-scripts.spec.ts` ("tilopay-webhook-replay
  guard"). `[verified locally]`
- GET health-ish (200), wrong-secret POST (403), missing-secret POST (403)
  — re-run against image
  `sha256:08029107de5fa4c986c147b839d970139d5a534d43d40a5b7956c09d5c674aa1`,
  all 3/3 passed, identical to the older run:

  ```
  [tilopay-webhook-replay] PASS GET health-ish (status 200)
  [tilopay-webhook-replay] PASS POST with wrong secret=*** (printed, never the real value) (status 403)
  [tilopay-webhook-replay] PASS POST with no secret (status 403)
  ```

  exit 0. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r5/container-sweep.log`
  ("tilopay-webhook-replay.mjs"). `[local, identical image]`. This
  container had **no DB credentials configured at all**, so beyond "no
  `--write` mode exists in the script," there was also no way for any of
  these three requests to reach a database even if the script had tried —
  the webhook handler's own secret check (which these three all fail) runs
  before any Supabase call regardless. **Unchanged, re-confirmed again**
  against the current-revision image
  (`sha256:81fb6224346b85108d71a01fb40e353eb60acf47a3f32fe72e9e5309820825f6`):
  the same 3/3 PASS, exit 0. **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/r6/container-smoke.log`
  ("tilopay-webhook-replay.mjs"). `[local, identical image]`.
- **There is deliberately no `--write` mode.** A request with the real
  secret writes `payment_transactions` (even a no-email request writes an
  `error_no_email` audit row). `TILOPAY_WEBHOOK_SECRET` is **never set on
  Preview at all** (SD-05, `docs/operations/cloudflare-containers.md` §4b)
  — not because it's pending, but by design, since the shared AIIAN
  database must never receive a webhook-triggered write from Preview. The
  success path can only ever be proven against the identical image
  locally, with a locally generated throwaway secret and a dedicated test
  email that has no existing Advance profile or pending subscription
  (manual SQL cleanup afterward). Status: **PENDING**,
  `[local signed fixture]` — not attempted by any script in this PR.
- Tilopay **sandbox** `create-checkout` (`api/tilopay/create-checkout.ts`,
  `createTilopayOneTimeCheckout`): requires a real authenticated user and
  live Tilopay sandbox credentials, which Preview may or may not have
  depending on whether QA needs this flow (§4b allows Tilopay sandbox API
  creds on Preview, unlike the webhook secret). Status: **PENDING**,
  `[needs browser session behind Access]`.
- Also tracked for pre-cutover hardening, not fixed in this PR: the
  webhook's secret comparison (`secret !== WEBHOOK_SECRET`) is a plain
  string compare, not constant-time, unlike `api/mcp-guide-analysis.ts`'s
  `CRON_SECRET` check — see `docs/operations/cloudflare-containers.md` §14.

## 8. Every email send path

Grep evidence:

```
$ grep -rni "TICKETS_EVENT_WEBHOOK_URL\|nodemailer\|resend\.\|sendEmail\|smtp" api --include=*.ts
api/ticket-events.ts:33:  return (process.env.TICKETS_EVENT_WEBHOOK_URL || '').trim()
```

- **Supabase Auth emails** (signup confirmation, password reset): triggered
  implicitly by `supabase.auth.signUp()` / `resetPasswordForEmail()` from
  the SPA (§6) — Supabase's own infrastructure sends these, not any `api/`
  code, so the host move doesn't touch them. Covered by §6's pending item.
- **Ticket webhook** (`api/ticket-events.ts` / `api/lib/ticket-events.ts`):
  POSTs a `ticket.created`/etc. JSON payload to `TICKETS_EVENT_WEBHOOK_URL`
  with `TICKETS_WEBHOOK_SECRET` — this relays to an external ticketing
  system that may itself send email, but this app never calls an SMTP/email
  API directly. **N/A** for app-level email sending beyond this relay.
- No other email sender (no `nodemailer`, `resend`, raw SMTP) exists in
  `api/`. `TICKETS_EVENT_WEBHOOK_URL`/`TICKETS_WEBHOOK_SECRET` are **never
  set on Preview** (SD-05, `docs/operations/cloudflare-containers.md` §4b),
  so the relay itself reaching its configured URL can only be proven
  against the identical image locally, with a locally generated secret and
  a fixture ticket. Status: **PENDING**, `[local signed fixture]`.

## 9. Chat-shell `/chat` end to end

Not exercised against Preview in this PR. Covers: open, gift fails closed on
preview, chat replies, guiones, image gen + poll, brand kit, MCP OAuth
metadata/execute/approve/poll, admin pages, credits ledger.

- "Gift fails closed on preview" — **PASS (local)**,
  `test/chat-shell-open-gift.spec.ts` (`shouldSkipChatShellOpenGift` is true
  for `APP_ENV=preview`/`staging`/unset, false only for
  `APP_ENV=production` with the flag on). `[verified locally]`
- MCP OAuth protected-resource metadata (`resource`,
  `authorization_servers`, `cache-control`) served with no DB — **PASS
  (local)**, `test/cf-api-build.spec.ts`. `[verified locally]`
- Everything else in this item (open, chat replies, guiones, image gen +
  poll, brand kit, MCP execute/approve/poll, admin pages, credits ledger) —
  **PENDING**, `[needs browser session behind Access]`, with test accounts
  only, per `.cursor/skills/verify-advance/SKILL.md` (which now requires an
  explicit `ADVANCE_VERIFY_BASE_URL` for preview mode — no default origin —
  pointing at the CF preview Worker origin or a local container).
  `[needs browser session behind Access]` is now literal here, not just a
  placeholder: once Preview is live, every one of these requests — API and
  static assets alike — must also carry a valid Cloudflare Access JWT
  (§12) before this app's own auth even runs. A browser session behind
  Access is the only way any of this gets exercised against real Preview.

## 10. Supabase Storage, static assets, SPA deep links, cache headers

- SPA deep links (`/chat/abc`) and `/` both serve `index.html` with
  `Cache-Control: public, max-age=0, must-revalidate`; a real static asset
  (`/assets/app.js`) serves with its own content-type and the same
  cache-control; a missing `/assets/*` path 404s instead of falling back to
  the SPA html — proven against the **real container's own static
  serving** (`server.mjs`'s `handleStatic`, the Docker-built `dist/`
  fallback copy, §5 of the ops doc), real code against real HTTP: **PASS
  (local)**, `test/cf-server-adapter.spec.ts` ("SPA and static files"
  block). `[verified locally]`.
  Separately — and this is a **different code path, not the same
  behavior re-proven twice** — `cf/worker-core.ts`'s `handleFetch` has its
  own routing/security-header logic for requests the Worker sends to
  `env.ASSETS` (Cloudflare's Static Assets binding, uploaded from the
  host-built `dist/` at deploy time per §5, never the Docker image). The
  container's real static serving above does **not** cover this: it's
  `env.ASSETS.fetch()`, a real Cloudflare binding that only exists at
  Worker runtime. `test/cf-worker-core.spec.ts`'s `handleFetch` block
  proves the equivalent routing/header logic against a **fake `ASSETS.fetch`**
  (`vi.fn()`), not a real binding — `[unit (mocked)]` (round-6 operator
  review, item I: previously tagged `[verified locally]`, which implied
  more than a fake binding can prove). The real Worker-to-ASSETS path has
  never been exercised against an actual Cloudflare Worker runtime.
  Status: **PENDING**, `[needs browser session behind Access]` once
  Preview exists (or, at minimum, a `wrangler dev`/`workers_dev` smoke test
  — neither has happened in this PR).
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `X-XSS-Protection`, HSTS, `Referrer-Policy`, `Permissions-Policy`, and the
  CSP derived byte-for-byte from `vercel.json` minus `vercel.live`/pusher
  tokens) on every response — **PASS (local)**,
  `test/cf-server-adapter.spec.ts` ("headers" block) and
  `test/cf-http-rules.spec.ts`. `[verified locally]`
- The same, inside the real image: `GET /` returned every security header
  with the exact literal values (`nosniff`, `DENY`, `1; mode=block`,
  `max-age=31536000; includeSubDomains`,
  `strict-origin-when-cross-origin`, `camera=(), microphone=(self),
  geolocation=()`, and the full byte-for-byte CSP string), plus
  `content-type: text/html; charset=utf-8` and
  `cache-control: public, max-age=0, must-revalidate`. `/chat/abc` (SPA
  deep link) gave `200 text/html; charset=utf-8`. The real hashed asset
  the build produced (`/assets/index-BH6NMm0D.js`) gave
  `200 text/javascript; charset=utf-8`. A missing asset
  (`/assets/nope.js`) gave `404 application/json; charset=utf-8` — JSON,
  not the SPA's `text/html`, confirming the Worker-side "don't fall back to
  the SPA html for a missing asset" rule (`cf/worker-core.ts`) has a
  matching real-container story on the adapter side too. **PASS (local
  container)**, `/workspace/reports/advance-cf/logs/container-smoke.log`
  ("headers on /", "SPA deep link", "missing asset", "real asset").
  `[local, identical image]` (older image, `a05d43e…`; not repeated
  against the current revision in this round).
- The container runs as `uid=1000(node) gid=1000(node)` — confirmed by
  `docker exec ... id` — not root, matching the Dockerfile's `USER node`.
  **PASS (local container)**,
  `/workspace/reports/advance-cf/logs/container-smoke.log` ("container
  user"). `[local, identical image]` (older image, `a05d43e…`; not
  repeated against the current revision in this round).
- Supabase Storage buckets (brand kit assets, generated images): the
  container talks to Supabase the same way the Vercel functions did
  (`@supabase/supabase-js` with `SUPABASE_URL`/`SUPABASE_SECRET_KEY`), so no
  code changed, but a real upload/fetch round trip through the container has
  not been exercised. Status: **PENDING**, `[local, identical image]`.
- **New in this revision (SD-09): client IP headers forwarded to the
  container.** The Worker builds a new `Request` (never mutating the
  inbound one) that deletes any inbound `X-Forwarded-For`/`X-Real-IP` and
  sets both from `CF-Connecting-IP` when present, or leaves both unset if
  it's absent — so a client can't spoof its apparent IP to anything in the
  container that trusts those headers. Proven against `cf/worker-core.ts`'s
  real `handleFetch` logic, but with a **fake container `fetch`**
  (`vi.fn()`) standing in for the real Cloudflare Container binding —
  `test/cf-worker-core.spec.ts` ("client IP headers forwarded to the
  container (SD-09)" block: a spoofed `X-Forwarded-For`/`X-Real-IP` is
  replaced by the real `CF-Connecting-IP` value; both are removed entirely
  when `CF-Connecting-IP` is absent). `[unit (mocked)]` (round-6 operator
  review, item I: previously tagged `[verified locally]`). What this
  doesn't cover: whether Cloudflare's real edge actually sets
  `CF-Connecting-IP` the way assumed here, and whether the real container
  (not a fake) receives the rewritten headers intact — both need a real
  Preview request. Status: **PENDING**, `[needs browser session behind
  Access]`.

## 11. Env var NAME parity

The 17 names below are the **exact, audited list** of environment variables
configured on the real Vercel project `ianai`
(`prj_tn7ff72gObyrNg99HhdfEGdFx6oK`) — source: a read-only Vercel audit,
2026-10-06, `/workspace/vercel-deps/advance-cloudflare-brief.md` §3 ("Env
vars on Vercel (names only, all user-set; no marketplace-injected vars, all
`configurationId: null`)"). That audit is outside this repo and not
re-checkable by a test, so `scripts/parity/vercel-env-names.mjs` hardcodes
it with a header comment citing the same source. Everything below *is*
generated/checked by this repo's code (`npm run parity:env`;
`buildVercelNameTable` in `scripts/parity/env-diff.mjs`).

| Vercel env name | Forwarded to container? | Read in code? |
|---|---|---|
| `TICKETS_EVENT_WEBHOOK_URL` | yes | api |
| `TICKETS_WEBHOOK_SECRET` | yes | api |
| `VITE_CREDITS_V1` | yes | api+src |
| `CREDITS_V1` | yes | api |
| `CRON_SECRET` | yes | api |
| `OPENAI_API_KEY` | yes | api |
| `FAL_KEY` | yes | no |
| `GEMINI_API_KEY` | yes | api |
| `TILOPAY_API_USER` | yes | api |
| `TILOPAY_API_PASSWORD` | yes | api |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | api |
| `TILOPAY_WEBHOOK_SECRET` | yes | api |
| `TILOPAY_API_KEY` | yes | api |
| `BFL_API_KEY` | yes | no |
| `GROK_API_KEY` | yes | api |
| `VITE_SUPABASE_URL` | yes | api+src |
| `VITE_SUPABASE_ANON_KEY` | yes | src |

(`api` = read via `process.env.*` somewhere in `api/`; `src` = read via
`import.meta.env.VITE_*` somewhere in `src/`; `api+src` = both; `no` =
neither — confirmed unused in code by the audit too.)

Plus the **code-only optional names** — read in `api/`/`src/` but not
confirmed configured on Vercel by the audit (the brief calls these
"optional/unset"), still forwarded to the container for parity:
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `XAI_API_KEY`, `OPENAI_IMAGE_MODEL`,
`APP_ORIGIN`, `VITE_APP_ORIGIN`, `CHAT_SHELL_OPEN_GIFT`,
`GUIONES_DRAFT_MODEL_EFFICIENT`, `GUIONES_SKIP_ANGLES_MAX_COUNT`, and —new
in this revision — `ENABLE_CRONS` and `ADVANCE_RUNTIME` (SD-01; the latter
is set by `server.mjs`/the Dockerfile itself, never actually forwarded by
the Worker, but listed in `CONTAINER_ENV_KEYS` anyway so this exact
invariant doesn't need a second special case next to `VERCEL_ENV`).

**Worker-only vars, never forwarded by design (SD-03):** `ACCESS_TEAM_DOMAIN`
and `ACCESS_AUD` exist in `wrangler.jsonc`'s `env.preview.vars` but are
consumed entirely by the Worker (`cf/access-jwt.ts`, via `handleFetch`)
before a request ever reaches the container — they're deliberately absent
from `CONTAINER_ENV_KEYS`. `scripts/parity/env-diff.mjs` exports
`WORKER_ONLY_VAR_NAMES` listing exactly these two, and excludes them from
the `wranglerVarsNotForwarded` "must be empty" check (reporting them
separately as `workerOnlyVarsPresent` instead) — so an *unexpected*
unforwarded var is still a real finding, not masked by this allowlist.

- `missingFromContainer` (the 17 Vercel names ∪ api-code-derived names,
  minus `CONTAINER_ENV_KEYS`, minus `VERCEL_ENV`) is `[]` — **PASS (local)**,
  `npm run parity:env` / `test/cf-parity-scripts.spec.ts` /
  `test/cf-worker-core.spec.ts` ("env key coverage" block, which also
  derives the api-code names live from `scanProcessEnvNames('api')` rather
  than trusting a hardcoded list). `[verified locally]`
- `wranglerVarsNotForwarded` (keys of `wrangler.jsonc`'s `vars` /
  `env.preview.vars` not in `CONTAINER_ENV_KEYS`) is `[]` — **PASS (local)**,
  same tests. `[verified locally]`
- `FAL_KEY` and `BFL_API_KEY` are flagged as `unusedVercelNames` — read by
  neither `api/` (`process.env.*`) nor `src/` (`import.meta.env.VITE_*`),
  confirmed by both the code scan and the audit — and are **kept, not
  dropped**, in `CONTAINER_ENV_KEYS` and `wrangler.jsonc`'s secret-name
  docs, in case either provider returns. **PASS (local)**, same tests.
  `[verified locally]`
- The full per-name table above (forwarded? / read in code?) is **PASS
  (local)**, `test/cf-parity-scripts.spec.ts` ("builds a per-name table"
  case) — it asserts the exact `readInCode` value for a representative
  sample of names and that every one of the 17 is forwarded.
  `[verified locally]`
- `workerOnlyVarsPresent` is exactly `['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN']`
  and both are confirmed absent from `CONTAINER_ENV_KEYS` — **PASS
  (local)**, `test/cf-worker-core.spec.ts` ("env.preview has
  ACCESS_TEAM_DOMAIN/ACCESS_AUD placeholders, not forwarded to the
  container"). `[verified locally]`

Names only, everywhere — this script and its tests never read an actual
secret value. Regenerate this table with `npm run parity:env` if
`CONTAINER_ENV_KEYS`, `wrangler.jsonc`, or the api/src source changes.

## 12. Cloudflare Access JWT gate (SD-03 — decision reversed: ADD; selector inverted and JWKS caching hardened, round-6 operator review, items A/B)

An earlier pass of this work deliberately left the code Access-unaware
("nothing here validates `Cf-Access-Jwt-Assertion`"). SecureDog's review
reversed that: `cf/access-jwt.ts` now verifies the `Cf-Access-Jwt-Assertion`
header in the Worker, before routing (both container **and** asset paths).
The gate selector was inverted in this round (item A): it now enforces on
**every env except production** (`!isProductionAppEnv({ APP_ENV: env.APP_ENV })`,
`api/lib/app-env.ts` — the same normalization Vercel-side code uses, not a
second comparison), rather than the original "only when
`APP_ENV === 'preview'` exactly," which failed **open** for any unexpected
value (unset, a typo, a future env name). Production is still completely
unaffected, and `scheduled()` never runs through this check (crons are
governed solely by §2's `ENABLE_CRONS` gate). Full writeup:
`docs/operations/cloudflare-containers.md` §11.

- RS256-only, `aud`/`iss`/`exp` (required, 60s skew)/`nbf` (optional,
  checked only when present), and a hardcoded case-insensitive email
  allowlist (`ACCESS_ALLOWED_EMAILS`) — every failure mode fails closed
  with 403: wrong `aud`, wrong `iss`, expired, a missing or non-numeric
  `exp`, `nbf` in the future, a signature from the wrong key, an unknown
  `kid` even after one refetch, `alg: 'none'` or `'HS256'`, a missing
  header, unset/placeholder `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` (the literal
  string `REPLACE` counts as placeholder, no network call made), and a
  non-allowlisted email. A valid token with an uppercase email variant
  still passes (case-insensitive match). The gate-selector truth table
  (APP_ENV unset/`''`/`'Preview'`/`'prod'`/`'staging'` → enforced;
  `' PRODUCTION'`/`'production'` → unaffected, no JWT verification
  attempted at all) is covered too. **PASS (local)**, `test/cf-access-jwt.spec.ts`
  — real signatures and real verification against a **locally generated**
  RS256 keypair via `crypto.subtle` (not Cloudflare's real keys), with the
  JWKS **fetch itself stubbed** (`fetchImpl`, a `vi.fn()`) rather than a
  real network call to `cdn-cgi/access/certs` — `[unit (mocked)]` (round-6
  operator review, item I: previously tagged `[verified locally]`, which
  overstated it — the crypto is real, the network dependency is not).
- **JWKS caching, hardened (round-6 operator review, item B).** Cached
  keys now carry a ~1h TTL (`JWKS_CACHE_TTL_MS`) — even a previously-known
  `kid` refetches once that elapses, not just on a cache miss. An unknown
  `kid` is throttled to at most one refetch attempt per team domain per
  60s (`JWKS_MIN_REFETCH_INTERVAL_MS`) — a flood of requests with a bogus
  or not-yet-rotated-in `kid` no longer causes a fetch per request.
  Concurrent misses on an uncached `kid` share ONE in-flight fetch
  promise instead of each starting their own. All timing goes through the
  injectable `deps.now`. **PASS (local)**, `test/cf-access-jwt.spec.ts`
  ("JWKS cache timing" block: unknown kid twice within 60s → 1 fetch;
  after 60s → 2; a known kid within the TTL → 0 refetches across 3
  verifications; after the TTL → 1 refetch; 5 concurrent requests with an
  uncached kid → exactly 1 fetch; the pre-existing key-rotation test now
  advances the injected clock past the 60s throttle window between the
  old-kid and new-kid calls, since within that window a second
  unknown-kid lookup is now correctly throttled to 0 fetches — the
  fetch-count expectation there legitimately changed because of this
  fix, not a regression). Same stubbed-`fetchImpl` caveat as above —
  `[unit (mocked)]`.
- The real thing — an actual Cloudflare Access login producing a real JWT,
  verified against the real `cdn-cgi/access/certs` JWKS for a real team
  domain, through the real gate-selector logic against a real Preview
  deployment — has not been exercised, because no Access application
  exists yet (`wrangler.jsonc`'s `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are
  still the `REPLACE_WITH_...` placeholders, which fail closed by
  construction — see `docs/operations/cloudflare-containers.md` §15 item
  5). Status: **PENDING**, `[needs browser session behind Access]`.

## 13. Dependency placement (tidy)

`@cloudflare/containers` moved from `dependencies` to `devDependencies` —
it's imported only by `src/cf-container-worker.ts`, which `wrangler`
bundles into the Worker at deploy time; the runtime container image never
imports it. **PASS (local)**: `npm ci --omit=dev` (what the Dockerfile's
runtime stage actually runs) completes with `@cloudflare/containers` absent
from `node_modules/@cloudflare/` entirely. `[verified locally]`

## Cutover checklist additions

Documentation only — none of this changes `wrangler.jsonc` or anything else
in this PR. These are the steps the operator runs by hand at the actual
cutover, after everything above has moved from PENDING to PASS.

1. **Enable crons together, not separately (§2).** Set `ENABLE_CRONS: "1"`
   **and** a new **CF-only `CRON_SECRET`** (distinct from Vercel's) on the
   **prod** Worker (`wrangler.jsonc` top level) in the same deploy/
   maintenance window as deleting the `crons` block from `vercel.json` (and
   redeploying Vercel, or decommissioning the Vercel project per the
   brief's phased plan). Never let both be live at once — see §2's
   lock-safety note on why a second concurrent writer is a real, if
   low-impact, risk (now mitigated by the lease guard, but still not a
   reason to run two writers on purpose). Immediately after, **rotate
   Vercel's own `CRON_SECRET`** — it's no longer needed there, and a
   leaked old value shouldn't keep working anywhere. Preview never gets
   `ENABLE_CRONS` or its own `CRON_SECRET` set at all (§4b/§6) — there's
   nothing to flip there.
2. **Rotate `TILOPAY_WEBHOOK_SECRET`** once Vercel is no longer the
   webhook target (after cutover) — the old value should stop working
   anywhere it might have leaked to.
3. **Prod secrets on the prod Worker only.** `wrangler secret put <NAME>`
   (names in `docs/operations/cloudflare-containers.md` §4a) with real
   production values only against the prod Worker (no `--env` flag).
   Preview's secret set is deliberately smaller and lower-privilege (§4b)
   — `TILOPAY_WEBHOOK_SECRET`, `CRON_SECRET`, `TICKETS_*` must **never** be
   set on Preview at all, not just "use different values." Never paste a
   production secret into a Preview `wrangler secret put` invocation.
4. **Set the real `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` (§12)** once the
   Cloudflare Access application exists, replacing `wrangler.jsonc`'s
   `REPLACE_WITH_...` placeholders on `env.preview`. Until both are set to
   real values, the Access JWT gate fails closed by construction (no
   network call at all) — confirm this is intentional and not accidentally
   left as a placeholder once Preview is expected to actually work.
5. **Supabase Auth redirect URLs + Access app lifecycle.** Add the
   Cloudflare preview Worker hostname to AIIAN Supabase Auth's "Additional
   Redirect URLs" before preview QA needs real auth flows (OAuth/
   magic-link/reset all redirect back to the app origin). At **preview
   retirement** (or if the preview environment is ever dropped): remove
   that redirect URL again, **and delete the Cloudflare Access
   application** for Preview. A dead redirect URL or a stale Access app
   with no corresponding Worker is a standing open-redirect-adjacent
   surface with no upside once nothing resolves there anymore.
6. **Deploy the identical image digest that passed the local parity runs.**
   `wrangler.jsonc`'s `containers[].image` is `"./Dockerfile"`, which tells
   `wrangler deploy` to build the image itself at deploy time — so the
   image that ends up running in Cloudflare is **not guaranteed to be
   byte-identical** to whatever image the operator ran the parity scripts
   (`tilopay-webhook-replay.mjs`, `upload-limits.mjs`, the `sharp`/
   `pdf-parse` smoke test) against locally, even from the same source tree,
   unless the build is fully reproducible (it may not be — base image
   tags can move, `npm ci` can resolve a newly-published patch version,
   etc.). Two ways to make the deployed image identity match what was
   actually tested, neither implemented by this PR:
   - Build once, push to a registry Cloudflare can pull from, and point
     `containers[].image` at that registry reference (a tag **and** a
     digest, e.g. `registry.example/advance-ai@sha256:...`) instead of
     `"./Dockerfile"`. This is the stronger guarantee — the exact bytes
     that were parity-tested are the exact bytes that run.
   - If staying with `"./Dockerfile"` (simpler, no registry to manage):
     record the digest `scripts/parity/tilopay-webhook-replay.mjs` and
     `upload-limits.mjs` printed (`IMAGE_DIGEST` env or `--image <ref>` via
     `docker image inspect`) from the local parity run, and separately
     record the digest wrangler actually deployed (visible in the
     `wrangler deploy` output / Cloudflare dashboard), and confirm by eye
     that the Dockerfile and lockfile were unchanged between the two
     builds. Weaker than the registry approach, but at least makes the gap
     visible instead of silent.
   Either way, do this before flipping `workers_dev` to `true` for Preview
   (`docs/operations/cloudflare-containers.md` §15 item 5) or doing the
   final prod cutover — a parity run against a different image than the
   one actually serving traffic proves nothing.
