/**
 * Product fidelity — optional relight pass (exact mode, `relight: true`, off by default).
 *
 * Sends the deterministic composite (no text yet) to the image-edit model asking to
 * harmonize light only, then measures fidelity inside every product mask against the
 * pre-relight placement. The relit image is kept only when every product still passes;
 * otherwise the deterministic composite is returned unchanged.
 */
import sharp from 'sharp'
import type { ModelGateway } from '../types.js'
import type { PlacedProduct } from './composite.js'
import { scoreFidelity, type FidelityScore } from './score.js'

export const RELIGHT_PROMPT = [
  'Harmonize the lighting of this photo only: adjust light, soft shadows, reflections and color grading so the product sits naturally in the scene.',
  'Do NOT change the product: same shape, proportions, colors, parts, label and exact position and size.',
  'Do not add, remove or move any object. Do not add text, letters or logos. Keep the framing identical.',
].join(' ')

export interface RelightResult {
  png: Buffer
  relit: boolean
  /** Fidelity of each product in the relit image (empty when the model call failed). */
  scores: FidelityScore[]
  costUsd: number
  reason?: string
}

export async function relightComposite(input: {
  gateway: Pick<ModelGateway, 'edit'>
  composite: Buffer
  placements: PlacedProduct[]
  ratio?: string
}): Promise<RelightResult> {
  if (!input.gateway.edit) return { png: input.composite, relit: false, scores: [], costUsd: 0, reason: 'edit_unavailable' }
  const meta = await sharp(input.composite).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  let costUsd = 0
  let relitPng: Buffer
  try {
    const dataUrl = `data:image/png;base64,${(await sharp(input.composite).png().toBuffer()).toString('base64')}`
    const res = await input.gateway.edit({ image: dataUrl, prompt: RELIGHT_PROMPT, ratio: input.ratio })
    costUsd = res.costUsd ?? 0
    // Same canvas as the composite so the product masks line up (a misaligned result fails the score).
    relitPng = await sharp(res.bytes).resize(W, H, { fit: 'fill' }).removeAlpha().png().toBuffer()
  } catch (error) {
    return { png: input.composite, relit: false, scores: [], costUsd, reason: `relight_failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  const scores: FidelityScore[] = []
  for (const p of input.placements) scores.push(await scoreFidelity({ image: relitPng, box: p.box, reference: p.placed, method: 'relit' }))
  if (scores.every((s) => s.passed)) return { png: relitPng, relit: true, scores, costUsd }
  return { png: input.composite, relit: false, scores, costUsd, reason: 'relight_rejected_low_fidelity' }
}
