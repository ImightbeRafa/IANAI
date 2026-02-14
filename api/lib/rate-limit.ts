/**
 * Simple in-memory per-user rate limiter for Vercel serverless functions.
 * 
 * Uses a sliding window approach. Each user gets a generous allowance
 * that won't affect normal usage but prevents rapid-fire abuse.
 * 
 * Note: In serverless, each cold start gets a fresh map. This is acceptable
 * because it only needs to prevent burst abuse within a single instance lifetime.
 * Plan-based monthly limits (checkUsageLimit) handle the real enforcement.
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const userRequests = new Map<string, RateLimitEntry>()

// Clean up old entries periodically to prevent memory leaks
const CLEANUP_INTERVAL = 60_000 // 1 minute
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of userRequests) {
    if (now > entry.resetAt) {
      userRequests.delete(key)
    }
  }
}

export interface RateLimitConfig {
  /** Max requests per window. Default: 20 */
  maxRequests?: number
  /** Window duration in seconds. Default: 60 */
  windowSeconds?: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetInSeconds: number
}

/**
 * Check if a user is within their rate limit.
 * Returns { allowed, remaining, resetInSeconds }
 * 
 * Default: 20 requests per 60 seconds — very generous for normal use.
 * A user sending a script every 3 seconds is already unusually fast.
 */
export function checkRateLimit(
  userId: string,
  config: RateLimitConfig = {}
): RateLimitResult {
  const { maxRequests = 20, windowSeconds = 60 } = config
  const now = Date.now()
  const windowMs = windowSeconds * 1000

  cleanup()

  const key = userId
  const entry = userRequests.get(key)

  if (!entry || now > entry.resetAt) {
    // New window
    userRequests.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1, resetInSeconds: windowSeconds }
  }

  if (entry.count >= maxRequests) {
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, remaining: 0, resetInSeconds }
  }

  entry.count++
  const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000)
  return { allowed: true, remaining: maxRequests - entry.count, resetInSeconds }
}
