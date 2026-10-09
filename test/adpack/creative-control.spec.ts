/**
 * Creative control: layout-family rotation, variations (quote = ads × variations, shared copy),
 * creativeFreedom, rationale in status/deliverable, guide_bulk_angles → adpack_start.
 */
import { describe, expect, it } from 'vitest'
import { boardToAdpackAngles, parseAdpackAngleInputs } from '../../api/lib/adpack/guide-angles'
import { assignLayoutFamilies, maxPerFamily } from '../../api/lib/adpack/layout-plan'
import { parseAngleId } from '../../api/lib/adpack/angle-catalog'
import { findCliches } from '../../api/lib/adpack/cliches'
import { ALL_FAMILIES, FAMILY_SPECS } from '../../api/lib/adpack/render/families'
import { buildStatusExtras } from '../../api/lib/adpack/status-summary'
import type { AdFormat, PackItem } from '../../api/lib/adpack/types'
import { cachedAngleBoard, clearAngleBoardCache } from '../../api/lib/bulk/angle-cache'
import { normalizeAngle, plannerAngleBoard } from '../../api/lib/bulk/angle-orchestrator'
import { callMcp, createDoorEnv, createMemoryMcpApprovalStore, mcpStartApproved, PER_AD, serum, USER_A } from './door-harness'

const FORMATS: AdFormat[] = ['offer_graphic', 'before_after', 'how_to_steps', 'variant_card', 'ugc_person', 'handheld_overlay', 'explainer']

describe('layout family assignment', () => {
  it('rotates: ≤ 2 per family in a pack of 10, no repeat in a row, deterministic by seed', () => {
    for (const seed of ['a', 'b', 'c', 'brand|offer']) {
      const slots = Array.from({ length: 10 }, (_, i) => ({ format: FORMATS[i % FORMATS.length], angleId: `x${i}` }))
      const fams = assignLayoutFamilies({ slots, seed })
      expect(assignLayoutFamilies({ slots, seed })).toEqual(fams)
      const counts = new Map<string, number>()
      for (const f of fams) counts.set(f, (counts.get(f) ?? 0) + 1)
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)
      expect(counts.size).toBeGreaterThanOrEqual(5)
      for (let i = 1; i < fams.length; i++) expect(fams[i]).not.toBe(fams[i - 1])
      // Format compatibility first.
      fams.forEach((f, i) => expect(FAMILY_SPECS[f].formats, `${f} for ${slots[i].format}`).toContain(slots[i].format))
    }
    expect(maxPerFamily(10)).toBe(2)
    expect(maxPerFamily(20)).toBe(4)
  })

  it('variations of one angle never share a family; a style profile is followed', () => {
    const slots = ['a', 'a', 'a', 'b', 'b', 'b'].map((angleId) => ({ format: 'offer_graphic' as AdFormat, angleId }))
    const fams = assignLayoutFamilies({ slots, seed: 1 })
    expect(new Set(fams.slice(0, 3)).size).toBe(3)
    expect(new Set(fams.slice(3)).size).toBe(3)
    const styled = assignLayoutFamilies({ slots: slots.map((s, i) => ({ ...s, angleId: `z${i}` })), profile: { families: ['editorial_minimal', 'framed_card'] } })
    expect(new Set(styled)).toEqual(new Set(['editorial_minimal', 'framed_card']))
    const forced = assignLayoutFamilies({ slots: [{ format: 'explainer', angleId: 'q' }, { format: 'explainer', angleId: 'q' }], family: 'split_panel' })
    expect(forced[0]).toBe('split_panel')
    expect(forced[1]).not.toBe('split_panel')
  })
})

describe('startPack: families, rationale, creativeFreedom, variations', () => {
  it('a free pack of 10 rotates families and reports angle + rationale per ad (status + deliverable)', async () => {
    const env = createDoorEnv()
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: serum.offer, size: 10 })
    expect(res.creativeFreedom).toBe('high')
    expect(res.angles).toHaveLength(10)
    const fams = res.angles!.map((a) => a.layoutFamily!)
    expect(new Set(fams).size).toBeGreaterThanOrEqual(5)
    for (const f of ALL_FAMILIES) expect(fams.filter((x) => x === f).length).toBeLessThanOrEqual(2)
    for (const a of res.angles!) {
      expect(parseAngleId(a.angleId)).not.toBeNull()
      expect(a.rationale).toBeTruthy()
    }
    await env.service.advance({ userId: 'u1', packId: res.packId, budgetMs: 30_000 })
    const status = await env.service.getStatus({ userId: 'u1', packId: res.packId })
    for (const it of status.items) expect(it).toMatchObject({ angleId: expect.any(String), category: expect.any(String), rationale: expect.any(String), layoutFamily: expect.any(String) })
    expect(status.deliverable!.ads.every((a) => a.angleId && a.category && a.hookType && a.rationale && a.layoutFamily)).toBe(true)
    // The renderer receives each ad's layout family.
    const rendered = new Set(env.renderer.calls.map((c) => c.layoutFamily))
    expect(rendered.size).toBeGreaterThanOrEqual(5)
  })

  it('variations: quote = ads × variations, one copy per angle, different families per variation', async () => {
    const env = createDoorEnv()
    const quote = await env.service.quote({ userId: 'u1', dna: serum.dna, offer: serum.offer, size: 3, variations: 3 })
    expect(quote).toMatchObject({ size: 9, credits: 9 * PER_AD, variations: 3, angles: 3 })
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: serum.offer, size: 3, variations: 3, expectedAds: quote.size })
    expect(res.quote).toEqual(quote)
    await env.service.advance({ userId: 'u1', packId: res.packId, budgetMs: 30_000 })
    let status = await env.service.getStatus({ userId: 'u1', packId: res.packId })
    for (let i = 0; i < 3 && status.moreWork; i++) {
      await env.service.advance({ userId: 'u1', packId: res.packId, budgetMs: 30_000 })
      status = await env.service.getStatus({ userId: 'u1', packId: res.packId })
    }
    expect(status.status).toBe('done')
    expect(status.items).toHaveLength(9)
    const copyCalls = env.gateway.jsonCalls.filter((c) => !c.system.includes('Corrige SOLO'))
    expect(copyCalls).toHaveLength(3)
    const byAngle = new Map<string, typeof status.items>()
    for (const it of status.items) byAngle.set(it.angleId!, [...(byAngle.get(it.angleId!) ?? []), it])
    expect(byAngle.size).toBe(3)
    for (const group of byAngle.values()) {
      expect(group.map((g) => g.variation).sort()).toEqual([0, 1, 2])
      expect(new Set(group.map((g) => g.copy!.headline)).size).toBe(1)
      expect(new Set(group.map((g) => g.layoutFamily)).size).toBe(3)
    }
    expect(env.charges).toHaveLength(9)
  })

  it('never silently degrades: bad variations, an over-size pack and an approval mismatch are errors', async () => {
    const env = createDoorEnv()
    await expect(env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: serum.offer, size: 2, variations: 4 })).rejects.toMatchObject({ code: 'BAD_INPUT' })
    await expect(env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: serum.offer, size: 10, variations: 3 })).rejects.toMatchObject({ code: 'BAD_INPUT' })
    // The approval no longer matches the plan (2 ads approved, 2 × 2 planned): PLAN_CHANGED, nothing created.
    await expect(env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: serum.offer, size: 2, variations: 2, expectedAds: 2 })).rejects.toMatchObject({ code: 'PLAN_CHANGED', details: { approvedAds: 2, plannedAds: 4 } })
    expect(env.store.packs.size).toBe(0)
  })

  it('angleIds may be any honest catalog id; unusable ids are listed, not dropped', async () => {
    const env = createDoorEnv()
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: serum.offer, angleIds: ['regalo-desire-handheld_overlay', 'como_funciona-routine-how_to_steps'] })
    expect(res.creativeFreedom).toBe('guided')
    expect(res.angles!.map((a) => a.angleId)).toEqual(['regalo-desire-handheld_overlay', 'como_funciona-routine-how_to_steps'])
    const noProof = { ...serum.dna, facts: serum.dna.facts.filter((f) => !['proof_review', 'proof_number', 'certification'].includes(f.key)) }
    const offer = { ...serum.offer, facts: serum.offer.facts.filter((f) => !['proof_review', 'proof_number', 'certification'].includes(f.key)) }
    await expect(env.service.startPack({ userId: 'u1', source: 'web', dna: noProof, offer, angleIds: ['regalo-desire-handheld_overlay', 'prueba_social-social_proof-ugc_person'] })).rejects.toMatchObject({
      code: 'BAD_INPUT',
      details: { rejectedAngles: [{ id: 'prueba_social-social_proof-ugc_person' }] },
    })
  })
})

describe('guide_bulk_angles → adpack_start (one angle system)', () => {
  const longHook = 'Si tenés poros que se notan en cada foto de cerca y ya probaste tres sérums sin ver cambios, este es el que se aplica de noche con dos gotas y no deja la piel pegajosa al día siguiente'

  it('keeps full hooks (no ~80 char truncation) and drops cliché hooks', () => {
    const item = normalizeAngle({ id: 'angle_1', title: 'Fotos de cerca', niche: 'creadoras', whyItBuys: 'las fotos delatan', hookStyle: 'closeup_proof', hook: longHook, frameworkHint: 'venta_directa' }, 0)
    expect(item.hook).toBe(longHook)
    expect(item.hook!.length).toBeGreaterThan(150)
    expect(normalizeAngle({ id: 'angle_2', title: 't', hook: 'Lo que pocos saben del sérum' }, 1).hook).toBeUndefined()
  })

  it('board items map to unique, parseable adpack angles that adpack_start accepts', async () => {
    const board = [
      normalizeAngle({ id: 'angle_1', title: 'Regalo para mamá', niche: 'hijas que regalan', whyItBuys: 'buscan un regalo útil', hookStyle: 'gift_moment', hook: longHook, frameworkHint: 'venta_directa' }, 0),
      normalizeAngle({ id: 'angle_2', title: 'Cómo se usa', niche: 'principiantes', whyItBuys: 'no saben usar sérum', hookStyle: 'tutorial', frameworkHint: 'educativo' }, 1),
      normalizeAngle({ id: 'angle_3', title: 'Reseñas reales', niche: 'escépticas', whyItBuys: 'confían en clientes', hookStyle: 'peer_check', frameworkHint: 'reconocimiento' }, 2),
      normalizeAngle({ id: 'angle_4', title: 'Regalo 2', niche: 'amigas', whyItBuys: 'regalo de cumple', hookStyle: 'gift', frameworkHint: 'venta_directa' }, 3),
    ]
    const adpack = boardToAdpackAngles(board, 'es')
    expect(adpack.map((a) => a.category)).toEqual(['regalo', 'como_funciona', 'uso_real', 'regalo'])
    expect(new Set(adpack.map((a) => `${a.hookType}|${a.format}`)).size).toBe(4)
    for (const a of adpack) expect(parseAngleId(a.id)).not.toBeNull()
    expect(adpack[0].hook).toBe(longHook)
    // Round-trip through JSON (agent copies the objects) and start the pack.
    const parsed = parseAdpackAngleInputs(JSON.parse(JSON.stringify(adpack)), 20)
    expect(parsed.ok).toBe(true)
    const env = createDoorEnv()
    const quote = await env.service.quote({ userId: 'u1', dna: serum.dna, offer: serum.offer, angles: adpack })
    expect(quote.size).toBe(4)
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna: serum.dna, offer: serum.offer, angles: adpack, expectedAds: 4 })
    expect(res.angles!.map((a) => a.angleId)).toEqual(adpack.map((a) => a.id))
    await env.service.advance({ userId: 'u1', packId: res.packId, budgetMs: 30_000 })
    // The full hook reaches the copy prompt untruncated.
    expect(env.gateway.jsonCalls.some((c) => c.user.includes(longHook))).toBe(true)
  })

  it('adapts a guide angle the facts cannot back instead of dropping it (count kept)', async () => {
    const env = createDoorEnv()
    const offer = { ...serum.offer, facts: serum.offer.facts.filter((f) => f.key !== 'price' && f.key !== 'bundle') }
    const dna = { ...serum.dna, facts: serum.dna.facts.filter((f) => f.key !== 'price' && f.key !== 'bundle') }
    const angles = [{ id: 'valor_precio-price_value-offer_graphic', message: 'Precio claro', target: 'compradoras' }]
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna, offer, angles })
    expect(res.quote.size).toBe(1)
    expect(res.angles![0].angleId).not.toMatch(/^valor_precio/)
    expect(res.angles![0].rationale).toMatch(/adaptado/)
  })

  it('angle board is cached by brand+offer+count+language and degrades to the planner when the model is slow', async () => {
    clearAngleBoardCache()
    let calls = 0
    const okFetch = (async () => {
      calls++
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ angles: [{ title: 'Regalo', niche: 'mamás', whyItBuys: 'regalo útil', hook: longHook, hookStyle: 'gift', category: 'regalo', frameworkHint: 'venta_directa' }] }) } }] }), { status: 200 })
    }) as typeof fetch
    const input = { brandName: 'Marca Ficticia', offerName: 'Sérum', count: 1, language: 'es' as const }
    const a = await cachedAngleBoard({ key: 'k1', input, deps: { apiKey: 'test-key', fetchFn: okFetch } })
    const b = await cachedAngleBoard({ key: 'k1', input, deps: { apiKey: 'test-key', fetchFn: okFetch } })
    expect(a.source).toBe('model')
    expect(b.cached).toBe(true)
    expect(calls).toBe(1)
    expect(b.angles[0].hook).toBe(longHook)

    // Slow model: planner board at once, the late model board fills the cache.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slowFetch = (async () => {
      await gate
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ angles: [{ title: 'Tarde', niche: 'n', whyItBuys: 'w', hookStyle: 'h', frameworkHint: 'f' }] }) } }] }), { status: 200 })
    }) as typeof fetch
    const t0 = Date.now()
    const fast = await cachedAngleBoard({ key: 'k2', input: { ...input, count: 3 }, deps: { apiKey: 'test-key', fetchFn: slowFetch, budgetMs: 50 } })
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(fast).toMatchObject({ source: 'planner', refining: true })
    expect(fast.angles).toHaveLength(3)
    expect(fast.angles[0].category).toBe('regalo')
    for (const x of fast.angles) expect(findCliches(`${x.title} ${x.hook}`)).toEqual([])
    release()
    await new Promise((r) => setTimeout(r, 20))
    const later = await cachedAngleBoard({ key: 'k2', input: { ...input, count: 3 }, deps: { apiKey: 'test-key', fetchFn: slowFetch, budgetMs: 50 } })
    expect(later.cached).toBe(true)
    expect(later.source).toBe('model')
  })

  it('the deterministic planner board covers distinct catalog categories', () => {
    const board = plannerAngleBoard({ brandName: 'Marca', offerName: 'Avión RC', audience: 'papás con hijos de 8+', count: 6, language: 'es' }, 6)
    expect(new Set(board.map((b) => b.category)).size).toBe(6)
    expect(board[0].hook).toMatch(/regalar/)
  })
})

describe('status summary carries the angle (H1)', () => {
  it('deliverable ads include angleId, category, hookType, rationale and layoutFamily', () => {
    const item = {
      id: 'i1',
      packId: 'p',
      index: 0,
      status: 'done',
      angle: { id: 'regalo-desire-handheld_overlay', archetype: 'venta_directa', hookType: 'desire', format: 'handheld_overlay', message: 'm', target: 't', factKeys: [], category: 'regalo', rationale: 'Regalo: abre la compra a quien regala', layoutFamily: 'framed_card' },
      copy: { headline: 'H', caption: 'C', bullets: [], cta: 'x', sceneBrief: 's', usedFactKeys: [] },
      renders: [{ ratio: '4:5', imageUrl: 'https://x/4x5.png', width: 1080, height: 1350 }],
      attempts: 0,
      generationId: 'g',
      updatedAt: '',
    } as unknown as PackItem
    const extras = buildStatusExtras({ packId: 'p', status: 'done', items: [item], moreWork: false, language: 'es' })
    expect(extras.deliverable!.ads[0]).toMatchObject({ angleId: 'regalo-desire-handheld_overlay', category: 'regalo', hookType: 'desire', rationale: 'Regalo: abre la compra a quien regala', layoutFamily: 'framed_card' })
  })
})

describe('MCP door', () => {
  it('adpack_start approval states ads × variations, and status rows carry angle + why', async () => {
    const env = { ...createDoorEnv(), approvalStore: createMemoryMcpApprovalStore() }
    const args = { dna: serum.dna, offer: serum.offer, size: 2, variations: 2 }
    const { prompt, started } = await mcpStartApproved(env, USER_A, args)
    expect(String(prompt.payload.userPrompt)).toContain('4 anuncios')
    expect(String(prompt.payload.userPrompt)).toContain('2 ángulos × 2 variaciones')
    expect(prompt.payload.quotedCreditCost).toBe(4 * PER_AD)
    expect(started.isError).toBe(false)
    expect(started.payload.quotedCreditCost).toBe(4 * PER_AD)
    expect((started.payload.plan as unknown[]).length).toBe(4)
    const status = await callMcp(env, USER_A, 'adpack_status', { packId: started.payload.packId })
    const rows = (status.payload.items ?? (status.payload.deliverable as { ads: unknown[] }).ads) as Array<Record<string, unknown>>
    for (const r of rows) {
      expect(r.angleId).toBeTruthy()
      expect(r.category).toBeTruthy()
      expect(r.rationale).toBeTruthy()
      expect(r.layoutFamily).toBeTruthy()
    }
  })
})
