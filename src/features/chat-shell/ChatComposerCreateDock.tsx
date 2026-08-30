import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import { IconAdvanceMark, IconDoc, IconImage, IconOffer, IconRefs } from './ChatShellIcons'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

export type ComposerCreateActionId = 'scripts' | 'post' | 'product' | 'bulk'

export interface ComposerCreateAction {
  id: ComposerCreateActionId
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  /** Shown in title when disabled (e.g. kit not ready). */
  blockedReason?: string
}

interface ChatComposerCreateDockProps {
  language: ChatShellLanguage
  available: boolean
  hidden: boolean
  title: string
  reviewPanel: ReactNode
  actions: ComposerCreateAction[]
  onHide: () => void
  onShow: () => void
}

function actionIcon(id: ComposerCreateActionId) {
  switch (id) {
    case 'scripts':
      return <IconDoc size={14} />
    case 'post':
      return <IconImage size={14} />
    case 'product':
      return <IconOffer size={14} />
    case 'bulk':
      return <IconRefs size={14} />
    default: {
      const _never: never = id
      return _never
    }
  }
}

/**
 * Idle-bar glass row: Brand Kit chip + Guiones/Post/Foto/Pack in one horizontal row ABOVE the typing card.
 */
export default function ChatComposerCreateDock({
  language,
  available,
  hidden,
  title,
  reviewPanel,
  actions,
  onHide,
  onShow,
}: ChatComposerCreateDockProps) {
  const t = shellT(language)
  const rootRef = useRef<HTMLDivElement>(null)
  const [reviewOpen, setReviewOpen] = useState(false)

  useEffect(() => {
    if (hidden) setReviewOpen(false)
  }, [hidden])

  useEffect(() => {
    if (!reviewOpen) return
    const onDoc = (event: MouseEvent) => {
      const node = rootRef.current
      if (!node || node.contains(event.target as Node)) return
      setReviewOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setReviewOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [reviewOpen])

  if (!available) return null

  if (hidden) {
    return (
      <div className="chat-shell__idle-glass is-collapsed" ref={rootRef}>
        <button
          type="button"
          className="chat-shell__composer-show"
          aria-label={t.showCreateWidget}
          title={t.showCreateWidget}
          onClick={onShow}
        >
          <PanelLeft size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <div className="chat-shell__idle-glass" ref={rootRef}>
      {reviewOpen ? (
        <div className="chat-shell__create-popover is-rail" role="dialog" aria-label={t.reviewKit}>
          {reviewPanel}
        </div>
      ) : null}
      <div className="chat-shell__idle-glass-row">
        <div className="chat-shell__idle-kit">
          <button
            type="button"
            className={`chat-shell__composer-create${reviewOpen ? ' is-open' : ''}`}
            aria-label={t.reviewKit}
            title={t.reviewKit}
            aria-expanded={reviewOpen}
            aria-haspopup="dialog"
            onClick={() => setReviewOpen((value) => !value)}
          >
            <IconAdvanceMark size={16} />
          </button>
          <p className="chat-shell__idle-kit-title">
            <strong>{title}</strong>
          </p>
          <button
            type="button"
            className="chat-shell__composer-hide"
            aria-label={t.hideCreateWidget}
            title={t.hideCreateWidget}
            onClick={() => {
              setReviewOpen(false)
              onHide()
            }}
          >
            <PanelLeftClose size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="chat-shell__idle-actions" role="toolbar" aria-label={t.kitTitle}>
          {actions.map((action) => {
            const title = action.disabled && action.blockedReason
              ? `${action.label} — ${action.blockedReason}`
              : action.label
            return (
            <button
              key={action.id}
              type="button"
              disabled={action.disabled}
              className={action.active ? 'is-on' : undefined}
              aria-pressed={action.active ? true : false}
              aria-label={title}
              title={title}
              onClick={() => {
                setReviewOpen(false)
                action.onClick()
              }}
            >
              {actionIcon(action.id)}
              <span>{action.label}</span>
              {action.disabled && action.blockedReason ? (
                <em className="chat-shell__idle-action-block">{action.blockedReason}</em>
              ) : null}
            </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
