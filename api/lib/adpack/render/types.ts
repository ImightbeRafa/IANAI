/**
 * Render-engine types (additive to ../types.ts; nothing there is changed).
 */
import type { AdCopy, AdFormat, AdLanguage, AspectRatio, DnaVisual, LightDirection, PlateSurface } from '../types.js'
import type { LayoutFamily } from './families.js'
import type { FontResolution, FontResolverOptions } from './font-resolver.js'

/** Raw bytes, an http(s) URL (fetched with global fetch) or a data: URL. */
export type ImageInput = Uint8Array | ArrayBuffer | string

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Box in fractions (0–1) of the scene image's width/height. */
export interface NormalizedBox {
  x: number
  y: number
  w: number
  h: number
}

export interface RenderAdInput {
  format: AdFormat
  ratio: AspectRatio
  /** Text-free scene image. */
  sceneImage: ImageInput
  copy: Pick<AdCopy, 'headline' | 'subline' | 'bullets' | 'offerLine' | 'cta'>
  visual?: DnaVisual
  /** Brand name: rendered as a text wordmark by the studio families when there is no logo asset. */
  brandName?: string
  /** Transparent product cut-out (PNG). Used by offer_graphic, variant_card and explainer. */
  productCutout?: ImageInput
  /** Logo bytes; overrides `visual.logoUrl` (avoids a fetch). */
  logo?: ImageInput
  language: AdLanguage
  /** Visual system (see families.ts). Default 'bold_pill' (the original templates). */
  layoutFamily?: LayoutFamily
  /** Force a placement variant of the family first (e.g. 'right'); others are still tried if text would cover the product. */
  placement?: string
  /**
   * Generated mode: where the product sits in the SCENE image (fractions of its width/height,
   * before cover-fit), from the vision check. Text, chips, cards and panels are never placed over
   * it: the renderer tries the family's placement variants (and free regions around it) until
   * nothing collides. Exact mode ignores it — the composite's placement is the product box.
   */
  productBox?: NormalizedBox
  /** Brand font loading (network fetch, disk cache). Omitted → bundled/registered fonts only. */
  fonts?: FontResolverOptions
  /** QA/test only: also return the composited background (everything except the top text/UI layer). */
  debug?: { returnBase?: boolean }
  /** 'exact': the real cut-out is the product on every format (composited, harmonized, scored by the caller). */
  productMode?: 'exact' | 'overlay'
  /** Real part cut-outs next to the hero (exact mode, offer_graphic / explainer). */
  productParts?: ImageInput[]
  /** Plate light direction (shadow side). */
  light?: LightDirection
  /** Plate surface (glossy → reflection under the product). */
  surface?: PlateSurface
  /**
   * Overhead (top-down) plate + flat-lay product (P1 #6): no perspective grounding, no cast shadow
   * or reflection — a soft drop shadow directly under each component instead.
   */
  topDown?: boolean
  /**
   * Exact mode relight stage (default true): deterministic harmonization of the product into the
   * plate (light model, shading, white balance + shared grade, light wrap, shadows, reflection,
   * grain). False = plain cut-out + ground shadows (QA comparisons only).
   */
  harmonize?: boolean
  /** @deprecated Corner form of `productBox` (normalized 0–1); folded into `productBox`. */
  productAvoid?: { x0: number; y0: number; x1: number; y1: number }
  /** Exact mode relight hook on the text-free composite; null keeps the deterministic composite. */
  /**
   * Round 1b studio bleed (exact mode): the real photo's own backdrop, shadows and light are kept —
   * the layer (fidelity/bleed.ts) is faded into a procedural studio canvas (`sceneImage`) instead of
   * cutting the product out. No synthetic shadow / relight is added (the photo's are real).
   */
  studioBleed?: { layer: ImageInput; productBox: Box; backdrop: { r: number; g: number; b: number }; edgesTouched?: string[]; preScale?: number }
  relight?: (composite: Buffer, placements: Array<{ box: Box; placed: Buffer; role: 'hero' | 'part'; background?: Buffer }>, ratio: AspectRatio) => Promise<Buffer | Uint8Array | null>
}

export type TextRole = 'headline' | 'subline' | 'bullet' | 'offer' | 'cta' | 'label' | 'step_number'

export interface LayoutTextElement {
  role: TextRole
  /** Exact string drawn (whitespace-normalized input). */
  text: string
  /** How it was broken into lines (joined by ' ' equals `text` unless `fits` is false). */
  lines: string[]
  fontFamily: string
  fontWeight: number
  fontSize: number
  lineHeight: number
  /** Tight box around the drawn lines (px, canvas coordinates). */
  box: Box
  color: string
  align: 'left' | 'center' | 'right'
  /** What the text sits on. */
  background: { kind: 'fill'; color: string } | { kind: 'scene'; treatment: 'none' | 'gradient' | 'box'; alpha: number }
  /** WCAG contrast ratio (fill: exact; scene: vs the 95th-percentile worst background pixel). */
  contrast: number
  fits: boolean
}

export interface LayoutReport {
  format: AdFormat
  ratio: AspectRatio
  width: number
  height: number
  /** Area text is allowed in (Meta safe zones + margins). */
  safeArea: Box
  elements: LayoutTextElement[]
  /** Hero product box (real cut-out), or null. */
  product: Box | null
  /** Every placed real cut-out (hero + parts). */
  productBoxes?: Box[]
  /** Generated mode: the scene product's bbox mapped onto this canvas (text avoided it). */
  productAvoid?: Box | null
  /** True when some text / pill could not be kept off the product. */
  textOverProduct?: boolean
  /**
   * Exact mode grounding (P1 #7): the plate's surface back edge found above the product slot
   * (canvas y, null when none), the product base y, and how far the product was moved down so its
   * base rests on the surface instead of against the wall.
   */
  grounding?: { surfaceLineY: number | null; baseY: number; snappedPx: number }
  /** Round 1b studio bleed: backdrop gain, resample scale (>1 = enlarged, Lanczos-3, not super-res). */
  bleed?: { gain: [number, number, number]; scale: number; upscaled: boolean; edgesTouched: string[] }
  /** 'overhead' when a flat lay was composited on a top-down plate (P1 #6). */
  view?: 'overhead'
  /** Boxes of every text, pill, card and icon drawn over the scene. */
  overlays?: Box[]
  logo: Box | null
  /** Logo variant used for this background. */
  logoVariant?: 'onLight' | 'onDark' | 'badge'
  /** Which kit logo was placed (primary / light / dark / badge variant). */
  logoSource?: 'primary' | 'light' | 'dark' | 'badge'
  /** True when the placed logo is self-contained (badge, own background): never recolored. */
  logoSelfContained?: boolean
  /** Contrast of the placed logo (its edge, or its chip) vs the region under it. */
  logoContrast?: number
  /** Font-size scale applied to the whole template (1 = nominal). */
  scale: number
  /** Visual family and the placement variant that was used. */
  layoutFamily: LayoutFamily
  placement: string
  /**
   * The product box every family keeps copy off (canvas px): exact mode = the composite's
   * placement (hero + parts), generated mode = the scene bbox mapped through the cover crop;
   * null when there is none.
   */
  productBox: Box | null
  /** False only when copy could not be kept off the product box (textOverProduct; a warning says so). */
  productBoxRespected: boolean
  fonts: { heading: string; body: string; resolution?: { heading: FontResolution['heading']; body: FontResolution['body'] } }
  /** All text fits its box, nothing overflows the canvas/safe area. */
  fits: boolean
  warnings: string[]
}

export interface RenderAdResult {
  png: Buffer
  width: number
  height: number
  layoutReport: LayoutReport
  /** Only with debug.returnBase. */
  basePng?: Buffer
  /** Real cut-outs as placed (pre-harmonization) — fidelity references (+ the plate behind each box). */
  productPlacements?: Array<{ box: Box; placed: Buffer; role: 'hero' | 'part'; background?: Buffer }>
  /** True when the deterministic relight stage ran (exact mode). */
  harmonized?: boolean
  /** Light model summary of the plate (exact mode). */
  light?: Record<string, unknown>
  /** True when the relight hook result was kept. */
  relit?: boolean
}
