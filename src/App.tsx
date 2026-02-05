import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { LanguageProvider } from './contexts/LanguageContext'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import ProductWorkspace from './pages/ProductWorkspace'
import PostsDashboard from './pages/PostsDashboard'
import PostWorkspace from './pages/PostWorkspace'
import BRollDashboard from './pages/BRollDashboard'
import BRollWorkspace from './pages/BRollWorkspace'
import ICPDashboard from './pages/ICPDashboard'
import ICPForm from './pages/ICPForm'
import Settings from './pages/Settings'
import AdminDashboard from './pages/AdminDashboard'

export default function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
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
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  )
}
