/**
 * Validate that required environment variables are set.
 * Call at the top of API handlers for early failure with clear error messages.
 * Does NOT throw — returns a list of missing vars for the caller to handle.
 */

interface EnvCheckResult {
  ok: boolean
  missing: string[]
}

export function checkRequiredEnvVars(vars: readonly string[]): EnvCheckResult {
  const missing = vars.filter(v => !process.env[v])
  return { ok: missing.length === 0, missing }
}

/**
 * Common env var groups for different API endpoints
 */
export const ENV_GROUPS = {
  supabase: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  grok: ['GROK_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  tilopay: ['TILOPAY_WEBHOOK_SECRET']
} as const
