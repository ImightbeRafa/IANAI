import { ReactNode, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  Settings, 
  LogOut, 
  Menu,
  User,
  FileText,
  ImageIcon,
  BarChart3,
  AlignLeft,
  LayoutDashboard,
  MessageCircle,
  Sparkles
} from 'lucide-react'
import { useChatShellRollout } from '../features/chat-shell/ChatShellRolloutContext'
import AdvanceLogo from './AdvanceLogo'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { user, signOut, isAdmin, adminResolved } = useAuth()
  const { language } = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [switchBusy, setSwitchBusy] = useState(false)
  const rollout = useChatShellRollout()
  const homePath = rollout.effectiveHome === 'chat' ? '/chat' : '/dashboard'

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const labels = {
    es: {
      dashboard: 'Inicio',
      chat: 'Chat',
      scripts: 'Guiones',
      descriptions: 'Descripciones',
      posts: 'Posts',
      respuestas: 'Respuestas',
      settings: 'Configuración',
      signOut: 'Cerrar Sesión',
      admin: 'Admin',
      useChatHome: 'Usar Chat como inicio',
      useClassicHome: 'Volver al panel clásico',
    },
    en: {
      dashboard: 'Dashboard',
      chat: 'Chat',
      scripts: 'Scripts',
      descriptions: 'Descriptions',
      posts: 'Posts',
      respuestas: 'Replies',
      settings: 'Settings',
      signOut: 'Sign Out',
      admin: 'Admin',
      useChatHome: 'Make Chat home',
      useClassicHome: 'Return to classic',
    }
  }

  const t = labels[language]

  const allNavItems = [
    { path: '/dashboard', label: t.dashboard, icon: LayoutDashboard, beta: false, adminOnly: false },
    ...(rollout.showSwitch
      ? [{ path: '/chat', label: t.chat, icon: Sparkles, beta: true, adminOnly: false }]
      : []),
    { path: '/scripts', label: t.scripts, icon: FileText, beta: true, adminOnly: false },
    { path: '/descriptions', label: t.descriptions, icon: AlignLeft, beta: true, adminOnly: false },
    { path: '/posts', label: t.posts, icon: ImageIcon, beta: true, adminOnly: false },
    { path: '/respuestas', label: t.respuestas, icon: MessageCircle, beta: true, adminOnly: false },
    { path: '/settings', label: t.settings, icon: Settings, beta: false, adminOnly: false },
    ...(isAdmin && adminResolved ? [{ path: '/admin', label: t.admin, icon: BarChart3, beta: false, adminOnly: false }] : []),
  ]

  const navItems = allNavItems.filter(item => !item.adminOnly || isAdmin)

  return (
    <div className="h-screen bg-dark-50 flex overflow-hidden">
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
        w-64 bg-dark-100 border-r border-dark-200
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-dark-100">
            <Link to={homePath} className="flex items-center justify-center gap-3">
              <AdvanceLogo size={40} />
              <span className="text-xl font-extrabold" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.02em' }}>Advance AI</span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map(({ path, label, icon: Icon, beta }) => (
              <Link
                key={path}
                to={path}
                onClick={() => setSidebarOpen(false)}
                data-onboarding={path.replace('/', '')}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                  ${location.pathname === path || location.pathname.startsWith(path + '/')
                    ? 'bg-primary-900/20 text-primary-400' 
                    : 'text-dark-500 hover:bg-dark-200 hover:text-dark-900'}
                `}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{label}</span>
                {beta && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-primary-900/30 text-primary-400 rounded font-medium opacity-70">
                    beta
                  </span>
                )}
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
            {rollout.showSwitch && (
              <button
                type="button"
                disabled={switchBusy}
                onClick={() => {
                  if (switchBusy) return
                  const next = rollout.preferredUi === 'chat' ? 'classic' : 'chat'
                  setSwitchBusy(true)
                  void rollout.setPreferredUi(next).then((ok) => {
                    setSwitchBusy(false)
                    if (!ok) return
                    navigate(next === 'chat' ? '/chat' : '/dashboard')
                    setSidebarOpen(false)
                  })
                }}
                className="flex items-center gap-3 px-4 py-3 w-full text-dark-500 hover:bg-dark-200 hover:text-dark-900 rounded-lg transition-colors"
              >
                <Sparkles className="w-5 h-5" />
                <span className="font-medium">
                  {rollout.preferredUi === 'chat' ? t.useClassicHome : t.useChatHome}
                </span>
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-4 py-3 w-full text-dark-500 hover:bg-dark-200 hover:text-dark-900 rounded-lg transition-colors mt-2"
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
        <header className="lg:hidden bg-dark-100 border-b border-dark-200 px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-dark-600 hover:text-dark-900"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <AdvanceLogo size={24} />
            <span className="text-xl font-extrabold" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.03em' }}>Advance AI</span>
          </div>
          <div className="w-10" />
        </header>

        {/* Page content */}
        <main className="flex-1 flex flex-col min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
