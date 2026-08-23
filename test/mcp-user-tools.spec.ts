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
    expect(brands).toEqual([{ id: 'b1', name: 'Pura Sonrisa', type: 'brand' }])
    expect(await mcpListBrands(db, { id: 'user-b' })).toEqual([])
  })

  it('returns brand context for an owned brand and denies others', async () => {
    const ctx = await mcpGetBrandContext(db, { id: 'user-a' }, 'b1')
    expect(ctx.brand.name).toBe('Pura Sonrisa')
    expect(ctx.offers[0]?.id).toBe('p1')
    expect(ctx.brandKit?.primaryColor).toBe('#111111')
    await expect(mcpGetBrandContext(db, { id: 'user-b' }, 'b1')).rejects.toThrow(/not found|denied/i)
  })

  it('locks mutation policy: no deletes, approval for generate', () => {
    expect(MCP_MUTATION_POLICY.deleteTools).toBe(false)
    expect(MCP_MUTATION_POLICY.generateRequiresApprovalToken).toBe(true)
    expect(MCP_MUTATION_POLICY.scope).toBe('signed_in_user_only')
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
