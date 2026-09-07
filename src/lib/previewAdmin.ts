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

/**
 * Fail closed unless this build/runtime is Vercel Preview.
 * Uses build-time VITE_VERCEL_ENV, with git Preview hostname as equivalent.
 */
export function isPreviewDeploy(options?: {
  vercelEnv?: string
  hostname?: string
}): boolean {
  const vercelEnv = (options?.vercelEnv ?? import.meta.env.VITE_VERCEL_ENV ?? '').toLowerCase()
  if (vercelEnv === 'preview') return true
  if (vercelEnv === 'production' || vercelEnv === 'development') return false

  const host =
    options?.hostname
    ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  // Vercel git Preview URLs look like project-git-branch-team.vercel.app
  if (host.includes('-git-') && host.endsWith('.vercel.app')) return true
  return false
}

export function resolveClientAdminAccess(options: {
  profileIsAdmin: boolean
  email?: string | null
  vercelEnv?: string
  hostname?: string
}): boolean {
  if (options.profileIsAdmin === true) return true
  if (!isPreviewDeploy({ vercelEnv: options.vercelEnv, hostname: options.hostname })) {
    return false
  }
  return isPreviewAdminEmail(options.email)
}
