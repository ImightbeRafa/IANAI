import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CSP Preview feedback allowlist', () => {
  it('allows vercel.live feedback.js narrowly (not script-src *)', () => {
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      headers?: Array<{ headers?: Array<{ key: string; value: string }> }>
    }
    const csp = vercel.headers
      ?.flatMap((row) => row.headers || [])
      .find((header) => header.key === 'Content-Security-Policy')
      ?.value || ''
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://vercel.live")
    expect(csp).toContain('https://vercel.live')
    expect(csp).toMatch(/connect-src[^;]*https:\/\/vercel\.live/)
    expect(csp).not.toMatch(/script-src[^;]*\*/)
  })
})
