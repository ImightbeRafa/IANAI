/**
 * Load / approve / deny MCP EXECUTE approval requests (signed-in user only).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { createMcpApprovalStore } from './lib/mcp/approval-store.js'
import {
  approveMcpApprovalRequest,
  denyMcpApprovalRequest,
} from './lib/mcp/approval.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const user = await requireAuth(req, res)
  if (!user) return

  const store = createMcpApprovalStore()
  if (!store) {
    res.status(500).json({ error: 'Approval store unavailable' })
    return
  }

  if (req.method === 'GET') {
    const id = typeof req.query.id === 'string' ? req.query.id : ''
    if (!id) {
      res.status(400).json({ error: 'id required' })
      return
    }
    const row = await store.findById(id)
    if (!row || row.userId !== user.id) {
      res.status(404).json({ error: 'Approval not found' })
      return
    }
    res.status(200).json({
      approval: {
        id: row.id,
        tool_name: row.toolName,
        status: row.status,
        quoted_credit_cost: row.quotedCreditCost,
        expires_at: new Date(row.expiresAtMs).toISOString(),
        input_json: row.inputJson,
      },
    })
    return
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      id?: string
      action?: string
    }
    const id = typeof body.id === 'string' ? body.id : ''
    const action = body.action === 'deny' ? 'deny' : body.action === 'approve' ? 'approve' : ''
    if (!id || !action) {
      res.status(400).json({ error: 'id and action (approve|deny) required' })
      return
    }
    const result = action === 'approve'
      ? await approveMcpApprovalRequest(store, { approvalRequestId: id, userId: user.id })
      : await denyMcpApprovalRequest(store, { approvalRequestId: id, userId: user.id })
    if (!result.ok) {
      res.status(400).json({ error: result.reason })
      return
    }
    res.status(200).json({ status: result.record.status, id: result.record.id })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
