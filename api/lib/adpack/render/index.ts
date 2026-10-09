/**
 * Ad Pack render engine — deterministic text-on-image ads (satori → resvg → sharp).
 * See ./README.md.
 */
export { renderAd, renderAdAllRatios, planLayout, planProductBoxes, mapSceneBox, placeProductAndAvoidText } from './render.js'
export { prepareLogo, pickLogoVariant, cachedLogo, type LogoVariants } from './logo.js'
export { resolveFonts, matchFamily, measureText, hasAllGlyphs, type ResolvedFonts, type FamilyName, type FontRef } from './fonts.js'
export { makeFrame, copySpaceHint, RATIO_SIZE, ALL_RATIOS, EXTENDED_RATIOS, type Frame } from './frame.js'
export { ALL_FORMATS } from './templates.js'
export { contrastRatio, luminance, parseColor } from './color.js'
export type { Box, ImageInput, LayoutReport, LayoutTextElement, RenderAdInput, RenderAdResult, TextRole } from './types.js'
