import type { CTAStrength, SalesChannel } from './types.js'

export type CtaMixCounts = {
  website: number
  messages: number
  none: number
}

export type CtaMixSlot = {
  channel?: SalesChannel
  strength: CTAStrength
}

function nonNegativeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

export function expandCtaMixSlots(
  mix: CtaMixCounts | undefined,
  count: number,
  fallback: CtaMixSlot
): CtaMixSlot[] {
  const n = Math.max(0, Math.floor(count) || 0)
  if (n === 0) return []
  const website = nonNegativeInt(mix?.website)
  const messages = nonNegativeInt(mix?.messages)
  const none = nonNegativeInt(mix?.none)
  if (!mix || website + messages + none !== n) {
    return Array.from({ length: n }, () => ({ ...fallback }))
  }
  const salesStrength: CTAStrength = fallback.strength === 'none' ? 'sales' : fallback.strength
  const slots: CtaMixSlot[] = []
  for (let i = 0; i < website; i += 1) slots.push({ channel: 'website', strength: salesStrength })
  for (let i = 0; i < messages; i += 1) slots.push({ channel: 'messages', strength: salesStrength })
  for (let i = 0; i < none; i += 1) slots.push({ channel: undefined, strength: 'none' })
  return slots
}
