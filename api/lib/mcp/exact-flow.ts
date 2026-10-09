/**
 * MCP `productFidelity: "exact"` with the SAME ad layers as the web-style flow.
 *
 * Round 3: the exact branch returned a bare plate + cut-out (no copy, no logo, no CTA, no QA) and passed a visibly haloed
 * cut-out at 0.965. Now: real product pixels composited on a generated plate (unchanged pipeline) → the ad-pack renderer
 * draws the copy (headline / one price line / one facts line / ONE CTA), the kit logo and safe-zone margins over it → the
 * same free QA (safe zones, text, separators, extra-CTA risk) + halo / edge-roughness flags. Warning only: nothing here
 * blocks a delivered image, retries a paid call or changes credits.
 */
import { edgeRoughness, QA_THRESHOLDS } from '../adpack/qa-gate.js'
import { generateExactProductImage, type ExactImageInput, type ExactImageResult } from '../adpack/fidelity/pipeline.js'
import { measureHalo, type HaloReport } from '../adpack/fidelity/halo.js'
import { renderAd } from '../adpack/render/render.js'
import { fetchPublicImageDetailed } from '../fetch-image-data-url.js'
import type { AspectRatio } from '../adpack/types.js'
import { capCopyBlocks } from './copy-layout.js'
import { runMcpImageQa, tidyCopySeparators, type McpImageQa } from './image-postcheck.js'
import { CAPACITY_ERROR_RE, withProviderRetry } from './provider-retry.js'
import type { McpBrandContext } from './user-tools.js'

export type ExactAdOutput = {
  imageDataUrl: string
  width: number
  height: number
  costUsd: number
  plateModel: string
  fidelity: Record<string, unknown>
  qa: McpImageQa
  halo: HaloReport & { edgeRoughness: number | null }
  /** Warning only. */
  halo_warning?: { code: 'halo_warning'; reason: string; leak: number | null; haze: number; edgeRoughness: number | null }
  copyOverflow: string[]
  copyOnImage: { headline: string; offerLine?: string; subline?: string; cta: string }
  layout: { textOverProduct: boolean; allTextFits: boolean; logo: 'drawn' | 'none' }
  warnings: string[]
  providerRetries: number
}

const PRICE_RE = /([₡$€£]\s?\d|\d[\d.,]*\s?(colones|usd|mxn|eur)\b|\bprecio\b|\bprice\b)/i

/** copy string → renderer fields: headline (first), ONE price line, ONE facts line (subline), ONE CTA. */
export function mapCopyToRenderFields(copy: string, cta?: string): { headline: string; offerLine?: string; subline?: string; cta: string; overflow: string[] } {
  const lines = copy.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const ctaLine = cta && lines.includes(cta) ? cta : undefined
  const rest = lines.filter((l) => l !== ctaLine)
  const priceIdx = rest.findIndex((l) => PRICE_RE.test(l))
  const offerLine = priceIdx >= 0 ? rest[priceIdx] : undefined
  const others = rest.filter((_, i) => i !== priceIdx)
  const headline = others[0] || offerLine || ''
  const subline = others[1]
  const used = new Set([headline, subline, offerLine, ctaLine].filter(Boolean) as string[])
  return { headline: headline === offerLine ? '' : headline, ...(offerLine ? { offerLine } : {}), ...(subline ? { subline } : {}), cta: ctaLine || '', overflow: lines.filter((l) => !used.has(l)) }
}

export async function generateExactWebStyleAd(input: {
  exact: ExactImageInput
  ctx: McpBrandContext
  offerId: string
  copy?: string
  guidePrompt?: string
  ratio: AspectRatio
  language: 'es' | 'en'
  layoutCap?: boolean
  /** Test seam: replaces the paid plate + composite call. */
  exactRunner?: (i: ExactImageInput) => Promise<ExactImageResult>
}): Promise<ExactAdOutput> {
  const run = input.exactRunner ?? generateExactProductImage
  const { value: exact, trace } = await withProviderRetry(async () => {
    const res = await run(input.exact)
    if (!res.ok) {
      const detail = [res.error, ...res.warnings].join(' | ')
      throw Object.assign(new Error(CAPACITY_ERROR_RE.test(detail) ? `provider: ${detail.slice(0, 240)}` : res.error), {})
    }
    return res
  })

  const offer = input.ctx.offers.find((o) => o.id === input.offerId)
  const kit = input.ctx.brandKit
  let copy = (input.copy || '').trim() || (input.guidePrompt || '').trim() || [offer?.name, offer?.price].filter(Boolean).join('\n')
  copy = tidyCopySeparators(copy).copy
  const capped = input.layoutCap === false ? null : capCopyBlocks(copy)
  if (capped?.capped) copy = capped.onImage
  const fields = mapCopyToRenderFields(copy, capped?.cta ?? capCopyBlocks(copy).cta)
  const warnings = [...exact.warnings]

  let logo: string | undefined
  if (kit?.logoUrl) {
    const fetched = await fetchPublicImageDetailed(kit.logoUrl)
    if ('dataUrl' in fetched) logo = fetched.dataUrl
    else warnings.push(`logo not drawn: ${fetched.failure.url} → ${fetched.failure.status ? `HTTP ${fetched.failure.status}` : fetched.failure.reason}`)
  }

  const rendered = await renderAd({
    format: 'offer_graphic',
    ratio: input.ratio,
    sceneImage: exact.png,
    // The real product is already composited into the scene: the renderer only keeps text / logo off it.
    productBox: { x: exact.productBox.x / exact.width, y: exact.productBox.y / exact.height, w: exact.productBox.w / exact.width, h: exact.productBox.h / exact.height },
    copy: { headline: fields.headline, ...(fields.subline ? { subline: fields.subline } : {}), bullets: [], ...(fields.offerLine ? { offerLine: fields.offerLine } : {}), cta: fields.cta },
    brandName: input.ctx.brand.name,
    // Same 8 % top / bottom rule as the prompt of the generated flow (headline + logo out of the top 8 %, CTA out of the bottom 8 %).
    safeMargin: { top: 0.09, bottom: 0.09 },
    ...(logo ? { logo } : {}),
    visual: {
      ...(kit?.primaryColor ? { primaryColor: kit.primaryColor } : {}),
      ...(kit?.secondaryColor ? { secondaryColor: kit.secondaryColor } : {}),
      ...(kit?.accentColor ? { accentColor: kit.accentColor } : {}),
    },
    language: input.language,
  })

  const dataUrl = `data:image/png;base64,${rendered.png.toString('base64')}`
  const qa = await runMcpImageQa({
    generatedDataUrl: dataUrl,
    requestedRatio: input.ratio,
    copyRequested: Boolean(copy),
    logoAttached: Boolean(logo),
    logoExpected: Boolean(kit),
    copy,
  })
  const rough = await edgeRoughness(exact.placed).catch(() => null)
  const halo: ExactAdOutput['halo'] = { ...exact.halo, edgeRoughness: rough }
  const reasons = [...exact.halo.reasons]
  if (typeof rough === 'number' && rough > QA_THRESHOLDS.edgeRoughnessMax) reasons.push(`cut-out edge roughness ${rough} > ${QA_THRESHOLDS.edgeRoughnessMax} (jagged silhouette)`)
  halo.flagged = reasons.length > 0
  halo.reasons = reasons
  const report = rendered.layoutReport
  return {
    imageDataUrl: dataUrl,
    width: rendered.width,
    height: rendered.height,
    costUsd: exact.costUsd,
    plateModel: exact.plateModel,
    fidelity: { score: exact.fidelity.score, passed: exact.fidelity.passed, method: exact.fidelity.method, ssim: exact.fidelity.ssim, deltaE: exact.fidelity.deltaE, silhouetteIoU: exact.score.silhouetteIoU, hueShift: exact.score.hueShift },
    qa,
    halo,
    ...(halo.flagged ? { halo_warning: { code: 'halo_warning' as const, reason: `visible halo / leftover background around the real product: ${reasons.join('; ')}`, leak: halo.leak, haze: halo.haze, edgeRoughness: rough } } : {}),
    copyOverflow: [...(capped?.overflow ?? []), ...fields.overflow.filter((l) => !(capped?.overflow ?? []).includes(l))],
    copyOnImage: { headline: fields.headline, ...(fields.offerLine ? { offerLine: fields.offerLine } : {}), ...(fields.subline ? { subline: fields.subline } : {}), cta: fields.cta },
    layout: { textOverProduct: report.textOverProduct === true, allTextFits: report.elements.every((e) => e.fits), logo: report.logo ? 'drawn' : 'none' },
    warnings,
    providerRetries: trace.retries.length,
  }
}
