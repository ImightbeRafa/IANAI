import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, type AuthenticatedUser } from '../auth.js'
import { createMcpArtifactStore } from '../mcp/artifact-store.js'
import { createMcpSupabaseAdapter } from '../mcp/supabase-adapter.js'
import { mcpGetBrandContext } from '../mcp/user-tools.js'
import { requireChatShellAccess } from '../chat-shell-access.js'
import { isUuid } from '../session-access.js'
import { listProductRefUrls, listRecentScriptSummaries, listStyleDnasForBrand } from './store.js'
import type { BulkRunContext } from './run-bulk.js'
import type { BulkLanguage } from './types.js'

export function setBulkCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export function readBulkBody(req: VercelRequest): Record<string, unknown> {
  return (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}
}

export function languageOf(value: unknown): BulkLanguage {
  return value === 'en' ? 'en' : 'es'
}

export async function requireBulkUser(
  req: VercelRequest,
  res: VercelResponse
): Promise<AuthenticatedUser | null> {
  const user = await requireAuth(req, res)
  if (!user) return null
  return user
}

export async function loadBulkRuntime(options: {
  user: AuthenticatedUser
  brandId: string
  offerId?: string
  sessionId?: string
  language: BulkLanguage
  res: VercelResponse
}): Promise<BulkRunContext | null> {
  const db = createMcpSupabaseAdapter()
  const artifactStore = createMcpArtifactStore()
  if (!db || !artifactStore) {
    options.res.status(503).json({ error: 'Bulk storage is not configured' })
    return null
  }
  if (!options.brandId || !isUuid(options.brandId)) {
    options.res.status(400).json({ error: 'Valid brandId is required' })
    return null
  }
  if (options.sessionId) {
    if (!isUuid(options.sessionId)) {
      options.res.status(400).json({ error: 'Invalid sessionId' })
      return null
    }
    if (!(await requireChatShellAccess(options.res, options.user.id))) return null
  }
  const ctx = await mcpGetBrandContext(db, { id: options.user.id, email: options.user.email }, options.brandId)
  const offerId = options.offerId && ctx.offers.some((item) => item.id === options.offerId)
    ? options.offerId
    : ctx.offers[0]?.id
  if (!offerId) {
    options.res.status(400).json({ error: 'Brand has no offers' })
    return null
  }
  const style = await listStyleDnasForBrand(options.user.id, options.brandId)
  const recent = await listRecentScriptSummaries(options.user.id, offerId)
  const productRefUrls = await listProductRefUrls(options.user.id, offerId)
  return {
    user: { id: options.user.id, email: options.user.email },
    brandId: options.brandId,
    offerId,
    sessionId: options.sessionId,
    language: options.language,
    ctx,
    artifactStore,
    source: 'web',
    productRefUrls,
    recentSummaries: recent.map((row) => `${row.title}: ${row.summary}`),
    styleDnas: style.styleDnas,
  }
}
