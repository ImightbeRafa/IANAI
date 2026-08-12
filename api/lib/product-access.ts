import { supabaseAdmin as supabase } from './supabase-admin.js'

/**
 * Verify the authenticated user owns the product or is an accepted collaborator.
 * Used by service-role endpoints that bypass RLS.
 *
 * Chat-shell follow-up: extend with session/offer/business checks before cutover.
 * See docs/security/chat-shell-api-authorization.md (P-1 plan; routes unchanged here).
 */
export async function userHasProductAccess(userId: string, productId: string): Promise<boolean> {
  if (!supabase) return false

  const { data: product } = await supabase
    .from('products')
    .select('id, owner_id')
    .eq('id', productId)
    .maybeSingle()

  if (!product) return false
  if (product.owner_id === userId) return true

  const { data: collab } = await supabase
    .from('product_collaborators')
    .select('id')
    .eq('product_id', productId)
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .maybeSingle()

  return !!collab
}
