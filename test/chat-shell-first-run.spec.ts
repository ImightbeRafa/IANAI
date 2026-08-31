import { describe, expect, it } from 'vitest'
import { shouldShowFirstRunCta } from '../src/features/chat-shell/chatShellFirstRun'

describe('shouldShowFirstRunCta', () => {
  it('shows Empezá por tu marca when the session kit is not ready and the thread is empty', () => {
    expect(shouldShowFirstRunCta({
      hasSession: true,
      kitReady: false,
      hasUserOrArtifactMessages: false,
      showInitialLoader: false,
    })).toBe(true)
  })

  it('hides the CTA when the kit is already listo (existing QA/real brands)', () => {
    expect(shouldShowFirstRunCta({
      hasSession: true,
      kitReady: true,
      hasUserOrArtifactMessages: false,
      showInitialLoader: false,
    })).toBe(false)
  })

  it('hides the CTA once the user has messages or artifacts', () => {
    expect(shouldShowFirstRunCta({
      hasSession: true,
      kitReady: false,
      hasUserOrArtifactMessages: true,
      showInitialLoader: false,
    })).toBe(false)
  })
})
