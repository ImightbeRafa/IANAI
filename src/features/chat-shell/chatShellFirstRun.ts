/** Empty-thread CTA: kit not ready, no user/artifact messages yet. */
export function shouldShowFirstRunCta(input: {
  hasSession: boolean
  kitReady: boolean
  hasUserOrArtifactMessages: boolean
  showInitialLoader: boolean
}): boolean {
  return (
    input.hasSession
    && !input.kitReady
    && !input.hasUserOrArtifactMessages
    && !input.showInitialLoader
  )
}
