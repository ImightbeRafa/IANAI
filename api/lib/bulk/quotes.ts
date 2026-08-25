import {
  CREDIT_WEIGHTS,
  resolveImageCreditAction,
} from '../credits/catalog.js'
import type { BulkQuote, BulkQuoteLine } from './types.js'

export const SCRIPT_CREDITS_EACH = CREDIT_WEIGHTS.guion_oferta

export function imageCreditsEach(imageModel?: string | null): number {
  const action = resolveImageCreditAction({
    action: 'generate',
    model: imageModel || 'grok-imagine',
  })
  return CREDIT_WEIGHTS[action]
}

function line(
  action: BulkQuoteLine['action'],
  units: number,
  creditsEach: number
): BulkQuoteLine {
  const safeUnits = Math.max(0, Math.floor(units))
  return {
    action,
    units: safeUnits,
    creditsEach,
    credits: creditsEach * safeUnits,
  }
}

export function quoteBulkScripts(count: number): BulkQuote {
  const lines = [line('script', count, SCRIPT_CREDITS_EACH)]
  return {
    creditUnit: 'credits',
    lines,
    totalCredits: lines.reduce((sum, item) => sum + item.credits, 0),
    note: 'Charged only for succeeded scripts (3 each). Quote is the maximum.',
  }
}

export function quoteBulkPosts(options: {
  count: number
  imageModel?: string | null
  expandCount?: number
}): BulkQuote {
  const each = imageCreditsEach(options.imageModel)
  const lines = [
    line('image', options.count, each),
    line('expand_ref', options.expandCount ?? 0, each),
  ].filter((item) => item.units > 0)
  return {
    creditUnit: 'credits',
    lines,
    totalCredits: lines.reduce((sum, item) => sum + item.credits, 0),
    note: `Charged only for succeeded images (${each} each by model). Quote is the maximum.`,
  }
}

export function quoteCampaignPack(options: {
  scriptCount: number
  imageCount: number
  imageModel?: string | null
  expandCount?: number
}): BulkQuote {
  const scriptQuote = quoteBulkScripts(options.scriptCount)
  const postQuote = quoteBulkPosts({
    count: options.imageCount,
    imageModel: options.imageModel,
    expandCount: options.expandCount,
  })
  const lines = [...scriptQuote.lines, ...postQuote.lines]
  return {
    creditUnit: 'credits',
    lines,
    totalCredits: lines.reduce((sum, item) => sum + item.credits, 0),
    note: 'One approval for angles → scripts → posts. Charge per succeeded item only.',
  }
}
