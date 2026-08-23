/**
 * Per-user MCP read tools (no mutations). Bound to the authenticated user only.
 * Generation / edit tools stay gated behind an approval-token flow (not implemented here).
 */

export type McpAuthUser = {
  id: string
  email?: string | null
}

export type McpBrandSummary = {
  id: string
  name: string
  type?: string | null
}

export type McpBrandContext = {
  brand: McpBrandSummary
  offers: Array<{ id: string; name: string; type?: string | null }>
  brandKit?: {
    id: string
    name: string
    primaryColor?: string | null
    secondaryColor?: string | null
  } | null
}

export type McpDbClient = {
  listBusinessesForUser: (userId: string) => Promise<McpBrandSummary[]>
  getBusinessForUser: (userId: string, brandId: string) => Promise<(McpBrandSummary & { userId: string }) | null>
  /** Always scoped by authenticated userId + brandId (defense in depth). */
  listOffersForBrand: (
    userId: string,
    brandId: string
  ) => Promise<Array<{ id: string; name: string; type?: string | null }>>
  getBrandKitForBrand: (userId: string, brandId: string) => Promise<McpBrandContext['brandKit']>
}

/** list_brands — personal brands only. */
export async function mcpListBrands(
  db: McpDbClient,
  user: McpAuthUser
): Promise<McpBrandSummary[]> {
  if (!user?.id) throw new Error('Authentication required')
  return db.listBusinessesForUser(user.id)
}

/** get_brand_context — brand + offers + kit owned by the same user. */
export async function mcpGetBrandContext(
  db: McpDbClient,
  user: McpAuthUser,
  brandId: string
): Promise<McpBrandContext> {
  if (!user?.id) throw new Error('Authentication required')
  if (!brandId) throw new Error('brandId is required')

  const brand = await db.getBusinessForUser(user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  if (brand.userId !== user.id) throw new Error('Access denied')

  const [offers, brandKit] = await Promise.all([
    db.listOffersForBrand(user.id, brandId),
    db.getBrandKitForBrand(user.id, brandId),
  ])

  return {
    brand: { id: brand.id, name: brand.name, type: brand.type ?? null },
    offers,
    brandKit: brandKit || null,
  }
}

/** Tool schema for future MCP host wiring (Grok custom connector / Responses). */
export const MCP_READ_TOOL_SCHEMAS = [
  {
    name: 'list_brands',
    description: 'List brands owned by the signed-in user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_brand_context',
    description: 'Get one owned brand with offers and brand kit. No deletes.',
    inputSchema: {
      type: 'object',
      properties: { brandId: { type: 'string' } },
      required: ['brandId'],
      additionalProperties: false,
    },
  },
] as const

export const MCP_MUTATION_POLICY = {
  deleteTools: false,
  generateRequiresApprovalToken: true,
  sameSubscriptionCredits: true,
  scope: 'signed_in_user_only' as const,
}
