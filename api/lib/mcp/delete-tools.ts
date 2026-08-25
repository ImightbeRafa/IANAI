/**
 * MCP archive/delete tools — web approval, typed confirm, no Advance credits.
 */

import {
  assertMcpApprovalReady,
  consumeMcpApprovalRequest,
  issueMcpApprovalRequest,
  replayMcpApprovalResult,
  storeMcpApprovalResult,
  type McpApprovalStore,
} from './approval.js'
import {
  assertTypedArchiveConfirm,
  assertTypedAssetDeleteConfirm,
  assertTypedBrandNameConfirm,
  assertTypedOfferNameConfirm,
  buildMcpBrandDeletePreview,
  planMcpBrandDelete,
} from './brand-delete.js'
import type { McpAuthUser, McpDbClient } from './user-tools.js'

export const MCP_BRAND_ARCHIVED_NOTE_KIND = 'brand_archived'

export type McpDeleteStore = {
  listArchivedBrandIds: (userId: string) => Promise<string[]>
  archiveBrand: (options: {
    userId: string
    brandId: string
    brandName: string
  }) => Promise<{ noteId: string; sessionsArchived: number }>
  countBrandImpact: (options: {
    userId: string
    brandId: string
  }) => Promise<{ sessionCount: number; offerCount: number; kitCount: number; sessionIds: string[]; offerIds: string[] }>
  detachBrandKits: (brandId: string) => Promise<number>
  deleteSession: (sessionId: string) => Promise<void>
  deleteOffer: (options: { userId: string; brandId: string; offerId: string }) => Promise<void>
  remainingOfferIds: (brandId: string) => Promise<string[]>
  deleteBrandRow: (options: { userId: string; brandId: string }) => Promise<void>
  deleteAsset: (options: { userId: string; brandId: string; assetId: string }) => Promise<{ imageUrl: string | null }>
  getOffer: (options: { userId: string; brandId: string; offerId: string }) => Promise<{ id: string; name: string } | null>
  getAsset: (options: { userId: string; brandId: string; assetId: string }) => Promise<{ id: string; imageUrl: string | null } | null>
}

function confirmArg(args: Record<string, unknown>): string {
  if (typeof args.confirm === 'string') return args.confirm
  if (typeof args.typedConfirm === 'string') return args.typedConfirm
  return ''
}

async function finalizeDeleteApproval(options: {
  approvalStore: McpApprovalStore
  approvalRequestId: string
  userId: string
  toolName: string
  input: unknown
  result: Record<string, unknown>
}): Promise<void> {
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

async function gateDeleteTool(options: {
  approvalStore: McpApprovalStore
  userId: string
  toolName: string
  input: Record<string, unknown>
  approvalRequestId: string
  appOrigin?: string
  preview: Record<string, unknown>
}): Promise<Record<string, unknown> | null> {
  if (!options.approvalRequestId) {
    const req = await issueMcpApprovalRequest(options.approvalStore, {
      userId: options.userId,
      toolName: options.toolName,
      input: options.input,
      quotedCreditCost: 0,
      appOrigin: options.appOrigin,
    })
    return {
      ...req,
      toolName: options.toolName,
      quotedCreditCost: 0,
      creditUnit: 'credits',
      message: 'Open deepLink, Approve, then retry this tool with the same arguments plus approvalRequestId.',
      boundInput: options.input,
      ...options.preview,
    }
  }
  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.userId,
    toolName: options.toolName,
    input: options.input,
  })
  if (replay.ok) {
    return { ...(replay.result as Record<string, unknown>), replayed: true }
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

export async function mcpArchiveBrand(options: {
  db: McpDbClient
  deleteStore: McpDeleteStore
  approvalStore: McpApprovalStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const confirm = confirmArg(options.args)
  const brand = await options.db.getBusinessForUser(options.user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  assertTypedArchiveConfirm({ brandName: brand.name, typedName: confirm })
  const boundInput = { brandId, confirm }
  const approvalRequestId = typeof options.args.approvalRequestId === 'string' ? options.args.approvalRequestId : ''
  const gated = await gateDeleteTool({
    approvalStore: options.approvalStore,
    userId: options.user.id,
    toolName: 'archive_brand',
    input: boundInput,
    approvalRequestId,
    appOrigin: options.appOrigin,
    preview: {
      warning: 'Archive hides this brand from default MCP lists. Recoverable. Brand kits are kept.',
      requireTypedName: brand.name,
    },
  })
  if (gated) return gated

  const archived = await options.deleteStore.archiveBrand({
    userId: options.user.id,
    brandId,
    brandName: brand.name,
  })
  const result = {
    status: 'archived',
    brandId,
    brandName: brand.name,
    sessionsArchived: archived.sessionsArchived,
    noteId: archived.noteId,
    recoverable: true,
    message: 'Brand archived. Hidden from list_brands. Permanent delete is delete_brand.',
  }
  await finalizeDeleteApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'archive_brand',
    input: boundInput,
    result,
  })
  return result
}

export async function mcpDeleteOffer(options: {
  db: McpDbClient
  deleteStore: McpDeleteStore
  approvalStore: McpApprovalStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  const offerId = typeof options.args.offerId === 'string' ? options.args.offerId : ''
  if (!brandId) throw new Error('brandId is required')
  if (!offerId) throw new Error('offerId is required')
  const confirm = confirmArg(options.args)
  const brand = await options.db.getBusinessForUser(options.user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  const offer = await options.deleteStore.getOffer({ userId: options.user.id, brandId, offerId })
  if (!offer) throw new Error('Offer not found')
  assertTypedOfferNameConfirm({ offerName: offer.name, typedName: confirm })
  const boundInput = { brandId, offerId, confirm }
  const approvalRequestId = typeof options.args.approvalRequestId === 'string' ? options.args.approvalRequestId : ''
  const gated = await gateDeleteTool({
    approvalStore: options.approvalStore,
    userId: options.user.id,
    toolName: 'delete_offer',
    input: boundInput,
    approvalRequestId,
    appOrigin: options.appOrigin,
    preview: {
      warning: 'This permanently deletes the offer. This cannot be undone.',
      requireTypedName: offer.name,
    },
  })
  if (gated) return gated

  await options.deleteStore.deleteOffer({ userId: options.user.id, brandId, offerId })
  const result = {
    status: 'deleted',
    brandId,
    offerId,
    offerName: offer.name,
    message: 'Offer permanently deleted.',
  }
  await finalizeDeleteApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'delete_offer',
    input: boundInput,
    result,
  })
  return result
}

export async function mcpDeleteBrand(options: {
  db: McpDbClient
  deleteStore: McpDeleteStore
  approvalStore: McpApprovalStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const confirm = confirmArg(options.args)
  const brand = await options.db.getBusinessForUser(options.user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  assertTypedBrandNameConfirm({ brandName: brand.name, typedName: confirm })
  const impact = await options.deleteStore.countBrandImpact({ userId: options.user.id, brandId })
  const preview = buildMcpBrandDeletePreview({
    brandId,
    brandName: brand.name,
    sessionCount: impact.sessionCount,
    offerCount: impact.offerCount,
    kitCount: impact.kitCount,
  })
  const boundInput = { brandId, confirm }
  const approvalRequestId = typeof options.args.approvalRequestId === 'string' ? options.args.approvalRequestId : ''
  const gated = await gateDeleteTool({
    approvalStore: options.approvalStore,
    userId: options.user.id,
    toolName: 'delete_brand',
    input: boundInput,
    approvalRequestId,
    appOrigin: options.appOrigin,
    preview,
  })
  if (gated) return gated

  const steps = planMcpBrandDelete({
    businessId: brandId,
    sessionIds: impact.sessionIds,
    productIds: impact.offerIds,
  })
  for (const step of steps) {
    switch (step.type) {
      case 'detach-brand-kits':
        await options.deleteStore.detachBrandKits(step.businessId)
        break
      case 'session':
        await options.deleteStore.deleteSession(step.id)
        break
      case 'product':
        await options.deleteStore.deleteOffer({ userId: options.user.id, brandId, offerId: step.id })
        break
      case 'verify-products': {
        const remaining = await options.deleteStore.remainingOfferIds(brandId)
        if (remaining.length > 0) {
          throw new Error(`Folder delete blocked: ${remaining.length} product(s) still linked after delete.`)
        }
        break
      }
      case 'business':
        await options.deleteStore.deleteBrandRow({ userId: options.user.id, brandId: step.id })
        break
      default: {
        const _never: never = step
        void _never
        throw new Error('Unhandled folder delete step')
      }
    }
  }

  const result = {
    status: 'deleted',
    brandId,
    brandName: brand.name,
    kitsPreserved: preview.kitCountPreserved,
    warning: preview.warning,
    message: 'Brand folder permanently deleted. Brand kits were detached and kept.',
  }
  await finalizeDeleteApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'delete_brand',
    input: boundInput,
    result,
  })
  return result
}

export async function mcpDeleteAsset(options: {
  db: McpDbClient
  deleteStore: McpDeleteStore
  approvalStore: McpApprovalStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  const assetId = typeof options.args.assetId === 'string'
    ? options.args.assetId
    : (typeof options.args.productImageId === 'string' ? options.args.productImageId : '')
  if (!brandId) throw new Error('brandId is required')
  if (!assetId) throw new Error('assetId is required')
  const confirm = confirmArg(options.args)
  const brand = await options.db.getBusinessForUser(options.user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  const asset = await options.deleteStore.getAsset({ userId: options.user.id, brandId, assetId })
  if (!asset) throw new Error('Asset not found')
  assertTypedAssetDeleteConfirm(confirm)
  const boundInput = { brandId, assetId, confirm }
  const approvalRequestId = typeof options.args.approvalRequestId === 'string' ? options.args.approvalRequestId : ''
  const gated = await gateDeleteTool({
    approvalStore: options.approvalStore,
    userId: options.user.id,
    toolName: 'delete_asset',
    input: boundInput,
    approvalRequestId,
    appOrigin: options.appOrigin,
    preview: {
      warning: 'This permanently deletes the image. Type DELETE to confirm. This cannot be undone.',
      requireTypedName: 'DELETE',
    },
  })
  if (gated) return gated

  await options.deleteStore.deleteAsset({ userId: options.user.id, brandId, assetId })
  const result = {
    status: 'deleted',
    brandId,
    assetId,
    message: 'Asset permanently deleted.',
  }
  await finalizeDeleteApproval({
    approvalStore: options.approvalStore,
    approvalRequestId,
    userId: options.user.id,
    toolName: 'delete_asset',
    input: boundInput,
    result,
  })
  return result
}
