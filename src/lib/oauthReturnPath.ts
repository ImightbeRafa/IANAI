/**
 * Safe same-origin return paths for OAuth / login redirects.
 */

export function safeAppReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  if (value.includes('://')) return null
  if (value.includes('\\')) return null
  return value
}

export function buildOAuthConsentLoginPath(authorizationId: string): string {
  const consent = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
  return `/login?redirect=${encodeURIComponent(consent)}`
}
