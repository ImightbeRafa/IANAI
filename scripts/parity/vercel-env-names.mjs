// Names (never values) of the environment variables actually configured on
// the real Vercel project for this app.
//
// Source: read-only Vercel audit, 2026-10-06, of Vercel project `ianai`
// (`prj_tn7ff72gObyrNg99HhdfEGdFx6oK`), /workspace/vercel-deps/advance-cloudflare-brief.md
// §3 "Env vars on Vercel (names only, all user-set; no marketplace-injected
// vars, all `configurationId: null`)". Names only — the audit could not read
// sensitive values back from Vercel either.
//
// VERCEL_ENV is platform-injected (Vercel sets it automatically; nobody
// configures it in the dashboard) and is deliberately NOT in this list — see
// env-diff.mjs, which subtracts it explicitly when comparing against
// CONTAINER_ENV_KEYS.
//
// Everything else the code reads (SUPABASE_URL, SUPABASE_SECRET_KEY,
// XAI_API_KEY, OPENAI_IMAGE_MODEL, APP_ORIGIN/VITE_APP_ORIGIN,
// CHAT_SHELL_OPEN_GIFT, GUIONES_*, CRON_SECRET's sibling CREDITS_V1/
// VITE_CREDITS_V1, etc.) is picked up separately by env-diff.mjs's
// api/src source scan, not listed here, because the audit found it
// optional/unset on Vercel rather than configured — except the handful
// below that the audit explicitly confirmed ARE configured.
//
// FAL_KEY and BFL_API_KEY are confirmed configured but unused in code today
// (see env-diff.mjs's unusedVercelNames) — kept, not dropped.
export const VERCEL_ENV_NAMES = [
  'TICKETS_EVENT_WEBHOOK_URL',
  'TICKETS_WEBHOOK_SECRET',
  'VITE_CREDITS_V1',
  'CREDITS_V1',
  'CRON_SECRET',
  'OPENAI_API_KEY',
  'FAL_KEY',
  'GEMINI_API_KEY',
  'TILOPAY_API_USER',
  'TILOPAY_API_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TILOPAY_WEBHOOK_SECRET',
  'TILOPAY_API_KEY',
  'BFL_API_KEY',
  'GROK_API_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
]
