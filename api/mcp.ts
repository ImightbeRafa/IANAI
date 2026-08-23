/**
 * Advance MCP HTTP host for Grok Custom Connector.
 * URL: https://advanceai.studio/api/mcp
 *
 * Auth: Bearer Supabase access token (same as the web app API).
 * OAuth browser login for Grok will mint this token via Advance login (next slice).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { createMcpSupabaseAdapter } from './lib/mcp/supabase-adapter.js'
import { handleMcpJsonRpc, type McpJsonRpcRequest } from './lib/mcp/protocol.js'

const MAX_BODY_BYTES = 256_000

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
      tools: 'POST JSON-RPC initialize | tools/list | tools/call',
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

  const user = await requireAuth(req, res)
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
  const rpc = await handleMcpJsonRpc({
    body,
    user: { id: user.id, email: user.email },
    db,
  })

  res.status(200).json(rpc)
}
