import { useEffect, useId, useRef, useState } from 'react'
import { validateBrandCreateName } from './chatShellBrandCreate'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

interface ChatBrandCreateModalProps {
  open: boolean
  busy: boolean
  error: string | null
  language?: ChatShellLanguage
  onClose: () => void
  onSubmit: (name: string) => void | Promise<void>
}

export default function ChatBrandCreateModal({
  open,
  busy,
  error,
  language = 'es',
  onClose,
  onSubmit,
}: ChatBrandCreateModalProps) {
  const t = shellT(language)
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setLocalError(null)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, busy, onClose])

  if (!open) return null

  const submit = () => {
    const validation = validateBrandCreateName(name)
    if (validation) {
      setLocalError(validation)
      return
    }
    setLocalError(null)
    void onSubmit(name.trim())
  }

  return (
    <div className="chat-shell__modal-root" role="presentation">
      <button
        type="button"
        className="chat-shell__modal-backdrop"
        aria-label={t.newBrandModalClose}
        disabled={busy}
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        className="chat-shell__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="chat-shell__modal-title">
          {t.brandModalTitle}
        </h2>
        <p className="chat-shell__modal-copy">
          {t.brandModalCopy}
        </p>
        <label className="chat-shell__modal-label" htmlFor="chat-shell-brand-name">
          {t.brandModalName}
        </label>
        <input
          ref={inputRef}
          id="chat-shell-brand-name"
          className="chat-shell__modal-input"
          value={name}
          disabled={busy}
          autoComplete="organization"
          placeholder={t.brandModalPlaceholder}
          onChange={(e) => {
            setName(e.target.value)
            if (localError) setLocalError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        {(localError || error) && (
          <div className="chat-shell__modal-error" role="alert">
            {localError || error}
          </div>
        )}
        <div className="chat-shell__modal-actions">
          <button
            type="button"
            className="chat-shell__modal-btn"
            disabled={busy}
            onClick={onClose}
          >
            {t.brandModalCancel}
          </button>
          <button
            type="button"
            className="chat-shell__modal-btn is-primary"
            disabled={busy}
            onClick={submit}
          >
            {busy ? t.brandModalCreating : t.brandModalCreate}
          </button>
        </div>
      </div>
    </div>
  )
}
