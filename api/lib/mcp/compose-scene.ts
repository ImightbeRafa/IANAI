/**
 * Round 7: scene prep + code layout in one place, shared by the generated flow (web-image.ts), the exact flow (exact-flow.ts) and the evidence scripts.
 *
 *   1. flat strips the model painted at the top / bottom (letterbox look) are continued from the scene (scene-prep.blendSeams);
 *   2. the code layout (layout-ad) is computed; when the text would land on the product (or shrink below 80 %), the picture is moved DOWN by extending the
 *      background above it (scene-prep.shiftSceneDown) as long as nothing important scrolls out at the bottom, and the layout is computed again.
 */
import { layoutAdLayers, type AdBlocks, type AdLayoutReport, type LayoutInput } from './layout-ad.js'
import { blendSeams, detectSeams, MAX_SHIFT, shiftSceneDown, type Seam } from './scene-prep.js'

export const TEXT_SCALE_OK = 0.8

export type ScenePrepReport = {
  seams: { checked: boolean; found: Seam[]; blended?: boolean; remaining?: number; note?: string }
  room?: { attempted: boolean; applied: boolean; shiftPx?: number; shiftShare?: number; before: { corridor: string; scale: number }; after?: { corridor: string; scale: number }; note?: string }
}
export type NBox = { x0: number; y0: number; x1: number; y1: number }

export async function prepareAndLayout(input: Omit<LayoutInput, 'avoid' | 'blocks'> & { blocks: AdBlocks; avoid: NBox[]; makeRoom?: boolean }): Promise<{ bytes: Buffer; sceneBytes: Buffer; sceneAvoid: NBox[]; report: AdLayoutReport; scenePrep: ScenePrepReport }> {
  let sceneBytes: Buffer = input.bytes
  const seamsFound = await detectSeams(sceneBytes, input.ratio)
  let blendInfo: { remaining: number; note: string } | undefined
  if (seamsFound.found.length) {
    const blended = await blendSeams(sceneBytes, seamsFound.found)
    sceneBytes = blended.bytes
    blendInfo = { remaining: blended.report.remaining.length, note: blended.report.note }
  }
  const scenePrep: ScenePrepReport = { seams: { checked: seamsFound.checked, found: seamsFound.found, ...(blendInfo ? { blended: blendInfo.remaining === 0, remaining: blendInfo.remaining, note: blendInfo.note } : {}) } }
  const lay = (bytes: Buffer, avoid: NBox[]) => layoutAdLayers({ ...input, bytes, avoid })
  let done = await lay(sceneBytes, input.avoid)
  let sceneAvoid = input.avoid
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
      else if (objBottom != null && objBottom * H0 + need > H0 * 0.94) info.note = 'moving the picture down would push the objects into the bottom edge'
      else {
        const shifted = await shiftSceneDown(sceneBytes, need)
        const shiftedAvoid = input.avoid.map((b) => ({ x0: b.x0, x1: b.x1, y0: b.y0 + need / H0, y1: Math.min(1, b.y1 + need / H0) }))
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
  return { bytes: done.bytes, sceneBytes, sceneAvoid, report: done.report, scenePrep }
}
