/**
 * Round 7: seams (letterbox strips) detected + blended away, text never on the product (picture moved down), text scale thresholds, CTA slot off seams,
 * lighter scrims, glow false positive, severity factors + autoRetry selection, productNotes. Fixtures = the round-6 live scenes (text / logo / CTA inpainted
 * out of Content's delivered posts; see docs/operations/mcp-user-tools.md) — no model call anywhere.
 */
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blendSeams, detectSeams, shiftSceneDown } from '../api/lib/mcp/scene-prep'
import { prepareAndLayout } from '../api/lib/mcp/compose-scene'
import { layoutAdLayers, splitCopyBlocks } from '../api/lib/mcp/layout-ad'
import { checkExtraObjects } from '../api/lib/mcp/extra-objects'
import { buildMcpPromptRules } from '../api/lib/web-post-image'
import { parseWebPostArgs } from '../api/lib/mcp/execute-tools'
import { generateWebStyleImage, pickBetterBySeverity } from '../api/lib/mcp/web-image'
import { MCP_FEATURES, MCP_VERSION } from '../api/lib/mcp/server-info'

const F7 = (n: string) => readFileSync(new URL(`./fixtures/round7/${n}`, import.meta.url))
const F6 = (n: string) => readFileSync(new URL(`./fixtures/round6/${n}`, import.meta.url))
const LOGO = readFileSync(new URL('./fixtures/round5b/kit-logo-prototipo.png', import.meta.url))
const PALETTE = { primary: '#15263E', secondary: '#F1EDE5', accent: '#2EC4B6' }
const COPY_A = 'Dos motores. Tu hoja hace el resto.\n₡14.900 el kit\nEnvío gratis llevando 2 kits o más\nEscribinos por DM'
const COPY_B = 'El regalo de cumpleaños que armás con papel\n₡14.900 el kit\nDesde 8 años con supervisión de un adulto\nEscribinos por DM'
const durl = (b: Buffer, m = 'image/jpeg') => `data:${m};base64,${b.toString('base64')}`

/** Largest colour step between neighbouring row groups within ±10 rows of the seam (the seam row is an estimate: the hard edge sits a few rows off). */
async function rowStep(bytes: Buffer, y: number): Promise<number> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const mean = (a: number, b: number) => { const m = [0, 0, 0]; for (let yy = a; yy <= b; yy++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) m[c] += data[(yy * w + x) * 3 + c]; return m.map((v) => v / (w * (b - a + 1))) }
  let best = 0
  for (let yy = y - 10; yy <= y + 10; yy++) {
    const a = mean(yy + 1, yy + 2), b = mean(yy - 1, yy)
    best = Math.max(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
  }
  return best
}

describe('seam detector (flat strips Grok paints at the top / bottom = letterbox look)', () => {
  it('finds the flat navy strips + lighter rectangle of the round-6 scene A (top and bottom)', async () => {
    const r = await detectSeams(F7('scene-A.jpg'), '4:5')
    expect(r.checked).toBe(true)
    expect(r.found.map((s) => s.edge).sort()).toEqual(['bottom', 'top'])
    const top = r.found.find((s) => s.edge === 'top')!
    const bot = r.found.find((s) => s.edge === 'bottom')!
    expect(top.stripShare).toBeGreaterThan(0.08)
    expect(top.stripShare).toBeLessThan(0.14)
    expect(bot.stripShare).toBeGreaterThan(0.08)
    expect(top.flatness).toBeLessThan(1.5) // a flat block, no texture
  })
  it('finds the flat cream block at the top of the round-6 scene B', async () => {
    const r = await detectSeams(F7('scene-B.jpg'), '4:5')
    const top = r.found.find((s) => s.edge === 'top')
    expect(top).toBeTruthy()
    expect(top!.stripShare).toBeGreaterThan(0.09)
    expect(top!.step).toBeGreaterThan(30)
  })
  it('does not flag a natural horizon (wall / table), a soft gradient wall or a textured scene', async () => {
    const W = 400, H = 500
    const horizon = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#1b3a6b"/><rect y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="#b5834a"/></svg>`)).jpeg({ quality: 95 }).toBuffer()
    expect((await detectSeams(horizon)).found).toEqual([])
    const grad = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e2d6"/><stop offset="1" stop-color="#b9ae9d"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`)).jpeg({ quality: 95 }).toBuffer()
    expect((await detectSeams(grad)).found).toEqual([])
  })
})

describe('seam blend: the strips are continued from the scene, no band edge left', () => {
  for (const [name, file] of [['A', 'scene-A.jpg'], ['B', 'scene-B.jpg']] as const) {
    it(`scene ${name}: after the blend the detector finds nothing and the old edge is gone (same size)`, async () => {
      const src = F7(file)
      const before = await detectSeams(src)
      expect(before.found.length).toBeGreaterThan(0)
      const meta = await sharp(src).metadata()
      const stepBefore = await rowStep(src, before.found[0].y)
      const out = await blendSeams(src, before.found)
      expect(out.report.applied).toBe(true)
      expect(out.report.remaining).toEqual([])
      expect((await detectSeams(out.bytes)).found).toEqual([])
      const m2 = await sharp(out.bytes).metadata()
      expect([m2.width, m2.height]).toEqual([meta.width, meta.height])
      // the hard step that was at the seam (a flat block meeting the picture) is now a continuation: far smaller
      const stepAfter = await rowStep(out.bytes, before.found[0].y)
      expect(stepBefore).toBeGreaterThan(8)
      expect(stepAfter).toBeLessThan(Math.max(4, stepBefore * 0.35))
    })
  }
  it('is deterministic (same bytes in → same bytes out)', async () => {
    const src = F7('scene-A.jpg')
    const f = (await detectSeams(src)).found
    const a = await blendSeams(src, f)
    const b = await blendSeams(src, f)
    expect(a.bytes.equals(b.bytes)).toBe(true)
  })
})

describe('shiftSceneDown: content-aware blur-extension above the picture (no model call)', () => {
  it('moves the content down, keeps the pixel size and leaves no seam at the top', async () => {
    const blended = (await blendSeams(F7('scene-A.jpg'), (await detectSeams(F7('scene-A.jpg'))).found)).bytes
    const meta = await sharp(blended).metadata()
    const out = await shiftSceneDown(blended, (meta.height as number) * 0.12)
    const m2 = await sharp(out).metadata()
    expect([m2.width, m2.height]).toEqual([meta.width, meta.height])
    expect((await detectSeams(out)).found).toEqual([])
    // a pixel row of the original reappears 12 % lower
    const d = Math.round((meta.height as number) * 0.12)
    const a = await sharp(blended).removeAlpha().extract({ left: 300, top: 600, width: 40, height: 4 }).raw().toBuffer()
    const b = await sharp(out).removeAlpha().extract({ left: 300, top: 600 + d, width: 40, height: 4 }).raw().toBuffer()
    let diff = 0
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
    expect(diff / a.length).toBeLessThan(8) // JPEG re-encode only
  })
})

describe('text never on the product: make room by extending the background above it', () => {
  /** Scene A with the product pushed UP by 5 % (crop the top, pad the bottom with the table): the text no longer has a calm corridor. */
  async function cramped() {
    const blended = (await blendSeams(F7('scene-A.jpg'), (await detectSeams(F7('scene-A.jpg'))).found)).bytes
    const { data, info } = await sharp(blended).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const W = info.width, H = info.height, cut = Math.round(H * 0.05)
    const out = Buffer.alloc(data.length)
    data.copy(out, 0, cut * W * 3)
    for (let y = H - cut; y < H; y++) data.copy(out, y * W * 3, (H - cut - 1) * W * 3, (H - cut) * W * 3)
    // clutter under the plane (textured table items) so the bottom is no calm corridor either
    let seed = 7
    for (let y = Math.round(H * 0.62); y < Math.round(H * 0.8); y++) for (let x = Math.round(W * 0.05); x < Math.round(W * 0.95); x++) for (let c = 0; c < 3; c++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out[(y * W + x) * 3 + c] = (seed >> 8) & 255 }
    return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toBuffer()
  }
  const productBox = { x0: 0.11, x1: 0.91, y0: 0.348 - 0.05, y1: 0.8 } // plane + the objects under it
  it('without room the text lands on the product / shrinks; with room it gets a calm corridor at ≥ 80 % and the product moved down', async () => {
    const scene = await cramped()
    const blocks = splitCopyBlocks(COPY_A, 'Escribinos por DM')
    const raw = await layoutAdLayers({ bytes: scene, ratio: '4:5', blocks, logo: LOGO, palette: PALETTE, avoid: [productBox] })
    expect(raw.report.text.textOverProduct || raw.report.text.scale < 0.8).toBe(true)
    const out = await prepareAndLayout({ bytes: scene, ratio: '4:5', blocks, logo: LOGO, palette: PALETTE, avoid: [productBox] })
    expect(out.scenePrep.room?.applied).toBe(true)
    expect(out.scenePrep.room!.shiftShare).toBeGreaterThan(0.02)
    expect(out.scenePrep.room!.shiftShare).toBeLessThanOrEqual(0.2)
    expect(out.report.text.textOverProduct).toBe(false)
    expect(out.report.text.corridor).toBe('top')
    expect(out.report.text.scale).toBeGreaterThanOrEqual(0.8)
    expect(out.report.layout.overlaps).toEqual([])
    expect(out.report.layout.insideSafeZones).toBe(true)
    // the text stack ends above where the (moved) product starts
    const textBottom = Math.max(...out.report.layout.elements.filter((e) => ['headline', 'price', 'facts'].includes(e.role)).map((e) => e.box.y + e.box.h))
    expect(textBottom / out.report.height).toBeLessThan(out.sceneAvoid[0].y0)
  })
  it('scene B (box + plane fill the frame): room is not feasible → text over product stays REPORTED (never silent), picture untouched', async () => {
    const out = await prepareAndLayout({ bytes: F7('scene-B.jpg'), ratio: '4:5', blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), logo: LOGO, palette: PALETTE, avoid: [{ x0: 0.007, y0: 0.504, x1: 0.585, y1: 0.734 }, { x0: 0.317, y0: 0.077, x1: 1, y1: 0.854 }] })
    expect(out.report.text.textOverProduct).toBe(true)
    expect(out.report.text.scale).toBeLessThan(0.75)
    expect(out.scenePrep.room?.attempted).toBe(true)
    expect(out.scenePrep.room?.applied).toBe(false)
    expect(out.scenePrep.room?.note).toMatch(/too much|bottom edge|did not/)
  })
  it('the simulated regenerated B (product in the lower 60-65 %) gets the text at ≥ 80 % in a calm corridor, off the box', async () => {
    const avoid = [{ x0: 0.1 + 0.317 * 0.8, x1: 0.9, y0: 0.2 + 0.077 * 0.8, y1: 0.2 + 0.855 * 0.8 }, { x0: 0.1 + 0.007 * 0.8, x1: 0.1 + 0.585 * 0.8, y0: 0.2 + 0.504 * 0.8, y1: 0.2 + 0.734 * 0.8 }]
    const out = await prepareAndLayout({ bytes: F7('scene-B-regen.jpg'), ratio: '4:5', blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), logo: LOGO, palette: PALETTE, avoid })
    expect(out.report.text.textOverProduct).toBe(false)
    expect(out.report.text.scale).toBeGreaterThanOrEqual(0.8)
    expect(out.report.layout.overlaps).toEqual([])
  })
})

describe('CTA slot + scrim', () => {
  it('a hard table / band edge under the pill is detected (cta.seam) on the raw scene and gone after the blend', async () => {
    const blocks = splitCopyBlocks(COPY_A, 'Escribinos por DM')
    const raw = await layoutAdLayers({ bytes: F7('scene-A.jpg'), ratio: '4:5', blocks, logo: LOGO, palette: PALETTE, avoid: [] })
    // the strip starts at ~90 % of the height; the pill sits at ~84-90 %: every slot straddles or touches the edge on the raw scene
    const prep = await prepareAndLayout({ bytes: F7('scene-A.jpg'), ratio: '4:5', blocks, logo: LOGO, palette: PALETTE, avoid: [] })
    expect(prep.report.cta.seam).toBeUndefined()
    expect(prep.report.cta.busy).toBe(false)
    expect(prep.report.cta.status).toBe('drawn')
    expect(raw.report.cta.status).toBe('drawn')
  })
  it('the pill avoids a located prop box and the slot with the object pixels', async () => {
    const blocks = splitCopyBlocks(COPY_A, 'Escribinos por DM')
    const avoidLeft = { x0: 0.0, x1: 0.45, y0: 0.76, y1: 0.93 }
    const out = await prepareAndLayout({ bytes: F7('scene-A.jpg'), ratio: '4:5', blocks, logo: LOGO, palette: PALETTE, avoid: [avoidLeft] })
    const c = out.report.cta.box!
    const W = out.report.width, H = out.report.height
    const ix = Math.max(0, Math.min((c.x + c.w) / W, avoidLeft.x1) - Math.max(c.x / W, avoidLeft.x0))
    const iy = Math.max(0, Math.min((c.y + c.h) / H, avoidLeft.y1) - Math.max(c.y / H, avoidLeft.y0))
    expect(ix * iy).toBe(0)
  })
  it('scrim strength follows the need: a light scene gets a light veil (cta ≤ 0.3, text ≤ 0.3) and every text still reads at ≥ 4.5:1', async () => {
    const out = await prepareAndLayout({ bytes: F7('scene-B-regen.jpg'), ratio: '4:5', blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), logo: LOGO, palette: PALETTE, avoid: [] })
    expect(out.report.scrim!.maxAlpha).toBeLessThanOrEqual(0.3)
    if (out.report.text.scrim) expect(out.report.text.scrim.alpha).toBeLessThanOrEqual(0.3)
    expect(out.report.text.lowContrast).toBe(false)
    for (const e of out.report.layout.elements.filter((x) => ['headline', 'price', 'facts'].includes(x.role))) expect(e.contrast).toBeGreaterThanOrEqual(4.5)
    // a dark scene needs a stronger one
    const dark = await sharp({ create: { width: 600, height: 750, channels: 3, background: '#2a2a2e' } }).jpeg().toBuffer()
    const d = await layoutAdLayers({ bytes: dark, ratio: '4:5', blocks: splitCopyBlocks(COPY_A, 'Escribinos por DM'), logo: LOGO, palette: { primary: '#2a2a2e', secondary: '#2a2a2e' }, avoid: [] })
    expect(d.report.scrim!.maxAlpha).toBeGreaterThanOrEqual(0.08)
    expect(d.report.cta.contrast).toBeGreaterThanOrEqual(4.5)
  })
})

describe('extra-objects: the window glow is lighting, the real props stay detected', () => {
  const hero = F7('hero998.jpg')
  it('round-6 scene B (sun glow at the window, plants at the edge): no yellow prop; the glow is reported as ignored', async () => {
    const r = await checkExtraObjects({ generated: F7('scene-B.jpg'), references: [hero, F6('contents.jpg'), F6('ctrl.png')], productBox: null, allowedCount: 0, mode: 'scene' })
    expect(r.suspected).toBe(false)
    expect(r.ignoredGlows?.some((g) => g.startsWith('yellow'))).toBe(true)
    const r2 = await checkExtraObjects({ generated: F7('scene-B.jpg'), references: [hero, F6('side.jpg')], productBox: { x0: 0.007, y0: 0.504, x1: 0.585, y1: 0.734 }, allowedCount: 0, mode: 'scene' })
    expect(r2.suspected).toBe(false)
  })
  it('round-5c scene A (blue USB cable) is STILL flagged; scene A of round 6 stays clean', async () => {
    const cable = await checkExtraObjects({ generated: F6('scene-A-4x5.jpg'), references: [F6('hero.jpg'), F6('side.jpg'), F6('box.jpg'), F6('ctrl.png')], productBox: null, allowedCount: 0, mode: 'scene' })
    expect(cable.suspected).toBe(true)
    expect(cable.clusters.some((c) => c.hue.includes('blue'))).toBe(true)
    const clean = await checkExtraObjects({ generated: F7('scene-A.jpg'), references: [hero, F6('side.jpg')], productBox: null, allowedCount: 1, mode: 'scene' })
    expect(clean.suspected).toBe(false)
  })
})

describe('prompt (MCP path): natural full-bleed scene, no strips, product low; productNotes', () => {
  const es = buildMcpPromptRules('es', { requestedRatio: '4:5', compositeLayers: true, layoutCap: true }, { hasProductRefs: true })
  const en = buildMcpPromptRules('en', { requestedRatio: '4:5', compositeLayers: true }, { hasProductRefs: true })
  it('drops the "keep the bands empty" wording that made flat strips', () => {
    expect(es).not.toMatch(/LIBRES de contenido importante: solo fondo/)
    expect(es).not.toMatch(/franja CALMA/)
    expect(es).toContain('SIN FRANJAS')
    expect(es).toMatch(/PROHIBIDO barras, franjas, bandas planas, letterbox/)
    expect(es).toMatch(/60–65% inferior/)
    expect(es).toMatch(/CALMO y CONTINUO/)
    expect(en).toMatch(/FORBIDDEN: bars, strips, flat bands, letterbox/)
    expect(en).toMatch(/lower 60–65%/)
  })
  it('the lock asks for the exact wing shape and every part\'s colour / material as in the reference (generic, no product hardcoded)', () => {
    const lock = buildMcpPromptRules('es', { strict: true, requestedRatio: '4:5', productNotes: 'la hélice es de plástico gris claro; el ala es una sola hoja lisa' }, { hasProductRefs: true })
    expect(lock).toMatch(/forma EXACTA del ala/)
    expect(lock).toMatch(/color y el material de CADA pieza tal como en la foto de referencia/)
    expect(lock).toContain('NOTAS DEL PRODUCTO')
    expect(lock).toContain('gris claro')
    expect(lock).not.toMatch(/Prototipo|TOPGT/)
    expect(buildMcpPromptRules('en', { strict: true, requestedRatio: '4:5' }, { hasProductRefs: true })).toMatch(/colour and material of EVERY part as in the reference photo/)
  })
  it('productNotes is parsed (≤ 400 chars) and echoed in the args', () => {
    expect(parseWebPostArgs({ productNotes: '  hélice gris claro  ' }).productNotes).toBe('hélice gris claro')
    expect(parseWebPostArgs({ productNotes: 'x'.repeat(900) }).productNotes!.length).toBeLessThanOrEqual(400)
    expect(parseWebPostArgs({}).productNotes).toBeUndefined()
  })
  it('MCP 0.20.0 advertises the new features', () => {
    expect(MCP_VERSION).toBe('0.20.0')
    for (const f of ['seam_blend_no_letterbox', 'text_never_over_product_make_room', 'severity_factors_retry', 'product_notes_input', 'exact_uses_code_layout']) expect(MCP_FEATURES).toContain(f as never)
  })
})

describe('autoRetry with several issues: severity factors, the better result is kept, single retry', () => {
  let scenes: Buffer[] = []
  let calls = 0
  beforeEach(() => {
    calls = 0
    process.env.GROK_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/images/')) {
        const b = scenes[Math.min(calls++, scenes.length - 1)]
        return new Response(JSON.stringify({ data: [{ b64_json: b.toString('base64') }] }), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const ctx = {
    brand: { id: 'b1', name: 'Prototipo' },
    offers: [{ id: 'o1', name: 'Avión Prototipo', price: '₡14.900', productDescription: 'Avión de papel', type: 'juguete' }],
    brandKit: { id: 'k1', name: 'Prototipo', primaryColor: '#15263E', secondaryColor: '#F1EDE5', accentColor: '#2EC4B6', logoUrl: durl(LOGO, 'image/png'), referenceImages: [] },
    brandKits: [], latestGuideIntake: null,
  } as never
  const base = () => ({ apiKey: 'k', ctx, offerId: 'o1', aspectRatio: '4:5', productUrls: [durl(F7('hero998.jpg')), durl(F6('side.jpg'))], autoRetry: true, lock: { allowedProps: [], forbidExtraProps: true } as never })
  /** B asks for the real TOPGT box (allowedProps + its photo as an accessory reference) like Content's live run: the box gets LOCATED, so the text cannot sit on it. */
  const withBox = () => ({ ...base(), accessories: [{ imageUrl: durl(F6('box.jpg')), label: 'caja TOPGT real' }], lock: { allowedProps: ['caja TOPGT real', 'hoja de papel blanca'], forbidExtraProps: true } as never })

  it('B (text over the box, text 58 %, fidelity 0.73) → severity counts ALL factors → ONE retry → the cleaner scene wins; one retry max', async () => {
    scenes = [F7('scene-B.jpg'), F7('scene-B-regen.jpg')]
    const out = await generateWebStyleImage({ ...withBox(), copy: COPY_B })
    expect(calls).toBe(2)
    const ar = out.autoRetry
    expect(ar.attempted).toBe(true)
    expect(ar.factors?.first).toMatchObject({ textOverProduct: 4, textScale: 3, fidelity: 4 })
    expect(ar.firstSeverity!).toBeGreaterThanOrEqual(11)
    expect(ar.retrySeverity!).toBeLessThan(ar.firstSeverity!)
    expect(ar.kept).toBe('retry')
    expect(ar.reason).toMatch(/EMPEZAR por debajo del 38%/)
    expect(ar.reason).toMatch(/EXACTAMENTE como en la foto/)
    expect(out.qa.textScale).toBeGreaterThanOrEqual(0.8)
    expect(out.compositeLayers?.text.textOverProduct).toBe(false)
  })
  it('the first scene is kept when the retry is worse (a retry never makes the delivered image worse)', async () => {
    scenes = [F7('scene-B-regen.jpg'), F7('scene-B.jpg')]
    const out = await generateWebStyleImage({ ...withBox(), copy: COPY_B })
    // regen sim has only the (mild) props flag → retry-worthy → retried; the retry (scene B) is far worse → first kept
    if (out.autoRetry.attempted) {
      expect(calls).toBe(2)
      expect(out.autoRetry.kept).toBe('first')
      expect(out.autoRetry.retrySeverity!).toBeGreaterThan(out.autoRetry.firstSeverity!)
    } else expect(calls).toBe(1)
  })
  it('fidelity < 0.75 alone (plane redrawn: A scene) raises the severity, triggers the one retry, and when it survives suggests productFidelity "exact" (never run automatically)', async () => {
    scenes = [F7('scene-A.jpg')]
    const out = await generateWebStyleImage({ ...base(), copy: COPY_A })
    expect(out.fidelityCheck.status).toBe('warning')
    expect(out.fidelity_warning!.score).toBeLessThan(0.75)
    expect(out.qa.severityFactors).toMatchObject({ fidelity: 4 })
    expect(calls).toBe(2) // exactly ONE retry, no third call
    expect(out.autoRetry.attempted).toBe(true)
    expect(out.autoRetry.kept).toBe('first') // tie → keep the first (same price, no change)
    expect(out.suggestedFallback?.productFidelity).toBe('exact')
    expect(out.suggestedFallback?.reason).toMatch(/second paid generation/)
    expect(out.scenePrep?.seams.blended).toBe(true) // the strips were blended in code
    expect(out.qa.seams).toMatchObject({ found: 2, blended: true, remaining: 0 })
    expect(out.qa.status).toBe('warning')
  })
  it('without autoRetry nothing is regenerated and the factors are still reported', async () => {
    scenes = [F7('scene-B.jpg')]
    const out = await generateWebStyleImage({ ...withBox(), autoRetry: false, copy: COPY_B })
    expect(calls).toBe(1)
    expect(out.qa.status).toBe('fail') // text over the product is a defect
    expect(out.qa.severityFactors).toMatchObject({ textOverProduct: 4 })
    expect(out.qa.warnings.join(' ')).toMatch(/text scaled to \d+% of its nominal size/)
  })
  it('pickBetterBySeverity: strictly lower wins, tie keeps the first', () => {
    expect(pickBetterBySeverity(13, 2)).toBe('retry')
    expect(pickBetterBySeverity(4, 4)).toBe('first')
    expect(pickBetterBySeverity(2, 9)).toBe('first')
  })
})
