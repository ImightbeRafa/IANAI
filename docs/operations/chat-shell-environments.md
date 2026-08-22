# Chat-shell environment matrix

## Environments

| Env | App URL | Supabase | `chat_shell` flag | Notes |
|-----|---------|----------|-------------------|-------|
| Production | `advanceai.studio` / `ianai-omega.vercel.app` | **AIIAN** `lstzfxsdmggkoaxfawny` | enabled (invite-gated) | Real users; treat as sacred |
| Vercel Preview (default) | `*.vercel.app` preview | **AIIAN** `lstzfxsdmggkoaxfawny` (same as production) | same DB flag / invites | **Policy as of 2026-08-22:** Preview uses production data so chat-shell can be perfected against real brands/sessions. Deployment Protection required. |
| IANAI-preview (legacy, do not use for new work) | n/a | `adrwkzibhfdpwuycnzaa` | — | Isolated QA DB; retired for day-to-day chat-shell work |
| Local | `localhost:5173` | AIIAN (via injected secrets) **or** local Supabase | developer-controlled | `npm run dev` for UI; `npm run dev:vercel` for `/api/*` |

See also:

- `docs/operations/chat-shell-aiian-inventory.md` — AIIAN inventory / history
- `docs/operations/chat-shell-aiian-canary.md` — canary + prod-data preview rules
- `supabase/production/aiian/chat-shell/` — production SQL pack (manual only)
- `docs/operations/chat-shell-p0.md` — `/chat` UI verification
- `docs/operations/chat-shell-preview-rls.md` — **legacy Preview-only** RLS notes — never apply those deny-all/bootstrap patches onto AIIAN

## Variable pairing (never mix projects)

Frontend (Vite) — Preview **and** Production must both point at AIIAN:

- `VITE_SUPABASE_URL` = AIIAN project URL (copy from Production; do not invent)
- `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`) from **AIIAN**

Backend (Vercel functions) — same project:

- `SUPABASE_URL` (falls back to `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` from **AIIAN**

**Rule:** URL + anon + service role must all be from the **same** Supabase project. After changing Preview `VITE_*`, redeploy Preview.

### Hard rules while Preview shares AIIAN

1. **Deployment Protection** on Preview (password / Vercel auth) — no public anonymous writes to prod data.
2. **Do not** target Preview deployments as TiloPay / payment webhook URLs.
3. **Do not** apply IANAI-preview-only RLS/seed migrations onto AIIAN.
4. Prefer synthetic or canary-owned rows for destructive tests; never mass-delete brands/products on Preview.
5. Schema changes still go through reviewed migrations — Preview is not a free-for-all against production Postgres.
6. Keep `chat_shell` invite gate (`profiles.chat_beta_access`); preference alone must not enroll everyone.

## Feature flag design

- Source of truth: `public.app_feature_flags` row `key = 'chat_shell'` (kill switch).
- Per-user invite: `profiles.chat_beta_access` (default false). Clients cannot self-grant.
- Home preference: `profiles.preferred_ui` (`classic` | `chat`). Does not grant access.
- Enabling the kill switch must **not** redirect everyone to `/chat`. See `docs/operations/chat-shell-production-transition.md`.
- Do **not** bake cutover solely into `VITE_CHAT_SHELL` — build-time flags drift across previews.

## Rafael actions (Preview → AIIAN cutover)

1. In Vercel → Project → Settings → Environment Variables, set **Preview** (and optionally Development) to the **same AIIAN values** as Production for:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_URL` (if set)
   - `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
2. Remove or leave unused any Preview-only vars that still point at `adrwkzibhfdpwuycnzaa`.
3. Enable **Deployment Protection** on Preview.
4. Redeploy the latest Preview (or push an empty commit) so Vite rebuilds with AIIAN `VITE_*`.
5. Confirm login with a real AIIAN user (e.g. canary) on the Preview URL — not a Preview-only QA user.

Do **not** invent or commit credentials. Leave secrets in Vercel / Supabase dashboards only.
