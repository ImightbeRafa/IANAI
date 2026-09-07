import { describe, expect, it } from 'vitest'
import { resolveChatGenerationId } from '../api/lib/credits/chat-generation-id'
import { isUuid } from '../api/lib/credits/generation-id'

const UUID = '11111111-1111-4111-8111-111111111111'

describe('resolveChatGenerationId', () => {
  it('rejects missing generationId when the request is session-bound', () => {
    expect(resolveChatGenerationId({ sessionBound: true, incoming: '' })).toEqual({
      ok: false,
      error: 'generationId is required',
    })
    expect(resolveChatGenerationId({ sessionBound: true, incoming: 'not-a-uuid' })).toEqual({
      ok: false,
      error: 'generationId is required',
    })
  })

  it('accepts a client UUID for chat-shell', () => {
    expect(resolveChatGenerationId({ sessionBound: true, incoming: UUID })).toEqual({
      ok: true,
      generationId: UUID,
    })
  })

  it('mints a UUID for classic callers that omit generationId', () => {
    const result = resolveChatGenerationId({ sessionBound: false, incoming: undefined })
    expect(result.ok).toBe(true)
    if (result.ok) expect(isUuid(result.generationId)).toBe(true)
  })

  it('reuses a classic client UUID when provided', () => {
    expect(resolveChatGenerationId({ sessionBound: false, incoming: UUID })).toEqual({
      ok: true,
      generationId: UUID,
    })
  })
})
