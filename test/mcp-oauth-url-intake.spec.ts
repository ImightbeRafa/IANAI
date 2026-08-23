import { describe, expect, it } from 'vitest'
import { buildOAuthConsentLoginPath, safeAppReturnPath } from '../src/lib/oauthReturnPath'
import { saveMcpUrlContext, type McpUrlIntakeStore } from '../api/lib/mcp/url-intake'
import type { McpDbClient } from '../api/lib/mcp/user-tools'

describe('oauth return path', () => {
  it('only allows same-origin relative paths', () => {
    expect(safeAppReturnPath('/oauth/consent?authorization_id=abc')).toBe(
      '/oauth/consent?authorization_id=abc'
    )
    expect(safeAppReturnPath('//evil.com')).toBeNull()
    expect(safeAppReturnPath('https://evil.com')).toBeNull()
    expect(safeAppReturnPath('/login')).toBe('/login')
    expect(buildOAuthConsentLoginPath('auth-1')).toContain(
      encodeURIComponent('/oauth/consent?authorization_id=auth-1')
    )
  })
})

describe('mcp url intake', () => {
  it('rejects unknown brands and persists pending_analysis for owners', async () => {
    const db: McpDbClient = {
      async listBusinessesForUser() {
        return []
      },
      async getBusinessForUser(userId, brandId) {
        if (userId === 'user-a' && brandId === 'b1') {
          return { id: 'b1', name: 'Pura', type: null, userId: 'user-a' }
        }
        return null
      },
      async listOffersForBrand() {
        return []
      },
      async getBrandKitForBrand() {
        return null
      },
    }
    const store: McpUrlIntakeStore = {
      async insertPendingUrlIntake() {
        return { id: 'u1' }
      },
    }

    await expect(
      saveMcpUrlContext({
        db,
        store,
        user: { id: 'user-b' },
        brandId: 'b1',
        url: 'https://example.com',
      })
    ).rejects.toThrow(/not found/i)

    const row = await saveMcpUrlContext({
      db,
      store,
      user: { id: 'user-a' },
      brandId: 'b1',
      url: 'https://example.com/x',
      appOrigin: 'https://advanceai.studio',
    })
    expect(row).toMatchObject({
      id: 'u1',
      status: 'pending_analysis',
      sourceUrl: 'https://example.com/x',
    })
    expect(row.deepLink).toContain('intake=u1')
  })
})
