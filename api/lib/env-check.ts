/**
 * Validate that required environment variables are set.
 * Call at the top of API handlers for early failure with clear error messages.
 * Does NOT throw — returns a list of missing vars for the caller to handle.
 *
 * Each entry can be a single var name OR an array of fallbacks (e.g. ['SUPABASE_URL', 'VITE_SUPABASE_URL']).
 * A fallback group passes if ANY of its vars is set.
 */

interface EnvCheckResult {
  ok: boolean
  missing: string[]
}

export function checkRequiredEnvVars(vars: readonly (string | readonly string[])[]): EnvCheckResult {
  const missing: string[] = []
  for (const entry of vars) {
    if (typeof entry === 'string') {
      if (!process.env[entry]) missing.push(entry)
    } else {
      // Fallback group — pass if any is set
      const found = entry.some(v => !!process.env[v])
      if (!found) missing.push(entry.join(' | '))
    }
  }
  return { ok: missing.length === 0, missing }
}

/**
 * Common env var groups for different API endpoints.
 * Supabase URL uses fallback pattern matching the rest of the backend:
 *   process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
 */
export const ENV_GROUPS = {
  supabase: [['SUPABASE_URL', 'VITE_SUPABASE_URL'], 'SUPABASE_SERVICE_ROLE_KEY'] as const,
  grok: ['GROK_API_KEY'] as const,
  gemini: ['GEMINI_API_KEY'] as const,
  tilopay: ['TILOPAY_WEBHOOK_SECRET'] as const
}
