import { useEffect, useId, type ReactNode } from 'react'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

export interface ChatShellFlowSheetAction {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
}

interface ChatShellFlowSheetProps {
  open: boolean
  language: ChatShellLanguage
  title: string
  copy?: string
  step?: number
  stepTotal?: number
  creditsLine?: string | null
  children: ReactNode
  onCancel: () => void
  onBack?: (() => void) | null
  cancelDisabled?: boolean
  secondary?: ChatShellFlowSheetAction | null
  primary?: ChatShellFlowSheetAction | null
  /** Wider sheet for script grids */
  wide?: boolean
}

/**
 * Pack-family center overlay: dim backdrop, title, step n/n, body, footer Cancel / Back / secondary / primary.
 * Cancel must close with no transcript side effects (caller owns cleanup).
 */
export default function ChatShellFlowSheet({
  open,
  language,
  title,
  copy,
  step,
  stepTotal,
  creditsLine,
  children,
  onCancel,
  onBack,
  cancelDisabled,
  secondary,
  primary,
  wide,
}: ChatShellFlowSheetProps) {
  const t = shellT(language)
  const titleId = useId()
  const es = language === 'es'

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !cancelDisabled) {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cancelDisabled, onCancel, open])

  if (!open) return null

  const showStep = typeof step === 'number' && typeof stepTotal === 'number' && stepTotal > 0

  return (
    <div className="chat-shell__modal-root" role="presentation">
      <button
        type="button"
        className="chat-shell__modal-backdrop"
        aria-label={t.cancel}
        disabled={cancelDisabled}
        onClick={() => {
          if (!cancelDisabled) onCancel()
        }}
      />
      <div
        className={`chat-shell__modal chat-shell__modal--flow${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="chat-shell__modal-head">
          <h2 id={titleId} className="chat-shell__modal-title">{title}</h2>
          {showStep ? (
            <p className="chat-shell__modal-step" aria-live="polite">
              {es ? `Paso ${step} de ${stepTotal}` : `Step ${step} of ${stepTotal}`}
            </p>
          ) : null}
        </div>
        {copy ? <p className="chat-shell__modal-copy">{copy}</p> : null}
        <div className="chat-shell__modal-body">{children}</div>
        {creditsLine ? (
          <p className="chat-shell__modal-credits" role="status">
            {creditsLine}
          </p>
        ) : null}
        <div className="chat-shell__modal-actions">
          <button
            type="button"
            className="chat-shell__modal-btn"
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            {t.cancel}
          </button>
          {onBack ? (
            <button
              type="button"
              className="chat-shell__modal-btn"
              disabled={cancelDisabled}
              onClick={onBack}
            >
              {t.flowBack}
            </button>
          ) : null}
          {secondary ? (
            <button
              type="button"
              className="chat-shell__modal-btn"
              disabled={secondary.disabled}
              onClick={secondary.onClick}
            >
              {secondary.label}
            </button>
          ) : null}
          {primary ? (
            <button
              type="button"
              className="chat-shell__modal-btn is-primary"
              disabled={primary.disabled}
              onClick={primary.onClick}
            >
              {primary.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
