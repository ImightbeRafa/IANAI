import { timingSafeEqual } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isAdminUser, requireAuth } from './lib/auth.js'
import { resolveAdminDashboardAccess } from './lib/preview-admin.js'
import { supabaseAdmin } from './lib/supabase-admin.js'
import {
  buildTicketCreatedPayload,
  parseSinceParam,
  type TicketEventTicket,
} from './lib/ticket-events.js'

const TICKET_SELECT = 'id, subject, description, category, priority, status, user_email, page_url, created_at, user_id'

function bearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

function secretMatches(provided: string, secret: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function webhookSecret(): string {
  return (process.env.TICKETS_WEBHOOK_SECRET || '').trim()
}

function eventWebhookUrl(): string {
  return (process.env.TICKETS_EVENT_WEBHOOK_URL || '').trim()
}

async function deliverOutbound(ticket: TicketEventTicket): Promise<boolean> {
  const url = eventWebhookUrl()
  if (!url) return false
  const secret = webhookSecret()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(buildTicketCreatedPayload(ticket)),
    })
    return response.ok
  } catch (err) {
    console.warn('ticket-events outbound failed', err)
    return false
  }
}

async function authorizePoll(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const token = bearerToken(req)
  const secret = webhookSecret()
  if (secret && token && secretMatches(token, secret)) return true

  const user = await requireAuth(req, res)
  if (!user) return false

  const profileAdmin = await isAdminUser(user.id)
  if (resolveAdminDashboardAccess({ profileIsAdmin: profileAdmin, email: user.email })) {
    return true
  }
  res.status(403).json({ error: 'Forbidden' })
  return false
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabase = supabaseAdmin
  if (!supabase) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  if (req.method === 'GET') {
    const allowed = await authorizePoll(req, res)
    if (!allowed) return

    const since = parseSinceParam(req.query.since)
    const { data, error } = await supabase
      .from('feedback_tickets')
      .select(TICKET_SELECT)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      return res.status(500).json({ error: 'Failed to list tickets', details: error.message })
    }

    const events = (data || []).map((row) => buildTicketCreatedPayload(row as TicketEventTicket))
    return res.status(200).json({ since: since.toISOString(), events })
  }

  if (req.method === 'POST') {
    const user = await requireAuth(req, res)
    if (!user) return

    const ticketId = typeof req.body?.ticketId === 'string' ? req.body.ticketId.trim() : ''
    if (!ticketId) return res.status(400).json({ error: 'ticketId required' })

    const { data, error } = await supabase
      .from('feedback_tickets')
      .select(TICKET_SELECT)
      .eq('id', ticketId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      return res.status(500).json({ error: 'Failed to load ticket', details: error.message })
    }
    if (!data) return res.status(404).json({ error: 'Ticket not found' })

    const payload = buildTicketCreatedPayload(data as TicketEventTicket)
    const delivered = await deliverOutbound(data as TicketEventTicket)
    return res.status(200).json({ ok: true, delivered, event: payload })
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method not allowed' })
}
