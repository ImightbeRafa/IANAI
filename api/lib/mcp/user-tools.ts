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

export type McpBrandKitContext = {
  id: string
  name: string
  primaryColor?: string | null
  secondaryColor?: string | null
  accentColor?: string | null
  logoUrl?: string | null
  tagline?: string | null
  brandVoice?: string | null
  toneKeywords?: string[]
  targetAudience?: string | null
  visualStyleNotes?: string | null
  fontPrimary?: string | null
  referenceImages?: string[]
  styleDnas?: Array<{
    id: string
    name: string
    kind: 'organic' | 'ads'
    referenceUrls: string[]
    notes: string
  }>
}

export type McpGuideIntakeSummary = {
  id: string
  sourceUrl: string
  status: string
  errorMessage?: string | null
  completedAt?: string | null
  warnings?: string[]
  analysisFacts?: Record<string, unknown> | null
}

export type McpBrandContext = {
  brand: McpBrandSummary & {
    location?: string | null
    salesChannels?: string[] | null
    doesShipping?: boolean | null
    shippingMethod?: string | null
    icpDescription?: string | null
  }
  offers: Array<{ id: string; name: string; type?: string | null }>
  brandKit?: McpBrandKitContext | null
  latestGuideIntake?: McpGuideIntakeSummary | null
}

export type McpDbClient = {
  listBusinessesForUser: (userId: string) => Promise<McpBrandSummary[]>
  getBusinessForUser: (
    userId: string,
    brandId: string
  ) => Promise<(McpBrandSummary & {
    userId: string
    location?: string | null
    salesChannels?: string[] | null
    doesShipping?: boolean | null
    shippingMethod?: string | null
    icpDescription?: string | null
  }) | null>
  /** Always scoped by authenticated userId + brandId (defense in depth). */
  listOffersForBrand: (
    userId: string,
    brandId: string
  ) => Promise<Array<{ id: string; name: string; type?: string | null }>>
  getBrandKitForBrand: (userId: string, brandId: string) => Promise<McpBrandKitContext | null>
  getLatestGuideIntakeForBrand?: (
    userId: string,
    brandId: string
  ) => Promise<McpGuideIntakeSummary | null>
  listOfferReferenceImages?: (
    userId: string,
    brandId: string,
    offerId: string
  ) => Promise<string[]>
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

  const [offers, brandKit, latestGuideIntake] = await Promise.all([
    db.listOffersForBrand(user.id, brandId),
    db.getBrandKitForBrand(user.id, brandId),
    db.getLatestGuideIntakeForBrand
      ? db.getLatestGuideIntakeForBrand(user.id, brandId)
      : Promise.resolve(null),
  ])

  return {
    brand: {
      id: brand.id,
      name: brand.name,
      type: brand.type ?? null,
      location: brand.location ?? null,
      salesChannels: brand.salesChannels ?? null,
      doesShipping: brand.doesShipping ?? null,
      shippingMethod: brand.shippingMethod ?? null,
      icpDescription: brand.icpDescription ?? null,
    },
    offers,
    brandKit: brandKit || null,
    latestGuideIntake: latestGuideIntake || null,
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
  deleteTools: true,
  archiveTools: true,
  /** Permanent delete = no recovery; UI/MCP must warn with impact counts first. */
  permanentDeleteRequiresTypedConfirm: true,
  /** Brand folder delete removes sessions/offers/assets; brand_kits are detached and kept. */
  brandDeletePreservesBrandKits: true,
  generateRequiresApprovalToken: true,
  executeApprovalSurface: 'grok_chat_popup' as const,
  executeApprovalTtlMs: 60 * 60 * 1000,
  guideIntakeMaxFiles: 5,
  guideIntakeAllowUrl: true,
  guideIntakeAllowPdf: true,
  guideIntakeAllowImages: true,
  guideConsumesAdvanceCredits: false,
  executeConsumesAdvanceCredits: true,
  sameSubscriptionCredits: true,
  importExternalGrokImages: false,
  sessionProvenanceGeneratedOutside: true,
  socialAutoPost: false,
  scope: 'signed_in_user_and_team_as_web' as const,
  syncVisibleInWebApp: true,
}
