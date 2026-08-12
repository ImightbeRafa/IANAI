/**
 * Pure helpers for chat-shell Images tab + optimize-for-post (C3).
 */

export const CHAT_SHELL_IMAGE_KINDS = ['product', 'context', 'generated'] as const
export type ChatShellImageKind = (typeof CHAT_SHELL_IMAGE_KINDS)[number]

export interface ShellImageLike {
  id: string
  product_id: string
  session_id?: string | null
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
      ? 'Densidad HARD: minimo texto (1 headline corto, 1-2 micro-puntos, 1 CTA).'
      : 'HARD density: minimal text (1 short headline, 1-2 micro-points, 1 CTA).',
    medium: es
      ? 'Densidad MEDIA: 1 headline, 2-3 puntos, 1 CTA. Prioriza aire visual.'
      : 'MEDIUM density: 1 headline, 2-3 points, 1 CTA. Prioritize breathing room.',
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

/** Order mixed artifacts by ordinal ascending. */
export function sortArtifactsByOrdinal<T extends { ordinal: number }>(artifacts: T[]): T[] {
  return [...artifacts].sort((a, b) => a.ordinal - b.ordinal)
}
