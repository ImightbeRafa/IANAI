import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { acutance, edgeRoughness, qaSummaryLine, runQaGate, safeZoneViolations, textOverflowIssues, missingFacts, QA_THRESHOLDS, type QaGateInput, type QaLayoutReport } from '../../api/lib/adpack/qa-gate'

// Round 1b — the QA gate: a pass and a fail case for every metric (deterministic, no model calls).
const W = 1080
const H = 1350

/** Canvas + a crisp headline block + a product (dark shape, optionally blurred) with a soft shadow under its base. */
async function makePng(o: { blurProduct?: number; shadow?: boolean } = {}): Promise<Buffer> {
  const shadow = o.shadow === false ? '' : '<ellipse cx="540" cy="905" rx="380" ry="30" fill="#000" opacity="0.22" filter="url(#b)"/>'
  const product = '<g><rect x="190" y="430" width="700" height="450" fill="#1b2a44"/><rect x="260" y="500" width="560" height="50" fill="#f1ede5"/><rect x="260" y="620" width="560" height="50" fill="#f1ede5"/></g>'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="b"><feGaussianBlur stdDeviation="14"/></filter></defs>` +
    `<rect width="${W}" height="${H}" fill="#f1ede5"/>${shadow}` +
    '<rect x="64" y="1010" width="30" height="140" fill="#15263e"/><rect x="120" y="1010" width="30" height="140" fill="#15263e"/><rect x="176" y="1010" width="30" height="140" fill="#15263e"/><rect x="232" y="1010" width="30" height="140" fill="#15263e"/><rect x="288" y="1010" width="30" height="140" fill="#15263e"/><rect x="344" y="1010" width="30" height="140" fill="#15263e"/>' +
    (o.blurProduct ? '' : product) +
    '</svg>'
  let img = sharp(Buffer.from(svg))
  const base = await img.png().toBuffer()
  if (!o.blurProduct) return base
  const prod = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${product}</svg>`)).blur(o.blurProduct).png().toBuffer()
  return sharp(base).composite([{ input: prod }]).png().toBuffer()
}

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

function goodReport(ratio: '4:5' | '9:16' = '4:5'): QaLayoutReport {
  const h = ratio === '9:16' ? 1920 : H
  return {
    width: W,
    height: h,
    elements: [
      { role: 'headline', text: 'Un regalo que armás con papel', lines: ['Un regalo que', 'armás con papel'], box: box(64, 1000, 600, 170), contrast: 11, fits: true },
      { role: 'offer', text: '1 kit ₡14.900 · 2 kits ₡29.800', lines: ['1 kit ₡14.900', '2 kits ₡29.800'], box: box(64, 1190, 500, 80), contrast: 11, fits: true },
    ],
    productBox: box(190, 430, 700, 450),
    productBoxRespected: true,
    textOverProduct: false,
    logo: box(800, 1180, 160, 92),
    logoSelfContained: true,
  }
}

const FACTS = [{ key: 'price', value: '₡14.900', onImage: true }, { key: 'contact', value: 'Escribinos por DM' }]
const CAPTION = 'Kit DIY. ₡14.900. Escribinos por DM.'

async function gate(over: Partial<QaGateInput> & { png?: Buffer } = {}) {
  const png = over.png ?? (await makePng())
  return runQaGate({ png, ratio: '4:5', report: goodReport(), bleed: true, requiredFacts: FACTS, caption: CAPTION, headline: 'Un regalo que armás con papel', ...over })
}
const metric = (r: Awaited<ReturnType<typeof gate>>, id: string) => r.metrics.find((m) => m.id === id)!

describe('QA gate — pass baseline', () => {
  it('a clean studio render passes every metric and reports scores', async () => {
    const r = await gate()
    expect(r.failed).toEqual([])
    expect(r.passed).toBe(true)
    expect(r.score).toBe(1)
    expect(r.metrics.map((m) => m.id)).toEqual(['edge_roughness', 'shadow_present', 'sharpness', 'safe_zones', 'product_framing', 'text_overflow', 'required_facts', 'logo', 'headline', 'contrast'])
    expect(qaSummaryLine(r)).toBe('qa 10/10')
  })
})

describe('QA gate — edge_roughness (matte quality)', () => {
  const ellipseAlpha = async (jag: boolean) => {
    const w = 600
    const h = 300
    const raw = Buffer.alloc(w * h * 4, 128)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = ((x - 300) / 280) ** 2 + ((y - 150) / 120) ** 2
      const j = jag ? (((x * 7 + y * 13) % 11) / 11) * 0.25 : 0
      raw[(y * w + x) * 4 + 3] = r < 1 - j ? 255 : 0
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  }
  it('pass: a smooth cut-out edge', async () => {
    expect(await edgeRoughness(await ellipseAlpha(false))).toBeLessThanOrEqual(QA_THRESHOLDS.edgeRoughnessMax)
    const r = await gate({ bleed: false, heroPlaced: await ellipseAlpha(false), backgroundLeak: 0.01 })
    expect(metric(r, 'edge_roughness').passed).toBe(true)
  })
  it('fail: a jagged edge', async () => {
    expect(await edgeRoughness(await ellipseAlpha(true))).toBeGreaterThan(QA_THRESHOLDS.edgeRoughnessMax)
    const r = await gate({ bleed: false, heroPlaced: await ellipseAlpha(true), backgroundLeak: 0.01 })
    expect(metric(r, 'edge_roughness').passed).toBe(false)
    expect(r.passed).toBe(false)
  })
  it('fail: leftover backdrop above the gate threshold even with a smooth edge', async () => {
    const r = await gate({ bleed: false, heroPlaced: await ellipseAlpha(false), backgroundLeak: 0.03 })
    expect(metric(r, 'edge_roughness').passed).toBe(false)
  })
  it('studio bleed has no cut edge (always passes)', async () => {
    expect(metric(await gate({ bleed: true }), 'edge_roughness').value).toBe(0)
  })
})

describe('QA gate — shadow_present (grounding)', () => {
  it('pass: soft contact shadow under the base', async () => {
    const r = await gate({ png: await makePng({ shadow: true }) })
    expect(metric(r, 'shadow_present').passed).toBe(true)
    expect(metric(r, 'shadow_present').value).toBeGreaterThanOrEqual(QA_THRESHOLDS.shadowShareMin)
  })
  it('fail: flat canvas, product floats', async () => {
    const r = await gate({ png: await makePng({ shadow: false }) })
    expect(metric(r, 'shadow_present').passed).toBe(false)
    expect(r.failed).toContain('shadow_present')
  })
})

describe('QA gate — sharpness (product vs text)', () => {
  it('pass: product edges as crisp as the type', async () => {
    const r = await gate()
    expect(metric(r, 'sharpness').passed).toBe(true)
  })
  it('fail: a blurred (soft / upscaled-looking) product next to crisp text', async () => {
    const r = await gate({ png: await makePng({ blurProduct: 5 }) })
    expect(metric(r, 'sharpness').passed).toBe(false)
    expect(r.failed).toContain('sharpness')
  })
  it('fail: enlarged more than the cap even when sharp enough', async () => {
    const r = await gate({ report: { ...goodReport(), bleed: { scale: 2.4, edgesTouched: [] } } })
    expect(metric(r, 'sharpness').passed).toBe(false)
    expect(metric(r, 'sharpness').detail).toContain('not super-res')
  })
  it('acutance is higher for a hard edge than a soft one', async () => {
    const hard = await sharp(await makePng()).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true })
    const soft = await sharp(await makePng({ blurProduct: 5 })).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true })
    const b = box(190, 430, 700, 450)
    expect(acutance({ data: hard.data, w: W, h: H }, b)!).toBeGreaterThan(acutance({ data: soft.data, w: W, h: H }, b)!)
  })
})

describe('QA gate — safe_zones (IG UI)', () => {
  it('pass 4:5 and 9:16: everything inside the IG-safe margins', async () => {
    expect(safeZoneViolations(goodReport(), '4:5')).toEqual([])
    const r916 = { ...goodReport('9:16'), elements: [{ ...goodReport().elements[0], box: box(64, 1000, 600, 170) }], logo: box(800, 1180, 160, 92) }
    expect(safeZoneViolations(r916, '9:16')).toEqual([])
  })
  it('fail 4:5: text outside the side margin', async () => {
    const rep = goodReport()
    rep.elements[0].box = box(10, 1000, 600, 170)
    const r = await gate({ report: rep })
    expect(metric(r, 'safe_zones').passed).toBe(false)
  })
  it('fail 9:16: text in the top 250 px (profile bar) and the bottom 340 px (reply bar / CTA)', async () => {
    const top = { ...goodReport('9:16') }
    top.elements = [{ ...top.elements[0], box: box(64, 120, 600, 170) }]
    expect(safeZoneViolations(top, '9:16').length).toBeGreaterThan(0)
    const bot = { ...goodReport('9:16') }
    bot.elements = [{ ...bot.elements[0], box: box(64, 1700, 600, 120) }]
    expect(safeZoneViolations(bot, '9:16').length).toBeGreaterThan(0)
    const logo = { ...goodReport('9:16'), logo: box(800, 1700, 160, 92) }
    expect(safeZoneViolations(logo, '9:16').some((v) => v.startsWith('logo'))).toBe(true)
  })
})

describe('QA gate — product_framing', () => {
  it('fail: product too small', async () => {
    const r = await gate({ report: { ...goodReport(), productBox: box(500, 700, 80, 60) } })
    expect(metric(r, 'product_framing').passed).toBe(false)
  })
  it('fail: copy over the product / cropped by the canvas', async () => {
    expect(metric(await gate({ report: { ...goodReport(), textOverProduct: true } }), 'product_framing').passed).toBe(false)
    expect(metric(await gate({ report: { ...goodReport(), productBox: box(-200, 400, 700, 500) } }), 'product_framing').passed).toBe(false)
  })
  it('pass: a studio bleed may run off the side the photo itself cropped', async () => {
    const r = await gate({ report: { ...goodReport(), productBox: box(400, 400, 700, 450), bleed: { scale: 0.8, edgesTouched: ['right'] } } })
    expect(metric(r, 'product_framing').passed).toBe(true)
  })
})

describe('QA gate — text_overflow', () => {
  it('pass: lines rebuild the text, separators may drop', async () => {
    expect(textOverflowIssues(goodReport())).toEqual([])
  })
  it('fail: clipped text, dangling "·" at a line end, orphan headline word, element that does not fit', async () => {
    const clipped = goodReport()
    clipped.elements[0].lines = ['Un regalo que']
    expect(textOverflowIssues(clipped).join()).toContain('clipped')
    const dangling = goodReport()
    dangling.elements[1].lines = ['1 kit ₡14.900 ·', '2 kits ₡29.800']
    expect(textOverflowIssues(dangling).join()).toContain('dangles')
    const orphan = goodReport()
    orphan.elements[0].text = 'Un regalo que armás con el'
    orphan.elements[0].lines = ['Un regalo que armás con', 'el']
    expect(textOverflowIssues(orphan).join()).toContain('orphan')
    const nofit = goodReport()
    nofit.elements[0].fits = false
    expect((await gate({ report: nofit })).failed).toContain('text_overflow')
  })
})

describe('QA gate — required_facts', () => {
  it('pass: price on the image, contact in the caption', async () => {
    expect(missingFacts(goodReport(), FACTS, CAPTION)).toEqual([])
  })
  it('fail: price missing from the image; contact missing everywhere', async () => {
    const rep = goodReport()
    rep.elements[1].text = 'Llevalo hoy'
    rep.elements[1].lines = ['Llevalo hoy']
    expect(missingFacts(rep, FACTS, CAPTION).join()).toContain('price')
    expect(missingFacts(goodReport(), FACTS, 'Kit DIY.').join()).toContain('contact')
    expect((await gate({ requiredFacts: FACTS, caption: 'Kit DIY.' })).failed).toContain('required_facts')
  })
  it('pass: the runner can plug the engine matcher (accents / spacing)', async () => {
    const r = await gate({ requiredFacts: [{ key: 'contact', value: 'Escribinos por DM' }], caption: 'escribinos por dm', matchFact: (t, f) => t.toLowerCase().includes(f.value.toLowerCase()) })
    expect(metric(r, 'required_facts').passed).toBe(true)
  })
})

describe('QA gate — logo (legible, larger, high contrast)', () => {
  it('pass: large self-contained badge', async () => {
    expect(metric(await gate(), 'logo').passed).toBe(true)
  })
  it('pass: a square mark of 100×100 (area, not width, decides legibility)', async () => {
    expect(metric(await gate({ report: { ...goodReport(), logo: box(800, 1180, 100, 100) } }), 'logo').passed).toBe(true)
    expect(metric(await gate({ report: { ...goodReport(), logo: box(800, 1180, 200, 40) } }), 'logo').passed).toBe(false)
  })
  it('pass: bare logo with ≥ 3:1 contrast', async () => {
    expect(metric(await gate({ report: { ...goodReport(), logoSelfContained: false, logoContrast: 6 } }), 'logo').passed).toBe(true)
  })
  it('fail: tiny badge (the round-1 88 px chip), low-contrast bare logo, missing logo', async () => {
    expect(metric(await gate({ report: { ...goodReport(), logo: box(900, 1200, 88, 50) } }), 'logo').passed).toBe(false)
    expect(metric(await gate({ report: { ...goodReport(), logoSelfContained: false, logoContrast: 1.4 } }), 'logo').passed).toBe(false)
    expect(metric(await gate({ report: { ...goodReport(), logo: null } }), 'logo').passed).toBe(false)
  })
})

describe('QA gate — headline rules (article, ambiguity)', () => {
  it('pass: headline with an article / verb opener', async () => {
    expect(metric(await gate({ headline: 'Un regalo que armás con papel' }), 'headline').passed).toBe(true)
  })
  it('fail: bare-noun opener ("Regalo que armás…")', async () => {
    const r = await gate({ headline: 'Regalo que armás con papel' })
    expect(metric(r, 'headline').passed).toBe(false)
    expect(metric(r, 'headline').detail).toContain('article')
  })
  it('fail: an ambiguous claim that drops the verified qualifier', async () => {
    const rep = goodReport()
    rep.elements.push({ role: 'subline', text: 'Redoblás si se gasta', lines: ['Redoblás si se gasta'], box: box(64, 300, 500, 40), contrast: 9, fits: true })
    const r = await gate({ report: rep, claims: ['Si se gasta el papel, doblás otro avión'] })
    expect(metric(r, 'headline').passed).toBe(false)
    expect(metric(r, 'headline').detail).toContain('ambiguous')
    const ok = goodReport()
    ok.elements.push({ role: 'subline', text: 'Si se gasta el papel, doblás otro avión', lines: ['Si se gasta el papel, doblás otro avión'], box: box(64, 300, 800, 40), contrast: 9, fits: true })
    expect(metric(await gate({ report: ok, claims: ['Si se gasta el papel, doblás otro avión'] }), 'headline').passed).toBe(true)
  })
})

describe('QA gate — contrast', () => {
  it('pass ≥ 4.5 / fail < 4.5', async () => {
    expect(metric(await gate(), 'contrast').passed).toBe(true)
    const low = goodReport()
    low.elements[1].contrast = 3.1
    const r = await gate({ report: low })
    expect(metric(r, 'contrast').passed).toBe(false)
    expect(r.passed).toBe(false)
  })
})

describe('QA gate — result shape', () => {
  it('reports failed ids, a 0–1 score and a one-line summary for status output', async () => {
    const r = await gate({ png: await makePng({ shadow: false }), headline: 'Regalo que armás con papel' })
    expect(r.passed).toBe(false)
    expect(r.failed).toEqual(['shadow_present', 'headline'])
    expect(r.score).toBe(0.8)
    expect(qaSummaryLine(r)).toBe('qa 8/10 ✗ shadow_present, headline')
  })
})
