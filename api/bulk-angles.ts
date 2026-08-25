import type { VercelRequest, VercelResponse } from '@vercel/node'
import { clampBulkCount, orchestrateAngles } from './lib/bulk/angle-orchestrator.js'
import { countExpandNeeded } from './lib/bulk/expand-product-refs.js'
import { languageOf, loadBulkRuntime, readBulkBody, requireBulkUser, setBulkCors } from './lib/bulk/http.js'
import { quoteBulkPosts, quoteBulkScripts, quoteCampaignPack } from './lib/bulk/quotes.js'
import { listProductRefUrls } from './lib/bulk/store.js'

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
    const offer = runtime.ctx.offers.find((item) => item.id === runtime.offerId)
    const board = await orchestrateAngles({
      brandName: runtime.ctx.brand.name,
      brandIcp: runtime.ctx.brand.icpDescription,
      brandVoice: runtime.ctx.brandKit?.brandVoice,
      audience: runtime.ctx.brandKit?.targetAudience,
      offerName: offer?.name || runtime.offerId,
      offerType: offer?.type,
      offerDescription: runtime.ctx.brandKit?.tagline,
      count,
      language: runtime.language,
      recentSummaries: runtime.recentSummaries,
    })
    const refs = await listProductRefUrls(user.id, runtime.offerId)
    const expandCount = countExpandNeeded(refs.length)
    return res.status(200).json({
      brandId: runtime.brandId,
      offerId: runtime.offerId,
      styleDnas: runtime.styleDnas || [],
      ...board,
      quoteScripts: quoteBulkScripts(board.count),
      quotePosts: quoteBulkPosts({ count: board.count, imageModel: 'grok-imagine', expandCount }),
      quoteCampaign: quoteCampaignPack({
        scriptCount: board.count,
        imageCount: board.count,
        imageModel: 'grok-imagine',
        expandCount,
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not build angle board'
    return res.status(400).json({ error: message })
  }
}
