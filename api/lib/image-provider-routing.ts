/**
 * Central image provider routing. Easy to adjust + unit-test without hunting call sites.
 *
 * Policy (product-locked):
 * - Single generate / post: default Grok Imagine (manual Nano still allowed)
 * - Edit + enhance: Grok Imagine (admin gpt-image-2 only override)
 * - Carousel: Gemini Nano Banana Pro
 */

export type ImageAppModel = 'nano-banana' | 'nano-banana-pro' | 'grok-imagine' | 'gpt-image-2'

export type ImageRouteAction =
  | 'generate'
  | 'edit'
  | 'enhance'
  | 'post'
  | 'poll'
  | 'carousel'

export const IMAGE_PROVIDER_POLICY = {
  defaultGenerate: 'grok-imagine' as const,
  editEnhance: 'grok-imagine' as const,
  carousel: 'nano-banana-pro' as const,
  allowManualGenerateAlternate: true,
  allowAdminGptImage2: true,
}

export function resolveImageModelForAction(options: {
  action: ImageRouteAction | string | null | undefined
  requested?: string | null
}): ImageAppModel {
  const action = (options.action || 'generate').toLowerCase()
  const requested = (options.requested || '').trim().toLowerCase()

  if (action === 'carousel') return IMAGE_PROVIDER_POLICY.carousel

  if (action === 'edit' || action === 'enhance') {
    if (requested === 'gpt-image-2' && IMAGE_PROVIDER_POLICY.allowAdminGptImage2) {
      return 'gpt-image-2'
    }
    return IMAGE_PROVIDER_POLICY.editEnhance
  }

  if (requested === 'nano-banana' || requested === 'nano-banana-pro' || requested === 'grok-imagine') {
    return requested
  }
  if (requested === 'gpt-image-2' && IMAGE_PROVIDER_POLICY.allowAdminGptImage2) {
    return 'gpt-image-2'
  }
  return IMAGE_PROVIDER_POLICY.defaultGenerate
}
