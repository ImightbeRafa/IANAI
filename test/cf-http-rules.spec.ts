import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CF_CONTENT_SECURITY_POLICY,
  REMOVED_CSP_SOURCES,
  SECURITY_HEADERS,
  isContainerPath,
  isSpaFallbackPath,
  parseSizeLimit,
  rewriteToApi,
} from '../cf/http-rules.mjs'

function vercelCsp(): string {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    headers?: Array<{ headers?: Array<{ key: string; value: string }> }>
  }
  return (
    vercel.headers
      ?.flatMap((row) => row.headers || [])
      .find((header) => header.key === 'Content-Security-Policy')
      ?.value || ''
  )
}

function deriveCfCsp(vercelCspValue: string): string {
  return vercelCspValue
    .split(';')
    .map((directive) => {
      const tokens = directive.trim().split(/\s+/)
      const name = tokens[0]
      const sources = tokens.slice(1).filter((t) => !REMOVED_CSP_SOURCES.includes(t))
      return sources.length > 0 ? `${name} ${sources.join(' ')}` : `${name} 'none'`
    })
    .join('; ')
}

describe('cf/http-rules', () => {
  it('derives CF_CONTENT_SECURITY_POLICY from vercel.json by removing tokens', () => {
    const derived = deriveCfCsp(vercelCsp())
    expect(derived).toBe(CF_CONTENT_SECURITY_POLICY)
    expect(derived).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data: https: http:; connect-src 'self' data: https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://accounts.google.com https://*.googleapis.com https://api.x.ai; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'"
    )
  })

  it('never mentions vercel.live or pusher', () => {
    expect(CF_CONTENT_SECURITY_POLICY).not.toMatch(/vercel\.live|pusher/)
  })

  it('keeps every non-removed token from vercel.json, in order, in every directive but frame-src', () => {
    const vercelDirectives = vercelCsp()
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
    const cfDirectives = CF_CONTENT_SECURITY_POLICY.split(';').map((d) => d.trim())

    for (const directive of vercelDirectives) {
      const [name, ...sources] = directive.split(/\s+/)
      if (name === 'frame-src') continue
      const kept = sources.filter((t) => !REMOVED_CSP_SOURCES.includes(t))
      const match = cfDirectives.find((d) => d.startsWith(`${name} `))
      expect(match).toBe(`${name} ${kept.join(' ')}`)
    }
  })

  it('still contains https://vercel.live in vercel.json (byte-for-byte guard)', () => {
    expect(vercelCsp()).toContain('https://vercel.live')
  })

  it('SECURITY_HEADERS is the exact seven-pair literal array', () => {
    expect(SECURITY_HEADERS).toEqual([
      ['X-Content-Type-Options', 'nosniff'],
      ['X-Frame-Options', 'DENY'],
      ['X-XSS-Protection', '1; mode=block'],
      ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
      ['Referrer-Policy', 'strict-origin-when-cross-origin'],
      ['Permissions-Policy', 'camera=(), microphone=(self), geolocation=()'],
      ['Content-Security-Policy', CF_CONTENT_SECURITY_POLICY],
    ])
  })

  it('isSpaFallbackPath', () => {
    expect(isSpaFallbackPath('/chat/abc')).toBe(true)
    expect(isSpaFallbackPath('/api')).toBe(true)
    expect(isSpaFallbackPath('/api/x')).toBe(false)
    expect(isSpaFallbackPath('/assets/x.js')).toBe(false)
  })

  it('rewriteToApi', () => {
    expect(rewriteToApi('/.well-known/oauth-protected-resource')).toBe('/api/mcp-oauth-metadata')
    expect(rewriteToApi('/.well-known/oauth-protected-resource/api/mcp')).toBe('/api/mcp-oauth-metadata')
    expect(rewriteToApi('/.well-known/oauth-protected-resource/x')).toBeNull()
  })

  it('isContainerPath', () => {
    expect(isContainerPath('/api/chat')).toBe(true)
    expect(isContainerPath('/chat')).toBe(false)
  })

  it('parseSizeLimit', () => {
    expect(parseSizeLimit('10mb')).toBe(10_485_760)
    expect(parseSizeLimit('25mb')).toBe(26_214_400)
    expect(parseSizeLimit(4_718_592)).toBe(4_718_592)
    expect(parseSizeLimit('1.5kb')).toBe(1536)
    expect(() => parseSizeLimit('abc')).toThrow()
  })
})
