import type { VercelRequest, VercelResponse } from '@vercel/node'
import { clampBulkCount, orchestrateAngles, pickAngles } from './lib/bulk/angle-orchestrator.js'
import { countExpandNeeded } from './lib/bulk/expand-product-refs.js'
import { languageOf, loadBulkRuntime, readBulkBody, requireBulkUser, setBulkCors } from './lib/bulk/http.js'
import { quoteCampaignPack } from './lib/bulk/quotes.js'
import { deepLinkForPack, runBulkPosts, runBulkScripts } from './lib/bulk/run-bulk.js'
import { listProductRefUrls } from './lib/bulk/store.js'
import type { AngleBoardItem } from './lib/bulk/types.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setBulkCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireBulkUser(req, res)
  if (!user) return

  try {
    const body = readBulkBody(req)
    const runtime = await loadBulkRuntime({
      user,
      brandId: typeof body.brandId === 'string' ? body.brandId : '',
      offerId: typeof body.offerId === 'string' ? body.offerId : undefined,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      language: languageOf(body.language),
      res,
    })
    if (!runtime) return

    const count = clampBulkCount(body.count)
    const imageModel = typeof body.imageModel === 'string' ? body.imageModel : 'grok-imagine'
    const styleDnaId = typeof body.styleDnaId === 'string' ? body.styleDnaId : undefined
    const incoming = Array.isArray(body.angles) ? body.angles as AngleBoardItem[] : []
    const selected = Array.isArray(body.angleIds)
      ? body.angleIds.filter((id): id is string => typeof id === 'string')
      : undefined
    const offer = runtime.ctx.offers.find((item) => item.id === runtime.offerId)
    const board = incoming.length
      ? incoming
      : (await orchestrateAngles({
          brandName: runtime.ctx.brand.name,
          brandIcp: runtime.ctx.brand.icpDescription,
          brandVoice: runtime.ctx.brandKit?.brandVoice,
          audience: runtime.ctx.brandKit?.targetAudience,
          offerName: offer?.name || runtime.offerId,
          count,
          language: runtime.language,
          recentSummaries: runtime.recentSummaries,
        })).angles
    const angles = pickAngles(board, selected, count)
    const refs = await listProductRefUrls(user.id, runtime.offerId)
    const quote = quoteCampaignPack({
      scriptCount: angles.length,
      imageCount: angles.length,
      imageModel,
      expandCount: countExpandNeeded(refs.length),
    })
    const scripts = await runBulkScripts({ runtime, angles })
    const succeeded = scripts.items.filter((item) => !item.error && item.content)
    const posts = succeeded.length
      ? await runBulkPosts({
          runtime: { ...runtime, packId: scripts.packId, sessionId: scripts.sessionId },
          angles: angles.filter((angle) => succeeded.some((item) => item.angleId === angle.id)),
          scripts: succeeded,
          imageModel,
          styleDnaId,
        })
      : { packId: scripts.packId, sessionId: scripts.sessionId, items: [], expanded: [], succeeded: 0, charged: 0 }

    return res.status(scripts.succeeded > 0 ? 200 : 402).json({
      packId: scripts.packId,
      sessionId: scripts.sessionId,
      brandId: runtime.brandId,
      offerId: runtime.offerId,
      charged: scripts.charged + posts.charged,
      succeededScripts: scripts.succeeded,
      succeededPosts: posts.succeeded,
      quote,
      scripts: scripts.items,
      posts: posts.items,
      expandedRefs: posts.expanded,
      deepLink: deepLinkForPack(undefined, runtime.brandId, scripts.sessionId, scripts.packId),
      partial: scripts.succeeded < angles.length || posts.succeeded < succeeded.length,
      error: scripts.succeeded > 0
        ? undefined
        : (scripts.items.find((item) => item.error)?.error || 'No se pudo generar el pack. Ningún guion se guardó.'),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Campaign pack failed'
    return res.status(400).json({ error: message })
  }
}
