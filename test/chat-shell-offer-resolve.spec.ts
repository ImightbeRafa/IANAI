import { describe, expect, it } from 'vitest'
import {
  decodeOfferPick,
  encodeOfferPick,
  matchOfferFromText,
  resolveSendOffer,
} from '../src/features/chat-shell/chatShellOfferResolve'
import {
  mergeFetchedMessages,
  replaceOptimisticMessage,
} from '../src/features/chat-shell/chatShellThreadCache'
import type { Message } from '../src/types'

const harness = { id: 'p1', name: 'Arnés ForgeCR' }
const jacket = { id: 'p2', name: 'Jacket Pro' }

describe('resolveSendOffer', () => {
  it('uses an already attached offer without opening the rail', () => {
    expect(resolveSendOffer({
      attachedCount: 1,
      products: [harness, jacket],
      text: 'genera un guion',
    })).toEqual({ action: 'use-attached' })
  })

  it('auto-attaches when the brand has a single offer', () => {
    expect(resolveSendOffer({
      attachedCount: 0,
      products: [harness],
      text: 'genera un guion',
    })).toEqual({ action: 'attach', productId: 'p1' })
  })

  it('attaches a uniquely named offer from the message', () => {
    expect(resolveSendOffer({
      attachedCount: 0,
      products: [harness, jacket],
      text: 'guion para Arnés ForgeCR',
    })).toEqual({ action: 'attach', productId: 'p1' })
  })

  it('asks when several offers exist and the message is ambiguous', () => {
    const result = resolveSendOffer({
      attachedCount: 0,
      products: [harness, jacket],
      text: 'genera un guion',
    })
    expect(result.action).toBe('ask')
  })

  it('matches a numbered pick', () => {
    expect(matchOfferFromText('2', [harness, jacket])?.id).toBe('p2')
  })

  it('round-trips the offer-pick marker for refresh', () => {
    const encoded = encodeOfferPick({ originalText: 'genera un guion', productIds: ['p1', 'p2'] })
    expect(decodeOfferPick(encoded)).toEqual({
      originalText: 'genera un guion',
      productIds: ['p1', 'p2'],
    })
  })
})

describe('message merge', () => {
  const msg = (id: string, content: string): Message => ({
    id,
    session_id: 's1',
    role: 'user',
    content,
    created_at: '2026-01-01T00:00:00.000Z',
  })

  it('keeps a just-saved local message when the fetch is still empty', () => {
    const local = [msg('intro', 'Armemos')]
    expect(mergeFetchedMessages(local, []).map((row) => row.id)).toEqual(['intro'])
  })

  it('replaces an optimistic row without duplicating the saved id', () => {
    const local = [msg('optimistic-user-1', 'hola'), msg('a1', 'ok')]
    const saved = msg('db-1', 'hola')
    const next = replaceOptimisticMessage(local, 'optimistic-user-1', saved)
    expect(next.map((row) => row.id)).toEqual(['db-1', 'a1'])
  })
})
