import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  approveMcpApprovalRequest,
  createMemoryMcpApprovalStore,
  issueMcpApprovalRequest,
} from '../api/lib/mcp/approval'
import {
  claimMcpExecuteJob,
  getMcpExecuteResult,
  setMcpExecuteScheduler,
  withChargedCredits,
} from '../api/lib/mcp/execute-job'
import { quoteCarouselCredits } from '../api/lib/organic-carousel'
import {
  buildFillOnlyBrandKitPatchWithReview,
  isHighRiskMarketingClaim,
} from '../api/lib/mcp/url-analysis-merge'
import type { SiteAnalysisResult } from '../api/lib/site-analysis'
import { listEnabledMcpTools } from '../api/lib/mcp/tool-registry'
import { toSafeTicketDiagnostics, type McpAdminTicket } from '../api/lib/mcp/admin-tools'
import { buildMcpApprovalRequiredPayload } from '../api/lib/mcp/approval-prompt'

describe('mcp execute async jobs', () => {
  const pendingWorks: Array<() => Promise<void>> = []

  beforeEach(() => {
    pendingWorks.length = 0
    setMcpExecuteScheduler((work) => {
      pendingWorks.push(work)
    })
  })

  afterEach(() => {
    setMcpExecuteScheduler((work) => {
      void work().catch(() => undefined)
    })
  })

  it('lists get_execute_result and claims one job per approval', async () => {
    expect(listEnabledMcpTools().some((t) => t.name === 'get_execute_result')).toBe(true)

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
      expect(first.handle.status).toBe('running')
      expect(first.handle.jobId).toBe(issued.approvalRequestId)
      expect(first.handle.chargedCredits).toBe(0)
    }

    const second = await claimMcpExecuteJob(store, {
      approvalRequestId: issued.approvalRequestId,
      toolName: 'execute_script_generate',
      quotedCreditCost: 3,
    })
    expect(second.claimed).toBe(false)

    const polled = await getMcpExecuteResult({
      approvalStore: store,
      userId: 'user-a',
      jobId: issued.approvalRequestId,
    })
    expect(polled.status).toBe('running')
    expect(polled.chargedCredits).toBe(0)
  })

  it('withChargedCredits always sets numeric chargedCredits', () => {
    const row = withChargedCredits({ status: 'completed', content: 'hola' }, 3, 3)
    expect(row.chargedCredits).toBe(3)
    expect(row.charged).toBe(3)
    expect(row.usage.chargedCredits).toBe(3)
  })
})

describe('carousel preview quote', () => {
  it('quotes 1 slide (24) when previewFirstSlideOnly', () => {
    expect(quoteCarouselCredits(1)).toBe(24)
    expect(quoteCarouselCredits(2)).toBe(48)
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
    expect(payload.quotedCreditCost).toBe(24)
  })
})

describe('url intake high-risk claims', () => {
  it('holds medical/absolute claims out of brand_voice and must_use_phrases', () => {
    expect(isHighRiskMarketingClaim('directo al torrente sanguíneo')).toBe(true)
    expect(isHighRiskMarketingClaim('GLP-1 natural')).toBe(true)
    expect(isHighRiskMarketingClaim('cruelty-free')).toBe(true)
    expect(isHighRiskMarketingClaim('tono cercano y claro')).toBe(false)

    const analysis: SiteAnalysisResult = {
      facts: {
        businessName: 'PatchHouse',
        brand_voice: 'Activa GLP-1 y va directo al torrente sanguíneo',
        must_use_phrases: [
          'sin efectos secundarios',
          'envío a todo Costa Rica',
          'cruelty-free',
        ],
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
    expect(merge.heldForReview.brand_voice).toMatch(/GLP-1/i)
    expect(merge.patch.must_use_phrases).toEqual(['envío a todo Costa Rica'])
    expect(merge.heldForReview.must_use_phrases).toEqual(
      expect.arrayContaining(['sin efectos secundarios', 'cruelty-free'])
    )
    expect(merge.patch.tagline).toBe('Parches que ayudan')
  })
})

describe('admin ticket/usage PII scrub', () => {
  it('masks email, strips session query, drops innerText from breadcrumbs', () => {
    const ticket: McpAdminTicket = {
      id: 't1',
      user_id: 'u1',
      user_email: 'ryan@example.com',
      subject: 'Bug',
      description: 'fail',
      category: 'bug',
      priority: 'high',
      status: 'open',
      page_url: '/chat?session=abc&brand=b1',
      ui_surface: 'chat',
      app_version: '0.1.7',
      locale: 'es',
      viewport: 'desktop',
      browser_info: 'Mozilla',
      screen_size: '1x1',
      console_errors: [],
      breadcrumbs: [
        {
          type: 'click',
          target: 'button.generate',
          innerText: 'Generar ahora con oferta secreta',
          text: 'should drop',
        },
      ],
      admin_notes: null,
      notes_history: [],
      product_name: null,
      user_plan: null,
      created_at: '2026-08-25T00:00:00.000Z',
      updated_at: '2026-08-25T00:00:00.000Z',
    }
    const safe = toSafeTicketDiagnostics(ticket)
    expect(safe.user_email).toBeNull()
    expect(safe.user_email_masked).toBe('ry***@example.com')
    expect(safe.page_url).toBe('/chat')
    const crumb = (safe.breadcrumbs as Array<Record<string, unknown>>)[0]
    expect(crumb.target).toBe('button.generate')
    expect(crumb.innerText).toBeUndefined()
    expect(crumb.text).toBeUndefined()
  })
})

// silence unused vi in case of future spies
void vi
