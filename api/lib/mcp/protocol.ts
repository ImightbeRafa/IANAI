/**
 * Minimal MCP JSON-RPC (initialize / tools/list / tools/call) for Grok Custom Connector.
 */

import { listEnabledMcpTools, getMcpTool } from './tool-registry.js'
import {
  mcpGetBrandContext,
  mcpListBrands,
  type McpAuthUser,
  type McpDbClient,
} from './user-tools.js'
import { validateMcpGuideIntake } from './guide-intake.js'

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_INFO = {
  name: 'advance-ai',
  version: '0.3.0',
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
  if (name === 'get_brand_context') {
    return {
      type: 'object',
      properties: { brandId: { type: 'string' } },
      required: ['brandId'],
      additionalProperties: false,
    }
  }
  return { type: 'object', properties: {}, additionalProperties: false }
}

export async function handleMcpJsonRpc(options: {
  body: McpJsonRpcRequest
  user: McpAuthUser
  db: McpDbClient
}): Promise<McpJsonRpcResponse> {
  const { body, user, db } = options
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
      const tools = listEnabledMcpTools().map((tool) => ({
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
      try {
        const text = await dispatchEnabledTool({ name, args, user, db })
        return ok(body.id, {
          content: [{ type: 'text', text }],
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
}): Promise<string> {
  switch (options.name) {
    case 'list_brands': {
      const brands = await mcpListBrands(options.db, options.user)
      return JSON.stringify({ brands }, null, 2)
    }
    case 'get_brand_context': {
      const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
      const ctx = await mcpGetBrandContext(options.db, options.user, brandId)
      return JSON.stringify(ctx, null, 2)
    }
    case 'workspace_save_url_context':
    case 'workspace_ingest_file': {
      // Stubs stay disabled in registry; if called, validate then refuse processing.
      const validated = validateMcpGuideIntake({
        brandId: typeof options.args.brandId === 'string' ? options.args.brandId : undefined,
        url: typeof options.args.url === 'string' ? options.args.url : null,
        files: Array.isArray(options.args.files)
          ? options.args.files as Array<{ mimeType: string; name?: string; sizeBytes?: number }>
          : [],
      })
      if (!validated.ok) throw new Error(validated.error)
      throw new Error('GUIDE intake processing is not enabled yet')
    }
    default:
      throw new Error(`Unhandled tool: ${options.name}`)
  }
}
