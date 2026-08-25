import { describe, expect, it, vi } from 'vitest'
import {
  maskEmail,
  resolveBrandKitForBusiness,
} from '../api/lib/brand-kit-resolve'
import {
  mcpCreateBrandKit,
  mcpLinkBrandKit,
  mcpListBrandKits,
  type McpBrandKitStore,
} from '../api/lib/mcp/brand-kit-tools'
import { buildCursorFixBrief, toTicketSummary, type McpAdminTicket } from '../api/lib/mcp/admin-tools'
import { auditMcpToolCall } from '../api/lib/mcp/tool-audit'
import { assertMcpBulkCount, assertMcpCarouselSlideCount } from '../api/lib/mcp/limits'
import { handleMcpJsonRpc, MCP_SERVER_INFO } from '../api/lib/mcp/protocol'
import { listEnabledMcpTools } from '../api/lib/mcp/tool-registry'
import * as usageLogger from '../api/lib/usage-logger'

describe('brand kit resolution', () => {
  it('prefers primary over sole linked and never uses names', () => {
    const kits = [
      {
        id: 'k1',
        name: 'A',
        business_id: 'b1',
        is_active: true,
        is_primary_for_business: false,
      },
      {
        id: 'k2',
        name: 'PatchHouse.CR',
        business_id: 'b1',
        is_active: true,
        is_primary_for_business: true,
      },
    ]
    const resolved = resolveBrandKitForBusiness({ linkedKits: kits })
    expect(resolved.resolution).toBe('primary')
    expect(resolved.kit?.id).toBe('k2')
  })

  it('returns missing when unlinked kits are not in the linked set', () => {
    const resolved = resolveBrandKitForBusiness({ linkedKits: [] })
    expect(resolved.resolution).toBe('missing')
    expect(resolved.kit).toBeNull()
  })

  it('masks emails', () => {
    expect(maskEmail('rafa@example.com')).toBe('ra***@example.com')
  })
})

describe('mcp brand kit tools', () => {
  function memoryStore(): McpBrandKitStore & { rows: Map<string, Record<string, unknown>> } {
    const rows = new Map<string, Record<string, unknown>>()
    return {
      rows,
      async listKits({ userId, brandId, includeInactive }) {
        return [...rows.values()]
          .filter((r) => r.user_id === userId)
          .filter((r) => !brandId || r.business_id === brandId)
          .filter((r) => includeInactive || r.is_active !== false)
          .map((r) => ({
            id: r.id as string,
            name: r.name as string,
            business_id: r.business_id as string | null,
            is_active: r.is_active as boolean,
            is_default: r.is_default as boolean,
            is_primary_for_business: r.is_primary_for_business as boolean,
            primary_color: (r.primary_color as string | null) ?? null,
            logo_url: (r.logo_url as string | null) ?? null,
            tagline: (r.tagline as string | null) ?? null,
          }))
      },
      async getKit({ userId, kitId }) {
        const row = rows.get(kitId)
        if (!row || row.user_id !== userId) return null
        return row as never
      },
      async countKits(userId) {
        return [...rows.values()].filter((r) => r.user_id === userId).length
      },
      async insertKit({ userId, row }) {
        const id = `kit-${rows.size + 1}`
        const full = { ...row, id, user_id: userId }
        rows.set(id, full)
        return full as never
      },
      async updateKit({ userId, kitId, patch }) {
        const existing = rows.get(kitId)
        if (!existing || existing.user_id !== userId) throw new Error('Brand kit not found')
        const next = { ...existing, ...patch }
        rows.set(kitId, next)
        return next as never
      },
      async clearPrimaryForBusiness({ userId, businessId, exceptKitId }) {
        for (const [id, row] of rows) {
          if (row.user_id === userId && row.business_id === businessId && id !== exceptKitId) {
            rows.set(id, { ...row, is_primary_for_business: false })
          }
        }
      },
      async deleteKit({ userId, kitId }) {
        const row = rows.get(kitId)
        if (!row || row.user_id !== userId) throw new Error('Brand kit was not deleted')
        rows.delete(kitId)
      },
      async assertOwnsBrand(userId, brandId) {
        return userId === 'u1' && brandId === 'b1'
      },
    }
  }

  it('creates a linked primary kit and lists it', async () => {
    const store = memoryStore()
    const user = { id: 'u1' }
    const created = await mcpCreateBrandKit({
      store,
      db: {} as never,
      user,
      args: {
        brandId: 'b1',
        name: 'PatchHouse.CR',
        primaryColor: '#111111',
        logoUrl: 'https://cdn.example/logo.png',
        setAsPrimary: true,
      },
    })
    expect(created.status).toBe('created')
    const listed = await mcpListBrandKits({
      store,
      user,
      args: { brandId: 'b1' },
    })
    expect(listed.kits).toHaveLength(1)
    expect(listed.kits[0].isPrimaryForBusiness).toBe(true)
    expect(listed.kits[0].hasLogo).toBe(true)
  })

  it('rejects moving an already-linked kit via link_brand_kit', async () => {
    const store = memoryStore()
    store.rows.set('k1', {
      id: 'k1',
      user_id: 'u1',
      name: 'Kit',
      business_id: 'other',
      is_active: true,
      is_primary_for_business: true,
    })
    await expect(mcpLinkBrandKit({
      store,
      user: { id: 'u1' },
      args: { kitId: 'k1', brandId: 'b1' },
    })).rejects.toThrow(/already linked/i)
  })
})

describe('admin ticket compact + scrub', () => {
  const ticket: McpAdminTicket = {
    id: 't1',
    user_id: 'u1',
    user_email: 'rafa@advanceai.studio',
    subject: 'Bug',
    description: 'Contact me at rafa@advanceai.studio with token=secret123',
    category: 'bug',
    priority: 'high',
    status: 'open',
    page_url: '/chat?brand=abc&session=sess-1',
    ui_surface: 'chat',
    app_version: '1',
    locale: 'es',
    viewport: '390x844',
    browser_info: null,
    screen_size: null,
    console_errors: [],
    breadcrumbs: [
      { type: 'click', target: 'Pegar información1. NAD+ PATCHES long paste body '.repeat(20) },
    ],
    admin_notes: null,
    notes_history: null,
    product_name: null,
    user_plan: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  it('summaries hide full email and diagnostics', () => {
    const summary = toTicketSummary(ticket)
    expect(summary.user_email_masked).toBe('ra***@advanceai.studio')
    expect(summary).not.toHaveProperty('description')
    expect(summary).not.toHaveProperty('breadcrumbs')
  })

  it('scrubs cursor brief secrets, session urls, and paste blobs', () => {
    const brief = buildCursorFixBrief(ticket)
    expect(brief.pageUrl).toBe('/chat')
    expect(brief.cursorCloudAgent.prompt).not.toContain('session=')
    expect(brief.cursorCloudAgent.prompt).not.toContain('rafa@')
    expect(JSON.stringify(brief.repro.breadcrumbs)).toMatch(/scrubbed/i)
    expect(brief.repro.description).toContain('[REDACTED')
  })
})

describe('mcp caps + audit + registry 0.9', () => {
  it('enforces MCP bulk/carousel caps', () => {
    expect(assertMcpBulkCount(10, 25)).toBe(10)
    expect(() => assertMcpBulkCount(11, 25)).toThrow(/max is 10/i)
    expect(assertMcpCarouselSlideCount(5, 10)).toBe(5)
    expect(() => assertMcpCarouselSlideCount(6, 10)).toThrow(/max is 5/i)
  })

  it('keeps brand kit tools exposed at 0.9.3', () => {
    expect(MCP_SERVER_INFO.version).toBe('0.9.3')
    const names = listEnabledMcpTools().map((t) => t.name)
    expect(names).toContain('list_brand_kits')
    expect(names).toContain('create_brand_kit')
    expect(names).toContain('link_brand_kit')
    expect(names).toContain('delete_brand_kit')
  })

  it('audits tools/call including guide as source=mcp', async () => {
    const spy = vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue()
    await auditMcpToolCall({
      userId: '11111111-1111-4111-8111-111111111111',
      toolName: 'guide_script',
      risk: 'guide',
      durationMs: 12,
      success: true,
      resultPayload: { status: 'ok' },
    })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      source: 'mcp',
      feature: 'mcp_tool',
      metadata: expect.objectContaining({ tool: 'guide_script', lane: 'guide' }),
    }))
    spy.mockRestore()
  })

  it('lists brand kit tools via host', async () => {
    const listed = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      user: { id: 'u1' },
      db: {
        async listBusinessesForUser() { return [] },
        async getBusinessForUser() { return null },
        async listOffersForBrand() { return [] },
        async getBrandKitForBrand() { return null },
      },
    })
    const names = (listed.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)
    expect(names).toContain('create_brand_kit')
    expect(names).toContain('link_brand_kit')
  })
})
