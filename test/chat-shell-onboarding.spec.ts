import { describe, expect, it } from 'vitest'
import {
  onboardingPhaseAfterOpenFailure,
  resolveChatShellOnboardingPhase,
} from '../src/features/chat-shell/chatShellOnboarding'
import { kitHardBlocked, resolveGlassVerbBlock, shouldShowFirstRunCta } from '../src/features/chat-shell/chatShellFirstRun'

describe('resolveChatShellOnboardingPhase', () => {
  it('skips chrome when the user already finished or skipped the tour', () => {
    expect(resolveChatShellOnboardingPhase({
      tourDone: true,
      granted: true,
      showWelcome: true,
    })).toBe('done')
  })

  it('shows the gift before the tour when credits were granted or welcome is pending', () => {
    expect(resolveChatShellOnboardingPhase({
      tourDone: false,
      granted: true,
      showWelcome: false,
    })).toBe('gift')
    expect(resolveChatShellOnboardingPhase({
      tourDone: false,
      granted: false,
      showWelcome: true,
    })).toBe('gift')
  })

  it('opens the tour on first /chat when Preview skips the gift (no insert, no fabricated tourDone)', () => {
    expect(resolveChatShellOnboardingPhase({
      tourDone: false,
      granted: false,
      showWelcome: false,
    })).toBe('tour')
  })

  it('keeps the wizard mounted when chat-shell-open fails (never skip to done)', () => {
    expect(onboardingPhaseAfterOpenFailure()).toBe('tour')
  })
})

describe('kitHardBlocked', () => {
  it('blocks generate only when the kit is incomplete and there is no offer', () => {
    expect(kitHardBlocked({ kitReady: false, hasOfferName: false })).toBe(true)
    expect(kitHardBlocked({ kitReady: false })).toBe(true)
  })

  it('unlocks glass when the folder already has an offer (soft Falta afinar)', () => {
    expect(kitHardBlocked({ kitReady: false, hasOfferName: true })).toBe(false)
  })

  it('unlocks glass when the kit is listo', () => {
    expect(kitHardBlocked({ kitReady: true, hasOfferName: false })).toBe(false)
  })
})

describe('resolveGlassVerbBlock', () => {
  it('blocks empty / no-oferta sessions even when setup facts have an offer name', () => {
    const row = resolveGlassVerbBlock({
      kitReady: false,
      hasOfferName: true,
      hasSessionOffer: false,
    })
    expect(row.blocked).toBe(true)
    expect(row.reason).toBe('offer')
  })

  it('uses Primero el kit when there is no kit and no offer at all', () => {
    const row = resolveGlassVerbBlock({
      kitReady: false,
      hasOfferName: false,
      hasSessionOffer: false,
    })
    expect(row.blocked).toBe(true)
    expect(row.reason).toBe('kit')
  })

  it('keeps glass unlocked for soft kit when this session has an offer', () => {
    const row = resolveGlassVerbBlock({
      kitReady: false,
      hasOfferName: true,
      hasSessionOffer: true,
    })
    expect(row.blocked).toBe(false)
    expect(row.reason).toBe(null)
  })

  it('blocks a listo kit on a session with no offer', () => {
    const row = resolveGlassVerbBlock({
      kitReady: true,
      hasOfferName: true,
      hasSessionOffer: false,
    })
    expect(row.blocked).toBe(true)
    expect(row.reason).toBe('offer')
  })
})

describe('shouldShowFirstRunCta still hides for existing offers', () => {
  it('keeps Empezá por tu marca for empty invited folders', () => {
    expect(shouldShowFirstRunCta({
      hasSession: true,
      kitReady: false,
      hasOfferName: false,
      hasUserOrArtifactMessages: false,
      showInitialLoader: false,
    })).toBe(true)
  })
})
