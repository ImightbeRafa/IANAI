/**
 * Render-engine types (additive to ../types.ts; nothing there is changed).
 */
import type { AdCopy, AdFormat, AdLanguage, AspectRatio, DnaVisual } from '../types.js'

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
  product: Box | null
  logo: Box | null
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
}
