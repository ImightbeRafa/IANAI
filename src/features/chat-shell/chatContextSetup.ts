/**
 * Pure helpers for chat-shell Context setup interview (C2).
 * Session writes must go through pickSafeChatSessionUpdates only.
 */

import {
  pickSafeChatSessionUpdates,
  type ChatSessionSafeUpdateKey,
} from './sessionOffer'

export type SetupChannel = 'messages' | 'website' | 'physical'
export type SetupAwareness = 'cold' | 'warm' | 'hot'

export type SetupInterviewPhase = 'hidden' | 'visible' | 'skipped' | 'completed'

export interface SessionSetupLike {
  id?: string
  title?: string | null
  context?: string | null
  primary_channel?: string | null
  awareness_level?: string | null
}

export interface SessionSetupDraft {
  title: string
  context: string
  primary_channel: SetupChannel | ''
  awareness_level: SetupAwareness | ''
}

export const SETUP_CHANNELS: SetupChannel[] = ['messages', 'website', 'physical']
export const SETUP_AWARENESS: SetupAwareness[] = ['cold', 'warm', 'hot']

export function isSetupChannel(value: unknown): value is SetupChannel {
  return value === 'messages' || value === 'website' || value === 'physical'
}

export function isSetupAwareness(value: unknown): value is SetupAwareness {
  return value === 'cold' || value === 'warm' || value === 'hot'
}

/** Completed = nonempty context + valid primary channel. */
export function isSessionSetupComplete(session: SessionSetupLike | null | undefined): boolean {
  if (!session) return false
  const context = (session.context || '').trim()
  return Boolean(context) && isSetupChannel(session.primary_channel)
}

export function shouldShowSetupInterview(options: {
  session: SessionSetupLike | null | undefined
  skippedSessionIds: ReadonlySet<string>
  forceOpen?: boolean
}): boolean {
  const { session, skippedSessionIds, forceOpen = false } = options
  if (!session?.id) return false
  if (forceOpen) return true
  if (isSessionSetupComplete(session)) return false
  if (skippedSessionIds.has(session.id)) return false
  return true
}

export function resolveSetupInterviewPhase(options: {
  session: SessionSetupLike | null | undefined
  skippedSessionIds: ReadonlySet<string>
  forceOpen?: boolean
}): SetupInterviewPhase {
  const { session, skippedSessionIds, forceOpen = false } = options
  if (!session?.id) return 'hidden'
  if (isSessionSetupComplete(session) && !forceOpen) return 'completed'
  if (!forceOpen && skippedSessionIds.has(session.id)) return 'skipped'
  if (shouldShowSetupInterview(options)) return 'visible'
  return 'hidden'
}

export function setupSkippedStorageKey(sessionId: string): string {
  return `ianai.chat-shell.contextSetup.skipped.${sessionId}`
}

/** Persist Skip per session so reload keeps interview skipped until Setup reopen. */
export function readSetupSkipped(
  storage: { getItem(key: string): string | null } | null | undefined,
  sessionId: string | null | undefined
): boolean {
  if (!storage || !sessionId) return false
  try {
    const raw = storage.getItem(setupSkippedStorageKey(sessionId))
    return raw === '1' || raw === 'true'
  } catch {
    return false
  }
}

export type WriteSetupSkippedResult =
  | { ok: true; key: string; skipped: boolean }
  | { ok: false; key: string | null; skipped: boolean; reason: string }

/** Why Skip LS was cleared — only Save / Setup reopen may clear. */
export type ClearSetupSkippedReason = 'save' | 'reopen'

export interface WriteSetupSkippedOptions {
  /** Required when skipped=false so clears are attributable (instrumentation). */
  clearReason?: ClearSetupSkippedReason
}

function shouldLogSetupSkippedClear(): boolean {
  try {
    if (import.meta.env.VITE_CHAT_SHELL_SKIP_DEBUG === 'true') return true
    if (import.meta.env.VITE_CHAT_SHELL_SKIP_DEBUG === 'false') return false
    // Preview hosts: always log clears so CoS can attribute Setup/Save/multi-tab.
    if (typeof location !== 'undefined' && /\.vercel\.app$/i.test(location.hostname)) {
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

function logSetupSkippedClear(sessionId: string, clearReason: ClearSetupSkippedReason | undefined): void {
  if (!shouldLogSetupSkippedClear()) return
  try {
    const stack = (new Error('clearSetupSkipped').stack || '')
      .split('\n')
      .slice(0, 10)
      .join('\n')
    console.info('[chat-shell] clearSetupSkipped', {
      sessionId,
      clearReason: clearReason ?? 'unspecified',
      stack,
    })
  } catch {
    /* ignore */
  }
}

/**
 * Persist or clear Skip for one session id.
 * Verifies read-back so silent setItem failures cannot look like success.
 * Callers must only invoke from explicit Skip / Save / Setup reopen.
 * Remount/hydrate/Escape must never call with skipped=false.
 */
export function writeSetupSkipped(
  storage: {
    getItem?(key: string): string | null
    setItem?(key: string, value: string): void
    removeItem?(key: string): void
  } | null | undefined,
  sessionId: string | null | undefined,
  skipped: boolean,
  options?: WriteSetupSkippedOptions
): WriteSetupSkippedResult {
  if (!sessionId) {
    return { ok: false, key: null, skipped, reason: 'missing_session_id' }
  }
  const key = setupSkippedStorageKey(sessionId)
  if (!storage) {
    return { ok: false, key, skipped, reason: 'missing_storage' }
  }
  try {
    if (skipped) {
      if (typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') {
        return { ok: false, key, skipped, reason: 'storage_methods_unavailable' }
      }
      storage.setItem(key, '1')
      const raw = storage.getItem(key)
      if (raw !== '1' && raw !== 'true') {
        return { ok: false, key, skipped, reason: 'write_verify_failed' }
      }
    } else {
      if (typeof storage.removeItem !== 'function') {
        return { ok: false, key, skipped, reason: 'storage_methods_unavailable' }
      }
      // Preview-safe attribution: only Save / reopen should reach here.
      logSetupSkippedClear(sessionId, options?.clearReason)
      storage.removeItem(key)
      if (typeof storage.getItem === 'function') {
        const raw = storage.getItem(key)
        if (raw != null) {
          return { ok: false, key, skipped, reason: 'clear_verify_failed' }
        }
      }
    }
    return { ok: true, key, skipped }
  } catch {
    return { ok: false, key, skipped, reason: 'storage_threw' }
  }
}

/**
 * Source-of-truth skip decision for the current session.
 * Only Save / explicit Setup reopen should clear LS (write false).
 * Remount/hydrate must never invent a clear.
 */
export function isSessionSetupSkipped(
  storage: { getItem(key: string): string | null } | null | undefined,
  sessionId: string | null | undefined
): boolean {
  return readSetupSkipped(storage, sessionId)
}

/** Normalize untrusted autofill JSON into an editable draft (invalid enums dropped). */
export function normalizeSessionContextAutofill(
  raw: Record<string, unknown> | null | undefined
): Partial<SessionSetupDraft> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<SessionSetupDraft> = {}

  if (typeof raw.title === 'string' && raw.title.trim()) {
    out.title = raw.title.trim().slice(0, 120)
  }
  if (typeof raw.context === 'string' && raw.context.trim()) {
    out.context = raw.context.trim().slice(0, 8000)
  } else if (typeof raw.summary === 'string' && raw.summary.trim()) {
    out.context = raw.summary.trim().slice(0, 8000)
  }

  const channel = raw.primary_channel ?? raw.channel
  if (isSetupChannel(channel)) out.primary_channel = channel

  const awareness = raw.awareness_level ?? raw.awareness
  if (isSetupAwareness(awareness)) out.awareness_level = awareness

  return out
}

export type SessionSetupSaveResult =
  | {
      ok: true
      updates: Partial<Record<ChatSessionSafeUpdateKey, unknown>>
    }
  | {
      ok: false
      error: string
    }

/**
 * Build safe session updates for Save & continue.
 * Requires context + primary_channel; title/awareness optional.
 * Ownership / unknown keys are stripped.
 */
export function buildSessionSetupUpdates(draft: SessionSetupDraft): SessionSetupSaveResult {
  const context = draft.context.trim()
  if (!context) {
    return { ok: false, error: 'Context is required to save setup.' }
  }
  if (!isSetupChannel(draft.primary_channel)) {
    return { ok: false, error: 'Choose a primary channel to continue.' }
  }

  const candidate: Record<string, unknown> = {
    context,
    primary_channel: draft.primary_channel,
  }
  const title = draft.title.trim()
  if (title) candidate.title = title
  if (isSetupAwareness(draft.awareness_level)) {
    candidate.awareness_level = draft.awareness_level
  }

  // Prove ownership cannot sneak in even if draft is polluted.
  candidate.user_id = 'stolen'
  candidate.business_id = 'stolen'
  candidate.product_id = 'stolen'

  const updates = pickSafeChatSessionUpdates(candidate)
  return { ok: true, updates }
}

export type GenerateHardBlock =
  | 'no_session'
  | 'empty_message'
  | 'sending'
  | 'no_offer'

export interface GenerateReadiness {
  hardBlock: GenerateHardBlock | null
  softWarnEmptyContext: boolean
}

/** Hard-block only for session/text/busy/offers. Empty context = soft warn only. */
export function classifyGenerateReadiness(options: {
  hasSession: boolean
  hasText: boolean
  sending: boolean
  offerCount: number
  hasContext: boolean
}): GenerateReadiness {
  if (!options.hasSession) return { hardBlock: 'no_session', softWarnEmptyContext: false }
  if (options.sending) return { hardBlock: 'sending', softWarnEmptyContext: false }
  if (!options.hasText) return { hardBlock: 'empty_message', softWarnEmptyContext: false }
  if (options.offerCount < 1) {
    return { hardBlock: 'no_offer', softWarnEmptyContext: !options.hasContext }
  }
  return {
    hardBlock: null,
    softWarnEmptyContext: !options.hasContext,
  }
}

export function draftFromSession(session: SessionSetupLike | null | undefined): SessionSetupDraft {
  return {
    title: session?.title || '',
    context: session?.context || '',
    primary_channel: isSetupChannel(session?.primary_channel) ? session!.primary_channel : '',
    awareness_level: isSetupAwareness(session?.awareness_level) ? session!.awareness_level : '',
  }
}
