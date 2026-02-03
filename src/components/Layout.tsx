import { ReactNode, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  LayoutDashboard, 
  Settings, 
  LogOut, 
  Menu,
  User
} from 'lucide-react'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { user, signOut } = useAuth()
  const { language } = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const labels = {
    es: {
      dashboard: 'Panel',
      settings: 'Configuración',
      signOut: 'Cerrar Sesión'
    },
    en: {
      dashboard: 'Dashboard',
      settings: 'Settings',
      signOut: 'Sign Out'
    }
  }

  const t = labels[language]

  const navItems = [
    { path: '/dashboard', label: t.dashboard, icon: LayoutDashboard },
    { path: '/settings', label: t.settings, icon: Settings },
  ]

  return (
    <div className="min-h-screen bg-dark-50 flex">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-64 bg-white border-r border-dark-100
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-dark-100">
            <Link to="/dashboard" className="flex items-center justify-center gap-3">
              <img src="/logo.png" alt="Advance AI" className="w-10 h-10 rounded-lg object-cover" />
              <span className="text-xl font-bold italic" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.02em' }}>Advance AI</span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                  ${location.pathname === path 
                    ? 'bg-primary-50 text-primary-700' 
                    : 'text-dark-600 hover:bg-dark-50 hover:text-dark-900'}
                `}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{label}</span>
              </Link>
            ))}
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-dark-100">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-dark-900 truncate">
                  {user?.user_metadata?.full_name || 'User'}
                </p>
                <p className="text-xs text-dark-500 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-4 py-3 w-full text-dark-600 hover:bg-dark-50 hover:text-dark-900 rounded-lg transition-colors mt-2"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium">{t.signOut}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden bg-white border-b border-dark-100 px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-dark-600 hover:text-dark-900"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Advance AI" className="w-6 h-6 rounded object-cover" />
            <span className="text-xl font-bold italic" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.03em' }}>Advance AI</span>
          </div>
          <div className="w-10" />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
