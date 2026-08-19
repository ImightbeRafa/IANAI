import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EyeOff, Sparkles } from 'lucide-react'
import { IconAdvanceMark } from './ChatShellIcons'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

interface ChatComposerCreateDockProps {
  language: ChatShellLanguage
  available: boolean
  hidden: boolean
  panel: ReactNode
  onHide: () => void
  onShow: () => void
}

export default function ChatComposerCreateDock({
  language,
  available,
  hidden,
  panel,
  onHide,
  onShow,
}: ChatComposerCreateDockProps) {
  const t = shellT(language)
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (hidden) setOpen(false)
  }, [hidden])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const node = rootRef.current
      if (!node || node.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!available) return null

  const show = () => {
    onShow()
    setOpen(true)
  }

  return (
    <div className="chat-shell__composer-lead" ref={rootRef}>
      {open && !hidden ? (
        <div className="chat-shell__create-popover" role="dialog" aria-label={t.create}>
          {panel}
        </div>
      ) : null}
      {hidden ? (
        <button
          type="button"
          className="chat-shell__composer-create is-muted"
          aria-label={t.showCreateWidget}
          title={t.showCreateWidget}
          onClick={show}
        >
          <Sparkles size={16} aria-hidden />
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`chat-shell__composer-create${open ? ' is-open' : ''}`}
            aria-label={t.create}
            title={t.create}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((value) => !value)}
          >
            <IconAdvanceMark size={16} />
          </button>
          <button
            type="button"
            className="chat-shell__composer-hide"
            aria-label={t.hideCreateWidget}
            title={t.hideCreateWidget}
            onClick={() => {
              setOpen(false)
              onHide()
            }}
          >
            <EyeOff size={15} aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}
