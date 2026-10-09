/**
 * Product fidelity — shared exact-mode steps for every image tool (A1/A2/H3, item 9).
 *
 * - `resolveProductPhotos`: role-tagged photos of an offer (falls back to productImageUrls).
 * - `prepareProductCutouts`: hero (sharpest usable photo, C3) + real parts → cut-outs, cached
 *   by content hash in storage; never synthesizes a missing part.
 * - `generateExactProductImage`: one text-free image at any supported ratio
 *   (plate → props check → composite + deterministic relight stage → optional AI relight →
 *   fidelity), used by MCP execute_image_generate, bulk posts and the campaign pack image step.
 */
import sharp from 'sharp'
import { isSupportedImageRatio, RATIO_OUTPUT_SIZE, ratioValue, reframeToRatio } from '../../image-ratios.js'
import { loadImageBytes } from '../render/image.js'
import type { AdFormat, AdLanguage, AspectRatio, BrandDna, FidelityResult, LightDirection, ModelGateway, OfferInput, ProductPhoto, RelightMode, StoredCutout } from '../types.js'
import { analyzeAssetQuality, pickProductImage, type AssetQuality, type PoolImage } from './asset-quality.js'
import type { BlobCache } from './cache.js'
import { compositeProducts, fitBox } from './composite.js'
import { checkPlate, generatePlate, plateLight, plateSurface, PLATE_RETRY_HINT_PLACEMENT, PLATE_RETRY_HINT_PROPS, type PlateCheckResult, type PlateRegion } from './plate.js'
import { relightComposite } from './relight.js'
import { fidelityFailReason, scoreFidelity, toFidelityResult, type FidelityScore } from './score.js'
import { segmentProduct, sha256Hex, type CutoutMethod } from './segment.js'
import { resolveProductPhotos } from './photos.js'
import { alphaIsFlatLay } from './recall.js'
import { upscaleProductPhoto, upscaleTarget, type UpscaleResult } from './upscale.js'

export type ImageLoader = (url: string) => Promise<Uint8Array>

export const defaultImageLoader: ImageLoader = async (url) => new Uint8Array(await loadImageBytes(url))

export { hasUsableProductPhoto, isProductPhotoRole, resolveProductPhotos, roleFromLabel } from './photos.js'

export interface LoadedCutout {
  stored: StoredCutout
  bytes: Uint8Array
  width: number
  height: number
  /** Present when the source photo was upscaled (without redrawing) before the cut-out. */
  upscale?: Pick<UpscaleResult, 'from' | 'to' | 'ssim' | 'silhouetteIoU'>
}

export interface CutoutContext {
  gateway?: Pick<ModelGateway, 'segment'>
  cache?: BlobCache | null
  load?: ImageLoader
  /** Per-run memo of source bytes / quality by URL. */
  memo?: Map<string, { bytes: Uint8Array; quality?: AssetQuality }>
}

async function sourceBytes(url: string, ctx: CutoutContext): Promise<Uint8Array> {
  const hit = ctx.memo?.get(url)
  if (hit) return hit.bytes
  const bytes = await (ctx.load ?? defaultImageLoader)(url)
  ctx.memo?.set(url, { bytes })
  return bytes
}

/**
 * Cut-out cache generation. Bumped whenever segmentation changes what a cut-out contains, so cut-outs
 * cached in storage by an older segmenter (round 1: Prototipo plane with backdrop halo baked in) are
 * never reused. Storage key = `<sha256>-<version>`; `sourceHash` stays the plain photo hash.
 */
export const CUTOUT_CACHE_VERSION = 'seg2'
export const cutoutCacheKey = (hash: string) => `${hash}-${CUTOUT_CACHE_VERSION}`

/** In-process LRU of cut-outs / photo quality by source hash (warm instances skip re-segmentation). */
const MEMO_MAX = 24
const cutoutMemo = new Map<string, { png: Uint8Array; width: number; height: number; method: CutoutMethod; recall?: number; flatLay?: boolean; backgroundLeak?: number }>()
const qualityMemo = new Map<string, AssetQuality>()
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MEMO_MAX) map.delete(map.keys().next().value as string)
  map.set(key, value)
}

/**
 * One photo → cut-out (storage cache by sha256 of the source bytes). With `upscale` (the photo is
 * low resolution per asset-quality), the photo is first upscaled without redrawing (upscale.ts)
 * and the cut-out is made from that; its cache key gets an `-sr<w>x<h>` suffix.
 */
export async function cutoutForPhoto(photo: ProductPhoto, ctx: CutoutContext, opts: { upscale?: boolean } = {}): Promise<LoadedCutout | { error: string }> {
  let bytes: Uint8Array
  try {
    bytes = await sourceBytes(photo.url, ctx)
  } catch (error) {
    return { error: `photo_unreadable: ${error instanceof Error ? error.message : String(error)}` }
  }
  const hash = sha256Hex(bytes)
  if (opts.upscale) {
    try {
      // Deterministic target → the upscaled cut-out's cache key is known before any work.
      const meta = await sharp(bytes).rotate().metadata()
      const target = upscaleTarget(meta.width ?? 0, meta.height ?? 0)
      if (target) {
        const key = `${hash}-sr${target.width}x${target.height}`
        const from = { width: meta.width ?? 0, height: meta.height ?? 0 }
        const hit = cutoutMemo.has(cutoutCacheKey(key)) || (ctx.cache ? await ctx.cache.get(cutoutCacheKey(key)).catch(() => null) : null)
        if (hit) {
          const res = await cutoutFromBytes(photo, bytes, key, ctx)
          return 'error' in res ? res : { ...res, upscale: { from, to: { width: target.width, height: target.height } } }
        }
        const up = await upscaleProductPhoto(bytes)
        if (up.upscaled) {
          const res = await cutoutFromBytes(photo, new Uint8Array(up.bytes), key, ctx)
          return 'error' in res ? res : { ...res, upscale: { from: up.from, to: up.to, ssim: up.ssim, silhouetteIoU: up.silhouetteIoU } }
        }
      }
    } catch {
      // Upscale is best-effort: the original photo is still a valid source.
    }
  }
  return cutoutFromBytes(photo, bytes, hash, ctx)
}

/** Flat lay of a cut-out (role 'contents' or ≥ 3 separated opaque pieces) — also for cached cut-outs. */
async function cutoutIsFlatLay(png: Uint8Array, role: ProductPhoto['role']): Promise<boolean> {
  if (role === 'contents') return true
  try {
    const { data, info } = await sharp(png).ensureAlpha().resize(512, 512, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
    return alphaIsFlatLay(data, info.width, info.height)
  } catch {
    return false
  }
}

function storedCutout(photo: ProductPhoto, url: string, method: StoredCutout['method'], hash: string, extra: { recall?: number; flatLay?: boolean; backgroundLeak?: number }): StoredCutout {
  return {
    url,
    role: photo.role,
    ...(photo.label ? { label: photo.label } : {}),
    method,
    sourceHash: hash,
    sourceUrl: photo.url,
    ...(photo.id ? { productImageId: photo.id } : {}),
    ...(typeof extra.recall === 'number' ? { recall: extra.recall } : {}),
    ...(extra.flatLay ? { flatLay: true } : {}),
    ...(typeof extra.backgroundLeak === 'number' ? { backgroundLeak: extra.backgroundLeak } : {}),
  }
}

async function cutoutFromBytes(photo: ProductPhoto, bytes: Uint8Array, hash: string, ctx: CutoutContext): Promise<LoadedCutout | { error: string }> {
  const key = cutoutCacheKey(hash)
  const local = cutoutMemo.get(key)
  if (local && ctx.cache) {
    // Still make sure the storage copy exists (URL for the item) — cheap when it does.
    const hit = await ctx.cache.get(key).catch(() => null)
    if (hit) {
      return { stored: storedCutout(photo, hit.url, 'cache', hash, { recall: local.recall, flatLay: local.flatLay || photo.role === 'contents', backgroundLeak: local.backgroundLeak }), bytes: hit.bytes, width: local.width, height: local.height }
    }
  }
  const cached = ctx.cache ? await ctx.cache.get(key).catch(() => null) : null
  if (cached) {
    const m = await sharp(cached.bytes).metadata()
    return {
      stored: storedCutout(photo, cached.url, 'cache', hash, { flatLay: await cutoutIsFlatLay(cached.bytes, photo.role) }),
      bytes: cached.bytes,
      width: m.width ?? 0,
      height: m.height ?? 0,
    }
  }
  let made = local
  if (!made) {
    const res = await segmentProduct({ bytes, role: photo.role, label: photo.label, gateway: ctx.gateway })
    // cutout_incomplete: a mask was found but it dropped product pieces — never delivered (P0 #4).
    if (!res.ok) return { error: `${res.reason}: ${res.detail}` }
    made = { png: new Uint8Array(res.png), width: res.width, height: res.height, method: res.method, ...(res.recall ? { recall: res.recall.recall } : {}), ...(res.flatLay ? { flatLay: true } : {}), ...(typeof res.backgroundLeak === 'number' ? { backgroundLeak: res.backgroundLeak } : {}) }
    remember(cutoutMemo, key, made)
  }
  const png = made.png
  let url = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
  if (ctx.cache) {
    try {
      url = (await ctx.cache.put(key, png)).url
    } catch {
      // cache best-effort: keep the data URL
    }
  }
  return {
    stored: storedCutout(photo, url, made.method, hash, { recall: made.recall, flatLay: made.flatLay || photo.role === 'contents', backgroundLeak: made.backgroundLeak }),
    bytes: png,
    width: made.width,
    height: made.height,
  }
}

export type PreparedCutouts =
  | { ok: true; hero: LoadedCutout; parts: LoadedCutout[]; warnings: string[]; heroQuality?: AssetQuality }
  | { ok: false; error: string; warnings: string[] }

/**
 * Hero = best photo for the format (role preference, then sharpest / highest-res; never a blurry
 * one when a better exists); tries up to 3 candidates. Parts (role 'part') are cut out one each.
 */
export async function prepareProductCutouts(input: { photos: ProductPhoto[]; format?: AdFormat; language?: AdLanguage; withParts?: boolean } & CutoutContext): Promise<PreparedCutouts> {
  const ctx: CutoutContext = { ...input, memo: input.memo ?? new Map() }
  const warnings: string[] = []
  const pool: PoolImage[] = []
  for (const p of input.photos.filter((x) => x.role !== 'part')) {
    let quality: AssetQuality | undefined
    try {
      const bytes = await sourceBytes(p.url, ctx)
      const qKey = `${sha256Hex(bytes)}:${input.language ?? 'es'}`
      quality = ctx.memo?.get(p.url)?.quality ?? qualityMemo.get(qKey) ?? (await analyzeAssetQuality(bytes, input.language ?? 'es'))
      remember(qualityMemo, qKey, quality)
      ctx.memo?.set(p.url, { bytes, quality })
    } catch {
      quality = undefined
    }
    pool.push({ url: p.url, role: p.role, label: p.label, quality, ...(p.primary ? { primary: true } : {}) })
  }
  if (!pool.length) return { ok: false, error: 'cutout_failed: no product photo', warnings }
  const tried: string[] = []
  let hero: LoadedCutout | null = null
  let heroQuality: AssetQuality | undefined
  const errors: string[] = []
  for (let i = 0; i < 3 && !hero; i++) {
    const pick = pickProductImage(pool, { format: input.format, exclude: tried })
    if (!pick) break
    tried.push(pick.url)
    const photo = input.photos.find((p) => p.url === pick.url) as ProductPhoto
    // C4: a low-resolution hero is upscaled (never redrawn) before the cut-out.
    const res = await cutoutForPhoto(photo, ctx, { upscale: Boolean(pick.quality?.lowResolution) })
    if ('error' in res) errors.push(res.error)
    else {
      hero = res
      heroQuality = pick.quality && res.upscale ? { ...pick.quality, upscaled: true, from: res.upscale.from, to: res.upscale.to } : pick.quality
    }
  }
  if (!hero) {
    const known = errors[0]?.startsWith('cutout_failed') || errors[0]?.startsWith('cutout_incomplete')
    return { ok: false, error: known ? errors.join(' | ').slice(0, 480) : `cutout_failed: ${errors.join(' | ')}`.slice(0, 480), warnings }
  }
  if (heroQuality?.warnings.length) warnings.push(...heroQuality.warnings)
  const parts: LoadedCutout[] = []
  if (input.withParts !== false) {
    for (const p of input.photos.filter((x) => x.role === 'part').slice(0, 3)) {
      const res = await cutoutForPhoto(p, ctx)
      if ('error' in res) warnings.push(`part "${p.label ?? p.url.slice(0, 40)}" skipped: ${res.error.slice(0, 120)}`)
      else parts.push(res)
    }
  }
  return { ok: true, hero, parts, warnings, ...(heroQuality ? { heroQuality } : {}) }
}

// ---------------------------------------------------------------------------
// Single text-free image (execute_image_generate, bulk posts, campaign pack)
// ---------------------------------------------------------------------------

export interface ExactImageInput {
  gateway: ModelGateway
  photos: ProductPhoto[]
  /** 1:1, 4:5, 9:16, 16:9 (or any w:h). */
  ratio: string
  brandName: string
  offerName: string
  language: AdLanguage
  /** Free-text scene direction (setting / mood only — never product changes). */
  sceneHint?: string
  styleNotes?: string
  palette?: string[]
  allowedProps?: string[]
  /** Product appearance facts that never change (plate prompt, plate check, relight). */
  immutableAttributes?: string[]
  /**
   * Relight (free): 'auto' (default) = deterministic harmonization only; 'ai' = + the guarded
   * image-edit pass. `true` = 'ai' (older callers); `false` = 'auto'.
   */
  relight?: RelightMode | boolean
  cache?: BlobCache | null
  load?: ImageLoader
  variation?: number
  maxPlateRetries?: number
}

export type ExactImageResult =
  | {
      ok: true
      png: Buffer
      width: number
      height: number
      fidelity: FidelityResult & { ssim: number; deltaE: number }
      score: FidelityScore
      costUsd: number
      plateModel: string
      cutout: StoredCutout
      warnings: string[]
    }
  | { ok: false; error: string; costUsd: number; warnings: string[] }

/** Product placement for a single image: centered, lower-middle, ~55% of the width. */
export function singleImageRegion(ratio: string): PlateRegion {
  const v = ratioValue(ratio) ?? 0.5625
  if (v > 1.2) return { x0: 0.32, y0: 0.3, x1: 0.68, y1: 0.86 }
  if (v >= 0.9) return { x0: 0.22, y0: 0.26, x1: 0.78, y1: 0.86 }
  return { x0: 0.2, y0: 0.36, x1: 0.8, y1: 0.84 }
}

/** Output canvas for a ratio (social sizes; other w:h → 1080 on the short side). */
export function outputSize(ratio: string): { width: number; height: number } {
  if (isSupportedImageRatio(ratio)) return RATIO_OUTPUT_SIZE[ratio]
  const v = ratioValue(ratio) ?? 0.5625
  return v >= 1 ? { width: Math.round(1080 * v), height: 1080 } : { width: 1080, height: Math.round(1080 / v) }
}

function minimalDna(input: ExactImageInput): BrandDna {
  return {
    version: 1,
    brandName: input.brandName,
    category: 'other',
    language: input.language,
    register: 'voseo',
    facts: [],
    visual: { styleNotes: input.styleNotes, primaryColor: input.palette?.[0], secondaryColor: input.palette?.[1], accentColor: input.palette?.[2] },
    gaps: [],
    sources: [],
  }
}

export async function generateExactProductImage(input: ExactImageInput): Promise<ExactImageResult> {
  const warnings: string[] = []
  let costUsd = 0
  const cutouts = await prepareProductCutouts({ photos: input.photos, format: 'offer_graphic', language: input.language, withParts: false, gateway: input.gateway, cache: input.cache, load: input.load })
  if (!cutouts.ok) return { ok: false, error: cutouts.error, costUsd, warnings: cutouts.warnings }
  warnings.push(...cutouts.warnings)
  const region = singleImageRegion(input.ratio)
  const light: LightDirection = plateLight(input.variation ?? 0)
  const surface = plateSurface('offer_graphic', input.variation ?? 0)
  const dna = minimalDna(input)
  const offer: OfferInput = { name: input.offerName, facts: [], productImageUrls: [] }
  const size = outputSize(input.ratio)
  const refs = [{ image: input.photos.find((p) => p.url === cutouts.hero.stored.sourceUrl)?.url ?? cutouts.hero.stored.sourceUrl, role: cutouts.hero.stored.role }]
  let plateBytes: Buffer | null = null
  let plateModel = ''
  let hint: string | undefined
  let lastCheck: PlateCheckResult | null = null
  const attempts = 1 + Math.max(0, input.maxPlateRetries ?? 2)
  for (let a = 0; a < attempts && !plateBytes; a++) {
    let plate
    try {
      plate = await generatePlate({ gateway: input.gateway, format: 'offer_graphic', dna, offer, placement: region, light, surface, variation: input.variation, allowedProps: input.allowedProps, immutableAttributes: input.immutableAttributes, sceneBrief: input.sceneHint, draft: false, promptSuffix: hint, ratio: (isSupportedImageRatio(input.ratio) ? input.ratio : '9:16') as AspectRatio })
    } catch (error) {
      warnings.push(`plate attempt ${a + 1} failed: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    costUsd += plate.costUsd
    plateModel = plate.model
    const reframed = await reframeToRatio(plate.bytes, input.ratio, { mode: 'cover' })
    const canvas = await sharp(reframed.bytes).resize(size.width, size.height, { fit: 'cover' }).removeAlpha().png().toBuffer()
    try {
      lastCheck = await checkPlate({ gateway: input.gateway, plateImage: `data:image/png;base64,${canvas.toString('base64')}`, refs, allowedProps: input.allowedProps, placement: region, language: input.language, immutableAttributes: input.immutableAttributes })
      costUsd += lastCheck.costUsd
    } catch (error) {
      warnings.push(`plate check unavailable: ${error instanceof Error ? error.message : String(error)}`)
      lastCheck = null
    }
    if (!lastCheck || lastCheck.ok) plateBytes = canvas
    else hint = lastCheck.extraObjects.length ? PLATE_RETRY_HINT_PROPS : PLATE_RETRY_HINT_PLACEMENT
  }
  if (!plateBytes) {
    const extra = lastCheck?.extraObjects?.length ? `: ${lastCheck.extraObjects.join(', ')}` : ''
    return { ok: false, error: lastCheck ? `scene_props_failed${extra}` : 'scene_failed', costUsd, warnings }
  }
  const area = { x: region.x0 * size.width, y: region.y0 * size.height, w: (region.x1 - region.x0) * size.width, h: (region.y1 - region.y0) * size.height }
  const box = fitBox({ width: cutouts.hero.width, height: cutouts.hero.height }, area, 'bottom')
  // The relight stage is included: light model, shading, white balance + grade, wrap, shadows, grain.
  const comp = await compositeProducts({ base: plateBytes, products: [{ cutout: Buffer.from(cutouts.hero.bytes), box, role: 'hero' }], light, surface })
  let png = comp.png
  let method: FidelityResult['method'] = comp.harmonized ? 'harmonized' : 'composite'
  if (input.relight === 'ai' || input.relight === true) {
    const rl = await relightComposite({ gateway: input.gateway, composite: png, placements: comp.placements, ratio: input.ratio, immutableAttributes: input.immutableAttributes })
    costUsd += rl.costUsd
    if (rl.relit) {
      png = rl.png
      method = 'relit'
    } else if (rl.reason) warnings.push(rl.reason)
  }
  const p0 = comp.placements[0]
  const score = await scoreFidelity({ image: png, box: p0.box, reference: p0.placed, ...(p0.background ? { background: p0.background } : {}), method, diff: true })
  if (!score.passed) return { ok: false, error: `fidelity_failed: ${fidelityFailReason(score)}`, costUsd, warnings }
  return {
    ok: true,
    png,
    width: size.width,
    height: size.height,
    fidelity: { ...toFidelityResult(score), ssim: score.ssim, deltaE: score.deltaE, ratio: input.ratio as AspectRatio },
    score,
    costUsd,
    plateModel,
    cutout: cutouts.hero.stored,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Tool-facing helpers (MCP execute_image_generate, bulk posts, campaign pack)
// ---------------------------------------------------------------------------

export type ToolProductFidelity = 'exact' | 'generated'

/**
 * `productFidelity` for single-image tools: default 'exact' when a product reference exists;
 * 'generated' when asked or without a product photo. Exact without a photo is an input error.
 */
export function resolveToolProductFidelity(raw: unknown, hasProductRef: boolean): ToolProductFidelity {
  if (raw !== undefined && raw !== null && raw !== 'exact' && raw !== 'generated') throw new Error('productFidelity must be "exact" or "generated"')
  if (raw === 'exact' && !hasProductRef) throw new Error('productFidelity "exact" needs a product photo (productImageId / product reference).')
  if (raw === 'generated') return 'generated'
  return hasProductRef ? 'exact' : 'generated'
}

/** Photos from plain product URLs (first = hero) for the tools that only know URLs. */
export function photosFromUrls(urls: string[]): ProductPhoto[] {
  return resolveProductPhotos({ productImageUrls: urls.filter(Boolean) })
}

/** Data URL of an exact result (PNG). */
export function exactResultDataUrl(res: Extract<ExactImageResult, { ok: true }>): string {
  return `data:image/png;base64,${res.png.toString('base64')}`
}

/**
 * productFidelity / relight / allowedProps args of the image tools (only present keys, for approval
 * binding). relight: 'auto' (default, omitted) | 'ai' (true accepted) — free either way.
 */
export function parseImageFidelityArgs(args: Record<string, unknown>): { productFidelity?: 'exact' | 'generated'; relight?: 'ai'; allowedProps?: string[] } {
  const out: { productFidelity?: 'exact' | 'generated'; relight?: 'ai'; allowedProps?: string[] } = {}
  if (args.productFidelity !== undefined) {
    if (args.productFidelity !== 'exact' && args.productFidelity !== 'generated') throw new Error('productFidelity must be "exact" or "generated"')
    out.productFidelity = args.productFidelity
  }
  if (args.relight !== undefined && args.relight !== null && args.relight !== true && args.relight !== false && args.relight !== 'ai' && args.relight !== 'auto') throw new Error('relight must be "auto" or "ai"')
  if (args.relight === true || args.relight === 'ai') out.relight = 'ai'
  if (Array.isArray(args.allowedProps)) {
    const props = args.allowedProps.filter((p): p is string => typeof p === 'string').map((p) => p.trim().slice(0, 160)).filter(Boolean).slice(0, 12)
    if (props.length) out.allowedProps = props
  }
  return out
}
