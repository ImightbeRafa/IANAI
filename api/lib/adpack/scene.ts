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
import { escapeRegExp } from './util.js'
import type { AdAngle, AdCopy, AspectRatio, BrandDna, ModelGateway, OfferInput } from './types.js'

/** Ratio every scene is generated at (tallest; cover-fit to the others). */
export const SCENE_RATIO: AspectRatio = '9:16'

export const SCENE_STRICT_NO_TEXT =
  'STRICT: no text, letters, numbers, logos, watermarks, signage, captions, price tags or UI anywhere in the image. Packaging text must remain exactly as in the product photo only; never add, invent or rewrite any lettering.'

export const SCENE_COMPOSITION_RULES = [
  'Composition: main subject centered with generous margins on every side (the image is cropped to 1:1, 4:5 and 9:16), nothing important near the edges.',
  'Keep the upper third clean, calm negative space for a headline overlay; leave a quiet band at the bottom for a button.',
  'Realistic photography, social-ad quality: sharp focus on the product, natural lighting, true-to-life colors and materials, no illustration or 3D-render look.',
].join(' ')

export interface BuildScenePromptInput {
  copy: AdCopy
  angle: AdAngle
  dna: BrandDna
  offer: OfferInput
  /** Style anchor (first scene of the pack) is attached as a reference image. */
  anchor?: { imageUrl: string } | null
}

/** Remove any on-image copy strings that leaked into the scene brief. */
function stripCopyText(brief: string, copy: AdCopy): string {
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
  const lines = [
    `Text-free advertising photo for a ${dna.category.replace(/_/g, ' ')} brand.`,
    hasProductRef
      ? 'Use the attached product photo as the exact product: identical shape, colors, materials and label.'
      : `Product to show: ${offer.name} (show the object only, do not write its name).`,
    brief ? `Scene: ${brief}` : '',
    `Format intent: ${pattern.sceneIntent}`,
    `Layout the overlay will use (for spacing only, never draw it): ${pattern.layout.en}`,
    pattern.needsPerson ? 'Include a real person naturally interacting with the product; natural skin, hands and proportions.' : '',
    visualStyleLine(dna),
    input.anchor ? 'Match the lighting, color grading and photographic style of the attached style reference so the pack looks like one campaign; do not copy its subject.' : '',
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
