/**
 * Feature-detect columns added by migrations that may not be applied yet
 * (e.g. 085 products.ad_profile). PostgREST answers a missing column with
 * Postgres 42703 ("column … does not exist") or PGRST204 ("Could not find the
 * '…' column of '…' in the schema cache"). Code must degrade, not crash.
 */

export const MIGRATION_085 = '085_offer_profile_brand_profile_images'

export function isMissingColumnError(err: unknown, column?: string): boolean {
  if (!err || typeof err !== 'object') return false
  const row = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
  const code = typeof row.code === 'string' ? row.code : ''
  const text = [row.message, row.details, row.hint].filter((v) => typeof v === 'string').join(' ')
  const looksMissing = code === '42703'
    || code === 'PGRST204'
    || /column .* does not exist|could not find the '.*' column/i.test(text)
  if (!looksMissing) return false
  if (!column) return true
  // When the error names a column, it must be the one we probed for.
  return !text || text.includes(column)
}

/** Error with a stable code the MCP host surfaces as `error.code`. */
export class MigrationPendingError extends Error {
  readonly code = 'MIGRATION_PENDING'
  constructor(feature: string) {
    super(`${feature} needs database migration ${MIGRATION_085}, which is not applied yet. Nothing was changed. Ask the Advance team to apply it, then retry.`)
    this.name = 'MigrationPendingError'
  }
}
