import { describe, expect, it } from 'vitest'
import {
  buildMinimalBrandFormData,
  validateBrandCreateName,
} from '../src/features/chat-shell/chatShellBrandCreate'

describe('chatShellBrandCreate', () => {
  it('requires a non-empty trimmed name', () => {
    expect(validateBrandCreateName('')).toMatch(/required/i)
    expect(validateBrandCreateName('   ')).toMatch(/required/i)
    expect(validateBrandCreateName('Acme')).toBeNull()
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
