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
