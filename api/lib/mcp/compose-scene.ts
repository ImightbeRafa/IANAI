/**
 * Round 7: scene prep + code layout in one place, shared by the generated flow (web-image.ts), the exact flow (exact-flow.ts) and the evidence scripts.
 *
 *   1. flat strips the model painted at the top / bottom (letterbox look) are continued from the scene (scene-prep.blendSeams);
 *   2. the code layout (layout-ad) is computed; when the text would land on the product (or shrink below 80 %), the picture is moved DOWN by extending the
 *      background above it (scene-prep.shiftSceneDown) as long as nothing important scrolls out at the bottom, and the layout is computed again.
 */
import { layoutAdLayers, type AdBlocks, type AdLayoutReport, type LayoutInput } from './layout-ad.js'
import { blendSeams, cropZoomSeams, detectSeams, extendCanvas, MAX_SHIFT, shiftSceneDown, shiftSceneUp, type CropZoomReport, type Seam } from './scene-prep.js'

export const TEXT_SCALE_OK = 0.8

export type ScenePrepReport = {
  seams: { checked: boolean; found: Seam[]; blended?: boolean; remaining?: number; /** Strips NOT blended because the neighbouring content is detailed. */ skipped?: Array<{ edge: 'top' | 'bottom'; detail: number }>; /** Round 8: the strips were cut off and the picture zoomed back (no blend). */ cropZoom?: CropZoomReport; note?: string }
  /** Round 8: the CTA had no free slot under the product: the picture was moved UP and the bottom extended. */
  roomBelow?: { attempted: boolean; applied: boolean; shiftPx?: number; shiftShare?: number; note: string }
  /** Round 9: no CTA slot was free of the product / accessory even after moving the picture up by the maximum: the button IS still drawn (≥ 86 % size) on the least bad slot and flagged (qa.ctaBlocked → autoRetry). The CTA is never dropped. */
  ctaBlocked?: boolean
  /** Round 9: the canvas was extended (picture scaled to `scale`, every side continued from the scene, no frame) so the CTA got a free slot. */
  extended?: { scale: number; anchorY: number; note: string }
  /** Round 8: second facts line that fitted on the image (kept off the caption). */
  extraFactUsed?: string
  room?: { attempted: boolean; applied: boolean; shiftPx?: number; shiftShare?: number; before: { corridor: string; scale: number }; after?: { corridor: string; scale: number }; note?: string }
}
export type NBox = { x0: number; y0: number; x1: number; y1: number }

export async function prepareAndLayout(input: Omit<LayoutInput, 'avoid' | 'blocks'> & { blocks: AdBlocks; avoid: NBox[]; makeRoom?: boolean; /** Round 8: extra facts lines tried on the image (kept only when the text still reads at ≥ 85 % and not over the product). */ optionalFacts?: string[] }): Promise<{ bytes: Buffer; sceneBytes: Buffer; sceneAvoid: NBox[]; report: AdLayoutReport; scenePrep: ScenePrepReport }> {
  let sceneBytes: Buffer = input.bytes
  const seamsFound = await detectSeams(sceneBytes, input.ratio)
  let blendInfo: { remaining: number; note: string; skipped: Array<{ edge: 'top' | 'bottom'; detail: number }> } | undefined
  let avoid0 = input.avoid
  let cropInfo: CropZoomReport | undefined
  let cropNote = ''
  let altBlend: { bytes: Buffer; info: NonNullable<typeof blendInfo> } | null = null
  let cropCand: { bytes: Buffer; avoid: NBox[]; report: CropZoomReport } | null = null
  if (seamsFound.found.length) {
    // Round 8: cut the flat strips off and zoom back (nothing synthetic) when the located objects survive it; otherwise (or when the zoom would eat the text corridor)
    // continue them from the scene (textured) or leave them flagged.
    const cz = await cropZoomSeams(sceneBytes, seamsFound.found, input.avoid)
    const blended = await blendSeams(sceneBytes, seamsFound.found)
    altBlend = { bytes: blended.bytes, info: { remaining: blended.report.remaining.length, note: blended.report.note, skipped: blended.report.skipped } }
    if (cz.report.applied) cropCand = { bytes: cz.bytes, avoid: cz.keep, report: cz.report }
    else cropNote = cz.report.note
    if (cropCand) {
      // choose by what the layout can do with each: the zoom moves the product up and may leave the text no corridor
      const lc = await layoutAdLayers({ ...input, bytes: cropCand.bytes, avoid: cropCand.avoid })
      const lb = await layoutAdLayers({ ...input, bytes: altBlend.bytes, avoid: input.avoid })
      const worse = (x: AdLayoutReport, y: AdLayoutReport) => (x.text.drawn && ((x.text.textOverProduct && !y.text.textOverProduct) || x.text.scale < y.text.scale - 0.02)) || (Boolean(x.cta.blocked) && !y.cta.blocked)
      if (!worse(lc.report, lb.report)) {
        sceneBytes = cropCand.bytes; avoid0 = cropCand.avoid; cropInfo = cropCand.report
        blendInfo = { remaining: 0, note: cropCand.report.note, skipped: [] }
      } else {
        cropNote = 'crop-and-zoom would leave the text less room than the textured continuation'
        sceneBytes = altBlend.bytes
        blendInfo = { ...altBlend.info, note: `${altBlend.info.note} (crop-and-zoom not used: ${cropNote})` }
      }
    } else {
      sceneBytes = altBlend.bytes
      blendInfo = { ...altBlend.info, note: `${altBlend.info.note}${cropNote ? ` (crop-and-zoom not used: ${cropNote})` : ''}` }
    }
  }
  const scenePrep: ScenePrepReport = { seams: { checked: seamsFound.checked, found: seamsFound.found, ...(cropInfo ? { cropZoom: cropInfo } : {}), ...(blendInfo ? { blended: blendInfo.remaining === 0, remaining: blendInfo.remaining, ...(blendInfo.skipped.length ? { skipped: blendInfo.skipped } : {}), note: blendInfo.note } : {}) } }
  let blocksCur = input.blocks
  const lay = (bytes: Buffer, avoid: NBox[]) => layoutAdLayers({ ...input, blocks: blocksCur, bytes, avoid })
  let done = await lay(sceneBytes, avoid0)
  let sceneAvoid = avoid0
  const extra = input.optionalFacts?.find((f) => f.trim())
  if (extra && done.report.text.drawn) {
    const withExtra = { ...input.blocks, facts: [...(input.blocks.facts ?? []), extra] }
    const test = await layoutAdLayers({ ...input, blocks: withExtra, bytes: sceneBytes, avoid: avoid0 })
    if (test.report.text.drawn && !test.report.text.textOverProduct && test.report.text.scale >= 0.85 && test.report.text.scale >= done.report.text.scale - 0.08 && test.report.layout.overlaps.length === 0 && test.report.text.fits) {
      blocksCur = withExtra
      done = test
      scenePrep.extraFactUsed = extra
    }
  }
  const needsRoom = (r: AdLayoutReport) => r.text.drawn && (r.text.textOverProduct || r.text.scale < TEXT_SCALE_OK)
  if (needsRoom(done.report) && input.makeRoom !== false) {
    const r0 = done.report
    const H0 = r0.height
    const objTop = r0.text.objects?.top ?? null
    const objBottom = r0.text.objects?.bottom ?? null
    const nominal = r0.text.okStackPx || r0.text.nominalStackPx || 0
    const textTop = r0.text.textTopPx ?? 0
    const info: NonNullable<ScenePrepReport['room']> = { attempted: true, applied: false, before: { corridor: r0.text.corridor, scale: r0.text.scale } }
    if (objTop == null || !nominal) info.note = 'objects could not be located: the picture was not moved'
    else {
      const need = Math.ceil(textTop + nominal + 2 * r0.layout.gapPx - objTop * H0)
      const maxPx = Math.round(H0 * MAX_SHIFT)
      if (need <= 2) info.note = 'no shift needed'
      else if (need > maxPx) info.note = `needs ${Math.round((need / H0) * 100)}% of the height (max ${Math.round(MAX_SHIFT * 100)}%): too much to extend the background`
      else if (objBottom != null && objBottom * H0 + need > Math.min(H0 * 0.94, (r0.cta.status === 'drawn' && r0.cta.box ? r0.cta.box.y : H0) - r0.layout.gapPx)) info.note = 'moving the picture down would push the objects into the CTA / the bottom edge'
      else {
        const shifted = await shiftSceneDown(sceneBytes, need)
        const shiftedAvoid = avoid0.map((b) => ({ x0: b.x0, x1: b.x1, y0: b.y0 + need / H0, y1: Math.min(1, b.y1 + need / H0) }))
        const d2 = await lay(shifted, shiftedAvoid)
        const better = (!d2.report.text.textOverProduct && d2.report.text.scale >= Math.min(TEXT_SCALE_OK, r0.text.scale + 0.01)) || d2.report.text.scale > r0.text.scale + 0.05
        if (better) {
          done = d2; sceneBytes = shifted; sceneAvoid = shiftedAvoid
          info.applied = true
          info.shiftPx = need
          info.shiftShare = Math.round((need / H0) * 1000) / 1000
          info.after = { corridor: d2.report.text.corridor, scale: d2.report.text.scale }
          info.note = `picture moved down ${Math.round((need / H0) * 100)}% (background extended above it) so the text has a calm corridor`
        } else info.note = 'shifting the picture did not give the text a better corridor'
      }
    }
    scenePrep.room = info
  }
  // Round 8: the CTA has no free slot (every one overlaps the located product / accessory): move the picture UP and extend the bottom instead of covering the product.
  if (input.makeRoom !== false && done.report.cta.status === 'drawn' && done.report.cta.blocked) {
    const r1 = done.report
    const H1 = r1.height
    const objBottom1 = r1.text.objects?.bottom ?? null
    const info: NonNullable<ScenePrepReport['roomBelow']> = { attempted: true, applied: false, note: '' }
    const maxPx = Math.round(H1 * MAX_SHIFT)
    if (objBottom1 == null) info.note = 'objects could not be located: the picture was not moved'
    else {
      // smallest upward shift that frees a CTA slot (the controller beside the slot does not matter, only what is under the pill)
      const steps = [0.015, 0.03, 0.045, 0.06, 0.07, 0.08, 0.1, 0.13, 0.16, MAX_SHIFT].map((f) => Math.round(f * H1)).filter((d) => d <= maxPx)
      info.note = 'no upward shift freed a CTA slot without putting the text over the product'
      for (const need of steps) {
        const up = await shiftSceneUp(sceneBytes, need)
        const upAvoid = sceneAvoid.map((b) => ({ x0: b.x0, x1: b.x1, y0: Math.max(0, b.y0 - need / H1), y1: Math.max(0, b.y1 - need / H1) }))
        const variants: Array<{ blocks: AdBlocks; dropExtra: boolean }> = [{ blocks: blocksCur, dropExtra: false }, ...(scenePrep.extraFactUsed ? [{ blocks: input.blocks, dropExtra: true }] : [])]
        let best: { d3: Awaited<ReturnType<typeof layoutAdLayers>>; v: (typeof variants)[number]; rank: number } | null = null
        for (const v of variants) {
          const d3 = await layoutAdLayers({ ...input, blocks: v.blocks, bytes: up, avoid: upAvoid })
          const textOk = !d3.report.text.textOverProduct || r1.text.textOverProduct
          // a CTA covering the product is a worse defect than text a little smaller (or one facts line less): accept down to 75 % (reported as a text-scale warning)
          if (textOk && d3.report.text.scale >= Math.min(0.72, r1.text.scale) && d3.report.cta.status === 'drawn' && !d3.report.cta.blocked) {
            const rank = (d3.report.text.scale >= TEXT_SCALE_OK ? 10 : 0) + (v.dropExtra ? 0 : 1) + d3.report.text.scale
            if (!best || rank > best.rank) best = { d3, v, rank }
          }
        }
        if (best) {
          done = best.d3; sceneBytes = up; sceneAvoid = upAvoid
          if (best.v.dropExtra) { blocksCur = input.blocks; delete scenePrep.extraFactUsed }
          info.applied = true
          info.shiftPx = need
          info.shiftShare = Math.round((need / H1) * 1000) / 1000
          info.note = `picture moved up ${Math.round((need / H1) * 100)}% (bottom extended) so the CTA does not cover the product${best.v.dropExtra ? '; the second facts line went to the caption' : ''}`
          break
        }
      }
    }
    scenePrep.roomBelow = info
    // Round 9: moving up was not enough → EXTEND the canvas (picture ≥ 86 % of its size, the new room continued from the scene on every side, mostly below)
    if (!info.applied && done.report.cta.status === 'drawn' && done.report.cta.blocked) {
      let pick: { d: Awaited<ReturnType<typeof layoutAdLayers>>; bytes: Buffer; avoid: NBox[]; scale: number; anchorY: number; rank: number } | null = null
      for (const scale of [0.94, 0.9, 0.86]) {
        for (const anchorY of [0.25, 0.5]) {
          const ext = await extendCanvas(sceneBytes, scale, anchorY)
          const extAvoid = sceneAvoid.map(ext.map)
          const d4 = await layoutAdLayers({ ...input, blocks: blocksCur, bytes: ext.bytes, avoid: extAvoid })
          const textOk = !d4.report.text.textOverProduct || r1.text.textOverProduct
          if (textOk && d4.report.text.scale >= Math.min(0.72, r1.text.scale) && d4.report.cta.status === 'drawn' && !d4.report.cta.blocked) {
            const rank = scale * 10 + d4.report.text.scale
            if (!pick || rank > pick.rank) pick = { d: d4, bytes: ext.bytes, avoid: extAvoid, scale, anchorY, rank }
            break // the largest picture that works, most of the new room below
          }
        }
        if (pick) break
      }
      if (pick) {
        done = pick.d; sceneBytes = pick.bytes; sceneAvoid = pick.avoid
        scenePrep.extended = { scale: pick.scale, anchorY: pick.anchorY, note: `canvas extended: picture at ${Math.round(pick.scale * 100)}% with the scene continued on every side (no frame) so the CTA has a free slot under the product` }
      }
    }
    // Round 9: still no free slot: the CTA is NEVER dropped. It stays on the least bad slot (≥ 86 % size) and is flagged as a defect so autoRetry regenerates.
    if (!info.applied && done.report.cta.status === 'drawn' && done.report.cta.blocked) scenePrep.ctaBlocked = true
  }
  return { bytes: done.bytes, sceneBytes, sceneAvoid, report: done.report, scenePrep }
}
