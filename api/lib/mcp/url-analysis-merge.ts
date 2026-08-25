/**
 * Fill-only merge of GUIDE site analysis into businesses + brand_kits.
 * Never overwrites non-empty user-authored fields.
 */

import type { SiteAnalysisResult } from '../site-analysis.js'

export type FillOnlyBusinessPatch = {
  location?: string
  shipping_method?: string
  does_shipping?: boolean
  sales_channels?: string[]
  icp_description?: string
}

export type FillOnlyBrandKitPatch = {
  name?: string
  logo_url?: string
  primary_color?: string
  secondary_color?: string
  accent_color?: string
  font_primary?: string
  tagline?: string
  brand_voice?: string
  tone_keywords?: string[]
  must_use_phrases?: string[]
  forbidden_phrases?: string[]
  visual_style_notes?: string
  target_audience?: string
  reference_images?: string[]
}

function isBlank(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asStringArray(value: unknown, limit = 12): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
  return items.length ? items : undefined
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

const CHANNELS = new Set(['website', 'messages', 'physical'])

/** High-risk medical / drug / absolute-claim language — do not auto-stamp into GUIDE kits. */
const HIGH_RISK_CLAIM_RE =
  /\b(glp-?\s*1|semaglutida|ozempic|wegovy|mounjaro|torrente\s+sangu[ií]neo|sin\s+efectos|efectos\s+secundarios|cruelty[-\s]?free|cura\b|milagro|fda\s+approved|aprobado\s+por\s+la\s+fda|pierde\s+\d+\s*kg|garantizado)\b/i

export function isHighRiskMarketingClaim(text: string): boolean {
  return HIGH_RISK_CLAIM_RE.test(text)
}

function filterSafePhrases(phrases: string[] | undefined): {
  safe: string[] | undefined
  heldForReview: string[]
} {
  if (!phrases?.length) return { safe: phrases, heldForReview: [] }
  const safe: string[] = []
  const heldForReview: string[] = []
  for (const phrase of phrases) {
    if (isHighRiskMarketingClaim(phrase)) heldForReview.push(phrase)
    else safe.push(phrase)
  }
  return {
    safe: safe.length ? safe : undefined,
    heldForReview,
  }
}

function asChannels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => CHANNELS.has(item))
  return items.length ? [...new Set(items)] : undefined
}

export function buildFillOnlyBusinessPatch(
  current: Record<string, unknown>,
  analysis: SiteAnalysisResult
): FillOnlyBusinessPatch {
  const facts = analysis.facts
  const patch: FillOnlyBusinessPatch = {}
  const location = asString(facts.location)
  if (location && isBlank(current.location)) patch.location = location
  const shippingMethod = asString(facts.shippingMethod)
  if (shippingMethod && isBlank(current.shipping_method)) patch.shipping_method = shippingMethod
  const doesShipping = asBool(facts.doesShipping)
  if (doesShipping !== undefined && (current.does_shipping == null || current.does_shipping === false) && doesShipping) {
    patch.does_shipping = true
  }
  const channels = asChannels(facts.salesChannels)
  if (channels && isBlank(current.sales_channels)) patch.sales_channels = channels
  const icp = asString(facts.icp)
  if (icp && isBlank(current.icp_description)) patch.icp_description = icp
  return patch
}

export type FillOnlyBrandKitMergeResult = {
  patch: FillOnlyBrandKitPatch
  reviewRequired: boolean
  heldForReview: {
    must_use_phrases?: string[]
    brand_voice?: string
  }
  warnings: string[]
}

export function buildFillOnlyBrandKitPatch(
  current: Record<string, unknown> | null,
  analysis: SiteAnalysisResult,
  fallbackName: string
): FillOnlyBrandKitPatch {
  return buildFillOnlyBrandKitPatchWithReview(current, analysis, fallbackName).patch
}

export function buildFillOnlyBrandKitPatchWithReview(
  current: Record<string, unknown> | null,
  analysis: SiteAnalysisResult,
  fallbackName: string
): FillOnlyBrandKitMergeResult {
  const facts = analysis.facts
  const cur = current || {}
  const patch: FillOnlyBrandKitPatch = {}
  const heldForReview: FillOnlyBrandKitMergeResult['heldForReview'] = {}
  const warnings: string[] = []

  if (isBlank(cur.name)) patch.name = asString(facts.businessName) || fallbackName
  const logo = asString(facts.logo_url)
  if (logo && isBlank(cur.logo_url)) patch.logo_url = logo
  const primary = asString(facts.primary_color)
  if (primary && isBlank(cur.primary_color)) patch.primary_color = primary
  const secondary = asString(facts.secondary_color)
  if (secondary && isBlank(cur.secondary_color)) patch.secondary_color = secondary
  const accent = asString(facts.accent_color)
  if (accent && isBlank(cur.accent_color)) patch.accent_color = accent
  const font = asString(facts.font_primary)
  if (font && isBlank(cur.font_primary)) patch.font_primary = font
  const tagline = asString(facts.tagline)
  if (tagline && isBlank(cur.tagline)) patch.tagline = tagline

  const voice = asString(facts.brand_voice)
  if (voice && isBlank(cur.brand_voice)) {
    if (isHighRiskMarketingClaim(voice)) {
      heldForReview.brand_voice = voice
      warnings.push('brand_voice held for review (high-risk medical/absolute claim language)')
    } else {
      patch.brand_voice = voice
    }
  }

  const tones = asStringArray(facts.tone_keywords)
  if (tones && isBlank(cur.tone_keywords)) patch.tone_keywords = tones

  const must = asStringArray(facts.must_use_phrases)
  if (must && isBlank(cur.must_use_phrases)) {
    const filtered = filterSafePhrases(must)
    if (filtered.safe) patch.must_use_phrases = filtered.safe
    if (filtered.heldForReview.length) {
      heldForReview.must_use_phrases = filtered.heldForReview
      warnings.push('must_use_phrases partially held for review (high-risk claims)')
    }
  }

  const forbid = asStringArray(facts.forbidden_phrases)
  if (forbid && isBlank(cur.forbidden_phrases)) patch.forbidden_phrases = forbid
  const visual = asString(facts.brand_visual)
  if (visual && isBlank(cur.visual_style_notes)) patch.visual_style_notes = visual
  const audience = asString(facts.icp)
  if (audience && isBlank(cur.target_audience)) patch.target_audience = audience
  const refs = asStringArray(facts.reference_images, 8)
  if (refs && isBlank(cur.reference_images)) patch.reference_images = refs

  return {
    patch,
    reviewRequired: Boolean(heldForReview.brand_voice || heldForReview.must_use_phrases?.length),
    heldForReview,
    warnings,
  }
}

export function sanitizeWorkerError(err: unknown): string {
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : 'Analysis failed'
  return message.replace(/\s+/g, ' ').trim().slice(0, 480) || 'Analysis failed'
}
