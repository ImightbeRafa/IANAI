export const MAX_ENHANCE_REFS_PER_ROLE = 4

export type ShellEnhanceMode = 'magic' | 'rebuild'
export type ShellEnhanceTier = 'polish' | 'modernize' | 'rebuild'

export interface EnhanceReferenceImageLike {
  id: string
  product_id: string
  kind?: string | null
  image_url?: string | null
  created_at?: string
}

export function mapEnhanceModeToTier(mode: ShellEnhanceMode): Exclude<ShellEnhanceTier, 'polish'> {
  switch (mode) {
    case 'magic':
      return 'modernize'
    case 'rebuild':
      return 'rebuild'
    default: {
      const exhaustive: never = mode
      throw new Error(`Unhandled enhance mode: ${String(exhaustive)}`)
    }
  }
}

function newestFirst<T extends EnhanceReferenceImageLike>(images: T[]): T[] {
  return [...images].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0
    const tb = b.created_at ? Date.parse(b.created_at) : 0
    return tb - ta
  })
}

/**
 * Product/context truth for enhance: current offer only, never generated posts.
 */
export function collectOfferEnhanceReferences(
  images: EnhanceReferenceImageLike[],
  productId: string,
  excludeImageId?: string
): { productUrls: string[]; contextUrls: string[] } {
  if (!productId) return { productUrls: [], contextUrls: [] }

  const productUrls: string[] = []
  const contextUrls: string[] = []

  for (const img of newestFirst(images)) {
    if (img.product_id !== productId) continue
    if (excludeImageId && img.id === excludeImageId) continue
    if (img.kind === 'generated') continue
    const url = typeof img.image_url === 'string' ? img.image_url.trim() : ''
    if (!url) continue

    if (img.kind === 'context') {
      if (contextUrls.length < MAX_ENHANCE_REFS_PER_ROLE) contextUrls.push(url)
    } else if (img.kind === 'product') {
      if (productUrls.length < MAX_ENHANCE_REFS_PER_ROLE) productUrls.push(url)
    }

    if (
      productUrls.length >= MAX_ENHANCE_REFS_PER_ROLE
      && contextUrls.length >= MAX_ENHANCE_REFS_PER_ROLE
    ) {
      break
    }
  }

  return { productUrls, contextUrls }
}

export function buildShellImageEnhanceBody(options: {
  productId: string
  sessionId: string
  enhanceImage: string
  enhanceTier: ShellEnhanceTier
  language: 'en' | 'es'
  editPrompt?: string
  brandKitId?: string
  brandLogoUrl?: string
  customColors?: string[]
  productReferenceImages?: string[]
  contextReferenceImages?: string[]
  aspectRatio?: string
  model?: string
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    action: 'enhance',
    model: options.model || 'nano-banana-pro',
    productId: options.productId,
    sessionId: options.sessionId,
    enhanceImage: options.enhanceImage,
    enhanceTier: options.enhanceTier,
    language: options.language,
  }

  const editPrompt = options.editPrompt?.trim()
  if (editPrompt) body.editPrompt = editPrompt
  if (options.brandKitId) body.brandKitId = options.brandKitId
  if (options.brandLogoUrl) body.brandLogoUrl = options.brandLogoUrl
  if (options.customColors?.length) body.customColors = options.customColors.slice(0, 3)
  if (options.productReferenceImages?.length) {
    body.productReferenceImages = options.productReferenceImages.slice(0, MAX_ENHANCE_REFS_PER_ROLE)
  }
  if (options.contextReferenceImages?.length) {
    body.contextReferenceImages = options.contextReferenceImages.slice(0, MAX_ENHANCE_REFS_PER_ROLE)
  }
  if (options.aspectRatio) body.aspectRatio = options.aspectRatio

  return body
}
