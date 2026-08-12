import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || ''
const rawKey = (
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
  || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  || ''
).trim()

/** True only for http(s) URLs — matches @supabase/supabase-js createClient validation. */
export function isValidSupabaseUrl(value: string): boolean {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const urlOk = isValidSupabaseUrl(rawUrl)
const keyOk = rawKey.length > 0

export const isSupabaseConfigured = urlOk && keyOk

export function getSupabaseConfigError(): string | null {
  if (isSupabaseConfigured) return null

  const problems: string[] = []
  if (!rawUrl) {
    problems.push('VITE_SUPABASE_URL is missing')
  } else if (!urlOk) {
    problems.push(
      `VITE_SUPABASE_URL is invalid (got "${rawUrl.slice(0, 80)}"). Must be a full http(s) URL, e.g. https://adrwkzibhfdpwuycnzaa.supabase.co`
    )
  }
  if (!keyOk) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY is missing')
  }

  return (
    `${problems.join('. ')}. `
    + 'Set these on the Vercel Preview environment for IANAI-preview '
    + '(https://adrwkzibhfdpwuycnzaa.supabase.co), then redeploy Preview.'
  )
}

/**
 * createClient throws at module init when url is empty/invalid
 * ("supabaseUrl is required" / "Must be a valid HTTP or HTTPS URL"),
 * which leaves #root empty. Never call createClient with bad input —
 * use a harmless placeholder only so ConfigErrorScreen can mount.
 */
function createSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    if (import.meta.env.DEV) {
      console.error(getSupabaseConfigError())
    }
    return createClient('https://config-missing.invalid', 'public-anon-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  }
  return createClient(rawUrl, rawKey)
}

export const supabase = createSupabaseClient()
