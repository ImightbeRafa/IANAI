export type ScriptCtaChannel = 'website' | 'messages' | 'none'

export type CtaMix = {
  website: number
  messages: number
  none: number
}

const CHANNELS: ScriptCtaChannel[] = ['website', 'messages', 'none']

export function emptyCtaMix(): CtaMix {
  return { website: 0, messages: 0, none: 0 }
}

export function mixTotal(mix: CtaMix): number {
  return mix.website + mix.messages + mix.none
}

export function isValidCtaMix(mix: CtaMix | undefined, total: number): boolean {
  if (!mix || total < 1) return false
  if (mixTotal(mix) !== total) return false
  return CHANNELS.every((channel) => mix[channel] >= 0)
}

export function defaultMixForChannel(channel: ScriptCtaChannel, total: number): CtaMix {
  const mix = emptyCtaMix()
  const n = Math.max(1, Math.floor(total) || 1)
  mix[channel] = n
  return mix
}

/** Display mix: stored mix, or all-N of a single picked channel. */
export function resolvedCtaMix(
  mix: CtaMix | undefined,
  channel: ScriptCtaChannel | undefined,
  total: number
): CtaMix {
  if (mix && mixTotal(mix) > 0) return mix
  if (channel) return defaultMixForChannel(channel, total)
  return emptyCtaMix()
}

export function primaryChannelFromMix(mix: CtaMix): ScriptCtaChannel | undefined {
  let best: ScriptCtaChannel | undefined
  let n = 0
  for (const channel of CHANNELS) {
    if (mix[channel] > n) {
      n = mix[channel]
      best = channel
    }
  }
  return best
}

function largestOther(mix: CtaMix, channel: ScriptCtaChannel): ScriptCtaChannel | undefined {
  let best: ScriptCtaChannel | undefined
  let n = 0
  for (const other of CHANNELS) {
    if (other === channel) continue
    if (mix[other] > n) {
      n = mix[other]
      best = other
    }
  }
  return best
}

/**
 * First pick = all N of that type. A second type steals 1 from the largest bucket.
 * Clicking an already-selected type is a no-op (use +/- to rebalance).
 */
export function toggleMixChannel(
  mix: CtaMix | undefined,
  channel: ScriptCtaChannel,
  total: number
): CtaMix {
  const n = Math.max(1, Math.floor(total) || 1)
  if (!mix || mixTotal(mix) === 0) return defaultMixForChannel(channel, n)
  if (mix[channel] > 0) return mix
  const next = { ...mix }
  const donor = largestOther(next, channel)
  if (!donor) return defaultMixForChannel(channel, n)
  next[donor] -= 1
  next[channel] += 1
  return next
}

export function adjustMixCount(
  mix: CtaMix,
  channel: ScriptCtaChannel,
  delta: 1 | -1,
  total: number
): CtaMix {
  const n = Math.max(1, Math.floor(total) || 1)
  const next = { ...mix }
  if (delta === 1) {
    if (next[channel] >= n) return mix
    const donor = largestOther(next, channel)
    if (!donor || next[donor] <= 0) return mix
    next[donor] -= 1
    next[channel] += 1
    return next
  }
  if (next[channel] <= 0) return mix
  const receiver = largestOther(next, channel)
  if (!receiver) return mix
  next[channel] -= 1
  next[receiver] += 1
  return next
}

export function selectedMixCount(mix: CtaMix): number {
  return CHANNELS.filter((channel) => mix[channel] > 0).length
}

export function channelOverrideFromMix(mix: CtaMix): 'website' | 'messages' | undefined {
  if (mix.website === 0 && mix.messages === 0) return undefined
  return mix.website >= mix.messages ? 'website' : 'messages'
}
