/**
 * Ad Pack render engine — deterministic text-on-image ads (satori → resvg → sharp).
 * See ./README.md.
 */
export { renderAd, renderAdAllRatios, mapSceneBox } from './render.js'
export {
  resolveFonts,
  matchFamily,
  measureText,
  hasAllGlyphs,
  missingGlyphs,
  registerFont,
  hasFamily,
  BUNDLED_FAMILIES,
  type ResolvedFonts,
  type FamilyName,
  type FontRef,
  type BundledFamily,
} from './fonts.js'
export { ensureBrandFonts, GLYPH_SAMPLE, type FontResolution, type FontResolverOptions, type FetchLike } from './font-resolver.js'
export { ALL_FAMILIES, FAMILY_SPECS, familySceneHint, isLayoutFamily, type LayoutFamily, type FamilySpec } from './families.js'
export { makeFrame, copySpaceHint, RATIO_SIZE, ALL_RATIOS, type Frame } from './frame.js'
export { ALL_FORMATS } from './templates.js'
export { contrastRatio, luminance, parseColor } from './color.js'
export type { Box, ImageInput, LayoutReport, LayoutTextElement, NormalizedBox, RenderAdInput, RenderAdResult, TextRole } from './types.js'
