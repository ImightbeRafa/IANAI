/**
 * Ad Pack engine — vision check of a generated scene (Gemini Flash via gateway.visionJson).
 *
 * Answers: is the product identical to the reference (shape / color / label)?
 * Is there stray or garbled text outside the product's own label? Is there clean
 * space for the headline? Returns a 0–1 score. No product reference → productMatches null.
 */
import type { AdLanguage, ModelGateway, SceneCheckResult } from './types.js'

export interface CheckSceneInput {
  gateway: ModelGateway
  /** Scene as URL or data URL. */
  sceneImage: string
  /** Product reference photo (URL or data URL). */
  productRef?: string | null
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
  headlineSpace?: unknown
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

export function buildSceneCheckPrompt(hasRef: boolean, language: AdLanguage): { system: string; user: string } {
  const system = [
    'You are a strict QA reviewer for social-media ad images. Reply with JSON only.',
    'Schema: {"productMatches": boolean|null, "strayText": boolean, "headlineSpace": boolean, "score": number (0-1), "notes": string}',
  ].join('\n')
  const user = [
    hasRef
      ? 'Image 1 is the generated scene. Image 2 is the real product reference photo.'
      : 'Image 1 is the generated scene. There is no product reference: set productMatches to null.',
    hasRef
      ? 'productMatches: true only if the product in the scene is the same product as the reference — identical shape, proportions, colors and label design. A different, redrawn or distorted product is false. If the label faces the camera, its graphic and brand wording must be there as in the reference: a blank, missing or rewritten label is false.'
      : '',
    'strayText: true if there is ANY text, letters, numbers, logos, watermarks or signage anywhere other than the printed label of the product itself, or if the product label text looks garbled.',
    'headlineSpace: true if the upper third has clean, low-detail space where a headline could be overlaid.',
    'score: overall usability as an ad background (0 = unusable, 1 = perfect).',
    `notes: one short sentence in ${language === 'es' ? 'Spanish' : 'English'} explaining the main problem, or empty.`,
  ]
    .filter(Boolean)
    .join('\n')
  return { system, user }
}

export async function checkScene(input: CheckSceneInput): Promise<CheckSceneOutput> {
  const hasRef = Boolean(input.productRef)
  const prompt = buildSceneCheckPrompt(hasRef, input.language)
  const images = hasRef ? [input.sceneImage, input.productRef as string] : [input.sceneImage]
  const res = await input.gateway.visionJson<RawSceneCheck>({ ...prompt, images, model: input.model })
  const raw = (res.data ?? {}) as RawSceneCheck
  const productMatches = hasRef ? asBool(raw.productMatches) : null
  const strayText = asBool(raw.strayText)
  const headlineSpace = asBool(raw.headlineSpace)
  const n = Number(raw.score)
  const score = Number.isFinite(n) ? Math.max(0, Math.min(1, n > 1 && n <= 10 ? n / 10 : n)) : 0.5
  const ok = productMatches !== false && strayText !== true && headlineSpace !== false
  const notes = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 300) : undefined
  return {
    ok,
    productMatches,
    strayText,
    score,
    ...(notes ? { notes } : {}),
    costUsd: res.costUsd ?? 0,
    model: res.model,
  }
}
