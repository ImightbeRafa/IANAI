// Env var names forwarded from the Cloudflare Worker to the AdvanceAiContainer,
// and from server.mjs's process.env to the health response. Names only — no
// values live here. Shared by the Worker, the parity scripts and tests.
//
// VERCEL_ENV is deliberately excluded: APP_ENV replaces it on Cloudflare.
//
// ADVANCE_RUNTIME is deliberately excluded too (round-6 operator review,
// item F): server.mjs now stamps it unconditionally on every boot, so no
// Worker var or env value could ever be used to switch the handler's
// fail-closed 503 gate off by forwarding a spoofed value. It's still read in
// api/mcp-guide-analysis.ts (process.env.ADVANCE_RUNTIME), so the "every
// process.env.X read in api/ must be in CONTAINER_ENV_KEYS" test carries an
// explicit, documented exception for it, same as VERCEL_ENV.
export const CONTAINER_ENV_KEYS = Object.freeze([
  'APP_ENV',
  'ENABLE_CRONS',
  'CRON_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'GROK_API_KEY',
  'XAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_IMAGE_MODEL',
  'FAL_KEY',
  'BFL_API_KEY',
  'TILOPAY_API_KEY',
  'TILOPAY_API_USER',
  'TILOPAY_API_PASSWORD',
  'TILOPAY_WEBHOOK_SECRET',
  'TICKETS_EVENT_WEBHOOK_URL',
  'TICKETS_WEBHOOK_SECRET',
  'CREDITS_V1',
  'VITE_CREDITS_V1',
  'CHAT_SHELL_OPEN_GIFT',
  'APP_ORIGIN',
  'VITE_APP_ORIGIN',
  'GUIONES_DRAFT_MODEL_EFFICIENT',
  'GUIONES_SKIP_ANGLES_MAX_COUNT',
  'SHUTDOWN_DRAIN_MS',
])

export function getContainerEnvVars(source) {
  const out = {}
  for (const key of CONTAINER_ENV_KEYS) {
    if (typeof source[key] === 'string') out[key] = source[key]
  }
  return out
}

// cronsEnabled moved to api/lib/crons-enabled.ts (round-6 operator review,
// item E) — the one shared implementation used by both the Worker-side gate
// (cf/worker-core.ts's handleScheduled, which imports it directly) and the
// handler-level guard in api/mcp-guide-analysis.ts. It's NOT re-exported
// from here: this file is loaded directly by plain Node in
// scripts/parity/env-diff.mjs (no bundler, no TS loader), which can't
// resolve an extensionless import of a .ts file — only the bundled/
// transpiled consumers (the Worker build, vitest) can.
