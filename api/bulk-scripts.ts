import type { VercelRequest, VercelResponse } from '@vercel/node'
import { clampBulkCount, orchestrateAngles, pickAngles } from './lib/bulk/angle-orchestrator.js'
import { languageOf, loadBulkRuntime, readBulkBody, requireBulkUser, setBulkCors } from './lib/bulk/http.js'
import { quoteBulkScripts } from './lib/bulk/quotes.js'
import { deepLinkForPack, runBulkScripts } from './lib/bulk/run-bulk.js'
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
    const quote = quoteBulkScripts(angles.length)
    const result = await runBulkScripts({ runtime, angles })
    return res.status(result.succeeded > 0 ? 200 : 402).json({
      packId: result.packId,
      sessionId: result.sessionId,
      brandId: runtime.brandId,
      offerId: runtime.offerId,
      charged: result.charged,
      succeeded: result.succeeded,
      quote,
      items: result.items,
      deepLink: deepLinkForPack(undefined, runtime.brandId, result.sessionId, result.packId),
      partial: result.succeeded > 0 && result.succeeded < angles.length,
      error: result.succeeded > 0
        ? undefined
        : (result.items.find((item) => item.error)?.error || 'No se pudo generar el pack. Ningún guion se guardó.'),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bulk scripts failed'
    return res.status(400).json({ error: message })
  }
}
