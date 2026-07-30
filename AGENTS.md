# AGENTS.md

## Cursor Cloud specific instructions

Product: **Advance AI / CopywriteAI** — a Vite + React + TypeScript SPA that generates ad scripts, images, and posts, backed by Supabase (auth/Postgres) and several AI providers (Grok/xAI, Gemini, etc.).

### Services & how to run them
- **Frontend SPA** — `npm run dev` (Vite dev server on port `5173`). This is the primary dev workflow and serves the whole app UI.
- **Backend API** — the functions in `api/*.ts` are **Vercel serverless functions**, not an Express server. Plain `npm run dev` does NOT serve `/api/*`; use `npm run dev:vercel` (`vercel dev`) for that, which requires a logged-in/linked Vercel project. Auth, the dashboard, and most Supabase-backed reads/writes work without the backend because the frontend talks to Supabase directly via `@supabase/supabase-js`. Only AI generation (scripts/images/posts) and payment/webhook flows need the API functions running.

### Standard commands (see `package.json` / `README.md`)
- Tests: `npm test` (`vitest run`) — small suite under `test/` covering `api/lib/guiones`.
- Build + typecheck: `npm run build` (`tsc -b && vite build`).
- **Lint: there is NO lint setup.** `README.md` mentions `npm run lint`, but there is no `lint` script and no ESLint config in the repo, so that command does not exist. Use `npm run build` for type checking.

### Environment variables (non-obvious)
- Secrets are injected as environment variables; **no `.env` file is required**. Vite exposes `VITE_`-prefixed vars from `process.env`, so the frontend picks up `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` automatically.
- Frontend uses `VITE_SUPABASE_PUBLISHABLE_KEY` and falls back to `VITE_SUPABASE_ANON_KEY` (the fallback is what's currently set). Backend falls back from `SUPABASE_SECRET_KEY` to `SUPABASE_SERVICE_ROLE_KEY` and from `SUPABASE_URL` to `VITE_SUPABASE_URL`.
- Optional/unset provider keys that only affect specific features: `OPENAI_API_KEY`, `FAL_KEY`.

### Testing auth end-to-end
- Email confirmation is enabled on the Supabase project: the signup UI creates the user then shows a "check your email" screen, so a fresh signup can't immediately log in. To get a usable login for testing, create a **pre-confirmed** user via the Supabase admin API using `SUPABASE_SERVICE_ROLE_KEY` (POST `"$VITE_SUPABASE_URL/auth/v1/admin/users"` with `{"email":...,"password":...,"email_confirm":true}`), then sign in through the UI. Password rules: min 8 chars, at least one uppercase, one lowercase, one digit.
