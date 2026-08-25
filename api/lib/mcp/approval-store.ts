/**
 * Supabase service-role store for MCP approval requests.
 */

import { getSupabaseAdmin } from '../supabase-admin.js'
import type { McpApprovalRecord, McpApprovalStore, McpApprovalStatus } from './approval.js'

function rowToRecord(row: Record<string, unknown>): McpApprovalRecord {
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    userId: String(row.user_id),
    toolName: String(row.tool_name),
    inputHash: String(row.input_hash),
    inputJson: row.input_json ?? null,
    quotedCreditCost: row.quoted_credit_cost == null ? null : Number(row.quoted_credit_cost),
    status: row.status as McpApprovalStatus,
    createdAtMs: new Date(String(row.created_at)).getTime(),
    expiresAtMs: new Date(String(row.expires_at)).getTime(),
    consumedAtMs: row.consumed_at ? new Date(String(row.consumed_at)).getTime() : null,
    approvedAtMs: row.approved_at ? new Date(String(row.approved_at)).getTime() : null,
    deniedAtMs: row.denied_at ? new Date(String(row.denied_at)).getTime() : null,
    resultJson: row.result_json ?? null,
    resultStoredAtMs: row.result_stored_at ? new Date(String(row.result_stored_at)).getTime() : null,
  }
}

export function createMcpApprovalStore(): McpApprovalStore | null {
  const db = getSupabaseAdmin()
  if (!db) return null

  return {
    async insert(row) {
      const { error } = await db.from('mcp_approval_tokens').insert({
        id: row.id,
        token_hash: row.tokenHash,
        user_id: row.userId,
        tool_name: row.toolName,
        input_hash: row.inputHash,
        input_json: row.inputJson,
        quoted_credit_cost: row.quotedCreditCost,
        status: row.status,
        created_at: new Date(row.createdAtMs).toISOString(),
        expires_at: new Date(row.expiresAtMs).toISOString(),
      })
      if (error) throw error
    },
    async findById(id) {
      const { data, error } = await db
        .from('mcp_approval_tokens')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data ? rowToRecord(data as Record<string, unknown>) : null
    },
    async findByHash(tokenHash) {
      const { data, error } = await db
        .from('mcp_approval_tokens')
        .select('*')
        .eq('token_hash', tokenHash)
        .maybeSingle()
      if (error) throw error
      return data ? rowToRecord(data as Record<string, unknown>) : null
    },
    async markApproved(id, atMs) {
      const { data, error } = await db
        .from('mcp_approval_tokens')
        .update({
          status: 'approved',
          approved_at: new Date(atMs).toISOString(),
        })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data ? rowToRecord(data as Record<string, unknown>) : null
    },
    async markDenied(id, atMs) {
      const { data, error } = await db
        .from('mcp_approval_tokens')
        .update({
          status: 'denied',
          denied_at: new Date(atMs).toISOString(),
        })
        .eq('id', id)
        .in('status', ['pending', 'approved'])
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data ? rowToRecord(data as Record<string, unknown>) : null
    },
    async markConsumed(id, consumedAtMs) {
      const { data, error } = await db
        .from('mcp_approval_tokens')
        .update({
          status: 'consumed',
          consumed_at: new Date(consumedAtMs).toISOString(),
        })
        .eq('id', id)
        .in('status', ['pending', 'approved'])
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data ? rowToRecord(data as Record<string, unknown>) : null
    },
    async storeResult(id, result, atMs) {
      // Allow while approved (running marker / final before consume) or consumed (legacy).
      const { data, error } = await db
        .from('mcp_approval_tokens')
        .update({
          result_json: result,
          result_stored_at: new Date(atMs).toISOString(),
        })
        .eq('id', id)
        .in('status', ['approved', 'consumed'])
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data ? rowToRecord(data as Record<string, unknown>) : null
    },
    async claimEmptyResult(id, result, atMs) {
      const { data, error } = await db
        .from('mcp_approval_tokens')
        .update({
          result_json: result,
          result_stored_at: new Date(atMs).toISOString(),
        })
        .eq('id', id)
        .eq('status', 'approved')
        .is('result_json', null)
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data ? rowToRecord(data as Record<string, unknown>) : null
    },
  }
}
