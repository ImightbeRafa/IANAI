import { describe, expect, it } from 'vitest'
import {
  CHAT_SHELL_OPEN_GIFT_CREDITS,
  chatShellOpenGiftLotId,
  shouldSkipChatShellOpenGift,
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

  it('grants only when VERCEL_ENV=production (fail-closed elsewhere)', () => {
    const prevEnv = process.env.VERCEL_ENV
    const prevFlag = process.env.CHAT_SHELL_OPEN_GIFT
    delete process.env.CHAT_SHELL_OPEN_GIFT

    process.env.VERCEL_ENV = 'preview'
    expect(shouldSkipChatShellOpenGift()).toBe(true)

    process.env.VERCEL_ENV = 'development'
    expect(shouldSkipChatShellOpenGift()).toBe(true)

    delete process.env.VERCEL_ENV
    expect(shouldSkipChatShellOpenGift()).toBe(true)

    process.env.VERCEL_ENV = 'production'
    expect(shouldSkipChatShellOpenGift()).toBe(false)

    process.env.CHAT_SHELL_OPEN_GIFT = '0'
    expect(shouldSkipChatShellOpenGift()).toBe(true)

    process.env.CHAT_SHELL_OPEN_GIFT = '1'
    expect(shouldSkipChatShellOpenGift()).toBe(false)

    if (prevEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = prevEnv
    if (prevFlag === undefined) delete process.env.CHAT_SHELL_OPEN_GIFT
    else process.env.CHAT_SHELL_OPEN_GIFT = prevFlag
  })
})
