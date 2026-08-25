import { describe, expect, it } from 'vitest'
import {
  MCP_APPROVAL_TTL_MS,
  consumeMcpApproval,
  createMemoryMcpApprovalStore,
  hashMcpToolInput,
  issueMcpApproval,
} from '../api/lib/mcp/approval'
import {
  assertTypedBrandNameConfirm,
  buildMcpBrandDeletePreview,
  planMcpBrandDelete,
} from '../api/lib/mcp/brand-delete'
import { validateMcpGuideIntake } from '../api/lib/mcp/guide-intake'
import { handleMcpJsonRpc } from '../api/lib/mcp/protocol'
import type { McpUrlIntakeStore } from '../api/lib/mcp/url-intake'
import type { McpDbClient } from '../api/lib/mcp/user-tools'

const db: McpDbClient = {
  async listBusinessesForUser(userId) {
    if (userId !== 'user-a') return []
    return [{ id: 'b1', name: 'Pura Sonrisa', type: null }]
  },
  async getBusinessForUser(userId, brandId) {
    if (userId !== 'user-a' || brandId !== 'b1') return null
    return { id: 'b1', name: 'Pura Sonrisa', type: null, userId: 'user-a' }
  },
  async listOffersForBrand(userId, brandId) {
    if (userId !== 'user-a' || brandId !== 'b1') return []
    return [{ id: 'p1', name: 'Tiras', type: 'product' }]
  },
  async getBrandKitForBrand(userId, brandId) {
    if (userId !== 'user-a' || brandId !== 'b1') return null
    return { id: 'k1', name: 'Kit', primaryColor: '#111', secondaryColor: '#222' }
  },
}

describe('mcp approval tokens', () => {
  it('issues 1h tokens and rejects replay / input mismatch / expiry', async () => {
    expect(MCP_APPROVAL_TTL_MS).toBe(60 * 60 * 1000)
    const store = createMemoryMcpApprovalStore()
    const input = { brandId: 'b1', prompt: 'hola' }
    const issued = await issueMcpApproval(store, {
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input,
      nowMs: 1_000,
    })
    expect(issued.expiresAtMs - 1_000).toBe(MCP_APPROVAL_TTL_MS)

    const ok = await consumeMcpApproval(store, {
      token: issued.token,
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input,
      nowMs: 2_000,
    })
    expect(ok.ok).toBe(true)

    const replay = await consumeMcpApproval(store, {
      token: issued.token,
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input,
      nowMs: 3_000,
    })
    expect(replay.ok).toBe(false)

    const issued2 = await issueMcpApproval(store, {
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input,
      nowMs: 10_000,
    })
    const mismatch = await consumeMcpApproval(store, {
      token: issued2.token,
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input: { brandId: 'b1', prompt: 'CHANGED' },
      nowMs: 11_000,
    })
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.reason).toMatch(/input mismatch/i)

    const issued3 = await issueMcpApproval(store, {
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input,
      nowMs: 20_000,
      ttlMs: 100,
    })
    const expired = await consumeMcpApproval(store, {
      token: issued3.token,
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input,
      nowMs: 20_200,
    })
    expect(expired.ok).toBe(false)
    expect(hashMcpToolInput({ b: 1, a: 2 })).toBe(hashMcpToolInput({ a: 2, b: 1 }))
  })
})

describe('mcp guide intake', () => {
  it('allows https url + up to 5 pdf/images and blocks SSRF-ish hosts', () => {
    expect(validateMcpGuideIntake({
      url: 'https://example.com/brand',
      files: [
        { mimeType: 'application/pdf', name: 'a.pdf' },
        { mimeType: 'image/png', name: 'b.png' },
      ],
    }).ok).toBe(true)

    expect(validateMcpGuideIntake({
      files: Array.from({ length: 6 }, () => ({ mimeType: 'image/jpeg' })),
    }).ok).toBe(false)

    expect(validateMcpGuideIntake({ url: 'http://127.0.0.1/x' }).ok).toBe(false)
    expect(validateMcpGuideIntake({ url: 'https://localhost/x' }).ok).toBe(false)
  })
})

describe('mcp brand delete contract', () => {
  it('warns, requires typed name, detaches kits before cascade', () => {
    const preview = buildMcpBrandDeletePreview({
      brandId: 'b1',
      brandName: 'Pura Sonrisa',
      sessionCount: 3,
      offerCount: 2,
      kitCount: 1,
    })
    expect(preview.kitCountPreserved).toBe(1)
    expect(preview.warning).toMatch(/cannot be undone/i)
    expect(() => assertTypedBrandNameConfirm({
      brandName: 'Pura Sonrisa',
      typedName: 'wrong',
    })).toThrow(/exact brand name/i)
    expect(planMcpBrandDelete({
      businessId: 'b1',
      sessionIds: ['s1'],
      productIds: ['p1'],
    })[0]).toEqual({ type: 'detach-brand-kits', businessId: 'b1' })
  })
})

describe('mcp protocol', () => {
  it('lists enabled tools and returns brand context for the owner', async () => {
    const init = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      user: { id: 'user-a' },
      db,
    })
    expect(init.result).toMatchObject({ protocolVersion: expect.any(String) })

    const listed = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      user: { id: 'user-a' },
      db,
    })
    const tools = (listed.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort()
    expect(tools).toContain('list_brands')
    expect(tools).toContain('get_brand_context')
    expect(tools).toContain('workspace_save_url_context')
    expect(tools).toContain('guide_brand_pack')
    expect(tools).toContain('execute_script_generate')
    expect(tools).toContain('execute_image_generate')
    expect(tools).toContain('guide_bulk_angles')
    expect(tools).toContain('execute_bulk_scripts')
    expect(tools).toContain('execute_bulk_posts')
    expect(tools).toContain('execute_campaign_pack')
    expect(tools).toContain('list_style_dnas')
    expect(tools).toContain('workspace_save_artifact')
    expect(tools).toContain('execute_image_edit')
    expect(tools).toContain('execute_carousel_generate')
    expect(tools).toContain('delete_brand')
    expect(tools).not.toContain('team_list_members')

    const called = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_brand_context', arguments: { brandId: 'b1' } },
      },
      user: { id: 'user-a' },
      db,
    })
    expect(called.result).toMatchObject({ isError: false })
    const text = (called.result as { content: Array<{ text: string }> }).content[0].text
    expect(text).toContain('Pura Sonrisa')
    expect(text).toContain('Tiras')
  })

  it('does not leak brands across users', async () => {
    const listed = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list_brands', arguments: {} },
      },
      user: { id: 'user-b' },
      db,
    })
    expect((listed.result as { content: Array<{ text: string }> }).content[0].text).toContain('"brands": []')
  })

  it('saves GUIDE url intake as pending_analysis without credits', async () => {
    const store: McpUrlIntakeStore = {
      async insertPendingUrlIntake(row) {
        expect(row.userId).toBe('user-a')
        expect(row.businessId).toBe('b1')
        expect(row.sourceUrl).toMatch(/^https:\/\//)
        return { id: 'intake-1' }
      },
    }
    const called = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'workspace_save_url_context',
          arguments: { brandId: 'b1', url: 'https://example.com/brand' },
        },
      },
      user: { id: 'user-a' },
      db,
      urlIntakeStore: store,
      appOrigin: 'https://advanceai.studio',
    })
    expect(called.result).toMatchObject({ isError: false })
    const text = (called.result as { content: Array<{ text: string }> }).content[0].text
    expect(text).toContain('pending_analysis')
    expect(text).toContain('intake-1')
    expect(text).toContain('/chat?brand=b1')
  })
})

describe('mcp www-authenticate', () => {
  it('emits RFC 9728 resource_metadata challenge (exact)', async () => {
    const {
      mcpWwwAuthenticateHeader,
      MCP_RESOURCE_METADATA_URL,
      MCP_RESOURCE_METADATA_PARAM,
    } = await import('../api/lib/mcp/www-authenticate')
    expect(MCP_RESOURCE_METADATA_PARAM).toBe('resource_metadata')
    expect(MCP_RESOURCE_METADATA_URL).toBe(
      'https://advanceai.studio/.well-known/oauth-protected-resource'
    )
    expect(mcpWwwAuthenticateHeader()).toBe(
      `Bearer ${MCP_RESOURCE_METADATA_PARAM}="${MCP_RESOURCE_METADATA_URL}"`
    )
    expect(mcpWwwAuthenticateHeader().startsWith('Bearer resource_')).toBe(true)
    expect(mcpWwwAuthenticateHeader().includes('metadata=')).toBe(true)
  })
})
