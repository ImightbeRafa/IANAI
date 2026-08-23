/**
 * MCP EXECUTE approval tokens — 1 hour TTL, single-use, argument-bound.
 * Storage is injectable (DB later); pure crypto + policy live here.
 */

import { createHash, randomBytes } from 'node:crypto'

export const MCP_APPROVAL_TTL_MS = 60 * 60 * 1000 // 1 hour

export type McpApprovalStatus = 'pending' | 'consumed' | 'expired' | 'revoked'

export type McpApprovalRecord = {
  id: string
  tokenHash: string
  userId: string
  toolName: string
  inputHash: string
  quotedCreditCost: number | null
  status: McpApprovalStatus
  createdAtMs: number
  expiresAtMs: number
  consumedAtMs: number | null
}

export type McpApprovalStore = {
  insert: (row: McpApprovalRecord) => Promise<void>
  findByHash: (tokenHash: string) => Promise<McpApprovalRecord | null>
  markConsumed: (id: string, consumedAtMs: number) => Promise<McpApprovalRecord | null>
}

export function hashMcpApprovalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function hashMcpToolInput(input: unknown): string {
  const canonical = JSON.stringify(canonicalize(input))
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = canonicalize(obj[key])
  return out
}

export function createMcpApprovalToken(options: {
  userId: string
  toolName: string
  input: unknown
  quotedCreditCost?: number | null
  nowMs?: number
  ttlMs?: number
}): { token: string; record: McpApprovalRecord } {
  if (!options.userId) throw new Error('userId is required')
  if (!options.toolName) throw new Error('toolName is required')
  const nowMs = options.nowMs ?? Date.now()
  const ttlMs = options.ttlMs ?? MCP_APPROVAL_TTL_MS
  const token = randomBytes(32).toString('base64url')
  const record: McpApprovalRecord = {
    id: randomBytes(16).toString('hex'),
    tokenHash: hashMcpApprovalToken(token),
    userId: options.userId,
    toolName: options.toolName,
    inputHash: hashMcpToolInput(options.input),
    quotedCreditCost: options.quotedCreditCost ?? null,
    status: 'pending',
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    consumedAtMs: null,
  }
  return { token, record }
}

export async function issueMcpApproval(
  store: McpApprovalStore,
  options: Parameters<typeof createMcpApprovalToken>[0]
): Promise<{ token: string; expiresAtMs: number; approvalId: string }> {
  const { token, record } = createMcpApprovalToken(options)
  await store.insert(record)
  return { token, expiresAtMs: record.expiresAtMs, approvalId: record.id }
}

export async function consumeMcpApproval(
  store: McpApprovalStore,
  options: {
    token: string
    userId: string
    toolName: string
    input: unknown
    nowMs?: number
  }
): Promise<{ ok: true; record: McpApprovalRecord } | { ok: false; reason: string }> {
  const nowMs = options.nowMs ?? Date.now()
  const tokenHash = hashMcpApprovalToken(options.token)
  const row = await store.findByHash(tokenHash)
  if (!row) return { ok: false, reason: 'Approval not found' }
  if (row.userId !== options.userId) return { ok: false, reason: 'Approval user mismatch' }
  if (row.toolName !== options.toolName) return { ok: false, reason: 'Approval tool mismatch' }
  if (row.inputHash !== hashMcpToolInput(options.input)) {
    return { ok: false, reason: 'Approval input mismatch' }
  }
  if (row.status === 'consumed') return { ok: false, reason: 'Approval already used' }
  if (row.status === 'revoked') return { ok: false, reason: 'Approval revoked' }
  if (row.status !== 'pending' || nowMs > row.expiresAtMs) {
    return { ok: false, reason: 'Approval expired' }
  }
  const updated = await store.markConsumed(row.id, nowMs)
  if (!updated) return { ok: false, reason: 'Approval already used' }
  return { ok: true, record: updated }
}

/** In-memory store for unit tests / local smoke (not multi-instance safe). */
export function createMemoryMcpApprovalStore(): McpApprovalStore {
  const byId = new Map<string, McpApprovalRecord>()
  const byHash = new Map<string, string>()
  return {
    async insert(row) {
      byId.set(row.id, { ...row })
      byHash.set(row.tokenHash, row.id)
    },
    async findByHash(tokenHash) {
      const id = byHash.get(tokenHash)
      if (!id) return null
      const row = byId.get(id)
      return row ? { ...row } : null
    },
    async markConsumed(id, consumedAtMs) {
      const row = byId.get(id)
      if (!row || row.status !== 'pending') return null
      const next = { ...row, status: 'consumed' as const, consumedAtMs }
      byId.set(id, next)
      return { ...next }
    },
  }
}
