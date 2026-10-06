// Cloudflare Access JWT verification for the Worker's preview gate.
//
// No `cloudflare:*` imports (so this is unit-testable outside a Worker
// runtime) and no new dependency — WebCrypto (`crypto.subtle`) only, since
// pulling in `jose`/`jsonwebtoken` for ~100 lines of RS256 verification
// isn't worth it.
//
// Fails closed everywhere: a missing/malformed header, an unverifiable
// signature, a JWKS fetch failure, unset/placeholder env vars, or a
// non-allowlisted email all return `false`. There is deliberately no
// bypass header, token, or env override — a valid Cloudflare Access JWT is
// the only way through.

const CLOCK_SKEW_SECONDS = 60

// Hardcoded allowlist, exported so it's visible in review and in tests.
// Case-insensitive match against the JWT's `email` claim.
export const ACCESS_ALLOWED_EMAILS = Object.freeze(['rafa04128@gmail.com', 'rafaeser@gmail.com'])

export interface AccessJwtEnv {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface AccessJwtVerifyDeps {
  fetchImpl?: FetchLike
  /** Current time in ms since epoch. Defaults to Date.now(); injectable for exp/nbf tests. */
  now?: () => number
}

interface Jwk {
  kid?: string
  [key: string]: unknown
}

// Module-level JWKS cache, keyed by team domain. Real deployments only ever
// use one team domain, but keying by it (rather than a single slot) keeps
// tests from stepping on each other when they use different domains.
const jwksCache = new Map<string, Map<string, CryptoKey>>()

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Manual base64url decode (no `atob`) so this works identically under
// Node (tests) and the Workers runtime without relying on a DOM lib.
function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of base64) {
    if (char === '=') break
    const value = BASE64_CHARS.indexOf(char)
    if (value === -1) throw new Error('invalid base64url character')
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

function base64UrlDecodeJson(segment: string): any {
  const bytes = base64UrlToBytes(segment)
  const text = new TextDecoder().decode(bytes)
  return JSON.parse(text)
}

// Treat unset, empty, or still-templated values ("REPLACE_WITH_...") as
// unconfigured. No network call happens when either var is unconfigured.
function isUnconfigured(value: string | undefined): boolean {
  return !value || value.trim() === '' || value.includes('REPLACE')
}

async function importRs256Jwk(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as unknown as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
}

async function fetchJwks(teamDomain: string, fetchImpl: FetchLike): Promise<Map<string, CryptoKey>> {
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`Access JWKS fetch failed with status ${res.status}`)
  const body = (await res.json()) as { keys?: Jwk[] }
  const keys = new Map<string, CryptoKey>()
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid) continue
    try {
      keys.set(jwk.kid, await importRs256Jwk(jwk))
    } catch {
      // Not an RS256 key (or otherwise unimportable) — skip it, don't fail the whole fetch.
    }
  }
  return keys
}

// Cache hit on `kid` -> no fetch. Cache miss (including a cold cache) ->
// fetch exactly once, update the cache, then look up again. A `kid` that's
// still missing after that one refetch is treated as unknown — no retry.
async function getSigningKey(teamDomain: string, kid: string, fetchImpl: FetchLike): Promise<CryptoKey | null> {
  const cached = jwksCache.get(teamDomain)
  if (cached?.has(kid)) return cached.get(kid) ?? null

  const keys = await fetchJwks(teamDomain, fetchImpl)
  jwksCache.set(teamDomain, keys)
  return keys.get(kid) ?? null
}

export async function verifyAccessJwt(
  request: Request,
  env: AccessJwtEnv,
  deps: AccessJwtVerifyDeps = {}
): Promise<boolean> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN
  const aud = env.ACCESS_AUD
  if (isUnconfigured(teamDomain) || isUnconfigured(aud)) return false

  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [headerSeg, payloadSeg, signatureSeg] = parts

  let header: any
  let payload: any
  try {
    header = base64UrlDecodeJson(headerSeg)
    payload = base64UrlDecodeJson(payloadSeg)
  } catch {
    return false
  }

  // RS256 only — explicitly rejects 'none', 'HS256', etc.
  if (header?.alg !== 'RS256') return false
  if (typeof header?.kid !== 'string' || !header.kid) return false

  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike)

  let key: CryptoKey | null
  try {
    key = await getSigningKey(teamDomain as string, header.kid, fetchImpl)
  } catch {
    return false
  }
  if (!key) return false

  let signatureBytes: Uint8Array
  try {
    signatureBytes = base64UrlToBytes(signatureSeg)
  } catch {
    return false
  }

  let signatureValid: boolean
  try {
    signatureValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signatureBytes,
      new TextEncoder().encode(`${headerSeg}.${payloadSeg}`)
    )
  } catch {
    return false
  }
  if (!signatureValid) return false

  // exp is required — a token with no expiry (or a non-numeric one) never
  // expires, which is not acceptable for a gate like this. nbf stays
  // optional: only checked when present, same as the JWT spec treats it.
  if (typeof payload.exp !== 'number') return false
  const nowSeconds = Math.floor((deps.now ? deps.now() : Date.now()) / 1000)
  if (nowSeconds > payload.exp + CLOCK_SKEW_SECONDS) return false
  if (typeof payload.nbf === 'number' && nowSeconds < payload.nbf - CLOCK_SKEW_SECONDS) return false

  if (payload.iss !== `https://${teamDomain}`) return false

  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audList.includes(aud)) return false

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
  const allowed = ACCESS_ALLOWED_EMAILS.some((e) => e.toLowerCase() === email)
  if (!allowed) return false

  return true
}
