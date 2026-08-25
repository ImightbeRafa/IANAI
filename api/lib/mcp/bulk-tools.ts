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
import { BULK_COUNT_DEFAULT, BULK_COUNT_MAX, type AngleBoardItem, type BulkLanguage, type BulkPostItem, type BulkScriptItem } from '../bulk/types.js'
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
  buildExecuteStatusMessage,
  buildFailedJobResult,
  claimMcpExecuteJob,
  MCP_EXECUTE_STALE_MS,
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

async function hydrateBulkApprovalArgs(options: {
  approvalStore: McpApprovalStore
  userId: string
  toolName: string
  args: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const approvalRequestId = typeof options.args.approvalRequestId === 'string'
    ? options.args.approvalRequestId
    : ''
  if (!approvalRequestId) return options.args
  const record = await options.approvalStore.findById(approvalRequestId)
  if (!record || record.userId !== options.userId || record.toolName !== options.toolName) {
    return options.args
  }
  const bound = record.inputJson && typeof record.inputJson === 'object' && !Array.isArray(record.inputJson)
    ? record.inputJson as Record<string, unknown>
    : {}
  return { ...bound, ...options.args, approvalRequestId }
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
    guidePrompt: typeof options.args.guidePrompt === 'string' ? options.args.guidePrompt.trim() : undefined,
    scene: typeof options.args.scene === 'string' ? options.args.scene.trim() : undefined,
    aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : undefined,
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
  const args = await hydrateBulkApprovalArgs({
    approvalStore: options.approvalStore,
    userId: options.user.id,
    toolName: 'execute_bulk_scripts',
    args: options.args,
  })
  const brandId = typeof args.brandId === 'string' ? args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const ctx = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctx, typeof args.offerId === 'string' ? args.offerId : undefined)
  const count = assertMcpBulkCount(args.count ?? BULK_COUNT_DEFAULT, BULK_COUNT_MAX)
  const boundInput = {
    brandId,
    offerId,
    count,
    language: languageOf(args.language),
    angleIds: selectedIds(args),
    guidePrompt: typeof args.guidePrompt === 'string' ? args.guidePrompt.trim() : undefined,
    sessionId: typeof args.sessionId === 'string' ? args.sessionId : undefined,
  }
  const quote = quoteBulkScripts(count)
  const approvalRequestId = typeof args.approvalRequestId === 'string'
    ? args.approvalRequestId
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
        args,
      })
      const runtime = await buildRuntime({
        db: options.db,
        user: options.user,
        artifactStore: options.artifactStore,
        brandId,
        offerId,
        args,
        packId: approvalRequestId,
      })
      runtime.appOrigin = options.appOrigin
      const result = await runBulkScripts({ runtime, angles })
      const savedAny = result.items.some((item) => Boolean(item.scriptId))
      if (result.succeeded <= 0) {
        await storeMcpApprovalResult(options.approvalStore, {
          approvalRequestId,
          result: withStatusMessage({
            status: 'failed',
            jobId: approvalRequestId,
            approvalRequestId,
            toolName,
            failureStage: savedAny ? 'charge' : 'generate',
            artifactsSaved: savedAny,
            resumeMode: savedAny ? 'charge_only' : undefined,
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
              statusMessage: buildExecuteStatusMessage(toolName, item.error ? 'failed' : 'completed'),
            })),
            deepLink: deepLinkForPack(options.appOrigin, brandId, result.sessionId, result.packId),
            error: result.items[0]?.error || 'Bulk scripts failed — approval remains reusable',
            message: savedAny
              ? 'Scripts were saved to Advance, but billing failed. Artifacts are kept; approval stays reusable without regenerating.'
              : 'Bulk scripts failed. Approval remains reusable.',
          }, toolName),
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
          statusMessage: buildExecuteStatusMessage(toolName, item.error ? 'failed' : 'completed'),
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
  const args = await hydrateBulkApprovalArgs({
    approvalStore: options.approvalStore,
    userId: options.user.id,
    toolName: 'execute_bulk_posts',
    args: options.args,
  })
  const brandId = typeof args.brandId === 'string' ? args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const ctx = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctx, typeof args.offerId === 'string' ? args.offerId : undefined)
  const count = assertMcpBulkCount(args.count ?? BULK_COUNT_DEFAULT, BULK_COUNT_MAX)
  const imageModel = typeof args.imageModel === 'string' ? args.imageModel : 'grok-imagine'
  const styleDnaId = typeof args.styleDnaId === 'string' ? args.styleDnaId : undefined
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
    language: languageOf(args.language),
    angleIds: selectedIds(args),
    aspectRatio: typeof args.aspectRatio === 'string' ? args.aspectRatio : '9:16',
    scene: typeof args.scene === 'string' ? args.scene.trim() : undefined,
    guidePrompt: typeof args.guidePrompt === 'string' ? args.guidePrompt.trim() : undefined,
    sessionId: typeof args.sessionId === 'string' ? args.sessionId : undefined,
  }
  const approvalRequestId = typeof args.approvalRequestId === 'string'
    ? args.approvalRequestId
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
        args,
      })
      const runtime = await buildRuntime({
        db: options.db,
        user: options.user,
        artifactStore: options.artifactStore,
        brandId,
        offerId,
        args,
        packId: approvalRequestId,
      })
      runtime.appOrigin = options.appOrigin
      const result = await runBulkPosts({
        runtime,
        angles,
        imageModel,
        styleDnaId,
      })
      const savedAny = result.items.some((item) => Boolean(item.imageUrl))
        || result.expanded.some((item) => Boolean(item.imageUrl))
      if (result.succeeded <= 0) {
        await storeMcpApprovalResult(options.approvalStore, {
          approvalRequestId,
          result: withStatusMessage({
            status: 'failed',
            jobId: approvalRequestId,
            approvalRequestId,
            toolName,
            failureStage: savedAny ? 'charge' : 'generate',
            artifactsSaved: savedAny,
            resumeMode: savedAny ? 'charge_only' : undefined,
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
              statusMessage: buildExecuteStatusMessage(toolName, item.error ? 'failed' : 'completed'),
            })),
            deepLink: deepLinkForPack(options.appOrigin, brandId, result.sessionId, result.packId),
            error: result.items[0]?.error || 'Bulk posts failed — approval remains reusable',
            message: savedAny
              ? 'Images were saved to Advance, but billing failed. Artifacts are kept; approval stays reusable without regenerating.'
              : 'Bulk posts failed. Approval remains reusable.',
          }, toolName),
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
          statusMessage: buildExecuteStatusMessage(toolName, item.error ? 'failed' : 'completed'),
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

type CampaignCheckpoint = {
  status: 'running'
  jobId: string
  approvalRequestId: string
  toolName: 'execute_campaign_pack'
  startedAtMs: number
  chunkState: 'ready' | 'working'
  phase: 'scripts' | 'posts'
  nextIndex: number
  quotedCreditCost: number
  chargedCredits: number
  usage: { quotedCredits: number; chargedCredits: number }
  angles: AngleBoardItem[]
  scripts: BulkScriptItem[]
  posts: BulkPostItem[]
  expandedRefs: unknown[]
  sessionId?: string
  retryAfterMs: number
  statusMessage: string
  message: string
}

export function isCampaignCheckpoint(value: unknown): value is CampaignCheckpoint {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.status === 'running'
    && row.toolName === 'execute_campaign_pack'
    && (row.chunkState === 'ready' || row.chunkState === 'working')
    && (row.phase === 'scripts' || row.phase === 'posts')
    && Array.isArray(row.angles)
    && Array.isArray(row.scripts)
    && Array.isArray(row.posts)
}

export function isCampaignChunkLeasable(value: unknown, nowMs = Date.now()): boolean {
  if (!isCampaignCheckpoint(value)) return false
  return value.chunkState === 'ready' || nowMs - value.startedAtMs > MCP_EXECUTE_STALE_MS
}

function campaignRunning(options: {
  approvalRequestId: string
  quote: number
  angles: AngleBoardItem[]
  startedAtMs?: number
}): CampaignCheckpoint {
  return {
    status: 'running',
    jobId: options.approvalRequestId,
    approvalRequestId: options.approvalRequestId,
    toolName: 'execute_campaign_pack',
    startedAtMs: options.startedAtMs ?? Date.now(),
    chunkState: 'ready',
    phase: 'scripts',
    nextIndex: 0,
    quotedCreditCost: options.quote,
    chargedCredits: 0,
    usage: { quotedCredits: options.quote, chargedCredits: 0 },
    angles: options.angles,
    scripts: [],
    posts: [],
    expandedRefs: [],
    retryAfterMs: 2_000,
    statusMessage: buildExecuteStatusMessage('execute_campaign_pack', 'running'),
    message: 'Campaign pack is durable and resumes one generated artifact per poll.',
  }
}

async function runCampaignChunk(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  checkpoint: CampaignCheckpoint
  appOrigin?: string
}): Promise<void> {
  const toolName = 'execute_campaign_pack'
  const approvalRequestId = options.checkpoint.approvalRequestId
  try {
    const brandId = String(options.args.brandId || '')
    const offerId = String(options.args.offerId || '')
    const imageModel = typeof options.args.imageModel === 'string' ? options.args.imageModel : 'grok-imagine'
    const styleDnaId = typeof options.args.styleDnaId === 'string' ? options.args.styleDnaId : undefined
    const runtime = await buildRuntime({
      db: options.db,
      user: options.user,
      artifactStore: options.artifactStore,
      brandId,
      offerId,
      args: { ...options.args, sessionId: options.checkpoint.sessionId },
      packId: approvalRequestId,
    })
    runtime.appOrigin = options.appOrigin
    const cp = options.checkpoint
    const angle = cp.angles[cp.nextIndex]
    if (!angle) throw new Error('Campaign checkpoint has no next angle')

    let next: CampaignCheckpoint
    if (cp.phase === 'scripts') {
      const result = await runBulkScripts({ runtime, angles: [angle], indexOffset: cp.nextIndex })
      const item = result.items[0]
      if (!item || item.error || !item.scriptId) {
        throw new Error(item?.error || 'Campaign script generation failed')
      }
      const scripts = [...cp.scripts, item]
      const finished = cp.nextIndex + 1 >= cp.angles.length
      next = {
        ...cp,
        startedAtMs: Date.now(),
        chunkState: 'ready',
        phase: finished ? 'posts' : 'scripts',
        nextIndex: finished ? 0 : cp.nextIndex + 1,
        sessionId: result.sessionId,
        scripts,
        chargedCredits: cp.chargedCredits + item.charged,
        usage: { quotedCredits: cp.quotedCreditCost, chargedCredits: cp.chargedCredits + item.charged },
      }
    } else {
      const script = cp.scripts[cp.nextIndex]
      const result = await runBulkPosts({
        runtime,
        angles: [angle],
        scripts: script ? [script] : [],
        imageModel,
        styleDnaId,
        indexOffset: cp.nextIndex,
      })
      const item = result.items[0]
      if (!item || item.error || !item.imageUrl) {
        throw new Error(item?.error || 'Campaign image generation failed')
      }
      const posts = [...cp.posts, item]
      const charged = cp.chargedCredits + result.charged
      const finished = cp.nextIndex + 1 >= cp.angles.length
      if (!finished) {
        next = {
          ...cp,
          startedAtMs: Date.now(),
          chunkState: 'ready',
          nextIndex: cp.nextIndex + 1,
          sessionId: result.sessionId,
          posts,
          expandedRefs: [...cp.expandedRefs, ...result.expanded],
          chargedCredits: charged,
          usage: { quotedCredits: cp.quotedCreditCost, chargedCredits: charged },
        }
      } else {
        const payload = withStatusMessage({
          status: 'completed',
          jobId: approvalRequestId,
          approvalRequestId,
          toolName,
          consumesAdvanceCredits: true,
          packId: approvalRequestId,
          sessionId: result.sessionId,
          brandId,
          offerId,
          charged,
          chargedCredits: charged,
          usage: { quotedCredits: cp.quotedCreditCost, chargedCredits: charged },
          succeededScripts: cp.scripts.length,
          succeededPosts: posts.length,
          quotedCreditCost: cp.quotedCreditCost,
          scripts: cp.scripts.map((saved) => ({
            angleId: saved.angleId,
            title: saved.title,
            content: saved.content,
            scriptId: saved.scriptId,
            charged: saved.charged,
          })),
          posts: posts.map((saved) => ({
            angleId: saved.angleId,
            imageUrl: saved.imageUrl,
            productImageId: saved.productImageId,
            approach: saved.approach,
            charged: saved.charged,
          })),
          expandedRefs: [...cp.expandedRefs, ...result.expanded],
          deepLink: deepLinkForPack(options.appOrigin, brandId, result.sessionId, approvalRequestId),
          styleDna: findStyleDna(runtime.styleDnas || [], styleDnaId),
          note: 'Durable campaign completed. Each artifact used a stable UUID; credits were charged once after its successful save.',
        }, toolName)
        await finalizeIfSucceeded({
          approvalStore: options.approvalStore,
          approvalRequestId,
          userId: options.user.id,
          toolName,
          input: options.args,
          result: payload,
          succeeded: cp.scripts.length + posts.length,
        })
        return
      }
    }
    await storeMcpApprovalResult(options.approvalStore, { approvalRequestId, result: next })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Campaign pack failed'
    await storeMcpApprovalResult(options.approvalStore, {
      approvalRequestId,
      result: buildFailedJobResult({
        approvalRequestId,
        toolName,
        error: message,
        quotedCreditCost: options.checkpoint.quotedCreditCost,
      }),
    })
    console.error('mcp execute_campaign_pack chunk', message)
  }
}

/** Poll hook: atomically leases and schedules exactly one durable campaign artifact. */
export async function resumeMcpCampaignPack(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  jobId: string
  appOrigin?: string
}): Promise<void> {
  const row = await options.approvalStore.findById(options.jobId)
  if (!row || row.userId !== options.user.id || !isCampaignCheckpoint(row.resultJson)) return
  const cp = row.resultJson
  if (!isCampaignChunkLeasable(cp)) return
  if (!options.approvalStore.compareAndSwapRunningResult) return
  const working: CampaignCheckpoint = { ...cp, chunkState: 'working', startedAtMs: Date.now() }
  const claimed = await options.approvalStore.compareAndSwapRunningResult(
    row.id,
    cp.startedAtMs,
    working,
    working.startedAtMs
  )
  if (!claimed) return
  const args = row.inputJson && typeof row.inputJson === 'object' && !Array.isArray(row.inputJson)
    ? row.inputJson as Record<string, unknown>
    : {}
  scheduleMcpExecuteWork(() => runCampaignChunk({ ...options, args, checkpoint: working }))
}

export async function mcpExecuteCampaignPack(options: {
  db: McpDbClient
  approvalStore: McpApprovalStore
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const args = await hydrateBulkApprovalArgs({ approvalStore: options.approvalStore, userId: options.user.id, toolName: 'execute_campaign_pack', args: options.args })
  const brandId = typeof args.brandId === 'string' ? args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const ctx = await mcpGetBrandContext(options.db, options.user, brandId)
  const offerId = resolveOfferId(ctx, typeof args.offerId === 'string' ? args.offerId : undefined)
  const count = assertMcpBulkCount(args.count ?? BULK_COUNT_DEFAULT, BULK_COUNT_MAX)
  const imageModel = typeof args.imageModel === 'string' ? args.imageModel : 'grok-imagine'
  const existingRefs = await listProductRefUrls(options.user.id, offerId)
  const quote = quoteCampaignPack({ scriptCount: count, imageCount: count, imageModel, expandCount: countExpandNeeded(existingRefs.length) })
  const boundInput = {
    brandId, offerId, count, imageModel,
    styleDnaId: typeof args.styleDnaId === 'string' ? args.styleDnaId : undefined,
    language: languageOf(args.language),
    angleIds: selectedIds(args),
    aspectRatio: typeof args.aspectRatio === 'string' ? args.aspectRatio : '9:16',
    scene: typeof args.scene === 'string' ? args.scene.trim() : undefined,
    guidePrompt: typeof args.guidePrompt === 'string' ? args.guidePrompt.trim() : undefined,
    sessionId: typeof args.sessionId === 'string' ? args.sessionId : undefined,
  }
  const approvalRequestId = typeof args.approvalRequestId === 'string' ? args.approvalRequestId : ''
  const pending = await requireOrIssueApproval({ approvalStore: options.approvalStore, approvalRequestId, userId: options.user.id, toolName: 'execute_campaign_pack', input: boundInput, quotedCreditCost: quote.totalCredits, appOrigin: options.appOrigin, language: boundInput.language })
  if (pending) return { ...pending, quote }

  const claim = await claimMcpExecuteJob(options.approvalStore, { approvalRequestId, toolName: 'execute_campaign_pack', quotedCreditCost: quote.totalCredits })
  if (!claim.claimed) return (asJobHandleFromStored(approvalRequestId, claim.existing, 'execute_campaign_pack') || claim.handle) as Record<string, unknown>

  const angles = await loadAngles({ db: options.db, user: options.user, brandId, offerId, ctx, args })
  const checkpoint = campaignRunning({ approvalRequestId, quote: quote.totalCredits, angles })
  await storeMcpApprovalResult(options.approvalStore, { approvalRequestId, result: checkpoint })
  await resumeMcpCampaignPack({ ...options, jobId: approvalRequestId })
  return checkpoint as unknown as Record<string, unknown>
}

export type { StyleDna } from '../bulk/types.js'
