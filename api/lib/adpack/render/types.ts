/**
 * Render-engine types (additive to ../types.ts; nothing there is changed).
 */
import type { AdCopy, AdFormat, AdLanguage, AspectRatio, DnaVisual, LightDirection } from '../types.js'

/** Raw bytes, an http(s) URL (fetched with global fetch) or a data: URL. */
export type ImageInput = Uint8Array | ArrayBuffer | string

export interface Box {
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
  /** Transparent product cut-out (PNG). Used by offer_graphic, variant_card and explainer. */
  productCutout?: ImageInput
  /** Logo bytes; overrides `visual.logoUrl` (avoids a fetch). */
  logo?: ImageInput
  language: AdLanguage
  /** QA/test only: also return the composited background (everything except the top text/UI layer). */
  debug?: { returnBase?: boolean }
  /** 'exact': the real cut-out is the product on every format (composited, harmonized, scored by the caller). */
  productMode?: 'exact' | 'overlay'
  /** Real part cut-outs next to the hero (exact mode, offer_graphic / explainer). */
  productParts?: ImageInput[]
  /** Plate light direction (shadow side). */
  light?: LightDirection
  /** Generated mode: product bbox in the scene image, normalized 0–1; text is kept off it. */
  productAvoid?: { x0: number; y0: number; x1: number; y1: number }
  /** Exact mode relight hook on the text-free composite; null keeps the deterministic composite. */
  relight?: (composite: Buffer, placements: Array<{ box: Box; placed: Buffer; role: 'hero' | 'part' }>, ratio: AspectRatio) => Promise<Buffer | Uint8Array | null>
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
  /** Boxes of every text, pill, card and icon drawn over the scene. */
  overlays?: Box[]
  logo: Box | null
  /** Logo variant used for this background. */
  logoVariant?: 'onLight' | 'onDark' | 'badge'
  /** Font-size scale applied to the whole template (1 = nominal). */
  scale: number
  fonts: { heading: string; body: string }
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
  /** Real cut-outs as placed (pre-harmonization) — fidelity references. */
  productPlacements?: Array<{ box: Box; placed: Buffer; role: 'hero' | 'part' }>
  /** True when the relight hook result was kept. */
  relit?: boolean
}
