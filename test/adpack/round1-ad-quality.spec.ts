/**
 * Quality loop round 1 (brand "Prototipo", paper-plane RC kit) — regression tests per step:
 * P1 enclosed backdrop + soft shadows removed from the cut-out, P2 background-leak fidelity check,
 * P3 self-contained badge logo never a white box, P4 pinned-photo fallback, P5 copy facts + lossy
 * claims, P6 price badge typesetting, P7 status/reporting + banned claims. Synthetic images and
 * fakes only: no network, no model calls.
 */
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { floodBackground, removeTrappedBackground, segmentProduct } from '../../api/lib/adpack/fidelity/segment'
import { labImage } from '../../api/lib/adpack/fidelity/pixels'
import { BACKGROUND_LEAK_MAX, backgroundLeakShare, fidelityFailReason } from '../../api/lib/adpack/fidelity/score'
import { CUTOUT_CACHE_VERSION, cutoutCacheKey } from '../../api/lib/adpack/fidelity/pipeline'
import { renderAd } from '../../api/lib/adpack/render'
import { fitText, wrapTokens } from '../../api/lib/adpack/render/text'
import { pinnedPhotoFallback } from '../../api/lib/adpack/pack-runner'
import { checkAdCopy, findBareNounHeadline, findLossyClaim } from '../../api/lib/adpack/check-copy'
import { contactFallbackFact, mustAppearItems } from '../../api/lib/adpack/claims'
import { BLOCKING_COPY_CODES } from '../../api/lib/adpack/copy-stage'
import { buildCopyContext, ensureNotIncludedChip, notIncludedHead } from '../../api/lib/adpack/copy-shared'
import { buildOfferLine, labelledUnitPrice } from '../../api/lib/adpack/facts'
import { checkCompliance, quarantineBannedFacts } from '../../api/lib/adpack/compliance'
import { estimateRemainingSeconds } from '../../api/lib/adpack/status-summary'
import { claimsPolicyOf, jobStatusForPack } from '../../api/lib/mcp/adpack-tools'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import type { AdAngle, AdCopy, BrandDna, DnaFact, OfferInput, PackItem } from '../../api/lib/adpack/types'
import { caseById } from './helpers'

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)
const fact = (key: DnaFact['key'], value: string): DnaFact => ({ key, value, source: 'offer_form', confirmed: true })

/**
 * Open-frame product (wing + 2 legs + axle + wheels) on an off-white studio backdrop: the frame
 * encloses a backdrop pocket and casts a soft same-hue floor shadow — the round-1 "cardboard halo".
 */
async function openFramePlane(): Promise<Buffer> {
  const bg = '#eee9e1'
  const body =
    `<defs><radialGradient id="sh" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#bdb8b0"/><stop offset="100%" stop-color="${bg}"/></radialGradient></defs>` +
    `<rect width="900" height="700" fill="${bg}"/>` +
    '<ellipse cx="450" cy="545" rx="300" ry="45" fill="url(#sh)"/>' +
    '<rect x="150" y="200" width="600" height="40" rx="8" fill="#1d1f24"/>' +
    '<rect x="250" y="240" width="20" height="260" fill="#1d1f24"/><rect x="630" y="240" width="20" height="260" fill="#1d1f24"/>' +
    '<rect x="250" y="480" width="400" height="20" fill="#1d1f24"/>' +
    '<circle cx="260" cy="520" r="26" fill="#111216"/><circle cx="640" cy="520" r="26" fill="#111216"/>' +
    '<circle cx="450" cy="220" r="6" fill="#d22"/>'
  return sharp(svg(900, 700, body)).jpeg({ quality: 94 }).toBuffer()
}

async function alphaMean(png: Buffer, fx0: number, fy0: number, fx1: number, fy1: number): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let s = 0
  let n = 0
  for (let y = Math.round(info.height * fy0); y < Math.round(info.height * fy1); y++) {
    for (let x = Math.round(info.width * fx0); x < Math.round(info.width * fx1); x++) {
      s += data[(y * info.width + x) * 4 + 3]
      n++
    }
  }
  return s / Math.max(1, n)
}

// ---------------------------------------------------------------------------
// P1 + P2 — cut-out halo
// ---------------------------------------------------------------------------

describe('round 1 · P1 enclosed backdrop + soft shadow removed from the cut-out', () => {
  it('open-frame product: the pocket between the legs and the floor shadow are transparent; the frame stays opaque', async () => {
    const res = await segmentProduct({ bytes: await openFramePlane(), noModel: true })
    expect(res.ok, !res.ok ? res.detail : '').toBe(true)
    if (!res.ok) return
    expect(res.method).toBe('flood')
    expect(res.backgroundLeak ?? 1).toBeLessThanOrEqual(BACKGROUND_LEAK_MAX)
    // Trimmed to the frame (600 wide), the shadow below the wheels is gone (height ≈ 200 + 46 wheels).
    expect(Math.abs(res.width - 600)).toBeLessThanOrEqual(8)
    expect(res.height).toBeLessThan(370)
    // Pocket (centre of the frame) is transparent, the wing bar is opaque.
    expect(await alphaMean(res.png, 0.4, 0.4, 0.6, 0.65)).toBeLessThan(20)
    expect(await alphaMean(res.png, 0.3, 0.02, 0.7, 0.08)).toBeGreaterThan(235)
  })

  it('removeTrappedBackground drops the pocket the edge flood cannot reach; the old mask leaks > 4% backdrop', async () => {
    const { data, info } = await sharp(await openFramePlane()).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const n = info.width * info.height
    const lab = labImage(data, 4, n)
    const flood = floodBackground(lab, info.width, info.height)
    if (typeof flood === 'string') throw new Error(flood)
    const fg = new Uint8Array(n)
    for (let i = 0; i < n; i++) fg[i] = flood.bg[i] ? 0 : 1
    const before = backgroundLeakShare(lab, fg, info.width, info.height, flood.bgLab)
    expect(before).toBeGreaterThan(BACKGROUND_LEAK_MAX)
    const r = removeTrappedBackground(lab, info.width, info.height, fg, flood.bgLab, flood.tol, flood.local)
    expect(r.removedPockets).toBeGreaterThan(0)
    const after = backgroundLeakShare(lab, r.fg, info.width, info.height, flood.bgLab)
    expect(after).toBeLessThanOrEqual(BACKGROUND_LEAK_MAX)
    // Pocket centre gone, frame pixel kept.
    expect(r.fg[360 * info.width + 450]).toBe(0)
    expect(r.fg[220 * info.width + 300]).toBe(1)
  })
})

describe('round 1 · P2 background-leak fidelity check (vs the source photo)', () => {
  it('fidelityFailReason names the leak; the cut-out cache key is versioned so old halo cut-outs are not reused', () => {
    const base = { ssimDetail: 0.95, ssim: 0.95, silhouetteIoU: 0.99, hueShift: 1, chromaRatio: 1, deltaE: 2 }
    expect(fidelityFailReason({ ...base, backgroundLeak: 0.2 })).toMatch(/background/i)
    expect(fidelityFailReason({ ...base, backgroundLeak: 0.01 })).not.toMatch(/background/i)
    expect(cutoutCacheKey('abc')).toBe(`abc-${CUTOUT_CACHE_VERSION}`)
    expect(CUTOUT_CACHE_VERSION).toBe('seg2')
  })
})

// ---------------------------------------------------------------------------
// P3 — logo
// ---------------------------------------------------------------------------

/** Prototipo-like badge: rounded transparent corners, navy body, cream frame + text, teal plane (≈99% opaque bbox). */
async function prototipoLikeBadge(): Promise<Buffer> {
  const cream = '#f3ead6'
  const body =
    '<rect x="2" y="2" width="810" height="461" rx="26" fill="#16284a"/>' +
    `<rect x="24" y="24" width="766" height="417" rx="16" fill="none" stroke="${cream}" stroke-width="8"/>` +
    `<rect x="120" y="150" width="420" height="70" rx="6" fill="${cream}"/>` +
    `<rect x="160" y="250" width="340" height="30" rx="4" fill="${cream}"/>` +
    '<polygon points="600,140 740,210 600,280 630,210" fill="#2bb3a3"/>'
  return sharp(svg(814, 465, body)).png().toBuffer()
}

const plain = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer()

describe('round 1 · P3 the kit badge logo is never a solid white box', () => {
  for (const [name, bg] of [['dark navy wall', '#15263e'], ['light cream', '#f2efe8']] as const) {
    it(`renders the navy badge readable on a ${name} (logoUrl = kit primary = badge variant)`, async () => {
      const badge = await prototipoLikeBadge()
      const url = `data:image/png;base64,${badge.toString('base64')}`
      const res = await renderAd({
        format: 'offer_graphic',
        ratio: '4:5',
        layoutFamily: 'badge_corner',
        sceneImage: await plain(1080, 1350, bg),
        copy: { headline: 'Un regalo que armás con papel', bullets: ['Chasis ya armado', 'No incluye papel ni pilas'], offerLine: '1 kit ₡14.900 · 2 kits ₡29.800 · Envío gratis llevando 2 kits o más', cta: 'Escribinos' },
        visual: { primaryColor: '#15263e', logoUrl: url, logoVariants: [{ variant: 'primary', url }, { variant: 'badge', url }] } as never,
        logo: badge,
        language: 'es',
      })
      const lb = res.layoutReport.logo
      expect(lb).toBeTruthy()
      if (!lb) return
      expect(res.layoutReport.logoSelfContained).toBe(true)
      const { data } = await sharp(res.png).extract({ left: lb.x, top: lb.y, width: lb.w, height: lb.h }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      let navy = 0
      let white = 0
      const px = data.length / 3
      for (let i = 0; i < data.length; i += 3) {
        if (data[i + 2] > data[i] + 25 && data[i] < 70) navy++
        if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) white++
      }
      // The badge's own navy fills most of the logo box; a white rectangle would be ~0% navy.
      expect(navy / px).toBeGreaterThan(0.35)
      expect(white / px).toBeLessThan(0.5)
    })
  }
})

// ---------------------------------------------------------------------------
// P4 — pinned photo fallback
// ---------------------------------------------------------------------------

describe('round 1 · P4 a pinned photo that cannot be cut out falls back to the other hero photos', () => {
  const offer = {
    name: 'Kit',
    productImageUrls: [],
    productPhotos: [
      { url: 'https://x.test/hero-front.jpg', role: 'hero', id: '998e81fa-0000-4000-8000-000000000001', label: 'frente' },
      { url: 'https://x.test/hero-side.jpg', role: 'hero', id: '03840037-0000-4000-8000-000000000002', label: 'de lado' },
      { url: 'https://x.test/box.jpg', role: 'box', id: 'b0x' },
      { url: 'https://x.test/gamepad.png', role: 'part', id: 'p4rt' },
    ],
  } as unknown as OfferInput

  it('other heroes first (never box/contents), pinned parts kept, the failed pinned photo excluded', () => {
    const pinned = [{ url: 'https://x.test/hero-side.jpg', role: 'hero' as const, id: '03840037-0000-4000-8000-000000000002' }, { url: 'https://x.test/gamepad.png', role: 'part' as const }]
    const alt = pinnedPhotoFallback(offer, pinned)
    expect(alt.map((p) => p.url)).toEqual(['https://x.test/hero-front.jpg', 'https://x.test/gamepad.png'])
    expect(alt[0].id).toBe('998e81fa-0000-4000-8000-000000000001')
  })

  it('no other hero → no fallback (the ad fails with the real cut-out reason)', () => {
    const only = { ...offer, productPhotos: [offer.productPhotos![0], offer.productPhotos![2]] } as OfferInput
    expect(pinnedPhotoFallback(only, [{ url: 'https://x.test/hero-front.jpg', role: 'hero' }])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// P5 — copy facts
// ---------------------------------------------------------------------------

const PROTOTIPO_CLAIMS = [
  'Si se gasta el papel, doblás otro avión',
  'Control 2.4GHz con vuelo asistido',
  'Chasis con 2 motores y hélices',
  'Recomendado desde los 8 años, con supervisión de un adulto',
  'WhatsApp 7113-3720',
]

describe('round 1 · P5 lossy claims and article-less headlines', () => {
  it('"Redoblás si se gasta" squeezes a confirmed claim and drops its object; noun chips and the verbatim claim pass', () => {
    const hit = findLossyClaim('Redoblás si se gasta', PROTOTIPO_CLAIMS)
    expect(hit?.claim).toBe('Si se gasta el papel, doblás otro avión')
    expect(hit?.dropped).toEqual(expect.arrayContaining(['papel', 'avion']))
    for (const ok of ['Si se gasta el papel, doblás otro avión', 'Control 2.4GHz', 'Chasis con 2 motores', 'Volás cuando querés']) expect(findLossyClaim(ok, PROTOTIPO_CLAIMS), ok).toBeNull()
  })

  it('"Regalo que armás con papel" needs its article; "Un regalo…", plurals and verbs pass', () => {
    expect(findBareNounHeadline('Regalo que armás con papel')?.fix).toMatch(/Un regalo que/)
    expect(findBareNounHeadline('Avioneta que volás vos')?.fix).toMatch(/Una avioneta que/)
    for (const ok of ['Un regalo que armás con papel', 'Aviones que vuelan', 'Doblás que volás', 'Algo que armás']) expect(findBareNounHeadline(ok), ok).toBeNull()
  })

  it('checkAdCopy: the lossy bullet is a blocking ambiguous_claim; the bare-noun headline is a repairable grammar note', () => {
    const c = caseById('beauty-serum')
    const dna = { ...c.dna, language: 'es', facts: [...c.dna.facts, ...PROTOTIPO_CLAIMS.map((v) => fact('custom:allowed_claim', v))] } as BrandDna
    const offer = { ...c.offer } as OfferInput
    const angle = { ...planAngles({ dna, offer, size: 3, language: 'es' })[0], format: 'offer_graphic' } as AdAngle
    const copy: AdCopy = { headline: 'Regalo que armás con papel', bullets: ['Redoblás si se gasta'], cta: 'Escribinos', caption: 'Un avión de papel que vuela de verdad, para armar en familia.', sceneBrief: 'Table.', usedFactKeys: [] }
    const check = checkAdCopy(copy, { dna, offer, angle, language: 'es' })
    const amb = check.issues.find((i) => i.code === 'ambiguous_claim')
    expect(amb?.path).toBe('bullets[0]')
    expect(BLOCKING_COPY_CODES.has('ambiguous_claim')).toBe(true)
    expect(check.issues.some((i) => i.code === 'grammar' && i.field === 'headline' && /Un regalo/.test(i.detail))).toBe(true)
  })
})

describe('round 1 · P5 required facts: contact from a confirmed WhatsApp claim, not-included chip on the offer graphic', () => {
  it('no contact_cta saved: the WhatsApp claim becomes the contact fact (one line), else the owner CTA', () => {
    const items = mustAppearItems([fact('price', '₡14.900'), fact('custom:age', 'Edad 8+'), fact('custom:allowed_claim', 'WhatsApp 7113-3720'), fact('custom:cta', 'Escribinos por DM')], ['price', 'age', 'contact'])
    expect(items.map((i) => `${i.group}:${i.fact.value}`)).toEqual(['price:₡14.900', 'age:Edad 8+', 'contact:WhatsApp 7113-3720'])
    expect(contactFallbackFact([fact('custom:cta', 'Escribinos por DM')])?.value).toBe('Escribinos por DM')
    const composed = mustAppearItems([fact('custom:contact_cta', 'Escribinos al WhatsApp 7113-3720'), fact('custom:whatsapp', 'WhatsApp 7113-3720')], ['contact'])
    expect(composed.map((i) => i.fact.value)).toEqual(['Escribinos al WhatsApp 7113-3720'])
  })

  it('offer_graphic gets "No incluye papel ni pilas" from the confirmed not-included facts (replacing the last chip when full)', () => {
    expect(notIncludedHead('Papel no incluido (hoja A4 o carta)')).toBe('papel')
    expect(notIncludedHead('3 pilas AA para el control no incluidas')).toBe('pilas')
    const c = caseById('beauty-serum')
    const dna = { ...c.dna, language: 'es' } as BrandDna
    const offer = { ...c.offer, facts: [...(c.offer.facts ?? []), fact('price', '₡14.900'), fact('custom:not_included', 'Papel no incluido (hoja A4 o carta)'), fact('custom:not_included', '3 pilas AA para el control no incluidas')], mustAppear: ['price', 'not_included'] } as OfferInput
    const angle = { ...planAngles({ dna, offer, size: 3, language: 'es' })[0], format: 'offer_graphic' } as AdAngle
    const ctx = buildCopyContext(dna, offer, angle, 'es')
    const copy = ensureNotIncludedChip({ headline: 'Un regalo que armás', bullets: ['Chasis ya armado', 'Control asistido', 'Guía paso a paso'], cta: 'Escribinos', caption: 'x', sceneBrief: 'x', usedFactKeys: [] }, ctx)
    expect(copy.bullets).toEqual(['Chasis ya armado', 'Control asistido', 'No incluye papel ni pilas'])
    // Not on other formats, and not twice.
    expect(ensureNotIncludedChip({ ...copy }, ctx).bullets).toEqual(copy.bullets)
    const ugc = buildCopyContext(dna, offer, { ...angle, format: 'ugc_person' }, 'es')
    expect(ensureNotIncludedChip({ headline: 'h', bullets: ['a'], cta: 'c', caption: 'x', sceneBrief: 'x', usedFactKeys: [] }, ugc).bullets).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// P6 — price badge
// ---------------------------------------------------------------------------

describe('round 1 · P6 price badge: labelled first price, never a line ending in "·"', () => {
  const facts = [fact('price', '₡14.900'), fact('bundle', '2 kits por ₡29.800'), fact('shipping', 'Envío gratis llevando 2 kits o más')]

  it('labels the single price with the bundle unit and keeps the shipping rule verbatim', () => {
    expect(labelledUnitPrice('₡14.900', '2 kits por ₡29.800')).toBe('1 kit ₡14.900')
    expect(labelledUnitPrice('₡9.900', '3 unidades por ₡25.000')).toBe('1 unidad ₡9.900')
    expect(labelledUnitPrice('₡14.900', undefined)).toBe('₡14.900')
    expect(labelledUnitPrice('Kit ₡14.900', '2 kits por ₡29.800')).toBe('Kit ₡14.900')
    expect(buildOfferLine(facts, 'es', { mustAppear: ['price', 'bundle', 'shipping'] })).toBe('1 kit ₡14.900 · 2 kits ₡29.800 · Envío gratis llevando 2 kits o más')
    expect(buildOfferLine([facts[0]], 'es')).toBe('₡14.900')
  })

  it('wrapTokens glues a lone separator to the next word; fitted lines never end with "·"', () => {
    expect(wrapTokens('₡14.900 · 2 kits por ₡29.800')).toEqual(['₡14.900', '· 2', 'kits', 'por', '₡29.800'])
    expect(wrapTokens('a · b').join(' ')).toBe('a · b')
    const font = { family: 'Poppins' as const, weight: 800 }
    for (const width of [120, 150, 180, 220, 260, 320]) {
      const fitted = fitText({ text: '1 kit ₡14.900 · 2 kits ₡29.800 · Envío gratis llevando 2 kits o más', font, maxWidth: width, maxLines: 6, maxSize: 40, minSize: 14, lineHeight: 1.1 })
      for (const line of fitted.lines) expect(line.trim().endsWith('·'), `${width}: ${JSON.stringify(fitted.lines)}`).toBe(false)
      expect(fitted.lines.join(' ')).toBe(fitted.text)
    }
  })
})

describe('round 1 · P6 badge_corner price sticker', () => {
  it('prices break at their separators inside the circle; the shipping rule rides in a ribbon below', async () => {
    const res = await renderAd({
      format: 'offer_graphic',
      ratio: '4:5',
      layoutFamily: 'badge_corner',
      sceneImage: await plain(1080, 1350, '#15263e'),
      copy: { headline: 'Un regalo que armás con papel', bullets: ['Chasis ya armado', 'No incluye papel ni pilas'], offerLine: '1 kit ₡14.900 · 2 kits ₡29.800 · Envío gratis llevando 2 kits o más', cta: 'Escribinos' },
      visual: { primaryColor: '#15263e', accentColor: '#2bb3a3' },
      language: 'es',
    })
    const offers = res.layoutReport.elements.filter((e) => e.role === 'offer')
    const offer = offers[0]
    expect(offer).toBeTruthy()
    for (const line of offer.lines) expect(line.trim().endsWith('·'), JSON.stringify(offer.lines)).toBe(false)
    expect(offer.lines[0]).toBe('1 kit ₡14.900')
    expect(offer.lines.join(' ')).not.toMatch(/Envío/)
    const ribbon = offers.find((e) => /Envío gratis/.test(e.text))
    expect(ribbon?.text).toBe('Envío gratis llevando 2 kits o más')
    expect(ribbon!.fontSize).toBeGreaterThanOrEqual(16)
    expect(offers.map((e) => e.text).join(' · ')).toBe('1 kit ₡14.900 · 2 kits ₡29.800 · Envío gratis llevando 2 kits o más')
  })
})

// ---------------------------------------------------------------------------
// P7 — status / reporting + platform claims
// ---------------------------------------------------------------------------

describe('round 1 · P7 status and reporting', () => {
  const item = (patch: Partial<PackItem>): PackItem => ({ id: 'i', packId: 'p', index: 0, status: 'copy_ready', angle: {} as AdAngle, renders: [], attempts: 0, generationId: 'g', updatedAt: '2026-10-08T00:00:00.000Z', ...patch }) as PackItem

  it('the ETA of an item waiting at copy_ready shrinks with the time already spent in the step', () => {
    const t0 = Date.parse('2026-10-08T00:00:00.000Z')
    const fresh = estimateRemainingSeconds([item({})], t0)
    const later = estimateRemainingSeconds([item({})], t0 + 15_000)
    const muchLater = estimateRemainingSeconds([item({})], t0 + 120_000)
    expect(fresh).toBe(35)
    expect(later).toBeLessThan(fresh)
    expect(muchLater).toBeLessThanOrEqual(later)
    expect(muchLater).toBeGreaterThanOrEqual(5)
  })

  it('a planned / running pack is never "completed" to the host', () => {
    expect(jobStatusForPack('planned')).toBe('running')
    expect(jobStatusForPack('running')).toBe('running')
    expect(jobStatusForPack('partial')).toBe('completed')
  })

  it('claimsPolicy exposes strictClaims and the verified-claims count', () => {
    expect(claimsPolicyOf({ facts: [{ key: 'custom:allowed_claim' }] })).toEqual({ strictClaims: false, verifiedClaims: 0 })
    expect(claimsPolicyOf({ strictClaims: true, facts: [{ key: 'custom:verified_claim' }, { key: 'custom:verified_claim' }] })).toEqual({ strictClaims: true, verifiedClaims: 2 })
  })
})

describe('round 1 · platform: banned health claims saved as confirmed facts are quarantined', () => {
  const sleepFacts = [
    fact('result_claim', 'Dormís más profundo y te despertás renovado sin efectos secundarios'),
    fact('how_it_works', 'Aplicás el parche antes de dormir para calmar la ansiedad'),
    fact('custom:allowed_claim', 'Un parche por noche'),
    fact('price', '₡19.900'),
  ]

  it('"sin efectos secundarios" and "calmar la ansiedad" block; the plain claim and the price stay confirmed', () => {
    expect(checkCompliance('para calmar la ansiedad', 'health_wellness', 'es').some((i) => i.severity === 'block')).toBe(true)
    const { facts, banned } = quarantineBannedFacts(sleepFacts, 'health_wellness', 'es')
    expect(banned.map((b) => b.ruleId).sort()).toEqual(['health_absolute_safety', 'health_disease_claim'])
    expect(facts.filter((f) => f.confirmed).map((f) => f.key)).toEqual(['custom:allowed_claim', 'price'])
  })

  it('the copy context never offers a banned fact to the writer', () => {
    const c = caseById('beauty-serum')
    const dna = { ...c.dna, language: 'es', category: 'health_wellness', facts: sleepFacts } as BrandDna
    const offer = { ...c.offer, facts: [] } as unknown as OfferInput
    const angle = planAngles({ dna, offer, size: 3, language: 'es' })[0]
    const ctx = buildCopyContext(dna, offer, angle, 'es')
    expect(ctx.idFacts.some((f) => /efectos secundarios|ansiedad/.test(f.value))).toBe(false)
    expect(ctx.unconfirmed.some((f) => /efectos secundarios/.test(f.value))).toBe(true)
  })
})

void vi
