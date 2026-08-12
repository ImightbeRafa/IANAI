# Chat-shell P0 — `/chat` foundation

## What shipped

- Route: `/chat` (protected) with Obsidian electric **light + dark** shell UI
- Tokens: `/design/chat-shell-obsidian-tokens.css` (linked from `index.html`)
- No FOUC: inline head script sets `data-theme` + `chat-shell-route` before paint on `/chat`
- Runtime flag: Supabase `app_feature_flags.chat_shell` (fail-closed)
- Legacy routes (`/scripts`, `/posts`, etc.) unchanged; FeedbackButton hidden on `/chat`

## Feature flag

| Environment | Supabase | Flag default | `/chat` behavior |
|-------------|----------|--------------|------------------|
| Production | AIIAN `lstzfxsdmggkoaxfawny` | keep `false` / table may be absent | Blocked friendly state (fail-closed) |
| Vercel Preview | IANAI-preview `adrwkzibhfdpwuycnzaa` | `false` until flipped | Blocked until SQL update below |
| Local | whatever `VITE_SUPABASE_*` points to | depends on DB | Same client logic |

**No `VITE_CHAT_SHELL` build-time flag.** Runtime Supabase row is authoritative.

### Flip flag on Preview only

```sql
-- IANAI-preview (adrwkzibhfdpwuycnzaa) ONLY — never run on AIIAN prod
UPDATE public.app_feature_flags
SET enabled = true, updated_at = now()
WHERE key = 'chat_shell';
```

Revert:

```sql
UPDATE public.app_feature_flags
SET enabled = false, updated_at = now()
WHERE key = 'chat_shell';
```

## Verify locally

1. `npm test` / `npm run build`
2. `npm run dev` → sign in
3. Visit `/chat` with flag false → blocked card (“Chat aún no está habilitado”)
4. Point env at preview DB (or local with 062), set flag true → shell loads
5. Toggle sun/moon; hard-reload `/chat` — first paint matches stored theme (no flash)
6. Smoke `/scripts` and `/posts` still work

## Verify on Vercel Preview

1. Confirm Preview env vars target `adrwkzibhfdpwuycnzaa` (URL + anon + service role paired)
2. Open Preview `/chat` while flag is false → blocked
3. Rafael flips flag true on preview only
4. Reload `/chat` → Obsidian shell; test light/dark + mobile drawers
5. Confirm production stays on AIIAN with flag off / no 062 apply

## Blank Preview screen (missing/invalid Vite env)

**Symptom:** After Vercel SSO, every route is a blank dark page; `#root` empty; console:
`Uncaught Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL` (or `supabaseUrl is required`).

**Cause:** Preview build missing or non-http(s) `VITE_SUPABASE_URL` / anon key. `createClient` used to throw at module init before React could mount.

**Code fix:** validate URL before `createClient`; show `ConfigErrorScreen` instead of crashing.

**Rafael — set Preview env (Vercel → Settings → Environment Variables → Preview), then redeploy:**

| Variable | Value |
|----------|--------|
| `VITE_SUPABASE_URL` | `https://adrwkzibhfdpwuycnzaa.supabase.co` (must include `https://`) |
| `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY` | from IANAI-preview dashboard (do not invent) |

Optional API pairing on Preview: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for the **same** preview project. Do not point Preview at production AIIAN.

Env changes require a **new Preview redeploy** (existing deployment keeps old build-time `VITE_*` values).

FOUC script in `index.html` only runs on `/chat` and cannot blank `/` or `/login`.

## Out of P0

Multi-offer generation, setup interview, image optimize, enabling prod flag, applying 062 to prod, merging.
