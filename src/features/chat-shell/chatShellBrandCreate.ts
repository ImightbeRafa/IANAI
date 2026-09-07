import type { BusinessFormData } from '../../types'

/** Minimal BusinessFormData for in-shell New brand (no ICP wizard). */
export function buildMinimalBrandFormData(name: string): BusinessFormData {
  return {
    name: name.trim(),
    sales_channels: [],
    does_shipping: false,
    target_audiences: [],
  }
}

export function validateBrandCreateName(name: string, language: 'es' | 'en' = 'es'): string | null {
  const trimmed = name.trim()
  if (!trimmed) {
    return language === 'es' ? 'El nombre de la marca es obligatorio' : 'Brand name is required'
  }
  if (trimmed.length > 120) {
    return language === 'es' ? 'El nombre de la marca es demasiado largo' : 'Brand name is too long'
  }
  return null
}

/** Normalize optional store URL for brand create / ingest kickoff. */
export function normalizeBrandWebsiteUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

export function validateBrandWebsiteUrl(raw: string, language: 'es' | 'en' = 'es'): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (normalizeBrandWebsiteUrl(trimmed)) return null
  return language === 'es'
    ? 'Pegá una URL válida (ej. https://tutienda.com)'
    : 'Paste a valid URL (e.g. https://yourstore.com)'
}

export interface BrandCreateInput {
  name: string
  websiteUrl?: string | null
}

export function parseBrandCreateInput(
  name: string,
  websiteRaw: string,
  language: 'es' | 'en' = 'es'
): { ok: true; name: string; websiteUrl: string | null } | { ok: false; error: string } {
  const nameError = validateBrandCreateName(name, language)
  if (nameError) return { ok: false, error: nameError }
  const urlError = validateBrandWebsiteUrl(websiteRaw, language)
  if (urlError) return { ok: false, error: urlError }
  return {
    ok: true,
    name: name.trim(),
    websiteUrl: normalizeBrandWebsiteUrl(websiteRaw),
  }
}
