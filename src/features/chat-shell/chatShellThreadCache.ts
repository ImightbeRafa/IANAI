import type { ChatSessionOffer, Message, Product } from '../../types'
import type { ProductImage } from '../../services/database'

export interface CachedThread {
  messages: Message[]
  offers: ChatSessionOffer[]
  activeProduct: Product | null
  offerImages: ProductImage[]
}

const MAX_CACHED_THREADS = 24

export function readThreadCache(
  cache: Map<string, CachedThread>,
  sessionId: string | null
): CachedThread | null {
  if (!sessionId) return null
  return cache.get(sessionId) ?? null
}

export function writeThreadCache(
  cache: Map<string, CachedThread>,
  sessionId: string | null,
  snapshot: CachedThread
): void {
  if (!sessionId) return
  cache.set(sessionId, snapshot)
  while (cache.size > MAX_CACHED_THREADS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined || oldest === sessionId) break
    cache.delete(oldest)
  }
}

export function emptyThreadSnapshot(): CachedThread {
  return {
    messages: [],
    offers: [],
    activeProduct: null,
    offerImages: [],
  }
}

export function upsertMessage(messages: Message[], incoming: Message): Message[] {
  const index = messages.findIndex((row) => row.id === incoming.id)
  if (index < 0) return [...messages, incoming]
  const next = [...messages]
  const prev = next[index]
  next[index] = {
    ...prev,
    ...incoming,
    artifacts: incoming.artifacts?.length ? incoming.artifacts : prev.artifacts,
  }
  return next
}

export function replaceOptimisticMessage(
  messages: Message[],
  optimisticId: string,
  saved: Message
): Message[] {
  const withoutSavedDup = messages.filter((row) => row.id !== saved.id || row.id === optimisticId)
  return withoutSavedDup.map((row) => (row.id === optimisticId ? saved : row))
}

/** Keep optimistic / just-saved local rows when a fetch is late or incomplete. */
export function mergeFetchedMessages(local: Message[], fetched: Message[]): Message[] {
  const fetchedIds = new Set(fetched.map((row) => row.id))
  const byId = new Map(fetched.map((row) => [row.id, row]))
  for (const row of local) {
    if (!fetchedIds.has(row.id)) continue
    const incoming = byId.get(row.id)
    if (!incoming) continue
    if ((row.artifacts?.length ?? 0) > 0 && !(incoming.artifacts?.length)) {
      byId.set(row.id, { ...incoming, artifacts: row.artifacts })
    }
  }
  const extras = local.filter((row) => !fetchedIds.has(row.id))
  return [...fetched.map((row) => byId.get(row.id) || row), ...extras]
}
