import { supabaseAdmin as supabase } from './supabase-admin.js'
import { isBloomDermalPatchSku } from './product-creative-rules.js'

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
      ? `REGLAS PERMANENTES Y FRASES PROHIBIDAS (NO NEGOCIABLES; interpreta cada entrada como instrucción): ${kit.forbidden_phrases.join(' | ')}`
      : `PERMANENT RULES AND FORBIDDEN PHRASES (NON-NEGOTIABLE; interpret every entry as an instruction): ${kit.forbidden_phrases.join(' | ')}`)
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
  const primary = kit.primary_color?.trim()
  const secondary = kit.secondary_color?.trim()
  const accent = kit.accent_color?.trim()
  const colors = [primary, secondary, accent].filter(Boolean)
  if (colors.length === 0) return null
  const roles = [
    primary ? `PRIMARIO (fondos, bloques, marca): ${primary}` : null,
    secondary ? `SECUNDARIO (apoyo, paneles): ${secondary}` : null,
    accent ? `ACENTO / CTA (botones, pips): ${accent}` : null,
  ].filter(Boolean).join('. ')
  return `USA SOLO ESTOS COLORES DE MARCA: ${colors.join(', ')}. ${roles}. Estos son los colores oficiales — NO uses ningún otro color fuera de esta paleta. PROHIBIDO azul genérico (#0000FF, #0066FF, #1877F2, Facebook/Instagram blue) salvo que esté en esta paleta. Ignora cualquier otro color mencionado en las instrucciones siguientes.`
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
export function buildBrandLogoPrompt(kit: BrandKitRow, language: 'es' | 'en' = 'es'): string | null {
  if (!kit.logo_url) return null
  const isES = language === 'es'
  const bloomSku = isBloomDermalPatchSku({ brandKitId: kit.id })
  const bloomLine = bloomSku
    ? (isES
      ? '- PROHIBIDO redibujar, reimaginar o reescribir con IA el wordmark "BLOOM" o el lockup "DERMAL MICRO-INFUSION PATCH".'
      : '- FORBIDDEN to redraw, reimagine, or re-typeset the "BLOOM" wordmark or "DERMAL MICRO-INFUSION PATCH" lockup with AI.')
    : (isES
      ? '- PROHIBIDO redibujar o reescribir el wordmark con IA.'
      : '- FORBIDDEN to redraw or re-typeset the wordmark with AI.')
  return `═══════════════════════════════════════════════
REGLA — LOGO DE MARCA (ESTAMPADO / NO REGENERACIÓN)
═══════════════════════════════════════════════
Se adjunta el archivo oficial del logo de "${kit.name}" como imagen raster inline.
- COMPÓSITALO / estampalo tal cual en esquina superior (izquierda o derecha), visible y nítido.
${bloomLine}
- PROHIBIDO generar subtítulos de marca inventados si el logo no los trae.
- Si hay conflicto con otros elementos, el logo adjunto gana — ajustá composición/fondo, no el logo.
- VIOLACIÓN = RESULTADO INVÁLIDO.
═══════════════════════════════════════════════`
}

/**
 * MIME types accepted by the Gemini image API for inline image inputs.
 * Anything outside this set will be rejected with 400 INVALID_ARGUMENT.
 * Ref: https://ai.google.dev/gemini-api/docs/image-generation
 */
const GEMINI_SUPPORTED_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg', // non-standard but sometimes returned by servers
  'image/webp',
  'image/heic',
  'image/heif',
])

/**
 * Infer a Gemini-compatible MIME type from a URL extension, used as a fallback when
 * the server returns a generic content-type (e.g. application/octet-stream).
 */
function inferMimeFromUrl(url: string): string | null {
  const clean = url.split('?')[0].split('#')[0].toLowerCase()
  if (clean.endsWith('.png')) return 'image/png'
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.heic')) return 'image/heic'
  if (clean.endsWith('.heif')) return 'image/heif'
  return null
}

/**
 * Fetch the brand kit logo from its URL and return as base64 data for inline Gemini usage.
 * Returns null if fetch fails, no logo is set, or the MIME type is not supported by Gemini
 * (e.g. .ico, .svg, .gif, .bmp). In those cases the caller will generate without the logo
 * rather than failing the whole image generation.
 */
export async function fetchBrandImageAsBase64(
  url: string,
  label = 'brand image'
): Promise<{ mimeType: string; data: string } | null> {
  if (!url) return null
  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      console.warn('Failed to fetch', label, resp.status, url)
      return null
    }
    const rawContentType = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()

    let effectiveMime: string | null = GEMINI_SUPPORTED_IMAGE_MIMES.has(rawContentType) ? rawContentType : null
    if (!effectiveMime) {
      const inferred = inferMimeFromUrl(url)
      if (inferred && GEMINI_SUPPORTED_IMAGE_MIMES.has(inferred)) {
        effectiveMime = inferred
      }
    }

    if (!effectiveMime) {
      console.warn(
        `${label} MIME type not supported by Gemini (got "${rawContentType || 'unknown'}"). Skipping.`
      )
      return null
    }

    if (effectiveMime === 'image/jpg') effectiveMime = 'image/jpeg'

    const buffer = await resp.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return { mimeType: effectiveMime, data: base64 }
  } catch (err) {
    console.warn('Error fetching', label, err)
    return null
  }
}

export async function fetchBrandLogoAsBase64(kit: BrandKitRow): Promise<{ mimeType: string; data: string } | null> {
  if (!kit.logo_url) return null
  return fetchBrandImageAsBase64(kit.logo_url, `brand logo "${kit.name}"`)
}

const BRAND_LOGO_BUCKET = 'post-images'

function isAlreadyHostedBrandLogo(url: string): boolean {
  return /\/storage\/v1\/object\/public\/post-images\//i.test(url) && /\/brand-kit\//i.test(url)
}

function logoSkipReason(url: string): 'svg' | null {
  const clean = url.split('?')[0].split('#')[0].toLowerCase()
  if (clean.endsWith('.svg') || clean.endsWith('.ico') || clean.endsWith('.gif')) return 'svg'
  return null
}

/**
 * Copy a remote raster logo into `post-images` so Gemini can fetch it later.
 * SVGs are not converted — caller should keep the original URL and warn.
 */
export async function rehostBrandLogo(
  userId: string,
  sourceUrl: string
): Promise<{ url: string; skipped?: 'svg' | 'fetch' } | null> {
  const url = sourceUrl.trim()
  if (!url || !userId || !supabase) return null
  if (isAlreadyHostedBrandLogo(url)) return { url }
  if (logoSkipReason(url) === 'svg') return { url, skipped: 'svg' }

  const img = await fetchBrandImageAsBase64(url, 'brand logo rehost')
  if (!img) return { url, skipped: 'fetch' }

  const ext = img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg'
  const path = `${userId}/brand-kit/logo-${Date.now()}.${ext}`
  const bytes = Buffer.from(img.data, 'base64')
  const { error } = await supabase.storage.from(BRAND_LOGO_BUCKET).upload(path, bytes, {
    contentType: img.mimeType,
    upsert: false,
  })
  if (error) {
    console.warn('rehost brand logo failed', error.message)
    return { url, skipped: 'fetch' }
  }
  const { data } = supabase.storage.from(BRAND_LOGO_BUCKET).getPublicUrl(path)
  return data.publicUrl ? { url: data.publicUrl } : { url, skipped: 'fetch' }
}

export async function fetchBrandStyleReferencesAsBase64(
  kit: BrandKitRow,
  limit = 2
): Promise<Array<{ mimeType: string; data: string }>> {
  const urls = (kit.reference_images || []).filter(Boolean).slice(0, limit)
  const out: Array<{ mimeType: string; data: string }> = []
  for (const url of urls) {
    const img = await fetchBrandImageAsBase64(url, `brand style ref "${kit.name}"`)
    if (img) out.push(img)
  }
  return out
}
