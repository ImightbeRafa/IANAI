/**
 * Permanent brand delete contract for MCP/web:
 * delete everything under the brand; keep brand_kits (detach business_id).
 */

export type McpBrandDeletePreview = {
  brandId: string
  brandName: string
  sessionCount: number
  offerCount: number
  kitCountPreserved: number
  warning: string
  requireTypedName: string
}

export type McpBrandDeletePlanStep =
  | { type: 'detach-brand-kits'; businessId: string }
  | { type: 'session'; id: string }
  | { type: 'product'; id: string }
  | { type: 'verify-products' }
  | { type: 'business'; id: string }

export function buildMcpBrandDeletePreview(options: {
  brandId: string
  brandName: string
  sessionCount: number
  offerCount: number
  kitCount: number
}): McpBrandDeletePreview {
  return {
    brandId: options.brandId,
    brandName: options.brandName,
    sessionCount: options.sessionCount,
    offerCount: options.offerCount,
    kitCountPreserved: options.kitCount,
    requireTypedName: options.brandName,
    warning:
      'This permanently deletes the brand folder, offers, sessions, and generated assets. '
      + 'Brand kits are kept and can be deleted separately. This cannot be undone.',
  }
}

export function assertTypedBrandNameConfirm(options: {
  brandName: string
  typedName: string
}): void {
  assertTypedConfirm(options.brandName, options.typedName, 'Type the exact brand name to confirm permanent delete')
}

export const MCP_DELETE_ASSET_CONFIRM = 'DELETE'

export function assertTypedConfirm(expected: string, typed: string, message: string): void {
  if ((typed || '').trim() !== (expected || '').trim()) {
    throw new Error(message)
  }
}

export function assertTypedOfferNameConfirm(options: {
  offerName: string
  typedName: string
}): void {
  assertTypedConfirm(options.offerName, options.typedName, 'Type the exact offer name to confirm permanent delete')
}

export function assertTypedAssetDeleteConfirm(typed: string): void {
  assertTypedConfirm(MCP_DELETE_ASSET_CONFIRM, typed, `Type ${MCP_DELETE_ASSET_CONFIRM} to confirm permanent asset delete`)
}

export function assertTypedArchiveConfirm(options: {
  brandName: string
  typedName: string
}): void {
  assertTypedConfirm(options.brandName, options.typedName, 'Type the exact brand name to confirm archive')
}

export function planMcpBrandDelete(options: {
  businessId: string
  sessionIds: string[]
  productIds: string[]
}): McpBrandDeletePlanStep[] {
  if (!options.businessId) throw new Error('Folder delete failed: missing folder id.')
  return [
    { type: 'detach-brand-kits', businessId: options.businessId },
    ...options.sessionIds.filter(Boolean).map((id) => ({ type: 'session' as const, id })),
    ...options.productIds.filter(Boolean).map((id) => ({ type: 'product' as const, id })),
    { type: 'verify-products' },
    { type: 'business', id: options.businessId },
  ]
}
