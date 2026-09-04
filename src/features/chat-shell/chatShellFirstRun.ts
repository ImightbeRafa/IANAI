/** Empty-thread CTA: kit not ready, no offer yet, no user/artifact messages. */
export function shouldShowFirstRunCta(input: {
  hasSession: boolean
  kitReady: boolean
  /** Existing folder with a real offer is not first-run (classic users). */
  hasOfferName?: boolean
  hasUserOrArtifactMessages: boolean
  showInitialLoader: boolean
}): boolean {
  return (
    input.hasSession
    && !input.kitReady
    && !input.hasOfferName
    && !input.hasUserOrArtifactMessages
    && !input.showInitialLoader
  )
}

/** Hard-block generate only when there is no offer/kit to work from. */
export function kitHardBlocked(input: {
  kitReady: boolean
  hasOfferName?: boolean
}): boolean {
  return !input.kitReady && !Boolean(input.hasOfferName)
}

export type GlassVerbBlockReason = 'kit' | 'offer' | null

/**
 * Glass Guiones/Post/Foto/Pack must not look enabled on an empty / no-oferta
 * session. Soft kit (offer on this session, kit incomplete) stays unlocked.
 */
export function resolveGlassVerbBlock(input: {
  kitReady: boolean
  hasOfferName?: boolean
  hasSessionOffer: boolean
}): { blocked: boolean; reason: GlassVerbBlockReason } {
  if (input.hasSessionOffer) return { blocked: false, reason: null }
  if (!input.kitReady && !input.hasOfferName) return { blocked: true, reason: 'kit' }
  return { blocked: true, reason: 'offer' }
}

export function glassVerbBlockHint(
  reason: GlassVerbBlockReason,
  labels: { kit: string; offer: string }
): string | undefined {
  switch (reason) {
    case 'kit':
      return labels.kit
    case 'offer':
      return labels.offer
    case null:
      return undefined
    default: {
      const _never: never = reason
      return _never
    }
  }
}
