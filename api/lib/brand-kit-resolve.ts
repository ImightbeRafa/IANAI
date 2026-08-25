/**
 * Canonical brand-kit ↔ business resolution (no name matching at runtime).
 */

export type BrandKitResolution =
  | 'explicit'
  | 'primary'
  | 'sole_linked'
  | 'missing'
  | 'ambiguous'
  | 'inactive'

export type BrandKitRowLike = {
  id: string
  name: string
  business_id?: string | null
  is_active?: boolean | null
  is_default?: boolean | null
  is_primary_for_business?: boolean | null
  primary_color?: string | null
  secondary_color?: string | null
  accent_color?: string | null
  logo_url?: string | null
  tagline?: string | null
  brand_voice?: string | null
  tone_keywords?: string[] | null
  target_audience?: string | null
  visual_style_notes?: string | null
  font_primary?: string | null
  font_secondary?: string | null
  industry?: string | null
  must_use_phrases?: string[] | null
  forbidden_phrases?: string[] | null
  reference_images?: string[] | null
  style_dnas?: unknown
  created_at?: string | null
}

export function isActiveKit(kit: BrandKitRowLike): boolean {
  return kit.is_active !== false
}

/**
 * Pick the kit for a brand folder from already-fetched linked kits.
 * Prefer explicit id → primary → sole active linked → otherwise missing/ambiguous.
 */
export function resolveBrandKitForBusiness(options: {
  linkedKits: BrandKitRowLike[]
  brandKitId?: string | null
}): {
  kit: BrandKitRowLike | null
  resolution: BrandKitResolution
  linkedCount: number
  activeCount: number
} {
  const linked = options.linkedKits.filter((k) => Boolean(k.business_id))
  const active = linked.filter(isActiveKit)
  const linkedCount = linked.length
  const activeCount = active.length

  if (options.brandKitId) {
    const hit = linked.find((k) => k.id === options.brandKitId)
    if (!hit) {
      return { kit: null, resolution: 'missing', linkedCount, activeCount }
    }
    if (!isActiveKit(hit)) {
      return { kit: hit, resolution: 'inactive', linkedCount, activeCount }
    }
    return { kit: hit, resolution: 'explicit', linkedCount, activeCount }
  }

  const primaries = active.filter((k) => k.is_primary_for_business === true)
  if (primaries.length === 1) {
    return { kit: primaries[0], resolution: 'primary', linkedCount, activeCount }
  }
  if (primaries.length > 1) {
    // Unique index should prevent this; treat as ambiguous and pick none.
    return { kit: null, resolution: 'ambiguous', linkedCount, activeCount }
  }

  if (activeCount === 1) {
    return { kit: active[0], resolution: 'sole_linked', linkedCount, activeCount }
  }
  if (activeCount === 0) {
    return { kit: null, resolution: 'missing', linkedCount, activeCount }
  }
  return { kit: null, resolution: 'ambiguous', linkedCount, activeCount }
}

export function assertPublicHttpsUrl(url: string, label = 'url'): string {
  const trimmed = url.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  if (/^data:/i.test(trimmed) || trimmed.length > 8_000) {
    throw new Error(`${label} must be an https URL (no base64/data URLs)`)
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${label} is not a valid URL`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https`)
  }
  return trimmed
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return email ?? null
  const [user, domain] = email.split('@')
  if (!local || !domain) return '***'
  const keep = Math.min(2, local.length)
  return `${local.slice(0, keep)}***@${domain}`
}
