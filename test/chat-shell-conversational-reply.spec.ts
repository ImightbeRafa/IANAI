import { describe, expect, it } from 'vitest'
import {
  brandHasRealOffer,
  buildChatShellConversationalReply,
} from '../src/features/chat-shell/chatShellConversationalReply'

describe('chatShellConversationalReply', () => {
  it('greets without sounding like a generator', () => {
    const reply = buildChatShellConversationalReply({
      text: 'hey',
      language: 'es',
      hasOffer: true,
    })
    expect(reply.toLowerCase()).toContain('listo')
    expect(reply.toLowerCase()).not.toContain('gancho')
  })

  it('asks for offer when missing', () => {
    const reply = buildChatShellConversationalReply({
      text: 'hola',
      language: 'es',
      hasOffer: false,
    })
    expect(reply.toLowerCase()).toContain('oferta')
  })

  it('detects real offers', () => {
    expect(brandHasRealOffer([{ name: 'Arness Forge' } as never])).toBe(true)
    expect(brandHasRealOffer([{ name: 'Quick Use Image Studio' } as never])).toBe(false)
  })
})
