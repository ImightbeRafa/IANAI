import { describe, expect, it } from 'vitest'
import { canBrowserFetchImageUrl } from '../src/features/chat-shell/chatShellImageApi'

describe('canBrowserFetchImageUrl', () => {
  it('allows data URLs and supabase hosts, not storefronts', () => {
    expect(canBrowserFetchImageUrl('data:image/png;base64,aaa')).toBe(true)
    expect(canBrowserFetchImageUrl('https://project.supabase.co/storage/v1/object/public/x.webp')).toBe(true)
    expect(canBrowserFetchImageUrl('https://www.purasonrisa.shopping/images/water.jpg')).toBe(false)
    expect(canBrowserFetchImageUrl('https://cdn.example/logo.png')).toBe(false)
  })
})
