/**
 * Pure helpers for chat-shell Images tab + optimize-for-post (C3).
 */

export const CHAT_SHELL_IMAGE_KINDS = ['product', 'context', 'generated'] as const
export type ChatShellImageKind = (typeof CHAT_SHELL_IMAGE_KINDS)[number]

export interface ShellImageLike {
  id: string
  product_id: string
  session_id?: string | null
  message_id?: string | null
  kind?: string | null
  created_at?: string
  image_url?: string
  label?: string | null
}

export type PostTextDensity = 'hard' | 'medium' | 'standard'

/** Prefer sticky selection, else primary (position 1), else first offer. */
export function resolveActiveImageOfferId(options: {
  offerProductIds: string[]
  preferredId?: string | null
  primaryProductId?: string | null
}): string | null {
  const { offerProductIds, preferredId, primaryProductId } = options
  if (preferredId && offerProductIds.includes(preferredId)) return preferredId
  if (primaryProductId && offerProductIds.includes(primaryProductId)) return primaryProductId
  return offerProductIds[0] ?? null
}

/** Filter images for the active offer (and optionally current session generated). */
export function filterImagesForOffer<T extends ShellImageLike>(
  images: T[],
  productId: string | null | undefined,
  options?: { sessionId?: string | null; includeOtherSessionGenerated?: boolean }
): T[] {
  if (!productId) return []
  const sessionId = options?.sessionId
  const includeOther = options?.includeOtherSessionGenerated === true
  return images.filter((img) => {
    if (img.product_id !== productId) return false
    if (img.kind === 'generated' && img.session_id && sessionId && img.session_id !== sessionId) {
      return includeOther
    }
    return true
  })
}

/** Latest image per product (by created_at desc). */
export function latestImageByProductId<T extends ShellImageLike>(
  images: T[]
): Map<string, T> {
  const sorted = [...images].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0
    const tb = b.created_at ? Date.parse(b.created_at) : 0
    return tb - ta
  })
  const map = new Map<string, T>()
  for (const img of sorted) {
    if (!map.has(img.product_id)) map.set(img.product_id, img)
  }
  return map
}

export function normalizePostTextDensity(value: unknown): PostTextDensity {
  return value === 'hard' || value === 'standard' || value === 'medium' ? value : 'medium'
}

/** Build editPrompt for optimize-for-post (reuses generate-image edit path). */
export function buildOptimizeForPostPrompt(options: {
  scriptText?: string
  density?: PostTextDensity
  language?: 'en' | 'es'
}): string {
  const density = normalizePostTextDensity(options.density)
  const es = options.language !== 'en'
  const densityLine = {
    hard: es
      ? 'Densidad CORTA: 4 frases legibles — gancho, beneficio o problema, prueba concreta, CTA.'
      : 'SHORT density: 4 readable beats — hook, benefit or problem, specific proof, CTA.',
    medium: es
      ? 'Densidad MEDIA: gancho, 2-3 líneas de desarrollo, CTA. Sin párrafos extra.'
      : 'MEDIUM density: hook, 2-3 development lines, CTA. No extra paragraphs.',
    standard: es
      ? 'Densidad ESTANDAR: 1 headline, 3-5 puntos, 1 CTA. Sin parrafos largos.'
      : 'STANDARD density: 1 headline, 3-5 points, 1 CTA. No long paragraphs.',
  }[density]

  const script = (options.scriptText || '').trim().slice(0, 2500)
  const base = es
    ? 'Optimiza esta imagen para un post publicitario. Conserva el producto/heroe visual. Mejora jerarquia tipografica y CTA.'
    : 'Optimize this image for an ad post. Keep the hero product. Improve typographic hierarchy and CTA.'

  return script
    ? `${base}\n${densityLine}\nScript/context:\n${script}`
    : `${base}\n${densityLine}`
}

export function canShowImageActionsForOffer(options: {
  productId: string | null | undefined
  latestByProduct: Map<string, ShellImageLike>
}): boolean {
  if (!options.productId) return false
  return options.latestByProduct.has(options.productId)
}

/** Generated posts must not be reused as refs for a later independent generate. */
export function isGeneratedOfferImage(img: {
  kind?: string | null
  message_id?: string | null
}): boolean {
  if (img.kind === 'generated') return true
  if (img.kind === 'product' || img.kind === 'context') return false
  return Boolean(img.message_id)
}

export interface ImageWorkspaceArtifactLike {
  id?: string
  artifact_type?: string | null
  product_image_id?: string | null
  product_id?: string | null
  message_id?: string | null
  action_type?: string | null
  action_metadata?: Record<string, unknown> | null
  product_image?: ShellImageLike | null
}

export interface ImageWorkspace {
  rootImageId: string
  productId: string
  messageId: string | null
  versions: ShellImageLike[]
}

export function sourceProductImageId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const value = (meta as Record<string, unknown>).source_product_image_id
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function createdAtMs(image: ShellImageLike): number {
  return image.created_at ? Date.parse(image.created_at) : 0
}

/**
 * One workspace per independent generate. Edits/enhances join the parent
 * generate via source_product_image_id or a shared message_id.
 * Never group unrelated generates by product/offer.
 */
export function buildImageWorkspaces(
  images: ShellImageLike[],
  artifacts: ImageWorkspaceArtifactLike[] = []
): ImageWorkspace[] {
  const extra = artifacts
    .map((artifact) => artifact.product_image)
    .filter((image): image is ShellImageLike => Boolean(image?.id && image.image_url))
  const byId = new Map<string, ShellImageLike>()
  for (const image of [...images, ...extra]) {
    if (!image.id || !image.image_url || !isGeneratedOfferImage(image)) continue
    const previous = byId.get(image.id)
    if (!previous || createdAtMs(image) >= createdAtMs(previous)) byId.set(image.id, image)
  }

  const parent = new Map<string, string>()
  const setParent = (childId: string, parentId: string) => {
    if (!childId || !parentId || childId === parentId) return
    if (!byId.has(childId) || !byId.has(parentId)) return
    parent.set(childId, parentId)
  }

  for (const artifact of artifacts) {
    if (artifact.artifact_type && artifact.artifact_type !== 'image') continue
    const childId = artifact.product_image_id || artifact.product_image?.id
    const sourceId = sourceProductImageId(artifact.action_metadata)
    if (childId && sourceId) setParent(childId, sourceId)
  }

  const byMessage = new Map<string, string[]>()
  for (const image of byId.values()) {
    if (!image.message_id) continue
    const group = byMessage.get(image.message_id) || []
    group.push(image.id)
    byMessage.set(image.message_id, group)
  }
  for (const group of byMessage.values()) {
    if (group.length < 2) continue
    const oldest = [...group].sort((a, b) => {
      const delta = createdAtMs(byId.get(a)!) - createdAtMs(byId.get(b)!)
      return delta !== 0 ? delta : a.localeCompare(b)
    })[0]
    for (const id of group) setParent(id, oldest)
  }

  const findRoot = (id: string): string => {
    let current = id
    const seen: string[] = []
    while (parent.has(current) && !seen.includes(current)) {
      seen.push(current)
      current = parent.get(current)!
    }
    if (parent.has(current) && seen.includes(current)) {
      const cycleStart = seen.indexOf(current)
      const cycle = [...new Set(seen.slice(cycleStart))]
      return cycle.sort((a, b) => {
        const delta = createdAtMs(byId.get(a)!) - createdAtMs(byId.get(b)!)
        return delta !== 0 ? delta : a.localeCompare(b)
      })[0]
    }
    return current
  }

  const grouped = new Map<string, ShellImageLike[]>()
  for (const image of byId.values()) {
    const rootId = findRoot(image.id)
    const list = grouped.get(rootId) || []
    list.push(image)
    grouped.set(rootId, list)
  }

  return [...grouped.entries()].map(([rootImageId, versions]) => {
    const ordered = [...versions].sort((a, b) => {
      const delta = createdAtMs(a) - createdAtMs(b)
      return delta !== 0 ? delta : a.id.localeCompare(b.id)
    })
    const root = byId.get(rootImageId) || ordered[0]
    return {
      rootImageId: root.id,
      productId: root.product_id,
      messageId: root.message_id || ordered.find((version) => version.message_id)?.message_id || null,
      versions: ordered,
    }
  })
}

export function workspaceForImage(
  workspaces: ImageWorkspace[],
  imageId: string | null | undefined
): ImageWorkspace | undefined {
  if (!imageId) return undefined
  return workspaces.find((workspace) => workspace.versions.some((version) => version.id === imageId))
}

export function isImageWorkspaceAnchor(
  imageId: string | null | undefined,
  workspaces: ImageWorkspace[]
): boolean {
  if (!imageId) return false
  const workspace = workspaceForImage(workspaces, imageId)
  if (!workspace) return true
  return workspace.rootImageId === imageId
}

export function latestGeneratedPerWorkspace(workspaces: ImageWorkspace[]): ShellImageLike[] {
  return workspaces
    .map((workspace) => workspace.versions[workspace.versions.length - 1])
    .filter((image): image is ShellImageLike => Boolean(image))
    .sort((a, b) => createdAtMs(b) - createdAtMs(a))
}

/** Prefer product refs over context; exclude generated outputs. Max 4 IDs. */
export function selectProductReferenceImageIds(
  images: Array<{
    id: string
    kind?: string | null
    created_at?: string
    message_id?: string | null
  }>,
  max = 4,
  options?: { includeContext?: boolean }
): string[] {
  const includeContext = options?.includeContext !== false
  const refs = images.filter((img) => {
    if (isGeneratedOfferImage(img)) return false
    if (!includeContext && img.kind === 'context') return false
    return true
  })
  const byRecency = [...refs].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0
    const tb = b.created_at ? Date.parse(b.created_at) : 0
    return tb - ta
  })
  const products = byRecency.filter((img) => !img.kind || img.kind === 'product')
  const contexts = includeContext ? byRecency.filter((img) => img.kind === 'context') : []
  return [...products, ...contexts].slice(0, max).map((img) => img.id)
}

/** Order mixed artifacts by ordinal ascending. */
export function sortArtifactsByOrdinal<T extends { ordinal: number }>(artifacts: T[]): T[] {
  return [...artifacts].sort((a, b) => a.ordinal - b.ordinal)
}
