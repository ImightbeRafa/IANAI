/**
 * Deployment-environment class (production / preview / ...), independent of
 * the hosting platform. On Vercel this is VERCEL_ENV; on Cloudflare it's the
 * Worker/Container `APP_ENV` var. APP_ENV takes precedence when both are set
 * so the same code works unchanged on either platform during the migration.
 */

export type AppEnvSource = { APP_ENV?: string; VERCEL_ENV?: string }

export function resolveAppEnv(env: AppEnvSource = process.env): string {
  return (env.APP_ENV || env.VERCEL_ENV || '').trim().toLowerCase()
}

export function isProductionAppEnv(env?: AppEnvSource): boolean {
  return resolveAppEnv(env) === 'production'
}

export function isPreviewAppEnv(env?: AppEnvSource): boolean {
  return resolveAppEnv(env) === 'preview'
}
