import { describe, expect, it } from 'vitest'
import { MCP_PRODUCTS_OFFER_SELECT } from '../api/lib/mcp/supabase-adapter'
import {
  assertProductReferenceGate,
} from '../api/lib/mcp/reference-gate'
import {
  asJobHandleFromStored,
} from '../api/lib/mcp/execute-job'
import {
  formatMcpToolErrorCode,
  formatMcpToolErrorMessage,
  handleMcpJsonRpc,
} from '../api/lib/mcp/protocol'
import type { McpDbClient } from '../api/lib/mcp/user-tools'

describe('MCP 0.9.5 prod regression', () => {
  it('never selects nonexistent products.do_not_claim', () => {
    expect(MCP_PRODUCTS_OFFER_SELECT).not.toMatch(/do_not_claim/)
    expect(MCP_PRODUCTS_OFFER_SELECT).toMatch(/price_range/)
    expect(MCP_PRODUCTS_OFFER_SELECT).toMatch(/re_price/)
  })

  it('bulk/campaign schemas expose product refs + aspectRatioFallback', async () => {
    const db: McpDbClient = {
      async listBusinessesForUser() { return [] },
      async getBusinessForUser() { return null },
      async listOffersForBrand() { return [] },
      async getBrandKitForBrand() { return null },
      async resolveBrandKitsForBrand() {
        return { brandKit: null, brandKits: [], brandKitResolution: 'missing' as const }
      },
      async getLatestGuideIntakeForBrand() { return null },
    }
    const listed = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      user: { id: 'user-a' },
      db,
    })
    const tools = (listed.result as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> }).tools
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]))
    for (const name of ['execute_bulk_posts', 'execute_campaign_pack'] as const) {
      const props = byName[name].properties as Record<string, unknown>
      expect(props).toHaveProperty('productImageId')
      expect(props).toHaveProperty('referenceImageIds')
      expect(props).toHaveProperty('referenceMode')
      expect(props).toHaveProperty('aspectRatioFallback')
    }
  })

  it('allowImplicitOfferRefs only when stored product refs exist', () => {
    expect(() => assertProductReferenceGate({
      toolName: 'execute_bulk_posts',
      productRefCount: 2,
      allowImplicitOfferRefs: true,
    })).not.toThrow()
    expect(() => assertProductReferenceGate({
      toolName: 'execute_bulk_posts',
      productRefCount: 0,
      allowImplicitOfferRefs: true,
    })).toThrow(/no product reference/)
  })

  it('failed poll preserves partial chargedCredits', () => {
    const formatted = asJobHandleFromStored('appr-1', {
      status: 'failed',
      toolName: 'execute_campaign_pack',
      chargedCredits: 48,
      quotedCreditCost: 120,
      scripts: [{ scriptId: 's1' }],
      error: 'mid-pack failure',
    }, 'execute_campaign_pack') as Record<string, unknown>
    expect(formatted.status).toBe('failed')
    expect(formatted.chargedCredits).toBe(48)
    expect((formatted.usage as { chargedCredits: number }).chargedCredits).toBe(48)
    expect(formatted.scripts).toEqual([{ scriptId: 's1' }])
  })

  it('formats PostgREST-style errors into structured MCP tool bodies', async () => {
    expect(formatMcpToolErrorMessage({ message: 'column products.do_not_claim does not exist', code: '42703' }))
      .toMatch(/do_not_claim/)
    expect(formatMcpToolErrorCode({ message: 'x', code: '42703' })).toBe('42703')

    const db: McpDbClient = {
      async listBusinessesForUser() {
        throw { message: 'column products.do_not_claim does not exist', code: '42703' }
      },
      async getBusinessForUser() { return null },
      async listOffersForBrand() { return [] },
      async getBrandKitForBrand() { return null },
      async resolveBrandKitsForBrand() {
        return { brandKit: null, brandKits: [], brandKitResolution: 'missing' as const }
      },
      async getLatestGuideIntakeForBrand() { return null },
    }
    const res = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'list_brands', arguments: {} },
      },
      user: { id: 'user-a' },
      db,
    })
    expect(res.result).toMatchObject({ isError: true })
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text
    const body = JSON.parse(text) as {
      status: string
      toolName: string
      error: { message: string; code?: string }
    }
    expect(body.status).toBe('error')
    expect(body.toolName).toBe('list_brands')
    expect(body.error.message).toMatch(/do_not_claim/)
    expect(body.error.code).toBe('42703')
  })
})
