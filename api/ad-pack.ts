/**
 * Ad Pack — web door. POST JSON `{ action, ...fields }` (Bearer Supabase token).
 *
 * Thin wrapper over `api/lib/adpack/service.ts`; the MCP `adpack_*` tools call
 * the same service. `start` / `status` schedule a background advance with
 * `waitUntil` after responding, and `status` also runs a short inline advance
 * when no worker holds a lease (poll-driven resume: dropped background work is
 * never lost).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import { requireAuth } from './lib/auth.js'
import type { AdPackAction } from './lib/adpack/http-types.js'
import {
  ADPACK_BACKGROUND_BUDGET_MS,
  ADPACK_INLINE_BUDGET_MS,
  adPackErrorResponse,
  AdPackError,
  getDefaultAdPackService,
  type AdPackService,
} from './lib/adpack/service.js'

export type AdPackBackgroundScheduler = (work: () => Promise<unknown>) => void

const defaultScheduler: AdPackBackgroundScheduler = (work) => {
  waitUntil(
    work().catch((err) => {
      console.error('[adpack] background advance failed', err instanceof Error ? err.message : err)
    })
  )
}

let scheduleBackground: AdPackBackgroundScheduler = defaultScheduler

/** Tests: capture / drop background work. Pass null to restore waitUntil. */
export function setAdPackBackgroundScheduler(fn: AdPackBackgroundScheduler | null): void {
  scheduleBackground = fn ?? defaultScheduler
}

const ACTIONS: ReadonlySet<AdPackAction> = new Set([
  'dna_ingest',
  'dna_from_brand',
  'dna_confirm',
  'angles',
  'quote',
  'start',
  'status',
  'edit_text',
  'regenerate',
  'resize',
  'cancel',
])

async function run(service: AdPackService, action: AdPackAction, userId: string, body: Record<string, unknown>): Promise<{ result: unknown; backgroundPackId?: string }> {
  switch (action) {
    case 'dna_ingest':
      return {
        result: await service.ingestDna({
          userId,
          source: 'web',
          websiteUrl: body.websiteUrl as string | undefined,
          instagramUrl: body.instagramUrl as string | undefined,
          uploads: body.uploads as never,
          offerForm: body.offerForm as never,
          userFacts: body.userFacts as never,
          language: body.language as never,
        }),
      }
    case 'dna_from_brand':
      return {
        result: await service.dnaFromBrand({
          userId,
          source: 'web',
          brandId: body.brandId,
          offerId: body.offerId,
          brandKitId: body.brandKitId,
          refresh: body.refresh,
        }),
      }
    case 'dna_confirm':
      return { result: await service.confirmDna({ userId, dna: body.dna, edits: body.edits }) }
    case 'angles':
      return { result: await service.planAngles({ userId, dna: body.dna, offer: body.offer, size: body.size, brandId: body.brandId, offerId: body.offerId, brandKitId: body.brandKitId }) }
    case 'quote':
      return { result: await service.quote({ userId, size: body.size, dna: body.dna, offer: body.offer, brandId: body.brandId, offerId: body.offerId, brandKitId: body.brandKitId, angleIds: body.angleIds }) }
    case 'start': {
      const started = await service.startPack({
        userId,
        dna: body.dna,
        offer: body.offer,
        brandId: body.brandId,
        offerId: body.offerId,
        brief: body.brief,
        size: body.size,
        angleIds: body.angleIds,
        ratios: body.ratios,
        businessId: body.businessId,
        brandKitId: body.brandKitId,
        locale: body.locale,
        register: body.register,
        forbiddenPhrases: body.forbiddenPhrases,
        forbiddenClaims: body.forbiddenClaims,
        approved: body.approved,
        source: 'web',
      })
      return { result: started, backgroundPackId: started.packId }
    }
    case 'status': {
      const status = await service.pollStatus({ userId, packId: body.packId, inlineBudgetMs: ADPACK_INLINE_BUDGET_MS, language: body.language })
      return { result: status, backgroundPackId: status.moreWork ? status.packId : undefined }
    }
    case 'edit_text':
      return { result: await service.editText({ userId, packId: body.packId, itemId: body.itemId, copy: body.copy }) }
    case 'regenerate': {
      const regen = await service.regenerate({ userId, packId: body.packId, itemId: body.itemId, mode: body.mode })
      return { result: regen, backgroundPackId: String(body.packId) }
    }
    case 'resize':
      // Free: renderer only, no background work.
      return { result: await service.resize({ userId, packId: body.packId, itemId: body.itemId, ratios: body.ratios }) }
    case 'cancel':
      return { result: await service.cancel({ userId, packId: body.packId }) }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const user = await requireAuth(req, res)
  if (!user) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'BAD_INPUT' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const action = body.action as AdPackAction
  if (typeof action !== 'string' || !ACTIONS.has(action)) {
    const err = new AdPackError('BAD_INPUT', `Unknown action. Use one of: ${[...ACTIONS].join(', ')}`)
    return res.status(err.status).json({ error: err.message, code: err.code })
  }

  const service = getDefaultAdPackService()
  let outcome: Awaited<ReturnType<typeof run>>
  try {
    outcome = await run(service, action, user.id, body)
  } catch (err) {
    const { status, body: errorBody } = adPackErrorResponse(err)
    return res.status(status).json(errorBody)
  }

  res.status(200).json(outcome.result)

  const packId = outcome.backgroundPackId
  if (packId) {
    scheduleBackground(() => service.advance({ userId: user.id, packId, budgetMs: ADPACK_BACKGROUND_BUDGET_MS }))
  }
}
