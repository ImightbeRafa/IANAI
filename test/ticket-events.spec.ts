import { describe, expect, it } from 'vitest'
import { buildTicketCreatedPayload, parseSinceParam } from '../api/lib/ticket-events'

describe('ticket-events payload', () => {
  it('emits ticket.created with the CoS bot fields', () => {
    expect(buildTicketCreatedPayload({
      id: 't1',
      subject: 'CTA mix',
      description: 'Paso 3 counts',
      category: 'feature',
      priority: 'high',
      status: 'open',
      user_email: 'qa@example.com',
      page_url: '/chat',
      created_at: '2026-09-03T16:00:00.000Z',
    })).toEqual({
      event: 'ticket.created',
      ticket: {
        id: 't1',
        subject: 'CTA mix',
        description: 'Paso 3 counts',
        category: 'feature',
        priority: 'high',
        status: 'open',
        user_email: 'qa@example.com',
        page_url: '/chat',
        created_at: '2026-09-03T16:00:00.000Z',
      },
    })
  })

  it('defaults since to a recent window when the query is missing', () => {
    const since = parseSinceParam(undefined, 15 * 60 * 1000)
    expect(Date.now() - since.getTime()).toBeGreaterThan(14 * 60 * 1000)
    expect(Date.now() - since.getTime()).toBeLessThan(16 * 60 * 1000)
    expect(parseSinceParam('2026-09-03T15:00:00.000Z').toISOString()).toBe('2026-09-03T15:00:00.000Z')
  })
})
