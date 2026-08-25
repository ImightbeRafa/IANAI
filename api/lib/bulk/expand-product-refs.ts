import { checkUsageLimit, incrementUsage } from '../auth.js'
import { runGrokImageGenerate } from '../grok-image-generate.js'
import { logApiUsage } from '../usage-logger.js'
import { listProductRefUrls, saveExpandedProductRef } from './store.js'
import { imageCreditsEach } from './quotes.js'
import type { ExpandedProductRef } from './types.js'

export function countExpandNeeded(
  existingCount: number,
  minDesired = 2,
  maxExpand = 3
): number {
  const existing = Math.max(0, Math.floor(existingCount))
  if (existing >= minDesired) return 0
  return Math.min(maxExpand, Math.max(1, minDesired - existing + 1))
}

const LIFESTYLE_SCENES = [
  'hands using the real product in warm daylight, candid lifestyle, no fake logo text',
  'product on a lived-in surface (nightstand or desk), natural mess, photoreal',
  'person in context holding the product mid-routine, documentary feel',
]

export async function expandProductRefs(options: {
  userId: string
  userEmail?: string | null
  offerId: string
  brandName: string
  offerName: string
  packId: string
  imageModel?: string | null
  apiKey: string
  existingUrls?: string[]
}): Promise<{ refs: string[]; expanded: ExpandedProductRef[] }> {
  const existing = options.existingUrls ?? await listProductRefUrls(options.userId, options.offerId)
  const needed = countExpandNeeded(existing.length)
  if (needed === 0) return { refs: existing, expanded: [] }

  const expanded: ExpandedProductRef[] = []
  const refs = [...existing]
  for (let i = 0; i < needed; i += 1) {
    const generationId = `${options.packId}-expand-${i + 1}`
    const limit = await checkUsageLimit(options.userId, 'image', {
      imageModel: options.imageModel || 'grok-imagine',
    })
    if (!limit.allowed) break
    try {
      const generated = await runGrokImageGenerate({
        apiKey: options.apiKey,
        prompt: [
          `Alternate lifestyle product reference for ${options.brandName}`,
          `featuring ${options.offerName}`,
          LIFESTYLE_SCENES[i % LIFESTYLE_SCENES.length],
          'Photoreal, match product fidelity if a ref is attached, no invented branding',
        ].join('. '),
        aspectRatio: '4:5',
        referenceImageUrls: refs.slice(0, 2),
      })
      const saved = await saveExpandedProductRef({
        userId: options.userId,
        offerId: options.offerId,
        imageDataUrl: generated.imageDataUrl,
        label: `Bulk lifestyle ref ${i + 1}`,
      })
      const incrementResult = await incrementUsage(options.userId, 'image', {
        generationId,
        imageModel: options.imageModel || 'grok-imagine',
      })
      if (incrementResult?.creditsError) {
        throw new Error(`Credit charge failed: ${incrementResult.creditsError}`)
      }
      await logApiUsage({
        userId: options.userId,
        userEmail: options.userEmail || undefined,
        feature: 'image',
        model: generated.providerModel,
        success: true,
        costOverrideUsd: generated.estimatedCostUsd,
        generationId,
        source: 'web',
        metadata: { action: 'bulk_expand_product_ref', packId: options.packId },
      })
      refs.push(saved.imageUrl)
      expanded.push({
        imageUrl: saved.imageUrl,
        productImageId: saved.productImageId,
        charged: incrementResult?.creditsCharged ?? imageCreditsEach(options.imageModel),
        generationId,
      })
    } catch (err) {
      console.warn('expandProductRefs item failed:', err)
    }
  }
  return { refs, expanded }
}
