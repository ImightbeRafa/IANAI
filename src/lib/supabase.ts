import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.',
    'Ensure these are set in your Vercel project environment variables (with the VITE_ prefix).',
    'Current values:', { supabaseUrl: supabaseUrl ? '[SET]' : '[MISSING]', supabaseAnonKey: supabaseAnonKey ? '[SET]' : '[MISSING]' }
  )
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '')
