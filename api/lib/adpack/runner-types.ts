/**
 * Ad Pack engine — injectable dependencies of the pack runner.
 *
 * The runner never imports the renderer, storage or credits directly so tests
 * and the benchmark inject fakes, and the web / MCP doors inject real ones.
 */
import type { AdCopy, AdFormat, AdLanguage, AspectRatio, DnaVisual, LayoutFamily, LightDirection, PlateSurface, FontsUsed } from './types.js'

/** Placement of a real-product cut-out in a render (canvas px). */
export interface RenderProductPlacement {
  box: { x: number; y: number; w: number; h: number }
  /** The cut-out resized to the box, before harmonization (PNG) — the fidelity reference. */
  placed: Uint8Array
  role: 'hero' | 'part'
  /** The plate behind the box before the product (PNG, box size): fidelity silhouette background. */
  background?: Uint8Array
}

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
  /** 'exact': the cut-out is the product on EVERY format (real pixels composited on the plate). */
  productMode?: 'exact' | 'overlay'
  /** Real part cut-outs placed next to the hero (offer_graphic / explainer, exact mode). */
  productParts?: Array<Uint8Array | string>
  /** Plate light direction (shading / shadow side). */
  light?: LightDirection
  /** Plate surface (glossy → reflection). */
  surface?: PlateSurface
  /** Logo override (already background-removed bytes); falls back to visual.logoUrl. */
  logo?: Uint8Array | string
  /** Optional AI relight hook (relight 'ai') on the harmonized text-free composite (exact mode). Returns null to keep it. */
  relight?: (composite: Uint8Array, placements: RenderProductPlacement[], ratio: AspectRatio) => Promise<Uint8Array | null>
  /** Visual layout family (default bold_pill). Every family supports exact and generated mode. */
  layoutFamily?: LayoutFamily
  /**
   * Generated mode: where the scene's product sits (fractions 0–1 of the scene, from the vision
   * check bbox). Exact mode ignores it: the composite's own placement is the product box.
   * Copy is never drawn over the product box in either mode.
   */
  productBox?: { x: number; y: number; w: number; h: number }
}

export interface RenderOutput {
  png: Uint8Array
  width: number
  height: number
  /** Exact mode: where each real cut-out landed (for the fidelity score). */
  productPlacements?: RenderProductPlacement[]
  /** True when the deterministic relight stage ran (exact mode). */
  harmonized?: boolean
  /** True when the AI relight pass was kept. */
  relit?: boolean
  /** True when some text could not be kept off the product box. */
  textOverProduct?: boolean
  /** Layout family + placement variant actually used. */
  layoutFamily?: LayoutFamily
  placement?: string
  /** #9: fonts actually drawn (+ fallbacks). */
  fontsUsed?: FontsUsed
}

/** Deterministic text layer (Satori → resvg). Real impl: `./render` (see render-adapter.ts). */
export interface Renderer {
  render(input: RenderInput): Promise<RenderOutput>
}

export type StoredAssetKind = 'scene' | 'plate' | `render-${string}` | `fidelity-${string}` | `cache-${string}`

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
  /** Upsert at a deterministic path (content-addressed caches). Optional. */
  uploadAt?(input: { path: string; bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' }): Promise<{ url: string }>
  /** Read a deterministic path; null when missing. Optional. */
  download?(path: string): Promise<{ bytes: Uint8Array; url: string } | null>
}

/**
 * Idempotent credit charge for one ad. Must be safe to call twice with the same
 * `generationId` (e.g. `consumeCredits`), the runner calls it once per transition.
 */
export type ChargeFn = (input: { userId: string; generationId: string }) => Promise<{ charged: boolean } | void>
