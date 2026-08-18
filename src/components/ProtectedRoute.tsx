import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { resolveProtectedRoute } from '../lib/protectedRouteGate'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireAdmin?: boolean
}

export default function ProtectedRoute({ children, requireAdmin }: ProtectedRouteProps) {
  const { user, loading, isAdmin, adminResolved } = useAuth()
  const decision = resolveProtectedRoute({
    loading,
    user,
    requireAdmin,
    isAdmin,
    adminResolved,
  })

  if (decision === 'wait') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (decision === 'login') {
    return <Navigate to="/login" replace />
  }

  if (decision === 'forbidden') {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
