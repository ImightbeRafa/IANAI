export type ProtectedRouteDecision = 'wait' | 'login' | 'forbidden' | 'ok'

export function resolveProtectedRoute(options: {
  loading: boolean
  user: unknown | null
  requireAdmin?: boolean
  isAdmin: boolean
  adminResolved: boolean
}): ProtectedRouteDecision {
  if (options.loading) return 'wait'
  if (!options.user) return 'login'
  if (options.requireAdmin && !options.adminResolved) return 'wait'
  if (options.requireAdmin && !options.isAdmin) return 'forbidden'
  return 'ok'
}
