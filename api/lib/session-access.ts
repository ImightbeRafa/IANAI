import { supabaseAdmin as supabase } from './supabase-admin.js'
import { userHasProductAccess } from './product-access.js'
import { authorizeSessionOfferProduct } from './session-offer-auth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export interface ChatSessionRow {
  id: string
  user_id: string
  business_id: string | null
  product_id: string | null
  title: string
  context: string | null
  primary_channel: string | null
  awareness_level: string | null
}

export interface SessionAccessOk {
  ok: true
  session: ChatSessionRow
  /** Authoritative product for this call (must ∈ offers, or legacy session.product_id). */
  productId: string
  offerProductIds: string[]
  mode: 'offers' | 'legacy'
}

export interface SessionAccessErr {
  ok: false
  status: number
  error: string
}

/**
 * Chat-shell authz for /api/chat:
 * - User must own the session (user_id).
 * - Load offers server-side; ignore client spoofed brand/business fields.
 * - product_id must ∈ chat_session_offers when offers exist.
 * - Legacy: if offers empty AND session.product_id set → allow that one product only.
 */
export async function resolveAuthorizedSessionProduct(
  userId: string,
  sessionId: string,
  clientProductId?: string | null
): Promise<SessionAccessOk | SessionAccessErr> {
  if (!isUuid(sessionId)) {
    return { ok: false, status: 400, error: 'Invalid sessionId' }
  }
  if (clientProductId != null && clientProductId !== '' && !isUuid(clientProductId)) {
    return { ok: false, status: 400, error: 'Invalid productId' }
  }
  if (!supabase) {
    return { ok: false, status: 500, error: 'Database not configured' }
  }

  const { data: session, error } = await supabase
    .from('chat_sessions')
    .select('id, user_id, business_id, product_id, title, context, primary_channel, awareness_level')
    .eq('id', sessionId)
    .maybeSingle()

  if (error) {
    console.error('session-access load error', error)
    return { ok: false, status: 500, error: 'Failed to load session' }
  }
  if (!session) {
    return { ok: false, status: 404, error: 'Session not found' }
  }
  if (session.user_id !== userId) {
    return { ok: false, status: 403, error: 'Not allowed for this session' }
  }

  const { data: offers, error: offersError } = await supabase
    .from('chat_session_offers')
    .select('product_id, position')
    .eq('session_id', sessionId)
    .order('position', { ascending: true })

  if (offersError) {
    console.error('session-access offers error', offersError)
    return { ok: false, status: 500, error: 'Failed to load session offers' }
  }

  const offerProductIds = (offers || []).map((o) => o.product_id as string)
  const decision = authorizeSessionOfferProduct({
    offerProductIds,
    sessionProductId: session.product_id as string | null,
    clientProductId: clientProductId || null,
  })

  if (!decision.ok) {
    return decision
  }

  if (!(await userHasProductAccess(userId, decision.productId))) {
    return { ok: false, status: 403, error: 'No access to product' }
  }

  return {
    ok: true,
    session: session as ChatSessionRow,
    productId: decision.productId,
    offerProductIds,
    mode: decision.mode,
  }
}
