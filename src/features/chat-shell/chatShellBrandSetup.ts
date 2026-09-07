/**
 * Per-folder (business) onboarding completeness. Inferred from existing rows —
 * no setup_state column. Skip is device-local per user+business.
 */

import type {
  BrandKit,
  Business,
  ChatSession,
  GeographicScope,
  Product,
  ProductType,
  SalesChannel,
} from '../../types'

export type BrandSetupStepId =
  | 'business'
  | 'channels'
  | 'audience'
  | 'offer'
  | 'brand'
  | 'sources'

export interface BrandSetupSnapshot {
  businessBasics: boolean
  operations: boolean
  audience: boolean
  offerCore: boolean
  offerDepth: boolean
  brandVoice: boolean
  visualIdentity: boolean
  sources: boolean
  stronglyComplete: boolean
}

export interface BrandSetupAdvice {
  scripts: { es: string; en: string }
  images: { es: string; en: string }
  skip: { es: string; en: string }
}

const PRODUCT_TYPES: ProductType[] = [
  'product',
  'service',
  'restaurant',
  'real_estate',
  'indumentaria',
]

export function isProductType(value: unknown): value is ProductType {
  return typeof value === 'string' && (PRODUCT_TYPES as string[]).includes(value)
}

export function isSalesChannel(value: unknown): value is SalesChannel {
  return value === 'physical' || value === 'messages' || value === 'website'
}

export function isGeographicScope(value: unknown): value is GeographicScope {
  return value === 'local' || value === 'country' || value === 'world' || value === 'custom'
}

export function nonempty(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some((item) => nonempty(item))
  return value != null && value !== false
}

/** Setup/create-widget must never read another folder’s offers. */
export function productsOwnedByBusiness(
  products: Product[],
  businessId: string | null | undefined
): Product[] {
  if (!businessId) return []
  return products.filter((row) => row.business_id === businessId)
}

function hasPhysical(channels: SalesChannel[] | null | undefined): boolean {
  return (channels || []).includes('physical')
}

export function brandSetupSkipStorageKey(userId: string, businessId: string): string {
  return `ianai.chat-shell.brandSetup.skipped.${userId}.${businessId}`
}

export const SETUP_SKIP_CONTEXT_MARKER = '\n<!-- ianai:setup-skipped -->'

export function readSetupSkippedFromSession(context?: string | null): boolean {
  return Boolean(context?.includes('<!-- ianai:setup-skipped -->'))
}

export function withSetupSkippedContext(context: string | undefined | null, skipped: boolean): string {
  const base = (context || '').replace(SETUP_SKIP_CONTEXT_MARKER, '').trimEnd()
  return skipped ? `${base}${SETUP_SKIP_CONTEXT_MARKER}` : base
}

export function readBrandSetupSkipped(
  storage: { getItem(key: string): string | null } | null | undefined,
  userId: string | null | undefined,
  businessId: string | null | undefined,
  sessionContext?: string | null
): boolean {
  if (readSetupSkippedFromSession(sessionContext)) return true
  if (!storage || !userId || !businessId) return false
  try {
    const raw = storage.getItem(brandSetupSkipStorageKey(userId, businessId))
    return raw === '1' || raw === 'true'
  } catch {
    return false
  }
}

export function writeBrandSetupSkipped(
  storage: {
    getItem?(key: string): string | null
    setItem?(key: string, value: string): void
    removeItem?(key: string): void
  } | null | undefined,
  userId: string | null | undefined,
  businessId: string | null | undefined,
  skipped: boolean
): boolean {
  if (!storage || !userId || !businessId) return false
  const key = brandSetupSkipStorageKey(userId, businessId)
  try {
    if (skipped) {
      if (typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') return false
      storage.setItem(key, '1')
      const raw = storage.getItem(key)
      return raw === '1' || raw === 'true'
    }
    if (typeof storage.removeItem !== 'function') return false
    storage.removeItem(key)
    if (typeof storage.getItem === 'function' && storage.getItem(key) != null) return false
    return true
  } catch {
    return false
  }
}

export function isFirstBrandSession(
  session: Pick<ChatSession, 'id' | 'business_id' | 'created_at'> | null | undefined,
  brandSessions: Array<Pick<ChatSession, 'id' | 'business_id' | 'created_at'>>
): boolean {
  if (!session?.id || !session.business_id) return false
  const same = brandSessions.filter((row) => row.business_id === session.business_id)
  if (same.length === 0) return true
  const earliest = [...same].sort((a, b) => {
    const delta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    if (delta !== 0) return delta
    return a.id.localeCompare(b.id)
  })[0]
  return earliest.id === session.id
}

/** Latest kit linked on a session of this business — never a global default. */
export function resolveBusinessBrandKitId(
  sessions: Array<Pick<ChatSession, 'brand_kit_id' | 'updated_at' | 'created_at'>>
): string | null {
  const linked = sessions.filter((row) => nonempty(row.brand_kit_id))
  if (linked.length === 0) return null
  const latest = [...linked].sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at).getTime()
    const bTime = new Date(b.updated_at || b.created_at).getTime()
    return bTime - aTime
  })[0]
  return latest.brand_kit_id || null
}

function isOfferCoreComplete(product: Product): boolean {
  if (!nonempty(product.name) || product.name === 'Quick Use Image Studio') return false
  // Tracker Oferta = offer exists. Richer fields stay soft guidance (offerDepth).
  return true
}

function isOfferDepthComplete(product: Product): boolean {
  switch (product.type) {
    case 'product':
      return (
        nonempty(product.current_alternatives)
        && nonempty(product.key_objection)
        && nonempty(product.differentiation)
      )
    case 'service':
      return (
        nonempty(product.real_pain || product.svc_current_pain)
        && nonempty(product.failed_attempts || product.svc_alternatives_tried)
        && nonempty(product.key_objection || product.svc_main_objection)
      )
    case 'restaurant':
      return nonempty(product.menu_pdf_url) || (product.menu_text || '').trim().length > 80
    case 'real_estate':
      return nonempty(product.re_bedrooms) && nonempty(product.re_construction_size)
    case 'indumentaria':
      return nonempty(product.ind_sizes) && nonempty(product.ind_quality_description)
    default: {
      const _never: never = product.type
      return _never
    }
  }
}

function kitHasVoice(kit: BrandKit | null | undefined): boolean {
  if (!kit) return false
  return (
    nonempty(kit.brand_voice)
    || nonempty(kit.target_audience)
    || nonempty(kit.tagline)
    || (kit.tone_keywords || []).some((word) => nonempty(word))
  )
}

function kitHasVisuals(kit: BrandKit | null | undefined): boolean {
  if (!kit) return false
  return (
    nonempty(kit.logo_url)
    || nonempty(kit.primary_color)
    || nonempty(kit.visual_style_notes)
    || (kit.reference_images || []).some((url) => nonempty(url))
  )
}

function businessHasSources(business: Business | null | undefined, products: Product[]): boolean {
  const fromProducts = products.some(
    (product) =>
      nonempty(product.context_links_content)
      || (product.context_links || []).some((link) => nonempty(link))
      || nonempty(product.menu_pdf_url)
      || nonempty(product.menu_text)
  )
  return fromProducts || nonempty(business?.icp_description)
}

export function buildBrandSetupSnapshot(options: {
  business: Business | null | undefined
  products: Product[]
  linkedKit: BrandKit | null | undefined
}): BrandSetupSnapshot {
  const { business, products, linkedKit } = options
  const channels = (business?.sales_channels || []).filter(isSalesChannel)
  const businessBasics = nonempty(business?.name) && channels.length > 0
  const operations =
    !businessBasics
      ? false
      : hasPhysical(channels)
        ? nonempty(business?.location)
        : business?.does_shipping
          ? nonempty(business?.shipping_method)
          : true

  const audiences = (business?.target_audiences || []) as Array<{
    sex?: string
    age_min?: number
    age_max?: number
  }>
  const audience = nonempty(business?.icp_description) || audiences.length > 0

  const realOffers = products.filter((product) => product.name !== 'Quick Use Image Studio')
  const offerCore = realOffers.some(isOfferCoreComplete)
  const offerDepth = realOffers.some(isOfferDepthComplete)
  const brandVoice = kitHasVoice(linkedKit)
  const visualIdentity =
    kitHasVisuals(linkedKit)
    || realOffers.some((product) => (product.ind_product_images || []).some((url) => nonempty(url)))
  const sources = businessHasSources(business, realOffers)

  const stronglyComplete = businessBasics && offerCore && audience && (brandVoice || visualIdentity)

  return {
    businessBasics,
    operations,
    audience,
    offerCore,
    offerDepth,
    brandVoice,
    visualIdentity,
    sources,
    stronglyComplete,
  }
}

export function stepComplete(snapshot: BrandSetupSnapshot, step: BrandSetupStepId): boolean {
  switch (step) {
    case 'business':
      return snapshot.businessBasics && snapshot.operations
    case 'channels':
      return snapshot.businessBasics
    case 'audience':
      return snapshot.audience
    case 'offer':
      return snapshot.offerCore
    case 'brand':
      return snapshot.brandVoice || snapshot.visualIdentity
    case 'sources':
      return snapshot.sources
    default: {
      const _never: never = step
      return _never
    }
  }
}

export const BRAND_SETUP_STEPS: BrandSetupStepId[] = [
  'business',
  'channels',
  'audience',
  'offer',
  'brand',
  'sources',
]

export function shouldShowBrandSetup(options: {
  loaded: boolean
  business: Business | null | undefined
  session: ChatSession | null | undefined
  brandSessions: ChatSession[]
  snapshot: BrandSetupSnapshot
  skipped: boolean
  forceOpen?: boolean
}): boolean {
  const { loaded, business, session, brandSessions, snapshot, skipped, forceOpen = false } = options
  if (!loaded || !business || !session) return false
  if (forceOpen) return true
  if (skipped) return false
  if (snapshot.stronglyComplete) return false
  return isFirstBrandSession(session, brandSessions)
}

export function shouldShowSetupTracker(options: {
  loaded: boolean
  business: Business | null | undefined
  session: ChatSession | null | undefined
  snapshot: BrandSetupSnapshot
}): boolean {
  const { loaded, business, session, snapshot } = options
  if (!loaded || !business || !session) return false
  return !snapshot.stronglyComplete
}

export interface SetupWidgetLayout {
  x: number
  y: number
  collapsed: boolean
}

export function setupWidgetStorageKey(userId: string, businessId: string): string {
  return `ianai.setupWidget.${userId}.${businessId}`
}

export function readSetupWidgetLayout(
  storage: { getItem(key: string): string | null } | null | undefined,
  userId: string,
  businessId: string
): SetupWidgetLayout | null {
  if (!storage || !userId || !businessId) return null
  try {
    const raw = storage.getItem(setupWidgetStorageKey(userId, businessId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SetupWidgetLayout>
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null
    return {
      x: parsed.x,
      y: parsed.y,
      collapsed: Boolean(parsed.collapsed),
    }
  } catch {
    return null
  }
}

export function writeSetupWidgetLayout(
  storage: { setItem?(key: string, value: string): void } | null | undefined,
  userId: string,
  businessId: string,
  layout: SetupWidgetLayout
): void {
  if (!storage?.setItem || !userId || !businessId) return
  try {
    storage.setItem(setupWidgetStorageKey(userId, businessId), JSON.stringify(layout))
  } catch {
    /* ignore quota */
  }
}

export function clampSetupWidgetPosition(
  x: number,
  y: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const maxX = Math.max(8, viewport.width - size.width - 8)
  const maxY = Math.max(8, viewport.height - size.height - 8)
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY),
  }
}

export const BRAND_SETUP_ADVICE: BrandSetupAdvice = {
  scripts: {
    es: 'Ya podés crear un guion. Agregá público, problema, resultado, diferenciador y objeción para que salga más afilado.',
    en: 'You can create a script now. Add audience, problem, outcome, differentiation, and objections for sharper results.',
  },
  images: {
    es: 'Ya podés generar desde una descripción. Logo, colores, estilo y fotos de referencia mejoran la fidelidad visual.',
    en: 'You can generate from a description now. A logo, colors, style, and reference photos improve visual fidelity.',
  },
  skip: {
    es: 'Podés saltar ahora. Advance AI igual puede crear; cada dato adicional vuelve el resultado más preciso.',
    en: 'You can skip for now. Advance AI can still create; every extra detail makes the result more precise.',
  },
}

export function formTypeForProductType(type: ProductType): 'product' | 'service' | 'restaurant' | 'real_estate' | 'indumentaria' {
  return type
}

/** Drop invented empties / invalid enums from autofill JSON. */
export function pickDefinedAutofill(
  raw: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (key === 'sales_channels' && Array.isArray(value)) {
      const channels = value.filter(isSalesChannel)
      if (channels.length) out[key] = channels
      continue
    }
    if (key === 'type' && !isProductType(value)) continue
    if (
      (key === 'audience_geographic_scope' || key === 'geographic_scope')
      && !isGeographicScope(value)
    ) {
      continue
    }
    out[key] = value
  }
  return out
}
