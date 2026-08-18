import { isGeneratedOfferImage } from './chatShellImages'

export type ReferenceRole = 'product' | 'context'

export interface OfferReferenceImage {
  id: string
  url: string
  kind: ReferenceRole
  label?: string | null
  productId: string
  productName?: string | null
  createdAt?: string
  selected?: boolean
}

export const MAX_POST_REFERENCE_IMAGES = 4
export const MAX_PRODUCT_ANGLE_PRESELECT = 3

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
    .map((img) => ({
      id: img.id,
      url: img.image_url as string,
      kind: img.kind === 'context' ? 'context' as const : 'product' as const,
      label: img.label,
      productId: img.product_id,
      productName: nameOf(img.product_id),
      createdAt: img.created_at,
    }))
}

function sortByRecency(images: OfferReferenceImage[]): OfferReferenceImage[] {
  return [...images].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0
    return tb - ta
  })
}

/** Up to 3 current-offer product angles + 1 context, cap 4. */
export function preselectOfferReferenceIds(
  images: OfferReferenceImage[],
  currentProductId: string,
  max = MAX_POST_REFERENCE_IMAGES
): string[] {
  const current = images.filter((img) => img.productId === currentProductId)
  const others = images.filter((img) => img.productId !== currentProductId)
  const currentProducts = sortByRecency(current.filter((img) => img.kind === 'product'))
    .slice(0, MAX_PRODUCT_ANGLE_PRESELECT)
  const currentContexts = sortByRecency(current.filter((img) => img.kind === 'context'))
  const otherContexts = sortByRecency(others.filter((img) => img.kind === 'context'))
  const otherProducts = sortByRecency(others.filter((img) => img.kind === 'product'))

  const selected: OfferReferenceImage[] = [...currentProducts]
  const context = currentContexts[0] || otherContexts[0]
  if (context && selected.length < max && !selected.some((img) => img.id === context.id)) {
    selected.push(context)
  }
  for (const img of otherProducts) {
    if (selected.length >= max) break
    if (!selected.some((item) => item.id === img.id)) selected.push(img)
  }
  return selected.slice(0, max).map((img) => img.id)
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

/** Exact confirmed IDs only — no silent union with extra product photos. */
export function confirmedReferenceImageIds(
  images: Array<{ id: string; selected?: boolean }>
): string[] {
  return images
    .filter((img) => img.selected === true)
    .map((img) => img.id)
    .slice(0, MAX_POST_REFERENCE_IMAGES)
}

export function hasSelectedProductReference(
  images: Array<{ selected?: boolean; kind?: string | null }>
): boolean {
  return images.some((img) => img.selected === true && img.kind !== 'context')
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
  currentContext: OfferReferenceImage[]
  otherOffers: OfferReferenceImage[]
} {
  return {
    currentProduct: images.filter((img) => img.productId === currentProductId && img.kind === 'product'),
    currentContext: images.filter((img) => img.productId === currentProductId && img.kind === 'context'),
    otherOffers: images.filter((img) => img.productId !== currentProductId),
  }
}
