import { describe, expect, it } from 'vitest'
import {
  emptyThreadSnapshot,
  mergeFetchedMessages,
  mergeFetchedMessagesForOwner,
  readThreadCache,
  shouldKeepMountedTranscript,
  writeThreadCache,
  type CachedThread,
} from '../src/features/chat-shell/chatShellThreadCache'
import type { Message } from '../src/types'

function msg(id: string, content: string, sessionId = 's1'): Message {
  return {
    id,
    session_id: sessionId,
    role: 'user',
    content,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function snapshot(messages: Message[]): CachedThread {
  return { ...emptyThreadSnapshot(), messages }
}

describe('chatShellThreadCache', () => {
  it('reads and writes snapshots, dropping the oldest when over capacity', () => {
    const cache = new Map<string, CachedThread>()
    writeThreadCache(cache, 's1', snapshot([msg('m1', 'hola')]))
    expect(readThreadCache(cache, 's1')?.messages[0]?.content).toBe('hola')
    expect(readThreadCache(cache, null)).toBeNull()
  })

  it('keeps local artifacts when the fetch row is incomplete', () => {
    const local = [{
      ...msg('m1', 'script'),
      artifacts: [{
        id: 'a1',
        session_id: 's1',
        message_id: 'm1',
        product_id: 'p1',
        artifact_type: 'script' as const,
        ordinal: 1,
        action_type: 'generate' as const,
        action_metadata: {},
        created_by: 'u1',
        created_at: '2026-01-01T00:00:00Z',
      }],
    }]
    const fetched = [msg('m1', 'script')]
    const merged = mergeFetchedMessages(local, fetched)
    expect(merged[0]?.artifacts?.length).toBe(1)
  })

  it('replaces the transcript when the displayed owner is a different session', () => {
    const local = [msg('old', 'ForgeCR', 's-old')]
    const fetched = [msg('new', 'Bloom', 's-new')]
    expect(mergeFetchedMessagesForOwner(local, fetched, 's-old', 's-new')).toEqual(fetched)
    expect(mergeFetchedMessagesForOwner(local, fetched, null, 's-new')).toEqual(fetched)
  })

  it('merges optimistic rows only when the owner matches the fetch', () => {
    const local = [msg('opt', 'pending', 's1'), msg('m1', 'saved', 's1')]
    const fetched = [msg('m1', 'saved', 's1')]
    const merged = mergeFetchedMessagesForOwner(local, fetched, 's1', 's1')
    expect(merged.map((row) => row.id)).toEqual(['m1', 'opt'])
  })

  it('keeps the mounted transcript while a destination session is loading', () => {
    expect(shouldKeepMountedTranscript(true, 2)).toBe(true)
    expect(shouldKeepMountedTranscript(true, 0)).toBe(false)
    expect(shouldKeepMountedTranscript(false, 4)).toBe(false)
  })
})
