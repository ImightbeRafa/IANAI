/**
 * `create_ads` — one MCP entry point for "make ads" (G1).
 *
 * Pure routing: maps `{ brandId, offerId, count, mode, ratios?, brief?, … }` onto the existing
 * implementation and its exact arguments, so approvals, idempotency and credits are the routed
 * tool's own:
 *
 *   mode pack     → adpack_start { size: count }               (static ads, product-locked scenes)
 *   mode single   → adpack_start { size: 1 }
 *   mode carousel → execute_carousel_generate { slideCount: count, aspectRatio: ratios[0] }
 *   mode edit     → execute_image_edit { editPrompt: editPrompt ?? brief, aspectRatio: ratios[0] }
 *
 * The approval is issued under the routed tool; retrying `create_ads` with the same arguments +
 * approvalRequestId routes to identical arguments (same input hash), so the approval matches.
 * The old tools keep working unchanged.
 */

export const CREATE_ADS_MODES = ['pack', 'single', 'carousel', 'edit'] as const
export type CreateAdsMode = typeof CREATE_ADS_MODES[number]

export type CreateAdsRoute = {
  mode: CreateAdsMode
  tool: 'adpack_start' | 'execute_carousel_generate' | 'execute_image_edit'
  args: Record<string, unknown>
}

export class CreateAdsInputError extends Error {
  readonly code = 'BAD_INPUT'
}

const bad = (message: string) => new CreateAdsInputError(message)

const PACK_RATIOS = new Set(['1:1', '4:5', '9:16', '16:9'])

/** adpack_start arguments create_ads forwards unchanged in pack/single mode. */
export const PACK_PASSTHROUGH = [
  'brief', 'angleIds', 'angles', 'variations', 'creativeFreedom', 'layoutFamily', 'styleDnaId', 'brandKitId', 'locale', 'register', 'forbiddenPhrases', 'forbiddenClaims',
  'productImageIds', 'productImageIdsByAd', 'photoPerAd', 'heroRequired', 'saveToOffer', 'offerPatch', 'saveToBrandKit', 'brandKitPatch',
  'includeDna', 'language', 'useStyleDna',
  'productFidelity', 'relight', 'allowedProps', 'immutableAttributes',
  'mustAppear', 'previewId',
] as const
const CAROUSEL_RATIOS = new Set(['1:1', '4:5', '9:16', '3:4'])

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function copyDefined(from: Record<string, unknown>, keys: readonly string[], into: Record<string, unknown>): void {
  for (const k of keys) if (from[k] !== undefined) into[k] = from[k]
}

function ratiosOf(args: Record<string, unknown>): string[] | undefined {
  if (args.ratios === undefined) return undefined
  if (!Array.isArray(args.ratios) || !args.ratios.length || args.ratios.some((r) => typeof r !== 'string')) {
    throw bad('ratios must be a non-empty array like ["4:5","9:16"]')
  }
  return args.ratios as string[]
}

function countOf(args: Record<string, unknown>): number | undefined {
  if (args.count === undefined || args.count === null) return undefined
  const n = Number(args.count)
  if (!Number.isInteger(n) || n < 1) throw bad('count must be a positive integer')
  return n
}

/** Deterministic mapping: same create_ads arguments → same routed arguments (approval hash stays stable). */
export function routeCreateAds(args: Record<string, unknown>): CreateAdsRoute {
  const mode = (args.mode ?? 'pack') as CreateAdsMode
  if (!CREATE_ADS_MODES.includes(mode)) throw bad(`mode must be one of ${CREATE_ADS_MODES.join(', ')}`)
  const brandId = str(args.brandId)
  if (!brandId) throw bad('brandId is required (from list_brands)')
  const count = countOf(args)
  const ratios = ratiosOf(args)
  const base: Record<string, unknown> = { brandId }
  if (str(args.offerId)) base.offerId = str(args.offerId)
  if (str(args.approvalRequestId)) base.approvalRequestId = str(args.approvalRequestId)

  switch (mode) {
    case 'pack':
    case 'single': {
      if (mode === 'single' && count !== undefined && count !== 1) throw bad('mode single makes exactly 1 ad (use mode pack for more)')
      if (ratios?.some((r) => !PACK_RATIOS.has(r))) throw bad('pack/single ratios: 1:1, 4:5, 9:16, 16:9 (default 4:5 + 9:16)')
      const out: Record<string, unknown> = { ...base }
      const size = mode === 'single' ? 1 : count
      if (size !== undefined) out.size = size
      if (ratios) out.ratios = ratios
      copyDefined(args, PACK_PASSTHROUGH, out)
      return { mode, tool: 'adpack_start', args: out }
    }
    case 'carousel': {
      if (ratios && ratios.length > 1) throw bad('carousel renders one ratio: pass a single ratio')
      if (ratios?.some((r) => !CAROUSEL_RATIOS.has(r))) throw bad('carousel ratios: 1:1, 4:5, 9:16, 3:4')
      if (!str(args.scriptId) && !str(args.scriptContent)) throw bad('carousel needs scriptId or scriptContent')
      const out: Record<string, unknown> = { ...base }
      if (count !== undefined) out.slideCount = count
      if (ratios) out.aspectRatio = ratios[0]
      if (str(args.brief)) out.designDirection = str(args.brief)
      copyDefined(args, ['scriptId', 'scriptContent', 'subtype', 'productImageId', 'referenceImageIds', 'language', 'sessionId'] as const, out)
      return { mode, tool: 'execute_carousel_generate', args: out }
    }
    case 'edit': {
      if (count !== undefined && count !== 1) throw bad('mode edit changes one image (count 1)')
      if (ratios && ratios.length > 1) throw bad('edit renders one ratio: pass a single ratio')
      const editPrompt = str(args.editPrompt) ?? str(args.brief)
      if (!editPrompt) throw bad('mode edit needs editPrompt (or brief) describing the change')
      if (!str(args.productImageId) && !str(args.imageUrl)) throw bad('mode edit needs productImageId or imageUrl of the image to edit')
      const out: Record<string, unknown> = { ...base, editPrompt }
      if (ratios) out.aspectRatio = ratios[0]
      copyDefined(args, ['productImageId', 'imageUrl', 'sessionId'] as const, out)
      return { mode, tool: 'execute_image_edit', args: out }
    }
  }
}

/** Decision table shared by the tool descriptions (which tool for which job). */
export const CREATE_ADS_DECISION_TABLE =
  'DECISION TABLE (prefer create_ads): ' +
  'mode pack|single → Ad Pack: sell-ready static ads, text rendered exactly (never drawn by the model), real product photo as scene reference + product check with retries; ratios 4:5 + 9:16 by default (1:1 on request, or later free via adpack_resize); brand kit colors/fonts/logo/voice/forbidden phrases; 7 layout families (layoutFamily / styleDnaId), creativeFreedom, variations 1-3 (credits = ads × variations), angleIds from adpack_angles or guide_bulk_angles; 6 credits per finished ad. ' +
  'mode carousel → execute_carousel_generate: 2-5 slides from a script, one ratio (1:1/4:5/9:16/3:4), designDirection = brief; 24 credits per slide. ' +
  'mode edit → execute_image_edit: change an existing image (productImageId or imageUrl), one ratio; 18 credits. ' +
  'Other tools (still available): execute_image_generate = one free-form image (no exact text; 4:5 needs aspectRatioFallback→3:4); execute_bulk_posts / execute_campaign_pack = angle-board posts/scripts with styleDnaId (Style DNA), 6 or 24 credits per image. ' +
  'Every paid mode: one in-chat approval {items, unitCost, total}; if the plan changes before running the tool answers PLAN_CHANGED and nothing is charged. ' +
  'Before a pack (free, no approval, no credits): adpack_preview {brandId, offerId, count, …same args} shows per ad the angle, rationale, layout family, planned photo and the exact copy + check; create_ads with the same args (or previewId) delivers that copy. ' +
  'Before making ads (free, no approval): create_brand if the brand does not exist yet; fix offer facts with create_offer / update_offer (price, bundles, shipping, includes/excludes, verified claims, immutableAttributes, allowedProps), the kit with update_brand_kit / set_primary_brand_kit, and photos with import_image / import_images (Google Drive, Dropbox or https link → copied into Advance storage, role hero|part|box|contents|in_use|detail; logo background removed) or create_upload_url → finalize_upload, set_primary_product_image / tag_product_image. ' +
  'With only brandId + offerId, Advance chooses angle, hook, scene and layout (creativeFreedom "high") and returns the rationale per ad; finished ads have a stable full-res PNG url + jpgUrl per ratio.'
