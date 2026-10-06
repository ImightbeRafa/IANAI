/**
 * Client mirror of api/lib/preview-admin.ts — keep email list in sync.
 * Preview-only /admin for invited QA; production still needs profiles.is_admin.
 */

export const PREVIEW_ADMIN_EMAILS = [
  'sup.rafa0412@gmail.com',
  'ralauas@gmail.com',
] as const

export function normalizeAdminEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase()
}

export function isPreviewAdminEmail(email?: string | null): boolean {
  const normalized = normalizeAdminEmail(email)
  if (!normalized) return false
  return (PREVIEW_ADMIN_EMAILS as readonly string[]).includes(normalized)
}

/** Comma-separated exact-match hostname allowlist: trim, lowercase, drop empties. */
export function parsePreviewHosts(raw: string): string[] {
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0)
}

/**
 * Fail closed unless this build/runtime is Preview.
 * Uses build-time VITE_APP_ENV (falling back to VITE_VERCEL_ENV), with the
 * git Preview hostname pattern or an explicit preview-hosts allowlist as
 * equivalents. No Cloudflare hostname is hardcoded here — a preview Worker
 * hostname must be added to VITE_PREVIEW_HOSTS.
 */
export function isPreviewDeploy(options?: {
  appEnv?: string
  vercelEnv?: string
  hostname?: string
  previewHosts?: string
}): boolean {
  const value = (
    options?.appEnv
    ?? options?.vercelEnv
    ?? (import.meta.env.VITE_APP_ENV || import.meta.env.VITE_VERCEL_ENV || '')
  ).toLowerCase()
  if (value === 'preview') return true
  if (value === 'production' || value === 'development') return false

  const host =
    options?.hostname
    ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  // Vercel git Preview URLs look like project-git-branch-team.vercel.app
  if (host.includes('-git-') && host.endsWith('.vercel.app')) return true

  const previewHosts = parsePreviewHosts(options?.previewHosts ?? import.meta.env.VITE_PREVIEW_HOSTS ?? '')
  return previewHosts.includes(host.toLowerCase())
}

export function resolveClientAdminAccess(options: {
  profileIsAdmin: boolean
  email?: string | null
  appEnv?: string
  vercelEnv?: string
  hostname?: string
  previewHosts?: string
}): boolean {
  if (options.profileIsAdmin === true) return true
  if (
    !isPreviewDeploy({
      appEnv: options.appEnv,
      vercelEnv: options.vercelEnv,
      hostname: options.hostname,
      previewHosts: options.previewHosts,
    })
  ) {
    return false
  }
  return isPreviewAdminEmail(options.email)
}
