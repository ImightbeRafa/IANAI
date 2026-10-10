/**
 * Automatic retry with exponential backoff for transient image-provider failures ("The service is temporarily at
 * capacity", 429, 5xx, network resets) inside the MCP job runner. Never surfaced to the user and never charged:
 * credits are only charged after the whole generation succeeds (one charge per approval), so a failed attempt costs
 * nothing and a retried one is charged once.
 */
export const CAPACITY_ERROR_RE = /temporarily at capacity|at capacity|over ?capacity|overloaded|try again shortly|retry your request shortly|service unavailable|bad gateway|gateway time-?out|econnreset|etimedout|socket hang up|fetch failed/i

export function isTransientProviderError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  if (CAPACITY_ERROR_RE.test(message)) return true
  const status = (err as { status?: number } | null)?.status
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true
  return /\b(429|50[0-9])\b/.test(message) && /(grok|xai|provider|image generate)/i.test(message)
}

export type ProviderRetryOptions = {
  /** Total attempts including the first (default 4 → waits ~2 s, 4 s, 8 s). */
  attempts?: number
  baseMs?: number
  maxMs?: number
  sleep?: (ms: number) => Promise<void>
  onRetry?: (info: { attempt: number; delayMs: number; error: string }) => void
}

export type ProviderRetryTrace = { attempts: number; retries: Array<{ attempt: number; delayMs: number; error: string }> }

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Test hook: set `MCP_PROVIDER_RETRY_BASE_MS=0` to skip real waiting. */
function defaultBaseMs(): number {
  const raw = typeof process !== 'undefined' ? process.env?.MCP_PROVIDER_RETRY_BASE_MS : undefined
  const n = raw === undefined ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 2000
}

export async function withProviderRetry<T>(fn: (attempt: number) => Promise<T>, options: ProviderRetryOptions = {}): Promise<{ value: T; trace: ProviderRetryTrace }> {
  const attempts = Math.max(1, options.attempts ?? 4)
  const base = options.baseMs ?? defaultBaseMs()
  const max = options.maxMs ?? 15_000
  const sleep = options.sleep ?? realSleep
  const trace: ProviderRetryTrace = { attempts: 0, retries: [] }
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    trace.attempts = attempt
    try {
      return { value: await fn(attempt), trace }
    } catch (err) {
      lastError = err
      if (attempt >= attempts || !isTransientProviderError(err)) throw err
      const delayMs = Math.min(max, Math.round(base * 2 ** (attempt - 1)))
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 160)
      trace.retries.push({ attempt, delayMs, error })
      options.onRetry?.({ attempt, delayMs, error })
      if (delayMs > 0) await sleep(delayMs)
    }
  }
  throw lastError
}
