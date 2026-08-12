import type { ChatSession } from '../../types'

export const SIDEBAR_SESSION_TITLE_MAX = 40
export const SIDEBAR_SESSION_VISIBLE_CAP = 12

export function brandOpenStorageKey(businessId: string): string {
  return `ianai.sidebar.brandOpen.${businessId}`
}

export function readBrandOpen(
  storage: { getItem(key: string): string | null } | null | undefined,
  businessId: string
): boolean | null {
  if (!storage || !businessId) return null
  try {
    const raw = storage.getItem(brandOpenStorageKey(businessId))
    if (raw === '1' || raw === 'true') return true
    if (raw === '0' || raw === 'false') return false
    return null
  } catch {
    return null
  }
}

export function writeBrandOpen(
  storage: { setItem?(key: string, value: string): void } | null | undefined,
  businessId: string,
  open: boolean
): void {
  if (!storage?.setItem || !businessId) return
  try {
    storage.setItem(brandOpenStorageKey(businessId), open ? '1' : '0')
  } catch {
    /* ignore quota */
  }
}

/** Default / spam titles that should not win over first message or relative time. */
export function isDefaultSessionTitle(title?: string | null): boolean {
  const t = (title || '').trim()
  if (!t) return true
  if (/^untitled$/i.test(t)) return true
  if (/^new\s+(chat|session)$/i.test(t)) return true
  if (/^session\s*[·•.\-–—]/i.test(t)) return true
  if (/^quick\s*[·•.\-–—]/i.test(t)) return true
  return false
}

export function truncateSidebarTitle(
  text: string,
  max = SIDEBAR_SESSION_TITLE_MAX
): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max - 1)
  const cut = slice.replace(/\s+\S*$/, '').trimEnd() || slice.trimEnd()
  return `${cut}…`
}

export function formatRelativeSessionTime(
  iso: string | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!iso) return 'Chat'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Chat'
  const startOfToday = new Date(nowMs)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfThat = new Date(then)
  startOfThat.setHours(0, 0, 0, 0)
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfThat.getTime()) / (24 * 60 * 60 * 1000)
  )
  if (dayDiff === 0) {
    return `Today ${then.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`
  }
  if (dayDiff === 1) return 'Yesterday'
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Prefer stored non-default title → first user message → relative time.
 * Never surfaces "Session · …" spam as the primary label.
 */
export function resolveSessionSidebarTitle(options: {
  session: Pick<ChatSession, 'title' | 'updated_at' | 'created_at'>
  firstUserMessage?: string | null
  nowMs?: number
}): { label: string; fullTitle: string } {
  const { session, firstUserMessage, nowMs } = options
  const stored = (session.title || '').trim()
  if (!isDefaultSessionTitle(stored)) {
    return {
      label: truncateSidebarTitle(stored),
      fullTitle: stored,
    }
  }
  const preview = (firstUserMessage || '').trim()
  if (preview) {
    const label = truncateSidebarTitle(preview)
    return { label, fullTitle: preview }
  }
  const when = formatRelativeSessionTime(
    session.updated_at || session.created_at,
    nowMs
  )
  return { label: when, fullTitle: when }
}
