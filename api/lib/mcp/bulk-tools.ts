/**
 * MCP GUIDE + EXECUTE for bulk diverse generation.
 */

import { quoteLegacyActionCredits } from '../auth.js'
import {
  clampBulkCount,
  orchestrateAngles,
  pickAngles,
} from '../bulk/angle-orchestrator.js'
import { countExpandNeeded } from '../bulk/expand-product-refs.js'
import {
  quoteBulkPosts,
  quoteBulkScripts,
  quoteCampaignPack,
} from '../bulk/quotes.js'
import { runBulkPosts, runBulkScripts, deepLinkForPack, type BulkRunContext } from '../bulk/run-bulk.js'
import { findStyleDna, isStyleDnaKind, normalizeStyleDna } from '../bulk/style-dna.js'
import {
  listRecentScriptSummaries,
  listProductRefUrls,
  listStyleDnasForBrand,
  saveStyleDnaForBrand,
} from '../bulk/store.js'
import { BULK_COUNT_DEFAULT, BULK_COUNT_MAX, type AngleBoardItem, type BulkLanguage } from '../bulk/types.js'
import {
  assertMcpApprovalReady,
  consumeMcpApprovalRequest,
  replayMcpApprovalResult,
  storeMcpApprovalResult,
  type McpApprovalStore,
} from './approval.js'
import { issueMcpChatApproval } from './approval-prompt.js'
import type { McpArtifactStore } from './artifact-store.js'
import {
  asJobHandleFromStored,
  buildFailedJobResult,
  claimMcpExecuteJob,
  scheduleMcpExecuteWork,
  shouldReplayStoredExecuteResult,
  withStatusMessage,
} from './execute-job.js'
import { assertMcpBulkCount } from './limits.js'
import { mcpGetBrandContext, type McpAuthUser, type McpDbClient } from './user-tools.js'

function resolveOfferId(
  ctx: Awaited<ReturnType<typeof mcpGetBrandContext>>,
  offerId?: string
): string {
  if (offerId) {
    const found = ctx.offers.find((o) => o.id === offerId)
    if (!found) throw new Error('Offer not found on this brand')
    return found.id
  }
  if (!ctx.offers[0]) {
    throw new Error('Brand has no offers — create an offer in Advance first')
  }
  return ctx.offers[0].id
}

function languageOf(value: unknown): BulkLanguage {
  return value === 'en' ? 'en' : 'es'
}

async function recentSummariesFor(userId: string, offerId: string): Promise<string[]> {
  const rows = await listRecentScriptSummaries(userId, offerId)
  return rows.map((row) => `${row.title}: ${row.summary}`)
}

export async function mcpGuideBulkAngles(
  db: McpDbClient,
  user: McpAuthUser,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const brandId = typeof args.brandId === 'string' ? args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const ctx = await mcpGetBrandContext(db, user, brandId)
  const offerId = resolveOfferId(ctx, typeof args.offerId === 'string' ? args.offerId : undefined)
  const offer = ctx.offers.find((item) => item.id === offerId)!
  const count = clampBulkCount(args.count)
  const language = languageOf(args.language)
  const recent = await recentSummariesFor(user.id, offerId)
  const board = await orchestrateAngles({
    brandName: ctx.brand.name,
    brandIcp: ctx.brand.icpDescription,
    brandVoice: ctx.brandKit?.brandVoice,
    audience: ctx.brandKit?.targetAudience,
    offerName: offer.name,
    offerType: offer.type,
    offerDescription: ctx.brandKit?.tagline,
    count,
    language,
    recentSummaries: recent,
  })
  return {
    mode: 'GUIDE',
    consumesAdvanceCredits: false,
    brandId,
    offerId,
    ...board,
    quoteScripts: quoteBulkScripts(board.count),
    quoteCampaign: quoteCampaignPack({
      scriptCount: board.count,
      imageCount: board.count,
      imageModel: 'grok-imagine',
    }),
    instruction: 'Present the angle board. Do not generate scripts until the user picks angles and calls execute_bulk_scripts (or execute_campaign_pack).',
  }
}

export async function mcpListStyleDnas(
  db: McpDbClient,
  user: McpAuthUser,
  brandId: string
): Promise<Record<string, unknown>> {
  if (!brandId) throw new Error('brandId is required')
  await mcpGetBrandContext(db, user, brandId)
  const listed = await listStyleDnasForBrand(user.id, brandId)
  return {
    brandId,
    kitId: listed.kitId,
    styleDnas: listed.styleDnas,
  }
}

export async function mcpSetStyleDna(
  db: McpDbClient,
  user: McpAuthUser,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const brandId = typeof args.brandId === 'string' ? args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  await mcpGetBrandContext(db, user, brandId)
  if (!isStyleDnaKind(args.kind) && args.kind != null) {
    throw new Error('kind must be organic or ads')
  }
  const dna = normalizeStyleDna({
    id: typeof args.id === 'string' ? args.id : undefined,
    name: args.name,
    kind: args.kind,
    referenceUrls: args.referenceUrls,
    notes: args.notes,
  })
  if (!dna) throw new Error('name is required')
  const saved = await saveStyleDnaForBrand({
    userId: user.id,
    brandId,
    dna,
  })
  return {
    brandId,
    kitId: saved.kitId,
    styleDna: dna,
    styleDnas: saved.styleDnas,
  }
}

async function requireOrIssueApproval(options: {
  approvalStore: McpApprovalStore
  approvalRequestId: string
  userId: string
  toolName: string
  input: unknown
  quotedCreditCost: number
  appOrigin?: string
  language?: 'es' | 'en'
}): Promise<Record<string, unknown> | null> {
  if (!options.approvalRequestId) {
    return issueMcpChatApproval({
      approvalStore: options.approvalStore,
      userId: options.userId,
      toolName: options.toolName,
      input: options.input,
      quotedCreditCost: options.quotedCreditCost,
      appOrigin: options.appOrigin,
      language: options.language,
    })
  }
  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.userId,
    toolName: options.toolName,
    input: options.input,
  })
  if (replay.ok) {
    const formatted = asJobHandleFromStored(
      options.approvalRequestId,
      replay.result,
      options.toolName
    )
    const payload = formatted || replay.result
    if (shouldReplayStoredExecuteResult(payload)) {
      return {
        ...(payload as Record<string, unknown>),
        replayed: true,
      }
    }
  }
  const ready = await assertMcpApprovalReady(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.userId,
    toolName: options.toolName,
    input: options.input,
  })
  if (!ready.ok) throw new Error(ready.reason)
  return null
}

async function finalizeIfSucceeded(options: {
  approvalStore: McpApprovalStore
  approvalRequestId: string
  userId: string
  toolName: string
  input: unknown
  result: Record<string, unknown>
  succeeded: number
}): Promise<void> {
  if (options.succeeded <= 0) return
  await storeMcpApprovalResult(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    result: options.result,
  })
  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.userId,
    toolName: options.toolName,
    input: options.input,
  })
  if (!consumed.ok) throw new Error(consumed.reason)
}

function selectedIds(args: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(args.angleIds)) return undefined
  return args.angleIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
}

async function loadAngles(options: {
  db: McpDbClient
  user: McpAuthUser
  brandId: string
  offerId: string
  ctx: Awaited<ReturnType<typeof mcpGetBrandContext>>
  args: Record<string, unknown>
}): Promise<AngleBoardItem[]> {
  const count = assertMcpBulkCount(options.args.count ?? BULK_COUNT_DEFAULT, BULK_COUNT_MAX)
  const language = languageOf(options.args.language)
  const offer = options.ctx.offers.find((item) => item.id === options.offerId)!
  const recent = await recentSummariesFor(options.user.id, options.offerId)
  const incoming = Array.isArray(options.args.angles)
    ? options.args.angles as AngleBoardItem[]
    : []
  const board = incoming.length
    ? incoming.map((item, index) => ({
        id: item.id || `angle_${index + 1}`,
        title: item.title || `angle ${index + 1}`,
        niche: item.niche || 'audience',
        whyItBuys: item.whyItBuys || '',
        hookStyle: item.hookStyle || 'direct',
        frameworkHint: item.frameworkHint || 'venta_directa',
      }))
    : (await orchestrateAngles({
        brandName: options.ctx.brand.name,
        brandIcp: options.ctx.brand.icpDescription,
        brandVoice: options.ctx.brandKit?.brandVoice,
        audience: options.ctx.brandKit?.targetAudience,
        offerName: offer.name,
        offerType: offer.type,
        count,
        language,
        recentSummaries: recent,
      })).angles
  return pickAngles(board, selectedIds(options.args), count)
}

async function buildRuntime(options: {
  db: McpDbClient
  user: McpAuthUser
  artifactStore: McpArtifactStore
  brandId: string
  offerId: string
  args: Record<string, unknown>
  packId?: string
}): Promise<BulkRunContext> {
  const ctx = await mcpGetBrandContext(options.db, options.user, options.brandId)
  const style = await listStyleDnasForBrand(options.user.id, options.brandId)
  return {
    user: options.user,
    brandId: options.brandId,
    offerId: options.offerId,
    sessionId: typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined,
    language: languageOf(options.args.language),
    ctx,
    artifactStore: options.artifactStore,
    source: 'mcp',
    appOrigin: undefined,
    packId: options.packId,
    recentSummaries: await recentSummariesFor(options.user.id, options.offerId),
    styleDnas: style.styleDnas,
  }
}

export async function mcpExecuteBulkScripts(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const ctx = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctx, typeof options.args.offerId === 'string' ? options.args.offerId : undefined)
  const count = assertMcpBulkCount(options.args.count ?? BULK_COUNT_DEFAULT, BULK_COUNT_MAX)
  const boundInput = {
    brandId,
    offerId,
    count,
    language: languageOf(options.args.language),
    angleIds: selectedIds(options.args),
    sessionId: typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined,
  }
  const quote = quoteBulkScripts(count)
  const approvalRequestId = typeof options.args.approvalRequestId === 'string'
    ? options.args.approvalRequestId
    : ''
  const pending = await requireOrIssueApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_bulk_scripts',
    input: boundInput,
    quotedCreditCost: quote.totalCredits,
    appOrigin: options.appOrigin,
    language: boundInput.language,
  })
  if (pending) return { ...pending, quote }

  const toolName = 'execute_bulk_scripts'
  const claim = await claimMcpExecuteJob(options.approvalStore, {
    approvalRequestId,
    toolName,
    quotedCreditCost: quote.totalCredits,
  })
  if (!claim.claimed) {
    const formatted = asJobHandleFromStored(approvalRequestId, claim.existing, toolName)
    return (formatted || withStatusMessage({
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName,
      chargedCredits: 0,
    }, toolName)) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const angles = await loadAngles({
        db: options.db,
        user: options.user,
        brandId,
        offerId,
        ctx,
        args: options.args,
      })
      const runtime = await buildRuntime({
        db: options.db,
        user: options.user,
        artifactStore: options.artifactStore,
        brandId,
        offerId,
        args: options.args,
        packId: approvalRequestId,
      })
      runtime.appOrigin = options.appOrigin
      const result = await runBulkScripts({ runtime, angles })
      if (result.succeeded <= 0) {
        await storeMcpApprovalResult(options.approvalStore, {
          approvalRequestId,
          result: buildFailedJobResult({
            approvalRequestId,
            toolName,
            error: result.items[0]?.error || 'Bulk scripts failed — approval remains reusable',
            quotedCreditCost: quote.totalCredits,
          }),
        })
        return
      }

      const payload = withStatusMessage({
        status: 'completed',
        jobId: approvalRequestId,
        approvalRequestId,
        toolName,
        consumesAdvanceCredits: true,
        packId: result.packId,
        sessionId: result.sessionId,
        brandId,
        offerId,
        charged: result.charged,
        chargedCredits: result.charged,
        usage: {
          quotedCredits: quote.totalCredits,
          chargedCredits: result.charged,
        },
        succeeded: result.succeeded,
        quotedCreditCost: quote.totalCredits,
        quote,
        items: result.items.map((item) => ({
          angleId: item.angleId,
          title: item.title,
          scriptId: item.scriptId,
          messageId: item.messageId,
          charged: item.charged,
          error: item.error,
        })),
        deepLink: deepLinkForPack(options.appOrigin, brandId, result.sessionId, result.packId),
        note: 'Charged 3 credits per succeeded script. Failed items were not charged.',
      }, toolName)
      await finalizeIfSucceeded({
        approvalStore: options.approvalStore,
        approvalRequestId,
        userId: options.user.id,
        toolName,
        input: boundInput,
        result: payload,
        succeeded: result.succeeded,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk scripts failed'
      await storeMcpApprovalResult(options.approvalStore, {
        approvalRequestId,
        result: buildFailedJobResult({
          approvalRequestId,
          toolName,
          error: message,
          quotedCreditCost: quote.totalCredits,
        }),
      })
      console.error('mcp execute_bulk_scripts job', message)
    }
  }
  scheduleMcpExecuteWork(work)
  return claim.handle as unknown as Record<string, unknown>
}

export async function mcpExecuteBulkPosts(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const ctx = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctx, typeof options.args.offerId === 'string' ? options.args.offerId : undefined)
  const count = assertMcpBulkCount(options.args.count ?? BULK_COUNT_DEFAULT, BULK_COUNT_MAX)
  const imageModel = typeof options.args.imageModel === 'string' ? options.args.imageModel : 'grok-imagine'
  const styleDnaId = typeof options.args.styleDnaId === 'string' ? options.args.styleDnaId : undefined
  const existingRefs = await listProductRefUrls(options.user.id, offerId)
  const quote = quoteBulkPosts({
    count,
    imageModel,
    expandCount: countExpandNeeded(existingRefs.length),
  })
  const boundInput = {
    brandId,
    offerId,
    count,
    imageModel,
    styleDnaId,
    language: languageOf(options.args.language),
    angleIds: selectedIds(options.args),
    sessionId: typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined,
  }
  const approvalRequestId = typeof options.args.approvalRequestId === 'string'
    ? options.args.approvalRequestId
    : ''
  const pending = await requireOrIssueApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_bulk_posts',
    input: boundInput,
    quotedCreditCost: quote.totalCredits,
    appOrigin: options.appOrigin,
    language: boundInput.language,
  })
  if (pending) return { ...pending, quote }

  const toolName = 'execute_bulk_posts'
  const claim = await claimMcpExecuteJob(options.approvalStore, {
    approvalRequestId,
    toolName,
    quotedCreditCost: quote.totalCredits,
  })
  if (!claim.claimed) {
    const formatted = asJobHandleFromStored(approvalRequestId, claim.existing, toolName)
    return (formatted || withStatusMessage({
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName,
      chargedCredits: 0,
    }, toolName)) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const angles = await loadAngles({
        db: options.db,
        user: options.user,
        brandId,
        offerId,
        ctx,
        args: options.args,
      })
      const runtime = await buildRuntime({
        db: options.db,
        user: options.user,
        artifactStore: options.artifactStore,
        brandId,
        offerId,
        args: options.args,
        packId: approvalRequestId,
      })
      runtime.appOrigin = options.appOrigin
      const result = await runBulkPosts({
        runtime,
        angles,
        imageModel,
        styleDnaId,
      })
      if (result.succeeded <= 0) {
        await storeMcpApprovalResult(options.approvalStore, {
          approvalRequestId,
          result: buildFailedJobResult({
            approvalRequestId,
            toolName,
            error: result.items[0]?.error || 'Bulk posts failed — approval remains reusable',
            quotedCreditCost: quote.totalCredits,
          }),
        })
        return
      }

      const payload = withStatusMessage({
        status: 'completed',
        jobId: approvalRequestId,
        approvalRequestId,
        toolName,
        consumesAdvanceCredits: true,
        packId: result.packId,
        sessionId: result.sessionId,
        brandId,
        offerId,
        charged: result.charged,
        chargedCredits: result.charged,
        usage: {
          quotedCredits: quote.totalCredits,
          chargedCredits: result.charged,
        },
        succeeded: result.succeeded,
        quotedCreditCost: quote.totalCredits,
        quote,
        expandedRefs: result.expanded,
        items: result.items.map((item) => ({
          angleId: item.angleId,
          imageUrl: item.imageUrl,
          productImageId: item.productImageId,
          approach: item.approach,
          charged: item.charged,
          error: item.error,
        })),
        deepLink: deepLinkForPack(options.appOrigin, brandId, result.sessionId, result.packId),
        note: `Charged ${quoteLegacyActionCredits('image', imageModel)} credits per succeeded image (plus any expanded product refs).`,
      }, toolName)
      await finalizeIfSucceeded({
        approvalStore: options.approvalStore,
        approvalRequestId,
        userId: options.user.id,
        toolName,
        input: boundInput,
        result: payload,
        succeeded: result.succeeded,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk posts failed'
      await storeMcpApprovalResult(options.approvalStore, {
        approvalRequestId,
        result: buildFailedJobResult({
          approvalRequestId,
          toolName,
          error: message,
          quotedCreditCost: quote.totalCredits,
        }),
      })
      console.error('mcp execute_bulk_posts job', message)
    }
  }
  scheduleMcpExecuteWork(work)
  return claim.handle as unknown as Record<string, unknown>
}

export async function mcpExecuteCampaignPack(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const ctx = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctx, typeof options.args.offerId === 'string' ? options.args.offerId : undefined)
  const count = assertMcpBulkCount(options.args.count ?? BULK_COUNT_DEFAULT, BULK_COUNT_MAX)
  const imageModel = typeof options.args.imageModel === 'string' ? options.args.imageModel : 'grok-imagine'
  const styleDnaId = typeof options.args.styleDnaId === 'string' ? options.args.styleDnaId : undefined
  const existingRefs = await listProductRefUrls(options.user.id, offerId)
  const quote = quoteCampaignPack({
    scriptCount: count,
    imageCount: count,
    imageModel,
    expandCount: countExpandNeeded(existingRefs.length),
  })
  const boundInput = {
    brandId,
    offerId,
    count,
    imageModel,
    styleDnaId,
    language: languageOf(options.args.language),
    angleIds: selectedIds(options.args),
    sessionId: typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined,
  }
  const approvalRequestId = typeof options.args.approvalRequestId === 'string'
    ? options.args.approvalRequestId
    : ''
  const pending = await requireOrIssueApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'execute_campaign_pack',
    input: boundInput,
    quotedCreditCost: quote.totalCredits,
    appOrigin: options.appOrigin,
    language: boundInput.language,
  })
  if (pending) return { ...pending, quote }

  const toolName = 'execute_campaign_pack'
  const claim = await claimMcpExecuteJob(options.approvalStore, {
    approvalRequestId,
    toolName,
    quotedCreditCost: quote.totalCredits,
  })
  if (!claim.claimed) {
    const formatted = asJobHandleFromStored(approvalRequestId, claim.existing, toolName)
    return (formatted || withStatusMessage({
      status: 'running',
      jobId: approvalRequestId,
      approvalRequestId,
      toolName,
      chargedCredits: 0,
    }, toolName)) as Record<string, unknown>
  }

  const work = async () => {
    try {
      const angles = await loadAngles({
        db: options.db,
        user: options.user,
        brandId,
        offerId,
        ctx,
        args: options.args,
      })
      const runtime = await buildRuntime({
        db: options.db,
        user: options.user,
        artifactStore: options.artifactStore,
        brandId,
        offerId,
        args: options.args,
        packId: approvalRequestId,
      })
      runtime.appOrigin = options.appOrigin
      const scripts = await runBulkScripts({ runtime, angles })
      if (scripts.succeeded <= 0) {
        await storeMcpApprovalResult(options.approvalStore, {
          approvalRequestId,
          result: buildFailedJobResult({
            approvalRequestId,
            toolName,
            error: scripts.items[0]?.error || 'Campaign pack failed — approval remains reusable',
            quotedCreditCost: quote.totalCredits,
          }),
        })
        return
      }

      const succeededScripts = scripts.items.filter((item) => !item.error && item.content)
      const posts = succeededScripts.length
        ? await runBulkPosts({
            runtime: { ...runtime, packId: scripts.packId, sessionId: scripts.sessionId },
            angles: angles.filter((angle) => succeededScripts.some((item) => item.angleId === angle.id)),
            scripts: succeededScripts,
            imageModel,
            styleDnaId,
          })
        : {
            packId: scripts.packId,
            sessionId: scripts.sessionId,
            items: [],
            expanded: [],
            succeeded: 0,
            charged: 0,
          }
      const charged = scripts.charged + posts.charged
      const payload = withStatusMessage({
        status: 'completed',
        jobId: approvalRequestId,
        approvalRequestId,
        toolName,
        consumesAdvanceCredits: true,
        packId: scripts.packId,
        sessionId: scripts.sessionId,
        brandId,
        offerId,
        charged,
        chargedCredits: charged,
        usage: {
          quotedCredits: quote.totalCredits,
          chargedCredits: charged,
        },
        succeededScripts: scripts.succeeded,
        succeededPosts: posts.succeeded,
        quotedCreditCost: quote.totalCredits,
        quote,
        scripts: scripts.items.map((item) => ({
          angleId: item.angleId,
          title: item.title,
          scriptId: item.scriptId,
          charged: item.charged,
          error: item.error,
        })),
        posts: posts.items.map((item) => ({
          angleId: item.angleId,
          imageUrl: item.imageUrl,
          approach: item.approach,
          charged: item.charged,
          error: item.error,
        })),
        expandedRefs: posts.expanded,
        deepLink: deepLinkForPack(options.appOrigin, brandId, scripts.sessionId, scripts.packId),
        styleDna: findStyleDna(runtime.styleDnas || [], styleDnaId),
        note: 'One approval. Charge per succeeded script (3) and image (6 or 24). Failed items were not charged.',
      }, toolName)
      await finalizeIfSucceeded({
        approvalStore: options.approvalStore,
        approvalRequestId,
        userId: options.user.id,
        toolName,
        input: boundInput,
        result: payload,
        succeeded: scripts.succeeded + posts.succeeded,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Campaign pack failed'
      await storeMcpApprovalResult(options.approvalStore, {
        approvalRequestId,
        result: buildFailedJobResult({
          approvalRequestId,
          toolName,
          error: message,
          quotedCreditCost: quote.totalCredits,
        }),
      })
      console.error('mcp execute_campaign_pack job', message)
    }
  }
  scheduleMcpExecuteWork(work)
  return claim.handle as unknown as Record<string, unknown>
}

export type { StyleDna } from '../bulk/types.js'
