import { useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, RotateCw, Send, Wand2, X } from 'lucide-react'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

export interface ImageEditAttachment {
  dataUrl: string
  role: 'product' | 'context'
  name: string
}

interface ChatShellImageLightboxProps {
  open: boolean
  url: string
  alt?: string
  productName?: string | null
  language?: ChatShellLanguage
  busy?: boolean
  onClose: () => void
  onRequestEdit?: (reason: string, attachments?: ImageEditAttachment[]) => void | Promise<void>
  onQuickEnhance?: (mode: 'magic' | 'rebuild') => void | Promise<void>
}

const MAX_EDIT_ATTACHMENTS = 4

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
  const es = language === 'es'
  const [reason, setReason] = useState('')
  const [attachments, setAttachments] = useState<ImageEditAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setReason('')
      setAttachments([])
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
    void onRequestEdit(trimmed, attachments)
  }

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return
    const remaining = MAX_EDIT_ATTACHMENTS - attachments.length
    const selected = Array.from(files).slice(0, remaining)
    selected.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result || '')
        if (!dataUrl) return
        setAttachments((prev) => {
          if (prev.length >= MAX_EDIT_ATTACHMENTS) return prev
          return [...prev, { dataUrl, role: 'product', name: file.name }]
        })
      }
      reader.readAsDataURL(file)
    })
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                className="chat-shell__artifact-action"
                disabled={busy || attachments.length >= MAX_EDIT_ATTACHMENTS}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus size={13} />
                {es ? 'Imagen' : 'Image'}
              </button>
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
          {attachments.length > 0 ? (
            <div className="chat-shell__lightbox-attachments" aria-label={es ? 'Referencias de edición' : 'Edit references'}>
              {attachments.map((attachment, index) => (
                <div key={`${attachment.name}-${index}`} className="chat-shell__lightbox-attachment">
                  <img src={attachment.dataUrl} alt={attachment.name} />
                  <select
                    value={attachment.role}
                    disabled={busy}
                    aria-label={es ? 'Rol de la imagen' : 'Image role'}
                    onChange={(event) => {
                      const role = event.target.value === 'context' ? 'context' : 'product'
                      setAttachments((prev) => prev.map((item, itemIndex) => (
                        itemIndex === index ? { ...item, role } : item
                      )))
                    }}
                  >
                    <option value="product">{es ? 'Producto' : 'Product'}</option>
                    <option value="context">{es ? 'Contexto' : 'Context'}</option>
                  </select>
                  <button
                    type="button"
                    className="chat-shell__lightbox-attachment-remove"
                    disabled={busy}
                    onClick={() => setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                    aria-label={es ? 'Quitar imagen' : 'Remove image'}
                  >
                    ×
                  </button>
                </div>
              ))}
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
