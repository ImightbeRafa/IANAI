import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  approveMcpApprovalRequest,
  consumeMcpApprovalRequest,
  createMemoryMcpApprovalStore,
  issueMcpApprovalRequest,
  storeMcpApprovalResult,
} from '../api/lib/mcp/approval'
import {
  asJobHandleFromStored,
  claimMcpExecuteJob,
  getMcpExecuteResult,
  isFailedExecuteJob,
  isReclaimableExecuteJob,
  isStaleRunningJob,
  MCP_EXECUTE_STALE_MS,
  setMcpExecuteScheduler,
  shouldReplayStoredExecuteResult,
  withChargedCredits,
} from '../api/lib/mcp/execute-job'
import { MCP_HOST_MAX_DURATION_SEC, quoteCarouselCredits } from '../api/lib/organic-carousel'
import {
  buildFillOnlyBrandKitPatchWithReview,
  isHighRiskMarketingClaim,
} from '../api/lib/mcp/url-analysis-merge'
import type { SiteAnalysisResult } from '../api/lib/site-analysis'
import { listEnabledMcpTools } from '../api/lib/mcp/tool-registry'
import {
  dispatchAdminTool,
  toSafeTicketDiagnostics,
  type McpAdminStore,
  type McpAdminTicket,
} from '../api/lib/mcp/admin-tools'
import { buildMcpApprovalRequiredPayload } from '../api/lib/mcp/approval-prompt'

describe('mcp execute async jobs', () => {
  beforeEach(() => {
    setMcpExecuteScheduler((work) => {
      void work().catch(() => undefined)
    })
  })

  afterEach(() => {
    setMcpExecuteScheduler((work) => {
      void work().catch(() => undefined)
    })
  })

  it('lists get_execute_result; stale TTL exceeds host maxDuration', () => {
    expect(listEnabledMcpTools().some((t) => t.name === 'get_execute_result')).toBe(true)
    expect(MCP_EXECUTE_STALE_MS).toBeGreaterThan(MCP_HOST_MAX_DURATION_SEC * 1000)
  })

  it('claims one job per approval while fresh running', async () => {
    const store = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input: { brandId: 'b1', offerId: 'o1' },
      quotedCreditCost: 3,
    })
    await approveMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
    })

    const first = await claimMcpExecuteJob(store, {
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_script_generate',
      quotedCreditCost: 3,
    })
    expect(first.claimed).toBe(true)
    if (first.claimed) {
      expect(first.handle.statusMessage).toMatch(/Advance está generando|Advance is generating/)
    }

    const second = await claimMcpExecuteJob(store, {
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_script_generate',
      quotedCreditCost: 3,
    })
    expect(second.claimed).toBe(false)
    expect(shouldReplayStoredExecuteResult(second.existing)).toBe(true)
  })

  it('SD-01: stale running is not replayable and can CAS-reclaim for retry', async () => {
    const store = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_image_generate',
      input: { brandId: 'b1' },
      quotedCreditCost: 6,
    })
    await approveMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
    })

    const startedAtMs = Date.now() - MCP_EXECUTE_STALE_MS - 1_000
    await store.storeResult(issued.approvalRequestId, {
      status: 'running',
      jobId: issued.approvalRequestId,
      approvalRequestId: issued.approvalRequestId,
      chargedCredits: 0,
      startedAtMs,
    }, startedAtMs)

    expect(isStaleRunningJob(
      (await store.findById(issued.approvalRequestId))!.resultJson,
      Date.now()
    )).toBe(true)
    expect(shouldReplayStoredExecuteResult(
      (await store.findById(issued.approvalRequestId))!.resultJson
    )).toBe(false)

    const reclaim = await claimMcpExecuteJob(store, {
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_image_generate',
      quotedCreditCost: 6,
    })
    expect(reclaim.claimed).toBe(true)
    if (reclaim.claimed) {
      expect(reclaim.handle.status).toBe('running')
      expect(reclaim.handle.startedAtMs).toBeGreaterThan(startedAtMs)
    }
  })

  it('failed stays reusable (not terminal; no consume required)', async () => {
    const store = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input: { brandId: 'b1' },
      quotedCreditCost: 3,
    })
    await approveMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
    })

    await storeMcpApprovalResult(store, {
      approvalRequestId: issued.approvalRequestId,
      result: {
        status: 'failed',
        jobId: issued.approvalRequestId,
        error: 'provider timeout',
        chargedCredits: 0,
      },
    })

    const row = await store.findById(issued.approvalRequestId)
    expect(row?.status).toBe('approved') // not consumed
    expect(isFailedExecuteJob(row!.resultJson)).toBe(true)
    expect(isReclaimableExecuteJob(row!.resultJson)).toBe(true)
    expect(shouldReplayStoredExecuteResult(row!.resultJson)).toBe(false)

    const retry = await claimMcpExecuteJob(store, {
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_script_generate',
      quotedCreditCost: 3,
    })
    expect(retry.claimed).toBe(true)
  })

  it('completed payload replays with numeric chargedCredits; consume-after-store', async () => {
    const store = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(store, {
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input: { brandId: 'b1' },
      quotedCreditCost: 3,
    })
    await approveMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
    })

    const completed = withChargedCredits({
      status: 'completed',
      jobId: issued.approvalRequestId,
      approvalRequestId: issued.approvalRequestId,
      content: 'Guion listo',
    }, 3, 3)

    // store while approved, then consume (production finalize order)
    await storeMcpApprovalResult(store, {
      approvalRequestId: issued.approvalRequestId,
      result: completed,
    })
    const consumed = await consumeMcpApprovalRequest(store, {
      approvalRequestId: issued.approvalRequestId,
      userId: 'user-a',
      toolName: 'execute_script_generate',
      input: { brandId: 'b1' },
    })
    expect(consumed.ok).toBe(true)

    const formatted = asJobHandleFromStored(issued.approvalRequestId, completed)
    expect(formatted).toMatchObject({ status: 'completed', chargedCredits: 3, content: 'Guion listo' })
    expect(shouldReplayStoredExecuteResult(completed)).toBe(true)

    const claimAfter = await claimMcpExecuteJob(store, {
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_script_generate',
      quotedCreditCost: 3,
    })
    expect(claimAfter.claimed).toBe(false)

    const polled = await getMcpExecuteResult({
      approvalStore: store,
      userId: 'user-a',
      jobId: issued.approvalRequestId,
    })
    expect(polled.status).toBe('completed')
    expect(polled.statusMessage).toMatch(/Advance terminó|Advance finished/)
    expect(polled.chargedCredits).toBe(3)
    expect(polled.content).toBe('Guion listo')
  })
})

describe('carousel preview quote', () => {
  it('quotes 1 slide (24) when previewFirstSlideOnly', () => {
    expect(quoteCarouselCredits(1)).toBe(24)
    const payload = buildMcpApprovalRequiredPayload({
      approvalRequestId: 'req',
      expiresAtMs: 1,
      deepLink: 'https://advanceai.studio/mcp/approve/req',
      toolName: 'execute_carousel_generate',
      quotedCreditCost: 24,
      language: 'es',
      summaryEs: 'Generar carrusel (1 slide preview / 24 créditos)',
    })
    expect(String(payload.userPrompt)).toContain('1 slide preview / 24 créditos')
  })
})

describe('url intake high-risk claims', () => {
  it('holds medical/absolute claims out of brand_voice and must_use_phrases', () => {
    expect(isHighRiskMarketingClaim('directo al torrente sanguíneo')).toBe(true)
    const analysis: SiteAnalysisResult = {
      facts: {
        businessName: 'PatchHouse',
        brand_voice: 'Activa GLP-1 y va directo al torrente sanguíneo',
        must_use_phrases: ['sin efectos secundarios', 'envío a todo Costa Rica', 'cruelty-free'],
        tagline: 'Parches que ayudan',
      },
      evidence: {},
      pages: [],
      assets: {
        logoCandidates: [],
        faviconCandidates: [],
        imageCandidates: [],
        colors: [],
        fonts: [],
      },
      warnings: [],
    }
    const merge = buildFillOnlyBrandKitPatchWithReview(null, analysis, 'Fallback')
    expect(merge.reviewRequired).toBe(true)
    expect(merge.patch.brand_voice).toBeUndefined()
    expect(merge.patch.must_use_phrases).toEqual(['envío a todo Costa Rica'])
  })
})

describe('admin ticket/usage PII scrub', () => {
  const sampleTicket: McpAdminTicket = {
    id: 't1',
    user_id: 'u1',
    user_email: 'ryan@example.com',
    subject: 'Bug',
    description: 'fail',
    category: 'bug',
    priority: 'high',
    status: 'open',
    page_url: '/product/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/session/11111111-2222-3333-4444-555555555555',
    ui_surface: 'classic',
    app_version: '0.1.7',
    locale: 'es',
    viewport: 'desktop',
    browser_info: 'Mozilla',
    screen_size: '1x1',
    console_errors: [],
    breadcrumbs: [
      {
        type: 'click',
        target: 'button.generate "Generar ahora"',
        innerText: 'Generar ahora con oferta secreta',
        text: 'should drop',
        url: '/chat?session=abc&brand=b1',
        href: 'https://advanceai.studio/product/x?session=zzz',
      },
    ],
    admin_notes: null,
    notes_history: [],
    product_name: null,
    user_plan: null,
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: '2026-08-25T00:00:00.000Z',
  }

  it('masks email, redacts session paths, selector-only target, strips url/href query', () => {
    const safe = toSafeTicketDiagnostics({
      ...sampleTicket,
      page_url: '/chat?session=abc&brand=b1',
    })
    expect(safe.user_email).toBeNull()
    expect(safe.user_email_masked).toBe('ry***@example.com')
    expect(safe.page_url).toBe('/chat')

    const classic = toSafeTicketDiagnostics(sampleTicket)
    expect(classic.page_url).toBe('/product/[id]/session/[id]')

    const crumb = (classic.breadcrumbs as Array<Record<string, unknown>>)[0]
    expect(crumb.target).toBe('button.generate')
    expect(crumb.innerText).toBeUndefined()
    expect(crumb.text).toBeUndefined()
    expect(crumb.url).toBe('/chat')
    expect(String(crumb.href)).not.toContain('session=')
  })

  it('admin_update_ticket returns scrubbed ticket (no raw user_email)', async () => {
    let current = { ...sampleTicket }
    const store: McpAdminStore = {
      async listTickets() {
        return [current]
      },
      async getTicket(id) {
        return id === current.id ? current : null
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
        return []
      },
    }

    const updated = await dispatchAdminTool({
      name: 'admin_update_ticket',
      args: { ticketId: 't1', status: 'in_progress', comment: 'looking' },
      store,
    }) as { ticket: ReturnType<typeof toSafeTicketDiagnostics> }

    expect(updated.ticket.user_email).toBeNull()
    expect(updated.ticket.user_email_masked).toBe('ry***@example.com')
    expect(updated.ticket.status).toBe('in_progress')
    expect(updated.ticket.page_url).toBe('/product/[id]/session/[id]')
  })
})
