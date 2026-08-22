import { useEffect, useState } from 'react'
import type { ChatSession, Script } from '../../types'
import {
  getProductPostsPaginated,
  getScriptsBySession,
  type PostListItem,
} from '../../services/database'
import type { RailTab } from './ChatContextRail'

/**
 * Lazy-load classic Guiones (scripts.session_id) and Posts (product posts)
 * when the chat-shell rail opens those tabs — no fake artifacts/messages.
 */
export function useClassicSessionLibrary(
  session: ChatSession | null | undefined,
  tab: RailTab,
  enabled: boolean
) {
  const [classicScripts, setClassicScripts] = useState<Script[]>([])
  const [classicPosts, setClassicPosts] = useState<PostListItem[]>([])
  const [loadingScripts, setLoadingScripts] = useState(false)
  const [loadingPosts, setLoadingPosts] = useState(false)

  const sessionId = session?.id ?? null
  const productId = session?.product_id ?? null

  useEffect(() => {
    if (!enabled || !sessionId || tab !== 'scripts') return
    let cancelled = false
    setLoadingScripts(true)
    void getScriptsBySession(sessionId)
      .then((rows) => {
        if (!cancelled) setClassicScripts(rows)
      })
      .catch((err) => {
        console.warn('Classic scripts load failed:', err)
        if (!cancelled) setClassicScripts([])
      })
      .finally(() => {
        if (!cancelled) setLoadingScripts(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, sessionId, tab])

  useEffect(() => {
    if (!enabled || !productId || tab !== 'images') return
    let cancelled = false
    setLoadingPosts(true)
    void getProductPostsPaginated(productId, 20, 0)
      .then((result) => {
        if (!cancelled) setClassicPosts(result.posts)
      })
      .catch((err) => {
        console.warn('Classic posts load failed:', err)
        if (!cancelled) setClassicPosts([])
      })
      .finally(() => {
        if (!cancelled) setLoadingPosts(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, productId, tab])

  useEffect(() => {
    if (!sessionId) setClassicScripts([])
    if (!productId) setClassicPosts([])
  }, [sessionId, productId])

  return {
    classicScripts,
    classicPosts,
    loadingScripts,
    loadingPosts,
  }
}
