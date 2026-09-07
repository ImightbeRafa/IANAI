/**
 * Preview-only /admin allowlist for invited QA emails.
 * Production and non-preview always require profiles.is_admin (fail closed).
 * Do not write profiles.is_admin on AIIAN for these accounts.
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

/** True only when Vercel reports preview. Fail closed otherwise. */
export function isVercelPreviewRuntime(
  env: { VERCEL_ENV?: string } = process.env
): boolean {
  return (env.VERCEL_ENV || '').toLowerCase() === 'preview'
}

/**
 * Preview QA may open /admin without profiles.is_admin.
 * Never true on production / development / unset VERCEL_ENV.
 */
export function hasPreviewAdminAllowlistAccess(options: {
  email?: string | null
  env?: { VERCEL_ENV?: string }
}): boolean {
  if (!isVercelPreviewRuntime(options.env)) return false
  return isPreviewAdminEmail(options.email)
}

export function resolveAdminDashboardAccess(options: {
  profileIsAdmin: boolean
  email?: string | null
  env?: { VERCEL_ENV?: string }
}): boolean {
  if (options.profileIsAdmin === true) return true
  return hasPreviewAdminAllowlistAccess(options)
}
