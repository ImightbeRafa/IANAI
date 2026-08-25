/**
 * confirm_execute — approve/deny pending MCP EXECUTE from Grok chat (no fishy link required).
 */

import {
  approveMcpApprovalRequest,
  denyMcpApprovalRequest,
  type McpApprovalStore,
} from './approval.js'
import type { McpAuthUser } from './user-tools.js'

function parseDecision(args: Record<string, unknown>): 'approve' | 'deny' | '' {
  const raw =
    typeof args.action === 'string'
      ? args.action
      : typeof args.decision === 'string'
        ? args.decision
        : ''
  const normalized = raw.trim().toLowerCase()
  if (
    normalized === 'approve'
    || normalized === 'yes'
    || normalized === 'y'
    || normalized === 'si'
    || normalized === 'sí'
    || normalized === 'aprobar'
  ) {
    return 'approve'
  }
  if (
    normalized === 'deny'
    || normalized === 'no'
    || normalized === 'n'
    || normalized === 'cancel'
    || normalized === 'cancelar'
  ) {
    return 'deny'
  }
  return ''
}

export async function mcpConfirmExecute(options: {
  approvalStore: McpApprovalStore
  user: McpAuthUser
  args: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const approvalRequestId = typeof options.args.approvalRequestId === 'string'
    ? options.args.approvalRequestId.trim()
    : ''
  const action = parseDecision(options.args)

  if (!approvalRequestId) throw new Error('approvalRequestId is required')
  if (!action) throw new Error('action must be approve or deny')

  const result = action === 'approve'
    ? await approveMcpApprovalRequest(options.approvalStore, {
      approvalRequestId,
      userId: options.user.id,
    })
    : await denyMcpApprovalRequest(options.approvalStore, {
      approvalRequestId,
      userId: options.user.id,
    })

  if (!result.ok) {
    throw new Error(result.reason)
  }

  if (action === 'deny') {
    return {
      status: 'denied',
      approvalRequestId,
      message:
        'Cancelled. Tell the user the Advance action was denied and do not retry the execute tool.',
    }
  }

  return {
    status: 'approved',
    approvalRequestId,
    toolName: result.record.toolName,
    quotedCreditCost: result.record.quotedCreditCost,
    message:
      'Approved in Advance. Immediately retry the original execute tool with the same arguments plus this approvalRequestId. Do not ask the user to open a link.',
    nextStep: 'retry_original_tool',
  }
}
