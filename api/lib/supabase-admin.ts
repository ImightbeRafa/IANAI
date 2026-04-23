import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
export const supabaseAdminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

let adminClient: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAdminKey) return null

  if (!adminClient) {
    adminClient = createClient(supabaseUrl, supabaseAdminKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  }

  return adminClient
}

export const supabaseAdmin = getSupabaseAdmin()
