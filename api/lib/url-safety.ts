import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Shared SSRF guards for server-side URL fetching.
 * Blocks private/link-local/metadata targets and re-validates redirect targets.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
])

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  if (n === null) return true

  // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, 224+/multicast+reserved
  if ((n & 0xff000000) === 0x00000000) return true
  if ((n & 0xff000000) === 0x0a000000) return true
  if ((n & 0xff000000) === 0x7f000000) return true
  if ((n & 0xffff0000) === 0xa9fe0000) return true
  if ((n & 0xfff00000) === 0xac100000) return true
  if ((n & 0xffff0000) === 0xc0a80000) return true
  if ((n & 0xffc00000) === 0x64400000) return true
  if ((n & 0xf0000000) >= 0xe0000000) return true
  return false
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // ULA
  if (normalized.startsWith('fe80')) return true // link-local
  if (normalized.startsWith('ff')) return true // multicast
  // IPv4-mapped IPv6 :ffff:x.x.x.x
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])
  return false
}

export function isBlockedIpAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isPrivateIpv4(ip)
  if (version === 6) return isPrivateIpv6(ip)
  return true
}

export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Invalid URL format')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed')
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new Error('URL not allowed')
  }

  // Block literal private IPs in the URL itself
  if (isIP(hostname) && isBlockedIpAddress(hostname)) {
    throw new Error('URL not allowed')
  }

  // Block decimal/octal/hex IP tricks by rejecting hostnames that are numeric-only non-DNS forms
  if (/^\d+$/.test(hostname)) {
    throw new Error('URL not allowed')
  }

  return parsed
}

export async function assertResolvesToPublicAddress(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (isBlockedIpAddress(host)) throw new Error('URL not allowed')
    return
  }

  let records: { address: string; family: number }[]
  try {
    records = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error('Unable to resolve URL host')
  }

  if (!records.length) {
    throw new Error('Unable to resolve URL host')
  }

  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new Error('URL not allowed')
    }
  }
}

export async function fetchPublicUrl(
  rawUrl: string,
  init: RequestInit & { maxRedirects?: number; timeoutMs?: number } = {}
): Promise<Response> {
  const { maxRedirects = 3, timeoutMs = 15000, ...rest } = init
  let current = assertPublicHttpUrl(rawUrl)
  await assertResolvesToPublicAddress(current.hostname)

  for (let i = 0; i <= maxRedirects; i++) {
    const response = await fetch(current.toString(), {
      ...rest,
      redirect: 'manual',
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new Error('Redirect missing location')
      }
      const next = new URL(location, current)
      current = assertPublicHttpUrl(next.toString())
      await assertResolvesToPublicAddress(current.hostname)
      continue
    }

    return response
  }

  throw new Error('Too many redirects')
}
