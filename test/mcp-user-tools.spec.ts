import { describe, expect, it } from 'vitest'
import { createMcpSupabaseAdapter } from '../api/lib/mcp/supabase-adapter'
import {
  mcpGetBrandContext,
  mcpListBrands,
  MCP_MUTATION_POLICY,
  MCP_READ_TOOL_SCHEMAS,
  type McpDbClient,
} from '../api/lib/mcp/user-tools'

const db: McpDbClient = {
  async listBusinessesForUser(userId) {
    if (userId !== 'user-a') return []
    return [{ id: 'b1', name: 'Pura Sonrisa', type: 'brand' }]
  },
  async getBusinessForUser(userId, brandId) {
    if (userId !== 'user-a' || brandId !== 'b1') return null
    return { id: 'b1', name: 'Pura Sonrisa', type: 'brand', userId: 'user-a' }
  },
  async listOffersForBrand(userId, brandId) {
    if (userId !== 'user-a' || brandId !== 'b1') return []
    return [{ id: 'p1', name: 'Tiras', type: 'product' }]
  },
  async getBrandKitForBrand(userId, brandId) {
    if (userId !== 'user-a' || brandId !== 'b1') return null
    return { id: 'k1', name: 'Kit', primaryColor: '#111111', secondaryColor: '#22aa88' }
  },
}

describe('mcp user read tools', () => {
  it('lists only the signed-in user brands', async () => {
    const brands = await mcpListBrands(db, { id: 'user-a' })
    expect(brands).toEqual([expect.objectContaining({
      id: 'b1',
      name: 'Pura Sonrisa',
      type: 'brand',
      kitReady: true,
      offerCount: 1,
      hasPrimaryKit: false,
      defaultOfferId: 'p1',
      defaultOfferResolution: 'first_offer_with_brand_kit',
      nameCollisionWarning: null,
      siblingBrandIds: [],
    })])
    expect(await mcpListBrands(db, { id: 'user-b' })).toEqual([])
  })

  it('warns on duplicate names and returns sibling ids without changing records', async () => {
    const duplicateDb: McpDbClient = {
      ...db,
      async listBusinessesForUser() {
        return [
          { id: 'b1', name: 'Same Name' },
          { id: 'b2', name: 'same name' },
        ]
      },
      async listOffersForBrand(_userId, brandId) {
        return [{ id: `offer-${brandId}`, name: 'Offer' }]
      },
      async getBrandKitForBrand() {
        return null
      },
    }
    const brands = await mcpListBrands(duplicateDb, { id: 'user-a' }, { includeIncomplete: true })
    expect(brands[0]).toMatchObject({
      siblingBrandIds: ['b2'],
      nameCollisionWarning: expect.stringContaining('Duplicate brand name'),
    })
    expect(brands[1]).toMatchObject({ siblingBrandIds: ['b1'] })
    const readyOnly = await mcpListBrands(duplicateDb, { id: 'user-a' })
    expect(readyOnly).toHaveLength(0)
  })

  it('returns brand context for an owned brand and denies others', async () => {
    const ctx = await mcpGetBrandContext(db, { id: 'user-a' }, 'b1')
    expect(ctx.brand.name).toBe('Pura Sonrisa')
    expect(ctx.offers[0]?.id).toBe('p1')
    expect(ctx.brandKit?.primaryColor).toBe('#111111')
    expect(ctx.latestGuideIntake).toBeNull()
    await expect(mcpGetBrandContext(db, { id: 'user-b' }, 'b1')).rejects.toThrow(/not found|denied/i)
  })

  it('locks mutation policy: deletes allowed, guide free, execute metered', () => {
    expect(MCP_MUTATION_POLICY.deleteTools).toBe(true)
    expect(MCP_MUTATION_POLICY.archiveTools).toBe(true)
    expect(MCP_MUTATION_POLICY.permanentDeleteRequiresTypedConfirm).toBe(true)
    expect(MCP_MUTATION_POLICY.brandDeletePreservesBrandKits).toBe(true)
    expect(MCP_MUTATION_POLICY.executeApprovalSurface).toBe('grok_chat')
    expect(MCP_MUTATION_POLICY.executeApprovalTtlMs).toBe(60 * 60 * 1000)
    expect(MCP_MUTATION_POLICY.guideIntakeMaxFiles).toBe(5)
    expect(MCP_MUTATION_POLICY.generateRequiresApprovalToken).toBe(true)
    expect(MCP_MUTATION_POLICY.guideConsumesAdvanceCredits).toBe(false)
    expect(MCP_MUTATION_POLICY.executeConsumesAdvanceCredits).toBe(true)
    expect(MCP_MUTATION_POLICY.importExternalGrokImages).toBe(false)
    expect(MCP_MUTATION_POLICY.sessionProvenanceGeneratedOutside).toBe(true)
    expect(MCP_MUTATION_POLICY.socialAutoPost).toBe(false)
    expect(MCP_MUTATION_POLICY.syncVisibleInWebApp).toBe(true)
    expect(MCP_MUTATION_POLICY.scope).toBe('signed_in_user_and_team_as_web')
    expect(MCP_READ_TOOL_SCHEMAS.map((tool) => tool.name)).toEqual([
      'list_brands',
      'get_brand_context',
    ])
  })

  it('exposes a Supabase adapter factory (null when admin client unavailable in unit env)', () => {
    // In vitest without service role wiring this may be null or a client —
    // either way the factory must not throw.
    expect(() => createMcpSupabaseAdapter()).not.toThrow()
  })
})
