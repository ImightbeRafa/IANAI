// Env var names forwarded from the Cloudflare Worker to the AdvanceAiContainer,
// and from server.mjs's process.env to the health response. Names only — no
// values live here. Shared by the Worker, the parity scripts and tests.
//
// VERCEL_ENV is deliberately excluded: APP_ENV replaces it on Cloudflare.
export const CONTAINER_ENV_KEYS = Object.freeze([
  'APP_ENV',
  'DISABLE_CRONS',
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

export function cronsDisabled(source) {
  const v = (source.DISABLE_CRONS ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}
