import { supabaseAdmin as supabase } from './supabase-admin.js'
import { userHasProductAccess } from './product-access.js'

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
  /** Authoritative product for this call (session.product_id or first offer). */
  productId: string | null
  offerProductIds: string[]
}

export interface SessionAccessErr {
  ok: false
  status: number
  error: string
}

/**
 * Cheap chat-shell authz: user must own the session (user_id).
 * When clientProductId is provided it must match the resolved session product
 * (session.product_id or first chat_session_offers row by position).
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
  const productId =
    (session.product_id as string | null)
    || (offers && offers.length > 0 ? (offers[0].product_id as string) : null)

  if (clientProductId) {
    const allowed =
      clientProductId === productId
      || offerProductIds.includes(clientProductId)
      || clientProductId === session.product_id
    if (!allowed) {
      return { ok: false, status: 403, error: 'productId is not an offer on this session' }
    }
    // Prefer explicit matching offer when client sends a valid session offer
    const resolved = productId && clientProductId === productId
      ? productId
      : clientProductId
    if (!(await userHasProductAccess(userId, resolved))) {
      return { ok: false, status: 403, error: 'No access to product' }
    }
    return {
      ok: true,
      session: session as ChatSessionRow,
      productId: resolved,
      offerProductIds,
    }
  }

  if (productId && !(await userHasProductAccess(userId, productId))) {
    return { ok: false, status: 403, error: 'No access to product' }
  }

  return {
    ok: true,
    session: session as ChatSessionRow,
    productId,
    offerProductIds,
  }
}
