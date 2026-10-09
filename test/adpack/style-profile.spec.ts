/** Style DNA (winners / references) → render profile: vision analysis (fake gateway), storage, mapping, adpack_start {styleDnaId}. */
import { describe, expect, it } from 'vitest'
import { buildCopyPrompt } from '../../api/lib/adpack/copy'
import { planAngles } from '../../api/lib/adpack/plan-angles'
import { analyzeStyleDna, referenceHash, resolveStyleProfile, styleProfileFromAnalysis } from '../../api/lib/adpack/style-profile'
import type { ModelGateway } from '../../api/lib/adpack/types'
import { normalizeStyleDna, parseStyleDnas } from '../../api/lib/bulk/style-dna'
import type { StyleDna, StyleDnaAnalysis } from '../../api/lib/bulk/types'
import { createDoorEnv, serum, USER_A } from './door-harness'
import { BIZ_A, fakeSavedBrandDb, PROD_A } from './saved-brand-fakes'

const EDITORIAL = { layoutPattern: 'editorial', hierarchy: 'headline_first', hookType: 'routine', density: 'minimal', colorUsage: 'neutral_photo', typeWeight: 'regular', ctaStyle: 'text', notes: 'mucho aire' }

function visionGateway(data: Record<string, unknown>) {
  const calls: Array<{ system: string; images: string[] }> = []
  const gw = {
    async json() {
      throw new Error('no json')
    },
    async visionJson<T>(input: { system: string; user: string; images: string[] }) {
      calls.push({ system: input.system, images: input.images })
      return { data: data as T, costUsd: 0.002, model: 'fake-vision' }
    },
    async scene() {
      throw new Error('no scene')
    },
  } as unknown as ModelGateway
  return { gw, calls }
}

const dna = (over: Partial<StyleDna> = {}): StyleDna => ({ id: 'dna_1', name: 'Ganadores', kind: 'ads', referenceUrls: ['https://cdn.example/win-1.jpg', 'https://cdn.example/win-2.jpg'], notes: '', ...over })

describe('style DNA analysis', () => {
  it('extracts the visual system with visionJson and maps it to families + density (quality floor)', async () => {
    const { gw, calls } = visionGateway(EDITORIAL)
    const { analysis, costUsd } = await analyzeStyleDna({ gateway: gw, styleDna: dna(), now: () => new Date('2026-10-08T00:00:00Z') })
    expect(calls[0].images).toEqual(['https://cdn.example/win-1.jpg', 'https://cdn.example/win-2.jpg'])
    expect(calls[0].system).toMatch(/never to copy/)
    expect(analysis).toMatchObject({ layoutPattern: 'editorial', density: 'minimal', hookType: 'routine', referenceCount: 2, referenceHash: referenceHash(dna().referenceUrls), analyzedAt: '2026-10-08T00:00:00.000Z' })
    expect(costUsd).toBe(0.002)
    expect(styleProfileFromAnalysis(analysis, { styleDnaId: 'dna_1' })).toEqual({ styleDnaId: 'dna_1', families: ['editorial_minimal', 'framed_card'], paletteEmphasis: 'neutral', typeWeight: 'regular', ctaStyle: 'text', copyDensity: 'minimal', hookType: 'routine', source: 'analysis' })
  })

  it('invalid model values fall back to safe enums', async () => {
    const { gw } = visionGateway({ layoutPattern: 'collage???', density: 'lots' })
    const { analysis } = await analyzeStyleDna({ gateway: gw, styleDna: dna() })
    expect(analysis.layoutPattern).toBe('pill_overlay')
    expect(analysis.density).toBe('standard')
  })

  it('stored analysis is reused while the references are unchanged; new references re-analyze', async () => {
    const { gw, calls } = visionGateway(EDITORIAL)
    const stored: StyleDnaAnalysis = { ...(EDITORIAL as unknown as StyleDnaAnalysis), layoutPattern: 'type_led', analyzedAt: 'x', model: 'm', referenceCount: 2, referenceHash: referenceHash(dna().referenceUrls) }
    const reused = await resolveStyleProfile({ styleDnas: [dna({ analysis: stored })], styleDnaId: 'dna_1', gateway: gw })
    expect(reused).toMatchObject({ analyzed: false, profile: { families: ['full_bleed_type', 'editorial_minimal'] } })
    expect(calls).toHaveLength(0)
    const changed = await resolveStyleProfile({ styleDnas: [dna({ analysis: stored, referenceUrls: ['https://cdn.example/new.jpg'] })], styleDnaId: 'dna_1', gateway: gw })
    expect(changed?.analyzed).toBe(true)
    expect(changed?.styleDna.analysis?.layoutPattern).toBe('editorial')
    expect(calls).toHaveLength(1)
    expect(await resolveStyleProfile({ styleDnas: [dna()], styleDnaId: 'nope' })).toBeNull()
  })

  it('without references / gateway the notes steer the profile; nothing → default', async () => {
    const r = await resolveStyleProfile({ styleDnas: [dna({ referenceUrls: [], notes: 'Estilo UGC nativo, historias casuales' })], styleDnaId: 'dna_1' })
    expect(r?.profile).toMatchObject({ families: ['ugc_native', 'full_bleed_type'], source: 'notes', copyDensity: 'minimal' })
    expect(styleProfileFromAnalysis(null, { notes: 'algo' }).source).toBe('default')
  })

  it('the brand kit jsonb keeps a valid analysis and drops a tampered one (no new column)', () => {
    const good = { ...EDITORIAL, analyzedAt: 'a', model: 'm', referenceCount: 1, referenceHash: 'h' }
    expect(normalizeStyleDna({ id: 'd', name: 'n', analysis: good })?.analysis?.layoutPattern).toBe('editorial')
    expect(normalizeStyleDna({ id: 'd', name: 'n', analysis: { ...good, layoutPattern: 'evil' } })?.analysis).toBeUndefined()
    expect(parseStyleDnas([{ id: 'd', name: 'n', referenceUrls: ['https://x/1.jpg'] }])[0].analysis).toBeUndefined()
  })

  it('copy density from the profile reaches the copy prompt', () => {
    const angle = planAngles({ dna: serum.dna, offer: serum.offer })[0]
    const styled = { ...serum.dna, visual: { ...serum.dna.visual, styleProfile: styleProfileFromAnalysis(EDITORIAL as unknown as StyleDnaAnalysis) } }
    expect(buildCopyPrompt({ dna: styled, offer: serum.offer, angle, language: 'es' }).user).toMatch(/DENSIDAD .*mínima/)
    expect(buildCopyPrompt({ dna: serum.dna, offer: serum.offer, angle, language: 'es' }).user).not.toMatch(/DENSIDAD/)
  })
})

describe('adpack_start {styleDnaId}', () => {
  it('analyzes the kit style DNA once, persists it on the kit, and lays the pack out in its families', async () => {
    const db = fakeSavedBrandDb()
    const saved: Array<{ brandId: string; styleDna: StyleDna }> = []
    const env = createDoorEnv({
      savedBrandDb: db,
      vision: (_i, images) => (images.some((u) => u.includes('style-1')) ? EDITORIAL : { productMatches: true, strayText: false, score: 0.9 }),
      saveStyleDnaAnalysis: async ({ brandId, styleDna }) => {
        saved.push({ brandId, styleDna })
      },
    })
    const res = await env.service.startPack({ userId: USER_A, source: 'mcp', brandId: BIZ_A, offerId: PROD_A, size: 6, styleDnaId: 'dna_1' })
    expect(res.styleProfile).toMatchObject({ styleDnaId: 'dna_1', families: ['editorial_minimal', 'framed_card'], copyDensity: 'minimal', source: 'analysis' })
    expect(new Set(res.angles!.map((a) => a.layoutFamily))).toEqual(new Set(['editorial_minimal', 'framed_card']))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ brandId: BIZ_A, styleDna: { id: 'dna_1', analysis: { layoutPattern: 'editorial' } } })
    expect(env.logs.some((l) => l.metadata.feature === 'adpack_style_dna')).toBe(true)
    // References are a quality floor only: never sent to the scene model.
    await env.service.advance({ userId: USER_A, packId: res.packId, budgetMs: 30_000 })
    for (const call of env.gateway.sceneCalls) expect([...call.refs, ...call.styleRefs].join(' ')).not.toMatch(/style-1/)
  })

  it('unknown style DNA → NOT_FOUND; styleDnaId without a saved brand → BAD_INPUT; DNAs are listed by adpack_from_brand', async () => {
    const env = createDoorEnv({ savedBrandDb: fakeSavedBrandDb() })
    await expect(env.service.startPack({ userId: USER_A, source: 'web', brandId: BIZ_A, size: 2, styleDnaId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(env.service.startPack({ userId: USER_A, source: 'web', dna: serum.dna, offer: serum.offer, size: 2, styleDnaId: 'dna_1' })).rejects.toMatchObject({ code: 'BAD_INPUT' })
    const from = await env.service.dnaFromBrand({ userId: USER_A, brandId: BIZ_A })
    expect(from.styleDnas).toEqual([{ id: 'dna_1', name: 'Feed', kind: 'ads', references: 1, analyzed: false }])
  })
})
