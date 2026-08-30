import { describe, expect, it } from 'vitest'
import {
  CHAT_SHELL_OPEN_GIFT_CREDITS,
  chatShellOpenGiftLotId,
} from '../api/lib/credits/chat-shell-gift'
import { isUuid } from '../api/lib/credits/generation-id'

describe('chat-shell open gift', () => {
  it('uses a stable UUID lot id per user', () => {
    const a = chatShellOpenGiftLotId('11111111-1111-1111-1111-111111111111')
    const b = chatShellOpenGiftLotId('11111111-1111-1111-1111-111111111111')
    const c = chatShellOpenGiftLotId('22222222-2222-2222-2222-222222222222')
    expect(isUuid(a)).toBe(true)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('gifts 100 pack credits', () => {
    expect(CHAT_SHELL_OPEN_GIFT_CREDITS).toBe(100)
  })
})
