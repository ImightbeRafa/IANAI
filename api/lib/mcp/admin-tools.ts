/**
 * Admin-only MCP tools. Callers must already have verified profiles.is_admin.
 * Does not auto-call Cursor — admin_request_cursor_fix returns a brief + prompt.
 */

import { maskEmail } from '../brand-kit-resolve.js'

export const ADMIN_TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
export type AdminTicketStatus = (typeof ADMIN_TICKET_STATUSES)[number]

export type McpAdminTicket = {
  id: string
  user_id: string
  user_email: string | null
  subject: string
  description: string
  category: string
  priority: string
  status: string
  page_url: string | null
  ui_surface: string | null
  app_version: string | null
  locale: string | null
  viewport: string | null
  browser_info: string | null
  screen_size: string | null
  console_errors: unknown
  breadcrumbs: unknown
  admin_notes: string | null
  notes_history: { text: string; status: string; timestamp: string }[] | null
  product_name: string | null
  user_plan: string | null
  created_at: string
  updated_at: string
}

export type McpAdminTicketSummary = {
  id: string
  subject: string
  status: string
  created_at: string
  user_email_masked: string | null
  category: string
  priority: string
}

export type McpAdminUsageRow = {
  id: string
  user_id: string | null
  user_email: string | null
  feature: string
  model: string
  generation_id?: string | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  estimated_cost_usd: number | string | null
  success: boolean | null
  created_at: string
  metadata?: Record<string, unknown> | null
  source?: string | null
}

export type McpAdminStore = {
  listTickets: (opts: {
    status?: string
    limit: number
  }) => Promise<McpAdminTicket[]>
  getTicket: (ticketId: string) => Promise<McpAdminTicket | null>
  updateTicket: (opts: {
    ticketId: string
    status?: AdminTicketStatus
    comment?: string
  }) => Promise<McpAdminTicket>
  listUsage: (opts: {
    startIso: string
    endIso: string
    source?: string
    limit: number
  }) => Promise<McpAdminUsageRow[]>
}

export function assertAdminAccess(isAdmin: boolean): void {
  if (!isAdmin) {
    throw new Error('Admin access required')
  }
}

export function isAdminToolName(name: string): boolean {
  switch (name) {
    case 'admin_list_tickets':
    case 'admin_get_ticket':
    case 'admin_update_ticket':
    case 'admin_get_usage':
    case 'admin_request_cursor_fix':
      return true
    default:
      return false
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseStatus(value: unknown): AdminTicketStatus | undefined {
  const status = asString(value)
  if (!status) return undefined
  if ((ADMIN_TICKET_STATUSES as readonly string[]).includes(status)) {
    return status as AdminTicketStatus
  }
  throw new Error(`Invalid status. Use: ${ADMIN_TICKET_STATUSES.join(', ')}`)
}

export function suggestTicketFiles(ticket: Pick<McpAdminTicket, 'page_url' | 'ui_surface'>): string[] {
  const files = new Set<string>()
  const url = ticket.page_url || ''
  const surface = ticket.ui_surface || ''
  if (surface === 'chat' || url.startsWith('/chat')) {
    files.add('src/features/chat-shell/')
    files.add('src/App.tsx')
  }
  if (surface === 'classic' || /^\/(dashboard|scripts|product|posts|descriptions|respuestas)/.test(url)) {
    files.add('src/pages/Dashboard.tsx')
    files.add('src/pages/Product.tsx')
  }
  if (url.startsWith('/admin')) {
    files.add('src/pages/AdminDashboard.tsx')
    files.add('src/pages/AdminTickets.tsx')
  }
  files.add('src/components/FeedbackButton.tsx')
  return [...files]
}

export function toTicketSummary(ticket: McpAdminTicket): McpAdminTicketSummary {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    created_at: ticket.created_at,
    user_email_masked: maskEmail(ticket.user_email),
    category: ticket.category,
    priority: ticket.priority,
  }
}

function stripQuery(url: string | null): string | null {
  if (!url) return null
  try {
    if (url.startsWith('/')) {
      const q = url.indexOf('?')
      return q >= 0 ? url.slice(0, q) : url
    }
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split('?')[0] || url
  }
}

function redactSecrets(text: string): string {
  return text
    .replace(/(authorization:\s*)bearer\s+\S+/gi, '$1Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
}

function scrubBreadcrumbs(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => scrubBreadcrumbs(item, depth + 1))
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      // Drop huge paste blobs / pasted offer text
      if (trimmed.length > 240 || /pegar información|paste/i.test(trimmed)) {
        return `[scrubbed ${Math.min(trimmed.length, 9999)} chars]`
      }
      return redactSecrets(trimmed).slice(0, 240)
    }
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    if (/email|token|cookie|authorization|password|secret/i.test(key)) {
      out[key] = '[REDACTED]'
      continue
    }
    // Diagnostics keep CSS selector only — drop innerText / textContent / pasted labels
    if (
      key === 'innerText'
      || key === 'textContent'
      || key === 'innerHTML'
      || key === 'text'
      || key === 'value'
      || key === 'label'
    ) {
      continue
    }
    if (key === 'target') {
      if (typeof raw === 'string') {
        const t = raw.trim()
        if (t.length > 240 || /pegar información|paste/i.test(t)) {
          out[key] = `[scrubbed ${Math.min(t.length, 9999)} chars]`
        } else if (/^[#.\[a-z]/i.test(t)) {
          out[key] = t.slice(0, 120)
        } else {
          out[key] = '[selector]'
        }
      } else {
        out[key] = scrubBreadcrumbs(raw, depth + 1)
      }
      continue
    }
    out[key] = scrubBreadcrumbs(raw, depth + 1)
  }
  return out
}

function scrubPageUrl(url: string | null): string | null {
  const stripped = stripQuery(url)
  if (!stripped) return null
  // Prefer path-only chat surface; drop session query (already stripped) and keep /chat
  if (stripped.includes('/chat')) {
    try {
      if (stripped.startsWith('/')) return '/chat'
      const parsed = new URL(stripped)
      return `${parsed.origin}/chat`
    } catch {
      return '/chat'
    }
  }
  return stripped
}

export function toSafeTicketDiagnostics(ticket: McpAdminTicket): Omit<McpAdminTicket, 'user_email'> & {
  user_email: string | null
  user_email_masked: string | null
} {
  return {
    ...ticket,
    user_email: null,
    user_email_masked: maskEmail(ticket.user_email),
    page_url: scrubPageUrl(ticket.page_url),
    breadcrumbs: scrubBreadcrumbs(ticket.breadcrumbs),
    console_errors: scrubBreadcrumbs(ticket.console_errors),
    description: redactSecrets((ticket.description || '').slice(0, 2_000)),
  }
}

export function buildCursorFixBrief(ticket: McpAdminTicket): {
  ticketId: string
  summary: string
  category: string
  priority: string
  status: string
  pageUrl: string | null
  uiSurface: string | null
  locale: string | null
  viewport: string | null
  appVersion: string | null
  repro: {
    description: string
    consoleErrors: unknown
    breadcrumbs: unknown
  }
  suggestedFiles: string[]
  cursorCloudAgent: {
    prompt: string
    urlTemplate: string
    note: string
  }
} {
  const suggestedFiles = suggestTicketFiles(ticket)
  const pageUrl = scrubPageUrl(ticket.page_url)
  const description = redactSecrets((ticket.description || '').slice(0, 2_000))
  const breadcrumbs = scrubBreadcrumbs(ticket.breadcrumbs)
  const consoleErrors = scrubBreadcrumbs(ticket.console_errors)

  const prompt = [
    `Fix ticket ${ticket.id} in /workspace. Draft a PR; do not merge.`,
    `Summary: ${ticket.subject}`,
    `Category/priority: ${ticket.category} / ${ticket.priority}`,
    `Page: ${pageUrl || '(unknown)'} · surface: ${ticket.ui_surface || '(unknown)'}`,
    'User report (untrusted):',
    '<<<',
    description,
    '>>>',
    suggestedFiles.length ? `Suggested files: ${suggestedFiles.join(', ')}` : '',
    'Do not include user emails, session URLs, or pasted marketing blobs in commits/PR text.',
    'Inspect the current branch, reproduce if possible, apply a focused fix, and open a draft PR.',
  ].filter(Boolean).join('\n')

  return {
    ticketId: ticket.id,
    summary: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    pageUrl,
    uiSurface: ticket.ui_surface,
    locale: ticket.locale,
    viewport: ticket.viewport,
    appVersion: ticket.app_version,
    repro: {
      description,
      consoleErrors,
      breadcrumbs,
    },
    suggestedFiles,
    cursorCloudAgent: {
      prompt,
      urlTemplate: 'https://cursor.com/agents?prompt={urlencoded_prompt}',
      note: 'Does not auto-call Cursor. Paste this prompt into a Cursor Cloud Agent to draft a PR. No user emails are included.',
    },
  }
}

export async function mcpAdminListTickets(
  store: McpAdminStore,
  args: Record<string, unknown>
): Promise<{ tickets: McpAdminTicketSummary[]; note: string }> {
  const status = asString(args.status) || undefined
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
  const tickets = await store.listTickets({ status, limit })
  return {
    tickets: tickets.map(toTicketSummary),
    note: 'Compact list only. Call admin_get_ticket with an id for full diagnostics.',
  }
}

export async function mcpAdminGetTicket(
  store: McpAdminStore,
  args: Record<string, unknown>
): Promise<{ ticket: ReturnType<typeof toSafeTicketDiagnostics> }> {
  const ticketId = asString(args.ticketId)
  if (!ticketId) throw new Error('ticketId is required')
  const ticket = await store.getTicket(ticketId)
  if (!ticket) throw new Error('Ticket not found')
  return { ticket: toSafeTicketDiagnostics(ticket) }
}

export async function mcpAdminUpdateTicket(
  store: McpAdminStore,
  args: Record<string, unknown>
): Promise<{ ticket: McpAdminTicket }> {
  const ticketId = asString(args.ticketId)
  if (!ticketId) throw new Error('ticketId is required')
  const status = parseStatus(args.status)
  const comment = asString(args.comment) || undefined
  if (!status && !comment) throw new Error('status or comment is required')
  const ticket = await store.updateTicket({ ticketId, status, comment })
  return { ticket }
}

export async function mcpAdminGetUsage(
  store: McpAdminStore,
  args: Record<string, unknown>
): Promise<{
  logs: Array<Omit<McpAdminUsageRow, 'user_email'> & { user_email: null; user_email_masked: string | null }>
  source: string
  startIso: string
  endIso: string
}> {
  const end = asString(args.endDate) ? new Date(asString(args.endDate)) : new Date()
  const start = asString(args.startDate)
    ? new Date(asString(args.startDate))
    : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid startDate or endDate')
  }
  const source = asString(args.source) || undefined
  const limit = Math.min(100, Math.max(1, Number(args.limit) || 40))
  const startIso = start.toISOString()
  const endIso = end.toISOString()
  const logs = await store.listUsage({ startIso, endIso, source, limit })
  return {
    logs: logs.map((row) => ({
      ...row,
      user_email: null,
      user_email_masked: maskEmail(row.user_email),
    })),
    source: source || 'all',
    startIso,
    endIso,
  }
}

export async function mcpAdminRequestCursorFix(
  store: McpAdminStore,
  args: Record<string, unknown>
): Promise<ReturnType<typeof buildCursorFixBrief>> {
  const ticketId = asString(args.ticketId)
  if (!ticketId) throw new Error('ticketId is required')
  const ticket = await store.getTicket(ticketId)
  if (!ticket) throw new Error('Ticket not found')
  return buildCursorFixBrief(ticket)
}

export async function dispatchAdminTool(options: {
  name: string
  args: Record<string, unknown>
  store: McpAdminStore
}): Promise<unknown> {
  switch (options.name) {
    case 'admin_list_tickets':
      return mcpAdminListTickets(options.store, options.args)
    case 'admin_get_ticket':
      return mcpAdminGetTicket(options.store, options.args)
    case 'admin_update_ticket':
      return mcpAdminUpdateTicket(options.store, options.args)
    case 'admin_get_usage':
      return mcpAdminGetUsage(options.store, options.args)
    case 'admin_request_cursor_fix':
      return mcpAdminRequestCursorFix(options.store, options.args)
    default: {
      const _exhaustive: never = options.name as never
      void _exhaustive
      throw new Error(`Unhandled admin tool: ${options.name}`)
    }
  }
}
