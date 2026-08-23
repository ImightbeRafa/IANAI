/**
 * One-shot MCP deep-link intake (`?intake=files|asset|uuid`).
 * Captured into sessionStorage so workspace URL sync (brand/session only) cannot drop it.
 */

export const CHAT_SHELL_MCP_INTAKE_KEY = 'ianai.chat-shell.mcpIntake'

export type ChatShellMcpIntakeMode = 'files' | 'asset' | 'url_status'

export type ChatShellMcpIntakeIntent = {
  mode: ChatShellMcpIntakeMode
  /** Original intake query value (files | asset | uuid). */
  raw: string
  /** Optional request/intake row id from MCP. */
  requestId: string | null
  brandId: string | null
  capturedAtMs: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseMcpIntakeValue(raw: string | null | undefined): ChatShellMcpIntakeMode | null {
  if (!raw) return null
  const value = raw.trim()
  if (value === 'files' || value === 'asset') return value
  if (UUID_RE.test(value)) return 'url_status'
  return null
}

export function readStoredMcpIntake(): ChatShellMcpIntakeIntent | null {
  try {
    const raw = sessionStorage.getItem(CHAT_SHELL_MCP_INTAKE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ChatShellMcpIntakeIntent
    if (!parsed?.mode || !parsed?.raw) return null
    return parsed
  } catch {
    return null
  }
}

export function clearStoredMcpIntake(): void {
  try {
    sessionStorage.removeItem(CHAT_SHELL_MCP_INTAKE_KEY)
  } catch {
    // ignore
  }
}

export function storeMcpIntake(intent: ChatShellMcpIntakeIntent): void {
  try {
    sessionStorage.setItem(CHAT_SHELL_MCP_INTAKE_KEY, JSON.stringify(intent))
  } catch {
    // ignore
  }
}

/**
 * Capture intake from the current URL once (or return prior sessionStorage intent).
 * Strips `intake` / `request` from the address bar so brand/session sync stays clean.
 */
export function captureMcpIntakeFromUrl(options?: {
  search?: string
  brandId?: string | null
  replaceUrl?: boolean
}): ChatShellMcpIntakeIntent | null {
  const existing = readStoredMcpIntake()
  let params: URLSearchParams
  try {
    params = new URLSearchParams(options?.search ?? window.location.search)
  } catch {
    return existing
  }

  const raw = params.get('intake')
  const mode = parseMcpIntakeValue(raw)
  if (!mode || !raw) return existing

  const intent: ChatShellMcpIntakeIntent = {
    mode,
    raw,
    requestId: params.get('request') || (mode === 'url_status' ? raw : null),
    brandId: options?.brandId || params.get('brand') || null,
    capturedAtMs: Date.now(),
  }
  storeMcpIntake(intent)

  if (options?.replaceUrl !== false) {
    params.delete('intake')
    params.delete('request')
    const qs = params.toString()
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`
    try {
      window.history.replaceState(window.history.state, '', next)
    } catch {
      // ignore
    }
  }

  return intent
}

export function isAllowedMcpIntakeFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  if (mime === 'application/pdf') return true
  if (mime.startsWith('image/')) return true
  const name = file.name.toLowerCase()
  return /\.(pdf|png|jpe?g|webp|gif)$/i.test(name)
}

export function partitionMcpIntakeFiles(files: File[]): {
  images: File[]
  pdfs: File[]
  rejected: File[]
} {
  const images: File[] = []
  const pdfs: File[] = []
  const rejected: File[] = []
  for (const file of files) {
    const mime = (file.type || '').toLowerCase()
    if (mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      pdfs.push(file)
    } else if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      images.push(file)
    } else {
      rejected.push(file)
    }
  }
  return { images, pdfs, rejected }
}
