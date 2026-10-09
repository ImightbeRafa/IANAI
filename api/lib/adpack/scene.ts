/**
 * Ad Pack engine — text-free scene prompt + generation.
 *
 * One scene per ad at the tallest ratio (9:16); the renderer cover-fits it to
 * 1:1 / 4:5 / 9:16, so the subject stays centered with generous margins and the
 * upper third stays clean for the headline. The scene NEVER carries ad copy:
 * all text is rendered deterministically by the template layer.
 */
import { SCENE_NO_TEXT_CLAUSE } from './copy-shared.js'
import { getFormatPattern } from './patterns.js'
import { imageSize } from './image-size.js'
import { FAMILY_SPECS, familySceneHint } from './render/families.js'
import { copySpaceHint } from './render/frame.js'
import { escapeRegExp } from './util.js'
import { cleanAttributes } from './fidelity/photos.js'
import type { AdAngle, AdCopy, AdFormat, AspectRatio, BrandDna, BusinessCategory, ModelGateway, OfferInput } from './types.js'

/** Ratio every scene is generated at (tallest; cover-fit to the others). */
export const SCENE_RATIO: AspectRatio = '9:16'
/** Copy-space hint follows the main feed ratio (4:5): its layout is the one most ads are judged in. */
export const SCENE_SPACE_RATIO: AspectRatio = '4:5'

export const SCENE_STRICT_NO_TEXT =
  'STRICT: no text, letters, numbers, logos, watermarks, signage, captions, price tags or UI anywhere in the image. Packaging text must remain exactly as in the product photo only; never add, invent or rewrite any lettering.'

export const SCENE_COMPOSITION_RULES = [
  'One full-bleed photograph filling the whole frame edge to edge: no borders, frames, white or blank bars, letterboxing or collage panels.',
  'Composition: the image is center-cropped to 1:1, 4:5 and 9:16, so the top and bottom 20% may be cut; keep the product and any face inside the middle band (roughly 25%–80% of the height) with margins, nothing important near the edges.',
  'Keep the upper third clean, calm negative space for a headline overlay; leave a quiet band at the bottom for a button.',
  'The product is the hero: large (about a third of the frame height or more), sharp, label facing the camera and fully visible, never covered by hands or props.',
  'Realistic photography, social-ad quality: natural lighting, true-to-life colors and materials, no illustration or 3D-render look.',
].join(' ')

/** Plain-language category for the image model (the enum `home_garden` made it paint gardens). */
const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  beauty: 'beauty and skincare',
  health_wellness: 'health and wellness',
  food_beverage: 'food and beverage',
  fashion_apparel: 'fashion and apparel',
  home_garden: 'home and household',
  tech_electronics: 'consumer electronics',
  fitness_sports: 'fitness and sports',
  pets: 'pet products',
  kids_baby: 'kids and baby products',
  services_local: 'local services',
  education: 'education',
  finance: 'financial services',
  other: 'retail',
}

/**
 * Background/setting variations per format, picked by the item's index so a pack
 * does not repeat one look (live benchmark: a shared style anchor made 8/10 scenes the
 * same backdrop, and a garden anchor put a kitchen cleaner in a garden in every ad).
 * Product, brand palette and photographic quality stay constant; the setting rotates.
 */
export const SCENE_SETTINGS: Record<AdFormat, string[]> = {
  offer_graphic: [
    'Seamless studio backdrop in one solid color taken from the brand palette, soft directional light, crisp natural shadow.',
    'Bright, airy light-neutral backdrop (off-white or warm beige) with a single brand-color accent prop, soft daylight.',
    'On a real surface where this product is normally used or kept, daylight, background softly blurred and uncluttered.',
    'Bold color-blocked backdrop (two flat tones from the brand palette meeting behind the product), hard light, graphic shadow.',
  ],
  before_after: [
    'The real place where this product is used. Left half: the everyday problem it solves (or the ordinary alternative), with no bottle, box or packaging of any kind in that half. Right half: the same place and framing, problem solved, with this product clearly visible.',
  ],
  how_to_steps: [
    'The real place where this product is used, daylight, the few items needed to use it laid out next to the product.',
    'Top-down flat lay on a light, clean surface: the product plus the few items needed to use it, arranged on the right side.',
  ],
  variant_card: [
    'Solid or soft-gradient backdrop in the color of the featured variant, with one or two props that express its flavor, color or profile.',
    'Light backdrop with a colored platform matching the featured variant, props that express its flavor, color or profile.',
  ],
  ugc_person: [
    'An everyday location where this product is really used (home, kitchen, bathroom, desk, gym or street as fits the product), casual phone-camera look.',
    'Bright room by a window, natural daylight, relaxed candid moment, casual phone-camera look.',
  ],
  handheld_overlay: [
    'A hand holding the product in the real place where it is used, natural daylight, background softly blurred.',
    'A hand holding the product against a simple bright background (wall, sky or window light), crisp and clean.',
  ],
  explainer: [
    'Clean light backdrop; the product with its real ingredients, materials or parts arranged neatly around it.',
    'Soft colored backdrop from the brand palette; the product with its real ingredients, materials or parts arranged around it.',
  ],
}

export function sceneSetting(format: AdFormat, variation = 0): string {
  const list = SCENE_SETTINGS[format]
  return list[Math.abs(Math.floor(variation)) % list.length]
}

export interface BuildScenePromptInput {
  copy: AdCopy
  angle: AdAngle
  dna: BrandDna
  offer: OfferInput
  /** Optional style anchor attached as a reference image (off by default in the pack runner). */
  anchor?: { imageUrl: string } | null
  /** Rotates the background/setting per item (pack index). */
  variation?: number
  /** Product appearance facts that never change (default: offer.immutableAttributes). */
  immutableAttributes?: string[]
}

/** Remove any on-image copy strings that leaked into the scene brief. */
export function stripCopyText(brief: string, copy: AdCopy): string {
  let out = brief.replace(SCENE_NO_TEXT_CLAUSE, ' ')
  const strings = [copy.headline, copy.subline, copy.cta, copy.offerLine, ...(copy.bullets ?? [])]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length)
  for (const s of strings) out = out.replace(new RegExp(escapeRegExp(s), 'gi'), ' ')
  return out.replace(/["“”«»]\s*["“”«»]/g, ' ').replace(/\s+/g, ' ').trim()
}

function visualStyleLine(dna: BrandDna): string {
  const v = dna.visual ?? {}
  const colors = [v.primaryColor, v.secondaryColor, v.accentColor].filter(Boolean)
  const parts = [
    v.styleNotes ? `Brand visual style: ${v.styleNotes}.` : '',
    colors.length ? `Palette accents (props, background tones, light): ${colors.join(', ')}.` : '',
  ].filter(Boolean)
  return parts.join(' ')
}

export function buildScenePrompt(input: BuildScenePromptInput): string {
  const { copy, angle, dna, offer } = input
  const pattern = getFormatPattern(angle.format)
  const hasProductRef = (offer.productImageUrls ?? []).length > 0
  const brief = stripCopyText(copy.sceneBrief ?? '', copy)
  const attrs = cleanAttributes(input.immutableAttributes ?? offer.immutableAttributes)
  const what = dna.oneLiner ? `${offer.name} (${dna.oneLiner})` : offer.name
  // Non-default layout families put copy elsewhere (side panel, bottom type, inset card…).
  const familyHint = angle.layoutFamily && angle.layoutFamily !== 'bold_pill' ? familySceneHint(angle.layoutFamily, angle.format) : ''
  const lines = [
    `Text-free advertising photo for a ${CATEGORY_LABEL[dna.category] ?? 'retail'} brand. The product is: ${what}.`,
    hasProductRef
      ? 'Use the attached product photo as the exact product: identical shape, colors, materials and label.'
      : 'Show the product object only; do not write its name.',
    hasProductRef && attrs.length ? `These product attributes must stay exactly as in the photo: ${attrs.join('; ')}.` : '',
    hasProductRef
      ? 'Show only the product parts that appear in the attached photos; never add extra parts, accessories, cables, controllers, spare pieces or packaging that are not in them.'
      : '',
    brief ? `Scene: ${brief}` : '',
    `Format intent: ${pattern.sceneIntent}`,
    angle.sceneDirection ? `Angle direction (${angle.category ?? 'angle'}): ${angle.sceneDirection}.` : '',
    `Setting for this ad: ${sceneSetting(angle.format, input.variation)}`,
    `Layout the overlay will use (for spacing only, never draw it): ${familyHint ? FAMILY_SPECS[angle.layoutFamily!].description : pattern.layout.en}`,
    `Placement and empty space (the text overlay covers it; this wins over any placement above): ${familyHint || copySpaceHint(angle.format, SCENE_SPACE_RATIO)}.`,
    pattern.needsPerson ? 'Include a real person naturally interacting with the product; natural skin, hands and proportions.' : '',
    visualStyleLine(dna),
    input.anchor
      ? 'Match only the color grading of the attached style reference so the pack looks like one campaign; do not copy its subject, background, setting or camera angle — this ad needs its own setting.'
      : '',
    SCENE_COMPOSITION_RULES,
    SCENE_STRICT_NO_TEXT,
  ]
  // Copy strings never reach the image model (fixed rule lines are ours and safe).
  return lines
    .filter(Boolean)
    .map((l) => (l === SCENE_STRICT_NO_TEXT || l === SCENE_COMPOSITION_RULES ? l : stripCopyText(l, copy)))
    .filter(Boolean)
    .join('\n')
}

export interface GenerateSceneInput extends BuildScenePromptInput {
  gateway: ModelGateway
  draft?: boolean
  /** Override prompt (e.g. a retry with extra guidance). */
  promptSuffix?: string
}

export interface GeneratedScene {
  bytes: Uint8Array
  mimeType: string
  width: number
  height: number
  model: string
  costUsd: number
  productLocked: boolean
  prompt: string
  ratio: AspectRatio
}

export async function generateScene(input: GenerateSceneInput): Promise<GeneratedScene> {
  const base = buildScenePrompt(input)
  const prompt = input.promptSuffix ? `${base}\n${input.promptSuffix}` : base
  const refs = (input.offer.productImageUrls ?? []).filter(Boolean).slice(0, 2)
  const res = await input.gateway.scene({
    prompt,
    refs,
    styleRefs: input.anchor?.imageUrl ? [input.anchor.imageUrl] : [],
    ratio: SCENE_RATIO,
    draft: input.draft ?? true,
    language: input.dna.language,
  })
  if (!res?.bytes?.length) throw new Error('scene_empty_image')
  const size = imageSize(res.bytes) ?? { width: 0, height: 0 }
  return {
    bytes: res.bytes,
    mimeType: res.mimeType,
    width: size.width,
    height: size.height,
    model: res.model,
    costUsd: res.costUsd ?? 0,
    productLocked: res.productLocked,
    prompt,
    ratio: SCENE_RATIO,
  }
}
