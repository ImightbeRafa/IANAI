import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { LanguageProvider } from './contexts/LanguageContext'
import ProtectedRoute from './components/ProtectedRoute'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import Login from './pages/Login'
import Signup from './pages/Signup'

// Lazy-loaded pages (code-split for smaller initial bundle)
const Dashboard = lazy(() => import('./pages/Dashboard'))
const ProductWorkspace = lazy(() => import('./pages/ProductWorkspace'))
const PostsDashboard = lazy(() => import('./pages/PostsDashboard'))
const PostWorkspace = lazy(() => import('./pages/PostWorkspace'))
const BRollDashboard = lazy(() => import('./pages/BRollDashboard'))
const BRollWorkspace = lazy(() => import('./pages/BRollWorkspace'))
const ICPDashboard = lazy(() => import('./pages/ICPDashboard'))
const ICPForm = lazy(() => import('./pages/ICPForm'))
const Settings = lazy(() => import('./pages/Settings'))
const TeamManagement = lazy(() => import('./pages/TeamManagement'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const DescriptionsDashboard = lazy(() => import('./pages/DescriptionsDashboard'))
const DescriptionsWorkspace = lazy(() => import('./pages/DescriptionsWorkspace'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))

function LazyFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <Suspense fallback={<LazyFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/product/:productId"
              element={
                <ProtectedRoute>
                  <ProductWorkspace />
                </ProtectedRoute>
              }
            />
            <Route
              path="/product/:productId/session/:sessionId"
              element={
                <ProtectedRoute>
                  <ProductWorkspace />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/posts"
              element={
                <ProtectedRoute>
                  <PostsDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/posts/product/:productId"
              element={
                <ProtectedRoute>
                  <PostWorkspace />
                </ProtectedRoute>
              }
            />
            <Route
              path="/broll"
              element={
                <ProtectedRoute>
                  <BRollDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/broll/product/:productId"
              element={
                <ProtectedRoute>
                  <BRollWorkspace />
                </ProtectedRoute>
              }
            />
            <Route
              path="/icps"
              element={
                <ProtectedRoute>
                  <ICPDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/icps/new"
              element={
                <ProtectedRoute>
                  <ICPForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/icps/:icpId/edit"
              element={
                <ProtectedRoute>
                  <ICPForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/icps/client/:clientId/new"
              element={
                <ProtectedRoute>
                  <ICPForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/icps/client/:clientId/:icpId/edit"
              element={
                <ProtectedRoute>
                  <ICPForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/descriptions"
              element={
                <ProtectedRoute>
                  <DescriptionsDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/descriptions/product/:productId"
              element={
                <ProtectedRoute>
                  <DescriptionsWorkspace />
                </ProtectedRoute>
              }
            />
            <Route
              path="/team"
              element={
                <ProtectedRoute>
                  <TeamManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
