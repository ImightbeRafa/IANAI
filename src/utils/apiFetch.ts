export class ApiRequestError extends Error {
  status?: number
  data?: unknown

  constructor(message: string, status?: number, data?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.data = data
  }
}

type FetchJsonOptions = {
  timeoutMs?: number
  timeoutMessage?: string
  invalidJsonMessage?: string
  fallbackError?: string
  statusMessages?: Record<number, string>
}

const summarize = (text: string) => {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact
}

const extractErrorMessage = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  for (const key of ['error', 'message', 'details']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string
  }
  return null
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit,
  options: FetchJsonOptions = {}
): Promise<T> {
  const {
    timeoutMs = 0,
    timeoutMessage = 'The request took too long. Please try again.',
    invalidJsonMessage = 'The server returned an invalid response. Please try again.',
    fallbackError = 'Request failed',
    statusMessages = {},
  } = options

  const controller = new AbortController()
  let timedOut = false
  const timeoutId = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    : null

  let response: Response
  try {
    response = await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (timedOut || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new ApiRequestError(timeoutMessage)
    }
    throw err
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  const raw = await response.text()
  let data: unknown = {}

  if (raw.trim()) {
    try {
      data = JSON.parse(raw)
    } catch {
      const message = statusMessages[response.status]
        || `${invalidJsonMessage}${response.ok ? '' : ` (${response.status})`}${raw ? `: ${summarize(raw)}` : ''}`
      throw new ApiRequestError(message, response.status, raw)
    }
  }

  if (!response.ok) {
    const message = statusMessages[response.status]
      || extractErrorMessage(data)
      || `${fallbackError} (${response.status})`
    throw new ApiRequestError(message, response.status, data)
  }

  return data as T
}
