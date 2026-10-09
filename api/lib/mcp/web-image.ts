/**
 * MCP ↔ web image bridge: one function that makes the MCP image tools call the same Grok post
 * flow as the web app (`api/lib/web-post-image.ts`), feeding it the brand kit, the offer and the
 * copy, then running the free local post-checks (fidelity_warning + safety-net QA).
 * Warning only: nothing here blocks a result, retries, or changes credits.
 */
import { readOfferAdProfile } from '../adpack/offer-profile.js'
import { reframeToRatio, resolveImageRatio } from '../image-ratios.js'
import type { ProductCreativeRow } from '../product-creative-rules.js'
import { runWebPostGrokImage, type WebPostGrokImageResult } from '../web-post-image.js'
import { checkGeneratedProductFidelity, runMcpImageQa, type FidelityCheckResult, type FidelityWarning, type McpImageQa } from './image-postcheck.js'
import type { McpBrandContext } from './user-tools.js'

export type OfferLock = { lockProductAppearance?: boolean; immutableAttributes?: string[] }

/** products.ad_profile → product lock (lockProductAppearance / immutableAttributes). */
export function offerLockFromRow(row: Record<string, unknown> | null | undefined): OfferLock {
  const profile = readOfferAdProfile(row?.ad_profile)
  if (!profile) return {}
  return {
    lockProductAppearance: profile.lockProductAppearance === true,
    immutableAttributes: [...(profile.immutableAttributes ?? [])],
  }
}

export function productRowFromOffer(offer: McpBrandContext['offers'][number] | undefined): ProductCreativeRow | null {
  if (!offer) return null
  return {
    name: offer.name,
    product_description: offer.productDescription ?? null,
    technical_specs: offer.technicalSpecs ?? null,
    product_category: offer.type ?? null,
    // The web route locks `products.offer` as the display price; MCP offers expose it as `price`.
    offer: offer.price ?? null,
    price_range: offer.priceRange ?? null,
  }
}

export type WebStyleImageInput = {
  apiKey: string
  ctx: McpBrandContext
  offerId: string
  /** Requested ratio (any supported one; 4:5 is generated at 3:4 and reframed). */
  aspectRatio: string
  language?: 'es' | 'en'
  /** Guion / on-image copy. */
  copy?: string
  scene?: string
  guidePrompt?: string
  /** Extra context lines (e.g. angle niche for bulk). */
  extraContext?: string[]
  postStyle?: string
  textDensity?: string
  ctaStrength?: unknown
  productUrls: string[]
  supportUrls?: string[]
  /** 'none' skips kit reference auto-append (web `referenceMode:'none'`). */
  referenceMode?: 'use' | 'none'
  lock?: OfferLock
}

export type WebStyleImageOutput = {
  generated: {
    imageDataUrl: string
    providerModel: string
    estimatedCostUsd: number
    resolution: string
    quality: string
    aspectRatio: string
    mode: string
    lockApplied: boolean
  }
  prompt: string
  request: WebPostGrokImageResult['request']
  referenceCount: number
  retriedWithClamp: boolean
  copySource: 'copy' | 'guidePrompt' | 'offer_default'
  fidelityCheck: FidelityCheckResult
  fidelity_warning?: FidelityWarning
  qa: McpImageQa
}

function cleanCopy(value: string | undefined): string {
  return (value || '').replace(/\s+\n/g, '\n').trim().slice(0, 900)
}

/** The businessContext the web chat sends: scene + offer description/differentiator + extra lines. */
export function buildMcpBusinessContext(input: {
  language: 'es' | 'en'
  scene?: string
  offer?: McpBrandContext['offers'][number]
  extraContext?: string[]
  guidePrompt?: string
  copySource?: 'copy' | 'guidePrompt' | 'offer_default'
}): string {
  const { language, offer } = input
  return [
    input.scene ? `${language === 'en' ? 'Scene' : 'Escena'}: ${input.scene}` : '',
    offer?.productDescription || '',
    offer?.differentiation ? `${language === 'en' ? 'Differentiator' : 'Diferencial'}: ${offer.differentiation}` : '',
    ...(input.extraContext || []),
    input.guidePrompt && input.copySource !== 'guidePrompt' ? `${language === 'en' ? 'Direction' : 'Dirección'}: ${input.guidePrompt}` : '',
  ].filter(Boolean).join('. ').slice(0, 700)
}

export async function generateWebStyleImage(input: WebStyleImageInput): Promise<WebStyleImageOutput> {
  const { ctx } = input
  const offer = ctx.offers.find((o) => o.id === input.offerId)
  const kit = ctx.brandKit
  const ratioPlan = resolveImageRatio(input.aspectRatio)
  const language = input.language === 'en' ? 'en' : 'es'

  let copy = cleanCopy(input.copy)
  let copySource: WebStyleImageOutput['copySource'] = 'copy'
  if (!copy) {
    copy = cleanCopy(input.guidePrompt)
    copySource = 'guidePrompt'
  }
  if (!copy) {
    copy = [offer?.name, offer?.price].filter(Boolean).join(' — ')
    copySource = 'offer_default'
  }
  const businessContext = buildMcpBusinessContext({
    language,
    scene: input.scene,
    offer,
    extraContext: input.extraContext,
    guidePrompt: input.guidePrompt,
    copySource,
  })

  const useKitRefs = input.referenceMode !== 'none'
  const grok = await runWebPostGrokImage({
    apiKey: input.apiKey,
    aspectRatio: ratioPlan.generateAt,
    language,
    postStyle: input.postStyle || 'venta-directa',
    textDensity: input.textDensity || 'hard',
    ctaStrength: input.ctaStrength,
    copy,
    businessContext,
    palette: [kit?.primaryColor, kit?.secondaryColor, kit?.accentColor].filter((c): c is string => Boolean(c)),
    brandVoice: kit?.brandVoice,
    brandVisual: kit?.visualStyleNotes,
    brandName: ctx.brand.name,
    brandKitId: kit?.id ?? null,
    offerId: input.offerId,
    productRow: productRowFromOffer(offer),
    productUrls: input.productUrls,
    kitReferenceUrls: useKitRefs ? kit?.referenceImages || [] : [],
    supportUrls: input.supportUrls || [],
    logoUrl: kit?.logoUrl || null,
    lockProductAppearance: input.lock?.lockProductAppearance,
    immutableAttributes: input.lock?.immutableAttributes,
  })

  let imageDataUrl = grok.imageDataUrl
  let aspectRatio = grok.aspectRatio
  if (ratioPlan.needsReframe && imageDataUrl.startsWith('data:')) {
    const bytes = Buffer.from(imageDataUrl.slice(imageDataUrl.indexOf(',') + 1), 'base64')
    const framed = await reframeToRatio(bytes, ratioPlan.requested, { mode: 'cover', format: 'jpeg' })
    imageDataUrl = `data:image/jpeg;base64,${framed.bytes.toString('base64')}`
    aspectRatio = ratioPlan.requested
  }

  // Free local post-checks — warning only.
  const fidelityCheck = grok.lockApplied
    ? await checkGeneratedProductFidelity({ referenceDataUrls: grok.productReferenceDataUrls, generatedDataUrl: imageDataUrl })
    : ({ status: 'skipped', reason: 'no product reference attached' } as FidelityCheckResult)
  const qa = await runMcpImageQa({
    generatedDataUrl: imageDataUrl,
    requestedRatio: ratioPlan.requested,
    copyRequested: Boolean(copy),
    logoAttached: Boolean(kit?.logoUrl),
    logoExpected: Boolean(kit),
  })
  return {
    generated: {
      imageDataUrl,
      providerModel: grok.providerModel,
      estimatedCostUsd: grok.estimatedCostUsd,
      resolution: grok.resolution,
      quality: grok.quality,
      aspectRatio,
      mode: grok.mode,
      lockApplied: grok.lockApplied,
    },
    prompt: grok.prompt,
    request: grok.request,
    referenceCount: grok.referenceCount,
    retriedWithClamp: grok.retriedWithClamp,
    copySource,
    fidelityCheck,
    ...(fidelityCheck.status === 'warning' ? { fidelity_warning: fidelityCheck.warning } : {}),
    qa,
  }
}

/** Compact, result-safe summary of the post-check (no image bytes). */
export function postCheckSummary(out: Pick<WebStyleImageOutput, 'fidelityCheck' | 'fidelity_warning' | 'qa' | 'copySource' | 'referenceCount' | 'retriedWithClamp'>): Record<string, unknown> {
  return {
    ...(out.fidelity_warning ? { fidelity_warning: out.fidelity_warning } : {}),
    fidelityCheck: out.fidelityCheck.status === 'skipped'
      ? { status: 'skipped', reason: out.fidelityCheck.reason }
      : { status: out.fidelityCheck.status, score: out.fidelityCheck.score },
    qa: out.qa,
    copySource: out.copySource,
    referenceCount: out.referenceCount,
    retriedWithClamp: out.retriedWithClamp,
  }
}
