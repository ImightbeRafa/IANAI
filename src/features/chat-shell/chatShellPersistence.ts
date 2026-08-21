export const CHAT_SHELL_ACTIVE_BRAND_KEY = 'ianai.chat-shell.activeBrandId'
export const CHAT_SHELL_ACTIVE_SESSION_KEY = 'ianai.chat-shell.activeSessionId'

export interface ChatShellSelection {
  brandId: string | null
  sessionId: string | null
}

export function readStoredSelection(): ChatShellSelection {
  try {
    return {
      brandId: localStorage.getItem(CHAT_SHELL_ACTIVE_BRAND_KEY),
      sessionId: localStorage.getItem(CHAT_SHELL_ACTIVE_SESSION_KEY),
    }
  } catch {
    return { brandId: null, sessionId: null }
  }
}

export function persistSelection(selection: ChatShellSelection): void {
  try {
    if (selection.brandId) {
      localStorage.setItem(CHAT_SHELL_ACTIVE_BRAND_KEY, selection.brandId)
    } else {
      localStorage.removeItem(CHAT_SHELL_ACTIVE_BRAND_KEY)
    }
    if (selection.sessionId) {
      localStorage.setItem(CHAT_SHELL_ACTIVE_SESSION_KEY, selection.sessionId)
    } else {
      localStorage.removeItem(CHAT_SHELL_ACTIVE_SESSION_KEY)
    }
  } catch {
    // ignore quota / private mode
  }
}

export function selectionFromSearchParams(params: URLSearchParams): ChatShellSelection {
  const brandId = params.get('brand')
  const sessionId = params.get('session')
  return {
    brandId: brandId && brandId.length > 0 ? brandId : null,
    sessionId: sessionId && sessionId.length > 0 ? sessionId : null,
  }
}

export function selectionToSearchParams(selection: ChatShellSelection): URLSearchParams {
  const params = new URLSearchParams()
  if (selection.brandId) params.set('brand', selection.brandId)
  if (selection.sessionId) params.set('session', selection.sessionId)
  return params
}

/**
 * Prefer URL params, then localStorage.
 * URL session id is authoritative and must never be dropped because of a
 * missing/mismatched brand — brand may be provisional until touch-load.
 * Do not pair a URL brand with an unrelated stored session.
 */
export function resolveInitialSelection(
  urlSelection: ChatShellSelection,
  storedSelection: ChatShellSelection
): ChatShellSelection {
  const brandId = urlSelection.brandId || storedSelection.brandId || null

  if (urlSelection.sessionId) {
    // URL session always wins — never erase deep-link intent for brand mismatch.
    return { brandId, sessionId: urlSelection.sessionId }
  }

  if (storedSelection.sessionId) {
    // Stored session only when brand matches the resolved brand (same brand pair).
    const storedBrandOk =
      !storedSelection.brandId
      || storedSelection.brandId === brandId
    if (storedBrandOk && (!urlSelection.brandId || urlSelection.brandId === storedSelection.brandId)) {
      return { brandId, sessionId: storedSelection.sessionId }
    }
  }

  return { brandId, sessionId: null }
}
