/**
 * MCP door for the Ad Pack engine (`adpack_*`). Thin wrappers over the same
 * `AdPackService` the web endpoint (`api/ad-pack.ts`) uses.
 *
 * - adpack_start / adpack_regenerate spend credits: in-chat approval
 *   (approval_required → confirm_execute → retry with approvalRequestId).
 *   The approval id doubles as the packId, so retries are idempotent.
 * - Background work goes through the MCP execute scheduler (waitUntil in
 *   api/mcp.ts); adpack_status also advances inline when no worker holds a
 *   lease, so a dropped background task never stalls the pack.
 */
import {
  ADPACK_BACKGROUND_BUDGET_MS,
  ADPACK_INLINE_BUDGET_MS,
  AdPackError,
  isAdPackError,
  type AdPackService,
} from '../adpack/service.js'
import type { AdPackItemView, AdPackStatusResponse } from '../adpack/http-types.js'
import {
  assertMcpApprovalReady,
  consumeMcpApprovalRequest,
  replayMcpApprovalResult,
  storeMcpApprovalResult,
  type McpApprovalStore,
} from './approval.js'
import { issueMcpChatApproval } from './approval-prompt.js'
import { scheduleMcpExecuteWork, withStatusMessage } from './execute-job.js'
import type { McpAuthUser } from './user-tools.js'

export const ADPACK_MCP_TOOLS = [
  'adpack_dna_ingest',
  'adpack_dna_confirm',
  'adpack_angles',
  'adpack_quote',
  'adpack_start',
  'adpack_status',
  'adpack_edit_text',
  'adpack_regenerate',
] as const

export type AdPackMcpToolName = typeof ADPACK_MCP_TOOLS[number]

export function isAdPackMcpTool(name: string): name is AdPackMcpToolName {
  return (ADPACK_MCP_TOOLS as readonly string[]).includes(name)
}

type Args = Record<string, unknown>

/** Errors keep the machine code (INSUFFICIENT_CREDITS, NOT_FOUND, …) for the host. */
function rethrow(err: unknown): never {
  if (isAdPackError(err)) {
    const e = new Error(err.message) as Error & { code: string; details?: unknown }
    e.code = err.code
    if (err.details) e.details = err.details
    throw e
  }
  throw err
}

function scheduleAdvance(service: AdPackService, userId: string, packId: string): void {
  scheduleMcpExecuteWork(async () => {
    await service.advance({ userId, packId, budgetMs: ADPACK_BACKGROUND_BUDGET_MS })
  })
}

function compactItem(item: AdPackItemView) {
  return {
    itemId: item.id,
    index: item.index,
    status: item.status,
    format: item.format,
    headline: item.headline ?? null,
    renders: item.renders.map((r) => ({ ratio: r.ratio, imageUrl: r.imageUrl })),
    charged: item.charged,
    ...(item.error ? { error: item.error } : {}),
  }
}

function statusPayload(status: AdPackStatusResponse, language: 'es' | 'en' = 'es') {
  const { done, failed, total } = status.progress
  const statusMessage = status.moreWork
    ? `Advance está creando tu pack de anuncios: ${done}/${total} listos. / Advance is building your ad pack: ${done}/${total} ready.`
    : status.status === 'cancelled'
      ? 'Pack cancelado. / Pack cancelled.'
      : `Pack listo: ${done}/${total} anuncios${failed ? ` (${failed} fallaron)` : ''}. / Pack ready: ${done}/${total} ads${failed ? ` (${failed} failed)` : ''}.`
  return {
    packId: status.packId,
    status: status.status,
    progress: status.progress,
    quotedCredits: status.quotedCredits,
    chargedCredits: status.chargedCredits,
    moreWork: status.moreWork,
    items: status.items.map(compactItem),
    statusMessage,
    ...(status.moreWork
      ? { retryAfterMs: 4_000, nextTool: 'adpack_status', instructionsForGrok: language === 'en' ? 'Poll adpack_status with this packId until moreWork=false, then show each ad image.' : 'Llamá adpack_status con este packId hasta moreWork=false y luego mostrá cada imagen.' }
      : {}),
  }
}

async function approvedOrPrompt(options: {
  approvalStore: McpApprovalStore
  user: McpAuthUser
  toolName: 'adpack_start' | 'adpack_regenerate'
  input: Record<string, unknown>
  approvalRequestId: string
  quotedCreditCost: number
  summaryEs: string
  summaryEn: string
  appOrigin?: string
}): Promise<{ prompt: Record<string, unknown> } | { replay: Record<string, unknown> } | { approved: true }> {
  if (!options.approvalRequestId) {
    return {
      prompt: await issueMcpChatApproval({
        approvalStore: options.approvalStore,
        userId: options.user.id,
        toolName: options.toolName,
        input: options.input,
        quotedCreditCost: options.quotedCreditCost,
        appOrigin: options.appOrigin,
        summaryEs: options.summaryEs,
        summaryEn: options.summaryEn,
      }),
    }
  }
  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.user.id,
    toolName: options.toolName,
    input: options.input,
  })
  if (replay.ok && replay.result && typeof replay.result === 'object' && (replay.result as { status?: unknown }).status === 'completed') {
    return { replay: { ...(replay.result as Record<string, unknown>), replayed: true } }
  }
  const ready = await assertMcpApprovalReady(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.user.id,
    toolName: options.toolName,
    input: options.input,
  })
  if (!ready.ok) throw new Error(ready.reason)
  return { approved: true }
}

async function finalize(options: {
  approvalStore: McpApprovalStore
  user: McpAuthUser
  toolName: string
  input: Record<string, unknown>
  approvalRequestId: string
  result: Record<string, unknown>
}): Promise<void> {
  await storeMcpApprovalResult(options.approvalStore, { approvalRequestId: options.approvalRequestId, result: options.result })
  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.user.id,
    toolName: options.toolName,
    input: options.input,
  })
  if (!consumed.ok) throw new Error(consumed.reason)
}

function startBoundInput(args: Args): Record<string, unknown> {
  const bound: Record<string, unknown> = { dna: args.dna, offer: args.offer }
  for (const key of ['size', 'ratios', 'businessId', 'brandKitId'] as const) {
    if (args[key] !== undefined) bound[key] = args[key]
  }
  return bound
}

export async function dispatchAdPackTool(options: {
  name: AdPackMcpToolName
  args: Args
  user: McpAuthUser
  service: AdPackService
  approvalStore?: McpApprovalStore | null
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const { name, args, user, service } = options
  const userId = user.id
  try {
    switch (name) {
      case 'adpack_dna_ingest': {
        const res = await service.ingestDna({
          userId,
          source: 'mcp',
          websiteUrl: args.websiteUrl as string | undefined,
          instagramUrl: args.instagramUrl as string | undefined,
          uploads: args.uploads as never,
          offerForm: args.offerForm as never,
          userFacts: args.userFacts as never,
          language: args.language as never,
        })
        return {
          ...res,
          nextStep: 'Show dna.facts and dna.gaps to the user; confirm or fix facts with adpack_dna_confirm (only confirmed facts become claims).',
        }
      }
      case 'adpack_dna_confirm':
        return { ...(await service.confirmDna({ userId, dna: args.dna, edits: args.edits })) }
      case 'adpack_angles':
        return { ...(await service.planAngles({ userId, dna: args.dna, offer: args.offer, size: args.size })) }
      case 'adpack_quote':
        return { ...(await service.quote({ userId, size: args.size, dna: args.dna, offer: args.offer })) }
      case 'adpack_start': {
        if (!options.approvalStore) throw new Error('Approval store not configured')
        const input = startBoundInput(args)
        // Validate + quote before asking for approval (same parser as the web door).
        const quote = await service.quote({ userId, size: args.size, dna: args.dna, offer: args.offer })
        const approvalRequestId = typeof args.approvalRequestId === 'string' ? args.approvalRequestId : ''
        const gate = await approvedOrPrompt({
          approvalStore: options.approvalStore,
          user,
          toolName: 'adpack_start',
          input,
          approvalRequestId,
          quotedCreditCost: quote.credits,
          summaryEs: `Pack de ${quote.size} anuncios estáticos (${quote.perAd} créditos por anuncio)`,
          summaryEn: `Pack of ${quote.size} static ads (${quote.perAd} credits per ad)`,
          appOrigin: options.appOrigin,
        })
        if ('prompt' in gate) return { ...gate.prompt, quote }
        if ('replay' in gate) {
          const packId = String(gate.replay.packId || '')
          if (packId) scheduleAdvance(service, userId, packId)
          return gate.replay
        }
        const started = await service.startPack({
          userId,
          dna: args.dna,
          offer: args.offer,
          size: args.size,
          ratios: args.ratios,
          businessId: args.businessId,
          brandKitId: args.brandKitId,
          source: 'mcp',
          packId: approvalRequestId,
        })
        const result = withStatusMessage({
          status: 'completed',
          jobId: approvalRequestId,
          approvalRequestId,
          packId: started.packId,
          packStatus: started.status,
          quote: started.quote,
          quotedCreditCost: started.quote.credits,
          // Credits are charged per finished ad while the pack runs.
          chargedCredits: 0,
          nextTool: 'adpack_status',
          message: 'Pack started. Poll adpack_status with packId until moreWork=false; credits are charged per finished ad.',
        }, 'adpack_start')
        await finalize({ approvalStore: options.approvalStore, user, toolName: 'adpack_start', input, approvalRequestId, result })
        scheduleAdvance(service, userId, started.packId)
        return result
      }
      case 'adpack_status': {
        const status = await service.pollStatus({ userId, packId: args.packId, inlineBudgetMs: ADPACK_INLINE_BUDGET_MS })
        if (status.moreWork) scheduleAdvance(service, userId, status.packId)
        return statusPayload(status, args.language === 'en' ? 'en' : 'es')
      }
      case 'adpack_edit_text': {
        const res = await service.editText({ userId, packId: args.packId, itemId: args.itemId, copy: args.copy })
        return { item: compactItem(res.item), copy: res.item.copy ?? null, chargedCredits: 0 }
      }
      case 'adpack_regenerate': {
        if (!options.approvalStore) throw new Error('Approval store not configured')
        const input: Record<string, unknown> = { packId: args.packId, itemId: args.itemId, mode: args.mode ?? 'scene' }
        if (typeof args.packId !== 'string' || typeof args.itemId !== 'string') throw new AdPackError('BAD_INPUT', 'packId and itemId are required')
        // Ownership check before issuing an approval.
        await service.getStatus({ userId, packId: args.packId })
        const quote = await service.quote({ userId, size: 1 })
        const approvalRequestId = typeof args.approvalRequestId === 'string' ? args.approvalRequestId : ''
        const gate = await approvedOrPrompt({
          approvalStore: options.approvalStore,
          user,
          toolName: 'adpack_regenerate',
          input,
          approvalRequestId,
          quotedCreditCost: quote.credits,
          summaryEs: 'Regenerar un anuncio del pack',
          summaryEn: 'Regenerate one ad in the pack',
          appOrigin: options.appOrigin,
        })
        if ('prompt' in gate) return gate.prompt
        if ('replay' in gate) return gate.replay
        const regen = await service.regenerate({ userId, packId: args.packId, itemId: args.itemId, mode: input.mode })
        const result = withStatusMessage({
          status: 'completed',
          jobId: approvalRequestId,
          approvalRequestId,
          packId: args.packId,
          item: compactItem(regen.item),
          quotedCreditCost: regen.quote.credits,
          chargedCredits: 0,
          nextTool: 'adpack_status',
          message: 'Ad queued for regeneration. Poll adpack_status; credits are charged when the new version finishes.',
        }, 'adpack_regenerate')
        await finalize({ approvalStore: options.approvalStore, user, toolName: 'adpack_regenerate', input, approvalRequestId, result })
        scheduleAdvance(service, userId, args.packId)
        return result
      }
    }
  } catch (err) {
    rethrow(err)
  }
}
