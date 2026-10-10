import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeStudioBackdrop, buildStudioBleed, compositeBleed, studioCanvas } from '../../api/lib/adpack/fidelity/bleed'
import { memoryBlobCache } from '../../api/lib/adpack/fidelity/cache'
import { advancePack, planPack, STUDIO_FAMILIES, studioFamilyFor, studioFallbackCandidates, autoRetryMode } from '../../api/lib/adpack/pack-runner'
import { createDefaultRenderer } from '../../api/lib/adpack/render-adapter'
import { renderAd } from '../../api/lib/adpack/render'
import { runQaGate } from '../../api/lib/adpack/qa-gate'
import { checkOneIdeaHeadline, composeOneIdeaHeadline, oneIdeaGuidance, storyForCategory, type HeadlineSlots } from '../../api/lib/adpack/headline-rules'
import { checkCompliance } from '../../api/lib/adpack/compliance'
import { BLEED_MAX_UPSCALE } from '../../api/lib/adpack/fidelity/bleed'
import { createMemoryPackStore } from '../../api/lib/adpack/store-memory'
import type { OfferInput } from '../../api/lib/adpack/types'
import { caseById } from './helpers'
import { fakeCharge, fakeImageLoader, fakeStorage, runnerGateway } from './runner-fakes'

const USER = '00000000-0000-4000-8000-000000000001'
const PACK_ID = '22222222-2222-4222-8222-2222222222c1'
const serum = caseById('beauty-serum')

async function shot(o: { bg?: string; fg?: string; shadow?: boolean } = {}): Promise<Buffer> {
  const bg = o.bg ?? '#ece8df'
  const shadow = o.shadow === false ? '' : '<ellipse cx="620" cy="1130" rx="360" ry="46" fill="#4a4030" opacity="0.38" filter="url(#b)"/>'
  const fg = o.fg ?? '#f8f8f6'
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500"><defs><filter id="b"><feGaussianBlur stdDeviation="18"/></filter></defs><rect width="1200" height="1500" fill="${bg}"/>${shadow}<polygon points="260,520 980,430 1010,640 420,700" fill="${fg}"/><rect x="560" y="640" width="40" height="440" fill="#14161a"/><circle cx="470" cy="1080" r="62" fill="#14161a"/><circle cx="760" cy="1080" r="62" fill="#14161a"/></svg>`)).jpeg({ quality: 95 }).toBuffer()
}
async function badge(): Promise<Buffer> {
  return sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150"><rect width="260" height="150" rx="14" fill="#15263E"/><text x="130" y="88" font-size="44" fill="#fff" text-anchor="middle" font-family="sans-serif">Marca</text></svg>')).png().toBuffer()
}
const OFFER_LINE = '1 kit ₡14.900 · 2 kits ₡29.800 · Envío gratis llevando 2 kits o más'
const CAPTION = 'Kit DIY. ₡14.900 · 2 kits por ₡29.800 · Envío gratis llevando 2 kits o más. Papel no incluido (hoja A4 o carta). Edad 8+. Escribinos por DM o al WhatsApp 7113-3720.'
const REQUIRED = [{ key: 'price', value: '₡14.900', onImage: true }, { key: 'shipping', value: 'Envío gratis llevando 2 kits o más' }, { key: 'contact', value: 'Escribinos por DM' }, { key: 'whatsapp', value: '7113-3720' }]

beforeAll(() => { process.env.ADPACK_FONT_FETCH = '0' })
afterAll(() => { delete process.env.ADPACK_FONT_FETCH })

async function renderStudio(family: string, ratio: '4:5' | '9:16', o: { headline?: string; bullets?: string[]; logo?: boolean; brandName?: string; bg?: string; tone?: { r: number; g: number; b: number }; visual?: Record<string, string> } = {}) {
  const layer = await buildStudioBleed(await shot({ bg: o.bg }))
  const [w, h] = ratio === '4:5' ? [1080, 1350] : [1080, 1920]
  return renderAd({
    format: 'offer_graphic', ratio, layoutFamily: family as never, productMode: 'exact', sceneImage: await studioCanvas(w, h, o.tone ?? { r: 236, g: 232, b: 223 }, 'left'),
    studioBleed: { layer: layer.png, productBox: layer.productBox, backdrop: layer.backdrop, edgesTouched: layer.edgesTouched },
    copy: { headline: o.headline ?? 'Hoja arriba. Chasis abajo.', subline: 'Chasis armado y control 2.4GHz', bullets: o.bullets ?? ['Chasis con 2 motores', 'WhatsApp 7113-3720'], offerLine: OFFER_LINE, cta: 'Escribinos por DM' },
    language: 'es', ...(o.logo === false ? {} : { logo: await badge() }), ...(o.brandName ? { brandName: o.brandName } : {}), visual: o.visual ?? { primaryColor: '#15263E', accentColor: '#2BB3A3', secondaryColor: '#F1EDE5' },
  })
}

describe('round 1c · studio layout rotation (hard-fail #7: a pack never repeats a layout)', () => {
  it('the four studio families rotate by position: 4 ads = 4 distinct layouts, the 5th wraps; a planned studio family wins', () => {
    expect(new Set(STUDIO_FAMILIES).size).toBe(4)
    expect([0, 1, 2, 3].map((i) => studioFamilyFor(i))).toEqual([...STUDIO_FAMILIES])
    expect(new Set([0, 1, 2, 3].map((i) => studioFamilyFor(i))).size).toBe(4)
    expect(studioFamilyFor(4)).toBe(studioFamilyFor(0))
    expect(studioFamilyFor(7)).toBe(studioFamilyFor(3))
    expect(studioFamilyFor(1, 'studio_top')).toBe('studio_top')
    expect(studioFamilyFor(2, 'badge_corner')).toBe(STUDIO_FAMILIES[2])
  })

  it.each(['4:5', '9:16'] as const)('every studio family renders a different composition and passes the QA gate at %s', async (ratio) => {
    const sigs = new Set<string>()
    for (const family of STUDIO_FAMILIES) {
      const res = await renderStudio(family, ratio)
      const rep = res.layoutReport
      expect(rep.layoutFamily).toBe(family)
      const gate = await runQaGate({ png: res.png, ratio, report: rep as never, bleed: true, requiredFacts: REQUIRED, caption: CAPTION, headline: 'Hoja arriba. Chasis abajo.', oneIdeaHeadline: true })
      expect(gate.failed, `${family} ${ratio}: ${JSON.stringify(gate.metrics.filter((m) => !m.passed))}`).toEqual([])
      const head = rep.elements.find((e) => e.role === 'headline')!
      const px = await sharp(res.png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const dark = (y: number) => (px.data[(y * px.info.width + 20) * 3] < 90 ? 'D' : 'L')
      sigs.add([Math.round(head.box.y / 40), dark(10), dark(px.info.height - 10)].join('/'))
    }
    expect(sigs.size).toBe(4)
  })

  it('each ad carries at most 1 headline, 1 price line, 1 small facts line, a CTA and the logo; long facts and the WhatsApp number stay in the caption', async () => {
    for (const family of STUDIO_FAMILIES) {
      const rep = (await renderStudio(family, '4:5', { bullets: ['Chasis con 2 motores', 'No incluye papel ni pilas', 'WhatsApp 7113-3720'] })).layoutReport
      const roles = rep.elements.map((e) => e.role)
      expect(roles.filter((r) => r === 'headline')).toHaveLength(1)
      expect(roles.filter((r) => r === 'offer')).toHaveLength(2) // price line + the shipping rule line
      expect(roles.filter((r) => r === 'cta')).toHaveLength(1)
      expect(roles.filter((r) => r === 'bullet' || r === 'subline')).toHaveLength(0)
      expect(rep.elements.map((e) => e.text).join(' ')).not.toMatch(/7113|WhatsApp|No incluye/)
      expect(rep.logo).toBeTruthy()
    }
  })
})

describe('round 1c · one-idea headlines (v1 tone, es-CR voseo, article + ambiguity rules)', () => {
  it('passes short concrete ideas and fails each rule it enforces', () => {
    for (const ok of ['Hoja arriba. Chasis abajo.', 'Lo armás vos. Lo volás vos.', 'Un regalo que se arma y se vuela.', 'Para quien siempre pregunta cómo funciona.']) expect(checkOneIdeaHeadline(ok), ok).toEqual([])
    expect(checkOneIdeaHeadline('Un regalo que armás con papel, que vuela con motores y que además viene con control').map((i) => i.code)).toContain('too_long')
    expect(checkOneIdeaHeadline('Armalo. Volalo. Repetilo. Compartilo.').map((i) => i.code)).toContain('too_many_fragments')
    expect(checkOneIdeaHeadline('El regalo perfecto').map((i) => i.code)).toContain('empty_adjective')
    expect(checkOneIdeaHeadline('Todo incluido').map((i) => i.code)).toContain('empty_adjective')
    expect(checkOneIdeaHeadline('Regalo que armás con papel').map((i) => i.code)).toContain('bare_noun')
    expect(checkOneIdeaHeadline('Un regalo que armás con papel').map((i) => i.code)).not.toContain('bare_noun')
    expect(checkOneIdeaHeadline('Redoblás si se gasta', ['Si se gasta el papel, doblás otro avión']).map((i) => i.code)).toContain('ambiguous_claim')
    expect(checkOneIdeaHeadline('Si se gasta el papel, doblás otro avión', ['Si se gasta el papel, doblás otro avión']).map((i) => i.code)).not.toContain('ambiguous_claim')
    expect(checkOneIdeaHeadline('').map((i) => i.code)).toEqual(['empty'])
    expect(checkOneIdeaHeadline('Pensalo...').map((i) => i.code)).toContain('ellipsis')
  })

  const slots: HeadlineSlots = { verbs: ['armar', 'volar'], vos: ['armás', 'volás'], se: ['arma', 'vuela'], parts: ['Hoja arriba', 'Chasis abajo'], freeShippingFrom: 2, occasion: 'Cumpleaños' }
  it('composes an original headline per story from confirmed slots only; seeded, stable, rotating, never repeating what is avoided', () => {
    const stories = ['gift', 'build', 'use', 'value'] as const
    const seen: string[] = []
    for (const s of stories) {
      const h = composeOneIdeaHeadline(s, slots, 'a')!
      expect(h, s).toBeTruthy()
      expect(checkOneIdeaHeadline(h), h).toEqual([])
      expect(composeOneIdeaHeadline(s, slots, 'a')).toBe(h)
      seen.push(h)
    }
    expect(new Set(seen).size).toBe(4)
    // Different seeds rotate the template; `avoid` removes already-used headlines.
    const gift = new Set<string>()
    for (let i = 0; i < 6; i++) gift.add(composeOneIdeaHeadline('gift', slots, `s${i}`)!)
    expect(gift.size).toBeGreaterThanOrEqual(2)
    const first = composeOneIdeaHeadline('use', slots, 'x')!
    expect(composeOneIdeaHeadline('use', slots, 'x', [first])).not.toBe(first)
    // No slot → no invented claim: a value headline needs the confirmed shipping rule.
    expect(composeOneIdeaHeadline('value', { verbs: ['armar', 'volar'] }, 'a')).toBeNull()
    expect(composeOneIdeaHeadline('build', {}, 'a')).toBeNull()
  })

  it('maps angle categories to the four stories and the prompt carries the rules without copying v1', () => {
    expect(storyForCategory('regalo')).toBe('gift')
    expect(storyForCategory('como_funciona')).toBe('build')
    expect(storyForCategory('uso_real')).toBe('use')
    expect(storyForCategory('valor_precio')).toBe('value')
    expect(storyForCategory(undefined)).toBe('gift')
    const es = oneIdeaGuidance('es', 'build')
    expect(es).toMatch(/≤ 9 palabras/)
    expect(es).toMatch(/NO copiar/)
    expect(es).toMatch(/voseo/)
  })

  it('the gate fails a long headline on a studio render (retry copy) and passes the short one', async () => {
    const res = await renderStudio('studio_hero', '4:5')
    const base = { png: res.png, ratio: '4:5' as const, report: res.layoutReport as never, bleed: true, requiredFacts: REQUIRED, caption: CAPTION, oneIdeaHeadline: true }
    const ok = await runQaGate({ ...base, headline: 'Hoja arriba. Chasis abajo.' })
    expect(ok.metrics.find((m) => m.id === 'headline')?.passed).toBe(true)
    const bad = await runQaGate({ ...base, headline: 'Un regalo increíble que armás con papel y volás con motores en tu casa' })
    expect(bad.metrics.find((m) => m.id === 'headline')?.passed).toBe(false)
    expect(autoRetryMode(`qa_gate_failed: headline (not one idea: too long)`)).toBe('copy')
  })
})

describe('round 1c · the engine generalises beyond light neutral studio shots (no relight, no redraw)', () => {
  it('dark (near-black) and coloured (yellow/lilac) uniform studio backdrops are eligible; mid-tone and noisy ones are not', async () => {
    expect(await analyzeStudioBackdrop(await shot({ bg: '#070707', fg: '#9a9a9a' }))).toMatchObject({ eligible: true, mode: 'dark' })
    expect(await analyzeStudioBackdrop(await shot({ bg: '#f2e7a8' }))).toMatchObject({ eligible: true, mode: 'colour' })
    expect(await analyzeStudioBackdrop(await shot({ bg: '#d2bddc' }))).toMatchObject({ eligible: true })
    expect((await analyzeStudioBackdrop(await shot({ bg: '#6a6f78' }))).eligible).toBe(false)
    expect((await analyzeStudioBackdrop(await shot({ bg: '#202428' }))).eligible).toBe(false)
  })

  it('a dark canvas gets light type with contrast ≥ 4.5 in every studio family and the text wordmark stands in when there is no logo', async () => {
    for (const family of STUDIO_FAMILIES) {
      const res = await renderStudio(family, '4:5', { bg: '#070707', tone: { r: 7, g: 7, b: 7 }, logo: false, brandName: 'ForgeCR', visual: { primaryColor: '#0e0e0e', accentColor: '#c7ff00', secondaryColor: '#e5e2e1' } })
      const rep = res.layoutReport
      for (const e of rep.elements) expect(e.contrast, `${family} ${e.role}`).toBeGreaterThanOrEqual(4.5)
      expect(rep.elements.some((e) => e.text === 'ForgeCR')).toBe(true)
      const gate = await runQaGate({ png: res.png, ratio: '4:5', report: rep as never, bleed: true, requiredFacts: [{ key: 'price', value: '₡14.900', onImage: true }], caption: CAPTION, headline: 'Hoja arriba. Chasis abajo.', oneIdeaHeadline: true, brandName: 'ForgeCR' })
      const logo = gate.metrics.find((m) => m.id === 'logo')!
      expect(logo.passed, JSON.stringify(logo)).toBe(true)
      expect(logo.detail).toMatch(/text wordmark/)
    }
    // Without a logo AND without a brand name, the gate still fails (brand not named).
    const res = await renderStudio('studio_hero', '4:5', { logo: false })
    const gate = await runQaGate({ png: res.png, ratio: '4:5', report: res.layoutReport as never, bleed: true, requiredFacts: [], caption: CAPTION, headline: 'Hoja arriba. Chasis abajo.' })
    expect(gate.metrics.find((m) => m.id === 'logo')?.passed).toBe(false)
  })

  it('compositeBleed clipped to a region never paints outside it (no photo backdrop over a colour band)', async () => {
    const layer = await buildStudioBleed(await shot())
    const base = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 21, g: 38, b: 62 } } }).png().toBuffer()
    const out = await compositeBleed(base, layer, { x: 54, y: 400, w: 972, h: 700 }, { x: 0, y: 600, w: 1080, h: 750 })
    const px = await sharp(out.png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => [px.data[(y * px.info.width + x) * 3], px.data[(y * px.info.width + x) * 3 + 1], px.data[(y * px.info.width + x) * 3 + 2]]
    expect(at(540, 300)).toEqual([21, 38, 62]) // above the clip: untouched navy
    expect(at(540, 590)).toEqual([21, 38, 62])
    expect(at(540, 640)).not.toEqual([21, 38, 62]) // inside the clip: the photo
  })
})

describe('round 1c · non-studio photos: fall back to a studio photo of the offer, or reject (never paste, never relight)', () => {
  const BAD = 'https://cdn.test/not-studio.jpg'
  const GOOD = 'https://cdn.test/studio.jpg'
  async function setup(opts: { photos: Array<{ url: string; role: 'hero' | 'detail' }>; studioBleed?: 'auto' | 'required'; images: Record<string, Buffer> }) {
    const store = createMemoryPackStore()
    const logoUrl = `data:image/png;base64,${(await badge()).toString('base64')}`
    const dna = { ...serum.dna, visual: { ...(serum.dna.visual ?? {}), logoUrl, primaryColor: '#15263E', accentColor: '#2BB3A3', secondaryColor: '#F1EDE5' } }
    const offer: OfferInput = { ...serum.offer, productImageUrls: opts.photos.map((p) => p.url), productPhotos: opts.photos }
    const planned = planPack({ dna, offer, size: 1, userId: USER, source: 'web', ids: { packId: PACK_ID }, render: { productFidelity: 'exact', ...(opts.studioBleed ? { studioBleed: opts.studioBleed } : {}) } })
    await store.createPack(planned.pack, planned.items)
    const gateway = runnerGateway()
    const loadImage = fakeImageLoader(Object.fromEntries(Object.entries(opts.images).map(([u, b]) => [u, async () => new Uint8Array(b)])))
    const charge = fakeCharge()
    return { store, gateway, charge, run: () => advancePack({ store, gateway, renderer: createDefaultRenderer(), storage: fakeStorage(), charge, packId: PACK_ID, userId: USER, cutoutCache: memoryBlobCache(), loadImage }), state: async () => (await store.getPack(PACK_ID, USER))! }
  }

  it('studioFallbackCandidates keeps product photos only (never kit parts / box / contents), skips the hero, hero role first', () => {
    const pool = [
      { url: 'a', role: 'hero' }, { url: 'b', role: 'part' }, { url: 'c', role: 'detail' }, { url: 'd', role: 'box' }, { url: 'e', role: 'hero' },
    ] as never[]
    const out = studioFallbackCandidates({ productPhotos: pool } as never, (o) => o.productPhotos!, 'a')
    expect(out.map((p) => p.url)).toEqual(['e', 'c'])
  })

  it('a hero that is not a studio shot falls back to the offer\'s studio photo: no plate call, the ad reports the photo it used', async () => {
    const t = await setup({ photos: [{ url: BAD, role: 'hero' }, { url: GOOD, role: 'detail' }], images: { [BAD]: await shot({ bg: '#6a6f78' }), [GOOD]: await shot() } })
    await t.run()
    const item = (await t.state()).items[0]
    expect(t.gateway.sceneCalls).toHaveLength(0)
    expect(item.status, JSON.stringify(item.rejectedRatios?.map((r) => r.reason) ?? item.error)).toBe('done')
    expect(item.scene).toMatchObject({ model: 'studio-canvas', costUsd: 0 })
    expect(item.scene?.bleed?.sourceUrl).toBe(GOOD)
    expect(String(item.sceneCheck?.notes ?? '')).toMatch(/not a studio shot.*used studio photo/)
  }, 180_000)

  it("studioBleed 'required' + no studio photo: the ad is rejected with qa_gate_failed: studio_required — 0 scene calls, no renders, no charge, no auto-retry", async () => {
    const t = await setup({ photos: [{ url: BAD, role: 'hero' }], studioBleed: 'required', images: { [BAD]: await shot({ bg: '#6a6f78' }) } })
    await t.run()
    const item = (await t.state()).items[0]
    expect(t.gateway.sceneCalls).toHaveLength(0)
    expect(item.status).toBe('failed')
    expect(item.error).toMatch(/^qa_gate_failed: studio_required/)
    expect(item.renders).toHaveLength(0)
    expect(t.charge.charges ?? []).toHaveLength(0)
    expect(autoRetryMode(item.error!)).toBeNull()
  }, 180_000)
})

describe('round 1c · health claims in offers are blocked by the claims check (general engine)', () => {
  const block = (text: string, category: 'health_wellness' | 'fitness_sports' = 'health_wellness') => checkCompliance(text, category, 'es').filter((i) => i.severity === 'block').map((i) => i.ruleId)
  it.each([
    ['desaparición del dolor de espalda', 'health_pain_promise'],
    ['corrección inmediata y duradera', 'health_immediate_lasting_result'],
    ['mejora de la ingesta de oxígeno y la concentración', 'physiological_claim'],
    ['control de apetito y reducción de antojos', 'appetite_metabolism_claim'],
    ['sin efectos secundarios', 'health_absolute_safety'],
  ])('blocks "%s"', (text, rule) => { expect(block(text)).toContain(rule) })
  it('lets plain product facts through (and only warns on anti-aging / mood wording)', () => {
    for (const ok of ['Forja tu postura', 'Correas de doble tensión y malla con ventilación', '30 parches por paquete', '100% vegano', 'Sin pastillas, sin complicaciones', 'Liberación sostenida']) expect(block(ok), ok).toEqual([])
    expect(checkCompliance('potenciar la energía celular y el anti-envejecimiento', 'health_wellness', 'es').map((i) => `${i.severity}:${i.ruleId}`)).toContain('warn:anti_aging_mood_claim')
  })
})

describe('round 1c · low-resolution photos are never enlarged past the cap (smaller and crisp beats bigger and soft)', () => {
  it('compositeBleed caps the overall enlargement (pre-upscale counted) and reports it honestly', async () => {
    const small = await sharp(await shot()).resize(520, 650).jpeg({ quality: 95 }).toBuffer()
    const layer = await buildStudioBleed(small)
    const base = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 236, g: 232, b: 223 } } }).png().toBuffer()
    const plain = await compositeBleed(base, layer, { x: 54, y: 200, w: 972, h: 900 })
    expect(plain.upscale).toBeLessThanOrEqual(BLEED_MAX_UPSCALE + 0.001)
    const pre = await compositeBleed(base, { ...layer, preScale: 2 }, { x: 54, y: 200, w: 972, h: 900 })
    expect(pre.upscale).toBeLessThanOrEqual(BLEED_MAX_UPSCALE + 0.001)
  })
})
