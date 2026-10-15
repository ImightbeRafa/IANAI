/**
 * Round 9 (MCP 0.22.0) — Content's round-8 live result (1/4 usable): post A (8/10) is the reference; B lost its CTA and got an invented plane + USB cable,
 * SP lost its CTA and carried a favicon logo with a glow, PH had redrawn pack printing ("Pick-Me-Lip", "Mental Ciarity") and a squeezed logo.
 *  1. the CTA is never dropped (≥ 86 % pill, picture moved up to 20 %, else drawn + qa.ctaBlocked with a heavy severity factor);
 *  2. the offer lock is scoped to the selected photo (controller hero: no plane attributes, no cable);
 *  3. thin cable-like objects are found by shape;
 *  4. logo: trimmed, fitted by real aspect, wordmark before icon, solid plate when contrast < 4.5;
 *  5. printed pack text OCR (tesseract) + exact default for packs;
 *  6. the raw scene rides in the result.
 * Fixtures (test/fixtures/round9): crops of the round-8 LIVE posts (final images — raw scenes were not saved in round 8) and of the real PatchHouse photo
 * from the round-8 comparison sheet. No model call anywhere.
 */
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareAndLayout } from '../api/lib/mcp/compose-scene'
import { extendCanvas } from '../api/lib/mcp/scene-prep'
import { layoutAdLayers, splitCopyBlocks } from '../api/lib/mcp/layout-ad'
import { generateWebStyleImage, scopeLockToPhotoRole } from '../api/lib/mcp/web-image'
import { findThinStructures } from '../api/lib/mcp/scene-objects'
import { adLogoCandidates, loadAdLogo, trimLogoPadding } from '../api/lib/mcp/logo-check'
import { checkPackText, compareWords, editDistance, ocrAvailable } from '../api/lib/mcp/pack-ocr'
import { isPackProduct } from '../api/lib/mcp/product-kind'
import { resolveToolProductFidelity } from '../api/lib/adpack/fidelity/pipeline'
import { MCP_VERSION } from '../api/lib/mcp/server-info'

const F9 = (n: string) => readFileSync(new URL(`./fixtures/round9/${n}`, import.meta.url))
const F6 = (n: string) => readFileSync(new URL(`./fixtures/round6/${n}`, import.meta.url))
const F8b = (n: string) => readFileSync(new URL(`./fixtures/round8b/${n}`, import.meta.url))
const LOGO = readFileSync(new URL('./fixtures/round5b/kit-logo-prototipo.png', import.meta.url))
const PALETTE = { primary: '#15263E', secondary: '#F1EDE5', accent: '#2EC4B6' }
const durl = (b: Buffer, m = 'image/jpeg') => `data:${m};base64,${b.toString('base64')}`
const COPY_B = 'Lo manejás con dos joysticks\n₡14.900 el kit con control\nEnvío gratis llevando 2 kits o más\nEscribinos por DM'
const PLANE_ATTRS = [
  'Avión de papel blanco liso, sin estampados, colores ni decoración',
  'Chasis y tren de aterrizaje negros',
  'Hélices gris claro de 2 aspas',
  'Control negro tipo gamepad con 2 joysticks, sin antena ni pantalla',
  "Caja TOPGT 'DIY Airplane' con su impresión real, sin texto inventado",
  'Cable USB azul de carga',
]

async function textured(W = 800, H = 1000, box?: { x0: number; y0: number; x1: number; y1: number }) {
  const raw = Buffer.alloc(W * H * 3)
  let seed = 11
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const v = 200 - 30 * (y / H) + 10 * Math.sin(x / 19 + y / 37) + (rnd() - 0.5) * 10
    raw[i] = v + 10; raw[i + 1] = v; raw[i + 2] = v - 18
  }
  if (box) for (let y = Math.round(box.y0 * H); y < Math.round(box.y1 * H); y++) for (let x = Math.round(box.x0 * W); x < Math.round(box.x1 * W); x++) { const i = (y * W + x) * 3; const v = (x * 7919 + y * 104729 + x * y) % 197; raw[i] = raw[i + 1] = raw[i + 2] = v }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 93 }).toBuffer()
}

describe('1. the CTA is never dropped', () => {
  it('product + accessory down to the bottom edge across the width: the CTA is still drawn (never omitted), ≥ 86 % of the nominal pill, and flagged when no slot is free', async () => {
    const box = { x0: 0.04, y0: 0.42, x1: 0.96, y1: 0.995 }
    const src = await textured(800, 1000, box)
    const out = await prepareAndLayout({ bytes: src, ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [box] })
    expect(out.report.cta.status).toBe('drawn')
    expect((out.scenePrep as Record<string, unknown>).ctaOmitted).toBeUndefined()
    const nominal = Math.round(1000 * 0.0624)
    expect(out.report.cta.box!.h).toBeGreaterThanOrEqual(Math.floor(nominal * 0.86))
    expect(out.scenePrep.roomBelow?.attempted).toBe(true)
    if (!out.scenePrep.roomBelow?.applied && !out.scenePrep.extended) expect(out.scenePrep.ctaBlocked).toBe(true)
  }, 60_000)
  it('extendCanvas: same pixel size, the picture never below the floor (round 10: 78 % last resort for a blocked CTA), boxes mapped, the new border is textured (not a flat frame)', async () => {
    const src = await textured(800, 1000, { x0: 0.3, y0: 0.5, x1: 0.7, y1: 0.98 })
    expect((await extendCanvas(src, 0.7, 0.25)).scale).toBe(0.78)
    const ext = await extendCanvas(src, 0.86, 0.25)
    expect(ext.scale).toBe(0.86)
    const m = await sharp(ext.bytes).metadata()
    expect([m.width, m.height]).toEqual([800, 1000])
    const b = ext.map({ x0: 0.3, y0: 0.5, x1: 0.7, y1: 0.98 })
    expect(b.y1).toBeLessThan(0.9)
    const { data } = await sharp(ext.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let s1 = 0, s2 = 0, n = 0
    for (let y = 975; y < 998; y++) for (let x = 100; x < 700; x++) { const v = data[(y * 800 + x) * 3]; s1 += v; s2 += v * v; n++ }
    expect(Math.sqrt(s2 / n - (s1 / n) ** 2)).toBeGreaterThan(1.5)
  })
  it('the pill is never rendered below 86 % (no 74 % step any more)', async () => {
    const box = { x0: 0.08, y0: 0.45, x1: 0.62, y1: 0.9 }
    const r = await layoutAdLayers({ bytes: await textured(800, 1000, box), ratio: '4:5', logo: undefined, blocks: splitCopyBlocks('Titular\n₡9.900\nEscribinos por DM', 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [box] })
    expect(r.report.cta.status).toBe('drawn')
    expect(r.report.cta.box!.h).toBeGreaterThanOrEqual(Math.floor(Math.round(1000 * 0.0624) * 0.86))
  })
})

describe('2. lock scoped to the selected photo role', () => {
  it('controller as hero (round-8 B): no plane attributes, no USB cable; the controller attribute and the attached box stay', () => {
    const r = scopeLockToPhotoRole(PLANE_ATTRS, { role: 'part', photoLabel: 'Control remoto', attachedLabels: ['caja TOPGT real'] })
    expect(r.attrs.join(' ')).not.toMatch(/Avión de papel|Hélices|Chasis/)
    expect(r.attrs.join(' ')).not.toMatch(/Cable USB/)
    expect(r.attrs.join(' ')).toMatch(/Control negro/)
    expect(r.attrs.join(' ')).toMatch(/Caja TOPGT/)
    expect(r.dropped).toContain('Cable USB azul de carga')
  })
  it('plane as hero with the box + controller attached: plane attributes stay, the cable (no photo) is not listed at all', () => {
    const r = scopeLockToPhotoRole(PLANE_ATTRS, { role: 'hero', photoLabel: 'Avión', attachedLabels: ['caja TOPGT real', 'control remoto'] })
    expect(r.attrs).toContain('Hélices gris claro de 2 aspas')
    expect(r.attrs.join(' ')).toMatch(/Control negro/)
    expect(r.dropped).toEqual(['Cable USB azul de carga'])
  })
})

describe('3. whole extra objects: thin cable-like structures', () => {
  it('round-8 post B (lower half): the blue USB cable is found by shape; post A (reference) has none', async () => {
    const b = await findThinStructures(F9('b-scene-lower.jpg'), { ignoreTop: 0, ignoreBottom: 0.01 })
    expect(b.cables.length).toBe(1)
    expect(b.cables[0].box.x0).toBeGreaterThan(0.5)
    const a = await findThinStructures(F9('a-scene-lower.jpg'), { ignoreTop: 0, ignoreBottom: 0.01 })
    expect(a.cables).toEqual([])
  })
})

describe('4. logo: trim, real aspect, wordmark first, solid plate', () => {
  const wideInSquare = async () => {
    const mark = await sharp({ create: { width: 600, height: 120, channels: 4, background: { r: 21, g: 38, b: 62, alpha: 1 } } }).png().toBuffer()
    return sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: mark, left: 100, top: 340 }]).png().toBuffer()
  }
  it('a wide wordmark in a square transparent canvas is trimmed and laid out wide (not a square box)', async () => {
    const logo = await wideInSquare()
    const t = await trimLogoPadding(logo)
    expect(t.trimmed).toBe(true)
    expect(t.after![0] / t.after![1]).toBeGreaterThan(4)
    const r = await layoutAdLayers({ bytes: await textured(), ratio: '4:5', logo, blocks: splitCopyBlocks('Titular\n₡9.900\nEscribinos por DM', 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [] })
    expect(r.report.logo.status).toBe('drawn')
    expect(r.report.logo.box!.w / r.report.logo.box!.h).toBeGreaterThan(3)
    expect(r.report.logo.trimmed).toBeTruthy()
  })
  it('low contrast → a SOLID plate (no glow, no blurred scrim) with ≥ 4.5:1', async () => {
    const navy = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 24, g: 40, b: 66 } } }).jpeg().toBuffer()
    const r = await layoutAdLayers({ bytes: navy, ratio: '4:5', logo: await wideInSquare(), blocks: splitCopyBlocks('Titular\n₡9.900\nEscribinos por DM', 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: [] })
    expect(r.report.logo.glow).toBe(false)
    expect(r.report.logo.scrim).toBeUndefined()
    expect(r.report.logo.plate).toBeTruthy()
    expect(r.report.logo.contrast).toBeGreaterThanOrEqual(4.5)
  })
  it('a kit with a wordmark variant never uses the favicon / icon', async () => {
    const icon = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 20, b: 80, alpha: 1 } } }).png().toBuffer()
    const word = await wideInSquare()
    const kit = { logoUrl: 'https://x/favicon-32.png', brandProfile: { logoVariants: [{ url: 'https://x/icon.png', variant: 'icon' }, { url: 'https://x/wordmark.png', variant: 'wordmark' }] } }
    expect(adLogoCandidates(kit)).toEqual(['https://x/wordmark.png', 'https://x/favicon-32.png', 'https://x/icon.png'])
    const got = await loadAdLogo({ logoUrl: 'https://x/favicon-32.png', brandProfile: { logoVariants: [{ url: 'https://x/word.png', variant: 'primary' }] } }, async (u) => (u.includes('favicon') ? icon : word))
    expect(got.url).toBe('https://x/word.png')
    expect(got.icon?.looksLikeIcon).toBe(false)
    // only an icon available: it is used (never faked) and flagged
    const only = await loadAdLogo({ logoUrl: 'https://x/favicon-32.png' }, async () => icon)
    expect(only.icon?.looksLikeIcon).toBe(true)
  })
})

describe('5. pack fidelity: OCR of the printing + exact default for packs', () => {
  it('compareWords: "Ciarity" / "Pick-Me-Lip" are misspellings (fail), a faithful copy passes', () => {
    expect(editDistance('clarity', 'ciarity')).toBe(1)
    const ref = ['energy', 'patches', 'pick-me-up', 'mental', 'clarity', 'caffeine']
    expect(compareWords(ref, ['energy', 'patches', 'pick-me-lip', 'mental', 'ciarity', 'caffeine']).status).toBe('fail')
    expect(compareWords(ref, ref).status).toBe('pass')
    // round 10: one misspelled word is a fail too
    expect(compareWords(ref, ['energy', 'patches', 'pick-me-up', 'mental', 'ciarity', 'caffeine']).status).toBe('fail')
  })
  it('tesseract on the real PatchHouse photo vs the round-8 redrawn pouch: fail with the misspelled words; the photo vs itself passes', async () => {
    if (!(await ocrAvailable())) { console.warn('tesseract not installed: OCR test skipped'); return }
    const ref = F9('ph-ref-crop.jpg')
    const bad = await checkPackText({ reference: ref, generated: F9('ph-gen-crop.jpg') })
    expect(bad.status).toBe('fail')
    if (bad.status === 'fail') expect(bad.misspelled.map((m) => m.found).join(' ')).toMatch(/pick-me-lip/)
    const same = await checkPackText({ reference: ref, generated: ref })
    expect(same.status).toBe('pass')
  }, 60_000)
  it('no tesseract binary → unavailable, nothing else changes', async () => {
    const r = await checkPackText({ reference: Buffer.alloc(1), generated: Buffer.alloc(1), run: async () => { throw new Error('ENOENT') } })
    expect(r.status).toBe('unavailable')
  })
  it('printed packs default to exact when productFidelity is omitted; an explicit "generated" wins; the plane is never a pack', () => {
    expect(isPackProduct(['Energy Patches', 'Bolsa de 30 parches'])).toBe(true)
    expect(isPackProduct(['Sleeping Patches CR', 'bolsa de 30 noches'])).toBe(true)
    expect(isPackProduct(['Avión de papel DIY con motores', 'Kit con control'])).toBe(false)
    expect(resolveToolProductFidelity(undefined, true, { defaultExact: true })).toBe('exact')
    expect(resolveToolProductFidelity('generated', true, { defaultExact: true })).toBe('generated')
    expect(resolveToolProductFidelity(undefined, false, { defaultExact: true })).toBe('generated')
    expect(resolveToolProductFidelity(undefined, true)).toBe('generated')
  })
})

describe('2 + 6. flow with mock xAI: scoped lock reaches the prompt, raw scene in the result', () => {
  let bodies: string[] = []
  beforeEach(() => {
    bodies = []
    process.env.GROK_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: unknown }) => {
      if (String(url).includes('/images/')) {
        bodies.push(typeof init?.body === 'string' ? init.body : '')
        return new Response(JSON.stringify({ data: [{ b64_json: F8b('scene-B-r7.jpg').toString('base64') }] }), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })
  it('controller hero: the prompt carries no plane attributes and no cable; lockScope lists what was dropped; rawScene is the model output', async () => {
    const ctx = {
      brand: { id: 'b1', name: 'Prototipo' },
      offers: [{ id: 'o1', name: 'Avión de papel DIY con motores', price: '₡14.900', type: 'product', productDescription: 'Kit de avión de papel con motores y control remoto' }],
      brandKit: { id: 'k1', name: 'Prototipo', primaryColor: '#15263E', secondaryColor: '#F1EDE5', accentColor: '#2EC4B6', logoUrl: durl(LOGO, 'image/png'), referenceImages: [], forbiddenPhrases: [] },
      brandKits: [], latestGuideIntake: null,
    } as never
    const out = await generateWebStyleImage({ apiKey: 'k', offerId: 'o1', aspectRatio: '4:5', ctx, copy: COPY_B, productUrls: [durl(F6('ctrl.png'), 'image/png')], productPhotoRole: 'part', productPhotoLabel: 'Control remoto', accessories: [{ imageUrl: durl(F6('box.jpg')), label: 'caja TOPGT real' }], lock: { lockProductAppearance: true, immutableAttributes: PLANE_ATTRS, allowedProps: ['caja TOPGT real'], forbidExtraProps: true }, autoRetry: false })
    const prompt = out.prompt
    expect(prompt).not.toMatch(/Avión de papel blanco liso|Hélices gris claro|Cable USB/)
    expect(prompt).toMatch(/Control negro tipo gamepad/)
    expect(prompt).toMatch(/mostrá SOLO ese objeto/)
    expect(out.lockScope?.dropped).toContain('Cable USB azul de carga')
    expect(out.rawScene?.imageDataUrl.startsWith('data:image/')).toBe(true)
    expect(out.rawScene?.imageDataUrl).not.toBe(out.generated.imageDataUrl)
    expect((out as unknown as { compositeLayers: { cta: { status: string } } }).compositeLayers.cta.status).toBe('drawn')
  }, 60_000)
})

describe('version', () => {
  it('MCP 0.24.0', () => expect(MCP_VERSION).toBe('0.24.0'))
})
