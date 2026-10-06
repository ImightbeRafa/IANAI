import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCESS_ALLOWED_EMAILS, verifyAccessJwt, __resetJwksCacheForTests } from '../cf/access-jwt'
import { handleFetch, handleScheduled, type WorkerEnv } from '../cf/worker-core'

const subtle = webcrypto.subtle as unknown as SubtleCrypto

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function base64UrlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

async function generateKeyPair() {
  return subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  ) as Promise<CryptoKeyPair>
}

async function signJwt(privateKey: CryptoKey, header: Record<string, unknown>, payload: Record<string, unknown>) {
  const headerSeg = base64UrlJson(header)
  const payloadSeg = base64UrlJson(payload)
  const signingInput = `${headerSeg}.${payloadSeg}`
  const signature = await subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput)
  )
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

let domainCounter = 0
function uniqueTeamDomain(): string {
  domainCounter += 1
  return `team-${domainCounter}.cloudflareaccess.com`
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function validPayload(aud: string, teamDomain: string, overrides: Record<string, unknown> = {}) {
  const now = nowSeconds()
  return {
    aud,
    iss: `https://${teamDomain}`,
    email: 'rafaeser@gmail.com',
    exp: now + 300,
    nbf: now - 10,
    iat: now - 10,
    ...overrides,
  }
}

// Every test gets its own team domain so the module-level JWKS cache in
// cf/access-jwt.ts never leaks state between tests.
async function setup() {
  const { publicKey, privateKey } = await generateKeyPair()
  const jwk = await subtle.exportKey('jwk', publicKey)
  const kid = 'test-kid-1'
  const teamDomain = uniqueTeamDomain()
  const aud = 'test-aud-value'
  const fetchImpl = vi.fn(async (url: string) => {
    if (url === `https://${teamDomain}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  const env: WorkerEnv = {
    ASSETS: { fetch: vi.fn() },
    APP_ENV: 'preview',
    ACCESS_TEAM_DOMAIN: teamDomain,
    ACCESS_AUD: aud,
  }
  return { privateKey, kid, teamDomain, aud, env, fetchImpl }
}

describe('ACCESS_ALLOWED_EMAILS', () => {
  it('is exactly the two-email allowlist', () => {
    expect(ACCESS_ALLOWED_EMAILS).toEqual(['rafa04128@gmail.com', 'rafaeser@gmail.com'])
  })
})

describe('verifyAccessJwt', () => {
  it('passes for a valid RS256 token', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/api/chat', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(true)
  })

  it('matches the email claim case-insensitively', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { email: 'RAFAESER@GMAIL.COM' })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(true)
  })

  it('rejects a non-allowlisted email', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { email: 'someone-else@example.com' })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it('rejects the wrong aud', async () => {
    const { privateKey, kid, teamDomain, env, fetchImpl } = await setup()
    const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload('wrong-aud', teamDomain))
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it('accepts an aud array containing ACCESS_AUD', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { aud: ['some-other-app', aud] })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(true)
  })

  it('rejects the wrong iss', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { iss: 'https://evil.example.com' })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it('rejects an expired token beyond the skew window', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { exp: nowSeconds() - 120 })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it('accepts a token expired within the skew window', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { exp: nowSeconds() - 30 })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(true)
  })

  it('rejects a token with no exp claim at all — exp is required, unlike nbf', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { exp: undefined })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it('rejects a non-numeric exp claim', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { exp: 'not-a-number' })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it('rejects nbf in the future beyond the skew window', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { nbf: nowSeconds() + 120 })
    )
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it('rejects a signature produced by a different key', async () => {
    const { kid, teamDomain, aud, env, fetchImpl } = await setup()
    const { privateKey: strangerKey } = await generateKeyPair()
    const token = await signJwt(strangerKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it("rejects alg: 'none'", async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(privateKey, { alg: 'none', kid }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it("rejects alg: 'HS256'", async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(privateKey, { alg: 'HS256', kid }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
  })

  it('rejects a missing header, with no network call', async () => {
    const { env, fetchImpl } = await setup()
    const req = new Request('https://worker.test/')
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects when ACCESS_TEAM_DOMAIN/ACCESS_AUD are unset, with no network call', async () => {
    const { privateKey, kid, teamDomain, aud, fetchImpl } = await setup()
    const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, {}, { fetchImpl })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects placeholder vars (containing "REPLACE"), with no network call', async () => {
    const { privateKey, kid, teamDomain, aud, fetchImpl } = await setup()
    const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    const placeholderEnv = {
      ACCESS_TEAM_DOMAIN: 'REPLACE_WITH_TEAM.cloudflareaccess.com',
      ACCESS_AUD: 'REPLACE_WITH_ACCESS_APP_AUD',
    }
    expect(await verifyAccessJwt(req, placeholderEnv, { fetchImpl })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an unknown kid even after one refetch, fetching exactly once', async () => {
    const { teamDomain, aud, env, fetchImpl } = await setup()
    const { privateKey: strangerKey } = await generateKeyPair()
    const token = await signJwt(strangerKey, { alg: 'RS256', kid: 'never-seen-kid' }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req, env, { fetchImpl })).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not refetch JWKS on a second request for an already-cached kid', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))

    const req1 = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req1, env, { fetchImpl })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const req2 = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req2, env, { fetchImpl })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  // Round-6 operator review, item B: an unknown kid is now throttled to at
  // most one refetch attempt per 60s per team domain (negative cache), so
  // this test must advance the injected clock past that window between the
  // old-kid and new-kid calls — without it, the second call would (new,
  // correct behavior) see "still within the throttle window" and return
  // null with NO fetch, which would make this specific rotation scenario
  // fail closed until the window lapses. That's the intended fix (a flood
  // of unknown/rotated-away kids must not cause a fetch per request); this
  // test demonstrates the refetch DOES still happen once that window has
  // passed, not that it happens immediately.
  it('a kid that only appears after key rotation passes once refetched, 60s+ after the first fetch', async () => {
    const teamDomain = uniqueTeamDomain()
    const aud = 'test-aud-value'
    const env: WorkerEnv = {
      ASSETS: { fetch: vi.fn() },
      APP_ENV: 'preview',
      ACCESS_TEAM_DOMAIN: teamDomain,
      ACCESS_AUD: aud,
    }

    const { publicKey: oldPub, privateKey: oldPriv } = await generateKeyPair()
    const oldJwk = await subtle.exportKey('jwk', oldPub)
    const oldKid = 'old-kid'

    const { publicKey: newPub, privateKey: newPriv } = await generateKeyPair()
    const newJwk = await subtle.exportKey('jwk', newPub)
    const newKid = 'new-kid'

    let rotated = false
    const fetchImpl = vi.fn(async () => {
      const keys = rotated ? [{ ...oldJwk, kid: oldKid }, { ...newJwk, kid: newKid }] : [{ ...oldJwk, kid: oldKid }]
      return new Response(JSON.stringify({ keys }), { status: 200 })
    })

    let clockMs = Date.now()
    const now = () => clockMs

    const oldToken = await signJwt(oldPriv, { alg: 'RS256', kid: oldKid }, validPayload(aud, teamDomain))
    const reqOld = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': oldToken } })
    expect(await verifyAccessJwt(reqOld, env, { fetchImpl, now })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    rotated = true
    clockMs += 61_000
    const newToken = await signJwt(newPriv, { alg: 'RS256', kid: newKid }, validPayload(aud, teamDomain))
    const reqNew = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': newToken } })
    expect(await verifyAccessJwt(reqNew, env, { fetchImpl, now })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('JWKS cache timing (round-6 operator review, item B)', () => {
  afterEach(() => __resetJwksCacheForTests())

  it('an unknown kid twice within 60s causes exactly 1 fetch', async () => {
    const { teamDomain, aud, env, fetchImpl } = await setup()
    const { privateKey: strangerKey } = await generateKeyPair()
    let clockMs = Date.now()
    const now = () => clockMs

    const token1 = await signJwt(strangerKey, { alg: 'RS256', kid: 'unknown-1' }, validPayload(aud, teamDomain))
    const req1 = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token1 } })
    expect(await verifyAccessJwt(req1, env, { fetchImpl, now })).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    clockMs += 30_000
    const token2 = await signJwt(strangerKey, { alg: 'RS256', kid: 'unknown-2' }, validPayload(aud, teamDomain))
    const req2 = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token2 } })
    expect(await verifyAccessJwt(req2, env, { fetchImpl, now })).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('an unknown kid retried after 60s causes a second fetch', async () => {
    const { teamDomain, aud, env, fetchImpl } = await setup()
    const { privateKey: strangerKey } = await generateKeyPair()
    let clockMs = Date.now()
    const now = () => clockMs

    const token1 = await signJwt(strangerKey, { alg: 'RS256', kid: 'unknown-1' }, validPayload(aud, teamDomain))
    const req1 = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token1 } })
    expect(await verifyAccessJwt(req1, env, { fetchImpl, now })).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    clockMs += 61_000
    const token2 = await signJwt(strangerKey, { alg: 'RS256', kid: 'unknown-2' }, validPayload(aud, teamDomain))
    const req2 = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token2 } })
    expect(await verifyAccessJwt(req2, env, { fetchImpl, now })).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('a known kid within the 1h TTL causes 0 refetches, no matter how many verifications', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    let clockMs = Date.now()
    const now = () => clockMs
    // A long-lived exp — this test advances the injected clock by up to 30
    // minutes, which must not make the token itself look expired.
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { exp: nowSeconds() + 3 * 60 * 60 })
    )

    for (let i = 0; i < 3; i++) {
      clockMs += 10 * 60 * 1000 // +10 min each time, well under the 1h TTL
      const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
      expect(await verifyAccessJwt(req, env, { fetchImpl, now })).toBe(true)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a known kid refetches once the 1h TTL has elapsed', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    let clockMs = Date.now()
    const now = () => clockMs
    // Long-lived exp — this test advances the injected clock by 61 minutes,
    // which must not make the token itself look expired.
    const token = await signJwt(
      privateKey,
      { alg: 'RS256', kid },
      validPayload(aud, teamDomain, { exp: nowSeconds() + 3 * 60 * 60 })
    )

    const req1 = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req1, env, { fetchImpl, now })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    clockMs += 61 * 60 * 1000 // +61 min, past the 1h TTL
    const req2 = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccessJwt(req2, env, { fetchImpl, now })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('N concurrent requests with an uncached kid cause exactly 1 fetch', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))
    const makeReq = () => new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })

    const results = await Promise.all([
      verifyAccessJwt(makeReq(), env, { fetchImpl }),
      verifyAccessJwt(makeReq(), env, { fetchImpl }),
      verifyAccessJwt(makeReq(), env, { fetchImpl }),
      verifyAccessJwt(makeReq(), env, { fetchImpl }),
      verifyAccessJwt(makeReq(), env, { fetchImpl }),
    ])
    expect(results).toEqual([true, true, true, true, true])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('handleFetch Access JWT gate (preview only)', () => {
  it('a valid token passes through to the container', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const containerFetch = vi.fn(async () => new Response('ok', { status: 200 }))
    const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/api/chat', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    const res = await handleFetch(req, env, containerFetch, { fetchImpl })
    expect(res.status).toBe(200)
    expect(containerFetch).toHaveBeenCalledTimes(1)
  })

  it('a valid token passes through to ASSETS for a non-API path', async () => {
    const { privateKey, kid, teamDomain, aud, env, fetchImpl } = await setup()
    const assetsFetch = vi.fn(
      async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    )
    env.ASSETS = { fetch: assetsFetch }
    const containerFetch = vi.fn()
    const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))
    const req = new Request('https://worker.test/', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    const res = await handleFetch(req, env, containerFetch, { fetchImpl })
    expect(res.status).toBe(200)
    expect(assetsFetch).toHaveBeenCalledTimes(1)
    expect(containerFetch).not.toHaveBeenCalled()
  })

  it('no token gives 403 and never calls the container or ASSETS', async () => {
    const { env, fetchImpl } = await setup()
    const assetsFetch = vi.fn()
    env.ASSETS = { fetch: assetsFetch }
    const containerFetch = vi.fn()
    const req = new Request('https://worker.test/api/chat')
    const res = await handleFetch(req, env, containerFetch, { fetchImpl })
    expect(res.status).toBe(403)
    expect(containerFetch).not.toHaveBeenCalled()
    expect(assetsFetch).not.toHaveBeenCalled()
  })

  it('production is completely unaffected: no header still passes', async () => {
    const containerFetch = vi.fn(async () => new Response('ok', { status: 200 }))
    const env: WorkerEnv = { ASSETS: { fetch: vi.fn() }, APP_ENV: 'production' }
    const req = new Request('https://worker.test/api/chat')
    const res = await handleFetch(req, env, containerFetch)
    expect(res.status).toBe(200)
    expect(containerFetch).toHaveBeenCalledTimes(1)
  })

  describe('gate selector: enforce unless production (round-6 operator review, item A)', () => {
    // The original gate only enforced when APP_ENV === 'preview' exactly —
    // failing OPEN for every other value (unset, a typo, a future env name
    // nobody anticipated). It's now inverted: enforce for everything that
    // isn't production, using api/lib/app-env.ts's own
    // trim+lowercase normalization, so there's one place deciding what
    // "production" means.
    it.each([
      ['unset', undefined],
      ['empty string', ''],
      ["'Preview'", 'Preview'],
      ["'prod'", 'prod'],
      ["'staging'", 'staging'],
    ])('APP_ENV=%s is enforced: 403 without a JWT, 200 with a valid one', async (_label, appEnv) => {
      const { privateKey, kid, teamDomain, aud, fetchImpl } = await setup()
      const containerFetch = vi.fn(async () => new Response('ok', { status: 200 }))
      const env: WorkerEnv = {
        ASSETS: { fetch: vi.fn() },
        APP_ENV: appEnv,
        ACCESS_TEAM_DOMAIN: teamDomain,
        ACCESS_AUD: aud,
      }

      const unauthed = await handleFetch(new Request('https://worker.test/api/chat'), env, containerFetch, {
        fetchImpl,
      })
      expect(unauthed.status).toBe(403)
      expect(containerFetch).not.toHaveBeenCalled()

      const token = await signJwt(privateKey, { alg: 'RS256', kid }, validPayload(aud, teamDomain))
      const authed = await handleFetch(
        new Request('https://worker.test/api/chat', { headers: { 'Cf-Access-Jwt-Assertion': token } }),
        env,
        containerFetch,
        { fetchImpl }
      )
      expect(authed.status).toBe(200)
      expect(containerFetch).toHaveBeenCalledTimes(1)
    })

    it.each([["' PRODUCTION'", ' PRODUCTION'], ["'production'", 'production']])(
      'APP_ENV=%s is unaffected: no header still passes, no JWT verification attempted',
      async (_label, appEnv) => {
        const containerFetch = vi.fn(async () => new Response('ok', { status: 200 }))
        const fetchImpl = vi.fn()
        const env: WorkerEnv = { ASSETS: { fetch: vi.fn() }, APP_ENV: appEnv }
        const res = await handleFetch(new Request('https://worker.test/api/chat'), env, containerFetch, {
          fetchImpl,
        })
        expect(res.status).toBe(200)
        expect(containerFetch).toHaveBeenCalledTimes(1)
        expect(fetchImpl).not.toHaveBeenCalled()
      }
    )
  })

  it('scheduled() with APP_ENV=preview is unaffected by JWT logic — governed only by ENABLE_CRONS', async () => {
    const containerFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const result = await handleScheduled(
      { cron: '* * * * *' },
      { ASSETS: { fetch: vi.fn() }, APP_ENV: 'preview', ENABLE_CRONS: '1', CRON_SECRET: 'x' } as WorkerEnv,
      containerFetch
    )
    expect(result.skipped).toBe(false)
    expect(containerFetch).toHaveBeenCalledTimes(1)
  })
})
