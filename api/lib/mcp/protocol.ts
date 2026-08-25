/**
 * Minimal MCP JSON-RPC host for Grok Custom Connector.
 */

import { listEnabledMcpTools, getMcpTool } from './tool-registry.js'
import {
  dispatchAdminTool,
  isAdminToolName,
  type McpAdminStore,
} from './admin-tools.js'
import {
  mcpGetBrandContext,
  mcpListBrands,
  type McpAuthUser,
  type McpDbClient,
} from './user-tools.js'
import { saveMcpUrlContext, type McpUrlIntakeStore } from './url-intake.js'
import {
  mcpGuideBrandPack,
  mcpGuideImage,
  mcpGuideScript,
} from './guide-packs.js'
import {
  mcpWorkspaceImportAsset,
  mcpWorkspaceIngestFile,
  mcpWorkspaceNoteGeneratedOutside,
  mcpWorkspaceSaveArtifact,
  type McpWorkspaceStore,
} from './workspace-ops.js'
import {
  mcpExecuteCarouselGenerate,
  mcpExecuteImageEdit,
  mcpExecuteImageEnhance,
  mcpExecuteImageGenerate,
  mcpExecuteScriptGenerate,
} from './execute-tools.js'
import {
  mcpExecuteBulkPosts,
  mcpExecuteBulkScripts,
  mcpExecuteCampaignPack,
  mcpGuideBulkAngles,
  mcpListStyleDnas,
  mcpSetStyleDna,
} from './bulk-tools.js'
import type { McpApprovalStore } from './approval.js'
import type { McpArtifactStore } from './artifact-store.js'
import { getMcpExecuteResult } from './execute-job.js'
import {
  mcpArchiveBrand,
  mcpDeleteAsset,
  mcpDeleteBrand,
  mcpDeleteOffer,
  type McpDeleteStore,
} from './delete-tools.js'
import { mcpConfirmExecute } from './confirm-execute.js'
import {
  mcpCreateBrandKit,
  mcpDeleteBrandKit,
  mcpGetBrandKit,
  mcpLinkBrandKit,
  mcpListBrandKits,
  mcpUpdateBrandKit,
  type McpBrandKitStore,
} from './brand-kit-tools.js'
import { auditMcpToolCall } from './tool-audit.js'

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_INFO = {
  name: 'advance-ai',
  version: '0.9.3',
  title: 'Advance AI',
  websiteUrl: 'https://advanceai.studio',
  icons: [{ src: 'https://advanceai.studio/brand/advance-mark.png', mimeType: 'image/png', sizes: ['74x73'] }],
}

export type McpJsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export type McpJsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function ok(id: string | number | null | undefined, result: unknown): McpJsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function fail(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown
): McpJsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } }
}

function toolInputSchema(name: string): Record<string, unknown> {
  const brand = { brandId: { type: 'string' } }
  const kitWritable = {
    name: { type: 'string' },
    logoUrl: { type: 'string' },
    primaryColor: { type: 'string' },
    secondaryColor: { type: 'string' },
    accentColor: { type: 'string' },
    fontPrimary: { type: 'string' },
    fontSecondary: { type: 'string' },
    tagline: { type: 'string' },
    industry: { type: 'string' },
    targetAudience: { type: 'string' },
    brandVoice: { type: 'string' },
    visualStyleNotes: { type: 'string' },
    toneKeywords: { type: 'array', items: { type: 'string' } },
    mustUsePhrases: { type: 'array', items: { type: 'string' } },
    forbiddenPhrases: { type: 'array', items: { type: 'string' } },
    referenceImageUrls: { type: 'array', items: { type: 'string' } },
    isActive: { type: 'boolean' },
    isDefault: { type: 'boolean' },
    setAsPrimary: { type: 'boolean' },
  }
  switch (name) {
    case 'get_brand_context':
      return {
        type: 'object',
        properties: {
          ...brand,
          brandKitId: {
            type: 'string',
            description: 'Optional linked kit id; otherwise primary/default resolution.',
          },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'list_offers':
    case 'guide_brand_pack':
      return { type: 'object', properties: brand, required: ['brandId'], additionalProperties: false }
    case 'list_assets':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          kind: { type: 'string', enum: ['product', 'context', 'generated'] },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'list_brand_kits':
      return {
        type: 'object',
        properties: {
          brandId: { type: 'string' },
          includeInactive: { type: 'boolean' },
        },
        additionalProperties: false,
      }
    case 'get_brand_kit':
      return {
        type: 'object',
        properties: {
          kitId: { type: 'string' },
          brandId: { type: 'string' },
        },
        required: ['kitId'],
        additionalProperties: false,
      }
    case 'create_brand_kit':
      return {
        type: 'object',
        properties: {
          ...brand,
          ...kitWritable,
        },
        required: ['brandId', 'name'],
        additionalProperties: false,
      }
    case 'update_brand_kit':
      return {
        type: 'object',
        properties: {
          ...brand,
          kitId: { type: 'string' },
          ...kitWritable,
        },
        required: ['brandId', 'kitId'],
        additionalProperties: false,
      }
    case 'link_brand_kit':
      return {
        type: 'object',
        properties: {
          ...brand,
          kitId: { type: 'string' },
          setAsPrimary: { type: 'boolean' },
        },
        required: ['brandId', 'kitId'],
        additionalProperties: false,
      }
    case 'delete_brand_kit':
      return {
        type: 'object',
        properties: {
          kitId: { type: 'string' },
          confirm: { type: 'string', description: 'Type the exact kit name.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['kitId', 'confirm'],
        additionalProperties: false,
      }
    case 'guide_script':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          goal: { type: 'string' },
          language: { type: 'string', enum: ['es', 'en'] },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'guide_image':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          scene: { type: 'string' },
          aspectRatio: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'execute_image_generate':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          scene: { type: 'string' },
          aspectRatio: { type: 'string' },
          imageModel: { type: 'string', enum: ['grok-imagine'] },
          productImageId: { type: 'string' },
          referenceImageIds: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          guidePrompt: { type: 'string' },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'execute_script_generate':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          goal: { type: 'string' },
          language: { type: 'string', enum: ['es', 'en'] },
          framework: {
            type: 'string',
            enum: ['venta_directa', 'desvalidar_alternativas', 'mostrar_servicio', 'variedad_productos', 'paso_a_paso', 'reconocimiento', 'educativo', 'storytelling', 'tendencia', 'engagement'],
          },
          variations: { type: 'number', minimum: 1, maximum: 10 },
          generationMode: { type: 'string', enum: ['mixed', 'by_type'] },
          scriptTypeConfig: { type: 'object' },
          ctaStrength: { type: 'string', enum: ['none', 'soft', 'brand_mention', 'sales'] },
          forceFreshAngles: { type: 'boolean' },
          buyerStage: { type: 'string', enum: ['cold', 'warm', 'hot'] },
          guidePrompt: { type: 'string' },
          sessionId: { type: 'string' },
          approvalRequestId: {
            type: 'string',
            description: 'After in-chat confirm_execute approve. Do not invent. Do not ask the user to open a URL.',
          },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'confirm_execute':
      return {
        type: 'object',
        properties: {
          approvalRequestId: {
            type: 'string',
            description: 'UUID from the previous approval_required response',
          },
          action: {
            type: 'string',
            enum: ['approve', 'deny'],
            description: 'approve after the user clearly says yes in this chat; deny if they cancel',
          },
          decision: {
            type: 'string',
            description: 'Alias for action (approve|deny|yes|no|sí|cancelar)',
          },
        },
        required: ['approvalRequestId'],
        additionalProperties: false,
      }
    case 'get_execute_result':
      return {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'Job id returned by execute_* (same as approvalRequestId)',
          },
          approvalRequestId: {
            type: 'string',
            description: 'Alias for jobId',
          },
        },
        required: [],
        additionalProperties: false,
      }
    case 'guide_bulk_angles':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          count: { type: 'number' },
          language: { type: 'string', enum: ['es', 'en'] },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'list_style_dnas':
      return { type: 'object', properties: brand, required: ['brandId'], additionalProperties: false }
    case 'set_style_dna':
      return {
        type: 'object',
        properties: {
          ...brand,
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['organic', 'ads'] },
          referenceUrls: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['brandId', 'name'],
        additionalProperties: false,
      }
    case 'execute_bulk_scripts':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          count: { type: 'number', maximum: 10 },
          language: { type: 'string', enum: ['es', 'en'] },
          angleIds: { type: 'array', items: { type: 'string' } },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
          guidePrompt: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'execute_bulk_posts':
    case 'execute_campaign_pack':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          count: { type: 'number', maximum: 10 },
          language: { type: 'string', enum: ['es', 'en'] },
          angleIds: { type: 'array', items: { type: 'string' } },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
          imageModel: { type: 'string' },
          styleDnaId: { type: 'string' },
          aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '3:4'] },
          scene: { type: 'string' },
          guidePrompt: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'workspace_save_url_context':
      return {
        type: 'object',
        properties: {
          ...brand,
          url: { type: 'string' },
        },
        required: ['brandId', 'url'],
        additionalProperties: false,
      }
    case 'workspace_ingest_file':
      return {
        type: 'object',
        properties: {
          ...brand,
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                mimeType: { type: 'string' },
                sizeBytes: { type: 'number' },
              },
              required: ['mimeType'],
            },
          },
        },
        required: ['brandId', 'files'],
        additionalProperties: false,
      }
    case 'workspace_note_generated_outside':
      return {
        type: 'object',
        properties: {
          ...brand,
          kind: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'workspace_import_asset':
      return {
        type: 'object',
        properties: brand,
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'workspace_save_artifact':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          kind: { type: 'string', enum: ['script', 'image', 'product', 'context'] },
          title: { type: 'string' },
          content: { type: 'string', description: 'Script text. Do not send huge payloads.' },
          imageUrl: { type: 'string', description: 'https URL only — no base64 data URLs.' },
          productImageId: { type: 'string' },
          scriptId: { type: 'string' },
          sessionId: { type: 'string' },
        },
        required: ['brandId', 'kind'],
        additionalProperties: false,
      }
    case 'execute_image_edit':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          productImageId: { type: 'string' },
          imageUrl: { type: 'string', description: 'https URL of an already-in-workspace or public image. No base64.' },
          editPrompt: { type: 'string' },
          aspectRatio: { type: 'string' },
          guidePrompt: { type: 'string' },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'editPrompt'],
        additionalProperties: false,
      }
    case 'execute_image_enhance':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          productImageId: { type: 'string', description: 'Optional; defaults to the latest generated image for the offer.' },
          imageUrl: { type: 'string', description: 'Optional https URL. Defaults to the latest generated image for the offer. No base64.' },
          enhanceTier: { type: 'string', enum: ['polish', 'modernize', 'rebuild'] },
          instruction: { type: 'string' },
          aspectRatio: { type: 'string' },
          language: { type: 'string', enum: ['es', 'en'] },
          guidePrompt: { type: 'string' },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'execute_carousel_generate':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          scriptId: { type: 'string' },
          scriptContent: { type: 'string' },
          subtype: { type: 'string', enum: ['educational-list', 'how-to-steps', 'before-after', 'myth-vs-fact'] },
          slideCount: { type: 'number', minimum: 2, maximum: 5 },
          aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '3:4'] },
          language: { type: 'string', enum: ['es', 'en'] },
          designDirection: { type: 'string' },
          slideDetails: { type: 'string' },
          productImageId: { type: 'string' },
          referenceImageIds: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          guidePrompt: { type: 'string' },
          previewFirstSlideOnly: { type: 'boolean' },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId'],
        anyOf: [{ required: ['scriptId'] }, { required: ['scriptContent'] }],
        additionalProperties: false,
      }
    case 'archive_brand':
      return {
        type: 'object',
        properties: {
          ...brand,
          confirm: { type: 'string', description: 'Type the exact brand name.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'confirm'],
        additionalProperties: false,
      }
    case 'delete_offer':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          confirm: { type: 'string', description: 'Type the exact offer name.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'offerId', 'confirm'],
        additionalProperties: false,
      }
    case 'delete_brand':
      return {
        type: 'object',
        properties: {
          ...brand,
          confirm: { type: 'string', description: 'Type the exact brand name. Permanent. No recovery.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'confirm'],
        additionalProperties: false,
      }
    case 'delete_asset':
      return {
        type: 'object',
        properties: {
          ...brand,
          assetId: { type: 'string' },
          productImageId: { type: 'string' },
          confirm: { type: 'string', description: 'Must be DELETE.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'confirm'],
        additionalProperties: false,
      }
    case 'admin_list_tickets':
      return {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      }
    case 'admin_get_ticket':
    case 'admin_request_cursor_fix':
      return {
        type: 'object',
        properties: { ticketId: { type: 'string' } },
        required: ['ticketId'],
        additionalProperties: false,
      }
    case 'admin_update_ticket':
      return {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
          comment: { type: 'string' },
        },
        required: ['ticketId'],
        additionalProperties: false,
      }
    case 'admin_get_usage':
      return {
        type: 'object',
        properties: {
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          source: { type: 'string', enum: ['mcp', 'web', 'cron'] },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      }
    default:
      return { type: 'object', properties: {}, additionalProperties: false }
  }
}

export async function handleMcpJsonRpc(options: {
  body: McpJsonRpcRequest
  user: McpAuthUser
  db: McpDbClient
  urlIntakeStore?: McpUrlIntakeStore | null
  workspaceStore?: McpWorkspaceStore | null
  approvalStore?: McpApprovalStore | null
  artifactStore?: McpArtifactStore | null
  adminStore?: McpAdminStore | null
  deleteStore?: McpDeleteStore | null
  brandKitStore?: McpBrandKitStore | null
  isAdmin?: boolean
  appOrigin?: string
}): Promise<McpJsonRpcResponse> {
  const { body, user, db } = options
  const isAdmin = options.isAdmin === true
  if (body.jsonrpc && body.jsonrpc !== '2.0') {
    return fail(body.id, -32600, 'Invalid Request: jsonrpc must be 2.0')
  }
  const method = body.method || ''
  const params = body.params || {}

  switch (method) {
    case 'initialize':
      return ok(body.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO,
      })
    case 'notifications/initialized':
      return ok(body.id, {})
    case 'tools/list': {
      const tools = listEnabledMcpTools({ isAdmin }).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toolInputSchema(tool.name),
      }))
      return ok(body.id, { tools })
    }
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments && typeof params.arguments === 'object')
        ? params.arguments as Record<string, unknown>
        : {}
      const def = getMcpTool(name)
      if (!def || !def.enabled) {
        return fail(body.id, -32601, `Unknown or disabled tool: ${name || '(missing)'}`)
      }
      if ((def.group === 'admin' || def.risk === 'admin' || isAdminToolName(name)) && !isAdmin) {
        return fail(body.id, -32601, `Unknown or disabled tool: ${name}`)
      }
      const startedAt = Date.now()
      try {
        const payload = await dispatchEnabledTool({
          name,
          args,
          user,
          db,
          urlIntakeStore: options.urlIntakeStore,
          workspaceStore: options.workspaceStore,
          approvalStore: options.approvalStore,
          artifactStore: options.artifactStore,
          adminStore: options.adminStore,
          deleteStore: options.deleteStore,
          brandKitStore: options.brandKitStore,
          isAdmin,
          appOrigin: options.appOrigin,
        })
        await auditMcpToolCall({
          userId: user.id,
          userEmail: user.email,
          toolName: name,
          risk: def.risk,
          durationMs: Date.now() - startedAt,
          success: true,
          resultPayload: payload,
        })
        return ok(body.id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          isError: false,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tool failed'
        await auditMcpToolCall({
          userId: user.id,
          userEmail: user.email,
          toolName: name,
          risk: def.risk,
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: message,
        })
        return ok(body.id, {
          content: [{ type: 'text', text: message }],
          isError: true,
        })
      }
    }
    default:
      return fail(body.id, -32601, `Method not found: ${method || '(missing)'}`)
  }
}

async function dispatchEnabledTool(options: {
  name: string
  args: Record<string, unknown>
  user: McpAuthUser
  db: McpDbClient
  urlIntakeStore?: McpUrlIntakeStore | null
  workspaceStore?: McpWorkspaceStore | null
  approvalStore?: McpApprovalStore | null
  artifactStore?: McpArtifactStore | null
  adminStore?: McpAdminStore | null
  deleteStore?: McpDeleteStore | null
  brandKitStore?: McpBrandKitStore | null
  isAdmin?: boolean
  appOrigin?: string
}): Promise<unknown> {
  if (isAdminToolName(options.name)) {
    if (!options.isAdmin) throw new Error('Admin access required')
    if (!options.adminStore) throw new Error('Admin store not configured')
    return dispatchAdminTool({
      name: options.name,
      args: options.args,
      store: options.adminStore,
    })
  }

  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  const brandKitId = typeof options.args.brandKitId === 'string' ? options.args.brandKitId : undefined

  switch (options.name) {
    case 'list_brands':
      return {
        brands: await mcpListBrands(options.db, options.user),
        defaultOfferPolicy:
          'defaultOfferId is the first owned offer; defaultOfferResolution reports whether a resolved brand kit is available. Duplicate names are never merged or deleted—select by id.',
      }
    case 'list_offers': {
      if (!brandId) throw new Error('brandId is required')
      const brand = await options.db.getBusinessForUser(options.user.id, brandId)
      if (!brand) throw new Error('Brand not found')
      return { offers: await options.db.listOffersForBrand(options.user.id, brandId) }
    }
    case 'list_assets': {
      if (!brandId) throw new Error('brandId is required')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      const kind = options.args.kind === 'product'
        || options.args.kind === 'context'
        || options.args.kind === 'generated'
        ? options.args.kind
        : undefined
      const assets = await options.artifactStore.listOwnedAssets({
        userId: options.user.id,
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
        kind,
      })
      return {
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : null,
        kind: kind || 'all',
        assets: assets.map((asset) => ({
          id: asset.id,
          productImageId: asset.id,
          offerId: asset.offerId,
          imageUrl: asset.imageUrl,
          kind: asset.kind,
          label: asset.label || null,
          createdAt: asset.createdAt || null,
        })),
      }
    }
    case 'get_brand_context':
      return mcpGetBrandContext(options.db, options.user, brandId, brandKitId)
    case 'list_brand_kits': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpListBrandKits({
        store: options.brandKitStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'get_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpGetBrandKit({
        store: options.brandKitStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'create_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpCreateBrandKit({
        store: options.brandKitStore,
        db: options.db,
        user: options.user,
        args: options.args,
      })
    }
    case 'update_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpUpdateBrandKit({
        store: options.brandKitStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'link_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpLinkBrandKit({
        store: options.brandKitStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'delete_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      if (!options.approvalStore) throw new Error('Approval store not configured')
      return mcpDeleteBrandKit({
        store: options.brandKitStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'guide_brand_pack':
      return mcpGuideBrandPack(options.db, options.user, brandId)
    case 'guide_script':
      return mcpGuideScript(options.db, options.user, {
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
        goal: typeof options.args.goal === 'string' ? options.args.goal : undefined,
        language: typeof options.args.language === 'string' ? options.args.language : undefined,
      })
    case 'guide_image':
      return mcpGuideImage(options.db, options.user, {
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
        scene: typeof options.args.scene === 'string' ? options.args.scene : undefined,
        aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : undefined,
      })
    case 'workspace_save_url_context': {
      if (!options.urlIntakeStore) throw new Error('URL intake store not configured')
      return saveMcpUrlContext({
        db: options.db,
        store: options.urlIntakeStore,
        user: options.user,
        brandId,
        url: typeof options.args.url === 'string' ? options.args.url : '',
        appOrigin: options.appOrigin,
      })
    }
    case 'workspace_ingest_file': {
      if (!options.workspaceStore) throw new Error('Workspace store not configured')
      return mcpWorkspaceIngestFile({
        db: options.db,
        store: options.workspaceStore,
        user: options.user,
        brandId,
        files: Array.isArray(options.args.files)
          ? options.args.files as Array<{ name?: string; mimeType: string; sizeBytes?: number }>
          : [],
        appOrigin: options.appOrigin,
      })
    }
    case 'workspace_note_generated_outside': {
      if (!options.workspaceStore) throw new Error('Workspace store not configured')
      return mcpWorkspaceNoteGeneratedOutside({
        db: options.db,
        store: options.workspaceStore,
        user: options.user,
        brandId,
        kind: typeof options.args.kind === 'string' ? options.args.kind : undefined,
        note: typeof options.args.note === 'string' ? options.args.note : undefined,
        appOrigin: options.appOrigin,
      })
    }
    case 'workspace_import_asset':
      return mcpWorkspaceImportAsset({
        db: options.db,
        user: options.user,
        brandId,
        appOrigin: options.appOrigin,
      })
    case 'execute_script_generate': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteScriptGenerate({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'confirm_execute': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      return mcpConfirmExecute({
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'get_execute_result': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      return getMcpExecuteResult({
        approvalStore: options.approvalStore,
        userId: options.user.id,
        jobId: typeof options.args.jobId === 'string' ? options.args.jobId : undefined,
        approvalRequestId:
          typeof options.args.approvalRequestId === 'string'
            ? options.args.approvalRequestId
            : undefined,
      })
    }
    case 'execute_image_generate': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteImageGenerate({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'guide_bulk_angles':
      return mcpGuideBulkAngles(options.db, options.user, options.args)
    case 'list_style_dnas':
      return mcpListStyleDnas(options.db, options.user, brandId)
    case 'set_style_dna':
      return mcpSetStyleDna(options.db, options.user, options.args)
    case 'execute_bulk_scripts': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteBulkScripts({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_bulk_posts': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteBulkPosts({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_campaign_pack': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteCampaignPack({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_image_edit': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteImageEdit({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_image_enhance': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteImageEnhance({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_carousel_generate': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteCarouselGenerate({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'workspace_save_artifact': {
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpWorkspaceSaveArtifact({
        db: options.db,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'archive_brand': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.deleteStore) throw new Error('Delete store not configured')
      return mcpArchiveBrand({
        db: options.db,
        deleteStore: options.deleteStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'delete_offer': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.deleteStore) throw new Error('Delete store not configured')
      return mcpDeleteOffer({
        db: options.db,
        deleteStore: options.deleteStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'delete_brand': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.deleteStore) throw new Error('Delete store not configured')
      return mcpDeleteBrand({
        db: options.db,
        deleteStore: options.deleteStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'delete_asset': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.deleteStore) throw new Error('Delete store not configured')
      return mcpDeleteAsset({
        db: options.db,
        deleteStore: options.deleteStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    default:
      throw new Error(`Unhandled tool: ${options.name}`)
  }
}
