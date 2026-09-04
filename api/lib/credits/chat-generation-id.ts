import { randomUUID } from 'node:crypto'
import { isUuid } from './generation-id.js'

export type ChatGenerationIdResult =
  | { ok: true; generationId: string }
  | { ok: false; error: string }

/**
 * Chat-shell (sessionId present): client must mint generationId per Generar.
 * Server must not mint — a retry/curl would get a fresh id and double-charge.
 * Classic /scripts callers omit sessionId; accept a client UUID or mint one.
 */
export function resolveChatGenerationId(options: {
  sessionBound: boolean
  incoming: unknown
}): ChatGenerationIdResult {
  const incoming = typeof options.incoming === 'string' ? options.incoming.trim() : ''
  const valid = isUuid(incoming)
  if (options.sessionBound) {
    if (!valid) return { ok: false, error: 'generationId is required' }
    return { ok: true, generationId: incoming }
  }
  if (valid) return { ok: true, generationId: incoming }
  return { ok: true, generationId: randomUUID() }
}
