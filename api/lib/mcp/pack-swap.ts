/**
 * MCP 0.26.0 — printed packs / pouches / boxes: the model designs the WHOLE ad with the real pack photo as the reference, then the
 * REAL pack pixels are swapped into the located product box (deterministic, no paid generation).
 *
 *   located box (feature match of the reference photo in the generated ad; confident only)
 *     → real cut-out of the same photo (in-process cut-out cache; local flood first, one Gemini segmentation only when the flood fails)
 *     → scaled to cover the redrawn pack (same aspect within 35 %, else no swap)
 *     → composited with the existing harmonize / relight stage (light model, white balance + grade match, contact shadow, light wrap, grain)
 *
 * The rest of the ad (typography, CTA, logo the model drew) is not regraded. When the box cannot be located confidently, or the shape
 * differs (another view of the pack), the generated image is kept and the report says why — never another generation.
 */
import sharp from 'sharp'
import { compositeProducts } from '../adpack/fidelity/composite.js'
import { cutoutForPhoto } from '../adpack/fidelity/pipeline.js'
import type { ModelGateway } from '../adpack/types.js'

export type NBox = { x0: number; y0: number; x1: number; y1: number }

export type PackSwapReport = {
  applied: boolean
  reason: string
  /** Where the real pack was placed (fractions of the image). */
  box?: NBox
  /** How the cut-out was made: 'alpha' | 'flood' | 'model' | 'cache'. */
  cutout?: string
}

/** Aspect tolerance between the located box and the real cut-out (a pack shown from another side is not swapped). */
export const PACK_SWAP_ASPECT_MAX = 1.35
/** The located box must cover at least this share of the image width / height. */
export const PACK_SWAP_MIN_SIDE = 0.08
/** The cut-out is scaled to cover the redrawn pack plus this margin, so no redrawn edge peeks out. */
const COVER_MARGIN = 1.04

const decode = (dataUrl: string): Uint8Array => new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))

export async function swapRealPackPixels(input: {
  /** The generated ad (any raster). */
  generated: Buffer
  /** The real pack photo the model got as the product reference (data URL). */
  referenceDataUrl: string
  /** Located product box (fractions) from the free fidelity check. */
  productBox?: NBox | null
  /** true only when the box comes from a feature match (not a colour guess). */
  confident: boolean
  /** Segmentation fallback (Gemini) — used only when the local flood cannot cut the photo. */
  gateway?: Pick<ModelGateway, 'segment'>
}): Promise<{ bytes: Buffer; report: PackSwapReport }> {
  const keep = (reason: string) => ({ bytes: input.generated, report: { applied: false, reason } })
  const b = input.productBox
  if (!input.confident || !b) return keep('the pack was not located confidently in the generated ad (feature match): the generated image is kept')
  const meta = await sharp(input.generated).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  if (!W || !H) return keep('generated image has no size')
  const bw = (b.x1 - b.x0) * W
  const bh = (b.y1 - b.y0) * H
  if (b.x1 - b.x0 < PACK_SWAP_MIN_SIDE || b.y1 - b.y0 < PACK_SWAP_MIN_SIDE) return keep('the located pack box is too small to swap reliably: the generated image is kept')
  if (!input.referenceDataUrl.startsWith('data:')) return keep('the reference photo is not inline')

  const cut = await cutoutForPhoto({ url: input.referenceDataUrl, role: 'hero' }, { gateway: input.gateway, load: async (u) => decode(u) })
  if ('error' in cut) return keep(`real cut-out unavailable (${cut.error.slice(0, 120)}): the generated image is kept`)
  const aspectCut = cut.width / Math.max(1, cut.height)
  const aspectBox = bw / Math.max(1, bh)
  const ratio = Math.max(aspectCut, aspectBox) / Math.max(1e-6, Math.min(aspectCut, aspectBox))
  if (ratio > PACK_SWAP_ASPECT_MAX) return keep(`the located box (${aspectBox.toFixed(2)}) and the real pack (${aspectCut.toFixed(2)}) have different shapes (another side / angle): the generated image is kept`)

  const s = Math.max(bw / cut.width, bh / cut.height) * COVER_MARGIN
  const w = Math.min(W, Math.round(cut.width * s))
  const h = Math.min(H, Math.round(cut.height * s))
  const cx = ((b.x0 + b.x1) / 2) * W
  const x = Math.round(Math.min(W - w, Math.max(0, cx - w / 2)))
  // Bottom-aligned on the redrawn pack's base (its ground line), a hair lower so the cover margin goes up, not into the surface.
  const y = Math.round(Math.min(H - h, Math.max(0, b.y1 * H + (h - bh) * 0.1 - h)))
  const comp = await compositeProducts({ base: input.generated, products: [{ cutout: Buffer.from(cut.bytes), box: { x, y, w, h }, role: 'hero' }], gradeBase: false })
  const bytes = await sharp(comp.png).jpeg({ quality: 93 }).toBuffer()
  return {
    bytes,
    report: { applied: true, reason: 'real pack pixels swapped into the located box (harmonized, contact shadow; no paid generation)', box: { x0: x / W, y0: y / H, x1: (x + w) / W, y1: (y + h) / H }, cutout: cut.stored.method },
  }
}
