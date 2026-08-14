import { useEffect, useState } from 'react'
import { Download, RotateCw, Send, Wand2, X } from 'lucide-react'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

interface ChatShellImageLightboxProps {
  open: boolean
  url: string
  alt?: string
  productName?: string | null
  language?: ChatShellLanguage
  busy?: boolean
  onClose: () => void
  onRequestEdit?: (reason: string) => void | Promise<void>
  onQuickEnhance?: (mode: 'magic' | 'rebuild') => void | Promise<void>
}

export default function ChatShellImageLightbox({
  open,
  url,
  alt,
  productName,
  language = 'es',
  busy = false,
  onClose,
  onRequestEdit,
  onQuickEnhance,
}: ChatShellImageLightboxProps) {
  const t = shellT(language)
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) {
      setReason('')
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const submit = () => {
    const trimmed = reason.trim()
    if (!trimmed || busy || !onRequestEdit) return
    void onRequestEdit(trimmed)
  }

  return (
    <div className="chat-shell__lightbox" role="dialog" aria-modal="true" aria-label={t.viewImage}>
      <button
        type="button"
        className="chat-shell__lightbox-backdrop"
        aria-label={t.closeRail}
        onClick={onClose}
      />
      <div className="chat-shell__lightbox-panel">
        <header className="chat-shell__lightbox-head">
          <strong>{productName || alt || t.viewImage}</strong>
          <button type="button" className="chat-shell__lightbox-close" onClick={onClose} aria-label={t.closeRail}>
            <X size={16} />
          </button>
        </header>
        <div className="chat-shell__lightbox-stage">
          <img src={url} alt={alt || productName || t.viewImage} />
        </div>
        <footer className="chat-shell__lightbox-foot">
          <a className="chat-shell__artifact-action" href={url} download target="_blank" rel="noreferrer">
            <Download size={13} />
            Download
          </a>
          {onRequestEdit ? (
            <div className="chat-shell__lightbox-edit">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t.editReason}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
              <button
                type="button"
                className="chat-shell__artifact-action is-primary"
                disabled={!reason.trim() || busy}
                onClick={submit}
              >
                <Send size={13} />
                {t.requestEdit}
              </button>
            </div>
          ) : null}
          {onQuickEnhance ? (
            <div className="chat-shell__lightbox-quick-actions">
              <button type="button" className="chat-shell__artifact-action" disabled={busy} onClick={() => void onQuickEnhance('magic')}>
                <Wand2 size={13} /> {language === 'es' ? 'Mejora mágica' : 'Magic enhance'}
              </button>
              <button type="button" className="chat-shell__artifact-action" disabled={busy} onClick={() => void onQuickEnhance('rebuild')}>
                <RotateCw size={13} /> {language === 'es' ? 'Reconstruir' : 'Rebuild'}
              </button>
            </div>
          ) : null}
        </footer>
      </div>
    </div>
  )
}
