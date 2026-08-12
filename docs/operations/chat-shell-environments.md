# Chat-shell environment matrix

## Environments

| Env | App URL | Supabase | `chat_shell` flag | Notes |
|-----|---------|----------|-------------------|-------|
| Production | `ianai-omega.vercel.app` | AIIAN `lstzfxsdmggkoaxfawny` | `false` until cutover | Do not experiment with RLS here |
| Vercel Preview | `*.vercel.app` preview | **Separate project preferred (TBD)** | `false` until shell QA | Must not point at prod DB once shell writes begin |
| Local | `localhost:5173` | Local Supabase **or** preview project | developer-controlled | `npm run dev` for UI; `npm run dev:vercel` for `/api/*` |

## Variable pairing (never mix projects)

Frontend (Vite):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`)

Backend (Vercel functions):

- `SUPABASE_URL` (falls back to `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`

**Rule:** preview frontend URL + preview anon key + preview service role must all be from the **same** Supabase project.

## Feature flag design

- Source of truth: `public.app_feature_flags` row `key = 'chat_shell'`.
- Server reads flag on shell-aware routes; client may read for nav cutover.
- Do **not** bake cutover solely into `VITE_CHAT_SHELL` — build-time flags drift across previews.
- Optional later: `config` jsonb for percentage rollout / allowlist emails.

## Rafael actions required (blocked items)

1. **Create preview Supabase project** (recommended name: `IANAI Preview`) in the same org, region close to prod.
2. Apply repo migrations through `062_chat_shell_foundation.sql` on the preview project (not prod until reviewed).
3. Add Vercel Preview env vars pointing at the preview project (URL + anon + service role).
4. Confirm production env vars remain on `lstzfxsdmggkoaxfawny`.
5. Create non-admin preview test user (see `docs/testing/chat-shell-preview-user.md`).

Do **not** invent or commit credentials. Leave secrets in Vercel / Supabase dashboards only.
