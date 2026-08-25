import { randomUUID } from 'node:crypto'
import { checkUsageLimit, incrementUsage } from '../auth.js'
import { generationUuidFromApproval } from '../credits/generation-id.js'
import { GROK_TEXT_MODEL } from '../grok-models.js'
import { runGrokImageGenerate } from '../grok-image-generate.js'
import { logApiUsage, estimateTokens } from '../usage-logger.js'
import type { McpArtifactStore } from '../mcp/artifact-store.js'
import type { McpBrandContext } from '../mcp/user-tools.js'
import { generateScriptForAngle } from './generate-script.js'
import { expandProductRefs } from './expand-product-refs.js'
import { imageCreditsEach, SCRIPT_CREDITS_EACH } from './quotes.js'
import { findStyleDna } from './style-dna.js'
import type {
  AngleBoardItem,
  BulkLanguage,
  BulkPostItem,
  BulkScriptItem,
  ExpandedProductRef,
  StyleDna,
} from './types.js'

function xaiKey(): string {
  const key = process.env.XAI_API_KEY || process.env.GROK_API_KEY || ''
  if (!key) throw new Error('XAI_API_KEY not configured')
  return key
}

export type BulkRunContext = {
  user: { id: string; email?: string | null }
  brandId: string
  offerId: string
  sessionId?: string
  language: BulkLanguage
  ctx: McpBrandContext
  artifactStore: McpArtifactStore
  source: 'mcp' | 'web'
  appOrigin?: string
  packId?: string
  guidePrompt?: string
  scene?: string
  aspectRatio?: string
  recentSummaries?: string[]
  styleDnas?: StyleDna[]
}

const POST_APPROACHES = [
  'product-hero in the niche habitat',
  'in-use candid, buyer hands, documentary',
  'before-the-night / before-the-shift ritual',
  'social setting where the niche actually buys',
  'tight detail + lifestyle wash',
]

export async function runBulkScripts(options: {
  runtime: BulkRunContext
  angles: AngleBoardItem[]
}): Promise<{
  packId: string
  sessionId: string
  items: BulkScriptItem[]
  succeeded: number
  charged: number
}> {
  const { runtime, angles } = options
  const packId = runtime.packId || randomUUID()
  const offer = runtime.ctx.offers.find((item) => item.id === runtime.offerId)
  const offerName = offer?.name || runtime.offerId
  const { sessionId } = await runtime.artifactStore.ensureExecuteSession({
    userId: runtime.user.id,
    brandId: runtime.brandId,
    offerId: runtime.offerId,
    sessionId: runtime.sessionId,
    title: `Bulk pack — ${offerName}`,
  })

  const items: BulkScriptItem[] = []
  for (let i = 0; i < angles.length; i += 1) {
    const angle = angles[i]
    const generationId = generationUuidFromApproval(packId, `script:${i + 1}`)
    const limit = await checkUsageLimit(runtime.user.id, 'script')
    if (!limit.allowed) {
      items.push({
        angleId: angle.id,
        title: angle.title,
        content: '',
        charged: 0,
        generationId,
        error: 'Script credit limit reached',
      })
      continue
    }
    try {
      const script = await generateScriptForAngle({
        apiKey: xaiKey(),
        language: runtime.language,
        brandName: runtime.ctx.brand.name,
        offerName,
        brandVoice: runtime.ctx.brandKit?.brandVoice,
        audience: runtime.ctx.brandKit?.targetAudience || runtime.ctx.brand.icpDescription,
        angle,
        recentSummaries: runtime.recentSummaries,
        guidePrompt: runtime.guidePrompt,
      })
      const saved = await runtime.artifactStore.saveScriptArtifact({
        userId: runtime.user.id,
        brandId: runtime.brandId,
        offerId: runtime.offerId,
        sessionId,
        title: `${angle.niche} — ${script.title}`,
        content: script.content,
        approvalRequestId: packId,
      })
      await logApiUsage({
        userId: runtime.user.id,
        userEmail: runtime.user.email || undefined,
        feature: 'script',
        model: GROK_TEXT_MODEL,
        inputTokens: estimateTokens(script.content),
        outputTokens: estimateTokens(script.content),
        success: true,
        generationId,
        source: runtime.source,
        metadata: {
          action: 'bulk_script',
          packId,
          angleId: angle.id,
          niche: angle.niche,
        },
      })
      try {
        const incrementResult = await incrementUsage(runtime.user.id, 'script', { generationId })
        if (incrementResult?.creditsError) {
          throw new Error(`Credit charge failed: ${incrementResult.creditsError}`)
        }
        items.push({
          angleId: angle.id,
          title: script.title,
          content: script.content,
          scriptId: saved.scriptId,
          messageId: saved.messageId,
          charged: incrementResult?.creditsCharged ?? SCRIPT_CREDITS_EACH,
          generationId,
        })
      } catch (chargeErr) {
        // Artifact already in library — keep ids so reclaim can charge-only / surface once.
        items.push({
          angleId: angle.id,
          title: script.title,
          content: script.content,
          scriptId: saved.scriptId,
          messageId: saved.messageId,
          charged: 0,
          generationId,
          error: chargeErr instanceof Error ? chargeErr.message : 'Credit charge failed',
        })
      }
    } catch (err) {
      items.push({
        angleId: angle.id,
        title: angle.title,
        content: '',
        charged: 0,
        generationId,
        error: err instanceof Error ? err.message : 'Script generate failed',
      })
    }
  }

  return {
    packId,
    sessionId,
    items,
    succeeded: items.filter((item) => !item.error && item.scriptId).length,
    charged: items.reduce((sum, item) => sum + item.charged, 0),
  }
}

export async function runBulkPosts(options: {
  runtime: BulkRunContext
  angles: AngleBoardItem[]
  scripts?: Array<{ angleId: string; title?: string; content?: string }>
  imageModel?: string | null
  styleDnaId?: string | null
}): Promise<{
  packId: string
  sessionId: string
  items: BulkPostItem[]
  expanded: ExpandedProductRef[]
  succeeded: number
  charged: number
}> {
  const { runtime, angles } = options
  const packId = runtime.packId || randomUUID()
  const offer = runtime.ctx.offers.find((item) => item.id === runtime.offerId)
  const offerName = offer?.name || runtime.offerId
  const imageModel = options.imageModel || 'grok-imagine'
  const dna = findStyleDna(runtime.styleDnas || [], options.styleDnaId)
  const { sessionId } = await runtime.artifactStore.ensureExecuteSession({
    userId: runtime.user.id,
    brandId: runtime.brandId,
    offerId: runtime.offerId,
    sessionId: runtime.sessionId,
    title: `Bulk posts — ${offerName}`,
  })

  const expandedPack = await expandProductRefs({
    userId: runtime.user.id,
    userEmail: runtime.user.email,
    offerId: runtime.offerId,
    brandName: runtime.ctx.brand.name,
    offerName,
    packId,
    imageModel,
    apiKey: xaiKey(),
  })
  const refs = [
    ...expandedPack.refs,
    ...(dna?.referenceUrls || []),
    runtime.ctx.brandKit?.logoUrl || '',
  ].filter(Boolean)

  const items: BulkPostItem[] = []
  for (let i = 0; i < angles.length; i += 1) {
    const angle = angles[i]
    const generationId = generationUuidFromApproval(packId, `image:${i + 1}`)
    const approach = POST_APPROACHES[i % POST_APPROACHES.length]
    const script = options.scripts?.find((row) => row.angleId === angle.id)
    const rotated = refs.length ? [refs[i % refs.length], refs[(i + 1) % refs.length]].filter(Boolean) : []
    const limit = await checkUsageLimit(runtime.user.id, 'image', { imageModel })
    if (!limit.allowed) {
      items.push({
        angleId: angle.id,
        charged: 0,
        generationId,
        approach,
        error: 'Image credit limit reached',
      })
      continue
    }
    try {
      const prompt = [
        `Photoreal lifestyle ad still for ${runtime.ctx.brand.name}`,
        `featuring ${offerName}`,
        `Buyer niche: ${angle.niche}. ${angle.whyItBuys}`,
        `Visual approach: ${approach}`,
        runtime.scene ? `Requested scene: ${runtime.scene}` : '',
        `Hook style: ${angle.hookStyle}`,
        script?.content ? `Script cue: ${script.content.slice(0, 280)}` : '',
        dna ? `Style DNA (${dna.kind}): ${dna.notes || dna.name}` : '',
        runtime.ctx.brandKit?.visualStyleNotes ? `Brand visual: ${runtime.ctx.brandKit.visualStyleNotes}` : '',
        runtime.guidePrompt ? `Additional user direction: ${runtime.guidePrompt}` : '',
        'No fake logos or unreadable text. Match product fidelity from refs.',
      ].filter(Boolean).join('. ')
      const generated = await runGrokImageGenerate({
        apiKey: xaiKey(),
        prompt,
        aspectRatio: runtime.aspectRatio || '9:16',
        referenceImageUrls: rotated.slice(0, 3),
      })
      const saved = await runtime.artifactStore.saveImageArtifact({
        userId: runtime.user.id,
        brandId: runtime.brandId,
        offerId: runtime.offerId,
        sessionId,
        imageDataUrl: generated.imageDataUrl,
        label: `${angle.niche} post`,
        approvalRequestId: packId,
        metadata: {
          packId,
          angleId: angle.id,
          approach,
          styleDnaId: dna?.id || null,
          resolution: generated.resolution,
          quality: generated.quality,
        },
      })
      await logApiUsage({
        userId: runtime.user.id,
        userEmail: runtime.user.email || undefined,
        feature: 'image',
        model: generated.providerModel,
        success: true,
        costOverrideUsd: generated.estimatedCostUsd,
        generationId,
        source: runtime.source,
        metadata: { action: 'bulk_post', packId, angleId: angle.id, approach },
      })
      try {
        const incrementResult = await incrementUsage(runtime.user.id, 'image', {
          generationId,
          imageModel,
        })
        if (incrementResult?.creditsError) {
          throw new Error(`Credit charge failed: ${incrementResult.creditsError}`)
        }
        items.push({
          angleId: angle.id,
          scriptTitle: script?.title,
          imageUrl: saved.imageUrl,
          productImageId: saved.productImageId,
          messageId: saved.messageId,
          charged: incrementResult?.creditsCharged ?? imageCreditsEach(imageModel),
          generationId,
          approach,
        })
      } catch (chargeErr) {
        items.push({
          angleId: angle.id,
          scriptTitle: script?.title,
          imageUrl: saved.imageUrl,
          productImageId: saved.productImageId,
          messageId: saved.messageId,
          charged: 0,
          generationId,
          approach,
          error: chargeErr instanceof Error ? chargeErr.message : 'Credit charge failed',
        })
      }
    } catch (err) {
      items.push({
        angleId: angle.id,
        charged: 0,
        generationId,
        approach,
        error: err instanceof Error ? err.message : 'Image generate failed',
      })
    }
  }

  const expandCharged = expandedPack.expanded.reduce((sum, item) => sum + item.charged, 0)
  return {
    packId,
    sessionId,
    items,
    expanded: expandedPack.expanded,
    succeeded: items.filter((item) => !item.error && item.imageUrl).length,
    charged: items.reduce((sum, item) => sum + item.charged, 0) + expandCharged,
  }
}

export function deepLinkForPack(appOrigin: string | undefined, brandId: string, sessionId: string, packId: string): string {
  const origin = (appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}&pack=${encodeURIComponent(packId)}`
}
