/**
 * Preview-only /admin allowlist for invited QA emails.
 * Production and non-preview always require profiles.is_admin (fail closed).
 * Do not write profiles.is_admin on AIIAN for these accounts.
 */

import { isPreviewAppEnv, type AppEnvSource } from './app-env.js'

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

/** True only when the deployment environment is preview (APP_ENV, falling back to VERCEL_ENV). Fail closed otherwise. */
export function isVercelPreviewRuntime(env: AppEnvSource = process.env): boolean {
  return isPreviewAppEnv(env)
}

// Kept as an alias so call sites can read it as "is this a preview runtime"
// without implying Vercel specifically (Cloudflare preview counts too).
export const isPreviewRuntime = isVercelPreviewRuntime

/**
 * Preview QA may open /admin without profiles.is_admin.
 * Never true on production / development / unset APP_ENV / VERCEL_ENV.
 */
export function hasPreviewAdminAllowlistAccess(options: {
  email?: string | null
  env?: AppEnvSource
}): boolean {
  if (!isVercelPreviewRuntime(options.env)) return false
  return isPreviewAdminEmail(options.email)
}

export function resolveAdminDashboardAccess(options: {
  profileIsAdmin: boolean
  email?: string | null
  env?: AppEnvSource
}): boolean {
  if (options.profileIsAdmin === true) return true
  return hasPreviewAdminAllowlistAccess(options)
}
