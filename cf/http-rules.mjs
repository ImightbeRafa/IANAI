// Shared HTTP/routing rules for the Cloudflare adapter (server.mjs, Node) and the
// Cloudflare Worker (src/cf-container-worker.ts, bundled by wrangler). Plain ESM so
// both runtimes can import it without a build step.

export const HTML_NO_CACHE = 'public, max-age=0, must-revalidate'

// Derived from vercel.json's Content-Security-Policy by deleting the tokens in
// REMOVED_CSP_SOURCES. frame-src had only https://vercel.live, so removing it
// leaves no sources; 'none' is the exact equivalent (not the same as dropping the
// directive, which would fall back to default-src 'self').
export const CF_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data: https: http:; connect-src 'self' data: https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://accounts.google.com https://*.googleapis.com https://api.x.ai; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'"

export const REMOVED_CSP_SOURCES = ['https://vercel.live', 'https://*.pusher.com', 'wss://*.pusher.com']

export const SECURITY_HEADERS = Object.freeze([
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['X-XSS-Protection', '1; mode=block'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(self), geolocation=()'],
  ['Content-Security-Policy', CF_CONTENT_SECURITY_POLICY],
])

export function isHtmlEntryPath(p) {
  return p === '/' || p === '/index.html'
}

export function rewriteToApi(p) {
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/api/mcp') {
    return '/api/mcp-oauth-metadata'
  }
  return null
}

export function isApiPath(p) {
  return p.startsWith('/api/')
}

export function isContainerPath(p) {
  return isApiPath(p) || rewriteToApi(p) !== null
}

// Mirrors vercel.json's rewrite source /((?!api/|assets/).*)/.
export function isSpaFallbackPath(p) {
  return !p.startsWith('/api/') && !p.startsWith('/assets/')
}

const SIZE_LIMIT_RE = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i
const SIZE_MULTIPLIERS = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }

export function parseSizeLimit(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const m = SIZE_LIMIT_RE.exec(v.trim())
    if (m) {
      const n = Number(m[1])
      const unit = (m[2] || 'b').toLowerCase()
      return n * SIZE_MULTIPLIERS[unit]
    }
  }
  throw new Error(`Invalid size limit: ${v}`)
}
