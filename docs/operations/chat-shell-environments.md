# Chat-shell environment matrix

## Environments

| Env | App URL | Supabase | `chat_shell` flag | Notes |
|-----|---------|----------|-------------------|-------|
| Production | `ianai-omega.vercel.app` | AIIAN `lstzfxsdmggkoaxfawny` | keep `false` / do not apply 062 yet | Do not experiment with RLS here |
| Vercel Preview | `*.vercel.app` preview | IANAI-preview `adrwkzibhfdpwuycnzaa` | `false` until QA flip | Pair all Preview env vars to this project |
| Local | `localhost:5173` | Local Supabase **or** preview project | developer-controlled | `npm run dev` for UI; `npm run dev:vercel` for `/api/*` |

See also:

- `docs/operations/chat-shell-p0.md` — `/chat` UI verification and preview flag SQL
- `docs/operations/chat-shell-preview-rls.md` — Preview-only bootstrap (RLS deny-all / `RETURNING`, empty `plan_limits`)

## Variable pairing (never mix projects)

Frontend (Vite) — **required on Preview** or the SPA blank-screens / shows ConfigErrorScreen:

- `VITE_SUPABASE_URL` = `https://adrwkzibhfdpwuycnzaa.supabase.co` (full `https://` URL)
- `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`) from IANAI-preview

Backend (Vercel functions):

- `SUPABASE_URL` (falls back to `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`

**Rule:** preview frontend URL + preview anon key + preview service role must all be from the **same** Supabase project. After changing `VITE_*`, redeploy Preview.

## Feature flag design

- Source of truth: `public.app_feature_flags` row `key = 'chat_shell'`.
- Server reads flag on shell-aware routes; client may read for nav cutover.
- Do **not** bake cutover solely into `VITE_CHAT_SHELL` — build-time flags drift across previews.
- Optional later: `config` jsonb for percentage rollout / allowlist emails.

## Rafael actions

1. Confirm Vercel Preview env vars all target IANAI-preview `adrwkzibhfdpwuycnzaa` (URL + anon + service role).
2. Confirm production env vars remain on AIIAN `lstzfxsdmggkoaxfawny` (no 062 apply).
3. After Preview deploy + blocked-state check, flip preview flag only:

```sql
UPDATE public.app_feature_flags
SET enabled = true, updated_at = now()
WHERE key = 'chat_shell';
```

4. Non-admin preview QA user: `docs/testing/chat-shell-preview-user.md`.
5. If Brands is empty or New chat insert returns null on Preview, check `docs/operations/chat-shell-preview-rls.md` (Preview-only; never apply those policy fixes on AIIAN prod).
6. If generate/send is blocked immediately with usage limit 0 on Preview, seed `plan_limits` + QA subscription per the same bootstrap doc (Preview-only; never seed/alter production AIIAN `plan_limits`).

Do **not** invent or commit credentials. Leave secrets in Vercel / Supabase dashboards only.
