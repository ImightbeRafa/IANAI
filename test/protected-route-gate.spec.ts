import { describe, expect, it } from 'vitest'
import { resolveProtectedRoute } from '../src/lib/protectedRouteGate'

describe('resolveProtectedRoute', () => {
  it('waits while the session is loading', () => {
    expect(resolveProtectedRoute({
      loading: true,
      user: null,
      isAdmin: false,
      adminResolved: false,
    })).toBe('wait')
  })

  it('sends anonymous users to login', () => {
    expect(resolveProtectedRoute({
      loading: false,
      user: null,
      requireAdmin: true,
      isAdmin: false,
      adminResolved: false,
    })).toBe('login')
  })

  it('waits for admin status before bouncing /admin', () => {
    expect(resolveProtectedRoute({
      loading: false,
      user: { id: 'u1' },
      requireAdmin: true,
      isAdmin: false,
      adminResolved: false,
    })).toBe('wait')
  })

  it('lets a resolved admin through and forbids a resolved non-admin', () => {
    expect(resolveProtectedRoute({
      loading: false,
      user: { id: 'u1' },
      requireAdmin: true,
      isAdmin: true,
      adminResolved: true,
    })).toBe('ok')
    expect(resolveProtectedRoute({
      loading: false,
      user: { id: 'u1' },
      requireAdmin: true,
      isAdmin: false,
      adminResolved: true,
    })).toBe('forbidden')
  })
})
