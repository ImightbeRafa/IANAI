import { isGeneratedOfferImage } from './chatShellImages'

/** Upload / UI roles. DB `kind` stays product|context|generated. */
export type ReferenceRole = 'product' | 'scene' | 'style' | 'logo'

/** @deprecated Prefer ReferenceRole; kept for call sites that still pass DB kind. */
export type ReferenceDbKind = 'product' | 'context'

export interface OfferReferenceImage {
  id: string
  url: string
  /** Visual role used by the picker and prompts. */
  kind: ReferenceRole
  /** Raw DB kind for persistence paths. */
  dbKind: ReferenceDbKind
  label?: string | null
  productId: string
  productName?: string | null
  createdAt?: string
  selected?: boolean
}

export const MAX_POST_REFERENCE_IMAGES = 4
export const MAX_PRODUCT_ANGLE_PRESELECT = 3

const SCENE_LABEL_RE = /\b(scene|escena|contexto)\b/i
const STYLE_LABEL_RE = /\b(style|estilo|layout|formato|post\s*ref)\b/i
const LOGO_LABEL_RE = /\b(logo|marca|brand\s*mark|wordmark)\b/i

export function referenceRoleFromStored(options: {
  kind?: string | null
  label?: string | null
}): ReferenceRole {
  if (options.kind === 'product') return 'product'
  if (LOGO_LABEL_RE.test(options.label || '')) return 'logo'
  if (STYLE_LABEL_RE.test(options.label || '')) return 'style'
  if (SCENE_LABEL_RE.test(options.label || '')) return 'scene'
  // Legacy context rows default to scene inspiration.
  return 'scene'
}

export function dbKindForReferenceRole(role: ReferenceRole): ReferenceDbKind {
  return role === 'product' ? 'product' : 'context'
}

export function labelForReferenceRole(role: ReferenceRole, language: 'en' | 'es' = 'es'): string {
  if (role === 'product') return language === 'es' ? 'Producto' : 'Product'
  if (role === 'style') return language === 'es' ? 'Estilo · post ref' : 'Style · post ref'
  if (role === 'logo') return language === 'es' ? 'Logo · marca' : 'Logo · brand'
  return language === 'es' ? 'Escena · contexto' : 'Scene · context'
}

/** Logo attaches via brandLogoUrl — exclude from productImageIds so it is not mis-roled. */
export function confirmedProductReferenceImageIds(
  images: Array<{ id: string; selected?: boolean; kind?: string | null }>
): string[] {
  return images
    .filter((img) => img.selected === true && img.kind !== 'logo')
    .map((img) => img.id)
    .slice(0, MAX_POST_REFERENCE_IMAGES)
}

export function selectedBrandLogoUrl(
  images: Array<{ url: string; selected?: boolean; kind?: string | null }>
): string | undefined {
  const logo = images.find((img) => img.selected === true && img.kind === 'logo' && Boolean(img.url))
  return logo?.url || undefined
}

export function shouldPromptImageReferences(options: {
  styleKind?: string | null
  referenceMode?: 'use' | 'none'
}): boolean {
  if (options.styleKind === 'logo') return false
  return options.referenceMode !== 'use' && options.referenceMode !== 'none'
}

export function catalogOfferReferences(
  images: Array<{
    id: string
    image_url?: string | null
    kind?: string | null
    label?: string | null
    product_id: string
    created_at?: string
    message_id?: string | null
  }>,
  productNames?: Map<string, string> | Record<string, string>
): OfferReferenceImage[] {
  const nameOf = (productId: string) => {
    if (!productNames) return null
    if (productNames instanceof Map) return productNames.get(productId) || null
    return productNames[productId] || null
  }
  return images
    .filter((img) => Boolean(img.image_url) && !isGeneratedOfferImage(img))
    .map((img) => {
      const role = referenceRoleFromStored({ kind: img.kind, label: img.label })
      return {
        id: img.id,
        url: img.image_url as string,
        kind: role,
        dbKind: dbKindForReferenceRole(role),
        label: img.label,
        productId: img.product_id,
        productName: nameOf(img.product_id),
        createdAt: img.created_at,
      }
    })
}

function sortByRecency(images: OfferReferenceImage[]): OfferReferenceImage[] {
  return [...images].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0
    return tb - ta
  })
}

/** Up to 3 current-offer product angles. Scene / style / logo stay off until the user opts in. */
export function preselectOfferReferenceIds(
  images: OfferReferenceImage[],
  currentProductId: string,
  max = MAX_POST_REFERENCE_IMAGES
): string[] {
  const current = images.filter((img) => img.productId === currentProductId)
  const currentProducts = sortByRecency(current.filter((img) => img.kind === 'product'))
    .slice(0, Math.min(MAX_PRODUCT_ANGLE_PRESELECT, max))
  return currentProducts.map((img) => img.id)
}

export function withPreselectedReferences(
  catalog: OfferReferenceImage[],
  currentProductId: string,
  preferredIds?: string[]
): OfferReferenceImage[] {
  const validPreferred = (preferredIds || [])
    .filter((id) => catalog.some((img) => img.id === id))
    .slice(0, MAX_POST_REFERENCE_IMAGES)
  const selectedIds = new Set(
    validPreferred.length > 0
      ? validPreferred
      : preselectOfferReferenceIds(catalog, currentProductId)
  )
  return catalog.map((img) => ({ ...img, selected: selectedIds.has(img.id) }))
}

/** Exact confirmed IDs only — no silent union with extra product photos. Logo uses brandLogoUrl. */
export function confirmedReferenceImageIds(
  images: Array<{ id: string; selected?: boolean; kind?: string | null }>
): string[] {
  return confirmedProductReferenceImageIds(images)
}

export function hasSelectedProductReference(
  images: Array<{ selected?: boolean; kind?: string | null }>
): boolean {
  return images.some((img) => img.selected === true && img.kind === 'product')
}

export function shouldCopyForeignOfferImage(
  productId: string,
  currentProductId: string
): boolean {
  return Boolean(productId && currentProductId && productId !== currentProductId)
}

export function partitionReferenceCopies(
  selected: Array<{ id: string; productId: string }>,
  currentProductId: string
): { keepIds: string[]; copyIds: string[] } {
  const keepIds: string[] = []
  const copyIds: string[] = []
  for (const item of selected) {
    if (shouldCopyForeignOfferImage(item.productId, currentProductId)) copyIds.push(item.id)
    else keepIds.push(item.id)
  }
  return { keepIds, copyIds }
}

export function postOptimizeVersionLabel(
  density: 'hard' | 'medium',
  language: 'en' | 'es'
): string {
  if (language === 'es') return density === 'hard' ? 'Post · Poco texto' : 'Post · Texto medio'
  return density === 'hard' ? 'Post · Short copy' : 'Post · Medium copy'
}

export function postOptimizeDensityFromLabel(label?: string | null): 'hard' | 'medium' | null {
  const value = (label || '').trim().toLowerCase()
  if (!value) return null
  if (value.includes('poco texto') || value.includes('short copy')) return 'hard'
  if (value.includes('texto medio') || value.includes('medium copy')) return 'medium'
  return null
}

export function shouldPersistPostOptimizeVersion(options: {
  latestContent?: string | null
  draft: string
}): boolean {
  const draft = options.draft.trim()
  if (!draft) return false
  return (options.latestContent || '').trim() !== draft
}

export function toggleReferenceSelection(
  images: OfferReferenceImage[],
  id: string,
  max = MAX_POST_REFERENCE_IMAGES
): OfferReferenceImage[] {
  const current = images.find((img) => img.id === id)
  if (!current) return images
  const selectedCount = images.filter((img) => img.selected === true).length
  if (current.selected === true) {
    return images.map((img) => img.id === id ? { ...img, selected: false } : img)
  }
  if (selectedCount >= max) return images
  return images.map((img) => img.id === id ? { ...img, selected: true } : img)
}

export function groupOfferReferences(
  images: OfferReferenceImage[],
  currentProductId: string
): {
  currentProduct: OfferReferenceImage[]
  currentScene: OfferReferenceImage[]
  currentStyle: OfferReferenceImage[]
  currentLogo: OfferReferenceImage[]
  /** @deprecated alias of scene+style for older UI */
  currentContext: OfferReferenceImage[]
  otherOffers: OfferReferenceImage[]
} {
  const currentProduct = images.filter((img) => img.productId === currentProductId && img.kind === 'product')
  const currentScene = images.filter((img) => img.productId === currentProductId && img.kind === 'scene')
  const currentStyle = images.filter((img) => img.productId === currentProductId && img.kind === 'style')
  const currentLogo = images.filter((img) => img.productId === currentProductId && img.kind === 'logo')
  return {
    currentProduct,
    currentScene,
    currentStyle,
    currentLogo,
    currentContext: [...currentScene, ...currentStyle],
    otherOffers: images.filter((img) => img.productId !== currentProductId),
  }
}
