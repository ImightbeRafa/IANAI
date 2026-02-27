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
  font_primary: string | null
  font_secondary: string | null
  tagline: string | null
  industry: string | null
  target_audience: string | null
  brand_voice: string | null
  tone_keywords: string[]
  must_use_phrases: string[]
  forbidden_phrases: string[]
  visual_style_notes: string | null
  reference_images: string[]
  is_active: boolean
  is_default: boolean
  client_id: string | null
}

/**
 * Load a specific brand kit by ID (server-side, uses service role).
 * Enforces ownership: kit must belong to the given userId.
 */
export async function loadBrandKitById(userId: string, kitId: string): Promise<BrandKitRow | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('id', kitId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.warn('Failed to load brand kit by id:', error.message)
    return null
  }
  return data
}

/**
 * Load the default active brand kit for a user (fallback when no kitId provided).
 */
export async function loadBrandKit(userId: string): Promise<BrandKitRow | null> {
  if (!supabase) return null
  // Try default kit first
  const { data: defaultKit, error: e1 } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle()

  if (!e1 && defaultKit) return defaultKit

  // Fallback: any active kit
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('Failed to load brand kit:', error.message)
    return null
  }
  return data
}

/**
 * Resolve brand kit: use specific kitId if provided, otherwise return null.
 * The frontend handles default-kit UX (BrandKitSelector auto-selects).
 * The backend trusts whatever the frontend sends — no auto-fallback.
 */
export async function resolveBrandKit(userId: string, brandKitId?: string): Promise<BrandKitRow | null> {
  if (brandKitId) {
    return loadBrandKitById(userId, brandKitId)
  }
  return null
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

  if (kit.name && kit.name !== 'My Brand') {
    parts.push(language === 'es'
      ? `MARCA: ${kit.name}`
      : `BRAND: ${kit.name}`)
  }

  if (kit.tagline) {
    parts.push(language === 'es'
      ? `TAGLINE: ${kit.tagline}`
      : `TAGLINE: ${kit.tagline}`)
  }

  if (kit.industry) {
    parts.push(language === 'es'
      ? `INDUSTRIA: ${kit.industry}`
      : `INDUSTRY: ${kit.industry}`)
  }

  if (kit.target_audience) {
    parts.push(language === 'es'
      ? `AUDIENCIA OBJETIVO: ${kit.target_audience}`
      : `TARGET AUDIENCE: ${kit.target_audience}`)
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

/**
 * Build a visual style prompt block for image generation.
 * Includes fonts, AI-extracted visual notes, and brand context.
 * Returns null if no visual data is available.
 */
export function buildBrandVisualPrompt(kit: BrandKitRow): string | null {
  const parts: string[] = []

  if (kit.font_primary) {
    parts.push(`TIPOGRAFÍA PRINCIPAL: ${kit.font_primary}${kit.font_secondary ? ` | SECUNDARIA: ${kit.font_secondary}` : ''}`)
  }

  if (kit.tagline) {
    parts.push(`TAGLINE DE MARCA (incluir cuando sea relevante): ${kit.tagline}`)
  }

  if (kit.visual_style_notes) {
    parts.push(`GUÍA DE ESTILO VISUAL (extraída de referencias de la marca):\n${kit.visual_style_notes}`)
  }

  if (parts.length === 0) return null
  return parts.join('\n')
}

/**
 * Build a logo injection prompt for image generation.
 * Instructs the AI to incorporate the brand logo in the design.
 * Returns null if no logo is set.
 */
export function buildBrandLogoPrompt(kit: BrandKitRow): string | null {
  if (!kit.logo_url) return null
  return `═══════════════════════════════════════════════
REGLA — LOGO DE MARCA (NO NEGOCIABLE / MÁXIMA PRIORIDAD)
═══════════════════════════════════════════════
Se adjunta el logotipo oficial de la marca "${kit.name}" como imagen inline.
- DEBES incluir este logo en el diseño final, reproduciéndolo FIELMENTE.
- Posiciónalo de forma prominente: esquina superior izquierda, superior derecha, o centrado arriba.
- El logo DEBE ser claramente visible, legible, y mantener sus proporciones originales.
- NO modifiques, NO rediseñes, NO reimagines el logo — cópialo tal cual de la referencia adjunta.
- Si hay conflicto entre el logo y otros elementos, el logo GANA. Ajusta los demás elementos.
- VIOLACIÓN DE ESTA REGLA = RESULTADO INVÁLIDO.
═══════════════════════════════════════════════`
}

/**
 * Fetch the brand kit logo from its URL and return as base64 data for inline Gemini usage.
 * Returns null if fetch fails or no logo is set.
 */
export async function fetchBrandLogoAsBase64(kit: BrandKitRow): Promise<{ mimeType: string; data: string } | null> {
  if (!kit.logo_url) return null
  try {
    const resp = await fetch(kit.logo_url)
    if (!resp.ok) {
      console.warn('Failed to fetch brand logo:', resp.status, kit.logo_url)
      return null
    }
    const contentType = resp.headers.get('content-type') || 'image/webp'
    const buffer = await resp.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return { mimeType: contentType, data: base64 }
  } catch (err) {
    console.warn('Error fetching brand logo for inline injection:', err)
    return null
  }
}
