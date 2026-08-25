import { describe, expect, it } from 'vitest'
import { quoteLegacyActionCredits } from '../api/lib/auth'
import { quoteCredits } from '../api/lib/credits/catalog'
import {
  assertTypedArchiveConfirm,
  assertTypedAssetDeleteConfirm,
  MCP_DELETE_ASSET_CONFIRM,
} from '../api/lib/mcp/brand-delete'
import { handleMcpJsonRpc, MCP_SERVER_INFO } from '../api/lib/mcp/protocol'
import {
  getMcpTool,
  listEnabledMcpTools,
  MCP_REGISTRY_VERSION,
  MCP_TOOL_GROUPS,
} from '../api/lib/mcp/tool-registry'
import { isAdminToolName } from '../api/lib/mcp/admin-tools'
import { quoteCarouselCredits } from '../api/lib/organic-carousel'
import { createMemoryMcpApprovalStore } from '../api/lib/mcp/approval'
import type { McpDbClient } from '../api/lib/mcp/user-tools'
import type { McpArtifactStore } from '../api/lib/mcp/artifact-store'
import type { McpDeleteStore } from '../api/lib/mcp/delete-tools'

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

const NEW_ENABLED = [
  'workspace_save_artifact',
  'execute_image_edit',
  'execute_image_enhance',
  'execute_carousel_generate',
  'archive_brand',
  'delete_offer',
  'delete_brand',
  'delete_asset',
] as const

function artifactStore(): McpArtifactStore {
  return {
    async ensureExecuteSession() { return { sessionId: 's1' } },
    async saveScriptArtifact() { return { messageId: 'm1', scriptId: 'sc1' } },
    async saveImageArtifact() { return { messageId: 'm1', productImageId: 'img1', imageUrl: 'https://cdn.example/x.jpg' } },
    async saveImageFromPublicUrl(options) {
      return { messageId: 'm1', productImageId: 'img2', imageUrl: options.imageUrl }
    },
    async linkExistingProductImage() {
      return { messageId: 'm1', productImageId: 'img-existing', imageUrl: 'https://cdn.example/existing.jpg' }
    },
    async getOwnedProductImage() { return null },
    async getOwnedScript() { return null },
    async saveCarouselSlides() { return [] },
  }
}

describe('mcp 0.8 remaining tools', () => {
  it('enables the remaining extension tools on 0.8.x', () => {
    expect(MCP_REGISTRY_VERSION).toMatch(/^0\.8\./)
    expect(MCP_SERVER_INFO.version).toMatch(/^0\.8\./)
    for (const name of NEW_ENABLED) {
      const tool = getMcpTool(name)
      expect(tool?.enabled).toBe(true)
    }
    expect(getMcpTool('execute_image_edit')?.group).toBe('execute_studio')
    expect(getMcpTool('execute_image_edit')?.requiresApproval).toBe(true)
    expect(getMcpTool('execute_image_edit')?.consumesAdvanceCredits).toBe(true)
    expect(getMcpTool('execute_image_enhance')?.consumesAdvanceCredits).toBe(true)
    expect(getMcpTool('execute_carousel_generate')?.requiresApproval).toBe(true)
    expect(getMcpTool('workspace_save_artifact')?.consumesAdvanceCredits).toBe(false)
    expect(getMcpTool('archive_brand')?.group).toBe('deletes')
    expect(getMcpTool('delete_brand')?.group).toBe('deletes')
    expect(getMcpTool('delete_offer')?.group).toBe('deletes')
    expect(getMcpTool('delete_asset')?.group).toBe('deletes')
    expect(MCP_TOOL_GROUPS.deletes.defaultEnabled).toBe(true)
    expect(getMcpTool('team_list_members')?.enabled).toBe(false)
  })

  it('lists enabled tools including new ones, hides disabled and admin from non-admins', async () => {
    const listed = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      user: { id: 'user-a' },
      db,
      isAdmin: false,
    })
    const tools = (listed.result as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> }).tools
    const names = tools.map((t) => t.name)
    for (const name of NEW_ENABLED) {
      expect(names).toContain(name)
    }
    expect(names).not.toContain('team_list_members')
    expect(names.some((n) => isAdminToolName(n))).toBe(false)
    expect(listEnabledMcpTools().some((t) => isAdminToolName(t.name))).toBe(false)

    const schemaByName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]))
    expect(schemaByName.workspace_save_artifact.required).toEqual(expect.arrayContaining(['brandId', 'kind']))
    expect(schemaByName.execute_image_edit.required).toEqual(expect.arrayContaining(['brandId', 'editPrompt']))
    expect(schemaByName.execute_carousel_generate.required).toEqual(expect.arrayContaining(['brandId', 'scriptContent']))
    expect(schemaByName.delete_brand.required).toEqual(expect.arrayContaining(['brandId', 'confirm']))
    expect(schemaByName.delete_asset.required).toEqual(expect.arrayContaining(['brandId', 'confirm']))
    expect(JSON.stringify(schemaByName.archive_brand.properties)).toContain('confirm')

    const withDeletesOff = listEnabledMcpTools({ groupsEnabled: { deletes: false } }).map((t) => t.name)
    expect(withDeletesOff).not.toContain('delete_brand')
    expect(withDeletesOff).not.toContain('archive_brand')
    expect(withDeletesOff).toContain('execute_image_edit')
  })

  it('still shows admin tools only to admins', async () => {
    const listed = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      user: { id: 'admin-a' },
      db,
      isAdmin: true,
    })
    const names = (listed.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining([
      'admin_list_tickets',
      'admin_get_ticket',
      'admin_update_ticket',
      'admin_get_usage',
      'admin_request_cursor_fix',
    ]))
  })

  it('quotes edit/enhance 18 and carousel N×24', () => {
    expect(quoteLegacyActionCredits('edit')).toBe(18)
    expect(quoteLegacyActionCredits('enhance')).toBe(18)
    expect(quoteCredits('image_edit')).toBe(18)
    expect(quoteCarouselCredits(5)).toBe(120)
  })

  it('rejects typed confirm mismatches', () => {
    expect(() => assertTypedArchiveConfirm({ brandName: 'Pura Sonrisa', typedName: 'nope' })).toThrow(/exact brand name/i)
    expect(() => assertTypedAssetDeleteConfirm('delete')).toThrow(/DELETE/)
    expect(() => assertTypedAssetDeleteConfirm(MCP_DELETE_ASSET_CONFIRM)).not.toThrow()
  })

  it('workspace_save_artifact returns a deep link without binary and rejects base64', async () => {
    const deep = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'workspace_save_artifact', arguments: { brandId: 'b1', kind: 'image' } },
      },
      user: { id: 'user-a' },
      db,
      artifactStore: artifactStore(),
    })
    expect(deep.result).toMatchObject({ isError: false })
    const deepText = (deep.result as { content: Array<{ text: string }> }).content[0].text
    expect(deepText).toContain('deep_link')
    expect(deepText).toContain('/chat?brand=b1')

    const rejected = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'workspace_save_artifact',
          arguments: { brandId: 'b1', kind: 'image', imageUrl: 'data:image/png;base64,AAAA' },
        },
      },
      user: { id: 'user-a' },
      db,
      artifactStore: artifactStore(),
    })
    expect(rejected.result).toMatchObject({ isError: true })
    expect((rejected.result as { content: Array<{ text: string }> }).content[0].text).toMatch(/base64/i)
  })

  it('delete tools require typed confirm before issuing approval', async () => {
    const store = createMemoryMcpApprovalStore()
    const deletes: McpDeleteStore = {
      async listArchivedBrandIds() { return [] },
      async archiveBrand() { return { noteId: 'n1', sessionsArchived: 0 } },
      async countBrandImpact() {
        return { sessionCount: 0, offerCount: 0, kitCount: 0, sessionIds: [], offerIds: [] }
      },
      async detachBrandKits() { return 0 },
      async deleteSession() {},
      async deleteOffer() {},
      async remainingOfferIds() { return [] },
      async deleteBrandRow() {},
      async deleteAsset() { return { imageUrl: null } },
      async getOffer() { return { id: 'p1', name: 'Tiras' } },
      async getAsset() { return { id: 'img1', imageUrl: 'https://cdn.example/x.jpg' } },
    }

    const mismatch = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'delete_brand', arguments: { brandId: 'b1', confirm: 'wrong' } },
      },
      user: { id: 'user-a' },
      db,
      approvalStore: store,
      deleteStore: deletes,
    })
    expect(mismatch.result).toMatchObject({ isError: true })

    const issued = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'archive_brand', arguments: { brandId: 'b1', confirm: 'Pura Sonrisa' } },
      },
      user: { id: 'user-a' },
      db,
      approvalStore: store,
      deleteStore: deletes,
      appOrigin: 'https://advanceai.studio',
    })
    expect(issued.result).toMatchObject({ isError: false })
    const text = (issued.result as { content: Array<{ text: string }> }).content[0].text
    expect(text).toContain('approval_required')
    expect(text).toContain('confirm_execute')
    expect(text).toContain('userPrompt')
    expect(text).toContain('grok_chat')
    expect(text).not.toContain('Open deepLink')
    expect(text).toContain('optionalAdvancePage')
  })
})
