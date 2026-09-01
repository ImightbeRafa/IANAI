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
