/**
 * Advance MCP HTTP host for Grok Custom Connector.
 * URL: https://advanceai.studio/api/mcp
 *
 * Auth: Bearer Supabase access token (same as the web app API).
 * Unauthenticated calls get WWW-Authenticate pointing at protected-resource metadata.
 *
 * EXECUTE generation: claim job → return jobId immediately → waitUntil continues
 * work so Grok polls get_execute_result instead of MCP -32001 timeout.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import { isAdminUser, requireAuth } from './lib/auth.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { createMcpAdminStore, createMcpSupabaseAdapter, createMcpUrlIntakeStore, createMcpWorkspaceStore, createMcpDeleteStore, createMcpBrandKitStore } from './lib/mcp/supabase-adapter.js'
import { createMcpApprovalStore } from './lib/mcp/approval-store.js'
import { createMcpArtifactStore } from './lib/mcp/artifact-store.js'
import { setMcpExecuteScheduler } from './lib/mcp/execute-job.js'
import { handleMcpJsonRpc, type McpJsonRpcRequest } from './lib/mcp/protocol.js'
import { mcpWwwAuthenticateHeader, MCP_RESOURCE_METADATA_URL } from './lib/mcp/www-authenticate.js'

const MAX_BODY_BYTES = 256_000
const MCP_WWW_AUTHENTICATE = mcpWwwAuthenticateHeader()

// Keep EXECUTE work alive after the JSON-RPC response returns (jobId + poll).
setMcpExecuteScheduler((work) => {
  waitUntil(
    work().catch((err) => {
      console.error('mcp execute waitUntil', err instanceof Error ? err.message : err)
    })
  )
})

function readRawBodySize(req: VercelRequest): number {
  if (typeof req.body === 'string') return Buffer.byteLength(req.body)
  if (req.body == null) return 0
  try {
    return Buffer.byteLength(JSON.stringify(req.body))
  } catch {
    return MAX_BODY_BYTES + 1
  }
}

function setMcpHeaders(res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setMcpHeaders(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method === 'GET') {
    res.status(200).json({
      name: 'advance-ai',
      mcp: true,
      transport: 'http',
      auth: 'bearer_supabase_jwt',
      docs: 'https://advanceai.studio',
      oauth_protected_resource: MCP_RESOURCE_METADATA_URL,
      tools: 'POST JSON-RPC initialize | tools/list | tools/call',
      executeJobs:
        'execute_script_generate / execute_image_generate / execute_image_edit / execute_image_enhance / execute_carousel_generate / execute_bulk_scripts / execute_bulk_posts / execute_campaign_pack return jobId + statusMessage; poll get_execute_result',
    })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (readRawBodySize(req) > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'Request body too large' })
    return
  }

  const user = await requireAuth(req, res, {
    unauthorizedHeaders: { 'WWW-Authenticate': MCP_WWW_AUTHENTICATE },
  })
  if (!user) return

  const rate = checkRateLimit(`mcp:${user.id}`, { maxRequests: 60, windowSeconds: 60 })
  if (!rate.allowed) {
    res.status(429).json({
      error: 'Too many MCP requests',
      retryAfter: rate.resetInSeconds,
    })
    return
  }

  const db = createMcpSupabaseAdapter()
  if (!db) {
    res.status(500).json({ error: 'Database not configured' })
    return
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as McpJsonRpcRequest
  const isAdmin = await isAdminUser(user.id)
  const rpc = await handleMcpJsonRpc({
    body,
    user: { id: user.id, email: user.email },
    db,
    urlIntakeStore: createMcpUrlIntakeStore(),
    workspaceStore: createMcpWorkspaceStore(),
    approvalStore: createMcpApprovalStore(),
    artifactStore: createMcpArtifactStore(),
    adminStore: isAdmin ? createMcpAdminStore() : null,
    deleteStore: createMcpDeleteStore(),
    brandKitStore: createMcpBrandKitStore(),
    isAdmin,
    appOrigin: 'https://advanceai.studio',
  })

  res.status(200).json(rpc)
}
