/**
 * Which product_images rows are reusable kit refs (not generated posts).
 * Keep in sync with `isGeneratedOfferImage` in chatShellImages.ts:
 * kind=product|context stays a ref even when message_id is set.
 */
export function isReusableProductReference(row: {
  kind?: string | null
  message_id?: string | null
}): boolean {
  if (row.kind === 'generated') return false
  if (row.kind === 'product' || row.kind === 'context') return true
  return !row.message_id
}
