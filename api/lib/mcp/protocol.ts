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
  type McpWorkspaceStore,
} from './workspace-ops.js'
import {
  mcpExecuteImageGenerate,
  mcpExecuteScriptGenerate,
} from './execute-tools.js'
import type { McpApprovalStore } from './approval.js'
import type { McpArtifactStore } from './artifact-store.js'

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_INFO = {
  name: 'advance-ai',
  version: '0.7.0',
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
  switch (name) {
    case 'get_brand_context':
    case 'list_offers':
    case 'guide_brand_pack':
      return { type: 'object', properties: brand, required: ['brandId'], additionalProperties: false }
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
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
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
          isAdmin,
          appOrigin: options.appOrigin,
        })
        return ok(body.id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          isError: false,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tool failed'
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

  switch (options.name) {
    case 'list_brands':
      return { brands: await mcpListBrands(options.db, options.user) }
    case 'list_offers': {
      if (!brandId) throw new Error('brandId is required')
      const brand = await options.db.getBusinessForUser(options.user.id, brandId)
      if (!brand) throw new Error('Brand not found')
      return { offers: await options.db.listOffersForBrand(options.user.id, brandId) }
    }
    case 'get_brand_context':
      return mcpGetBrandContext(options.db, options.user, brandId)
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
    default:
      throw new Error(`Unhandled tool: ${options.name}`)
  }
}
