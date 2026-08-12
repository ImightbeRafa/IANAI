import { describe, expect, it } from 'vitest'
import {
  buildSessionSetupUpdates,
  classifyGenerateReadiness,
  isSessionSetupComplete,
  isSessionSetupSkipped,
  normalizeSessionContextAutofill,
  readSetupSkipped,
  resolveSetupInterviewPhase,
  setupSkippedStorageKey,
  shouldShowSetupInterview,
  writeSetupSkipped,
} from '../src/features/chat-shell/chatContextSetup'

function memoryStorage() {
  const store: Record<string, string> = {}
  return {
    store,
    storage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    },
  }
}

describe('session setup interview helpers', () => {
  it('marks complete only with context + valid channel', () => {
    expect(isSessionSetupComplete({ context: 'hi', primary_channel: 'messages' })).toBe(true)
    expect(isSessionSetupComplete({ context: 'hi', primary_channel: 'email' })).toBe(false)
    expect(isSessionSetupComplete({ context: '', primary_channel: 'website' })).toBe(false)
    expect(isSessionSetupComplete(null)).toBe(false)
  })

  it('shows interview for incomplete sessions unless skipped', () => {
    const session = { id: 's1', context: '', primary_channel: null }
    expect(
      shouldShowSetupInterview({ session, skippedSessionIds: new Set() })
    ).toBe(true)
    expect(
      shouldShowSetupInterview({
        session,
        skippedSessionIds: new Set(['s1']),
      })
    ).toBe(false)
    expect(
      shouldShowSetupInterview({
        session,
        skippedSessionIds: new Set(['s1']),
        forceOpen: true,
      })
    ).toBe(true)
  })

  it('resolves phases', () => {
    expect(
      resolveSetupInterviewPhase({
        session: { id: 's1', context: 'x', primary_channel: 'messages' },
        skippedSessionIds: new Set(),
      })
    ).toBe('completed')
    expect(
      resolveSetupInterviewPhase({
        session: { id: 's1', context: '', primary_channel: null },
        skippedSessionIds: new Set(['s1']),
      })
    ).toBe('skipped')
    expect(
      resolveSetupInterviewPhase({
        session: { id: 's1', context: '', primary_channel: null },
        skippedSessionIds: new Set(),
      })
    ).toBe('visible')
  })

  it('persists Skip per session id in localStorage', () => {
    const { store, storage } = memoryStorage()
    expect(setupSkippedStorageKey('s1')).toBe('ianai.chat-shell.contextSetup.skipped.s1')
    expect(readSetupSkipped(storage, 's1')).toBe(false)
    const written = writeSetupSkipped(storage, 's1', true)
    expect(written).toEqual({
      ok: true,
      key: 'ianai.chat-shell.contextSetup.skipped.s1',
      skipped: true,
    })
    expect(readSetupSkipped(storage, 's1')).toBe(true)
    expect(readSetupSkipped(storage, 's2')).toBe(false)
    const cleared = writeSetupSkipped(storage, 's1', false)
    expect(cleared.ok).toBe(true)
    expect(readSetupSkipped(storage, 's1')).toBe(false)
    expect(store['ianai.chat-shell.contextSetup.skipped.s1']).toBeUndefined()
  })

  it('Skip write verifies read-back and fails closed on broken storage', () => {
    const noopStorage = {
      getItem: () => null,
      setItem: () => {
        /* swallow — never persists */
      },
      removeItem: () => {},
    }
    const result = writeSetupSkipped(noopStorage, 's1', true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('write_verify_failed')

    expect(writeSetupSkipped(null, 's1', true)).toEqual({
      ok: false,
      key: setupSkippedStorageKey('s1'),
      skipped: true,
      reason: 'missing_storage',
    })
    expect(writeSetupSkipped(memoryStorage().storage, '', true).ok).toBe(false)
  })

  it('Skip for current id preserves older session keys', () => {
    const { store, storage } = memoryStorage()
    const currentId = 'f18b984d-active'
    const olderId = 'older-session'

    expect(writeSetupSkipped(storage, olderId, true).ok).toBe(true)
    expect(writeSetupSkipped(storage, currentId, true).ok).toBe(true)
    expect(store[setupSkippedStorageKey(olderId)]).toBe('1')
    expect(store[setupSkippedStorageKey(currentId)]).toBe('1')

    // Remount / hydrate must only READ — never clear current.
    expect(isSessionSetupSkipped(storage, currentId)).toBe(true)
    expect(isSessionSetupSkipped(storage, olderId)).toBe(true)
    expect(isSessionSetupSkipped(storage, 'not-skipped')).toBe(false)
    expect(store[setupSkippedStorageKey(currentId)]).toBe('1')
    expect(store[setupSkippedStorageKey(olderId)]).toBe('1')
  })

  it('Skip survives remount hydrate; hydrate must not clear LS', () => {
    const { store, storage } = memoryStorage()
    const currentId = 'f18b984d-active'
    const olderId = 'older-session'

    writeSetupSkipped(storage, olderId, true)
    writeSetupSkipped(storage, currentId, true)

    expect(isSessionSetupSkipped(storage, currentId)).toBe(true)
    expect(isSessionSetupSkipped(storage, olderId)).toBe(true)
    expect(store[setupSkippedStorageKey(currentId)]).toBe('1')

    expect(isSessionSetupSkipped(storage, 'not-skipped')).toBe(false)
    expect(store[setupSkippedStorageKey(currentId)]).toBe('1')
    expect(store[setupSkippedStorageKey(olderId)]).toBe('1')
  })

  it('only explicit clear removes Skip (Save / reopen Setup)', () => {
    const { store, storage } = memoryStorage()
    writeSetupSkipped(storage, 's1', true)
    expect(isSessionSetupSkipped(storage, 's1')).toBe(true)
    writeSetupSkipped(storage, 's1', false)
    expect(isSessionSetupSkipped(storage, 's1')).toBe(false)
    expect(store[setupSkippedStorageKey('s1')]).toBeUndefined()
    expect(shouldShowSetupInterview({
      session: { id: 's1', context: '', primary_channel: null },
      skippedSessionIds: new Set(
        isSessionSetupSkipped(storage, 's1') ? ['s1'] : []
      ),
    })).toBe(true)
  })

  it('clear verifies removal failed when removeItem is a no-op', () => {
    const sticky: Record<string, string> = {
      [setupSkippedStorageKey('s1')]: '1',
    }
    const storage = {
      getItem: (k: string) => sticky[k] ?? null,
      setItem: (k: string, v: string) => {
        sticky[k] = v
      },
      removeItem: () => {
        /* refuse to clear */
      },
    }
    const result = writeSetupSkipped(storage, 's1', false)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('clear_verify_failed')
  })

  it('read/write Setup Skip tolerate missing storage', () => {
    expect(readSetupSkipped(null, 's1')).toBe(false)
    expect(isSessionSetupSkipped(null, 's1')).toBe(false)
    expect(writeSetupSkipped(null, 's1', true).ok).toBe(false)
  })

  it('normalizes autofill and drops invalid enums', () => {
    expect(
      normalizeSessionContextAutofill({
        title: '  Brief  ',
        summary: 'From summary field',
        primary_channel: 'whatsapp',
        awareness_level: 'lukewarm',
        user_id: 'nope',
      })
    ).toEqual({
      title: 'Brief',
      context: 'From summary field',
    })

    expect(
      normalizeSessionContextAutofill({
        context: 'OK',
        primary_channel: 'website',
        awareness: 'hot',
      })
    ).toEqual({
      context: 'OK',
      primary_channel: 'website',
      awareness_level: 'hot',
    })
  })

  it('buildSessionSetupUpdates requires context+channel and strips ownership', () => {
    const bad = buildSessionSetupUpdates({
      title: 'T',
      context: '',
      primary_channel: 'messages',
      awareness_level: '',
    })
    expect(bad.ok).toBe(false)

    const noChannel = buildSessionSetupUpdates({
      title: '',
      context: 'Brief',
      primary_channel: '',
      awareness_level: 'warm',
    })
    expect(noChannel.ok).toBe(false)

    const ok = buildSessionSetupUpdates({
      title: 'Launch',
      context: 'Brief body',
      primary_channel: 'physical',
      awareness_level: 'cold',
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.updates).toEqual({
        title: 'Launch',
        context: 'Brief body',
        primary_channel: 'physical',
        awareness_level: 'cold',
      })
      expect(ok.updates).not.toHaveProperty('user_id')
      expect(ok.updates).not.toHaveProperty('business_id')
      expect(ok.updates).not.toHaveProperty('product_id')
    }
  })

  it('classifyGenerateReadiness hard-blocks offers only; empty context is soft', () => {
    expect(
      classifyGenerateReadiness({
        hasSession: true,
        hasText: true,
        sending: false,
        offerCount: 0,
        hasContext: false,
      }).hardBlock
    ).toBe('no_offer')

    const ready = classifyGenerateReadiness({
      hasSession: true,
      hasText: true,
      sending: false,
      offerCount: 2,
      hasContext: false,
    })
    expect(ready.hardBlock).toBeNull()
    expect(ready.softWarnEmptyContext).toBe(true)

    expect(
      classifyGenerateReadiness({
        hasSession: true,
        hasText: true,
        sending: false,
        offerCount: 1,
        hasContext: true,
      })
    ).toEqual({ hardBlock: null, softWarnEmptyContext: false })
  })
})
