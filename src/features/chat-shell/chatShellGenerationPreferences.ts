import type { BrandKit } from '../../types'

export interface StorageLike {
  getItem(key: string): string | null
}

/**
 * Workplace default: memory on unless explicitly disabled in localStorage.
 */
export function readAiMemoryEnabled(storage: StorageLike | null | undefined): boolean {
  if (!storage) return true
  const stored = storage.getItem('ai_memory_enabled')
  if (stored === null) return true
  return stored !== 'false'
}

/**
 * Resolve brand kit like BrandKitSelector / ProductWorkspace:
 * valid `bk_${productId}` → active default kit → undefined.
 */
export function resolveBrandKitIdForProduct(
  productId: string | null | undefined,
  activeKits: ReadonlyArray<Pick<BrandKit, 'id' | 'is_default' | 'is_active'>>,
  storage: StorageLike | null | undefined
): string | undefined {
  const kits = activeKits.filter((k) => k.is_active !== false)
  if (kits.length === 0) return undefined

  if (productId && storage) {
    const stored = storage.getItem(`bk_${productId}`)
    if (stored && kits.some((k) => k.id === stored)) {
      return stored
    }
  }

  const defaultKit = kits.find((k) => k.is_default)
  return defaultKit?.id
}

/** Session Brand Kit wins over product-localStorage and the workspace default. */
export function resolveBrandKitIdForSession(
  sessionKitId: string | null | undefined,
  productId: string | null | undefined,
  activeKits: ReadonlyArray<Pick<BrandKit, 'id' | 'is_default' | 'is_active'>>,
  storage: StorageLike | null | undefined
): string | undefined {
  const trimmed = typeof sessionKitId === 'string' ? sessionKitId.trim() : ''
  const kits = activeKits.filter((k) => k.is_active !== false)
  if (trimmed) {
    // Empty list usually means kits have not hydrated yet — keep the session kit.
    if (kits.length === 0 || kits.some((k) => k.id === trimmed)) return trimmed
  }
  return resolveBrandKitIdForProduct(productId, activeKits, storage)
}

export type BrandVisualFallback = {
  primary_color?: string | null
  secondary_color?: string | null
  accent_color?: string | null
  logo_url?: string | null
}

function hexOrEmpty(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed
}

export function collectBrandGenerateVisual(
  kit: BrandVisualFallback | null | undefined,
  fallback?: BrandVisualFallback | null
): { customColors?: string[]; brandLogoUrl?: string } {
  const colors = [
    hexOrEmpty(kit?.primary_color) || hexOrEmpty(fallback?.primary_color),
    hexOrEmpty(kit?.secondary_color) || hexOrEmpty(fallback?.secondary_color),
    hexOrEmpty(kit?.accent_color) || hexOrEmpty(fallback?.accent_color),
  ].filter(Boolean)
  const logo = hexOrEmpty(kit?.logo_url) || hexOrEmpty(fallback?.logo_url)
  return {
    ...(colors.length ? { customColors: colors } : {}),
    ...(logo ? { brandLogoUrl: logo } : {}),
  }
}

/** Drop unresolved script tokens like [TIEMPO DE ENTREGA] so they never land on a post. */
export function stripUnresolvedPlaceholders(text: string): string {
  return (text || '')
    .replace(/\[[^\]\n]{2,80}\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function looksLikeCondensedPostCopy(text: string): boolean {
  const cleaned = stripUnresolvedPlaceholders(text)
  const words = cleaned.split(/\s+/).filter(Boolean)
  return words.length > 0 && words.length <= 48 && !/\[[^\]\n]{2,}\]/.test(text)
}

/** User-approved post preview copy must not be condensed a second time. */
export function shouldSkipPostCondense(options: {
  scriptText?: string | null
  alreadyOptimized?: boolean
}): boolean {
  if (options.alreadyOptimized) return true
  return Boolean(options.scriptText && looksLikeCondensedPostCopy(options.scriptText))
}
