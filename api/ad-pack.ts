/**
 * Ad Pack — web door. POST JSON `{ action, ...fields }` (Bearer Supabase token).
 *
 * Thin wrapper over `api/lib/adpack/service.ts`; the MCP `adpack_*` tools call
 * the same service. `start` / `regenerate` kick a self-continuing background
 * advance (waitUntil slices) after responding; `status` is a cheap read that at
 * most kicks that loop when no worker holds a lease. The minute cron also
 * resumes stale packs (api/mcp-guide-analysis.ts), so dropped work is never lost.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import { requireAuth } from './lib/auth.js'
import type { AdPackAction } from './lib/adpack/http-types.js'
import {
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
  'preview',
])

/** Start-shaped fields shared by `start` and the free `preview` (same args → same plan + copy). */
function startArgs(body: Record<string, unknown>) {
  return {
    dna: body.dna,
    offer: body.offer,
    brandId: body.brandId,
    offerId: body.offerId,
    brief: body.brief,
    size: body.size,
    angleIds: body.angleIds,
    angles: body.angles,
    variations: body.variations,
    creativeFreedom: body.creativeFreedom,
    layoutFamily: body.layoutFamily,
    styleDnaId: body.styleDnaId,
    ratios: body.ratios,
    businessId: body.businessId,
    brandKitId: body.brandKitId,
    productImageIds: body.productImageIds,
    productImageIdsByAd: body.productImageIdsByAd,
    locale: body.locale,
    register: body.register,
    forbiddenPhrases: body.forbiddenPhrases,
    forbiddenClaims: body.forbiddenClaims,
    productFidelity: body.productFidelity,
    relight: body.relight,
    allowedProps: body.allowedProps,
    immutableAttributes: body.immutableAttributes,
    mustAppear: body.mustAppear,
    useStyleDna: body.useStyleDna,
    photoPerAd: body.photoPerAd,
    heroRequired: body.heroRequired,
  }
}

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
          productImageIds: body.productImageIds,
          productImageIdsByAd: body.productImageIdsByAd,
          refresh: body.refresh,
          useStyleDna: body.useStyleDna,
        }),
      }
    case 'dna_confirm':
      return { result: await service.confirmDna({ userId, dna: body.dna, edits: body.edits }) }
    case 'angles':
      return { result: await service.planAngles({ userId, dna: body.dna, offer: body.offer, size: body.size, brandId: body.brandId, offerId: body.offerId, brandKitId: body.brandKitId, productImageIds: body.productImageIds, productImageIdsByAd: body.productImageIdsByAd }) }
    case 'quote':
      // #15: same prepareRun as start / preview → plan[] + planHash (send it back as start {approvedPlanHash}).
      return { result: await service.quote({ userId, ...startArgs(body), source: 'web', withPlan: true }) }
    case 'start': {
      const started = await service.startPack({
        userId,
        ...startArgs(body),
        approved: body.approved,
        previewId: body.previewId,
        approvedPlanHash: body.approvedPlanHash,
        source: 'web',
      })
      return { result: started, backgroundPackId: started.packId }
    }
    case 'status': {
      // #14: cheap read — at most kicks the background loop (no inline advance).
      const status = await service.pollStatus({ userId, packId: body.packId, language: body.language, schedule: (work) => scheduleBackground(work) })
      return { result: status }
    }
    case 'edit_text':
      return { result: await service.editText({ userId, packId: body.packId, itemId: body.itemId, copy: body.copy }) }
    case 'regenerate': {
      // Ratio-only (free) work is scheduled in the background too: the request never waits on a re-plate.
      const regen = await service.regenerate({ userId, packId: body.packId, itemId: body.itemId, mode: body.mode, ratio: body.ratio, schedule: (work) => scheduleBackground(work) })
      return { result: regen, backgroundPackId: String(body.packId) }
    }
    case 'resize':
      // Free: renderer only, no background work.
      return { result: await service.resize({ userId, packId: body.packId, itemId: body.itemId, ratios: body.ratios }) }
    case 'cancel':
      return { result: await service.cancel({ userId, packId: body.packId }) }
    case 'preview':
      // Free dry run: planning + copy + checks (model text only, no images, no credits); start reuses it.
      return { result: await service.previewPack({ userId, ...startArgs(body), source: 'web' }) }
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
    // Self-continuing slices: the pack finishes without anyone polling.
    service.kickAdvance({ userId: user.id, packId, schedule: (work) => scheduleBackground(work) })
  }
}
