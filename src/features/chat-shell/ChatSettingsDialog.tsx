import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  defaultSettingsCategory,
  settingsCategories,
  type SettingsCategoryId,
} from './chatShellSettings'
import type { SettingsSection } from '../../pages/Settings'
import type { ChatShellTheme } from './chatShellTheme'

const SettingsContent = lazy(() =>
  import('../../pages/Settings').then((mod) => ({ default: mod.SettingsContent }))
)
const AdminDashboard = lazy(() => import('../../pages/AdminDashboard'))
const AdminTickets = lazy(() => import('../../pages/AdminTickets'))

interface ChatSettingsDialogProps {
  open: boolean
  onClose: () => void
  theme: ChatShellTheme
  onThemeChange: (theme: ChatShellTheme) => void
}

function toSettingsSection(id: SettingsCategoryId): SettingsSection | null {
  if (id === 'admin' || id === 'tickets') return null
  return id
}

export default function ChatSettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
}: ChatSettingsDialogProps) {
  const { isAdmin } = useAuth()
  const { language } = useLanguage()
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [category, setCategory] = useState<SettingsCategoryId>(defaultSettingsCategory())
  const categories = settingsCategories(isAdmin)

  useEffect(() => {
    if (!open) return
    setCategory(defaultSettingsCategory())
    const t = window.setTimeout(() => closeRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  useEffect(() => {
    if (!isAdmin && (category === 'admin' || category === 'tickets')) {
      setCategory(defaultSettingsCategory())
    }
  }, [isAdmin, category])

  if (!open) return null

  const section = toSettingsSection(category)

  return (
    <div className="chat-shell__settings-root" role="presentation">
      <button
        type="button"
        className="chat-shell__settings-backdrop"
        aria-label={language === 'es' ? 'Cerrar configuración' : 'Close settings'}
        onClick={onClose}
      />
      <div
        className={`chat-shell__settings${category === 'admin' || category === 'tickets' ? ' chat-shell__settings--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <aside className="chat-shell__settings-nav">
          <div className="chat-shell__settings-nav-head">
            <h2 id={titleId}>{language === 'es' ? 'Configuración' : 'Settings'}</h2>
            <button
              ref={closeRef}
              type="button"
              className="chat-shell__icon-btn chat-shell__icon-btn--ghost"
              aria-label={language === 'es' ? 'Cerrar' : 'Close'}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          {categories.map((item, index) => {
            const prev = categories[index - 1]
            const showDivider = item.group === 'admin' && prev?.group !== 'admin'
            return (
              <div key={item.id}>
                {showDivider && (
                  <div className="chat-shell__settings-divider">
                    {language === 'es' ? 'Admin' : 'Admin'}
                  </div>
                )}
                <button
                  type="button"
                  className={`chat-shell__settings-cat${category === item.id ? ' is-on' : ''}`}
                  onClick={() => setCategory(item.id)}
                >
                  {item.label[language]}
                </button>
              </div>
            )
          })}
        </aside>
        <div className="chat-shell__settings-main">
          <Suspense fallback={<div className="chat-shell__settings-loading">…</div>}>
            {section && (
              <SettingsContent
                section={section}
                surface="dialog"
                theme={theme}
                onThemeChange={onThemeChange}
              />
            )}
            {category === 'admin' && isAdmin && (
              <div className="chat-shell__admin-embed">
                <AdminDashboard embedded onOpenTickets={() => setCategory('tickets')} />
              </div>
            )}
            {category === 'tickets' && isAdmin && (
              <div className="chat-shell__admin-embed">
                <AdminTickets embedded />
              </div>
            )}
          </Suspense>
        </div>
      </div>
    </div>
  )
}
