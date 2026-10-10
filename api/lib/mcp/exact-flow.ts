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
import { fetchPublicImageDetailed } from '../fetch-image-data-url.js'
import type { AspectRatio } from '../adpack/types.js'
import { capCopyBlocks } from './copy-layout.js'
import { qaSeverity, runMcpImageQa, tidyCopySeparators, type McpImageQa } from './image-postcheck.js'
import { prepareAndLayout } from './compose-scene.js'
import { splitCopyBlocks } from './layout-ad.js'
import { freeBands } from './safe-zones.js'
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
  /** Round 7: what the shared code layout drew (same report as the generated flow). */
  compositeLayers: import('./layout-ad.js').AdLayoutReport
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

  // Round 7: the SAME code layout as the generated flow (layout-ad): real product pixels on the plate → flat strips blended away → text never on the product
  // (picture moved down when the top is occupied) → real logo + headline + price + facts + ONE CTA, brand fonts / colours, contrast ≥ 4.5:1, no overlaps.
  const productBox = { x0: exact.productBox.x / exact.width, y0: exact.productBox.y / exact.height, x1: (exact.productBox.x + exact.productBox.w) / exact.width, y1: (exact.productBox.y + exact.productBox.h) / exact.height }
  const blocks = splitCopyBlocks(copy, capped?.cta ?? capCopyBlocks(copy).cta)
  const done = await prepareAndLayout({
    bytes: Buffer.from(exact.png), ratio: input.ratio, logo: logo ? Buffer.from(logo.slice(logo.indexOf(',') + 1), 'base64') : null, blocks,
    palette: { primary: kit?.primaryColor, secondary: kit?.secondaryColor, accent: kit?.accentColor },
    fonts: { headingFont: kit?.fontPrimary ?? null, bodyFont: null },
    avoid: [productBox],
  })
  const sceneBytes = done.sceneBytes
  const seamsFound = done.scenePrep.seams
  const seamsRemaining = seamsFound.remaining ?? (seamsFound.found.length ? seamsFound.found.length : 0)
  const roomNote = done.scenePrep.room?.applied ? done.scenePrep.room.note : undefined
  const report = done.report
  const sceneUrl = `data:image/jpeg;base64,${sceneBytes.toString('base64')}`
  const dataUrl = `data:image/jpeg;base64,${done.bytes.toString('base64')}`
  const sceneQa = await runMcpImageQa({
    generatedDataUrl: sceneUrl,
    requestedRatio: input.ratio,
    copyRequested: false,
    logoAttached: true,
    logoExpected: false,
    copy,
    sceneOnly: { bands: freeBands(input.ratio), excludeBoxes: [{ x0: productBox.x0, y0: productBox.y0, x1: productBox.x1, y1: productBox.y1 }] },
  })
  const wantsText = Boolean(blocks.headline || blocks.price || blocks.facts?.length)
  const layoutBad = report.layout.overlaps.length > 0 || !report.text.fits || report.text.lowContrast || !report.layout.insideSafeZones
  const qa: McpImageQa = {
    ...sceneQa,
    textLayers: 'code',
    textPresent: wantsText ? (report.text.drawn ? 'yes' : 'no') : 'not_requested',
    logo: report.logo.status === 'drawn' ? 'attached' : 'none',
    ctaButtons: (report.cta.status === 'drawn' ? 1 : 0) + sceneQa.ctaButtons,
    extraCtaRisk: sceneQa.ctaButtons > 0,
    safeZones: sceneQa.safeZoneIssues.length || !report.layout.insideSafeZones ? 'violation' : 'ok',
    textScale: report.text.drawn ? report.text.scale : undefined,
    seams: { found: seamsFound.found.length, blended: seamsFound.found.length > 0 && seamsRemaining === 0, remaining: seamsRemaining, details: seamsFound.found.map((x) => ({ edge: x.edge, share: x.stripShare, step: x.step })) },
    warnings: [...sceneQa.warnings.filter((w) => !w.startsWith('the brand kit has no logo')), ...(report.layout.overlaps.length ? [`layout overlap: ${report.layout.overlaps.join(', ')}`] : []), ...(report.text.textOverProduct ? ['text over the product: the scene left no calm corridor for the text'] : []), ...(report.text.drawn && report.text.scale < 0.8 ? [`text scaled to ${Math.round(report.text.scale * 100)}% of its nominal size`] : []), ...(roomNote ? [`scene prep: ${roomNote}`] : [])],
  }
  if (report.logo.status === 'unavailable') qa.logoUnavailable = true
  if (report.cta.busy) { qa.ctaBusy = true; qa.warnings.push('the CTA button sits on a busy area / the product (compositeLayers.cta.busy)') }
  qa.status = qa.safeZones === 'violation' || qa.textPresent === 'no' || qa.extraCtaRisk || layoutBad || report.text.textOverProduct || seamsRemaining > 0 ? 'fail' : qa.ctaBusy || report.text.scale < 0.8 ? 'warning' : 'pass'
  qa.severity = Math.round((qaSeverity({ ...qa, ctaButtons: Math.max(0, qa.ctaButtons - (report.cta.status === 'drawn' ? 1 : 0) + (qa.ctaButtons > 1 ? 1 : 0)) }) + (report.text.textOverProduct ? 4 : 0) + (seamsRemaining ? 3 * seamsRemaining : 0)) * 100) / 100
  const rough = await edgeRoughness(exact.placed).catch(() => null)
  const halo: ExactAdOutput['halo'] = { ...exact.halo, edgeRoughness: rough }
  const reasons = [...exact.halo.reasons]
  if (typeof rough === 'number' && rough > QA_THRESHOLDS.edgeRoughnessMax) reasons.push(`cut-out edge roughness ${rough} > ${QA_THRESHOLDS.edgeRoughnessMax} (jagged silhouette)`)
  halo.flagged = reasons.length > 0
  halo.reasons = reasons
  return {
    imageDataUrl: dataUrl,
    width: report.width,
    height: report.height,
    costUsd: exact.costUsd,
    plateModel: exact.plateModel,
    fidelity: { score: exact.fidelity.score, passed: exact.fidelity.passed, method: exact.fidelity.method, ssim: exact.fidelity.ssim, deltaE: exact.fidelity.deltaE, silhouetteIoU: exact.score.silhouetteIoU, hueShift: exact.score.hueShift },
    qa,
    halo,
    ...(halo.flagged ? { halo_warning: { code: 'halo_warning' as const, reason: `visible halo / leftover background around the real product: ${reasons.join('; ')}`, leak: halo.leak, haze: halo.haze, edgeRoughness: rough } } : {}),
    copyOverflow: [...(capped?.overflow ?? []), ...fields.overflow.filter((l) => !(capped?.overflow ?? []).includes(l))],
    copyOnImage: { headline: fields.headline, ...(fields.offerLine ? { offerLine: fields.offerLine } : {}), ...(fields.subline ? { subline: fields.subline } : {}), cta: fields.cta },
    layout: { textOverProduct: report.text.textOverProduct === true, allTextFits: report.text.fits && report.layout.overlaps.length === 0, logo: report.logo.status === 'drawn' ? 'drawn' : 'none' },
    compositeLayers: report,
    warnings,
    providerRetries: trace.retries.length,
  }
}
