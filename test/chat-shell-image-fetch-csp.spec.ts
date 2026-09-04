import { describe, expect, it } from 'vitest'
import { canBrowserFetchImageUrl } from '../src/features/chat-shell/chatShellImageApi'

describe('canBrowserFetchImageUrl', () => {
  it('allows data URLs, not storefronts', () => {
    expect(canBrowserFetchImageUrl('data:image/png;base64,aaa')).toBe(true)
    expect(canBrowserFetchImageUrl('https://www.purasonrisa.shopping/images/water.jpg')).toBe(false)
    expect(canBrowserFetchImageUrl('https://cdn.example/logo.png')).toBe(false)
  })
})
