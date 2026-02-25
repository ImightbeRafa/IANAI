import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

export interface BrandKitRow {
  id: string
  user_id: string
  name: string
  logo_url: string | null
  primary_color: string | null
  secondary_color: string | null
  accent_color: string | null
  brand_voice: string | null
  tone_keywords: string[]
  must_use_phrases: string[]
  forbidden_phrases: string[]
  is_active: boolean
}

/**
 * Load the active brand kit for a user (server-side, uses service role).
 */
export async function loadBrandKit(userId: string): Promise<BrandKitRow | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.warn('Failed to load brand kit:', error.message)
    return null
  }
  return data
}

/**
 * Build a brand voice prompt block to inject into script/reply system prompts.
 */
export function buildBrandVoicePrompt(kit: BrandKitRow, language: 'en' | 'es'): string {
  const parts: string[] = []

  if (language === 'es') {
    parts.push('=== IDENTIDAD DE MARCA (Brand Kit) ===')
  } else {
    parts.push('=== BRAND IDENTITY (Brand Kit) ===')
  }

  if (kit.brand_voice) {
    parts.push(language === 'es'
      ? `VOZ DE MARCA: ${kit.brand_voice}`
      : `BRAND VOICE: ${kit.brand_voice}`)
  }

  if (kit.tone_keywords.length > 0) {
    parts.push(language === 'es'
      ? `TONO: ${kit.tone_keywords.join(', ')}`
      : `TONE: ${kit.tone_keywords.join(', ')}`)
  }

  if (kit.must_use_phrases.length > 0) {
    parts.push(language === 'es'
      ? `FRASES OBLIGATORIAS (usa siempre que sea natural): ${kit.must_use_phrases.join(' | ')}`
      : `MUST-USE PHRASES (use whenever natural): ${kit.must_use_phrases.join(' | ')}`)
  }

  if (kit.forbidden_phrases.length > 0) {
    parts.push(language === 'es'
      ? `FRASES PROHIBIDAS (NUNCA usar): ${kit.forbidden_phrases.join(' | ')}`
      : `FORBIDDEN PHRASES (NEVER use): ${kit.forbidden_phrases.join(' | ')}`)
  }

  // Only return block if there's actual content beyond the header
  if (parts.length <= 1) return ''
  return parts.join('\n')
}

/**
 * Build brand color override string for image generation prompts.
 * Returns null if no brand colors are set.
 */
export function buildBrandColorOverride(kit: BrandKitRow): string | null {
  const colors = [kit.primary_color, kit.secondary_color, kit.accent_color].filter(Boolean)
  if (colors.length === 0) return null
  return `USA SOLO ESTOS COLORES DE MARCA: ${colors.join(', ')}. Estos son los colores oficiales de la marca, úsalos como colores dominantes en el diseño.`
}
