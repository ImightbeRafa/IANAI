/**
 * Visual QA set for the v3 real-test fixes (opt-in, writes PNGs + a JSON report):
 *   ADPACK_V3_QA=1 npx vitest run test/adpack/v3-qa-a.spec.ts
 * Output: <os tmp>/adpack-v3-qa-a/
 *  - logos: navy badge (own background) on dark + light ads, off-white badge cleanup, wordmark kit variants
 *  - flat lay: cut-out (white pieces kept) composited on an overhead plate with top-down shadows
 *  - per-ratio partial delivery: one ratio rejected (diff heatmap) while the other ships
 *  - matte-black low-texture product: deterministic + AI-like relight, altered version diff
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { segmentProduct } from '../../api/lib/adpack/fidelity/segment'
import { compositeProducts, fitBox } from '../../api/lib/adpack/fidelity/composite'
import { scoreFidelity } from '../../api/lib/adpack/fidelity/score'
import { gaussianRng } from '../../api/lib/adpack/fidelity/pixels'
import { prepareLogo } from '../../api/lib/adpack/render/logo'
import { renderAd } from '../../api/lib/adpack/render'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { advancePack, planPack } from '../../api/lib/adpack/pack-runner'
import { createMemoryPackStore } from '../../api/lib/adpack/store-memory'
import { goodSerumCopy, caseById } from './helpers'
import { productOnWhite, syntheticPlate } from './fidelity-fixtures'
import { flatLayWithWhitePieces, matteBlackProduct, navyBadgePng, offWhiteBadgeJpeg, overheadPlate, wallTablePlate } from './v3-fixtures'
import { fakeCharge, fakeImageLoader, fakeRenderer, runnerGateway } from './runner-fakes'
import type { AdPackStorage } from '../../api/lib/adpack/runner-types'

const OUT = join(tmpdir(), 'adpack-v3-qa-a')
const copy = goodSerumCopy({ headline: 'Armalo y volalo hoy', subline: 'Kit completo con control incluido', bullets: ['Control incluido', 'Cinta y tornillos', 'Para 8+ años'], offerLine: '₡14.900 · Envío gratis desde 2 kits', cta: 'Escribinos' })
const plain = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer()

describe.skipIf(!process.env.ADPACK_V3_QA)('v3 QA set A', () => {
  it('writes the QA images', async () => {
    mkdirSync(OUT, { recursive: true })
    const report: Record<string, unknown> = {}

    // 1) Logos.
    const badge = await navyBadgePng()
    for (const [name, bg] of [['dark', '#101418'], ['light', '#f2efe8'], ['mid', '#3b4a5c']] as const) {
      const res = await renderAd({ format: 'offer_graphic', ratio: '4:5', sceneImage: await plain(1080, 1350, bg), copy, visual: { primaryColor: '#0f766e' }, logo: badge, language: 'es' })
      writeFileSync(join(OUT, `logo-badge-on-${name}.png`), res.png)
      report[`logo-badge-on-${name}`] = { variant: res.layoutReport.logoVariant, selfContained: res.layoutReport.logoSelfContained, contrast: res.layoutReport.logoContrast, box: res.layoutReport.logo }
    }
    const ow = await prepareLogo(await offWhiteBadgeJpeg())
    writeFileSync(join(OUT, 'logo-offwhite-badge-cleaned.png'), ow.onLight.png)
    writeFileSync(join(OUT, 'logo-offwhite-badge-source.jpg'), await offWhiteBadgeJpeg())
    report['logo-offwhite-badge-cleaned'] = { method: ow.method, removedPct: ow.removedPct, selfContained: ow.selfContained, warnings: ow.warnings }
    const owRes = await renderAd({ format: 'handheld_overlay', ratio: '9:16', sceneImage: await plain(1080, 1920, '#14161a'), copy, visual: {}, logo: await offWhiteBadgeJpeg(), language: 'es' })
    writeFileSync(join(OUT, 'logo-offwhite-badge-on-dark.png'), owRes.png)
    report['logo-offwhite-badge-on-dark'] = { variant: owRes.layoutReport.logoVariant, contrast: owRes.layoutReport.logoContrast }

    // 2) Flat lay: cut-out + overhead plate + top-down shadows.
    const kit = await segmentProduct({ bytes: await flatLayWithWhitePieces(), role: 'contents' })
    expect(kit.ok).toBe(true)
    if (!kit.ok) return
    writeFileSync(join(OUT, 'flatlay-source.jpg'), await flatLayWithWhitePieces())
    writeFileSync(join(OUT, 'flatlay-cutout.png'), kit.png)
    report['flatlay-cutout'] = { method: kit.method, flatLay: kit.flatLay, recall: kit.recall }
    for (const ratio of ['4:5', '9:16'] as const) {
      const res = await renderAd({ format: 'explainer', ratio, sceneImage: await overheadPlate(1080, 1920), copy, visual: { primaryColor: '#1d4ed8' }, productCutout: kit.png, productMode: 'exact', language: 'es', topDown: true, logo: badge })
      writeFileSync(join(OUT, `flatlay-overhead-${ratio.replace(':', 'x')}.png`), res.png)
      const p = res.productPlacements![0]
      const s = await scoreFidelity({ image: res.png, box: p.box, reference: p.placed, background: p.background })
      report[`flatlay-overhead-${ratio}`] = { view: res.layoutReport.view, fidelity: { passed: s.passed, ssimDetail: s.ssimDetail, iou: s.silhouetteIoU } }
    }

    // 3) Grounding: wall/table plate with the edge just under the product's base.
    const hero = await segmentProduct({ bytes: await productOnWhite() })
    if (!hero.ok) return
    const grounded = await renderAd({ format: 'offer_graphic', ratio: '4:5', sceneImage: await wallTablePlate(1080, 1350, 0.88), copy, visual: {}, productCutout: hero.png, productMode: 'exact', language: 'es' })
    writeFileSync(join(OUT, 'grounding-snapped-4x5.png'), grounded.png)
    report['grounding-snapped-4x5'] = grounded.layoutReport.grounding

    // 4) Per-ratio partial delivery through the runner (9:16 altered → rejected, 4:5 delivered).
    const store = createMemoryPackStore()
    const serum = caseById('beauty-serum')
    const HERO = 'https://cdn.test/hero.jpg'
    const planned = planPack({ dna: serum.dna, offer: { ...serum.offer, productImageUrls: [HERO] }, size: 1, userId: 'u1', source: 'web', ids: { packId: '44444444-4444-4444-8444-444444444444' }, render: { productFidelity: 'exact' } })
    await store.createPack(planned.pack, planned.items)
    const files = new Map<string, Uint8Array>()
    const storage: AdPackStorage = {
      async upload(input) {
        const url = `mem://${input.kind}-${files.size}.png`
        files.set(url, input.bytes)
        return { url }
      },
    }
    await advancePack({
      store,
      gateway: runnerGateway(),
      renderer: fakeRenderer({ alter: (input) => input.ratio === '9:16' }),
      storage,
      charge: fakeCharge(),
      packId: planned.pack.id,
      userId: 'u1',
      cutoutCache: memoryBlobCache(),
      loadImage: fakeImageLoader({ [HERO]: async () => new Uint8Array(await productOnWhite()) }),
    })
    const item = (await store.getPack(planned.pack.id, 'u1'))!.items[0]
    for (const r of item.renders) writeFileSync(join(OUT, `partial-delivered-${r.ratio.replace(':', 'x')}.png`), files.get(r.imageUrl)!)
    for (const r of item.rejectedRatios ?? []) if (r.fidelity.diffImageUrl) writeFileSync(join(OUT, `partial-rejected-${r.ratio.replace(':', 'x')}-diff.png`), files.get(r.fidelity.diffImageUrl)!)
    report['partial-delivery'] = { status: item.status, delivered: item.renders.map((r) => r.ratio), rejected: item.rejectedRatios?.map((r) => ({ ratio: r.ratio, reason: r.reason })) }

    // 5) Matte-black low-texture product: auto / AI-like relight pass, altered fails (diffs).
    const black = await segmentProduct({ bytes: await matteBlackProduct() })
    if (!black.ok) return
    const base = await syntheticPlate(1080, 1350)
    const box = fitBox({ width: black.width, height: black.height }, { x: 140, y: 600, w: 800, h: 560 }, 'bottom')
    const comp = await compositeProducts({ base, products: [{ cutout: black.png, box, role: 'hero' }], light: 'left' })
    const p = comp.placements[0]
    const { data, info } = await sharp(comp.png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const rng = gaussianRng(11)
    for (let y = p.box.y; y < p.box.y + p.box.h; y++) for (let x = p.box.x; x < p.box.x + p.box.w; x++) {
      const o = (y * info.width + x) * 3
      const g = 1 + 0.3 * ((x - p.box.x) / p.box.w)
      const n = rng() * 6
      for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round(data[o + c] * g + n)))
    }
    const aiLike = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()
    const altered = await sharp(comp.png).composite([{ input: await plain(240, 60, '#f2f2f2'), left: p.box.x + 280, top: p.box.y + 120 }]).png().toBuffer()
    for (const [name, img] of [['auto', comp.png], ['ai-like', aiLike], ['altered', altered]] as const) {
      const s = await scoreFidelity({ image: img, box: p.box, reference: p.placed, background: p.background, diff: true })
      writeFileSync(join(OUT, `matteblack-${name}.png`), img)
      writeFileSync(join(OUT, `matteblack-${name}-diff.png`), s.diffPng!)
      report[`matteblack-${name}`] = { passed: s.passed, ssimDetail: s.ssimDetail, iou: s.silhouetteIoU, deltaE: s.deltaE, hueShift: s.hueShift }
    }
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  }, 180_000)
})
