/**
 * Shared MCP helpers: product-reference gates + price/placeholder utilities for EXECUTE.
 */

import { GROK_NATIVE_ASPECT_RATIOS, resolveGrokAspectRatio } from '../grok-image-edit.js'

export { GROK_NATIVE_ASPECT_RATIOS, resolveGrokAspectRatio }

/** Ratios chat-shell asks for that Grok Imagine does not natively support. */
export const GROK_UNSUPPORTED_SHELL_RATIOS = ['4:5', '5:4'] as const

export type McpReferenceMode = 'use' | 'none'

export function parseReferenceMode(value: unknown): McpReferenceMode | undefined {
  if (value === 'use' || value === 'none') return value
  return undefined
}

/** Hard gate before image/post/pack/carousel EXECUTE when product fidelity is required. */
export function assertProductReferenceGate(options: {
  productRefCount: number
  referenceMode?: McpReferenceMode
  referenceImageIds?: string[]
  productImageId?: string | null
  requireProduct?: boolean
  /**
   * Bulk/campaign historically use all offer product URLs without per-id confirm.
   * When true and the offer already has product refs, omitting ids is OK.
   */
  allowImplicitOfferRefs?: boolean
  toolName: string
}): void {
  const requireProduct = options.requireProduct !== false
  if (!requireProduct) return
  if (options.referenceMode === 'none') {
    throw new Error(
      `${options.toolName}: referenceMode "none" skips product fidelity. ` +
        'For ads/posts that show the product, set referenceMode "use" and confirm product image ids from list_assets (kind=product).'
    )
  }
  const hasExplicitIds =
    (options.referenceImageIds && options.referenceImageIds.length > 0) ||
    Boolean(options.productImageId)
  if (options.productRefCount <= 0 && !hasExplicitIds) {
    throw new Error(
      `${options.toolName}: no product reference images on this offer. ` +
        'Call list_assets(kind=product). If empty, ask the user to attach a product shot ' +
        '(workspace_save_artifact kind=product + https URL, or /chat intake=asset), then pass productImageId / referenceImageIds.'
    )
  }
  if (options.productRefCount <= 0 && hasExplicitIds) {
    return
  }
  if (!hasExplicitIds && options.productRefCount > 0) {
    if (options.allowImplicitOfferRefs) return
    throw new Error(
      `${options.toolName}: product images exist but none were confirmed. ` +
        'List them with list_assets(kind=product), ask the user which to use (and optional scene/style context refs), ' +
        'then retry with productImageId and/or referenceImageIds (max 4).'
    )
  }
}

export function mapPriceRangeLabel(priceRange: string | null | undefined, language: 'es' | 'en' = 'es'): string | null {
  if (!priceRange) return null
  const key = priceRange.trim().toLowerCase()
  const map: Record<string, { es: string; en: string }> = {
    economico: {
      es: 'rango de precio accesible (valor por dinero) — no digas "opción económica" ni el enum',
      en: 'affordable price positioning (value for money) — never print the enum key',
    },
    medio: {
      es: 'rango de precio medio (equilibrio calidad/precio)',
      en: 'mid-range price positioning (quality/price balance)',
    },
    premium: {
      es: 'rango de precio premium (exclusividad y calidad superior)',
      en: 'premium price positioning (exclusivity and higher quality)',
    },
  }
  const hit = map[key]
  if (!hit) return null
  return language === 'en' ? hit.en : hit.es
}

/** True when a token looks like an unresolved script placeholder. */
export function hasUnresolvedScriptPlaceholder(text: string): boolean {
  return /\[[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 _./-]{1,60}\]/.test(text)
}

export function listUnresolvedScriptPlaceholders(text: string): string[] {
  const matches = text.match(/\[[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 _./-]{1,60}\]/g) || []
  return [...new Set(matches)]
}

export function looksLikeExactPrice(value: string | null | undefined): boolean {
  if (!value) return false
  const t = value.trim()
  if (!t) return false
  if (/^(economico|medio|premium)$/i.test(t)) return false
  return /[₡$€]|^\d|\d[.,]\d/.test(t)
}
