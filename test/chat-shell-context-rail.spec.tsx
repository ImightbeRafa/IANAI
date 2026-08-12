/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatContextRail from '../src/features/chat-shell/ChatContextRail'
import {
  readSetupSkipped,
  setupSkippedStorageKey,
} from '../src/features/chat-shell/chatContextSetup'
import type { ChatSession } from '../src/types'

function memoryLocalStorage() {
  const store: Record<string, string> = {}
  const storage: Storage = {
    get length() {
      return Object.keys(store).length
    },
    clear() {
      for (const key of Object.keys(store)) delete store[key]
    },
    getItem(key: string) {
      return store[key] ?? null
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    removeItem(key: string) {
      delete store[key]
    },
    setItem(key: string, value: string) {
      store[key] = String(value)
    },
  }
  return { store, storage }
}

function incompleteSession(id: string): ChatSession {
  return {
    id,
    user_id: 'u1',
    business_id: 'b1',
    product_id: null,
    title: 'New chat',
    context: '',
    primary_channel: null,
    awareness_level: null,
    status: 'active',
    framework: 'venta_directa',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('ChatContextRail Skip remount', () => {
  const sessionId = 'f18b984d-active'
  const olderId = '54a4b83f-older'
  let store: Record<string, string>
  let storage: Storage

  beforeEach(() => {
    ;({ store, storage } = memoryLocalStorage())
    vi.stubGlobal('localStorage', storage)
    // Seed an older skipped session — remount must not touch it.
    storage.setItem(setupSkippedStorageKey(olderId), '1')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('Skip → unmount/remount keeps interview closed and LS key for same session', async () => {
    const user = userEvent.setup()
    const session = incompleteSession(sessionId)
    const railProps = {
      tab: 'context' as const,
      onTabChange: () => {},
      onClose: () => {},
      session,
      language: 'en' as const,
    }

    const first = render(<ChatContextRail {...railProps} />)
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(readSetupSkipped(storage, sessionId)).toBe(true)
    expect(store[setupSkippedStorageKey(sessionId)]).toBe('1')
    expect(store[setupSkippedStorageKey(olderId)]).toBe('1')
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Resume setup' })).toBeTruthy()

    first.unmount()

    // Remount with same session id — hydrate must only READ, never clear.
    render(<ChatContextRail {...railProps} />)
    expect(readSetupSkipped(storage, sessionId)).toBe(true)
    expect(store[setupSkippedStorageKey(sessionId)]).toBe('1')
    expect(store[setupSkippedStorageKey(olderId)]).toBe('1')
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.queryByLabelText('Session setup')).toBeNull()
    expect(screen.getByRole('button', { name: 'Resume setup' })).toBeTruthy()
  })

  it('Resume setup clears skip LS and reopens interview', async () => {
    const user = userEvent.setup()
    const session = incompleteSession(sessionId)
    storage.setItem(setupSkippedStorageKey(sessionId), '1')

    render(
      <ChatContextRail
        tab="context"
        onTabChange={() => {}}
        onClose={() => {}}
        session={session}
        language="en"
      />
    )

    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Resume setup' }))

    expect(readSetupSkipped(storage, sessionId)).toBe(false)
    expect(store[setupSkippedStorageKey(sessionId)]).toBeUndefined()
    // Older key untouched.
    expect(store[setupSkippedStorageKey(olderId)]).toBe('1')
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
    expect(screen.getByLabelText('Session setup')).toBeTruthy()
  })
})
