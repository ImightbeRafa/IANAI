import { describe, expect, it } from 'vitest'
import {
  assertAdminAccess,
  buildCursorFixBrief,
  dispatchAdminTool,
  isAdminToolName,
  type McpAdminStore,
  type McpAdminTicket,
} from '../api/lib/mcp/admin-tools'
import { handleMcpJsonRpc, MCP_SERVER_INFO } from '../api/lib/mcp/protocol'
import { listEnabledMcpTools } from '../api/lib/mcp/tool-registry'
import { resolveUsageSource } from '../api/lib/usage-logger'
import type { McpDbClient } from '../api/lib/mcp/user-tools'

const db: McpDbClient = {
  async listBusinessesForUser() {
    return []
  },
  async getBusinessForUser() {
    return null
  },
  async listOffersForBrand() {
    return []
  },
  async getBrandKitForBrand() {
    return null
  },
}

const sampleTicket: McpAdminTicket = {
  id: 'ticket-1',
  user_id: 'user-a',
  user_email: 'ryan@example.com',
  subject: 'Chat generate failed',
  description: 'Clicked generate on /chat and the image never appeared.',
  category: 'bug',
  priority: 'high',
  status: 'open',
  page_url: '/chat?brand=b1',
  ui_surface: 'chat',
  app_version: '0.1.7',
  locale: 'es',
  viewport: 'desktop',
  browser_info: 'Mozilla/5.0',
  screen_size: '1440x900',
  console_errors: ['TypeError: Failed to fetch'],
  breadcrumbs: [{ type: 'click', target: 'button.generate', timestamp: '2026-08-25T00:00:00.000Z' }],
  admin_notes: null,
  notes_history: [],
  product_name: 'Tiras',
  user_plan: 'pro',
  created_at: '2026-08-25T00:00:00.000Z',
  updated_at: '2026-08-25T00:00:00.000Z',
}

function createStore(ticket = sampleTicket): McpAdminStore {
  let current = { ...ticket }
  return {
    async listTickets() {
      return [current]
    },
    async getTicket(ticketId) {
      return ticketId === current.id ? current : null
    },
    async updateTicket({ ticketId, status, comment }) {
      if (ticketId !== current.id) throw new Error('Ticket not found')
      current = {
        ...current,
        status: status || current.status,
        admin_notes: comment ?? current.admin_notes,
      }
      return current
    },
    async listUsage() {
      return [{
        id: 'log-1',
        user_id: 'user-a',
        user_email: 'ryan@example.com',
        feature: 'image',
        model: 'grok-imagine',
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0.04,
        success: true,
        created_at: '2026-08-25T00:00:00.000Z',
        metadata: { source: 'mcp' },
        source: 'mcp',
      }]
    },
  }
}

describe('usage source resolution', () => {
  it('defaults to web and prefers explicit source over metadata', () => {
    expect(resolveUsageSource({})).toBe('web')
    expect(resolveUsageSource({ metadata: { source: 'mcp' } })).toBe('mcp')
    expect(resolveUsageSource({ source: 'web', metadata: { source: 'mcp' } })).toBe('web')
    expect(resolveUsageSource({ source: 'cron' })).toBe('cron')
  })
})

describe('mcp admin gate', () => {
  it('hides admin tools from tools/list for non-admins', async () => {
    expect(MCP_SERVER_INFO.version).toBe('0.9.5')
    expect(listEnabledMcpTools().some((tool) => isAdminToolName(tool.name))).toBe(false)

    const listed = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      user: { id: 'user-a' },
      db,
      isAdmin: false,
    })
    const names = (listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)
    expect(names).not.toContain('admin_list_tickets')
    expect(names).not.toContain('admin_get_ticket')
    expect(names).not.toContain('admin_update_ticket')
    expect(names).not.toContain('admin_get_usage')
    expect(names).not.toContain('admin_request_cursor_fix')
  })

  it('shows admin tools to admins only', async () => {
    const listed = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      user: { id: 'admin-a' },
      db,
      isAdmin: true,
    })
    const names = (listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'admin_list_tickets',
      'admin_get_ticket',
      'admin_update_ticket',
      'admin_get_usage',
      'admin_request_cursor_fix',
    ]))
  })

  it('rejects non-admin tools/call without leaking a usable payload', async () => {
    expect(() => assertAdminAccess(false)).toThrow(/Admin access required/)

    const called = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'admin_list_tickets', arguments: {} },
      },
      user: { id: 'user-a' },
      db,
      adminStore: createStore(),
      isAdmin: false,
    })
    expect(called.error).toMatchObject({
      code: -32601,
      message: 'Unknown or disabled tool: admin_list_tickets',
    })
    expect(called.result).toBeUndefined()
  })

  it('lets an admin list tickets and request a Cursor brief', async () => {
    const store = createStore()
    const listed = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'admin_list_tickets', arguments: {} },
      },
      user: { id: 'admin-a' },
      db,
      adminStore: store,
      isAdmin: true,
    })
    expect(listed.result).toMatchObject({ isError: false })
    expect((listed.result as { content: Array<{ text: string }> }).content[0].text).toContain('ticket-1')

    const brief = await handleMcpJsonRpc({
      body: {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'admin_request_cursor_fix', arguments: { ticketId: 'ticket-1' } },
      },
      user: { id: 'admin-a' },
      db,
      adminStore: store,
      isAdmin: true,
    })
    const text = (brief.result as { content: Array<{ text: string }> }).content[0].text
    expect(text).toContain('ticket-1')
    expect(text).toContain('Chat generate failed')
    expect(text).toContain('src/features/chat-shell/')
    expect(text).toContain('Does not auto-call Cursor')
  })

  it('updates ticket status + comment for admins', async () => {
    const updated = await dispatchAdminTool({
      name: 'admin_update_ticket',
      args: { ticketId: 'ticket-1', status: 'in_progress', comment: 'Looking' },
      store: createStore(),
    })
    expect(updated).toMatchObject({
      ticket: { id: 'ticket-1', status: 'in_progress', admin_notes: 'Looking' },
    })
  })

  it('builds a structured Cursor brief from the ticket', () => {
    const brief = buildCursorFixBrief(sampleTicket)
    expect(brief.ticketId).toBe('ticket-1')
    expect(brief.suggestedFiles).toContain('src/features/chat-shell/')
    expect(brief.cursorCloudAgent.urlTemplate).toContain('cursor.com/agents')
    expect(brief.cursorCloudAgent.prompt).toContain('ticket-1')
  })
})
