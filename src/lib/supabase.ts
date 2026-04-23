import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.',
    'Set VITE_SUPABASE_PUBLISHABLE_KEY in Vercel. VITE_SUPABASE_ANON_KEY remains supported only as a legacy fallback.',
    'Current values:', { supabaseUrl: supabaseUrl ? '[SET]' : '[MISSING]', supabasePublishableKey: supabasePublishableKey ? '[SET]' : '[MISSING]' }
  )
}

export const supabase = createClient(supabaseUrl || '', supabasePublishableKey || '')
