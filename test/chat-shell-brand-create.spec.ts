import { describe, expect, it } from 'vitest'
import {
  buildMinimalBrandFormData,
  normalizeBrandWebsiteUrl,
  parseBrandCreateInput,
  validateBrandCreateName,
} from '../src/features/chat-shell/chatShellBrandCreate'

describe('chatShellBrandCreate', () => {
  it('requires a non-empty trimmed name', () => {
    expect(validateBrandCreateName('', 'en')).toMatch(/required/i)
    expect(validateBrandCreateName('   ', 'es')).toMatch(/obligatorio/i)
    expect(validateBrandCreateName('Acme')).toBeNull()
  })

  it('normalizes optional store URLs', () => {
    expect(normalizeBrandWebsiteUrl('')).toBeNull()
    expect(normalizeBrandWebsiteUrl('bloomcr.shopping')).toBe('https://bloomcr.shopping/')
    expect(normalizeBrandWebsiteUrl('https://www.bloomcr.shopping/p')).toBe('https://www.bloomcr.shopping/p')
    expect(normalizeBrandWebsiteUrl('not a url')).toBeNull()
  })

  it('parses create input with optional URL', () => {
    const ok = parseBrandCreateInput('Bloom', 'https://www.bloomcr.shopping/', 'es')
    expect(ok).toEqual({
      ok: true,
      name: 'Bloom',
      websiteUrl: 'https://www.bloomcr.shopping/',
    })
    const bad = parseBrandCreateInput('Bloom', 'nope', 'es')
    expect(bad.ok).toBe(false)
  })

  it('builds minimal BusinessFormData defaults', () => {
    expect(buildMinimalBrandFormData('  Acme Studio  ')).toEqual({
      name: 'Acme Studio',
      sales_channels: [],
      does_shipping: false,
      target_audiences: [],
    })
  })
})
