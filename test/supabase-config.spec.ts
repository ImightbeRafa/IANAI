import { describe, expect, it } from 'vitest'
import { isValidSupabaseUrl } from '../src/lib/supabase'

/**
 * Production blank-screen failure mode:
 * @supabase/supabase-js createClient throws at module evaluation when url is
 * empty ("supabaseUrl is required") or not http(s)
 * ("Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL") — before React mounts.
 */
describe('supabase client bootstrap', () => {
  it('accepts only http(s) URLs', () => {
    expect(isValidSupabaseUrl('https://adrwkzibhfdpwuycnzaa.supabase.co')).toBe(true)
    expect(isValidSupabaseUrl('http://localhost:54321')).toBe(true)
    expect(isValidSupabaseUrl('')).toBe(false)
    expect(isValidSupabaseUrl('adrwkzibhfdpwuycnzaa.supabase.co')).toBe(false)
    expect(isValidSupabaseUrl('not a url')).toBe(false)
  })

  it('createClient throws on empty url (historical crash)', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    expect(() => createClient('', '')).toThrow(/supabaseUrl is required/i)
  })

  it('createClient throws on non-http url (Preview blank-screen error)', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    expect(() => createClient('not-a-valid-url', 'anon-key')).toThrow(/valid HTTP or HTTPS URL/i)
  })

  it('accepts a placeholder so ConfigErrorScreen can mount when misconfigured', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    expect(() =>
      createClient('https://config-missing.invalid', 'public-anon-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    ).not.toThrow()
  })
})
