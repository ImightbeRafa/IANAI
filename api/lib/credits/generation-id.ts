/**
 * Credit ledger `generation_id` is UUID-typed. Bulk/carousel used to pass
 * `${approvalId}-script-1` strings → consume_credits RPC fails as UNAVAILABLE.
 * Derive stable RFC-style UUIDs from (seed, key) so retries stay idempotent.
 */

import { createHash } from 'node:crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** Deterministic UUID (SHA-1 / UUID-v5 style) from seed + phase key. */
export function deterministicGenerationUuid(seed: string, key: string): string {
  const hash = createHash('sha1').update(`advance-ai:${seed}:${key}`, 'utf8').digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** Prefer a real UUID seed; otherwise hash the whole seed into one. */
export function generationUuidFromApproval(approvalRequestId: string, key: string): string {
  const seed = isUuid(approvalRequestId)
    ? approvalRequestId
    : deterministicGenerationUuid('pack', approvalRequestId)
  return deterministicGenerationUuid(seed, key)
}
