/**
 * Product fidelity — background plate (exact mode, A1/A3/H3).
 *
 * The image model draws ONLY the setting: an empty surface with a clear placement area that
 * matches the layout's product box, the light direction stated, and nothing that could be
 * mistaken for the product or its parts. The real product is composited later (composite.ts).
 * `checkPlate` is the props/parts vision check: anything that looks like a device, part,
 * accessory, cable, packaging or text fails the plate (retry ≤ 2 → `scene_props_failed`).
 */
import { SCENE_COMPOSITION_RULES, SCENE_STRICT_NO_TEXT, SCENE_RATIO, sceneSetting } from '../scene.js'
import { imageSize } from '../image-size.js'
import type { AdFormat, AdLanguage, AspectRatio, BrandDna, LightDirection, ModelGateway, OfferInput, PlateSurface, ProductPhotoRole } from '../types.js'

/** Ambient props always allowed in a plate / scene (never product parts). */
export const AMBIENT_PROPS = ['table', 'plants', 'fabric', 'light', 'wall texture'] as const

/** Normalized region of the plate (0–1, plate coordinates). */
export interface PlateRegion {
  x0: number
  y0: number
  x1: number
  y1: number
}

const LIGHTS: LightDirection[] = ['left', 'right']

export function plateLight(variation = 0): LightDirection {
  return LIGHTS[Math.abs(Math.floor(variation)) % LIGHTS.length]
}

export function lightPhrase(light: LightDirection): string {
  return light === 'left' ? 'soft key light from the upper left, shadows falling to the right' : light === 'right' ? 'soft key light from the upper right, shadows falling to the left' : 'soft overhead key light, short shadows straight down'
}

/**
 * Surface the plate is prompted with. Studio-like formats (explainer / steps) get a glossy
 * surface on the first variation so the relight stage can add a real reflection; everything
 * else stays matte (wood, fabric, stone…), where a reflection would look fake.
 */
export function plateSurface(format: AdFormat, variation = 0): PlateSurface {
  return (format === 'explainer' || format === 'how_to_steps') && Math.abs(Math.floor(variation)) % 2 === 0 ? 'glossy' : 'matte'
}

export function surfacePhrase(surface: PlateSurface): string {
  return surface === 'glossy'
    ? 'a smooth glossy surface (lacquer, acrylic or polished stone) that would show a soft reflection'
    : 'a matte surface (wood, fabric, paper or stone) with no mirror-like reflections'
}

/** Plain words for a normalized region ("the right half, from 35% to 80% of the height"). */
export function describeRegion(r: PlateRegion): string {
  const cx = (r.x0 + r.x1) / 2
  const horiz = r.x1 - r.x0 > 0.7 ? 'across the center' : cx < 0.4 ? 'in the left half' : cx > 0.6 ? 'in the right half' : 'in the center'
  const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
  return `${horiz}, from ${pct(r.y0)} to ${pct(r.y1)} of the height and ${pct(r.x0)} to ${pct(r.x1)} of the width`
}

/** Plate settings per format: the product is NOT in the picture, so person/hand settings become surfaces. */
function plateSetting(format: AdFormat, variation: number): string {
  if (format === 'ugc_person' || format === 'handheld_overlay') {
    return [
      'A real everyday place where this kind of product is used (home, desk, kitchen or outdoors as fits), natural daylight, a clean surface in the foreground, background softly blurred.',
      'Bright room by a window, natural daylight, a clean tabletop in the foreground, relaxed lived-in feel, background softly blurred.',
    ][Math.abs(Math.floor(variation)) % 2]
  }
  if (format === 'explainer' || format === 'how_to_steps') {
    return [
      'Clean light backdrop with a smooth surface, soft studio light, calm and uncluttered.',
      'Soft colored backdrop from the brand palette with a smooth surface, calm and uncluttered.',
    ][Math.abs(Math.floor(variation)) % 2]
  }
  if (format === 'before_after') {
    return 'The real place where this product is used, the same framing across the frame, calm and uncluttered; no product, packaging or bottle anywhere.'
  }
  // offer_graphic / variant_card: reuse the scene settings but strip any "with the product" wording.
  return sceneSetting(format, variation).replace(/\b(beside|next to|around|with) the product[^.]*\./gi, '.')
}

export interface BuildPlatePromptInput {
  format: AdFormat
  dna: BrandDna
  offer: OfferInput
  /** Where the product will be placed (plate coordinates, 0–1). */
  placement: PlateRegion
  light: LightDirection
  /** Surface type of the placement area (default matte). */
  surface?: PlateSurface
  variation?: number
  allowedProps?: string[]
  /** Scene brief from the copy (already stripped of on-image copy by the caller). */
  sceneBrief?: string
  /** Plate ratio (default 9:16, cover-fit to the pack ratios). */
  ratio?: AspectRatio
}

function visualLine(dna: BrandDna): string {
  const v = dna.visual ?? {}
  const colors = [v.primaryColor, v.secondaryColor, v.accentColor].filter(Boolean)
  return [v.styleNotes ? `Brand visual style: ${v.styleNotes}.` : '', colors.length ? `Palette accents (background tones, fabric, light): ${colors.join(', ')}.` : ''].filter(Boolean).join(' ')
}

/** Kit props the owner allows (sanitized, ≤ 8, ≤ 40 chars). */
export function cleanProps(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((p) => String(p ?? '').replace(/[\r\n"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, 8)
}

/** Remove any mention of devices/parts/the product from a free-text brief (plates must be empty). */
function plateBrief(brief: string | undefined): string {
  const s = String(brief ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  // Keep only mood / setting words: drop sentences that talk about the product or objects in hand.
  return s
    .split(/(?<=[.!?])\s+/)
    .filter((sent) => !/\b(product|bottle|box|package|device|hand|holding|kit|remote|controller|cable|propeller|frasco|caja|control|cable|mano)\b/i.test(sent))
    .join(' ')
    .slice(0, 300)
}

export function buildPlatePrompt(input: BuildPlatePromptInput): string {
  const props = cleanProps(input.allowedProps)
  const ambient = [...AMBIENT_PROPS, ...props]
  const mood = plateBrief(input.sceneBrief)
  return [
    `Text-free advertising background photo, ${input.ratio ?? SCENE_RATIO} ${(input.ratio ?? SCENE_RATIO) === '16:9' ? 'landscape' : (input.ratio ?? SCENE_RATIO) === '1:1' ? 'square' : 'vertical'}, for ${input.offer.name ? `a product called "${input.offer.name.slice(0, 80)}"` : 'a product'} that will be placed into it afterwards.`,
    `Setting: ${plateSetting(input.format, input.variation ?? 0)}`,
    mood ? `Mood: ${mood}` : '',
    `Leave a clear, empty, flat placement area ${describeRegion(input.placement)}: a visible surface (tabletop, floor or pedestal) in perspective, in focus, with nothing on it, where the product will stand.`,
    `Surface: ${surfacePhrase(input.surface ?? 'matte')}.`,
    `Lighting: ${lightPhrase(input.light)}; consistent shadows on the surface.`,
    'STRICT: the image must contain NO product, no devices, no electronics, no parts, no accessories, no cables, no remotes or controllers, no packaging or boxes, no bottles, no tools, no text and no logos. No people and no hands.',
    `Only these ambient props are allowed, sparingly and away from the placement area: ${ambient.join(', ')}.`,
    visualLine(input.dna),
    SCENE_COMPOSITION_RULES.replace(/The product is the hero:[^.]*\./, '').trim(),
    SCENE_STRICT_NO_TEXT,
  ]
    .filter(Boolean)
    .join('\n')
}

export interface GeneratedPlate {
  bytes: Uint8Array
  mimeType: string
  width: number
  height: number
  model: string
  costUsd: number
  prompt: string
  light: LightDirection
  surface: PlateSurface
}

export async function generatePlate(input: BuildPlatePromptInput & { gateway: ModelGateway; draft?: boolean; promptSuffix?: string }): Promise<GeneratedPlate> {
  const base = buildPlatePrompt(input)
  const prompt = input.promptSuffix ? `${base}\n${input.promptSuffix}` : base
  // Compose mode: NO product refs (the model must not see — and redraw — the product).
  const res = await input.gateway.scene({ prompt, refs: [], styleRefs: [], ratio: input.ratio ?? SCENE_RATIO, draft: input.draft ?? true, language: input.dna.language })
  if (!res?.bytes?.length) throw new Error('plate_empty_image')
  const size = imageSize(res.bytes) ?? { width: 0, height: 0 }
  return { bytes: res.bytes, mimeType: res.mimeType, width: size.width, height: size.height, model: res.model, costUsd: res.costUsd ?? 0, prompt, light: input.light, surface: input.surface ?? 'matte' }
}

// ---------------------------------------------------------------------------
// Props / parts check (exact plates AND generated scenes)
// ---------------------------------------------------------------------------

export interface PropsReference {
  /** URL or data URL of a real product photo. */
  image: string
  role: ProductPhotoRole
  label?: string
}

export interface PlateCheckResult {
  ok: boolean
  /** Devices / parts / accessories / packaging seen in the plate (must be empty). */
  extraObjects: string[]
  strayText: boolean | null
  borders: boolean | null
  /** True when the placement area is clear. */
  placementClear: boolean | null
  score: number
  notes?: string
  costUsd: number
  model: string
}

const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : typeof v === 'string' ? (/^(true|yes|s[ií])$/i.test(v.trim()) ? true : /^(false|no)$/i.test(v.trim()) ? false : null) : null)

export function asObjectList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.map((x) => String(x ?? '').trim().slice(0, 60)).filter(Boolean))].slice(0, 8)
}

export function partsLine(refs: PropsReference[]): string {
  if (!refs.length) return ''
  return refs.map((r, i) => `Reference ${i + 2}: ${r.label ? `"${r.label.slice(0, 60)}"` : 'product'} (${r.role})`).join('; ')
}

export function buildPlateCheckPrompt(input: { refs: PropsReference[]; allowedProps?: string[]; placement?: PlateRegion; language: AdLanguage }): { system: string; user: string } {
  const allowed = [...AMBIENT_PROPS, ...cleanProps(input.allowedProps)]
  return {
    system: [
      'You are a strict QA reviewer for product-free advertising background plates. Reply with JSON only.',
      'Schema: {"extraObjects": string[], "strayText": boolean, "borders": boolean, "placementClear": boolean, "score": number (0-1), "notes": string}',
    ].join('\n'),
    user: [
      'Image 1 is a background plate that must NOT contain the product or any part of it: the real product will be composited later.',
      input.refs.length ? `The other images are the real product and its parts (${partsLine(input.refs)}). Anything resembling them in image 1 is an error.` : '',
      `extraObjects: list every device, electronic item, product, product part, accessory, cable, remote/controller, propeller, wheel, tool, bottle, box or packaging visible in image 1 (short names). Allowed ambient props that are NOT errors: ${allowed.join(', ')}. Empty list when there are none.`,
      'strayText: true if there is any text, letters, numbers, logo or watermark.',
      'borders: true if the photo does not fill the frame (bars, frames, letterboxing, collage panels).',
      input.placement ? `placementClear: true if the area ${describeRegion(input.placement)} is an empty surface where an object could stand.` : 'placementClear: true if there is an empty surface where an object could stand.',
      'score: overall quality as an ad background (0-1).',
      `notes: one short sentence in ${input.language === 'es' ? 'Spanish' : 'English'} with the main problem, or empty.`,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

export async function checkPlate(input: {
  gateway: ModelGateway
  plateImage: string
  refs: PropsReference[]
  allowedProps?: string[]
  placement?: PlateRegion
  language: AdLanguage
  model?: string
}): Promise<PlateCheckResult> {
  const refs = input.refs.slice(0, 3)
  const prompt = buildPlateCheckPrompt({ refs, allowedProps: input.allowedProps, placement: input.placement, language: input.language })
  const res = await input.gateway.visionJson<Record<string, unknown>>({ ...prompt, images: [input.plateImage, ...refs.map((r) => r.image)], model: input.model })
  const raw = (res.data ?? {}) as Record<string, unknown>
  const extraObjects = asObjectList(raw.extraObjects)
  const strayText = asBool(raw.strayText)
  const borders = asBool(raw.borders)
  const placementClear = asBool(raw.placementClear)
  const n = Number(raw.score)
  const score = Number.isFinite(n) ? Math.max(0, Math.min(1, n > 1 && n <= 10 ? n / 10 : n)) : 0.5
  const notes = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 300) : undefined
  return {
    ok: extraObjects.length === 0 && strayText !== true && borders !== true && placementClear !== false,
    extraObjects,
    strayText,
    borders,
    placementClear,
    score,
    ...(notes ? { notes } : {}),
    costUsd: res.costUsd ?? 0,
    model: res.model,
  }
}

export const PLATE_RETRY_HINT_PROPS =
  'IMPORTANT: the previous attempt contained objects that look like a product, device, part, cable or packaging. Remove them all: only the empty surface and the allowed ambient props.'
export const PLATE_RETRY_HINT_PLACEMENT = 'IMPORTANT: the placement area must be an empty, visible, in-focus surface with nothing on it.'
