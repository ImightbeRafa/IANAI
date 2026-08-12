import type { BusinessFormData } from '../../types'

/** Minimal BusinessFormData for in-shell New brand (no ICP wizard). */
export function buildMinimalBrandFormData(name: string): BusinessFormData {
  return {
    name: name.trim(),
    sales_channels: ['messages'],
    does_shipping: false,
    target_audiences: [],
  }
}

export function validateBrandCreateName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Brand name is required'
  if (trimmed.length > 120) return 'Brand name is too long'
  return null
}
