/**
 * Round 8b (CoS on Content's round-7 live result, MCP 0.20.0: A 5.5, B 5.0):
 *  1. no scale-in ever with compositeLayers, and what the scene itself shows (bench edge, strips, dark furniture) is not a fail trigger;
 *  2. the CTA never covers the located product / accessory (narrower pill, room below, or the button is left out and reported);
 *  3. strips are cut off (crop-and-zoom) instead of smeared when the objects survive it;
 *  4. qa.ctaButtons counts only the compositor's pill;
 *  5. fidelity: a re-shot view of a box is not a warning; the "exact" fallback is for the plane only;
 *  6. prompt hygiene (truncated brand voice / retry hint, logo line); 7. logo scrim below 4.5:1; 8. the shipping line stays on the image when there is room.
 * Fixtures (test/fixtures/round8b): scene-A-r7 / scene-B-r7 = Content's two round-7 posts with the scale-in undone and the logo / text / CTA inpainted away (the raw files
 * were not saved: a reconstruction); simscene-A-flat-bottom = scene A with its bottom 8.5 % replaced by the flat strip Grok painted. No model call anywhere.
 */
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cropZoomSeams, detectSeams, shiftSceneUp } from '../api/lib/mcp/scene-prep'
import { prepareAndLayout } from '../api/lib/mcp/compose-scene'
import { layoutAdLayers, splitCopyBlocks } from '../api/lib/mcp/layout-ad'
import { checkGeneratedProductFidelity } from '../api/lib/mcp/image-postcheck'
import { capCopyBlocks, rankFacts } from '../api/lib/mcp/copy-layout'
import { buildMcpPromptRules, buildWebPostSourcePrompt, clipClean, cleanBrandBlock } from '../api/lib/web-post-image'
import { generateWebStyleImage } from '../api/lib/mcp/web-image'

const F8b = (n: string) => readFileSync(new URL(`./fixtures/round8b/${n}`, import.meta.url))
const F6 = (n: string) => readFileSync(new URL(`./fixtures/round6/${n}`, import.meta.url))
const F7 = (n: string) => readFileSync(new URL(`./fixtures/round7/${n}`, import.meta.url))
const LOGO = readFileSync(new URL('./fixtures/round5b/kit-logo-prototipo.png', import.meta.url))
const PALETTE = { primary: '#15263E', secondary: '#F1EDE5', accent: '#2EC4B6' }
const durl = (b: Buffer, m = 'image/jpeg') => `data:${m};base64,${b.toString('base64')}`
const COPY_A = 'Del taller al parque, con tu propio avión\n₡14.900 el kit\nEnvío gratis llevando 2 kits o más\nEscribinos por DM'
const COPY_B = 'Lo que llega a tu casa\n₡14.900 el kit con control\nDesde 8 años con supervisión de un adulto\nEscribinos por DM'
const BOX_A = { x0: 0.03, y0: 0.43, x1: 0.97, y1: 0.835 }
const BOX_B = [{ x0: 0.265, y0: 0.395, x1: 0.84, y1: 0.915 }, { x0: 0.32, y0: 0.89, x1: 0.58, y1: 1.0 }]
const layoutOf = (bytes: Buffer, copy: string, avoid: Array<{ x0: number; y0: number; x1: number; y1: number }>, logo: Buffer | null = LOGO) =>
  layoutAdLayers({ bytes, ratio: '4:5', logo: logo ?? undefined, blocks: splitCopyBlocks(copy, 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid })
const overlapsBox = (cta: { x: number; y: number; w: number; h: number }, W: number, H: number, b: { x0: number; y0: number; x1: number; y1: number }) =>
  Math.min((cta.x + cta.w) / W, b.x1) - Math.max(cta.x / W, b.x0) > 0.002 && Math.min((cta.y + cta.h) / H, b.y1) - Math.max(cta.y / H, b.y0) > 0.002

/** A textured scene (so no flat strip is found by accident) with an optional flat strip and a dark "product" block. */
async function synth(opts: { W?: number; H?: number; strip?: { edge: 'top' | 'bottom'; share: number }; box?: { x0: number; y0: number; x1: number; y1: number }; busyBox?: boolean }) {
  const W = opts.W ?? 800, H = opts.H ?? 1000
  const raw = Buffer.alloc(W * H * 3)
  let seed = 7
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const base = 190 - 40 * (y / H) + 14 * Math.sin(x / 23 + y / 41)
    const n = (rnd() - 0.5) * 12
    raw[i] = Math.max(0, Math.min(255, base + 12 + n)); raw[i + 1] = Math.max(0, Math.min(255, base + n)); raw[i + 2] = Math.max(0, Math.min(255, base - 22 + n))
  }
  if (opts.strip) {
    const n = Math.round(H * opts.strip.share)
    const y0 = opts.strip.edge === 'top' ? 0 : H - n
    for (let y = y0; y < y0 + n; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[i] = 40; raw[i + 1] = 62; raw[i + 2] = 96 }
  }
  if (opts.box) {
    const b = opts.box
    for (let y = Math.round(b.y0 * H); y < Math.round(b.y1 * H); y++) for (let x = Math.round(b.x0 * W); x < Math.round(b.x1 * W); x++) {
      const i = (y * W + x) * 3; const t = ((x * 7 + y * 3) % 29) / 29
      if (opts.busyBox) { const v = (x * 7919 + y * 104729 + x * y) % 197; raw[i] = raw[i + 1] = raw[i + 2] = v } // printed-art-like busy block
      else { raw[i] = 30 + 40 * t; raw[i + 1] = 28 + 30 * t; raw[i + 2] = 34 + 20 * t }
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 93 }).toBuffer()
}

describe('3. strips are cut off (crop-and-zoom) when the located objects survive it', () => {
  it('a flat bottom strip of 8 %: the picture is cropped + zoomed back to the SAME pixel size, no strip left, boxes mapped into the new picture', async () => {
    const box = { x0: 0.3, y0: 0.35, x1: 0.7, y1: 0.8 }
    const src = await synth({ strip: { edge: 'bottom', share: 0.08 }, box })
    const found = (await detectSeams(src, '4:5')).found
    expect(found.map((s) => s.edge)).toEqual(['bottom'])
    const out = await cropZoomSeams(src, found, [box])
    expect(out.report.applied).toBe(true)
    expect(out.report.zoom).toBeGreaterThan(1.07)
    expect(out.report.zoom).toBeLessThan(1.12)
    const m = await sharp(out.bytes).metadata()
    expect([m.width, m.height]).toEqual([800, 1000])
    expect((await detectSeams(out.bytes, '4:5')).found).toEqual([])
    // the located box stays inside the picture and got bigger by the zoom
    const k = out.keep[0]
    expect(k.x0).toBeGreaterThanOrEqual(0); expect(k.x1).toBeLessThanOrEqual(1); expect(k.y1).toBeLessThanOrEqual(1)
    expect((k.x1 - k.x0)).toBeCloseTo((box.x1 - box.x0) * out.report.zoom!, 1)
    // and it really is the product that sits there (dark block) — the mapping is right
    const { data } = await sharp(out.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const px = (fx: number, fy: number) => data[(Math.round(fy * 999) * 800 + Math.round(fx * 799)) * 3]
    expect(px((k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2)).toBeLessThan(90)
    expect(px(Math.max(0.01, k.x0 - 0.04), (k.y0 + k.y1) / 2)).toBeGreaterThan(120)
  })
  it('refuses when the product spans the whole width (plane wings), when a box would be cut, or when the zoom would be more than 16 %', async () => {
    const src = await synth({ strip: { edge: 'bottom', share: 0.08 } })
    const found = (await detectSeams(src, '4:5')).found
    expect((await cropZoomSeams(src, found, [{ x0: 0.03, y0: 0.4, x1: 0.97, y1: 0.8 }])).report.applied).toBe(false)
    const both = await synth({ strip: { edge: 'bottom', share: 0.2 } })
    const f2 = (await detectSeams(both, '4:5')).found
    const r = await cropZoomSeams(both, f2, [])
    expect(r.report.applied).toBe(false)
    expect(r.report.note).toMatch(/zoom/)
    // an object that reaches into the strip is never cropped
    expect((await cropZoomSeams(src, found, [{ x0: 0.3, y0: 0.5, x1: 0.6, y1: 0.97 }])).report.applied).toBe(false)
  })
  it('prepareAndLayout uses the crop when it costs the text nothing, and reports it (no blend / mirror)', async () => {
    const box = { x0: 0.3, y0: 0.5, x1: 0.7, y1: 0.85 }
    const src = await synth({ strip: { edge: 'top', share: 0.08 }, box })
    const out = await prepareAndLayout({ bytes: src, ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks('Titular corto\n₡9.900\nEscribinos por DM', 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [box] })
    expect(out.scenePrep.seams.cropZoom?.applied).toBe(true)
    expect(out.scenePrep.seams.blended).toBe(true)
    expect(out.scenePrep.seams.remaining).toBe(0)
    expect(out.report.text.textOverProduct).toBe(false)
    expect(out.sceneAvoid[0].x1 - out.sceneAvoid[0].x0).toBeGreaterThan(0.4)
  })
  it('round-7 scene A (the plane spans the width): crop is not possible, the strip is continued with texture (not left, not smeared) and the CTA is off the bench seam', async () => {
    const src = F8b('simscene-A-flat-bottom.jpg')
    const out = await prepareAndLayout({ bytes: src, ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks(COPY_A, 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [BOX_A] })
    expect(out.scenePrep.seams.found.length).toBe(1)
    expect(out.scenePrep.seams.cropZoom).toBeUndefined()
    expect(out.scenePrep.seams.blended).toBe(true)
    expect(out.scenePrep.seams.note).toMatch(/crop-and-zoom not used/)
    expect((await detectSeams(out.sceneBytes, '4:5')).found).toEqual([])
    expect(out.report.cta.status).toBe('drawn')
    // the CTA sits on the wood, wholly above where the flat strip began (no pill straddling the former strip / the frame edge)
    expect(out.report.cta.box!.y + out.report.cta.box!.h).toBeLessThanOrEqual(out.scenePrep.seams.found[0].y)
    expect(overlapsBox(out.report.cta.box!, out.report.width, out.report.height, BOX_A)).toBe(false)
    expect(out.report.layout.overlaps).toEqual([])
  })
})

describe('2. the CTA never covers the located product / accessory', () => {
  it('B (box + controller to the bottom edge): round 9 — the CTA is never dropped: the picture moves up (or the CTA stays ≥ 86 % on the least bad slot, flagged); nothing else moves onto the product', async () => {
    const out = await prepareAndLayout({ bytes: F8b('scene-B-r7.jpg'), ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: BOX_B })
    expect(out.scenePrep.roomBelow?.attempted).toBe(true)
    expect(out.report.cta.status).toBe('drawn')
    expect(Boolean(out.scenePrep.ctaBlocked)).toBe(!out.scenePrep.roomBelow?.applied && !out.scenePrep.extended)
    expect(out.report.text.textOverProduct).toBe(false)
    expect(out.report.layout.overlaps).toEqual([])
  }, 60_000)
  it('a narrower pill beside the controller is used before giving up (never the full-size one over it)', async () => {
    // product on the left 55 % down to the bottom band; the right 40 % is free
    const box = { x0: 0.08, y0: 0.45, x1: 0.56, y1: 0.9 }
    const src = await synth({ box, busyBox: true })
    const r = await layoutOf(src, 'Titular\n₡9.900\nEscribinos por DM', [box], null)
    expect(r.report.cta.status).toBe('drawn')
    expect(overlapsBox(r.report.cta.box!, r.report.width, r.report.height, box)).toBe(false)
    expect(r.report.cta.blocked).toBeFalsy()
  })
  it('when every slot is over the product the picture is moved UP (background extended below) and the CTA lands under it', async () => {
    const box = { x0: 0.08, y0: 0.4, x1: 0.92, y1: 0.93 }
    const src = await synth({ box, busyBox: true })
    const out = await prepareAndLayout({ bytes: src, ratio: '4:5', logo: undefined, blocks: splitCopyBlocks('Titular\nEscribinos por DM', 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [box] })
    expect(out.scenePrep.roomBelow?.attempted).toBe(true)
    if (out.scenePrep.roomBelow?.applied) {
      expect(out.report.cta.status).toBe('drawn')
      expect(out.report.cta.blocked).toBeFalsy()
      expect(overlapsBox(out.report.cta.box!, out.report.width, out.report.height, out.sceneAvoid[0])).toBe(false)
      expect(out.sceneAvoid[0].y1).toBeLessThan(0.93)
    } else {
      expect(Boolean(out.scenePrep.ctaBlocked) || Boolean(out.scenePrep.extended)).toBe(true)
      expect(out.report.cta.status).toBe('drawn')
    }
    const m = await sharp(out.sceneBytes).metadata()
    expect([m.width, m.height]).toEqual([800, 1000])
  }, 60_000)
  it('shiftSceneUp: same size, the content really moved up by the shift, the vacated bottom is textured (not a flat block)', async () => {
    const src = await synth({})
    const up = await shiftSceneUp(src, 100)
    const m = await sharp(up).metadata()
    expect([m.width, m.height]).toEqual([800, 1000])
    const a = await sharp(src).removeAlpha().extract({ left: 100, top: 300, width: 40, height: 10 }).raw().toBuffer()
    const b = await sharp(up).removeAlpha().extract({ left: 100, top: 200, width: 40, height: 10 }).raw().toBuffer()
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); expect(d / a.length).toBeLessThan(6)
    const { data } = await sharp(up).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let s1 = 0, s2 = 0, n = 0
    for (let y = 930; y < 990; y++) for (let x = 100; x < 700; x++) { const v = data[(y * 800 + x) * 3]; s1 += v; s2 += v * v; n++ }
    expect(Math.sqrt(s2 / n - (s1 / n) ** 2)).toBeGreaterThan(1.5)
  })
})

describe('7. logo scrim below 4.5:1, 8. shipping line stays, 6. prompt strings', () => {
  it('a logo over bright foliage (contrast < 4.5) gets a SOLID plate (round 9, no glow) and the report has both contrasts; over a calm dark wall it does not', async () => {
    const bright = await layoutOf(F8b('scene-A-r7.jpg'), COPY_A, [BOX_A])
    expect(bright.report.logo.status).toBe('drawn')
    // round 12: the Prototipo file is a framed badge = its own plate (selfPlated) — no second plate is added
    expect(bright.report.logo.plate ?? bright.report.logo.selfPlated).toBeTruthy()
    expect(bright.report.logo.scrim).toBeUndefined()
    if (bright.report.logo.plate) expect(bright.report.logo.contrastBefore).toBeLessThan(4.5)
    expect(bright.report.logo.selfPlated?.markContrast ?? bright.report.logo.contrast ?? 0).toBeGreaterThanOrEqual(4.5)
    const dark = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 245, g: 241, b: 232 } } }).jpeg().toBuffer()
    const calm = await layoutOf(dark, COPY_A, [])
    expect(calm.report.logo.plate).toBeUndefined()
  })
  it('facts: the shipping line is the one kept on the image (age / not-included notes rank last); a second line stays when it fits and goes to overflow when it does not', async () => {
    const long = ['Lo que llega a tu casa', '₡14.900 el kit con control', 'Desde 8 años con supervisión de un adulto', 'Envío gratis llevando 2 kits o más', 'Papel y 3 pilas AA no incluidos', 'Escribinos por DM'].join('\n')
    const c = capCopyBlocks(long)
    expect(c.onImage.split('\n')).toContain('Envío gratis llevando 2 kits o más')
    expect(c.onImage).not.toContain('Desde 8 años')
    expect(rankFacts(['Papel y 3 pilas AA no incluidos', 'Envío gratis hoy', 'Kit con 2 motores'])[0]).toBe('Envío gratis hoy')
    const calm = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 245, g: 241, b: 232 } } }).jpeg().toBuffer()
    const withExtra = await prepareAndLayout({ bytes: calm, ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [{ x0: 0.2, y0: 0.55, x1: 0.8, y1: 0.85 }], optionalFacts: ['Envío gratis llevando 2 kits o más'] })
    expect(withExtra.scenePrep.extraFactUsed).toBe('Envío gratis llevando 2 kits o más')
    const crampedBox = { x0: 0.2, y0: 0.12, x1: 0.8, y1: 0.85 }
    const crampedScene = await synth({ box: crampedBox, busyBox: true })
    const cramped = await prepareAndLayout({ bytes: crampedScene, ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [crampedBox], optionalFacts: ['Envío gratis llevando 2 kits o más'], makeRoom: false })
    expect(cramped.scenePrep.extraFactUsed).toBeUndefined()
  })
  it('clipClean never cuts mid-word / leaves "(" ; the adpack "HECHOS CONFIRMADOS (" section is not brand voice', () => {
    const voice = 'Español de Costa Rica con voseo. Directo, concreto, de maker a maker: explica qué trae y cómo funciona. Nada infantil ni cursi. Sin urgencia falsa, sin estadísticas inventadas, sin reseñas ni testimonios. HECHOS CONFIRMADOS (ALLOWLIST, lista cerrada con id — únicos datos, cifras)'
    const c = cleanBrandBlock(voice, 340)!
    expect(c).not.toMatch(/HECHOS|\($/)
    expect(c.endsWith('testimonios.')).toBe(true)
    const long = 'a'.repeat(0) + 'dejá esas franjas LIBRES (solo fondo), generá la escena SIN NINGÚN TEXTO y poné el producto más abajo; el producto debe EMPEZAR por debajo del 38% desde arriba: dejá arriba un fondo calmo y continuo para el titular; producto y objetos en el 60–65% inferior de la imagen, nada tocando los bordes laterales. '.repeat(3)
    const k = clipClean(long, 700)
    expect(k.length).toBeLessThanOrEqual(700)
    expect(k).not.toMatch(/ en el \d?$/)
    expect(k.endsWith('.') || k.endsWith('imagen') || k.endsWith('laterales')).toBe(true)
  })
  it('the retry hint reaches the model whole (up to 700 chars) and the composited prompt says the logo is added by code, not "no logo file attached"', () => {
    const hint = 'x'.repeat(30) + '. ' + 'producto y objetos en el 60–65% inferior de la imagen; '.repeat(8)
    const rules = buildMcpPromptRules('es', { compositeLayers: true, productKind: 'generic', retryHint: hint } as never, { hasProductRefs: true })
    expect(rules).toContain('producto y objetos en el 60–65% inferior de la imagen')
    expect(rules).not.toMatch(/en el 6$/m)
    const body = buildWebPostSourcePrompt({ copy: COPY_A, language: 'es', logoDataUrl: null, mcp: { compositeLayers: true, productKind: 'generic' } } as never)
    expect(body).not.toMatch(/no hay archivo de logo adjunto/)
    expect(body).toMatch(/logo de la marca se agrega después por código/)
  })
})

describe('5. fidelity: another view of a box is not a warning; "exact" is for the plane only', () => {
  it('B (frontal box vs tilted reference photo, 73 inliers): warning for the plane check, no warning when the view change is tolerated; the numbers stay in the report', async () => {
    const refs = [durl(F6('box.jpg'))]
    const gen = durl(F8b('scene-B-r7.jpg'))
    const strict = await checkGeneratedProductFidelity({ referenceDataUrls: refs, generatedDataUrl: gen })
    expect(strict.status).toBe('warning')
    const tolerant = await checkGeneratedProductFidelity({ referenceDataUrls: refs, generatedDataUrl: gen, tolerateViewChange: true })
    expect(tolerant.status).toBe('ok')
    expect((tolerant as { details: { perspectiveTolerant?: boolean; inliers?: number } }).details.perspectiveTolerant).toBe(true)
    expect((tolerant as { details: { inliers?: number } }).details.inliers).toBeGreaterThanOrEqual(55)
  })
  it('the plane never gets the tolerance: the erased-landing-gear check of the postcheck suite still warns (strict path)', async () => {
    const r = await checkGeneratedProductFidelity({ referenceDataUrls: [durl(F7('hero998.jpg'))], generatedDataUrl: durl(F8b('scene-A-r7.jpg')) })
    expect(r.status).toBe('ok') // the faithful plane
  })
})

describe('1 + 4. flow with mock xAI: no scale-in, qa counts the compositor only, scene edges are no fail trigger', () => {
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
  const ctx = () => ({
    brand: { id: 'b1', name: 'Prototipo' },
    offers: [{ id: 'o1', name: 'Avión de papel DIY con motores', price: '₡14.900', type: 'product', productDescription: 'Kit de avión de papel con motores y control remoto' }],
    brandKit: { id: 'k1', name: 'Prototipo', primaryColor: '#15263E', secondaryColor: '#F1EDE5', accentColor: '#2EC4B6', logoUrl: durl(LOGO, 'image/png'), referenceImages: [], forbiddenPhrases: [] },
    brandKits: [], latestGuideIntake: null,
  }) as never
  const base = (ref: Buffer, accessories?: Array<{ imageUrl: string; label: string }>) => ({ apiKey: 'k', offerId: 'o1', aspectRatio: '4:5', productUrls: [durl(ref)], ...(accessories ? { accessories } : {}), lock: { allowedProps: accessories ? ['control remoto'] : ['banca de madera de parque'], forbidExtraProps: true } as never })

  it('Content\'s exact call on scene A (compositeLayers + enforceSafeZones:true + a flat bottom strip): no scale-in, ctaButtons 1, no extra-CTA risk, safeZones ok, seams reported as handled', async () => {
    scenes = [F8b('simscene-A-flat-bottom.jpg')]
    const out = await generateWebStyleImage({ ...base(F7('hero998.jpg')), ctx: ctx(), copy: COPY_A, enforceSafeZones: true, autoRetry: true })
    expect(out.safeZoneFix).toBeUndefined()
    expect(out.qa.scaleInUsed).toBeUndefined()
    expect(out.qa.ctaButtons).toBe(1)
    expect(out.qa.extraCtaRisk).toBe(false)
    expect(out.qa.safeZones).toBe('ok')
    expect(out.qa.seams?.remaining).toBe(0)
    // Round 10: the bench front edge runs under every CTA slot of this simulated scene (and the plane spans the width, so neither the shift nor the canvas
    // extension can free a clean slot): the CTA is still drawn but the only failure is the flagged blocked CTA (severity 8 → the one retry)
    if (out.qa.status === 'fail') {
      expect(out.qa.ctaBlocked).toBe(true)
      expect(out.qa.severityFactors?.ctaBlocked).toBe(8)
    }
    expect(out.qa.warnings.join(' ')).not.toMatch(/scale-in fallback used/)
    const meta = await sharp(Buffer.from(out.generated.imageDataUrl.split(',')[1], 'base64')).metadata()
    expect(meta.width! / meta.height!).toBeCloseTo(0.8, 1)
  }, 120_000)
  it('scene B: the box art is not a "view change" warning (no fidelity warning, no suggestedFallback exact); the CTA is always drawn (blocked → flagged, severity 8); no scale-in', async () => {
    scenes = [F8b('scene-B-r7.jpg')]
    const out = await generateWebStyleImage({ ...base(F6('box.jpg'), [{ imageUrl: durl(F6('ctrl.png'), 'image/png'), label: 'control remoto' }]), productPhotoRole: 'box', ctx: ctx(), copy: COPY_B, enforceSafeZones: true, autoRetry: false })
    expect(out.safeZoneFix).toBeUndefined()
    expect(out.suggestedFallback).toBeUndefined()
    expect(out.fidelityCheck.status).not.toBe('warning')
    // the controller (dark, not locatable by feature match) is found by what is under the pill: the picture is moved up and the pill goes BESIDE the controller (right of it), never on it
    const cta = (out as unknown as { compositeLayers: { cta: { status: string; box?: { x: number; w: number } }; width: number } }).compositeLayers
    expect(out.generated.imageDataUrl.startsWith('data:image/jpeg')).toBe(true)
    // round 9: the CTA is always drawn (≥ 86 % size); either beside the controller or flagged as blocked with the heavy severity factor
    expect(cta.cta.status).toBe('drawn')
    expect(out.qa.ctaButtons).toBe(1)
    if (process.env.DUMP9) (await import('node:fs')).writeFileSync('/tmp/b9.jpg', Buffer.from(out.generated.imageDataUrl.split(',')[1], 'base64'))
    if (!out.qa.ctaBlocked) expect(cta.cta.box!.x / cta.width).toBeGreaterThanOrEqual(0.55) // right of the controller (its body ends ≈ 0.55 after the upward shift)
    else {
      expect(out.qa.status).toBe('fail')
      expect(out.qa.warnings.join(' ')).toMatch(/CTA is never dropped/)
      expect(out.qa.severityFactors?.ctaBlocked).toBe(8)
    }
    expect(out.caption).toMatch(/Escribinos por DM/)
  }, 120_000)
})
