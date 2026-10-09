/**
 * Ad Pack engine — injectable dependencies of the pack runner.
 *
 * The runner never imports the renderer, storage or credits directly so tests
 * and the benchmark inject fakes, and the web / MCP doors inject real ones.
 */
import type { AdCopy, AdFormat, AdLanguage, AspectRatio, DnaVisual, LayoutFamily } from './types.js'

export interface RenderInput {
  format: AdFormat
  ratio: AspectRatio
  /** Text-free scene: bytes, data URL or public URL. Cover-fit to `ratio`. */
  sceneImage: Uint8Array | string
  copy: AdCopy
  visual: DnaVisual
  /** Optional transparent product cut-out (URL / data URL / bytes). */
  productCutout?: Uint8Array | string
  language: AdLanguage
  /** Visual layout family (default bold_pill). */
  layoutFamily?: LayoutFamily
  /** Product position in the scene (fractions); copy is never drawn over it. */
  productBox?: { x: number; y: number; w: number; h: number }
}

export interface RenderOutput {
  png: Uint8Array
  width: number
  height: number
}

/** Deterministic text layer (Satori → resvg). Real impl: `./render` (see render-adapter.ts). */
export interface Renderer {
  render(input: RenderInput): Promise<RenderOutput>
}

export type StoredAssetKind = 'scene' | `render-${string}`

export interface UploadInput {
  userId: string
  packId: string
  itemIndex: number
  kind: StoredAssetKind
  bytes: Uint8Array
  contentType: 'image/png' | 'image/jpeg'
}

/** Public asset storage (Supabase `post-images` in prod). */
export interface AdPackStorage {
  upload(input: UploadInput): Promise<{ url: string }>
}

/**
 * Idempotent credit charge for one ad. Must be safe to call twice with the same
 * `generationId` (e.g. `consumeCredits`), the runner calls it once per transition.
 */
export type ChargeFn = (input: { userId: string; generationId: string }) => Promise<{ charged: boolean } | void>
