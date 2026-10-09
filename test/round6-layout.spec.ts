import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { layoutAdLayers, splitCopyBlocks, type AdLayoutReport } from '../api/lib/mcp/layout-ad.js'
import { checkExtraObjects, findUnlistedObjects } from '../api/lib/mcp/extra-objects.js'
import { runMcpImageQa } from '../api/lib/mcp/image-postcheck.js'
import { freeBands, safeZoneMargins } from '../api/lib/mcp/safe-zones.js'
import { pickBetterBySeverity } from '../api/lib/mcp/web-image.js'
import { MCP_VERSION } from '../api/lib/mcp/server-info.js'

const F = (n: string) => readFileSync(new URL(`./fixtures/round6/${n}`, import.meta.url))
const LOGO = readFileSync(new URL('./fixtures/round5b/kit-logo-prototipo.png', import.meta.url))
const palette = { primary: '#15263E', secondary: '#F1EDE5', accent: '#2EC4B6' }
const durl = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`
const CTA = 'Escribinos por DM'
const COPY_A = `Uno para vos, otro para tu compa\n₡14.900 o 2 kits por ₡29.800\nEnvío gratis llevando 2 kits o más\n${CTA}`
const COPY_B = `Todo lo que trae tu kit\n₡14.900 el kit completo\nControl, chasis, hélices, batería, cable USB y destornillador\n${CTA}`

type B = { x: number; y: number; w: number; h: number }
const gap = (a: B, b: B) => {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w))
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
  return Math.hypot(dx, dy)
}
const intersects = (a: B, b: B) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Everything the round-6 spec asks of a layout, checked independently from the report's own verdict. */
function expectCleanLayout(r: AdLayoutReport, W: number, H: number, ratio: string) {
  const els = r.layout.elements
  expect(els.map((e) => e.id)).toEqual(expect.arrayContaining(['headline', 'cta']))
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      expect(intersects(els[i].box, els[j].box), `${els[i].id} overlaps ${els[j].id}`).toBe(false)
      expect(gap(els[i].box, els[j].box) / H, `gap ${els[i].id}-${els[j].id}`).toBeGreaterThanOrEqual(0.015 - 1 / H)
    }
  }
  expect(r.layout.overlaps).toEqual([])
  expect(r.layout.minGap).toBeGreaterThanOrEqual(0.015)
  const m = safeZoneMargins(ratio)
  for (const e of els) {
    expect(e.box.x, `${e.id} left`).toBeGreaterThanOrEqual(0)
    expect(e.box.x + e.box.w, `${e.id} right`).toBeLessThanOrEqual(W)
    expect(e.box.y, `${e.id} top safe zone`).toBeGreaterThanOrEqual(Math.floor(H * m.top) - 1)
    expect(e.box.y + e.box.h, `${e.id} bottom safe zone`).toBeLessThanOrEqual(Math.ceil(H * (1 - m.bottom)) + 1)
    if (e.role !== 'logo') expect(e.fits, `${e.id} fits`).not.toBe(false)
    if (e.role === 'headline' || e.role === 'price' || e.role === 'facts' || e.role === 'cta') expect(e.contrast ?? 0, `${e.id} contrast`).toBeGreaterThanOrEqual(4.5)
  }
  expect(r.layout.insideSafeZones).toBe(true)
  expect(r.text.fits).toBe(true)
  expect(r.text.lowContrast).toBe(false)
}

const fixtures = [
  { name: 'A (plane + two boxes)', file: 'scene-A-room-4x5.jpg', copy: COPY_A },
  { name: 'B (kit contents)', file: 'scene-B-room-4x5.jpg', copy: COPY_B },
]

describe('round 6: code-composited headline / price / facts / logo / CTA on a scene-only picture (4:5)', () => {
  for (const f of fixtures) {
    it(`${f.name}: no overlaps, ≥ 1.5 % H between all elements, fits, contrast ≥ 4.5, safe zones, same pixel size, full-bleed`, async () => {
      const scene = F(f.file)
      const meta = await sharp(scene).metadata()
      const { bytes, report } = await layoutAdLayers({ bytes: scene, ratio: '4:5', blocks: splitCopyBlocks(f.copy, CTA), logo: LOGO, palette })
      const out = await sharp(bytes).metadata()
      expect([out.width, out.height]).toEqual([meta.width, meta.height]) // output size unchanged
      expect(report.logo.status).toBe('drawn')
      expect(report.cta.status).toBe('drawn')
      expect(report.cta.text).toBe(CTA)
      expectCleanLayout(report, meta.width!, meta.height!, '4:5')
      // the logo is placed AFTER the text and never touches / covers the headline or the CTA
      const byId = Object.fromEntries(report.layout.elements.map((e) => [e.id, e.box]))
      expect(intersects(byId.logo, byId.headline)).toBe(false)
      expect(intersects(byId.logo, byId.cta)).toBe(false)
      expect(byId.logo.y + byId.logo.h).toBeLessThan(byId.headline.y)
      // full-bleed: the picture is not shrunk / framed — the corners and the middle of the scene are untouched
      const probe = async (b: Buffer, left: number, top: number, width: number, height: number) => (await sharp(b).extract({ left, top, width, height }).removeAlpha().resize(1, 1).raw().toBuffer())
      const W = meta.width!
      const H = meta.height!
      for (const [l, t] of [[0, 0], [W - 40, 0], [0, H - 40], [W - 40, H - 40]] as const) {
        const a = await probe(scene, l, t, 40, 40)
        const b = await probe(bytes, l, t, 40, 40)
        // the corners may only be DARKENED by a soft scrim (never replaced by a border / padding colour or a lighter frame)
        for (let c = 0; c < 3; c++) {
          expect(b[c]).toBeLessThanOrEqual(a[c] + 10)
          expect(b[c]).toBeGreaterThanOrEqual(a[c] * 0.3 - 10)
        }
      }
    })
  }

  it('the CTA is the exact copy text, ONE pill; the compositor report is the source of the button count (logo plate + product box are not buttons)', async () => {
    for (const f of fixtures) {
      const scene = F(f.file)
      const { report } = await layoutAdLayers({ bytes: scene, ratio: '4:5', blocks: splitCopyBlocks(f.copy, CTA), logo: LOGO, palette })
      expect(report.layout.elements.filter((e) => e.role === 'cta')).toHaveLength(1)
      // QA on the scene-only picture: the logo-plate-like boxes / the product-box art are NOT counted as buttons in the free bands
      const qa = await runMcpImageQa({ generatedDataUrl: durl(scene), requestedRatio: '4:5', copyRequested: false, logoAttached: true, logoExpected: false, copy: '', sceneOnly: { bands: freeBands('4:5') } })
      expect(qa.ctaButtons).toBe(0)
      expect(qa.extraCtaRisk).toBeFalsy()
    }
  })

  it('splitCopyBlocks: exact strings, one price line, the CTA kept apart', () => {
    expect(splitCopyBlocks(COPY_A, CTA)).toEqual({ headline: 'Uno para vos, otro para tu compa', price: '₡14.900 o 2 kits por ₡29.800', facts: ['Envío gratis llevando 2 kits o más'], cta: CTA })
  })

  it('long copy overflow shrinks / wraps and never clips (fits, inside the picture, still no overlaps)', async () => {
    const long = 'Un titular larguísimo que normalmente no cabe en una sola línea del anuncio y debe partirse o achicarse sin cortarse\n₡14.900 el kit completo con envío gratis a todo el país en 24 horas\nControl, chasis, hélices de repuesto, batería, cable USB, destornillador y tornillos incluidos en la caja de regalo\nEscribinos por DM ahora mismo para reservar el tuyo'
    const scene = F('scene-B-room-4x5.jpg')
    const meta = await sharp(scene).metadata()
    const { report } = await layoutAdLayers({ bytes: scene, ratio: '4:5', blocks: splitCopyBlocks(long, 'Escribinos por DM ahora mismo para reservar el tuyo'), logo: LOGO, palette })
    expectCleanLayout(report, meta.width!, meta.height!, '4:5')
  })

  it('no logo asset: no logo drawn (never a text chip), everything else still laid out', async () => {
    const scene = F('scene-B-room-4x5.jpg')
    const meta = await sharp(scene).metadata()
    const { report } = await layoutAdLayers({ bytes: scene, ratio: '4:5', blocks: splitCopyBlocks(COPY_B, CTA), logo: null, palette })
    expect(report.logo.status).toBe('unavailable')
    expect(report.layout.elements.some((e) => e.role === 'logo')).toBe(false)
    expect(report.layout.overlaps).toEqual([])
    expect(report.cta.status).toBe('drawn')
    expect(meta.width! / meta.height!).toBeCloseTo(0.8, 2)
  })

  it('the CTA avoids a located product box (it moves to a slot that does not overlap it)', async () => {
    const scene = F('scene-B-room-4x5.jpg')
    const meta = await sharp(scene).metadata()
    const W = meta.width!
    const H = meta.height!
    const avoid = [{ x0: 0, y0: 0.8, x1: 0.5, y1: 1 }]
    const { report } = await layoutAdLayers({ bytes: scene, ratio: '4:5', blocks: splitCopyBlocks(COPY_B, CTA), logo: LOGO, palette, avoid })
    const cta = report.cta.box!
    const ov = intersects(cta, { x: 0, y: 0.8 * H, w: 0.5 * W, h: 0.2 * H })
    expect(ov).toBe(false)
  })
})

describe('round 6: 9:16 (stories) layouts — larger free bands (24 % / 27 %)', () => {
  async function story(): Promise<Buffer> {
    const W = 720
    const H = 1280
    const noise = Buffer.alloc(W * H * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = 70 + ((i * 2654435761) >>> 27) * 2
    return sharp(noise, { raw: { width: W, height: H, channels: 3 } }).blur(18).jpeg({ quality: 90 }).toBuffer()
  }
  it('both ratios keep the elements inside their own safe zones with the same gaps', async () => {
    for (const ratio of ['9:16', '4:5'] as const) {
      const scene = ratio === '9:16' ? await story() : F('scene-B-room-4x5.jpg')
      const meta = await sharp(scene).metadata()
      const { bytes, report } = await layoutAdLayers({ bytes: scene, ratio, blocks: splitCopyBlocks(COPY_B, CTA), logo: LOGO, palette })
      const out = await sharp(bytes).metadata()
      expect([out.width, out.height]).toEqual([meta.width, meta.height])
      expectCleanLayout(report, meta.width!, meta.height!, ratio)
    }
    expect(freeBands('9:16').top).toBeGreaterThan(freeBands('4:5').top)
    expect(freeBands('9:16').bottom).toBeGreaterThan(freeBands('4:5').bottom)
  })
})

describe('round 6: autoRetry keeps the image with the LOWER QA severity (a defect score)', () => {
  it('the round-5c numbers: B first 6 vs retry 10 → first (the retry was worse); A 8 vs 8 → first; a cleaner retry wins', () => {
    expect(pickBetterBySeverity(6, 10)).toBe('first')
    expect(pickBetterBySeverity(8, 8)).toBe('first')
    expect(pickBetterBySeverity(10, 6)).toBe('retry')
    expect(pickBetterBySeverity(4, 0)).toBe('retry')
    expect(pickBetterBySeverity(0, 0)).toBe('first')
  })
  it('the delivered round-5c results show the first was kept because it was not worse (not a selection bug)', () => {
    const raw = JSON.parse(readFileSync(new URL('./fixtures/round6/round5c-results-autoretry.json', import.meta.url), 'utf8')) as Record<string, { kept: string; firstSeverity: number; retrySeverity: number }>
    for (const r of Object.values(raw)) expect(pickBetterBySeverity(r.firstSeverity, r.retrySeverity)).toBe(r.kept)
  })
})

describe('round 6: prop detection on the round-5c raw scene images', () => {
  const refsA = [F('hero.jpg'), F('side.jpg'), F('box.jpg'), F('ctrl.png')]
  it('A: the blue USB cable (colour in no reference, no allowed prop) is flagged', async () => {
    const r = await checkExtraObjects({ generated: F('scene-A-4x5.jpg'), references: refsA, productBox: null, allowedCount: 0, mode: 'scene' })
    expect(r.suspected).toBe(true)
    expect(r.clusters.map((c) => c.hue).join(' ')).toMatch(/blue/)
    const withBox = await checkExtraObjects({ generated: F('scene-A-4x5.jpg'), references: refsA, productBox: { x0: 0, y0: 0.55, x1: 0.75, y1: 0.95 }, allowedCount: 0, mode: 'scene' })
    expect(withBox.suspected).toBe(true)
  })
  it('B: the faithful contents scene raises no colour warning (low false positives)', async () => {
    for (const refs of [[F('hero.jpg'), F('contents.jpg'), F('ctrl.png')], [F('hero.jpg'), F('side.jpg'), F('box.jpg'), F('ctrl.png')]]) {
      const r = await checkExtraObjects({ generated: F('scene-B-4x5.jpg'), references: refs, productBox: null, allowedCount: 0, mode: 'scene' })
      expect(r.suspected).toBe(false)
    }
  })
  it('B: the TOPGT box that is NOT in the contents photo / allowedProps is found by feature matching against the real box photo', async () => {
    const found = await findUnlistedObjects({ generated: F('scene-B-4x5.jpg'), objects: [{ label: 'caja TOPGT', bytes: F('box.jpg') }] })
    expect(found).toHaveLength(1)
    expect(found[0].label).toBe('caja TOPGT')
    expect(found[0].inliers).toBeGreaterThanOrEqual(12)
    // a photo of something that is not in the scene is not reported
    const none = await findUnlistedObjects({ generated: F('scene-B-4x5.jpg'), objects: [{ label: 'otra cosa', bytes: await sharp({ create: { width: 300, height: 300, channels: 3, background: '#336699' } }).jpeg().toBuffer() }] })
    expect(none).toEqual([])
  })
})

describe('round 6: version', () => {
  it('MCP 0.19.0', () => expect(MCP_VERSION).toBe('0.19.0'))
})
