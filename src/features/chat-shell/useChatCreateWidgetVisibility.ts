import { useCallback, useMemo, useState } from 'react'

export function createWidgetHiddenStorageKey(userId: string, businessId: string): string {
  return `ianai.chat-shell.createWidget.hidden.${userId}.${businessId}`
}

export function readCreateWidgetHidden(
  storage: Storage | null,
  userId: string,
  businessId: string | null | undefined
): boolean {
  if (!storage || !userId || !businessId) return false
  try {
    return storage.getItem(createWidgetHiddenStorageKey(userId, businessId)) === '1'
  } catch {
    return false
  }
}

export function writeCreateWidgetHidden(
  storage: Storage | null,
  userId: string,
  businessId: string | null | undefined,
  hidden: boolean
): void {
  if (!storage || !userId || !businessId) return
  try {
    const key = createWidgetHiddenStorageKey(userId, businessId)
    if (hidden) storage.setItem(key, '1')
    else storage.removeItem(key)
  } catch {
    /* quota / private mode */
  }
}

export function isCreateWidgetAvailable(options: {
  sessionId?: string | null
  offerName?: string | null
}): boolean {
  return Boolean(options.sessionId && (options.offerName || '').trim())
}

export function useChatCreateWidgetVisibility(options: {
  userId: string
  businessId: string | null | undefined
  sessionId: string | null | undefined
  offerName: string | null | undefined
}) {
  const storage = typeof localStorage !== 'undefined' ? localStorage : null
  const { userId, businessId, sessionId, offerName } = options
  const [tick, setTick] = useState(0)
  const available = isCreateWidgetAvailable({ sessionId, offerName })
  const hidden = useMemo(
    () => readCreateWidgetHidden(storage, userId, businessId),
    [storage, userId, businessId, tick]
  )
  const visible = available && !hidden

  const hide = useCallback(() => {
    writeCreateWidgetHidden(storage, userId, businessId, true)
    setTick((n) => n + 1)
  }, [storage, userId, businessId])

  const show = useCallback(() => {
    writeCreateWidgetHidden(storage, userId, businessId, false)
    setTick((n) => n + 1)
  }, [storage, userId, businessId])

  return { available, hidden, visible, hide, show }
}
