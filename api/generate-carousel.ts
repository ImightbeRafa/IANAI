// =============================================
// POST /api/generate-carousel
// Organic carousel (2–10 slides) generator.
// Shared core: api/lib/organic-carousel.ts (also used by MCP execute_carousel_generate).
// Charge only succeeded slides. Frontend persists posts.
// =============================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage, deductBonusImage } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { isCreditsV1Enabled } from './lib/credits/catalog.js'
import {
  GEMINI_CAROUSEL_IMAGE_MODEL,
  VALID_CAROUSEL_ASPECT_RATIOS,
  VALID_CAROUSEL_CTA,
  normalizeCarouselSlideCount,
  normalizeCarouselSubtype,
  quoteCarouselCredits,
  runOrganicCarouselGenerate,
  sanitizeCarouselText,
  sanitizeProductContext,
  type OrganicCarouselResult,
} from './lib/organic-carousel.js'
import type { OrganicAspectRatio } from './data/organic-post-prompts.js'
import type { CTAStrength } from './data/organic-script-prompts.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const user = await requireAuth(req, res)
    if (!user) return

    const rateLimit = checkRateLimit(user.id)
    if (!rateLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' })
    }

    const body = (req.body || {}) as Record<string, unknown>
    const subtype = normalizeCarouselSubtype(body.subtype)
    const slideCount = normalizeCarouselSlideCount(body.slideCount)
    const scriptContent = typeof body.scriptContent === 'string' ? body.scriptContent.trim() : ''
    if (!scriptContent) {
      return res.status(400).json({ error: 'scriptContent is required.' })
    }
    const aspectRatio: OrganicAspectRatio = VALID_CAROUSEL_ASPECT_RATIOS.includes(body.aspectRatio as OrganicAspectRatio)
      ? (body.aspectRatio as OrganicAspectRatio) : '1:1'
    const language: 'en' | 'es' = body.language === 'en' ? 'en' : 'es'
    const ctaStrength: CTAStrength = VALID_CAROUSEL_CTA.includes(body.ctaStrength as CTAStrength)
      ? (body.ctaStrength as CTAStrength) : 'soft'
    const designDirection = sanitizeCarouselText(body.designDirection, 1500)
    const slideDetails = sanitizeCarouselText(body.slideDetails, 3000)
    const previewFirstSlideOnly = body.previewFirstSlideOnly === true
    const productContext = sanitizeProductContext(body.productContext)
    const requiredSlides = previewFirstSlideOnly ? 1 : slideCount

    const usage = await checkUsageLimit(user.id, 'image', {
      imageModel: GEMINI_CAROUSEL_IMAGE_MODEL,
      units: requiredSlides,
    })
    if (!usage.allowed) {
      return res.status(429).json({
        error: usage.creditsRequired
          ? `Need ${usage.creditsRequired} AI credits for this carousel (${requiredSlides} slides).`
          : 'Image limit reached. Upgrade for more.',
        limit: usage.limit,
        remaining: usage.remaining,
        required: usage.creditsRequired ?? requiredSlides,
      })
    }
    if (usage.creditsRequired == null && usage.remaining !== -1 && usage.remaining < requiredSlides) {
      return res.status(429).json({
        error: `This carousel requires ${requiredSlides} image credits, but you only have ${usage.remaining} remaining.`,
        limit: usage.limit,
        remaining: usage.remaining,
        required: requiredSlides,
      })
    }

    const generated: OrganicCarouselResult = await runOrganicCarouselGenerate({
      userId: user.id,
      subtype,
      slideCount,
      scriptContent,
      aspectRatio,
      language,
      brandKitId: typeof body.brandKitId === 'string' ? body.brandKitId : undefined,
      ctaStrength,
      designDirection,
      slideDetails,
      previewFirstSlideOnly,
      productContext,
      productReferenceImages: body.productReferenceImages,
      contextReferenceImages: body.contextReferenceImages,
      carouselReferenceImages: body.carouselReferenceImages,
    })

    let charged = 0
    for (let i = 0; i < generated.succeeded; i++) {
      try {
        const slideGenerationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`
        const inc = await incrementUsage(user.id, 'image', {
          generationId: slideGenerationId,
          imageModel: GEMINI_CAROUSEL_IMAGE_MODEL,
        })
        charged += inc?.creditsCharged ?? (isCreditsV1Enabled() ? 0 : 1)
        if (!isCreditsV1Enabled()) {
          await deductBonusImage(user.id)
        }
      } catch (e) { console.warn('increment usage failed on slide', i, e) }
    }

    await logApiUsage({
      userId: user.id,
      feature: 'image',
      model: 'nano-banana-pro',
      success: generated.succeeded > 0,
      inputTokens: generated.usageTokens.input,
      outputTokens: generated.usageTokens.output,
      thinkingTokens: generated.usageTokens.thinking,
      metadata: {
        kind: 'organic-carousel',
        subtype,
        slideCount,
        succeeded: generated.succeeded,
        aspectRatio,
        previewFirstSlideOnly,
        provider: 'google',
        providerModel: GEMINI_CAROUSEL_IMAGE_MODEL,
        imageSize: '2K',
      },
    })

    return res.status(200).json({
      carouselGroupId: generated.carouselGroupId,
      subtype: generated.subtype,
      totalSlides: generated.totalSlides,
      aspectRatio: generated.aspectRatio,
      language: generated.language,
      ctaStrength: generated.ctaStrength,
      plan: generated.plan,
      slides: generated.slides,
      previewFirstSlideOnly: generated.previewFirstSlideOnly,
      usage: {
        charged: generated.succeeded,
        total: quoteCarouselCredits(requiredSlides),
        creditsCharged: charged,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Carousel generation failed'
    console.error('generate-carousel error:', err)
    if (message.includes('slideCount') || message.includes('subtype') || message.includes('scriptContent')) {
      return res.status(400).json({ error: message })
    }
    return res.status(500).json({ error: message })
  }
}
