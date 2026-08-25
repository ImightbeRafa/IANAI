/**
 * GUIDE packs — prompts/context for Grok’s own generation (no Advance credits).
 */

import type { McpAuthUser, McpBrandContext, McpDbClient } from './user-tools.js'
import { mcpGetBrandContext } from './user-tools.js'

function offerLine(offers: McpBrandContext['offers']): string {
  if (!offers.length) return '(no offers yet)'
  return offers.map((o) => [
    `- ${o.name}${o.type ? ` (${o.type})` : ''} [${o.id}]`,
    o.price ? `Price: ${o.price}` : '',
    o.doNotClaim?.length ? `Do not claim: ${o.doNotClaim.join('; ')}` : '',
  ].filter(Boolean).join(' — ')).join('\n')
}

function kitBlock(kit: McpBrandContext['brandKit']): string {
  if (!kit) return '(no brand kit yet — ask user or run workspace_save_url_context)'
  return [
    `Kit: ${kit.name} [${kit.id}]`,
    kit.tagline ? `Tagline: ${kit.tagline}` : null,
    kit.brandVoice ? `Voice: ${kit.brandVoice}` : null,
    kit.toneKeywords?.length ? `Tone: ${kit.toneKeywords.join(', ')}` : null,
    kit.targetAudience ? `Audience: ${kit.targetAudience}` : null,
    kit.primaryColor || kit.secondaryColor || kit.accentColor
      ? `Colors: ${[kit.primaryColor, kit.secondaryColor, kit.accentColor].filter(Boolean).join(' / ')}`
      : null,
    kit.fontPrimary ? `Font: ${kit.fontPrimary}` : null,
    kit.logoUrl ? `Logo: ${kit.logoUrl}` : null,
    kit.visualStyleNotes ? `Visual: ${kit.visualStyleNotes}` : null,
    kit.referenceImages?.length ? `Refs: ${kit.referenceImages.slice(0, 5).join(' | ')}` : null,
  ].filter(Boolean).join('\n')
}

export async function mcpGuideBrandPack(
  db: McpDbClient,
  user: McpAuthUser,
  brandId: string
): Promise<Record<string, unknown>> {
  const ctx = await mcpGetBrandContext(db, user, brandId)
  return {
    mode: 'GUIDE',
    consumesAdvanceCredits: false,
    brand: ctx.brand,
    offers: ctx.offers,
    brandKit: ctx.brandKit,
    latestGuideIntake: ctx.latestGuideIntake,
    packMarkdown: [
      `# Brand pack — ${ctx.brand.name}`,
      kitBlock(ctx.brandKit),
      '',
      '## Offers',
      offerLine(ctx.offers),
      ctx.brand.icpDescription ? `\nICP: ${ctx.brand.icpDescription}` : '',
      ctx.brand.location ? `Location: ${ctx.brand.location}` : '',
    ].filter(Boolean).join('\n'),
  }
}

export async function mcpGuideScript(
  db: McpDbClient,
  user: McpAuthUser,
  args: { brandId: string; offerId?: string; goal?: string; language?: string }
): Promise<Record<string, unknown>> {
  const ctx = await mcpGetBrandContext(db, user, args.brandId)
  const offer = args.offerId
    ? ctx.offers.find((o) => o.id === args.offerId)
    : ctx.offers[0]
  const language = args.language === 'en' ? 'en' : 'es'
  const goal = (args.goal || 'winning short-form ad script').trim()
  const doNotClaim = [
    ...(offer?.doNotClaim || []),
    ...(ctx.brandKit?.forbiddenPhrases || []),
  ]
  const prompt = language === 'en'
    ? [
        `Write a high-converting short-form ad script for ${ctx.brand.name}.`,
        offer ? `Offer focus: ${offer.name}.` : 'Use the brand’s primary offer if known.',
        offer?.price ? `Known price: ${offer.price}.` : '',
        `Goal: ${goal}.`,
        ctx.brandKit?.brandVoice ? `Voice: ${ctx.brandKit.brandVoice}.` : '',
        ctx.brandKit?.targetAudience ? `Audience: ${ctx.brandKit.targetAudience}.` : '',
        doNotClaim.length ? `Do not claim: ${doNotClaim.join('; ')}.` : '',
        'Structure: Hook / Development / CTA. Keep it spoken and specific. Do not invent fake claims.',
      ].filter(Boolean).join(' ')
    : [
        `Escribe un guion publicitario corto de alta conversión para ${ctx.brand.name}.`,
        offer ? `Oferta: ${offer.name}.` : 'Usa la oferta principal si existe.',
        offer?.price ? `Precio conocido: ${offer.price}.` : '',
        `Objetivo: ${goal}.`,
        ctx.brandKit?.brandVoice ? `Voz: ${ctx.brandKit.brandVoice}.` : '',
        ctx.brandKit?.targetAudience ? `Audiencia: ${ctx.brandKit.targetAudience}.` : '',
        doNotClaim.length ? `No afirmar: ${doNotClaim.join('; ')}.` : '',
        'Estructura: Hook / Desarrollo / CTA. Natural, específico, sin inventar claims.',
      ].filter(Boolean).join(' ')

  return {
    mode: 'GUIDE',
    consumesAdvanceCredits: false,
    instruction: 'Use YOUR Grok text generation with this prompt. Do not call Advance execute_*.',
    language,
    brandId: ctx.brand.id,
    offerId: offer?.id || null,
    price: offer?.price || null,
    doNotClaim,
    prompt,
    brandPackHint: 'Call guide_brand_pack for fuller context if needed.',
  }
}

export async function mcpGuideImage(
  db: McpDbClient,
  user: McpAuthUser,
  args: {
    brandId: string
    offerId?: string
    scene?: string
    aspectRatio?: string
  }
): Promise<Record<string, unknown>> {
  const ctx = await mcpGetBrandContext(db, user, args.brandId)
  const offer = args.offerId
    ? ctx.offers.find((o) => o.id === args.offerId)
    : ctx.offers[0]
  const aspectRatio = args.aspectRatio || '9:16'
  const scene = (args.scene || 'lifestyle product hero, natural light, premium but real').trim()
  const offerRefs = offer && db.listOfferReferenceImages
    ? await db.listOfferReferenceImages(user.id, args.brandId, offer.id)
    : []
  const refs = [
    ...offerRefs,
    ctx.brandKit?.logoUrl,
    ...(ctx.brandKit?.referenceImages || []),
  ].filter(Boolean).slice(0, 5)

  const prompt = [
    `Photoreal lifestyle ad still for ${ctx.brand.name}`,
    offer ? `featuring ${offer.name}` : '',
    scene,
    ctx.brandKit?.visualStyleNotes ? `Style: ${ctx.brandKit.visualStyleNotes}` : '',
    ctx.brandKit?.primaryColor ? `Primary color accent ${ctx.brandKit.primaryColor}` : '',
    'No fake logos or unreadable text. Match product fidelity if a product ref is attached.',
  ].filter(Boolean).join('. ')

  return {
    mode: 'GUIDE',
    consumesAdvanceCredits: false,
    instruction: 'Use YOUR Grok Imagine with this prompt + refs. Do not call Advance execute_*. After generating outside Advance, call workspace_note_generated_outside (no binary upload).',
    brandId: ctx.brand.id,
    offerId: offer?.id || null,
    aspectRatio,
    prompt,
    referenceUrls: refs,
    fidelityRules: [
      'Prefer real product/lifestyle photography look',
      'Do not invent brand marks not in refs',
      'Keep aspect ratio exact',
    ],
  }
}
