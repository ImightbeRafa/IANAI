/**
 * Credit check + consume (service role). Uses credit_lots / credit_ledger when present.
 * When CREDITS_V1 is off, callers should use legacy checkUsageLimit.
 */

import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '../supabase-admin.js'
import {
  quoteCredits,
  type CreditAction,
  isCreditsV1Enabled,
} from './catalog.js'
import { planFifoSpend, sumRemaining, type CreditLot, type CreditLotKind } from './fifo.js'

export type CreditCheckResult = {
  allowed: boolean
  remaining: number
  required: number
  action: CreditAction
}

export type CreditConsumeResult =
  | { ok: true; credits: number; remaining: number; alreadyCharged?: boolean }
  | { ok: false; code: 'INSUFFICIENT' | 'UNAVAILABLE'; remaining: number; required: number; error?: string }

function rowToLot(row: Record<string, unknown>): CreditLot {
  return {
    id: String(row.id),
    kind: row.kind as CreditLotKind,
    remaining: Number(row.remaining) || 0,
    expiresAtMs: row.expires_at ? new Date(String(row.expires_at)).getTime() : null,
    createdAtMs: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
  }
}

export async function getCreditRemaining(userId: string): Promise<number> {
  const db = getSupabaseAdmin()
  if (!db || !userId) return 0
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('credit_lots')
    .select('id, kind, remaining, expires_at, created_at')
    .eq('user_id', userId)
    .gt('remaining', 0)
  if (error) {
    console.error('getCreditRemaining', error)
    return 0
  }
  const lots = (data || []).map((r) => rowToLot(r as Record<string, unknown>))
  // Treat null expiry as open; filter expired in sumRemaining
  void now
  return sumRemaining(lots, Date.now())
}

export async function checkCredits(
  userId: string,
  action: CreditAction,
  units = 1
): Promise<CreditCheckResult> {
  const required = quoteCredits(action, units)
  if (required === 0) {
    const remaining = await getCreditRemaining(userId)
    return { allowed: true, remaining, required: 0, action }
  }
  const remaining = await getCreditRemaining(userId)
  return {
    allowed: remaining >= required,
    remaining,
    required,
    action,
  }
}

/**
 * Idempotent consume keyed by generationId.
 * Prefers RPC `consume_credits` when available; falls back to TS FIFO + ledger.
 */
export async function consumeCredits(options: {
  userId: string
  action: CreditAction
  generationId: string
  units?: number
}): Promise<CreditConsumeResult> {
  const db = getSupabaseAdmin()
  const units = options.units ?? 1
  const required = quoteCredits(options.action, units)

  if (!db) {
    return { ok: false, code: 'UNAVAILABLE', remaining: 0, required, error: 'Database not configured' }
  }
  if (required === 0) {
    return { ok: true, credits: 0, remaining: await getCreditRemaining(options.userId) }
  }

  // Prefer atomic RPC if migration applied
  const { data: rpcData, error: rpcError } = await db.rpc('consume_credits', {
    p_user_id: options.userId,
    p_action: options.action,
    p_generation_id: options.generationId,
    p_credits: required,
  })

  if (!rpcError && rpcData && typeof rpcData === 'object') {
    const row = rpcData as Record<string, unknown>
    if (row.ok === true) {
      return {
        ok: true,
        credits: Number(row.credits) || required,
        remaining: Number(row.remaining) || 0,
        alreadyCharged: row.already_charged === true,
      }
    }
    return {
      ok: false,
      code: 'INSUFFICIENT',
      remaining: Number(row.remaining) || 0,
      required,
    }
  }

  // Fallback TS path (migration pending or RPC missing)
  if (rpcError && !/could not find|does not exist|PGRST/i.test(rpcError.message || '')) {
    console.error('consume_credits RPC', rpcError)
  }

  const { data: existing } = await db
    .from('credit_ledger')
    .select('credits')
    .eq('generation_id', options.generationId)
    .maybeSingle()
  if (existing) {
    return {
      ok: true,
      credits: Number(existing.credits) || required,
      remaining: await getCreditRemaining(options.userId),
      alreadyCharged: true,
    }
  }

  const { data: lotRows, error: lotErr } = await db
    .from('credit_lots')
    .select('id, kind, remaining, expires_at, created_at')
    .eq('user_id', options.userId)
    .gt('remaining', 0)
  if (lotErr) {
    return { ok: false, code: 'UNAVAILABLE', remaining: 0, required, error: lotErr.message }
  }

  const lots = (lotRows || []).map((r) => rowToLot(r as Record<string, unknown>))
  const planned = planFifoSpend(lots, required, Date.now())
  if (!planned.ok) {
    return { ok: false, code: 'INSUFFICIENT', remaining: planned.remaining, required }
  }

  for (const delta of planned.deltas) {
    const lot = planned.nextLots.find((l) => l.id === delta.lotId)
    if (!lot) continue
    const { error } = await db
      .from('credit_lots')
      .update({ remaining: lot.remaining })
      .eq('id', delta.lotId)
      .eq('user_id', options.userId)
    if (error) {
      return { ok: false, code: 'UNAVAILABLE', remaining: 0, required, error: error.message }
    }
  }

  const { error: ledErr } = await db.from('credit_ledger').insert({
    generation_id: options.generationId,
    user_id: options.userId,
    action: options.action,
    units,
    credits: required,
    lot_deltas: planned.deltas,
  })
  if (ledErr) {
    // Unique violation = concurrent double consume → treat as already charged
    if (ledErr.code === '23505') {
      return {
        ok: true,
        credits: required,
        remaining: await getCreditRemaining(options.userId),
        alreadyCharged: true,
      }
    }
    return { ok: false, code: 'UNAVAILABLE', remaining: 0, required, error: ledErr.message }
  }

  return {
    ok: true,
    credits: required,
    remaining: sumRemaining(planned.nextLots, Date.now()),
  }
}

export async function ensureWelcomeCredits(userId: string): Promise<void> {
  if (!isCreditsV1Enabled()) return
  const db = getSupabaseAdmin()
  if (!db) return
  const { data: profile } = await db
    .from('profiles')
    .select('welcome_credits_granted_at')
    .eq('id', userId)
    .maybeSingle()
  if (profile?.welcome_credits_granted_at) return

  const { error } = await db.rpc('grant_welcome_credits', { p_user_id: userId })
  if (error && !/could not find|does not exist/i.test(error.message || '')) {
    // Fallback insert
    const now = new Date().toISOString()
    await db.from('credit_lots').insert({
      id: randomUUID(),
      user_id: userId,
      kind: 'welcome',
      granted: 150,
      remaining: 150,
      expires_at: null,
    })
    await db
      .from('profiles')
      .update({ welcome_credits_granted_at: now })
      .eq('id', userId)
      .is('welcome_credits_granted_at', null)
  }
}

export { isCreditsV1Enabled }
