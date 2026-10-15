/**
 * MCP 0.26.0 — `adpack_preflight` (free) and the same check inside execute_image_generate / execute_bulk_posts /
 * execute_campaign_pack / adpack_start BEFORE quoting (docs/mcp-quality.md).
 *
 * Score 0–100, itemised:
 *   ESSENTIALS (70 points; any missing one blocks — the score is then capped below PREFLIGHT_MIN_SCORE):
 *     product_photo 35  ≥ 1 usable product photo of the brand (downloads and is an image)
 *     offer_name    15  the offer / product has a name
 *     brief         20  copy, guidePrompt, scene, brief or the offer description — something to sell from
 *   A price is NOT required and never scored: it is used / rendered only when the copy itself carries one.
 *   QUALITY (30 points; lowers the score but NEVER blocks on its own — with every essential present the score is ≥ 70):
 *     reference_quality 12  minus the gate penalties (low resolution, compression, screenshot, burned-in text, AI render)
 *     reference_variety  6  +3 another angle / packaging, +3 lifestyle / b-roll context
 *     brand_kit          8  logo 4, colours 2, fonts 2
 *     cta_contact        4  a CTA / contact line in the copy (or the offer CTA)
 */
import { findCtaLine } from './copy-layout.js'
import type { McpArtifactStore, McpOwnedImage } from './artifact-store.js'
import { effectiveAssetRole, missingAssetsMessage, selectReferences, type ReferenceSelection } from './asset-tools.js'
import { gateReferences, REFERENCE_GATE_CONFIG, verdictSummary, visionClassifierFromGateway, type GateDeps, type ReferenceVerdict } from './reference-gate.js'
import { createModelGateway } from '../adpack/gateway.js'
import { logApiUsage } from '../usage-logger.js'
import type { McpOfferStore } from './offer-tools.js'
import type { McpBrandContext } from './user-tools.js'

export type PreflightItem = { key: string; essential: boolean; points: number; max: number; ok: boolean; reasons: string[]; fix?: string }

export type PreflightReport = {
  score: number
  minScore: number
  blocked: boolean
  items: PreflightItem[]
  missingEssentials: string[]
  /** Spanish / English warnings for the user (low-quality photos etc.). */
  warnings: string[]
  /** Per asset: role and gate verdict. */
  references: Array<{ id: string; role: string; gate: Record<string, unknown> }>
  /** The refs the generation will use (hero first). */
  selection: { productIds: string[]; supportIds: string[]; picked: ReferenceSelection['picked'] }
  /** Silently dropped duplicates. */
  deduped: Array<{ dropped: string; keptAs: string }>
  /** Actionable "what is missing" text when blocked. */
  message?: string
}

export type PreflightInput = {
  ctx: Pick<McpBrandContext, 'offers' | 'brandKit'>
  offerId: string
  assets: McpOwnedImage[]
  confirmedIds?: string[]
  productImageId?: string
  copy?: string
  guidePrompt?: string
  scene?: string
  brief?: string
  language?: 'es' | 'en'
  gate?: GateDeps
}

export async function runPreflight(input: PreflightInput): Promise<PreflightReport & { verdicts: Map<string, ReferenceVerdict>; selected: ReferenceSelection }> {
  const es = input.language !== 'en'
  const C = REFERENCE_GATE_CONFIG
  const offer = input.ctx.offers.find((o) => o.id === input.offerId)
  const kit = input.ctx.brandKit
  const candidates = input.assets.filter((a) => a.kind !== 'generated' && a.imageUrl)
  // Confirmed ids → only those are checked; otherwise the brand's photos (primary first, then newest; at most 12). Free local checks;
  // a vision classification only for refs without a cached verdict (when a classifier is configured).
  const confirmed = [...new Set([...(input.productImageId ? [input.productImageId] : []), ...(input.confirmedIds ?? [])])]
  // Hero first (confirmed order / primary first) and protected: the hero is never dropped as a duplicate.
  const toGate = confirmed.length
    ? confirmed.map((id) => candidates.find((a) => a.id === id)).filter((a): a is McpOwnedImage => Boolean(a))
    : [...candidates].sort((x, y) => Number(y.isPrimary === true) - Number(x.isPrimary === true)).slice(0, 12)
  const gated = await gateReferences(toGate.map((a, i) => ({ id: a.id, url: a.imageUrl, quality: a.quality ?? null, protect: i === 0 || a.isPrimary === true })), input.gate)
  const verdicts = new Map<string, ReferenceVerdict>()
  for (const v of [...gated.accepted, ...gated.rejected]) if (v.id) verdicts.set(v.id, v)
  const acceptedIds = new Set(gated.accepted.map((v) => v.id))
  const dedupedIds = new Set(gated.deduped.map((d) => d.dropped).filter((id) => !acceptedIds.has(id)))
  const assetsForSelection = candidates.filter((a) => !dedupedIds.has(a.id))
  const selected = selectReferences({ assets: assetsForSelection, verdicts, confirmedIds: input.confirmedIds, productImageId: input.productImageId, max: 3 })

  const items: PreflightItem[] = []
  // ---- essentials ----
  const hasProduct = selected.product.some((a) => ['product', 'packaging', 'unboxing'].includes(effectiveAssetRole(a)))
  items.push({ key: 'product_photo', essential: true, max: 35, points: hasProduct ? 35 : 0, ok: hasProduct, reasons: hasProduct ? [] : [es ? 'no hay una foto de producto descargable' : 'no downloadable product photo'], ...(hasProduct ? {} : { fix: `import_image a real product photo (≥ ${C.MIN_LONG_SIDE} px on the long side)` }) })
  const hasName = Boolean(offer?.name?.trim())
  items.push({ key: 'offer_name', essential: true, max: 15, points: hasName ? 15 : 0, ok: hasName, reasons: hasName ? [] : [es ? 'la oferta no tiene nombre' : 'the offer has no name'], ...(hasName ? {} : { fix: 'update_offer {name}' }) })
  const briefText = [input.copy, input.guidePrompt, input.scene, input.brief, offer?.productDescription, offer?.differentiation].map((t) => (t || '').trim()).filter(Boolean)
  const hasBrief = briefText.length > 0
  items.push({ key: 'brief', essential: true, max: 20, points: hasBrief ? 20 : 0, ok: hasBrief, reasons: hasBrief ? [] : [es ? 'no hay copy, brief, escena ni descripción de la oferta' : 'no copy, brief, scene or offer description'], ...(hasBrief ? {} : { fix: 'pass copy / brief, or update_offer {description}' }) })

  // ---- quality (never blocks on its own) ----
  const used = [...selected.product, ...selected.support]
  const warnings: string[] = []
  let penalty = 0
  const qReasons: string[] = []
  for (const a of used) {
    const v = verdicts.get(a.id)
    for (const i of v?.issues ?? []) {
      if (i.severity !== 'warning') continue
      const p = i.code === 'very_low_resolution' ? C.PENALTY.veryLowRes : i.code === 'low_resolution' ? C.PENALTY.lowRes : i.code === 'heavy_compression' ? C.PENALTY.compression : i.code === 'screenshot' ? C.PENALTY.screenshot : i.code === 'burned_in_text' ? C.PENALTY.burnedInText : C.PENALTY.aiRender
      penalty += p
      qReasons.push(`${a.id}: ${i.code}`)
      warnings.push(es ? i.es : i.en)
    }
  }
  const qPoints = Math.max(0, 12 - penalty)
  items.push({ key: 'reference_quality', essential: false, max: 12, points: hasProduct ? qPoints : 0, ok: penalty === 0, reasons: qReasons, ...(penalty ? { fix: `upload sharp photos of ≥ ${C.MIN_LONG_SIDE} px without burned-in text (smaller ones are upscaled for free, never redrawn)` } : {}) })
  const second = used.some((a, i) => i > 0 && (effectiveAssetRole(a) === 'product' || effectiveAssetRole(a) === 'packaging'))
  const context = used.some((a) => effectiveAssetRole(a) === 'lifestyle' || effectiveAssetRole(a) === 'b-roll')
  items.push({ key: 'reference_variety', essential: false, max: 6, points: (second ? 3 : 0) + (context ? 3 : 0), ok: second && context, reasons: [...(second ? [] : ['no second angle / packaging photo']), ...(context ? [] : ['no lifestyle / b-roll photo'])], ...(second && context ? {} : { fix: 'add another angle / packaging photo and a lifestyle photo (import_image; set_asset_role to name the role)' }) })
  const logo = Boolean(kit?.logoUrl)
  const colours = Boolean(kit?.primaryColor || kit?.secondaryColor || kit?.accentColor)
  const fonts = Boolean(kit?.fontPrimary)
  items.push({ key: 'brand_kit', essential: false, max: 8, points: (logo ? 4 : 0) + (colours ? 2 : 0) + (fonts ? 2 : 0), ok: logo && colours && fonts, reasons: [...(logo ? [] : ['no logo']), ...(colours ? [] : ['no brand colours']), ...(fonts ? [] : ['no brand font'])], ...(logo && colours && fonts ? {} : { fix: 'update_brand_kit {logoUrl, colors, fonts}' }) })
  const cta = Boolean(input.copy && findCtaLine(input.copy.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)))
  items.push({ key: 'cta_contact', essential: false, max: 4, points: cta ? 4 : 0, ok: cta, reasons: cta ? [] : ['no CTA / contact line in the copy'], ...(cta ? {} : { fix: 'end the copy with one CTA line (e.g. "Escribinos por WhatsApp")' }) })

  const missingEssentials = items.filter((i) => i.essential && !i.ok).map((i) => i.key)
  let score = items.reduce((s, i) => s + i.points, 0)
  if (missingEssentials.length) score = Math.min(score, C.PREFLIGHT_MIN_SCORE - 1 - 10 * (missingEssentials.length - 1))
  score = Math.max(0, Math.round(score))
  const blocked = score < C.PREFLIGHT_MIN_SCORE
  for (const r of gated.rejected) warnings.push(...r.issues.map((i) => (es ? i.es : i.en)))
  const message = blocked
    ? [
        ...(missingEssentials.includes('product_photo') ? [missingAssetsMessage({ assets: candidates, verdicts, confirmedIds: [...(input.productImageId ? [input.productImageId] : []), ...(input.confirmedIds ?? [])], language: input.language })] : [es ? 'No se cobró nada.' : 'Nothing was charged.']),
        ...items.filter((i) => i.essential && !i.ok && i.key !== 'product_photo').map((i) => `${i.key}: ${i.reasons.join('; ')} → ${i.fix}`),
      ].join('\n')
    : undefined
  return {
    score,
    minScore: C.PREFLIGHT_MIN_SCORE,
    blocked,
    items,
    missingEssentials,
    warnings: [...new Set(warnings)],
    references: candidates.filter((a) => !dedupedIds.has(a.id)).map((a) => ({ id: a.id, role: effectiveAssetRole(a), gate: verdicts.get(a.id) ? verdictSummary(verdicts.get(a.id)!) : { ok: null, note: 'not checked (not selected for this run)' } })),
    selection: { productIds: selected.product.map((a) => a.id), supportIds: selected.support.map((a) => a.id), picked: selected.picked },
    deduped: gated.deduped.map((d) => ({ dropped: d.dropped, keptAs: d.keptAs })),
    ...(message ? { message } : {}),
    verdicts,
    selected,
  }
}

export class PreflightBlockedError extends Error {
  readonly code = 'PREFLIGHT_BLOCKED'
  constructor(readonly report: PreflightReport) {
    super(`${report.message ?? 'Preflight blocked'}\n(preflight score ${report.score} < ${report.minScore}; call adpack_preflight for the itemised report)`)
  }
}

/** Public, result-safe view (no verdict map). */
export function preflightView(r: PreflightReport): PreflightReport {
  const { score, minScore, blocked, items, missingEssentials, warnings, references, selection, deduped, message } = r
  return { score, minScore, blocked, items, missingEssentials, warnings, references, selection, deduped, ...(message ? { message } : {}) }
}

/** Load the offer's assets and run the preflight (execute tools + adpack_preflight). */
export async function preflightForOffer(o: Omit<PreflightInput, 'assets'> & { artifactStore: McpArtifactStore; userId: string; brandId: string }): Promise<Awaited<ReturnType<typeof runPreflight>>> {
  const product = await o.artifactStore.listOwnedAssets({ userId: o.userId, brandId: o.brandId, offerId: o.offerId, kind: 'product' }).catch(() => [] as McpOwnedImage[])
  const context = await o.artifactStore.listOwnedAssets({ userId: o.userId, brandId: o.brandId, offerId: o.offerId, kind: 'context' }).catch(() => [] as McpOwnedImage[])
  // Explicitly confirmed ids of another offer of the same brand (round 11 reuse) are resolved too.
  const extra: McpOwnedImage[] = []
  for (const id of [...(o.productImageId ? [o.productImageId] : []), ...(o.confirmedIds ?? [])]) {
    if ([...product, ...context, ...extra].some((a) => a.id === id)) continue
    const got = (await o.artifactStore.getOwnedProductImage({ userId: o.userId, brandId: o.brandId, imageId: id }).catch(() => null))
    if (got) extra.push(got)
  }
  const seen = new Set<string>()
  const assets = [...product, ...context, ...extra].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
  return runPreflight({ ...o, assets })
}

/** Bulk posts / campaign pack: gate-accepted product refs (hero first) or a PreflightBlockedError — before the quote. */
export async function productRefUrlsForBulk(o: { artifactStore: McpArtifactStore; userId: string; brandId: string; offerId: string; ctx: PreflightInput['ctx']; confirmedIds: string[]; productImageId?: string; guidePrompt?: string; scene?: string; language?: 'es' | 'en'; gate?: GateDeps }): Promise<{ urls: string[]; preflight: PreflightReport }> {
  // The copy of every post is written from the angle board, so the brief is always there.
  const pre = await preflightForOffer({ ...o, brief: 'angle board (generated per post)' })
  if (pre.blocked) throw new PreflightBlockedError(preflightView(pre))
  return { urls: pre.selected.product.map((a) => a.imageUrl), preflight: preflightView(pre) }
}

/**
 * Gate deps for the execute tools: the vision classification (one cheap Gemini 2.5 Flash call per NEW photo, behind the adpack gateway)
 * is cached in product_images.quality.gate by content hash; its cost is logged. No Gemini key → local checks only.
 */
export function defaultGateDeps(o: { user: { id: string; email?: string | null }; offerStore?: McpOfferStore | null }): GateDeps {
  let classify: GateDeps['classify']
  try { classify = visionClassifierFromGateway(createModelGateway()) } catch { classify = undefined }
  return {
    ...(classify ? { classify } : {}),
    ...(o.offerStore ? { persist: async (ref, patch) => { await o.offerStore!.updateProductImage({ userId: o.user.id, imageId: ref.id, patch: { quality: { ...(ref.quality ?? {}), ...patch } } }) } } : {}),
    onPaidCall: (c) => { void logApiUsage({ userId: o.user.id, userEmail: o.user.email || undefined, feature: 'mcp_tool', model: c.model, success: true, costOverrideUsd: c.costUsd, source: 'mcp', metadata: { action: 'reference_gate_vision', productImageId: c.refId ?? null } }) },
  }
}
