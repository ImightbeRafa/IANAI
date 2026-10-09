/**
 * Ad Pack engine — vision check of a generated scene (Gemini Flash via gateway.visionJson).
 *
 * Answers: is the product identical to the reference (shape / color / label / immutable
 * attributes)? Is there stray or garbled text outside the product's own label? Is there clean
 * space for the headline? Are there extra product parts / accessories that are not in the real
 * photos nor in allowedProps (A3/H3)? Where is the product (bbox for the text layout, H4)?
 * Returns a 0–1 score. No product reference → productMatches null.
 */
import { AMBIENT_PROPS, asObjectList, cleanProps, partsLine, type PropsReference } from './fidelity/plate.js'
import type { AdLanguage, ModelGateway, SceneCheckResult } from './types.js'

export interface CheckSceneInput {
  gateway: ModelGateway
  /** Scene as URL or data URL. */
  sceneImage: string
  /** Product reference photo (URL or data URL). */
  productRef?: string | null
  /** Extra real photos (parts, box, contents) with their roles — the scene may only show these. */
  partRefs?: PropsReference[]
  /** Kit objects the owner allows besides the product. */
  allowedProps?: string[]
  /** Appearance facts that must hold ("hélices blancas"). */
  immutableAttributes?: string[]
  language: AdLanguage
  model?: string
}

export interface CheckSceneOutput extends SceneCheckResult {
  costUsd: number
  model: string
}

interface RawSceneCheck {
  productMatches?: unknown
  strayText?: unknown
  borders?: unknown
  headlineSpace?: unknown
  extraObjects?: unknown
  productBox?: unknown
  score?: unknown
  notes?: unknown
}

const asBool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['true', 'yes', 'si', 'sí'].includes(s)) return true
    if (['false', 'no'].includes(s)) return false
  }
  return null
}

/** [y0, x0, y1, x1] 0–1000 or undefined. */
export function asBox2d(v: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 4) return undefined
  const n = v.map((x) => Number(x))
  if (n.some((x) => !Number.isFinite(x))) return undefined
  const [y0, x0, y1, x1] = n.map((x) => Math.max(0, Math.min(1000, Math.round(x))))
  if (y1 - y0 < 10 || x1 - x0 < 10) return undefined
  return [y0, x0, y1, x1]
}

const cleanAttrs = (list: string[] | undefined) =>
  [...new Set((list ?? []).map((a) => String(a ?? '').replace(/[\r\n"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean))].slice(0, 8)

export function buildSceneCheckPrompt(
  hasRef: boolean,
  language: AdLanguage,
  opts: { partRefs?: PropsReference[]; allowedProps?: string[]; immutableAttributes?: string[] } = {},
): { system: string; user: string } {
  const attrs = cleanAttrs(opts.immutableAttributes)
  const parts = (opts.partRefs ?? []).slice(0, 2)
  const allowed = [...AMBIENT_PROPS, ...cleanProps(opts.allowedProps)]
  const system = [
    'You are a strict QA reviewer for social-media ad images. Reply with JSON only.',
    'Schema: {"productMatches": boolean|null, "strayText": boolean, "borders": boolean, "headlineSpace": boolean, "extraObjects": string[], "productBox": [y0, x0, y1, x1] | null, "score": number (0-1), "notes": string}',
  ].join('\n')
  const user = [
    hasRef
      ? `Image 1 is the generated scene. Image 2 is the real product reference photo.${parts.length ? ` ${partsLine(parts).replace(/Reference (\d)/g, (_, d) => `Image ${Number(d) + 1}`)} are real photos of its other parts.` : ''}`
      : 'Image 1 is the generated scene. There is no product reference: set productMatches to null.',
    hasRef
      ? 'productMatches: true only if the product in the scene is the same product as the reference — identical shape, proportions, colors and label design. A different, redrawn or distorted product is false. If the label faces the camera, its graphic and brand wording must be there as in the reference: a blank, missing or rewritten label is false.'
      : '',
    hasRef && attrs.length ? `These attributes must be exactly as stated, otherwise productMatches is false: ${attrs.join('; ')}.` : '',
    hasRef
      ? `extraObjects: list product parts, accessories, devices, cables, remotes/controllers, spare pieces or packaging in the scene that do NOT appear in the real photos (e.g. a loose propeller, a USB cable, a different remote). Allowed and NOT errors: ${allowed.join(', ')}. Empty list when there are none.`
      : 'extraObjects: return an empty list.',
    'strayText: true if there is ANY text, letters, numbers, logos, watermarks or signage anywhere other than the printed label of the product itself, or if the product label text looks garbled.',
    'borders: true if the photo does not fill the whole frame: blank, white or solid bars at the top/bottom/sides, a frame or border, letterboxing, or a collage of separate panels (a single photo split down the middle for a before/after comparison is fine).',
    'headlineSpace: true if the upper third has clean, low-detail space where a headline could be overlaid.',
    'productBox: the 2D bounding box of the main product in image 1 as [y0, x0, y1, x1] normalized to 0-1000, or null when no product is visible.',
    'score: overall usability as an ad background (0 = unusable, 1 = perfect).',
    `notes: one short sentence in ${language === 'es' ? 'Spanish' : 'English'} explaining the main problem, or empty.`,
  ]
    .filter(Boolean)
    .join('\n')
  return { system, user }
}

export async function checkScene(input: CheckSceneInput): Promise<CheckSceneOutput> {
  const hasRef = Boolean(input.productRef)
  const partRefs = hasRef ? (input.partRefs ?? []).slice(0, 2) : []
  const prompt = buildSceneCheckPrompt(hasRef, input.language, { partRefs, allowedProps: input.allowedProps, immutableAttributes: input.immutableAttributes })
  const images = hasRef ? [input.sceneImage, input.productRef as string, ...partRefs.map((p) => p.image)] : [input.sceneImage]
  const res = await input.gateway.visionJson<RawSceneCheck>({ ...prompt, images, model: input.model })
  const raw = (res.data ?? {}) as RawSceneCheck
  const productMatches = hasRef ? asBool(raw.productMatches) : null
  const strayText = asBool(raw.strayText)
  const headlineSpace = asBool(raw.headlineSpace)
  const borders = asBool(raw.borders)
  const extraObjects = hasRef ? asObjectList(raw.extraObjects) : []
  const productBox = asBox2d(raw.productBox)
  const n = Number(raw.score)
  const score = Number.isFinite(n) ? Math.max(0, Math.min(1, n > 1 && n <= 10 ? n / 10 : n)) : 0.5
  const ok = productMatches !== false && strayText !== true && borders !== true && headlineSpace !== false && extraObjects.length === 0
  const notes = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 300) : undefined
  return {
    ok,
    productMatches,
    strayText,
    borders,
    score,
    ...(extraObjects.length ? { extraObjects } : {}),
    ...(productBox ? { productBox } : {}),
    ...(notes ? { notes } : {}),
    costUsd: res.costUsd ?? 0,
    model: res.model,
  }
}
