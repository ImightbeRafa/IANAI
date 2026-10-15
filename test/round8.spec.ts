/**
 * Round 8 (Sleeping Patches test on 0.19.0 + CoS feedback on the round-7 image):
 *  - seam blend refuses detailed neighbours (qa.seamBlendSkipped) and keeps surface texture (no flat tan band)
 *  (a) scale-in NEVER with compositeLayers; flat dark furniture is no CTA block
 *  (b) text over the pouch (dark flat product on a dark wall) is detected and reported / fixed
 *  (c) generic product lock (plane wording only for plane-like products)
 *  (d) forbidden claims never reach the prompt or the drawn copy (removedClaims)
 *  (e) favicon-like kit logo flagged (logoLooksLikeIcon), still placed
 * Fixtures: test/fixtures/round8/sleeping-scene.jpg = the Sleeping Patches post as delivered with the scale-in undone and the overlays (logo, headline, price, facts, CTA)
 * inpainted away (a reconstruction of the raw scene; the raw file was not saved); sleeping-regen-sim.jpg = the same scene scaled down with the product lower (stand-in for a
 * new generation); round7 / round6 fixtures as before. No model call anywhere.
 */
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Round 11: pack OCR reads 2×3 tiles too (small print) → slower real-OCR flows
vi.setConfig({ testTimeout: 60_000 })
import { blendSeams, detectSeams, neighbourDetail, DETAIL_REFUSE } from '../api/lib/mcp/scene-prep'
import { prepareAndLayout } from '../api/lib/mcp/compose-scene'
import { splitCopyBlocks } from '../api/lib/mcp/layout-ad'
import { checkSafeZones, countCtaButtons } from '../api/lib/mcp/image-postcheck'
import { freeBands } from '../api/lib/mcp/safe-zones'
import { scrubClaims, scrubCopy } from '../api/lib/mcp/claims-filter'
import { logoIconCheck } from '../api/lib/mcp/logo-check'
import { productKindOf } from '../api/lib/mcp/product-kind'
import { buildMcpPromptRules } from '../api/lib/web-post-image'
import { parseWebPostArgs } from '../api/lib/mcp/execute-tools'
import { generateWebStyleImage } from '../api/lib/mcp/web-image'
import { MCP_VERSION } from '../api/lib/mcp/server-info'

const F8 = (n: string) => readFileSync(new URL(`./fixtures/round8/${n}`, import.meta.url))
const F7 = (n: string) => readFileSync(new URL(`./fixtures/round7/${n}`, import.meta.url))
const F6 = (n: string) => readFileSync(new URL(`./fixtures/round6/${n}`, import.meta.url))
const LOGO = readFileSync(new URL('./fixtures/round5b/kit-logo-prototipo.png', import.meta.url))
const durl = (b: Buffer, m = 'image/jpeg') => `data:${m};base64,${b.toString('base64')}`
const SLEEP_PALETTE = { primary: '#0D1845', secondary: '#2C3E9E', accent: '#F5C842' }
const SLEEP_COPY = 'Tu ritual de noche empieza con un parche\n₡9.900 la bolsa de 30 noches\nEnvío gratis llevando 2 bolsas\nPedí por WhatsApp +506 7052 4184'
const SLEEP_BOX = { x0: 0.044, y0: 0.1436, x1: 0.929, y1: 0.8003 } // what the free fidelity check locates on the sleeping scene

const svg = (w: number, h: number, body: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)).jpeg({ quality: 95 }).toBuffer()

describe('seam blend: refuses detailed neighbours, keeps surface texture', () => {
  it('neighbouring-content detail: calm walls / tables are low, art + objects touching the strip are high', async () => {
    const A = F7('scene-A.jpg'), B = F7('scene-B.jpg')
    const read = async (b: Buffer) => { const { data, info } = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, W: info.width, H: info.height } }
    const a = await read(A), b = await read(B)
    const sa = (await detectSeams(A)).found, sb = (await detectSeams(B)).found
    for (const s of sa) expect(neighbourDetail(a.data, a.W, a.H, s)).toBeLessThanOrEqual(DETAIL_REFUSE)
    for (const s of sb) expect(neighbourDetail(b.data, b.W, b.H, s)).toBeGreaterThan(DETAIL_REFUSE)
  })
  it('scene B (box art + plane touch both strips): the blend is NOT applied, the strips stay as they are and are reported as skipped', async () => {
    const src = F7('scene-B.jpg')
    const found = (await detectSeams(src)).found
    expect(found.length).toBeGreaterThan(0)
    const out = await blendSeams(src, found)
    expect(out.report.skipped.map((k) => k.edge).sort()).toEqual(found.map((f) => f.edge).sort())
    expect(out.report.applied).toBe(false)
    expect(out.report.remaining.length).toBe(found.length)
    expect(out.report.note).toMatch(/NOT blended/)
    // pixels in the strip are untouched (same JPEG decode)
    const a = await sharp(src).removeAlpha().extract({ left: 20, top: 10, width: 60, height: 20 }).raw().toBuffer()
    const b = await sharp(out.bytes).removeAlpha().extract({ left: 20, top: 10, width: 60, height: 20 }).raw().toBuffer()
    let d = 0
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i])
    expect(d / a.length).toBeLessThan(3)
  })
  it('scene A (calm navy wall + wooden table): both strips are still blended; the filled bottom keeps the wood texture (no smooth tan band)', async () => {
    const src = F7('scene-A.jpg')
    const found = (await detectSeams(src)).found
    const out = await blendSeams(src, found)
    expect(out.report.skipped).toEqual([])
    expect(out.report.remaining).toEqual([])
    const bot = found.find((f) => f.edge === 'bottom')!
    const { data, info } = await sharp(out.bytes).greyscale().raw().toBuffer({ resolveWithObject: true })
    const W = info.width, H = info.height
    // vertical detail inside the filled strip (wood grain): mean |row-to-row difference| over the left 40 % (no objects there)
    let acc = 0, n = 0
    for (let y = H - bot.stripPx + 6; y < H - 2; y++) for (let x = Math.round(W * 0.05); x < Math.round(W * 0.45); x++) { acc += Math.abs(data[y * W + x] - data[(y + 1) * W + x]); n++ }
    expect(acc / n).toBeGreaterThan(1.1)
    expect((await detectSeams(out.bytes)).found).toEqual([])
  })
})

describe('(a) the scale-in canvas never runs for composited images; flat dark furniture is no CTA block', () => {
  it('legacy safe-zone slab: a nightstand-like flat dark block of ~90 % of the width at the bottom edge is NOT a CTA block; a pill-shaped button still is', async () => {
    const nightstand = await svg(400, 500, `<rect width="400" height="500" fill="#2b1b10"/><rect x="20" y="410" width="360" height="90" fill="#140c07"/>`)
    expect(await checkSafeZones(nightstand, '4:5')).toEqual([])
    const pill = await svg(400, 500, `<rect width="400" height="500" fill="#2b1b10"/><rect x="90" y="440" width="220" height="48" rx="24" fill="#f5c842"/>`)
    const issues = await checkSafeZones(pill, '4:5')
    expect(issues.some((i) => i.kind === 'block_touches_edge' && i.edge === 'bottom')).toBe(true)
  })
  it('scene-only flow: no slab check at all (the CTA is drawn in code) and a dark drawer front is not a button, while a gold pill the model drew still is', async () => {
    const bands = freeBands('4:5')
    const furniture = await svg(400, 500, `<rect width="400" height="500" fill="#2b1b10"/><rect x="40" y="425" width="320" height="75" fill="#140c07"/><rect x="100" y="440" width="200" height="40" rx="6" fill="#1b110a"/>`)
    expect(await checkSafeZones(furniture, '4:5', { bands })).toEqual([])
    expect(await countCtaButtons(furniture, { onlyBands: bands })).toBe(0)
    const pill = await svg(400, 500, `<rect width="400" height="500" fill="#2b1b10"/><rect x="100" y="425" width="200" height="45" rx="22" fill="#f5c842"/>`)
    expect(await countCtaButtons(pill, { onlyBands: bands })).toBe(1)
  })
  it('the reconstructed Sleeping Patches scene is clean: no safe-zone issue, no button-like block', async () => {
    const scene = F8('sleeping-scene.jpg')
    expect(await checkSafeZones(scene, '4:5', { bands: freeBands('4:5') })).toEqual([])
    expect(await countCtaButtons(scene, { onlyBands: freeBands('4:5') })).toBe(0)
  })
  it('args: enforceSafeZones defaults to false everywhere and is only true when asked', () => {
    expect(parseWebPostArgs({}).enforceSafeZones).toBe(false)
    expect(parseWebPostArgs({ compositeLayers: false }).enforceSafeZones).toBe(false)
    expect(parseWebPostArgs({ compositeLayers: false, enforceSafeZones: true }).enforceSafeZones).toBe(true)
  })
})

describe('generateWebStyleImage on the Sleeping Patches scene (mock xAI)', () => {
  let scenes: Buffer[] = []
  let calls: Array<{ body: Record<string, any> }> = []
  beforeEach(() => {
    calls = []
    process.env.GROK_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      if (String(url).includes('/images/')) {
        calls.push({ body: JSON.parse(init.body) })
        const b = scenes[Math.min(calls.length - 1, scenes.length - 1)]
        return new Response(JSON.stringify({ data: [{ b64_json: b.toString('base64') }] }), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const ctx = (over: Record<string, unknown> = {}, kitOver: Record<string, unknown> = {}) => ({
    brand: { id: 'b1', name: 'Sleeping Patches CR' },
    offers: [{ id: 'o1', name: 'Sleeping Patches CR', price: '₡9.900', type: 'product', productDescription: 'Parches transdérmicos naturales diseñados para mejorar la calidad del sueño con melatonina y magnesio. Ayuda a regular el ritmo circadiano, reducir la ansiedad nocturna y promover un descanso profundo sin efectos secundarios.', technicalSpecs: '30 parches por bolsa; fórmula 100% natural, sin drogas ni químicos.', ...over }],
    brandKit: { id: 'k1', name: 'Sleeping Patches', primaryColor: '#0D1845', secondaryColor: '#2C3E9E', accentColor: '#F5C842', logoUrl: durl(LOGO, 'image/png'), referenceImages: [], forbiddenPhrases: ['sin efectos secundarios', 'directo al torrente sanguíneo', '₡12.900'], ...kitOver },
    brandKits: [], latestGuideIntake: null,
  }) as never
  const base = () => ({ apiKey: 'k', offerId: 'o1', aspectRatio: '4:5', productUrls: [durl(F8('pouch-ref.jpg'))], lock: { allowedProps: ['mesita de noche de madera', 'ropa de cama'], forbidExtraProps: true } as never })

  it('(a) Content\'s exact call (compositeLayers on + enforceSafeZones:true): the picture is NEVER shrunk or framed, same pixel size, a warning says the flag was ignored', async () => {
    scenes = [F8('sleeping-scene.jpg')]
    const out = await generateWebStyleImage({ ...base(), ctx: ctx(), copy: SLEEP_COPY, enforceSafeZones: true, autoRetry: true })
    expect(out.safeZoneFix).toBeUndefined()
    expect(out.qa.scaleInUsed).toBeUndefined()
    expect(out.qa.warnings.join(' ')).not.toMatch(/scale-in fallback used/)
    expect(out.qa.warnings.join(' ')).toMatch(/enforceSafeZones ignored/)
    const meta = await sharp(Buffer.from(out.generated.imageDataUrl.split(',')[1], 'base64')).metadata()
    expect(meta.width! / meta.height!).toBeCloseTo(0.8, 1)
  }, 120_000)
  it('(a) even a scene that really has text in the free bands is not scaled in with compositeLayers (it is flagged and retried instead)', async () => {
    scenes = [F6('scene-A-with-text-4x5.jpg')]
    const out = await generateWebStyleImage({ ...base(), ctx: ctx(), copy: SLEEP_COPY, enforceSafeZones: true, autoRetry: false })
    expect(out.safeZoneFix).toBeUndefined()
    expect(out.qa.scaleInUsed).toBeUndefined()
  })

  it('(b) the headline / price / facts landing on the flat navy pouch edge is detected (text 58 %, over product, fail) — and never shipped silently', async () => {
    const out = await prepareAndLayout({ bytes: F8('sleeping-scene.jpg'), ratio: '4:5', blocks: splitCopyBlocks(SLEEP_COPY, 'Pedí por WhatsApp +506 7052 4184'), logo: LOGO, palette: SLEEP_PALETTE, avoid: [SLEEP_BOX] })
    expect(out.report.text.textOverProduct).toBe(true)
    expect(out.report.text.scale).toBeLessThan(0.7)
    expect(out.report.text.scale).toBeCloseTo(0.58, 1) // the same 58 % Content measured live
    // making room is refused: moving the pouch down would push it onto the CTA
    expect(out.scenePrep.room?.applied).toBe(false)
    expect(out.scenePrep.room?.note).toMatch(/CTA/)
  })
  it('(b) end to end: severity counts it, autoRetry fires once and keeps the regenerated scene whose text sits in a calm corridor off the pouch', async () => {
    scenes = [F8('sleeping-scene.jpg'), F8('sleeping-regen-sim.jpg')]
    const out = await generateWebStyleImage({ ...base(), ctx: ctx(), copy: SLEEP_COPY, autoRetry: true })
    expect(calls).toHaveLength(2)
    expect(out.autoRetry.factors?.first).toMatchObject({ textOverProduct: 4, textScale: 3 })
    expect(out.autoRetry.kept).toBe('retry')
    expect(out.compositeLayers?.text.textOverProduct).toBe(false)
    expect(out.qa.textScale).toBeGreaterThanOrEqual(0.8)
    expect(out.compositeLayers?.layout.overlaps).toEqual([])
    // no retry: the failure is visible in qa
    scenes = [F8('sleeping-scene.jpg')]
    const first = await generateWebStyleImage({ ...base(), ctx: ctx(), copy: SLEEP_COPY, autoRetry: false })
    expect(first.qa.status).toBe('fail')
    expect(first.qa.warnings.join(' ')).toMatch(/text over the product/)
  }, 120_000)

  it('(c) the pouch prompt carries the generic lock: no wheels / landing gear / propellers / flaps / controllers / drawn sheet', async () => {
    scenes = [F8('sleeping-scene.jpg')]
    await generateWebStyleImage({ ...base(), ctx: ctx(), copy: SLEEP_COPY })
    const prompt = String(calls[0].body.prompt)
    expect(prompt).toMatch(/PRODUCTO BLOQUEADO \(reforzado\)/)
    expect(prompt).toMatch(/cada pieza, color, material y proporción/)
    expect(prompt).not.toMatch(/ruedas|aterrizaje|hélices|helices|flaps|solapas|pestañas|control\/gamepad|hoja con dibujo|alas, aletas/i)
  })
  it('(c) a plane keeps the plane wording', async () => {
    scenes = [F8('sleeping-scene.jpg')]
    await generateWebStyleImage({ ...base(), ctx: ctx({ name: 'Avión Prototipo', productDescription: 'Avión de papel con motores', technicalSpecs: 'planeador' }), copy: SLEEP_COPY })
    expect(String(calls[0].body.prompt)).toMatch(/ruedas, tren de aterrizaje, cola, pliegues, cables, hélices/)
  })

  it('(d) forbidden claims never reach the prompt or the drawn copy; they are reported', async () => {
    scenes = [F8('sleeping-scene.jpg')]
    const out = await generateWebStyleImage({ ...base(), ctx: ctx({ productDescription: 'Parche natural. Directo al torrente sanguíneo, ayuda a reducir el cortisol y la ansiedad, sin efectos secundarios.' }), copy: 'Duerme mejor, sin efectos secundarios\n₡12.900 la bolsa\nSin drogas ni químicos\nPedí por WhatsApp +506 7052 4184', autoRetry: false })
    const prompt = String(calls[0].body.prompt).toLowerCase()
    for (const bad of ['sin efectos secundarios', 'torrente', 'cortisol', '12.900', 'sin drogas', 'ansiedad']) expect(prompt).not.toContain(bad)
    expect(prompt).toContain('parche natural')
    expect(out.qa.removedClaims).toEqual(expect.arrayContaining(['sin efectos secundarios']))
    expect(out.removedClaims?.length).toBeGreaterThanOrEqual(3)
    expect(out.qa.warnings.join(' ')).toMatch(/removed claim/)
    const drawn = (out.compositeLayers?.layout.elements ?? []).map((e) => `${e.text ?? ''}`).join(' | ').toLowerCase()
    expect(drawn).not.toMatch(/efectos secundarios|12\.900|drogas/)
    expect(out.caption).not.toMatch(/efectos secundarios|12\.900|drogas/i)
  })

  it('(e) a favicon-like kit logo is flagged and still placed; a wordmark is not flagged', async () => {
    scenes = [F8('sleeping-regen-sim.jpg')]
    const icon = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#0D1845' } }).png().toBuffer()
    const flagged = await generateWebStyleImage({ ...base(), ctx: ctx({}, { logoUrl: durl(icon, 'image/png') }), copy: SLEEP_COPY })
    expect(flagged.qa.logoLooksLikeIcon).toBe(true)
    expect(flagged.qa.warnings.join(' ')).toMatch(/favicon/)
    expect(flagged.compositeLayers?.logo.status).toBe('drawn')
    scenes = [F8('sleeping-regen-sim.jpg')]
    const ok = await generateWebStyleImage({ ...base(), ctx: ctx(), copy: SLEEP_COPY })
    expect(ok.qa.logoLooksLikeIcon).toBeUndefined()
  })
})

describe('units: claims filter, product kind, logo check, prompt wording', () => {
  it('scrubClaims: clause-level, kit phrases accent / case insensitive, built-in health claims, the rest of the text survives', () => {
    const d = 'Parches naturales para dormir mejor. Ayuda a regular el ritmo circadiano, reducir la ansiedad nocturna y promover un descanso profundo sin efectos secundarios.'
    const r = scrubClaims(d, [])
    expect(r.removed).toEqual(expect.arrayContaining(['sin efectos secundarios']))
    expect(r.text).toContain('Parches naturales para dormir mejor.')
    expect(r.text).toContain('ritmo circadiano')
    expect(r.text.toLowerCase()).not.toContain('ansiedad')
    expect(scrubClaims('Precio ₡12.900 hoy', ['₡12.900']).text).not.toContain('12.900')
    expect(scrubClaims('SIN EFECTOS SECUNDARIOS', []).text).toBe('')
    expect(scrubClaims('Sin Efectos Secundarios', ['sin efectos secundarios']).removed.length).toBe(1)
    expect(scrubClaims('Se usa para reducir el cortisol, calmar la ansiedad.', []).removed.length).toBe(2)
    expect(scrubClaims('Duerme profundo', ['sin riesgos'])).toEqual({ text: 'Duerme profundo', removed: [] })
    expect(scrubClaims('lower your cortisol and anxiety', []).removed.length).toBeGreaterThan(0)
    const c = scrubCopy('Duerme mejor, sin efectos secundarios\nSin drogas ni químicos\n₡9.900', [])
    expect(c.text.split('\n')).toEqual(['Duerme mejor.', '₡9.900'])
  })
  it('productKindOf: plane-like only for plane words, unknown / pouch = generic', () => {
    expect(productKindOf(['Avión Prototipo', 'juguete'])).toBe('plane')
    expect(productKindOf(['Kit planeador DIY'])).toBe('plane')
    expect(productKindOf(['Sleeping Patches CR', 'product', 'Parches transdérmicos'])).toBe('generic')
    expect(productKindOf([null, undefined, ''])).toBe('generic')
    expect(productKindOf(['Camiseta de algodón'])).toBe('generic')
  })
  it('logoIconCheck thresholds: square + < 256 px = icon; square but large = wordmark-capable; wide = wordmark; favicon URL on a square vector = icon', async () => {
    const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: '#123456' } }).png().toBuffer()
    expect((await logoIconCheck(await png(128, 128))).looksLikeIcon).toBe(true)
    expect((await logoIconCheck(await png(255, 240))).looksLikeIcon).toBe(true)
    expect((await logoIconCheck(await png(512, 512))).looksLikeIcon).toBe(false)
    expect((await logoIconCheck(await png(200, 80))).looksLikeIcon).toBe(false)
    expect((await logoIconCheck(await png(128, 160))).looksLikeIcon).toBe(false) // aspect 0.8: not nearly square
    const vec = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#00f"/></svg>')
    expect((await logoIconCheck(vec, 'https://www.sleep.shopping/favicon.svg')).looksLikeIcon).toBe(true)
    expect((await logoIconCheck(vec, 'https://cdn.example/logo.svg')).looksLikeIcon).toBe(false)
  })
  it('prompt wording: generic vs plane lock, same text for the shared rules', () => {
    const gen = buildMcpPromptRules('es', { strict: true, requestedRatio: '4:5', productKind: 'generic', compositeLayers: true }, { hasProductRefs: true })
    const pl = buildMcpPromptRules('es', { strict: true, requestedRatio: '4:5', productKind: 'plane', compositeLayers: true }, { hasProductRefs: true })
    expect(gen).not.toMatch(/ruedas|aterrizaje|hélices|flaps|solapas|control\/gamepad|hoja con dibujo|ala\b/)
    expect(pl).toMatch(/ruedas, tren de aterrizaje/)
    expect(pl).toMatch(/forma EXACTA del ala/)
    const en = buildMcpPromptRules('en', { strict: true, requestedRatio: '4:5', productKind: 'generic' }, { hasProductRefs: true })
    expect(en).toMatch(/every part, colour, material and proportion of the product exactly as in the reference photo/)
    expect(en).not.toMatch(/wheels|landing gear|propellers|flaps|controller/)
  })
  it('MCP 0.24.0', () => expect(MCP_VERSION).toBe('0.24.0'))
})
