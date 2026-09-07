export interface TicketEventTicket {
  id: string
  subject?: string | null
  description?: string | null
  category?: string | null
  priority?: string | null
  status?: string | null
  user_email?: string | null
  page_url?: string | null
  created_at?: string | null
}

export interface TicketCreatedPayload {
  event: 'ticket.created'
  ticket: {
    id: string
    subject: string
    description: string
    category: string
    priority: string
    status: string
    user_email: string | null
    page_url: string | null
    created_at: string | null
  }
}

export function buildTicketCreatedPayload(ticket: TicketEventTicket): TicketCreatedPayload {
  return {
    event: 'ticket.created',
    ticket: {
      id: String(ticket.id),
      subject: String(ticket.subject || ''),
      description: String(ticket.description || ''),
      category: String(ticket.category || 'other'),
      priority: String(ticket.priority || 'medium'),
      status: String(ticket.status || 'open'),
      user_email: ticket.user_email || null,
      page_url: ticket.page_url || null,
      created_at: ticket.created_at || null,
    },
  }
}

export function parseSinceParam(value: unknown, fallbackMs = 15 * 60 * 1000): Date {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date(Date.now() - fallbackMs)
}
