import { describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../api/lib/usage-logger'
import { isPlaceholderValue, stripPlaceholderParts } from '../api/lib/placeholder-guard'
import { audienceLines, parseBrandProfilePatch } from '../api/lib/brand-profile'
import { mcpSetPrimaryBrandKit, mcpUpdateBrandKit, mcpCreateBrandKit } from '../api/lib/mcp/brand-kit-tools'
import { groupPossibleDuplicates, mcpListBrandsWithDuplicates, normalizeBrandName, type McpDbClient } from '../api/lib/mcp/user-tools'
import { handleMcpJsonRpc } from '../api/lib/mcp/protocol'
import { buildDnaFromSavedBrand } from '../api/lib/adpack/saved-brand'
import type { RehostFn } from '../api/lib/mcp/asset-rehost'
import { BIZ_A, BIZ_B, KIT_A, KIT_A_OTHER, PROD_A } from './adpack/saved-brand-fakes'
import { USER_A, USER_B } from './adpack/door-harness'
import { createMcpWorld } from './helpers/mcp-world'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

describe('placeholder guard (B3)', () => {
  it('flags enum leaks, defaults and empty markers', () => {
    for (const v of ['country', 'Todo el país', 'Personas 18–65', 'Personas 18-65, todo el país', 'N/A', 'TBD', '[audiencia]', '{name}', 'lorem ipsum dolor', 'xxx', '—', 'Hecho para country', '18-65', 'People 18-65+', 'público objetivo']) {
      expect(isPlaceholderValue(v), v).toBe(true)
    }
  })

  it('keeps real values', () => {
    for (const v of ['Mujeres 25–40', 'Costa Rica', 'Papás que buscan regalos para niños de 8 a 12', 'Todo el kit viene armado', 'GAM', 'Heredia', 'Space Grotesk', 'cercana y clara']) {
      expect(isPlaceholderValue(v), v).toBe(false)
    }
    expect(stripPlaceholderParts('Mujeres 25–40, todo el país')).toBe('Mujeres 25–40')
    expect(stripPlaceholderParts('Personas 18–65, todo el país')).toBe('')
  })
})

describe('brand profile (pure)', () => {
  const assertUrl = (u: string) => {
    if (!/^https:\/\//.test(u)) throw new Error('https only')
    return u
  }

  it('parses audiences, register, locale, do/dont, logo variants; drops placeholder audiences', () => {
    const res = parseBrandProfilePatch({
      audiences: [
        { label: 'Papás con hijos de 8 a 12', ageMin: 30, ageMax: 45, geo: 'GAM' },
        { label: 'country', ageMin: 18, ageMax: 65 },
        { label: 'Makers', geo: 'todo el país' },
      ],
      register: 'voseo',
      locale: 'es-CR',
      do: ['Hablar de vos'],
      dont: ['N/A', 'Prometer armado en minutos'],
      logoVariants: [{ url: 'https://cdn.example/logo-dark.png', variant: 'dark' }],
    }, null, { assertUrl })
    expect(res.profile.audiences).toEqual([
      { label: 'Papás con hijos de 8 a 12', ageMin: 30, ageMax: 45, geo: 'GAM' },
      { label: 'Makers' },
    ])
    expect(res.profile.dont).toEqual(['Prometer armado en minutos'])
    expect(res.ignoredPlaceholders.map((p) => p.value)).toEqual(['country', 'todo el país', 'N/A'])
    expect(audienceLines(res.profile)).toEqual(['Papás con hijos de 8 a 12 30–45, GAM', 'Makers'])
  })

  it('rejects bad values', () => {
    const p = (raw: Record<string, unknown>, known?: string[]) => () => parseBrandProfilePatch(raw, null, { assertUrl, knownStyleDnaIds: known })
    expect(p({ register: 'vos' })).toThrow(/voseo, tuteo or usted/)
    expect(p({ locale: 'costa rica' })).toThrow(/es-CR/)
    expect(p({ audiences: [{ label: 'Papás', ageMin: 50, ageMax: 20 }] })).toThrow(/ageMin must be/)
    expect(p({ logoVariants: [{ url: 'http://x.example/l.png', variant: 'dark' }] })).toThrow(/https only/)
    expect(p({ logoVariants: [{ url: 'https://x.example/l.png', variant: 'neon' }] })).toThrow(/variant/)
    expect(p({ styleDnaIds: ['dna_nope'] }, ['dna_1'])).toThrow(/unknown Style DNA/)
  })
})

describe('update_brand_kit: every field editable + placeholder guard (B3)', () => {
  const user = { id: USER_A }

  it('stores profile fields, aliases and clears placeholder text fields', async () => {
    const world = createMcpWorld()
    const res = await mcpUpdateBrandKit({
      store: world.kitStore,
      user,
      args: {
        brandId: BIZ_A,
        kitId: KIT_A,
        targetAudience: 'country',
        fonts: { heading: 'Space Grotesk', body: 'Inter' },
        colors: { primary: '#0B1F3A', accent: '#F2A900' },
        audiences: [{ label: 'Papás con hijos de 8 a 12', ageMin: 30, ageMax: 45, geo: 'GAM' }, { label: 'Personas 18–65' }],
        register: 'voseo',
        locale: 'es-CR',
        do: ['Mostrar el avión real'],
        dont: ['Decir armado en minutos'],
        styleDnaIds: ['dna_1'],
        forbiddenPhrases: ['milagro', 'TBD'],
      },
    })
    const kit = world.db.kits.find((k) => k.id === KIT_A)!
    expect(kit).toMatchObject({ target_audience: null, font_primary: 'Space Grotesk', font_secondary: 'Inter', primary_color: '#0B1F3A', accent_color: '#F2A900', forbidden_phrases: ['milagro'] })
    expect(kit.brand_profile).toMatchObject({ register: 'voseo', locale: 'es-CR', styleDnaIds: ['dna_1'], audiences: [{ label: 'Papás con hijos de 8 a 12', ageMin: 30, ageMax: 45, geo: 'GAM' }] })
    expect(res.ignoredPlaceholders).toEqual(expect.arrayContaining([
      { field: 'targetAudience', value: 'country' },
      { field: 'forbiddenPhrases', value: 'TBD' },
      { field: 'audiences[1].label', value: 'Personas 18–65' },
    ]))
    expect((res.kit as Record<string, unknown>).brandProfile).toMatchObject({ register: 'voseo' })
  })

  it('validates colors and Style DNA ids', async () => {
    const world = createMcpWorld()
    await expect(mcpUpdateBrandKit({ store: world.kitStore, user, args: { brandId: BIZ_A, kitId: KIT_A, colors: { primary: 'navy' } } })).rejects.toThrow(/hex color/)
    await expect(mcpUpdateBrandKit({ store: world.kitStore, user, args: { brandId: BIZ_A, kitId: KIT_A, styleDnaIds: ['nope'] } })).rejects.toThrow(/unknown Style DNA/)
    await expect(mcpUpdateBrandKit({ store: world.kitStore, user: { id: USER_B }, args: { brandId: BIZ_A, kitId: KIT_A, tagline: 'x' } })).rejects.toThrow(/not found/)
  })

  it('degrades before migration 085: classic fields saved, profile reported pending', async () => {
    const world = createMcpWorld({ caps: { brandProfile: false } })
    const res = await mcpUpdateBrandKit({ store: world.kitStore, user, args: { brandId: BIZ_A, kitId: KIT_A, tagline: 'Aviones de papel que vuelan', register: 'usted' } })
    const kit = world.db.kits.find((k) => k.id === KIT_A)!
    expect(kit.tagline).toBe('Aviones de papel que vuelan')
    expect(kit.brand_profile).toBeUndefined()
    expect(res.migrationPending).toBe('085_offer_profile_brand_profile_images')
  })

  it('copies external logo / reference links into Advance storage (C2) and keeps the original', async () => {
    const world = createMcpWorld()
    const rehost: RehostFn = async ({ url }) => (url.includes('drive.google.com')
      ? { url: 'https://proj.supabase.test/storage/v1/object/public/post-images/u/uploads/1-logo.png', sourceUrl: url, rehosted: true }
      : { url, rehosted: false, warning: 'download failed (HTTP 403)' })
    const res = await mcpCreateBrandKit({
      store: world.kitStore,
      db: world.mcpDb,
      user,
      rehost,
      args: { brandId: BIZ_A, name: 'Kit nuevo', logoUrl: 'https://drive.google.com/file/d/abc/view', referenceImageUrls: ['https://private.example/ref.jpg'] },
    })
    const kit = world.db.kits.find((k) => k.name === 'Kit nuevo')!
    expect(kit.logo_url).toMatch(/post-images/)
    expect(kit.reference_images).toEqual(['https://private.example/ref.jpg'])
    expect(res.rehosted).toEqual([{ field: 'logoUrl', url: kit.logo_url, sourceUrl: 'https://drive.google.com/file/d/abc/view' }])
    expect(String((res.warnings as string[])[0])).toMatch(/HTTP 403/)
  })

  it('placeholders saved earlier never reach the DNA ("Hecho para country")', async () => {
    const world = createMcpWorld()
    const kit = world.db.kits.find((k) => k.id === KIT_A)!
    kit.target_audience = 'country'
    kit.tagline = 'N/A'
    kit.brand_profile = { register: 'usted', dont: ['Prometer armado en minutos'], audiences: [{ label: 'Papás con hijos de 8 a 12', geo: 'GAM' }, { label: 'country' }] }
    const biz = world.db.businesses.find((b) => b.id === BIZ_A)!
    biz.target_audiences = [{ sex: 'any', age_min: 18, age_max: 65, geographic_scope: 'country' }]
    biz.icp_description = 'todo el país'
    const res = await buildDnaFromSavedBrand({ db: world.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    const text = JSON.stringify(res.dna)
    expect(text).not.toMatch(/country|todo el país|Personas 18–65|N\/A/)
    expect(res.dna.audience?.[0]).toBe('Papás con hijos de 8 a 12, GAM')
    expect(res.dna.register).toBe('usted')
    expect(res.dna.forbiddenPhrases).toContain('Prometer armado en minutos')
  })
})

describe('primary kit + duplicates + archive (B4)', () => {
  it('set_primary_brand_kit switches the primary kit and never moves a kit across brands', async () => {
    const world = createMcpWorld()
    const res = await mcpSetPrimaryBrandKit({ store: world.kitStore, user: { id: USER_A }, args: { brandId: BIZ_A, brandKitId: KIT_A_OTHER } })
    expect(res.status).toBe('updated')
    expect(world.db.kits.filter((k) => k.business_id === BIZ_A && k.is_primary_for_business).map((k) => k.id)).toEqual([KIT_A_OTHER])
    const again = await mcpSetPrimaryBrandKit({ store: world.kitStore, user: { id: USER_A }, args: { brandId: BIZ_A, brandKitId: KIT_A_OTHER } })
    expect(again.status).toBe('unchanged')
    world.db.kits.push({ id: 'kit-b', user_id: USER_A, business_id: 'other-brand', name: 'Otro', is_active: true })
    await expect(mcpSetPrimaryBrandKit({ store: world.kitStore, user: { id: USER_A }, args: { brandId: BIZ_A, brandKitId: 'kit-b' } })).rejects.toThrow(/another brand/)
    await expect(mcpSetPrimaryBrandKit({ store: world.kitStore, user: { id: USER_B }, args: { brandId: BIZ_A, brandKitId: KIT_A } })).rejects.toThrow('Brand not found')
  })

  it('normalizes names and groups possible duplicates without merging', () => {
    expect(normalizeBrandName('Forge CR')).toBe(normalizeBrandName('forge-cr'))
    expect(normalizeBrandName('Pura Sonrisa')).toBe(normalizeBrandName('PURA  SONRISA.'))
    const groups = groupPossibleDuplicates([
      { id: 'a', name: 'ForgeCR', kitReady: false, offerCount: 0 },
      { id: 'b', name: 'Forge CR', kitReady: true, offerCount: 3 },
      { id: 'c', name: 'forge-cr', kitReady: true, offerCount: 1 },
      { id: 'd', name: 'DeepClean', kitReady: true, offerCount: 1 },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].brandIds).toEqual(['a', 'b', 'c'])
    expect(groups[0].suggestion).toMatch(/Keep "Forge CR" \(b/)
    expect(groups[0].suggestion).toMatch(/archive_brand/)
  })

  it('list_brands returns possibleDuplicates and hides archived brands unless includeArchived', async () => {
    const brands = [
      { id: 'a', name: 'ForgeCR' },
      { id: 'b', name: 'Forge CR' },
      { id: 'c', name: 'Forge-CR', archived: true },
      { id: 'd', name: 'DeepClean' },
    ]
    const db: McpDbClient = {
      async listBusinessesForUser(_u, opts) {
        return brands.filter((b) => opts?.includeArchived || !b.archived).map((b) => ({ ...b, type: null }))
      },
      async getBusinessForUser() {
        return null
      },
      async listOffersForBrand(_u, brandId) {
        return brandId === 'b' ? [{ id: 'o1', name: 'Kit' }] : []
      },
      async getBrandKitForBrand(_u, brandId) {
        return brandId === 'd' || brandId === 'b' ? { id: `k-${brandId}`, name: 'kit' } : null
      },
    }
    const listed = await mcpListBrandsWithDuplicates(db, { id: USER_A }, { includeIncomplete: true })
    expect(listed.brands.map((b) => b.id)).toEqual(['a', 'b', 'd'])
    expect(listed.possibleDuplicates.map((g) => g.brandIds)).toEqual([['a', 'b']])
    const withArchived = await mcpListBrandsWithDuplicates(db, { id: USER_A }, { includeIncomplete: true, includeArchived: true })
    expect(withArchived.brands.find((b) => b.id === 'c')?.archived).toBe(true)
    // archived brands never count as duplicates to clean up
    expect(withArchived.possibleDuplicates.map((g) => g.brandIds)).toEqual([['a', 'b']])

    const rpc = await handleMcpJsonRpc({ body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_brands', arguments: {} } }, user: { id: USER_A }, db })
    const payload = JSON.parse((rpc.result as { content: Array<{ text: string }> }).content[0].text)
    expect(payload.brands.map((b: { id: string }) => b.id)).toEqual(['b', 'd'])
    expect(payload.possibleDuplicates[0].brandIds).toEqual(['a', 'b'])
  })

  it('archive_brand still requires the typed name and an in-chat confirmation', async () => {
    const rpc = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      user: { id: USER_A },
      db: {} as McpDbClient,
    })
    const tools = (rpc.result as { tools: Array<{ name: string; inputSchema: { required?: string[] } }> }).tools
    expect(tools.find((t) => t.name === 'archive_brand')?.inputSchema.required).toEqual(['brandId', 'confirm'])
    expect(tools.find((t) => t.name === 'list_brands')).toBeTruthy()
    expect(BIZ_B).not.toBe(BIZ_A)
  })
})
