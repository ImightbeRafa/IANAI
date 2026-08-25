/**
 * MCP EXECUTE approval — in-chat consent (primary) then single-use consume.
 *
 * Flow:
 * 1) execute_* without approvalRequestId → create pending request, return grok_chat prompt
 * 2) User says yes in Grok → confirm_execute(approve) → status=approved
 *    (optional fallback: /mcp/approve/:id web page)
 * 3) Grok retries with same args + approvalRequestId → validate (do not consume)
 * 4) check limit → generate → save → charge → store result → consume
 *    If generate fails, approval stays approved and reusable.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const MCP_APPROVAL_TTL_MS = 60 * 60 * 1000 // 1 hour

export type McpApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'consumed'
  | 'expired'
  | 'revoked'

export type McpApprovalRecord = {
  id: string
  tokenHash: string
  userId: string
  toolName: string
  inputHash: string
  inputJson: unknown
  quotedCreditCost: number | null
  status: McpApprovalStatus
  createdAtMs: number
  expiresAtMs: number
  consumedAtMs: number | null
  approvedAtMs: number | null
  deniedAtMs: number | null
  resultJson: unknown | null
  resultStoredAtMs: number | null
}

export type McpApprovalStore = {
  insert: (row: McpApprovalRecord) => Promise<void>
  findById: (id: string) => Promise<McpApprovalRecord | null>
  findByHash: (tokenHash: string) => Promise<McpApprovalRecord | null>
  markApproved: (id: string, atMs: number) => Promise<McpApprovalRecord | null>
  markDenied: (id: string, atMs: number) => Promise<McpApprovalRecord | null>
  markConsumed: (id: string, consumedAtMs: number) => Promise<McpApprovalRecord | null>
  storeResult: (id: string, result: unknown, atMs: number) => Promise<McpApprovalRecord | null>
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
  for (const key of keys) {
    // approvalRequestId is the continuation handle — exclude from binding hash
    if (key === 'approvalRequestId') continue
    out[key] = canonicalize(obj[key])
  }
  return out
}

export function createMcpApprovalRequest(options: {
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
    id: randomUUID(),
    tokenHash: hashMcpApprovalToken(token),
    userId: options.userId,
    toolName: options.toolName,
    inputHash: hashMcpToolInput(options.input),
    inputJson: canonicalize(options.input),
    quotedCreditCost: options.quotedCreditCost ?? null,
    status: 'pending',
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    consumedAtMs: null,
    approvedAtMs: null,
    deniedAtMs: null,
    resultJson: null,
    resultStoredAtMs: null,
  }
  return { token, record }
}

export async function issueMcpApprovalRequest(
  store: McpApprovalStore,
  options: Parameters<typeof createMcpApprovalRequest>[0] & { appOrigin?: string }
): Promise<{
  approvalRequestId: string
  expiresAtMs: number
  deepLink: string
  status: 'approval_required'
}> {
  const { record } = createMcpApprovalRequest(options)
  await store.insert(record)
  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return {
    approvalRequestId: record.id,
    expiresAtMs: record.expiresAtMs,
    deepLink: `${origin}/mcp/approve/${encodeURIComponent(record.id)}`,
    status: 'approval_required',
  }
}

/** @deprecated Prefer issueMcpApprovalRequest — kept for existing unit tests. */
export async function issueMcpApproval(
  store: McpApprovalStore,
  options: Parameters<typeof createMcpApprovalRequest>[0]
): Promise<{ token: string; expiresAtMs: number; approvalId: string }> {
  const { token, record } = createMcpApprovalRequest(options)
  await store.insert(record)
  return { token, expiresAtMs: record.expiresAtMs, approvalId: record.id }
}

export async function approveMcpApprovalRequest(
  store: McpApprovalStore,
  options: { approvalRequestId: string; userId: string; nowMs?: number }
): Promise<{ ok: true; record: McpApprovalRecord } | { ok: false; reason: string }> {
  const nowMs = options.nowMs ?? Date.now()
  const row = await store.findById(options.approvalRequestId)
  if (!row) return { ok: false, reason: 'Approval not found' }
  if (row.userId !== options.userId) return { ok: false, reason: 'Approval user mismatch' }
  if (row.status === 'denied') return { ok: false, reason: 'Approval denied' }
  if (row.status === 'consumed') return { ok: false, reason: 'Approval already used' }
  if (row.status === 'approved') return { ok: true, record: row }
  if (row.status !== 'pending' || nowMs > row.expiresAtMs) {
    return { ok: false, reason: 'Approval expired' }
  }
  const updated = await store.markApproved(row.id, nowMs)
  if (!updated) return { ok: false, reason: 'Approval could not be approved' }
  return { ok: true, record: updated }
}

export async function denyMcpApprovalRequest(
  store: McpApprovalStore,
  options: { approvalRequestId: string; userId: string; nowMs?: number }
): Promise<{ ok: true; record: McpApprovalRecord } | { ok: false; reason: string }> {
  const nowMs = options.nowMs ?? Date.now()
  const row = await store.findById(options.approvalRequestId)
  if (!row) return { ok: false, reason: 'Approval not found' }
  if (row.userId !== options.userId) return { ok: false, reason: 'Approval user mismatch' }
  if (row.status === 'consumed') return { ok: false, reason: 'Approval already used' }
  if (row.status === 'denied') return { ok: true, record: row }
  if (row.status !== 'pending' && row.status !== 'approved') {
    return { ok: false, reason: 'Approval not deniable' }
  }
  if (nowMs > row.expiresAtMs) return { ok: false, reason: 'Approval expired' }
  const updated = await store.markDenied(row.id, nowMs)
  if (!updated) return { ok: false, reason: 'Approval could not be denied' }
  return { ok: true, record: updated }
}

/**
 * Validate an approved request without consuming it.
 * EXECUTE uses this before generate so a failed run stays retryable.
 */
export async function assertMcpApprovalReady(
  store: McpApprovalStore,
  options: {
    approvalRequestId: string
    userId: string
    toolName: string
    input: unknown
    nowMs?: number
  }
): Promise<{ ok: true; record: McpApprovalRecord } | { ok: false; reason: string }> {
  const nowMs = options.nowMs ?? Date.now()
  const row = await store.findById(options.approvalRequestId)
  if (!row) return { ok: false, reason: 'Approval not found' }
  if (row.userId !== options.userId) return { ok: false, reason: 'Approval user mismatch' }
  if (row.toolName !== options.toolName) return { ok: false, reason: 'Approval tool mismatch' }
  if (row.inputHash !== hashMcpToolInput(options.input)) {
    return { ok: false, reason: 'Approval input mismatch' }
  }
  if (row.status === 'consumed') return { ok: false, reason: 'Approval already used' }
  if (row.status === 'denied') return { ok: false, reason: 'Approval denied' }
  if (row.status === 'revoked') return { ok: false, reason: 'Approval revoked' }
  if (row.status !== 'approved') {
    return { ok: false, reason: 'Approval not approved yet — open the deep link first' }
  }
  if (nowMs > row.expiresAtMs) return { ok: false, reason: 'Approval expired' }
  return { ok: true, record: row }
}

/**
 * Consume an approved request by id (Grok continuation), binding tool+input.
 * Call only after generate + save + charge succeed.
 */
export async function consumeMcpApprovalRequest(
  store: McpApprovalStore,
  options: {
    approvalRequestId: string
    userId: string
    toolName: string
    input: unknown
    nowMs?: number
  }
): Promise<{ ok: true; record: McpApprovalRecord } | { ok: false; reason: string }> {
  const nowMs = options.nowMs ?? Date.now()
  const ready = await assertMcpApprovalReady(store, { ...options, nowMs })
  if (!ready.ok) return ready
  const updated = await store.markConsumed(ready.record.id, nowMs)
  if (!updated) return { ok: false, reason: 'Approval already used' }
  return { ok: true, record: updated }
}

/**
 * After EXECUTE succeeds, store a compact result for lost-response replay.
 */
export async function storeMcpApprovalResult(
  store: McpApprovalStore,
  options: { approvalRequestId: string; result: unknown; nowMs?: number }
): Promise<void> {
  await store.storeResult(options.approvalRequestId, options.result, options.nowMs ?? Date.now())
}

/**
 * If approval was already consumed but result was stored, return it (idempotent retry).
 */
export async function replayMcpApprovalResult(
  store: McpApprovalStore,
  options: {
    approvalRequestId: string
    userId: string
    toolName: string
    input: unknown
  }
): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> {
  const row = await store.findById(options.approvalRequestId)
  if (!row) return { ok: false, reason: 'Approval not found' }
  if (row.userId !== options.userId) return { ok: false, reason: 'Approval user mismatch' }
  if (row.toolName !== options.toolName) return { ok: false, reason: 'Approval tool mismatch' }
  if (row.inputHash !== hashMcpToolInput(options.input)) {
    return { ok: false, reason: 'Approval input mismatch' }
  }
  if (row.status !== 'consumed' || row.resultJson == null) {
    return { ok: false, reason: 'No stored result to replay' }
  }
  return { ok: true, result: row.resultJson }
}

/** Legacy token consume (tests). */
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
  if (row.status === 'revoked' || row.status === 'denied') {
    return { ok: false, reason: 'Approval revoked' }
  }
  // Legacy path: pending token was immediately consumable; also allow approved
  if ((row.status !== 'pending' && row.status !== 'approved') || nowMs > row.expiresAtMs) {
    return { ok: false, reason: 'Approval expired' }
  }
  const updated = await store.markConsumed(row.id, nowMs)
  if (!updated) return { ok: false, reason: 'Approval already used' }
  return { ok: true, record: updated }
}

export function createMemoryMcpApprovalStore(): McpApprovalStore {
  const byId = new Map<string, McpApprovalRecord>()
  const byHash = new Map<string, string>()
  return {
    async insert(row) {
      byId.set(row.id, { ...row })
      byHash.set(row.tokenHash, row.id)
    },
    async findById(id) {
      const row = byId.get(id)
      return row ? { ...row } : null
    },
    async findByHash(tokenHash) {
      const id = byHash.get(tokenHash)
      if (!id) return null
      const row = byId.get(id)
      return row ? { ...row } : null
    },
    async markApproved(id, atMs) {
      const row = byId.get(id)
      if (!row || row.status !== 'pending') return null
      const next = { ...row, status: 'approved' as const, approvedAtMs: atMs }
      byId.set(id, next)
      return { ...next }
    },
    async markDenied(id, atMs) {
      const row = byId.get(id)
      if (!row || (row.status !== 'pending' && row.status !== 'approved')) return null
      const next = { ...row, status: 'denied' as const, deniedAtMs: atMs }
      byId.set(id, next)
      return { ...next }
    },
    async markConsumed(id, consumedAtMs) {
      const row = byId.get(id)
      if (!row || (row.status !== 'pending' && row.status !== 'approved')) return null
      const next = { ...row, status: 'consumed' as const, consumedAtMs }
      byId.set(id, next)
      return { ...next }
    },
    async storeResult(id, result, atMs) {
      const row = byId.get(id)
      if (!row) return null
      const next = { ...row, resultJson: result, resultStoredAtMs: atMs }
      byId.set(id, next)
      return { ...next }
    },
  }
}
