/**
 * Resolve canvas vs layout aspect for /api/generate-image post mode.
 * Chat-shell 1:1 must not leave prompt builders on 9:16 story layout.
 */

export type PostLayoutAspect = '9:16' | '3:4'
export type PostCanvasAspect = '9:16' | '3:4' | '1:1'

export function resolvePostModeAspect(options: {
  aspectRatio?: string | null
  isProductMode: boolean
  isLogoMode: boolean
  hasSessionId: boolean
}): {
  canvas: PostCanvasAspect
  /** Aspect passed into catalog prompt builders that only know 9:16 | 3:4. */
  layout: PostLayoutAspect
  shellSquare: boolean
} {
  const raw = options.aspectRatio || '9:16'
  const wantsSquare = raw === '1:1'
  const shellSquare =
    options.hasSessionId
    && wantsSquare
    && !options.isLogoMode

  if (options.isLogoMode) {
    return { canvas: '1:1', layout: '3:4', shellSquare: false }
  }

  if (wantsSquare && (options.isProductMode || shellSquare)) {
    // Square canvas: never feed 9:16 story layout into builders.
    return { canvas: '1:1', layout: '3:4', shellSquare }
  }

  if (raw === '3:4') {
    return { canvas: '3:4', layout: '3:4', shellSquare: false }
  }

  return { canvas: '9:16', layout: '9:16', shellSquare: false }
}
