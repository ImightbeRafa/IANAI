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
  kitReady?: boolean
  offerCount?: number
  hasPrimaryKit?: boolean
  defaultOfferId?: string | null
  defaultOfferResolution?: 'first_offer_with_brand_kit' | 'first_offer' | 'none'
  nameCollisionWarning?: string | null
  siblingBrandIds?: string[]
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
  forbiddenPhrases?: string[]
  mustUsePhrases?: string[]
  styleDnas?: Array<{
    id: string
    name: string
    kind: 'organic' | 'ads'
    referenceUrls: string[]
    notes: string
  }>
  isPrimaryForBusiness?: boolean
  isDefault?: boolean
  businessId?: string | null
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
  offers: Array<{
    id: string
    name: string
    type?: string | null
    /** Exact price string when known (e.g. ₡9.900). Never an enum bucket. */
    price?: string | null
    priceRange?: string | null
    productDescription?: string | null
    differentiation?: string | null
    mainProblem?: string | null
    result?: string | null
    utility?: string | null
    technicalSpecs?: string | null
    doNotClaim?: string[]
  }>
  brandKit?: McpBrandKitContext | null
  brandKits?: Array<{
    id: string
    name: string
    businessId: string | null
    isPrimaryForBusiness: boolean
    isDefault: boolean
    isActive: boolean
    hasLogo: boolean
  }>
  brandKitResolution?: string
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
  ) => Promise<Array<{
    id: string
    name: string
    type?: string | null
    price?: string | null
    priceRange?: string | null
    productDescription?: string | null
    differentiation?: string | null
    mainProblem?: string | null
    result?: string | null
    utility?: string | null
    technicalSpecs?: string | null
    doNotClaim?: string[]
  }>>
  getBrandKitForBrand: (
    userId: string,
    brandId: string,
    brandKitId?: string
  ) => Promise<McpBrandKitContext | null>
  /** Optional richer resolution used by get_brand_context. */
  resolveBrandKitsForBrand?: (
    userId: string,
    brandId: string,
    brandKitId?: string
  ) => Promise<{
    brandKit: McpBrandKitContext | null
    brandKits: Array<{
      id: string
      name: string
      businessId: string | null
      isPrimaryForBusiness: boolean
      isDefault: boolean
      isActive: boolean
      hasLogo: boolean
    }>
    brandKitResolution: string
  }>
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

/** list_brands — personal brands only. Default hides kitReady:false unless includeIncomplete. */
export async function mcpListBrands(
  db: McpDbClient,
  user: McpAuthUser,
  args?: { includeIncomplete?: boolean }
): Promise<McpBrandSummary[]> {
  if (!user?.id) throw new Error('Authentication required')
  const includeIncomplete = args?.includeIncomplete === true
  const brands = await db.listBusinessesForUser(user.id)
  const enriched = await Promise.all(brands.map(async (brand) => {
    const [offers, kitBundle] = await Promise.all([
      db.listOffersForBrand(user.id, brand.id),
      db.resolveBrandKitsForBrand
        ? db.resolveBrandKitsForBrand(user.id, brand.id)
        : db.getBrandKitForBrand(user.id, brand.id).then((brandKit) => ({
            brandKit,
            brandKits: brandKit ? [{
              id: brandKit.id,
              name: brandKit.name,
              businessId: brandKit.businessId ?? brand.id,
              isPrimaryForBusiness: brandKit.isPrimaryForBusiness === true,
              isDefault: brandKit.isDefault === true,
              isActive: true,
              hasLogo: Boolean(brandKit.logoUrl),
            }] : [],
            brandKitResolution: brandKit ? 'primary' : 'missing',
          })),
    ])
    const kitReady = Boolean(kitBundle.brandKit)
    const defaultOffer = offers[0]
    return {
      ...brand,
      kitReady,
      offerCount: offers.length,
      hasPrimaryKit: kitBundle.brandKits.some((kit) => kit.isPrimaryForBusiness),
      defaultOfferId: defaultOffer?.id || null,
      defaultOfferResolution: defaultOffer
        ? (kitReady ? 'first_offer_with_brand_kit' : 'first_offer')
        : 'none',
    } satisfies McpBrandSummary
  }))

  const idsByName = new Map<string, string[]>()
  for (const brand of enriched) {
    const key = brand.name.trim().toLocaleLowerCase()
    idsByName.set(key, [...(idsByName.get(key) || []), brand.id])
  }
  const withWarnings = enriched.map((brand) => {
    const siblingBrandIds = (idsByName.get(brand.name.trim().toLocaleLowerCase()) || [])
      .filter((id) => id !== brand.id)
    return {
      ...brand,
      siblingBrandIds,
      nameCollisionWarning: siblingBrandIds.length
        ? `Duplicate brand name "${brand.name}". Select by brandId; no records were changed.`
        : null,
    }
  })
  if (includeIncomplete) return withWarnings
  return withWarnings.filter((brand) => brand.kitReady !== false)
}

/** get_brand_context — brand + offers + kit owned by the same user. */
export async function mcpGetBrandContext(
  db: McpDbClient,
  user: McpAuthUser,
  brandId: string,
  brandKitId?: string
): Promise<McpBrandContext> {
  if (!user?.id) throw new Error('Authentication required')
  if (!brandId) throw new Error('brandId is required')

  const brand = await db.getBusinessForUser(user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  if (brand.userId !== user.id) throw new Error('Access denied')

  const offersPromise = db.listOffersForBrand(user.id, brandId)
  const intakePromise = db.getLatestGuideIntakeForBrand
    ? db.getLatestGuideIntakeForBrand(user.id, brandId)
    : Promise.resolve(null)

  if (db.resolveBrandKitsForBrand) {
    const [offers, kitBundle, latestGuideIntake] = await Promise.all([
      offersPromise,
      db.resolveBrandKitsForBrand(user.id, brandId, brandKitId),
      intakePromise,
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
      brandKit: kitBundle.brandKit,
      brandKits: kitBundle.brandKits,
      brandKitResolution: kitBundle.brandKitResolution,
      latestGuideIntake: latestGuideIntake || null,
    }
  }

  const [offers, brandKit, latestGuideIntake] = await Promise.all([
    offersPromise,
    db.getBrandKitForBrand(user.id, brandId, brandKitId),
    intakePromise,
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
    brandKitResolution: brandKit ? 'primary' : 'missing',
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
  executeApprovalSurface: 'grok_chat' as const,
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
