# Cloudflare launch checklist (Workers + Containers)

The exact steps to take Advance AI from Vercel to Cloudflare, in order. Branch:
`cloudflare/launch` (Phase 1 `claude/advance-cloudflare-containers` + `master` +
`hotfix/undefined-names` + `feat/ad-pack-engine`). Background and the "why" for
each control: `cloudflare-containers.md` (architecture, secrets §4, crons §6,
Access §11, cutover §15) and `cloudflare-parity-checklist.md`.

**Who does what.** Each step is tagged:

- **[Claude]** — Claude can run it once `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` exist in its shell environment (never pasted in chat,
  never committed).
- **[Owner]** — needs the account owner: billing, dashboards Claude has no
  token for (Supabase, TiloPay, the domain registrar, Vercel), secret values,
  or a go/no-go decision.

> **Domain check first.** The code hardcodes **`advanceai.studio`** as the
> production origin (MCP OAuth `resource` and `resource_metadata` URLs in
> `api/mcp-oauth-metadata.ts` / `api/lib/mcp/www-authenticate.ts`, fallback
> `APP_ORIGIN`, the TiloPay webhook URL comments, the chat-shell production
> docs). `advanceai.app` appears only as the support e-mail domain. Every
> `<PROD_HOST>` below means `advanceai.studio` unless the owner decides
> otherwise — moving to a different host is a code change (the MCP URLs),
> not just DNS.

---

## 0. What's already verified locally (no Cloudflare contact)

| Check | Result |
|---|---|
| `npm ci`, `npm run build`, `npm run build:api`, `npm run typecheck:worker`, `npm run typecheck:adpack` | pass |
| `npx vitest run` on Linux (LF checkout, node:22-slim) | 149 files / 1236 tests pass |
| `docker build` (node:22-slim pinned) incl. build-time smoke: sharp, pdf-parse, `@resvg/resvg-js` linux-x64-gnu, one real 1:1 Ad Pack render from `dist-api` with bundled fonts | pass |
| `scripts/parity/container-smoke.sh` against `docker run` (placeholder env only) | 24/24 |
| `scripts/parity/tilopay-webhook-replay.mjs`, `upload-limits.mjs` against the same container | pass |
| `npm run parity:env` | OK (`missingFromContainer: []`) |
| SIGTERM drain (`docker stop`) | exit 0, "drained 0 background task(s)" |

Not verifiable without Cloudflare: the deployed Worker/Container, Access,
cron firing, custom domain/TLS, real auth flows, AI providers, TiloPay.

---

## 1. Cloudflare account prerequisites [Owner]

1. **Workers Paid plan** ($5/mo minimum) on the account — Containers and
   Durable Objects with SQLite storage are not available on Free. Check
   *Workers & Pages → Plans*.
2. Containers enabled for the account (open *Workers & Pages → Containers*
   once; accept the beta terms if shown).
3. The zone **`<PROD_HOST>`** added to this Cloudflare account. If DNS is
   still at another provider (or at Vercel), adding the zone starts the
   nameserver move — do that early, it's how the cutover in §8 happens.
4. **Zero Trust** organization created (free tier is fine) — needed for the
   Access application in §6. Note the team domain
   (`<team>.cloudflareaccess.com`).

## 2. API token for deploys [Owner creates, Claude uses]

Create at *My Profile → API Tokens → Create Token → Custom token*:

| Scope | Permission | Why |
|---|---|---|
| Account | Workers Scripts — Edit | deploy the Worker, Durable Object class, secrets |
| Account | Containers — Edit | push the image and create the container application |
| Account | Account Settings — Read | wrangler account lookups |
| Account | Workers Tail — Read | `wrangler tail` for post-deploy logs (optional) |
| Zone (`<PROD_HOST>` only) | Workers Routes — Edit | attach the custom domain / routes |
| Zone (`<PROD_HOST>` only) | DNS — Edit | only if Claude should create the custom-domain records; omit to keep DNS owner-only |
| Account | Access: Apps and Policies — Edit | only if Claude should create the preview Access app; omit to do §6 by hand |

Starting from the **"Edit Cloudflare Workers"** template and adding
*Containers — Edit* gives the same result. Restrict it to this account and
zone, set a TTL, and optionally an IP filter.

Then, in the shell that will deploy (never in chat, never in git):

```bash
export CLOUDFLARE_API_TOKEN=...      # the token above
export CLOUDFLARE_ACCOUNT_ID=...     # dashboard → Workers & Pages → right sidebar
npx wrangler@4 whoami                # sanity check
```

**Docker must be running** on the machine that runs `wrangler deploy`:
`containers[].image` is `./Dockerfile`, so wrangler builds the image locally
(linux/amd64) and pushes it to Cloudflare's registry. Alternative for a
fully git-driven build: connect the repo in *Workers & Pages → Workers Builds*
(build command `npm ci && npm run build`, deploy command
`npx wrangler deploy` / `npx wrangler deploy --env preview`, branch
`cloudflare/launch` or `master`), with the `VITE_*` values below set as
**build** variables there. Either way, no Vercel build is involved.

## 3. Frontend build variables (baked into `dist/`) [Owner supplies values]

Static Assets are uploaded from the **host-built** `dist/`, so the deploy
shell (or Workers Builds) needs, per environment:

| Name | Production | Preview |
|---|---|---|
| `VITE_APP_ENV` | `production` | `preview` |
| `VITE_SUPABASE_URL` | AIIAN URL | AIIAN URL |
| `VITE_SUPABASE_ANON_KEY` | AIIAN anon/publishable key | same |
| `VITE_CREDITS_V1` | current Vercel value | current Vercel value |
| `VITE_ADPACK_STUDIO` | `true` only after migration 082 is applied (§9) | `true` for QA |
| `VITE_PREVIEW_HOSTS` | unset | the preview Worker hostname(s) |

These are public by design (they ship in the JS bundle); still keep them out
of git.

## 4. Container secrets — `wrangler secret put` [Owner supplies values; Claude can run the commands]

Names come from `CONTAINER_ENV_KEYS` in `cf/container-env.mjs` (30 names;
`APP_ENV`/`ENABLE_CRONS` are `vars` in `wrangler.jsonc`, not secrets). Each
command prompts for the value on stdin — type/paste it in the terminal, never
in chat.

**Production** (no `--env` flag):

```bash
for n in SUPABASE_URL SUPABASE_SECRET_KEY VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY \
         GROK_API_KEY XAI_API_KEY GEMINI_API_KEY OPENAI_API_KEY \
         TILOPAY_API_KEY TILOPAY_API_USER TILOPAY_API_PASSWORD TILOPAY_WEBHOOK_SECRET \
         TICKETS_EVENT_WEBHOOK_URL TICKETS_WEBHOOK_SECRET \
         CREDITS_V1 VITE_CREDITS_V1 APP_ORIGIN; do
  npx wrangler@4 secret put "$n"
done
# CRON_SECRET: set only at cutover (§10), with a NEW CF-only value.
```

Set only if used today (otherwise leave unset): `SUPABASE_SERVICE_ROLE_KEY`
(only if `SUPABASE_SECRET_KEY` isn't — never both), `OPENAI_IMAGE_MODEL`,
`FAL_KEY`, `BFL_API_KEY` (both unused by code today), `VITE_APP_ORIGIN`,
`CHAT_SHELL_OPEN_GIFT`, `GUIONES_DRAFT_MODEL_EFFICIENT`,
`GUIONES_SKIP_ANGLES_MAX_COUNT`. Tunables that should stay unset:
`SHUTDOWN_DRAIN_MS`, `ADPACK_FONTS_DIR` (fonts ship inside `dist-api`).
`APP_ORIGIN` = `https://<PROD_HOST>`.

**Preview** (`--env preview`) — the minimal set from
`cloudflare-containers.md` §4b only: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GROK_API_KEY`/`XAI_API_KEY`,
`GEMINI_API_KEY`, `OPENAI_API_KEY`, optionally `CREDITS_V1`/`VITE_CREDITS_V1`
and TiloPay **sandbox** API creds. **Never on preview:** `CRON_SECRET`,
`TILOPAY_WEBHOOK_SECRET`, `TICKETS_EVENT_WEBHOOK_URL`,
`TICKETS_WEBHOOK_SECRET`, `ENABLE_CRONS`.

Values: copy from Vercel → Project → Settings → Environment Variables
(Production) [Owner]. Verify names afterwards with
`npx wrangler@4 secret list [--env preview]` [Claude].

## 5. Deploy preview first [Claude]

```bash
git checkout cloudflare/launch && npm ci
VITE_APP_ENV=preview VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
  VITE_CREDITS_V1=... VITE_ADPACK_STUDIO=true npm run build
npm run typecheck:worker
npx wrangler@4 deploy --env preview
```

Record the image digest wrangler prints and compare it with the locally
tested image (`docker image inspect advance-ai:local`) — see parity checklist
"Cutover checklist additions" item 6. Preview stays unreachable
(`workers_dev: false`) until §6 is done.

## 6. Cloudflare Access for preview [Owner, or Claude with the Access permission]

1. Zero Trust → Access → Applications → *Self-hosted*: the preview hostname
   (`advance-ai-preview.<subdomain>.workers.dev` or a
   `preview.<PROD_HOST>` custom domain). Policy: *Allow* emails
   `rafa04128@gmail.com`, `rafaeser@gmail.com` (must match
   `ACCESS_ALLOWED_EMAILS` in `cf/access-jwt.ts`).
2. Copy the application **AUD tag** and the team domain into
   `wrangler.jsonc` → `env.preview.vars.ACCESS_AUD` / `ACCESS_TEAM_DOMAIN`
   (replacing the `REPLACE_WITH_…` placeholders) [Claude commits].
3. Flip `env.preview.workers_dev` to `true` (or add the preview custom
   domain route), redeploy `--env preview` [Claude].
4. Supabase (AIIAN) → Auth → URL Configuration → add the preview origin to
   **Additional Redirect URLs** [Owner].
5. Browser QA behind Access [Owner]: login / signup / magic link / reset /
   Google OAuth, `/chat`, one image generation, one Ad Pack
   (Marca → Ángulos → Resultados), MCP connector, admin pages. Use a
   dedicated test brand/user — preview writes to the **production** AIIAN
   database.

## 7. Deploy production (no traffic yet) [Claude]

```bash
VITE_APP_ENV=production VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
  VITE_CREDITS_V1=... VITE_ADPACK_STUDIO=... npm run build
npx wrangler@4 deploy
```

The Worker exists but has no route or custom domain yet, so it serves
nothing publicly. The cron trigger fires every minute but is a no-op
(`ENABLE_CRONS` unset — fail closed).

## 8. DNS / domain cutover [Owner decides the window; Claude can do the Cloudflare side]

1. Lower the TTL on the current `<PROD_HOST>` and `www` records to 60–300 s
   a day ahead [Owner].
2. If the zone isn't on Cloudflare nameservers yet: switch nameservers at
   the registrar and wait for *Active* [Owner]. Recreate any non-web records
   (MX, TXT/SPF/DKIM, verification records) in Cloudflare DNS **before**
   switching, so e-mail doesn't break.
3. Attach the domain to the production Worker [Claude]: add to the top
   level of `wrangler.jsonc`
   ```jsonc
   "routes": [
     { "pattern": "advanceai.studio", "custom_domain": true },
     { "pattern": "www.advanceai.studio", "custom_domain": true }
   ]
   ```
   and `npx wrangler@4 deploy` (or *Worker → Settings → Domains & Routes →
   Add Custom Domain*). This replaces the Vercel `A`/`CNAME` records for
   those names; Cloudflare issues the edge certificate automatically
   (Universal SSL / custom-domain cert, usually minutes).
4. **www → apex**: *Rules → Redirect Rules → Single redirect*,
   `www.<PROD_HOST>/*` → `https://<PROD_HOST>/${1}`, 301, preserve query
   string [Claude with zone Rules permission, else Owner].
5. TLS: SSL/TLS mode **Full (strict)**, *Always Use HTTPS* on, min TLS 1.2
   [Owner or Claude].
6. **Rollback**: Vercel stays deployed and untouched until §12. To roll
   back, remove the custom domains from the Worker and re-create the
   previous Vercel DNS records (`A 76.76.21.21` for the apex /
   `CNAME cname.vercel-dns.com` for `www`, or whatever Vercel's *Domains*
   page shows), proxied **off** (grey cloud). With low TTLs this takes
   minutes. Keep `ENABLE_CRONS` and webhook targets consistent with
   whichever side is live (§10–§11).

## 9. Database + Supabase settings [Owner]

1. Apply `supabase/migrations/082_ad_packs.sql` to AIIAN (re-runnable)
   before turning on `VITE_ADPACK_STUDIO=true` in production or exposing the
   MCP `adpack_*` tools.
2. Supabase → Auth → URL Configuration: **Site URL** stays
   `https://<PROD_HOST>` (unchanged if the host is unchanged); confirm
   `https://<PROD_HOST>/**` is in Redirect URLs; remove any `*.vercel.app`
   entries only after §12.
3. MCP OAuth: Supabase OAuth server settings keep pointing to
   `https://<PROD_HOST>/oauth/consent`. After cutover verify
   `curl https://<PROD_HOST>/.well-known/oauth-protected-resource` returns
   `resource: https://<PROD_HOST>/api/mcp` and Supabase as
   `authorization_servers`, and that `POST /api/mcp` without a token returns
   401 with a `WWW-Authenticate: Bearer resource_metadata=…` header. No URL
   change is needed as long as the host stays `advanceai.studio`.

## 10. Crons [Claude flips config; Owner sets the secret]

`wrangler.jsonc` already triggers `* * * * *` → `/api/mcp-guide-analysis`
(the only cron in `vercel.json`; a test asserts every `vercel.json` cron is
covered). In **one** window right after §8:

1. `npx wrangler@4 secret put CRON_SECRET` with a **new** value, distinct
   from Vercel's [Owner types it].
2. Add `"ENABLE_CRONS": "1"` to the top-level `vars` in `wrangler.jsonc`
   (never to `env.preview`), commit, `npx wrangler@4 deploy` [Claude]. Note
   `test/cf-worker-core.spec.ts` asserts no env sets `ENABLE_CRONS` — update
   that test in the same commit.
3. Remove the `crons` block from `vercel.json` (or pause the Vercel
   project) so only one writer is live, then rotate Vercel's old
   `CRON_SECRET` [Owner].
4. Verify with `npx wrangler@4 tail` that the scheduled run logs a 200 every
   minute [Claude].

## 11. TiloPay webhook [Owner]

If the host is unchanged, the webhook URL
(`https://<PROD_HOST>/api/tilopay/webhook?event=…&secret=…`) needs no edit —
DNS now routes it to Cloudflare. If the host changes, update every event URL
in the TiloPay merchant dashboard. After cutover, rotate
`TILOPAY_WEBHOOK_SECRET` (new value in Cloudflare secrets **and** in the
TiloPay URLs together). Do one real low-value payment or a TiloPay test
event and confirm a `payment_transactions` row.

## 12. Post-cutover smoke [Claude]

```bash
bash scripts/parity/container-smoke.sh https://<PROD_HOST>    # expect 24/24
npx wrangler@4 tail                                           # watch errors
```

Plus, by the owner in a browser: log in, generate one script, one image, one
Ad Pack, open the MCP connector, check `/admin` usage numbers. Watch
`wrangler tail` and Supabase logs for 30–60 min.

## 13. Retire Vercel [Owner, after ≥ 48 h stable]

1. Vercel project → Settings → Domains: remove `<PROD_HOST>` / `www`.
2. Settings → Git: disconnect the repository (`vercel.json` already has
   `"git": {"deploymentEnabled": false}`, so no new deploys are triggered
   meanwhile).
3. Delete or pause the project; remove its env vars (they are copies of
   live secrets). Rotate any secret that existed only for Vercel
   (`CRON_SECRET`, old `TILOPAY_WEBHOOK_SECRET`).
4. Supabase: remove `*.vercel.app` redirect URLs. Optionally delete
   `vercel.json`, `@vercel/node` (types only) — `@vercel/functions`'
   `waitUntil` is still used and shimmed by `server.mjs`, keep it.

## Known gaps / not blocking but tracked

- `wrangler deploy` rebuilds the image; the digest won't match the locally
  tested one byte-for-byte unless pushed to a registry (parity checklist,
  cutover item 6).
- Pre-cutover hardening still open (from `cloudflare-containers.md` §14):
  `waitUntil` concurrency cap; constant-time TiloPay secret compare.
- Single named container instance (no load balancing); `standard-2`
  instance type. Ad Pack renders (satori/resvg/sharp) and image jobs share
  it — watch CPU/memory in the Containers dashboard after launch.
- On Windows checkouts (CRLF), `test/cf-parity-scripts.spec.ts` and the two
  SIGTERM lifecycle tests fail for platform reasons; run the suite on
  Linux/macOS or in Docker (all green there).
