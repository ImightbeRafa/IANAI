/**
 * Central MCP tools/call audit — every call logged as source=mcp.
 */

import { logApiUsage, type FeatureType } from '../usage-logger.js'
import type { McpToolRisk } from './tool-registry.js'

export type McpAuditLane =
  | 'guide'
  | 'execute'
  | 'read'
  | 'sync_write'
  | 'delete'
  | 'admin'
  | 'unknown'

export function laneFromRisk(risk: McpToolRisk | undefined): McpAuditLane {
  if (!risk) return 'unknown'
  switch (risk) {
    case 'guide':
      return 'guide'
    case 'execute':
      return 'execute'
    case 'read':
      return 'read'
    case 'sync_write':
      return 'sync_write'
    case 'delete':
      return 'delete'
    case 'admin':
      return 'admin'
    default: {
      const _exhaustive: never = risk
      void _exhaustive
      return 'unknown'
    }
  }
}

function summarizeResult(payload: unknown): {
  status: string | null
  quotedCreditCost: number | null
  chargedCredits: number | null
  approvalRequestId: string | null
} {
  if (!payload || typeof payload !== 'object') {
    return { status: null, quotedCreditCost: null, chargedCredits: null, approvalRequestId: null }
  }
  const row = payload as Record<string, unknown>
  const status = typeof row.status === 'string' ? row.status : null
  const quoted = typeof row.quotedCreditCost === 'number' ? row.quotedCreditCost : null
  const charged =
    typeof row.chargedCredits === 'number'
      ? row.chargedCredits
      : typeof row.creditsCharged === 'number'
        ? row.creditsCharged
        : null
  const approvalRequestId = typeof row.approvalRequestId === 'string' ? row.approvalRequestId : null
  return { status, quotedCreditCost: quoted, chargedCredits: charged, approvalRequestId }
}

export async function auditMcpToolCall(options: {
  userId: string
  userEmail?: string | null
  toolName: string
  risk?: McpToolRisk
  durationMs: number
  success: boolean
  errorMessage?: string
  resultPayload?: unknown
}): Promise<void> {
  const summary = summarizeResult(options.resultPayload)
  const lane = laneFromRisk(options.risk)
  const meta: Record<string, unknown> = {
    source: 'mcp',
    tool: options.toolName,
    lane,
    durationMs: options.durationMs,
    status: summary.status,
    quotedCreditCost: summary.quotedCreditCost,
    chargedCredits: summary.chargedCredits,
    approvalRequestId: summary.approvalRequestId,
    approvalRequired: summary.status === 'approval_required',
  }

  await logApiUsage({
    userId: options.userId,
    userEmail: options.userEmail || undefined,
    feature: 'mcp_tool' as FeatureType,
    model: 'mcp',
    inputTokens: 0,
    outputTokens: 0,
    success: options.success,
    errorMessage: options.errorMessage,
    costOverrideUsd: 0,
    source: 'mcp',
    metadata: meta,
  })
}
