/**
 * WS3 (creative system) × WS1 (exact fidelity) × WS2/WS4 — the unifications of the merge:
 * 2. one angle resolver: quote = ads × variations (relight free), catalog + legacy + planner ids,
 *    unknown ids → BAD_INPUT rejectedAngles before approval, start recomputes → PLAN_CHANGED;
 * 3. status/deliverable = WS4 fields + WS1 fidelity + WS3 angle/rationale/layoutFamily per ad;
 * 4. check-copy: WS2/WS4 rules + WS3 cliché blocklist in one issue shape;
 * 5. brand fonts resolved once and used by every family (generated mode too);
 * 6. adpack_resize keeps the item's layout family (and the brand visual → fonts);
 * 7. create_ads forwards the WS3 creative controls to adpack_start.
 */
import { describe, expect, it } from 'vitest'
import { checkAdCopy } from '../../api/lib/adpack/check-copy'
import { angleId } from '../../api/lib/adpack/angle-catalog'
import { planPack, quotePack, sceneProductBox } from '../../api/lib/adpack/pack-runner'
import { AnglePlanError, planAngles, resolvePackAngles } from '../../api/lib/adpack/plan-angles'
import { ALL_FAMILIES, renderAd } from '../../api/lib/adpack/render/index'
import { PACK_PASSTHROUGH, routeCreateAds } from '../../api/lib/mcp/create-ads'
import { callMcp, createDoorEnv, createMemoryMcpApprovalStore, PER_AD, serum, USER_A } from './door-harness'
import { goodSerumCopy } from './helpers'
import { makeLogoSvg, makeScene, SAMPLE_COPY } from './render-fixtures'

/** Serum offer with a product photo → exact mode by default (door env loads it synthetically). */
const exactOffer = { ...serum.offer, productImageUrls: ['https://cdn.test/hero.jpg'] }

describe('2 · one angle resolver (quote = approval = start)', () => {
  it('accepts planner, catalog and legacy ids in order; unusable ids are listed (never dropped)', () => {
    const board = planAngles({ dna: serum.dna, offer: serum.offer, size: 10 })
    const catalog = angleId('como_funciona', 'routine', 'how_to_steps')
    const legacy = 'a07-venta_directa-desire-handheld_overlay'
    const got = resolvePackAngles({ dna: serum.dna, offer: serum.offer, size: 2, angleIds: [board[6].id, catalog, legacy] })
    expect(got).toHaveLength(3)
    expect(got[0].id).toBe(board[6].id)
    expect(got[1].id).toBe(catalog)
    expect(got[2].format).toBe('handheld_overlay')
    try {
      resolvePackAngles({ dna: serum.dna, offer: serum.offer, size: 2, angleIds: [catalog, 'nope-x-y'] })
      throw new Error('expected AnglePlanError')
    } catch (err) {
      expect(err).toBeInstanceOf(AnglePlanError)
      expect((err as AnglePlanError).details).toMatchObject({ unknownAngleIds: ['nope-x-y'], rejectedAngles: [{ id: 'nope-x-y' }] })
    }
  })

  it('quote = ads × variations (relight included, free) and planPack runs exactly that', async () => {
    const env = createDoorEnv()
    const q = await env.service.quote({ userId: 'u1', dna: serum.dna, offer: exactOffer, size: 3, variations: 2, relight: 'ai', productFidelity: 'exact' })
    expect(q).toMatchObject({ size: 6, variations: 2, angles: 3, credits: quotePack(6).credits })
    expect(q.angleIds).toHaveLength(3)
    const planned = planPack({ dna: serum.dna, offer: exactOffer, size: 3, variations: 2, userId: 'u1', source: 'web', render: { productFidelity: 'exact', relight: 'ai' } })
    expect(planned.items).toHaveLength(6)
    expect(planned.pack.quotedCredits).toBe(q.credits)
  })

  it('unknown ids → BAD_INPUT rejectedAngles at quote time (before any approval)', async () => {
    const env = createDoorEnv()
    await expect(env.service.quote({ userId: 'u1', dna: serum.dna, offer: serum.offer, angleIds: ['zzz-unknown'] })).rejects.toMatchObject({
      code: 'BAD_INPUT',
      details: { reason: 'unknown_angle_ids', rejectedAngles: [{ id: 'zzz-unknown' }] },
    })
  })

  it('start recomputes the plan: any difference with the approval (variations) → PLAN_CHANGED, nothing created; relight never changes it', async () => {
    const env = createDoorEnv()
    const q = await env.service.quote({ userId: 'u1', dna: serum.dna, offer: exactOffer, size: 2, variations: 2 })
    await expect(env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: exactOffer, size: 2, variations: 3, approved: { items: q.size, total: q.credits } })).rejects.toMatchObject({ code: 'PLAN_CHANGED' })
    expect(env.store.packs.size).toBe(0)
    const ok = await env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: exactOffer, size: 2, variations: 2, approved: { items: q.size, total: q.credits } })
    expect(ok.quote).toMatchObject({ size: 4, credits: 4 * PER_AD, variations: 2 })
    // The same approval runs with relight 'ai' too: relighting is included, the price is identical.
    const relit = await env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: exactOffer, size: 2, variations: 2, relight: 'ai', productFidelity: 'exact', approved: { items: q.size, total: q.credits } })
    expect(relit.quote).toMatchObject({ size: 4, credits: 4 * PER_AD })
  })

  it('MCP: catalog angleIds × variations in the approval; unknown ids rejected before approval', async () => {
    const env = { ...createDoorEnv(), approvalStore: createMemoryMcpApprovalStore() }
    const bad = await callMcp(env, USER_A, 'adpack_start', { dna: serum.dna, offer: serum.offer, angleIds: ['zzz-unknown'] })
    expect(bad.payload.error).toMatchObject({ code: 'BAD_INPUT', rejectedAngles: [{ id: 'zzz-unknown' }] })
    const ids = [angleId('regalo', 'desire', 'handheld_overlay'), angleId('como_funciona', 'routine', 'how_to_steps')]
    const prompt = await callMcp(env, USER_A, 'adpack_start', { dna: serum.dna, offer: serum.offer, angleIds: ids, variations: 2 })
    expect(prompt.payload.approval).toMatchObject({ items: 4, total: 4 * PER_AD })
    expect(prompt.payload.quote).toMatchObject({ size: 4, variations: 2, angleIds: ids })
  })
})

describe('3 · status / deliverable: WS4 + WS1 fidelity + WS3 angle fields per ad', () => {
  it('every finished ad carries files, forbiddenHits, fidelity, angleId, category, rationale and layoutFamily', async () => {
    const env = createDoorEnv()
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: exactOffer, size: 3 })
    let status = await env.service.getStatus({ userId: 'u1', packId: res.packId })
    for (let i = 0; i < 4 && (status.moreWork || i === 0); i++) {
      await env.service.advance({ userId: 'u1', packId: res.packId, budgetMs: 30_000 })
      status = await env.service.getStatus({ userId: 'u1', packId: res.packId })
    }
    expect(status.status).toBe('done')
    for (const it of status.items) expect(it).toMatchObject({ angleId: expect.any(String), layoutFamily: expect.any(String), fidelity: { passed: true } })
    for (const ad of status.deliverable!.ads) {
      expect(ad).toMatchObject({ angleId: expect.any(String), hookType: expect.any(String), rationale: expect.any(String), layoutFamily: expect.any(String), forbiddenHits: [], fidelity: { passed: true } })
      expect(ad.files.length).toBeGreaterThan(0)
    }
    // Every render got the item's family (exact mode: no scene bbox is sent, the composite is the product box).
    for (const c of env.renderer.calls) {
      expect(c.layoutFamily).toBeDefined()
      if (c.productMode === 'exact') expect(c.productBox).toBeUndefined()
    }
  })

  it('generated mode: the vision bbox becomes the renderer productBox (fractions)', () => {
    expect(sceneProductBox({ sceneCheck: { ok: true, productMatches: true, strayText: false, score: 1, productBox: [100, 200, 500, 800] } })).toEqual({ x: 0.2, y: 0.1, w: 0.6, h: 0.4 })
    expect(sceneProductBox({ scene: { imageUrl: 'x', width: 1, height: 1, model: 'm', costUsd: 0, productBox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } })).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })
  })
})

describe('4 · check-copy: one issue shape for every rule set', () => {
  it('cliché (WS3), forbidden phrase (WS4) and locale register (WS4) all report path + token', () => {
    const dna = { ...serum.dna, locale: 'es-CR', register: 'voseo' as const, forbiddenPhrases: ['milagro'] }
    const copy = goodSerumCopy({ headline: 'Calidad que se nota en tu piel', subline: 'Tenés que probar el milagro de noche', cta: 'Compra ahora' })
    const res = checkAdCopy(copy, { dna, offer: serum.offer, angle: planAngles({ dna, offer: serum.offer, size: 1 })[0], language: 'es' })
    const codes = new Set(res.issues.map((i) => i.code))
    expect(codes.has('cliche')).toBe(true)
    expect(codes.has('forbidden_phrase')).toBe(true)
    for (const i of res.issues.filter((x) => x.code === 'cliche' || x.code === 'forbidden_phrase')) {
      expect(i.path ?? i.field, i.code).toBeTruthy()
      expect(i.token, i.code).toBeTruthy()
    }
  })
})

describe('5 · brand fonts on every family (WS3 resolver) + WS1 logo variants', () => {
  it('a kit font resolves once and every family draws its headline with it; every family picks a logo variant', async () => {
    const scene = await makeScene(1080, 1350, 'warm')
    for (const family of ALL_FAMILIES) {
      const r = await renderAd({ format: 'handheld_overlay', ratio: '4:5', sceneImage: scene, copy: SAMPLE_COPY, visual: { headingFont: 'Anton', bodyFont: 'Poppins' }, logo: makeLogoSvg(), language: 'es', layoutFamily: family, fonts: { fetch: null, cacheDir: null } })
      // Every text is drawn in a kit face (ugc_native writes its comment bubble in the body face by design).
      for (const e of r.layoutReport.elements) expect(['Anton', 'Poppins'], `${family} ${e.role}`).toContain(e.fontFamily)
      if (family !== 'ugc_native') expect(r.layoutReport.elements.find((e) => e.role === 'headline')!.fontFamily, family).toBe('Anton')
      expect(r.layoutReport.fonts.resolution?.heading.family, family).toBe('Anton')
      expect(r.layoutReport.logoVariant, family).toBeDefined()
    }
  }, 60_000)
})

describe('6 · adpack_resize keeps the layout family and brand visual', () => {
  it('new ratios are rendered with the item family, the same visual (fonts) and fidelity', async () => {
    const env = createDoorEnv()
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: exactOffer, size: 2, layoutFamily: 'framed_card' })
    let status = await env.service.getStatus({ userId: 'u1', packId: res.packId })
    for (let i = 0; i < 4 && (status.moreWork || i === 0); i++) {
      await env.service.advance({ userId: 'u1', packId: res.packId, budgetMs: 30_000 })
      status = await env.service.getStatus({ userId: 'u1', packId: res.packId })
    }
    const item = status.items[0]
    const before = env.renderer.calls.filter((c) => c.layoutFamily === item.layoutFamily)[0]
    const n = env.renderer.calls.length
    const out = await env.service.resize({ userId: 'u1', packId: res.packId, itemId: item.id, ratios: ['1:1', '16:9'] })
    expect(out.added).toEqual(['1:1', '16:9'])
    const fresh = env.renderer.calls.slice(n)
    expect(fresh).toHaveLength(2)
    for (const c of fresh) {
      expect(c.layoutFamily).toBe(item.layoutFamily)
      expect(c.visual).toEqual(before.visual)
    }
    expect(out.item.layoutFamily).toBe(item.layoutFamily)
  })
})

describe('7 · create_ads forwards the WS3 creative controls', () => {
  it('layoutFamily, styleDnaId, creativeFreedom, variations, angleIds and angles reach adpack_start unchanged', () => {
    for (const k of ['layoutFamily', 'styleDnaId', 'creativeFreedom', 'variations', 'angleIds', 'angles']) expect(PACK_PASSTHROUGH).toContain(k)
    const route = routeCreateAds({ brandId: 'b1', mode: 'pack', count: 3, layoutFamily: 'split_panel', styleDnaId: 'dna-1', creativeFreedom: 'guided', variations: 2, angleIds: ['regalo-desire-handheld_overlay'] })
    expect(route.tool).toBe('adpack_start')
    expect(route.args).toMatchObject({ brandId: 'b1', size: 3, layoutFamily: 'split_panel', styleDnaId: 'dna-1', creativeFreedom: 'guided', variations: 2, angleIds: ['regalo-desire-handheld_overlay'] })
  })
})
