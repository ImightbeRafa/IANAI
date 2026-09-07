/** Gift → tour → done. Pure so first-open vs skip can be unit-tested. */

export type ChatShellOnboardingPhase = 'gift' | 'tour' | 'done'

export function resolveChatShellOnboardingPhase(result: {
  tourDone: boolean
  granted: boolean
  showWelcome: boolean
}): ChatShellOnboardingPhase {
  if (result.tourDone) return 'done'
  if (result.granted || result.showWelcome) return 'gift'
  return 'tour'
}

/** Open-gift / network failure must not skip the wizard for first open. */
export function onboardingPhaseAfterOpenFailure(): 'tour' {
  return 'tour'
}
