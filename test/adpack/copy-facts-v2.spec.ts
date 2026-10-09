/**
 * Owner real-test feedback v2 (copy): fact citation + normalized claim matching (P0 #2a), free repair
 * rounds (P0 #2b), detailed issues (P0 #2c), the free copy preview reused by start (P0 #2d),
 * mustAppear facts (P0 #5), angle diversity (P1 #10), es-CR quality (P1 #11) and offer contact /
 * payment / age fields (P3 #21). Fakes only: no network, no live model calls. Fixtures are fictional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../../api/lib/usage-logger'
import { applyCitations, factIdList, matchClaim, mustAppearItems } from '../../api/lib/adpack/claims'
import { checkAdCopy, findTelegraphicSpanish, findUrgency } from '../../api/lib/adpack/check-copy'
import { buildCopyPrompt } from '../../api/lib/adpack/copy'
import { buildCopyContext, normalizeModelCopy } from '../../api/lib/adpack/copy-shared'
import { alternateHook, EDIT_BLOCKING_COPY_CODES, writeAdCopy } from '../../api/lib/adpack/copy-stage'
import { buildOfferLine } from '../../api/lib/adpack/facts'
import { offerProfileFacts, parseOfferAdProfile } from '../../api/lib/adpack/offer-profile'
import { regenerateItem } from '../../api/lib/adpack/pack-runner'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import { buildDnaFromSavedBrand } from '../../api/lib/adpack/saved-brand'
import { isAdPackError } from '../../api/lib/adpack/service'
import type { AdAngle, AdCopy, BrandDna, DnaFact, OfferInput } from '../../api/lib/adpack/types'
import { setMcpExecuteScheduler } from '../../api/lib/mcp/execute-job'
import { handleMcpJsonRpc } from '../../api/lib/mcp/protocol'
import { createMcpWorld } from '../helpers/mcp-world'
import { USER_A, createDoorEnv, createMemoryMcpApprovalStore } from './door-harness'
import { fakeGateway } from './fake-gateway'
import { caseById } from './helpers'
import { BIZ_A, PROD_A, fakeLibrary } from './saved-brand-fakes'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

beforeEach(() => setMcpExecuteScheduler(() => {}))
afterEach(() => setMcpExecuteScheduler((work) => {
  void work().catch(() => {})
}))

const fact = (key: DnaFact['key'], value: string): DnaFact => ({ key, value, source: 'offer_form', confirmed: true })

/** Fictional paper-plane kit ("Taller Cometa"), strict claims bank on. */
const KIT_PROFILE = {
  price: { amount: 14900, currency: 'CRC' },
  bundles: [{ qty: 2, amount: 29800, currency: 'CRC', label: '2 kits' }],
  shipping: { text: 'Envío gratis llevando 2 kits o más', freeFromQty: 2 },
  includes: ['Control tipo gamepad, batería recargable y 2 hélices'],
  excludes: ['Papel no incluido', '3 baterías AA no incluidas'],
  verifiedClaims: [{ claim: 'El chasis viene armado', source: 'ficha del taller' }],
  ageRule: { min: 8, supervision: true },
  contact: { whatsapp: '7000-0000', url: 'taller-cometa.example' },
  paymentMethods: ['SINPE Móvil', 'tarjeta', 'efectivo'],
}

async function kitWorld(profile: Record<string, unknown> = KIT_PROFILE, brandProfile: Record<string, unknown> = { locale: 'es-CR', register: 'voseo' }) {
  const world = createMcpWorld()
  const product = world.db.products.find((p) => p.id === PROD_A)!
  product.name = 'Kit Avión RC de papel'
  product.ad_profile = profile
  world.db.kits[0].brand_profile = brandProfile
  const saved = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
  return { world, ...saved }
}

function angleFor(dna: BrandDna, offer: OfferInput, patch: Partial<AdAngle> = {}): AdAngle {
  return { ...planAngles({ dna, offer, size: 3, language: 'es' })[0], ...patch }
}

function baseCopy(ctxOfferLine: string | undefined, patch: Partial<AdCopy>): AdCopy {
  return {
    headline: 'Tu avión vuela de verdad',
    bullets: [],
    cta: 'Escribinos',
    caption: 'Un avión de papel que vuela de verdad, para tardes al aire libre con la familia.',
    sceneBrief: 'Wooden table by a window, warm light.',
    usedFactKeys: [],
    ...(ctxOfferLine ? { offerLine: ctxOfferLine } : {}),
    ...patch,
  }
}

// ---------------------------------------------------------------------------
// P3 #21 — offer fields
// ---------------------------------------------------------------------------

describe('offer fields: contact, payment methods, age rule, mustAppear (P3 #21)', () => {
  it('validates and turns them into confirmed facts with a register-aware contact CTA', () => {
    const { profile } = parseOfferAdProfile({
      contact: { whatsapp: '+506 7000 0000', url: 'https://www.taller-cometa.example/kits/', instagram: 'https://instagram.com/taller.cometa' },
      paymentMethods: ['SINPE Móvil', 'tarjeta', 'efectivo'],
      ageRule: { min: 8, supervision: true },
      mustAppear: ['price', 'shipping', 'age', 'contact'],
    })
    expect(profile.contact).toEqual({ whatsapp: '+506 7000 0000', url: 'https://www.taller-cometa.example/kits', instagram: '@taller.cometa' })
    const facts = offerProfileFacts(profile, 'es', 'voseo')
    const byKey = Object.fromEntries(facts.facts.map((f) => [f.key, f.value]))
    expect(byKey['custom:contact_cta']).toBe('Escribinos al WhatsApp +506 7000 0000')
    expect(byKey['custom:whatsapp']).toBe('WhatsApp +506 7000 0000')
    expect(byKey['custom:url']).toBe('taller-cometa.example/kits')
    expect(byKey['custom:instagram']).toBe('@taller.cometa')
    expect(byKey.payment_methods).toBe('Aceptamos SINPE Móvil, tarjeta y efectivo')
    expect(byKey['custom:age']).toBe('Desde 8 años, con supervisión de un adulto')
    expect(facts.mustAppear).toEqual(['price', 'shipping', 'age', 'contact'])
    expect(offerProfileFacts(profile, 'es', 'usted').facts.find((f) => f.key === 'custom:contact_cta')?.value).toBe('Escríbanos al WhatsApp +506 7000 0000')
    // Defaults when the owner did not choose; an explicit [] means "none".
    expect(offerProfileFacts(parseOfferAdProfile({ includes: ['Control'] }).profile, 'es').mustAppear).toEqual(['price', 'bundle', 'shipping', 'age', 'not_included', 'contact'])
    expect(parseOfferAdProfile({ mustAppear: [] }).profile.mustAppear).toEqual([])
  })

  it('rejects malformed phones, URLs, handles and mustAppear keys', () => {
    expect(() => parseOfferAdProfile({ contact: { whatsapp: 'llamame' } })).toThrow(/contact\.whatsapp/)
    expect(() => parseOfferAdProfile({ contact: { phone: '22 22 2' } })).toThrow(/7 to 15 digits/)
    expect(() => parseOfferAdProfile({ contact: { url: 'mi tienda' } })).toThrow(/contact\.url/)
    expect(() => parseOfferAdProfile({ contact: { url: 'ftp://taller.example' } })).toThrow(/http\(s\)/)
    expect(() => parseOfferAdProfile({ contact: { url: 'localhost' } })).toThrow(/real domain/)
    expect(() => parseOfferAdProfile({ contact: { instagram: 'no vale!' } })).toThrow(/Instagram handle/)
    expect(() => parseOfferAdProfile({ ageRule: { supervision: true } })).toThrow(/ageRule\.min/)
    expect(() => parseOfferAdProfile({ mustAppear: ['logo'] })).toThrow(/mustAppear/)
  })

  it('a saved offer closes the payment gap, carries mustAppear and the voseo CTA', async () => {
    const { dna, offer, gaps } = await kitWorld()
    expect(gaps).not.toContain('payment_methods')
    expect(offer.mustAppear).toEqual(['price', 'bundle', 'shipping', 'age', 'not_included', 'contact'])
    const confirmed = dna.facts.filter((f) => f.confirmed).map((f) => `${f.key}=${f.value}`)
    expect(confirmed).toEqual(expect.arrayContaining([
      'custom:contact_cta=Escribinos al WhatsApp 7000-0000',
      'custom:age=Desde 8 años, con supervisión de un adulto',
      'payment_methods=Aceptamos SINPE Móvil, tarjeta y efectivo',
    ]))
  })

  it('update_offer saves the new fields through MCP and the schema lists them', async () => {
    const world = createMcpWorld()
    const call = (name: string, args: Record<string, unknown>) => handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      user: { id: USER_A },
      db: world.mcpDb,
      offerStore: world.offerStore,
      brandKitStore: world.kitStore,
      rehost: null,
    })
    const rpc = await call('update_offer', { brandId: BIZ_A, offerId: PROD_A, contact: { whatsapp: '7000-0000' }, paymentMethods: ['SINPE Móvil'], ageRule: { min: 8, supervision: true }, mustAppear: ['price', 'contact'] })
    const res = JSON.parse((rpc.result as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>
    expect(res.status).toBe('updated')
    const offerView = res.offer as { confirmedFacts: Array<{ key: string; value: string }>; mustAppear: string[] }
    expect(offerView.mustAppear).toEqual(['price', 'contact'])
    expect(offerView.confirmedFacts).toEqual(expect.arrayContaining([{ key: 'custom:whatsapp', value: 'WhatsApp 7000-0000' }, { key: 'payment_methods', value: 'Aceptamos SINPE Móvil' }]))
    const bad = await call('update_offer', { brandId: BIZ_A, offerId: PROD_A, contact: { whatsapp: 'abc' } })
    expect((bad.result as { isError: boolean }).isError).toBe(true)
    const listed = await handleMcpJsonRpc({ body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, user: { id: USER_A }, db: world.mcpDb })
    const tools = (listed.result as { tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> }).tools
    for (const name of ['create_offer', 'update_offer']) {
      expect(Object.keys(tools.find((t) => t.name === name)!.inputSchema.properties!)).toEqual(expect.arrayContaining(['contact', 'paymentMethods', 'ageRule', 'mustAppear']))
    }
    for (const name of ['adpack_start', 'create_ads', 'adpack_preview']) {
      expect(Object.keys(tools.find((t) => t.name === name)!.inputSchema.properties!)).toContain('mustAppear')
    }
  })
})

// ---------------------------------------------------------------------------
// P0 #2a — fact citation + normalized matching
// ---------------------------------------------------------------------------

describe('fact citation instead of verbatim matching (P0 #2a)', () => {
  const facts = factIdList([fact('brand_name', 'Taller Cometa'), fact('price', '₡14.900'), fact('shipping', 'Envío gratis desde 2 kits'), fact('custom:age', 'Desde 8 años, con supervisión de un adulto')])

  it('gives the facts stable ids and replaces [[Fn]] markers with the canonical text', () => {
    expect(facts.map((f) => f.id)).toEqual(['F1', 'F2', 'F3'])
    const res = applyCitations('Llevá dos y [[F2]]. Cuesta [[F1]]. Para [[F3]].', 'caption', facts)
    expect(res.text).toBe('Llevá dos y envío gratis desde 2 kits. Cuesta ₡14.900. Para desde 8 años, con supervisión de un adulto.')
    expect(res.claims).toEqual([
      { field: 'caption', sentenceIndex: 0, factIds: ['F2'] },
      { field: 'caption', sentenceIndex: 1, factIds: ['F1'] },
      { field: 'caption', sentenceIndex: 2, factIds: ['F3'] },
    ])
    expect(res.keys).toEqual(['shipping', 'price', 'custom:age'])
    const unknown = applyCitations('Precio [[F9]].', 'caption', facts)
    expect(unknown.unknownIds).toEqual(['F9'])
    expect(unknown.text).toContain('[[F9]]')
  })

  it('matches paraphrases by numbers, units and claim markers; reports offending tokens and the nearest fact', () => {
    expect(matchClaim('Con dos kits el envío te sale gratis', facts).ok).toBe(true)
    const wrong = matchClaim('Envío gratis desde 3 kits', facts)
    expect(wrong.ok).toBe(false)
    expect(wrong.offendingTokens).toContain('3')
    expect(wrong.nearest?.key).toBe('shipping')
    const product = matchClaim('Gratis con dos kits', facts)
    expect(product.ok).toBe(false)
    expect(product.reason).toMatch(/SHIPPING/)
    expect(matchClaim('Desde 8 años con un adulto al lado', facts, { cited: ['F3'] }).ok).toBe(true)
    expect(matchClaim('Desde 6 años', facts).offendingTokens).toContain('6')
  })

  it('strict bank: paraphrased writer copy passes, untraceable sentences fail with field/sentence/tokens/nearest fact', async () => {
    const { dna, offer } = await kitWorld()
    const angle = angleFor(dna, offer)
    const ctx = buildCopyContext(dna, offer, angle, 'es')
    const ship = ctx.idFacts.find((f) => f.key === 'shipping')!
    const raw = {
      headline: 'Tu avión vuela de verdad',
      bullets: ['Chasis ya armado'],
      cta: 'Escribinos',
      caption: `Trae el control tipo gamepad y la batería recargable. Llevando 2 kits, [[${ship.id}]]. Papel no incluido. 3 baterías AA no incluidas. Desde 8 años, con supervisión de un adulto. Escribinos al WhatsApp 7000-0000.`,
      sceneBrief: 'Kid flying a paper plane in a park.',
    }
    const copy = normalizeModelCopy(raw, ctx, 'fallback')
    expect(copy.caption).toContain('Llevando 2 kits, envío gratis llevando 2 kits o más.')
    expect(copy.claims?.[0]).toMatchObject({ field: 'caption', factIds: [ship.id] })
    const ok = checkAdCopy(copy, { dna, offer, angle, language: 'es' })
    expect(ok.issues.filter((i) => i.detail.startsWith('untraceable_claim'))).toEqual([])

    const bad = checkAdCopy({ ...copy, caption: copy.caption.replace('Trae el control tipo gamepad y la batería recargable.', 'Viene con 4 hélices de repuesto y estuche.') }, { dna, offer, angle, language: 'es' })
    const issue = bad.issues.find((i) => i.detail.startsWith('untraceable_claim'))!
    expect(issue).toMatchObject({ code: 'unconfirmed_fact', field: 'caption', sentence: 'Viene con 4 hélices de repuesto y estuche.' })
    expect(issue.offendingTokens).toContain('4')
    expect(issue.nearestFactKey).toBe('custom:includes')
    expect(issue.nearestFact).toBe('Control tipo gamepad, batería recargable y 2 hélices')
  })
})

// ---------------------------------------------------------------------------
// P0 #2b / #2c — free repair rounds + detailed issues
// ---------------------------------------------------------------------------

describe('repair before failing (P0 #2b) with detailed issues (P0 #2c)', () => {
  it('runs up to two free repair rounds fed with sentence, offending tokens and nearest fact', async () => {
    const { dna, offer } = await kitWorld()
    const angle = angleFor(dna, offer)
    const ship = buildCopyContext(dna, offer, angle, 'es').idFacts.find((f) => f.key === 'shipping')!
    const badCaption = 'Un avión que vuela de verdad. Envío gratis desde 3 kits. Escribinos.'
    const goodCaption = `Un avión que vuela de verdad. Con dos kits, [[${ship.id}]]. Escribinos.`
    const gw = fakeGateway((_call, i) => ({
      headline: 'Tu avión vuela de verdad',
      bullets: [],
      cta: 'Escribinos',
      caption: i < 2 ? badCaption : goodCaption,
      sceneBrief: 'Park at dusk.',
    }))
    const res = await writeAdCopy({ gateway: gw, dna, offer, angle, language: 'es' })
    expect(res.ok).toBe(true)
    expect(res.repairRounds).toBe(2)
    expect(gw.calls).toHaveLength(3)
    expect(gw.calls[1].user).toContain('frase: "Envío gratis desde 3 kits."')
    expect(gw.calls[1].user).toContain(`hecho más cercano ${ship.id} (shipping)`)
    expect(gw.calls[2].user).toContain('RONDA 2')
    expect(res.costUsd).toBeCloseTo(0.003, 6)
  })

  it('fails after the rounds with the blocking issues, and the pack status explains each one', async () => {
    const world = createMcpWorld()
    const product = world.db.products.find((p) => p.id === PROD_A)!
    product.ad_profile = KIT_PROFILE
    const env = createDoorEnv({
      savedBrandDb: world.db,
      library: fakeLibrary(world.db),
      json: () => ({ headline: 'Tu avión vuela de verdad', bullets: [], cta: 'Escribinos', caption: 'Un avión que vuela de verdad. Envío gratis desde 3 kits. Escribinos.', sceneBrief: 'Park.' }),
    })
    const started = await env.service.startPack({ userId: USER_A, brandId: BIZ_A, offerId: PROD_A, size: 1, source: 'mcp' })
    await env.service.advance({ userId: USER_A, packId: started.packId })
    const status = await env.service.getStatus({ userId: USER_A, packId: started.packId })
    expect(status.status).toBe('failed')
    expect(env.gateway.jsonCalls).toHaveLength(3) // generate + 2 free repair rounds
    expect(env.charges).toHaveLength(0)
    const failure = status.failures![0]
    expect(failure.reason).toMatch(/datos confirmados/)
    expect(failure.issues![0]).toMatchObject({ field: 'caption', rule: 'unconfirmed_fact', sentence: 'Envío gratis desde 3 kits.', nearestFactKey: 'shipping' })
    expect(failure.issues![0].offendingTokens).toContain('3 kit')
  })
})

// ---------------------------------------------------------------------------
// P0 #5 — mustAppear
// ---------------------------------------------------------------------------

describe('mustAppear facts (P0 #5)', () => {
  const facts = [fact('price', '₡14.900'), fact('bundle', '2 kits por ₡29.800'), fact('shipping', 'Envío gratis llevando 2 kits o más')]

  it('the offer line keeps the free-shipping rule (two-line badge) instead of dropping it', () => {
    expect(buildOfferLine(facts, 'es')).toBe('₡14.900 · 2 kits por ₡29.800')
    expect(buildOfferLine(facts, 'es', { mustAppear: ['price', 'bundle', 'shipping'] })).toBe('₡14.900 · 2 kits por ₡29.800 · Envío gratis llevando 2 kits o más')
    const plain = [fact('price', '₡14.900'), fact('shipping', 'Envíos a todo el país por Correos de la zona'), fact('custom:free_shipping_rule', 'Envío gratis desde 2 unidades')]
    expect(buildOfferLine(plain, 'es', { mustAppear: ['price', 'shipping'] })).toBe('₡14.900 · Envío gratis desde 2 unidades')
  })

  it('appends missing required facts to the caption (contact CTA last) and the checker passes', async () => {
    const { dna, offer } = await kitWorld({ ...KIT_PROFILE, verifiedClaims: undefined })
    const angle = angleFor(dna, offer)
    const ctx = buildCopyContext(dna, offer, angle, 'es')
    expect(ctx.offerLine).toBe('₡14.900 · 2 kits por ₡29.800 · Envío gratis llevando 2 kits o más')
    const copy = normalizeModelCopy({ headline: 'Tu avión vuela de verdad', bullets: [], cta: 'Escribinos', caption: 'Un avión de papel que vuela de verdad. Escribinos y pedí el tuyo.', sceneBrief: 'Park.' }, ctx, 'fallback')
    // Complete caption (P1 #11): buying facts, not-included, age, then the confirmed contact CTA replaces the generic one.
    expect(copy.caption).toBe('Un avión de papel que vuela de verdad. ₡14.900 · 2 kits por ₡29.800 · Envío gratis llevando 2 kits o más. Papel no incluido. 3 baterías AA no incluidas. Desde 8 años, con supervisión de un adulto. Escribinos al WhatsApp 7000-0000.')
    const check = checkAdCopy(copy, { dna, offer, angle, language: 'es' })
    expect(check.issues.filter((i) => i.code === 'missing_fact')).toEqual([])
    expect(check.issues.filter((i) => i.code === 'duplicate_message')).toEqual([])
    expect(mustAppearItems(ctx.confirmed, offer.mustAppear).map((m) => m.group)).toEqual(expect.arrayContaining(['price', 'bundle', 'shipping', 'not_included', 'age', 'contact']))
    // A caption that already carries a fact (cited) does not get it twice.
    const cited = normalizeModelCopy({ headline: 'Tu avión vuela de verdad', bullets: [], cta: 'Escribinos', caption: `Llevá dos: [[${ctx.idFacts.find((f) => f.key === 'bundle')!.id}]].`, sceneBrief: 'Park.' }, ctx, 'fallback')
    expect(cited.caption.match(/2 kits por ₡29\.800/g)).toHaveLength(1)
  })

  it('an owner edit that drops a required fact is rejected with the missing fact', async () => {
    const { dna, offer } = await kitWorld({ ...KIT_PROFILE, verifiedClaims: undefined })
    const angle = angleFor(dna, offer)
    const ctx = buildCopyContext(dna, offer, angle, 'es')
    const check = checkAdCopy(baseCopy(ctx.offerLine, { caption: 'Un avión de papel que vuela de verdad. Escribinos al WhatsApp 7000-0000.' }), { dna, offer, angle, language: 'es', userEdit: true })
    const missing = check.issues.filter((i) => i.code === 'missing_fact')
    expect(missing.map((i) => i.nearestFact)).toEqual(expect.arrayContaining(['Papel no incluido', 'Desde 8 años, con supervisión de un adulto']))
    expect(EDIT_BLOCKING_COPY_CODES.has('missing_fact')).toBe(true)
  })

  it('a request override replaces the offer setting', async () => {
    const world = createMcpWorld()
    world.db.products.find((p) => p.id === PROD_A)!.ad_profile = { ...KIT_PROFILE, verifiedClaims: undefined }
    const env = createDoorEnv({ savedBrandDb: world.db, library: fakeLibrary(world.db) })
    const started = await env.service.startPack({ userId: USER_A, brandId: BIZ_A, offerId: PROD_A, size: 1, mustAppear: ['price'], source: 'web' })
    expect(env.store.packs.get(started.packId)!.offer.mustAppear).toEqual(['price'])
    await expect(env.service.startPack({ userId: USER_A, brandId: BIZ_A, offerId: PROD_A, size: 1, mustAppear: ['logo'], source: 'web' })).rejects.toThrow(/mustAppear/)
  })
})

// ---------------------------------------------------------------------------
// P0 #2d — preview → start
// ---------------------------------------------------------------------------

describe('free copy preview reused by start (P0 #2d)', () => {
  const env = () => {
    const world = createMcpWorld()
    return { world, ...createDoorEnv({ savedBrandDb: world.db, library: fakeLibrary(world.db) }) }
  }
  const args = { userId: USER_A, brandId: BIZ_A, offerId: PROD_A, size: 1, brief: 'Regreso a clases' }

  it('previews angle, layout, planned photo and copy with no images or credits; start delivers that exact copy', async () => {
    const e = env()
    const preview = await e.service.previewPack({ ...args, source: 'mcp' })
    expect(preview.chargedCredits).toBe(0)
    expect(e.gateway.sceneCalls).toHaveLength(0)
    expect(e.gateway.visionCalls).toHaveLength(0)
    const ad = preview.ads[0]
    expect(ad).toMatchObject({ index: 1, check: { ok: true } })
    expect(ad.angleId).toBeTruthy()
    expect(ad.rationale).toBeTruthy()
    expect(ad.layoutFamily).toBeTruthy()
    expect(ad.photo?.url).toBe('https://cdn.example/serum.jpg')
    expect(ad.caption).toBeTruthy()
    const copyCalls = e.gateway.jsonCalls.length

    const started = await e.service.startPack({ ...args, source: 'mcp' })
    expect(started.previewId).toBe(preview.previewId)
    expect(started.previewAds).toEqual([1])
    const item = [...e.store.items.values()].find((i) => i.packId === started.packId)!
    expect(item.status).toBe('copy_ready')
    expect(item.copy?.headline).toBe(ad.headline)
    expect(item.copy?.caption).toBe(ad.caption)
    await e.service.advance({ userId: USER_A, packId: started.packId })
    expect(e.gateway.jsonCalls.length).toBe(copyCalls) // no new copy written
    const status = await e.service.getStatus({ userId: USER_A, packId: started.packId })
    expect(status.items[0].copy?.caption).toBe(ad.caption)
  })

  it('a different request or changed offer facts never reuse the preview; an explicit stale previewId is PLAN_CHANGED', async () => {
    const e = env()
    const preview = await e.service.previewPack({ ...args, source: 'mcp' })
    const other = await e.service.startPack({ ...args, brief: 'Día del niño', source: 'mcp' })
    expect(other.previewId).toBeUndefined()
    const err = await e.service.startPack({ ...args, brief: 'Día del niño', previewId: preview.previewId, source: 'mcp' }).catch((x) => x)
    expect(isAdPackError(err) && err.code).toBe('PLAN_CHANGED')
    expect(err.details).toMatchObject({ reason: 'preview_changed', previewId: preview.previewId })
    e.world.db.products.find((p) => p.id === PROD_A)!.shipping_info = 'Envío gratis en todo el país'
    const stale = await e.service.startPack({ ...args, previewId: preview.previewId, source: 'mcp' }).catch((x) => x)
    expect(isAdPackError(stale) && stale.details?.reason).toBe('preview_changed')
    const missing = await e.service.startPack({ ...args, previewId: '00000000-0000-4000-8000-000000000999', source: 'mcp' }).catch((x) => x)
    expect(isAdPackError(missing) && missing.details?.reason).toBe('preview_not_found')
  })

  it('is rate-limited to 10 previews per hour per user', async () => {
    const e = env()
    for (let i = 0; i < 10; i++) await e.service.previewPack({ ...args, source: 'web' })
    const err = await e.service.previewPack({ ...args, source: 'web' }).catch((x) => x)
    expect(isAdPackError(err) && err.code).toBe('RATE_LIMITED')
    expect(err.status).toBe(429)
  })

  it('MCP: adpack_preview → create_ads with previewId through the approval; the approval is bound to the preview', async () => {
    const e = env()
    const approvalStore = createMemoryMcpApprovalStore()
    const call = async (name: string, a: Record<string, unknown>) => {
      const rpc = await handleMcpJsonRpc({
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: a } },
        user: { id: USER_A },
        db: e.world.mcpDb,
        approvalStore,
        adPackService: e.service,
        offerStore: e.world.offerStore,
        brandKitStore: e.world.kitStore,
        rehost: null,
      })
      const result = rpc.result as { content: Array<{ text: string }>; isError: boolean }
      return { isError: result.isError, payload: JSON.parse(result.content[0].text) as Record<string, unknown> }
    }
    const base = { brandId: BIZ_A, offerId: PROD_A, count: 1, brief: 'Regreso a clases' }
    const preview = await call('adpack_preview', base)
    expect(preview.isError).toBe(false)
    expect(preview.payload).toMatchObject({ status: 'preview', chargedCredits: 0, nextTool: 'create_ads' })
    const previewId = String(preview.payload.previewId)
    expect(String(preview.payload.instructionsForGrok)).toContain(previewId)

    const bogus = await call('create_ads', { ...base, previewId: '00000000-0000-4000-8000-000000000999' })
    expect(bogus.isError).toBe(true)

    const prompt = await call('create_ads', { ...base, previewId })
    expect(prompt.payload.status).toBe('approval_required')
    const approvalRequestId = String(prompt.payload.approvalRequestId)
    await call('confirm_execute', { approvalRequestId, action: 'approve' })
    // Another preview id on the approved retry is a different input: the approval does not match.
    const other = await call('create_ads', { ...base, previewId: '00000000-0000-4000-8000-000000000998', approvalRequestId })
    expect(other.isError).toBe(true)
    const started = await call('create_ads', { ...base, previewId, approvalRequestId })
    expect(started.isError).toBe(false)
    expect(started.payload).toMatchObject({ status: 'completed', previewId, previewAds: [1] })
  })

  it('MCP: the previewed copy going stale after the approval answers plan_changed and runs nothing', async () => {
    const e = env()
    const approvalStore = createMemoryMcpApprovalStore()
    const call = async (name: string, a: Record<string, unknown>) => {
      const rpc = await handleMcpJsonRpc({
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: a } },
        user: { id: USER_A },
        db: e.world.mcpDb,
        approvalStore,
        adPackService: e.service,
      })
      return JSON.parse((rpc.result as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>
    }
    const base = { brandId: BIZ_A, offerId: PROD_A, size: 1 }
    const preview = await call('adpack_preview', base)
    const prompt = await call('adpack_start', { ...base, previewId: preview.previewId })
    await call('confirm_execute', { approvalRequestId: prompt.approvalRequestId, action: 'approve' })
    e.world.db.products.find((p) => p.id === PROD_A)!.offer = '3 por ₡30.000'
    const res = await call('adpack_start', { ...base, previewId: preview.previewId, approvalRequestId: prompt.approvalRequestId })
    expect(res).toMatchObject({ status: 'plan_changed', code: 'PLAN_CHANGED', reason: 'preview_changed', chargedCredits: 0 })
    expect(e.store.packs.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// P1 #10 — angle diversity
// ---------------------------------------------------------------------------

describe('angle diversity (P1 #10)', () => {
  const serum = caseById('beauty-serum')

  it('a high-freedom pack uses distinct archetypes and categories; the next pack avoids the last angles', () => {
    const a = planAngles({ dna: serum.dna, offer: serum.offer, size: 2 })
    expect(new Set(a.map((x) => x.archetype)).size).toBe(2)
    expect(new Set(a.map((x) => x.category)).size).toBe(2)
    const b = planAngles({ dna: serum.dna, offer: serum.offer, size: 2, avoidAngleIds: a.map((x) => x.id) })
    expect(b).toHaveLength(2)
    expect(b.filter((x) => a.some((y) => y.id === x.id))).toEqual([])
    expect(b.filter((x) => a.some((y) => y.category === x.category))).toEqual([])
  })

  it('consecutive packs of the same offer get different angles (pack history)', async () => {
    const world = createMcpWorld()
    const env = createDoorEnv({ savedBrandDb: world.db, library: fakeLibrary(world.db) })
    const first = await env.service.startPack({ userId: USER_A, brandId: BIZ_A, offerId: PROD_A, size: 2, source: 'mcp' })
    const second = await env.service.startPack({ userId: USER_A, brandId: BIZ_A, offerId: PROD_A, size: 2, source: 'mcp' })
    const ids = (p: typeof first) => (p.angles ?? []).map((x) => x.angleId)
    expect(ids(second).filter((id) => ids(first).includes(id))).toEqual([])
    // An explicit selection is kept as is.
    const third = await env.service.startPack({ userId: USER_A, brandId: BIZ_A, offerId: PROD_A, angleIds: ids(first), source: 'mcp' })
    expect(ids(third)).toEqual(ids(first))
  })

  it('a rejected comparison hook is retried with another hook type, never comparison without a verified fact', async () => {
    const { dna, offer } = await kitWorld()
    const angle = angleFor(dna, offer, { id: 'detalle_tecnico-comparison-explainer', category: 'detalle_tecnico', hookType: 'comparison', archetype: 'desvalidar_alternativas', format: 'explainer' })
    expect(alternateHook(angle, dna, offer)).not.toBe('comparison')
    const gw = fakeGateway((call) => ({
      headline: call.user.includes('NUEVO INTENTO') ? 'Un avión que de verdad vuela' : 'No compres avión RC de plástico',
      bullets: ['Chasis ya armado', 'Hélices incluidas'],
      cta: 'Escribinos',
      caption: 'Un avión de papel que vuela de verdad. Escribinos al WhatsApp 7000-0000.',
      sceneBrief: 'Workbench.',
    }))
    const res = await writeAdCopy({ gateway: gw, dna, offer, angle, language: 'es' })
    expect(res.ok).toBe(true)
    expect(res.copy?.headline).toBe('Un avión que de verdad vuela')
    const retry = gw.calls.find((c) => c.user.includes('NUEVO INTENTO'))!
    expect(retry.user).toContain('"No compres avión RC de plástico"')
    expect(retry.user).not.toMatch(/Tipo de gancho: comparison/)
    expect(res.retryAngle?.retry?.hookType).toBeDefined()
    expect(res.retryAngle?.retry?.hookType).not.toBe('comparison')
    expect(gw.calls[0].user).toContain('COMPARACIÓN SIN DATO VERIFICADO')
  })

  it('regenerating a copy-rejected ad avoids the rejected headline and switches hook type', async () => {
    const world = createMcpWorld()
    const env = createDoorEnv({ savedBrandDb: world.db, library: fakeLibrary(world.db) })
    const started = await env.service.startPack({ userId: USER_A, brandId: BIZ_A, offerId: PROD_A, size: 1, source: 'mcp' })
    const item = [...env.store.items.values()].find((i) => i.packId === started.packId)!
    await env.store.updateItem(item.id, { status: 'failed', error: 'copy_check_failed: unconfirmed_fact(caption)', copy: { ...item.copy!, headline: 'Titular rechazado', bullets: [], cta: 'x', caption: 'x', sceneBrief: 'x', usedFactKeys: [] } })
    const res = await regenerateItem({ store: env.store, packId: started.packId, itemId: item.id, userId: USER_A, mode: 'copy' })
    expect(res.ok).toBe(true)
    const angle = res.ok ? res.item.angle : null
    expect(angle?.retry).toMatchObject({ attempt: 1, avoidHeadlines: ['Titular rechazado'] })
    expect(angle?.retry?.hookType).not.toBe(item.angle.hookType)
    const prompt = buildCopyPrompt({ dna: env.store.packs.get(started.packId)!.dna, offer: env.store.packs.get(started.packId)!.offer, angle: angle!, language: 'es' })
    expect(prompt.user).toContain('NO repitas estos titulares ni su estructura: "Titular rechazado"')
  })
})

// ---------------------------------------------------------------------------
// P1 #11 — es-CR copy quality
// ---------------------------------------------------------------------------

describe('es-CR copy quality (P1 #11)', () => {
  it('flags urgency unless the kit allows it, as a blocking (repairable) issue', async () => {
    expect(findUrgency('Pedilo ya, últimas unidades y solo hoy')).toEqual(['pedilo ya', 'ultimas unidades', 'solo hoy'])
    expect(findUrgency('¿Ya probaste armarlo? Escribinos y pedí el tuyo.')).toEqual([])
    const { dna, offer } = await kitWorld({ ...KIT_PROFILE, verifiedClaims: undefined })
    const angle = angleFor(dna, offer)
    const ctx = buildCopyContext(dna, offer, angle, 'es')
    const copy = normalizeModelCopy({ headline: 'Tu avión vuela de verdad', bullets: [], cta: 'Pedilo ya', caption: 'Un avión de papel que vuela de verdad.', sceneBrief: 'Park.' }, ctx, 'fallback')
    expect(checkAdCopy(copy, { dna, offer, angle, language: 'es' }).issues.filter((i) => i.code === 'urgency').map((i) => i.path ?? i.field)).toEqual(['cta'])
    expect(checkAdCopy(copy, { dna: { ...dna, allowUrgency: true }, offer, angle, language: 'es' }).issues.some((i) => i.code === 'urgency')).toBe(false)
  })

  it('flags telegraphic Spanish (dropped articles) as a repairable grammar issue', () => {
    expect(findTelegraphicSpanish('Regalá avión RC que vuela').map((g) => g.match)).toEqual(['Regalá avión'])
    expect(findTelegraphicSpanish('Regalá un avión RC que vuela')).toEqual([])
    expect(findTelegraphicSpanish('Desde 8 años con supervisión de adulto').map((g) => g.match)).toEqual(['de adulto'])
    expect(findTelegraphicSpanish('Escribinos y pedí el tuyo. Mirá esto. Está listo.')).toEqual([])
    expect(findTelegraphicSpanish('Regalá diversión y llevá baterías')).toEqual([])
  })

  it('states the es-CR style rules, the caption checklist and the urgency rule in the writer prompt', async () => {
    const { dna, offer } = await kitWorld()
    const angle = angleFor(dna, offer)
    const p = buildCopyPrompt({ dna, offer, angle, language: 'es' })
    expect(p.system).toContain('ESTILO ESPAÑOL (es-CR)')
    expect(p.system).toContain('Regalá un avión RC')
    expect(p.system).toContain('CERO presión ni urgencia')
    expect(p.system).toContain('Caption completo')
    expect(p.user).toMatch(/- F\d+ · shipping/)
    expect(p.user).toContain('CITAR HECHOS')
    expect(p.user).toContain('HECHOS OBLIGATORIOS')
    expect(buildCopyPrompt({ dna: { ...dna, allowUrgency: true }, offer, angle, language: 'es' }).system).not.toContain('CERO presión')
  })
})
