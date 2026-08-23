export type BusinessContentDeletionStep =
  | { type: 'detach-brand-kits'; businessId: string }
  | { type: 'session'; id: string }
  | { type: 'product'; id: string }
  | { type: 'verify-products' }
  | { type: 'business'; id: string }

export interface BusinessContentDeletionFns {
  detachBrandKits: (businessId: string) => Promise<number>
  deleteSession: (sessionId: string) => Promise<void>
  deleteProduct: (productId: string) => Promise<void>
  getRemainingProductIds: () => Promise<string[]>
  deleteBusinessRow: (businessId: string) => Promise<void>
}

export function planBusinessContentDeletion(input: {
  businessId: string
  sessionIds: string[]
  productIds: string[]
}): BusinessContentDeletionStep[] {
  if (!input.businessId) {
    throw new Error('Folder delete failed: missing folder id.')
  }
  return [
    { type: 'detach-brand-kits', businessId: input.businessId },
    ...input.sessionIds.filter(Boolean).map((id) => ({ type: 'session' as const, id })),
    ...input.productIds.filter(Boolean).map((id) => ({ type: 'product' as const, id })),
    { type: 'verify-products' },
    { type: 'business', id: input.businessId },
  ]
}

export function assertProductDeleteResult(
  data: Array<{ id: string }> | null | undefined
): void {
  if (!data || data.length === 0) {
    throw new Error('Product was not deleted (RLS or missing). Refresh and try again.')
  }
}

export function assertBusinessProductsCleared(
  remaining: Array<{ id: string }> | string[] | null | undefined
): void {
  if (remaining == null) {
    throw new Error('Folder delete blocked: could not verify products were removed (RLS or missing).')
  }
  if (remaining.length > 0) {
    throw new Error(
      `Folder delete blocked: ${remaining.length} product(s) still linked after delete.`
    )
  }
}

export async function runBusinessContentDeletion(
  steps: BusinessContentDeletionStep[],
  fns: BusinessContentDeletionFns
): Promise<void> {
  for (const step of steps) {
    switch (step.type) {
      case 'detach-brand-kits':
        await fns.detachBrandKits(step.businessId)
        break
      case 'session':
        await fns.deleteSession(step.id)
        break
      case 'product':
        await fns.deleteProduct(step.id)
        break
      case 'verify-products': {
        const remaining = await fns.getRemainingProductIds()
        assertBusinessProductsCleared(remaining)
        break
      }
      case 'business':
        await fns.deleteBusinessRow(step.id)
        break
      default: {
        const _never: never = step
        void _never
        throw new Error('Unhandled folder delete step')
      }
    }
  }
}
