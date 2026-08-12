import { useState } from 'react'
import { Loader2, Download, Pencil, Wand2, X, Send } from 'lucide-react'
import type { MessageArtifact } from '../../types'

interface ChatShellImageCardProps {
  artifact: MessageArtifact
  productName?: string | null
  busy?: boolean
  onEditImage?: (productImageId: string, imageUrl: string, instruction: string) => Promise<void>
  onOptimizeForPost?: (productImageId: string, imageUrl: string) => Promise<void>
}

export default function ChatShellImageCard({
  artifact,
  productName,
  busy = false,
  onEditImage,
  onOptimizeForPost,
}: ChatShellImageCardProps) {
  const image = artifact.product_image
  const url = image?.image_url
  const [showEdit, setShowEdit] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [localBusy, setLocalBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!url || !image) {
    return (
      <article className="chat-shell__artifact chat-shell__artifact--image">
        <header className="chat-shell__artifact-head">
          <strong className="chat-shell__artifact-title">Image</strong>
          <span className="chat-shell__artifact-index">#{artifact.ordinal}</span>
        </header>
        <p className="chat-shell__rail-hint">Image missing.</p>
      </article>
    )
  }

  const runEdit = async () => {
    if (!onEditImage || !instruction.trim() || localBusy) return
    setLocalBusy(true)
    setError(null)
    try {
      await onEditImage(image.id, url, instruction.trim())
      setShowEdit(false)
      setInstruction('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setLocalBusy(false)
    }
  }

  const runOptimize = async () => {
    if (!onOptimizeForPost || localBusy) return
    setLocalBusy(true)
    setError(null)
    try {
      await onOptimizeForPost(image.id, url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimize failed')
    } finally {
      setLocalBusy(false)
    }
  }

  const downloading = false
  const isBusy = busy || localBusy

  return (
    <article className="chat-shell__artifact chat-shell__artifact--image">
      <header className="chat-shell__artifact-head">
        <div className="chat-shell__artifact-title-row">
          <strong className="chat-shell__artifact-title">
            {image.label || 'Image'}
          </strong>
          {productName ? (
            <span className="chat-shell__artifact-offer">{productName}</span>
          ) : null}
        </div>
        <span className="chat-shell__artifact-index">#{artifact.ordinal}</span>
      </header>

      <div className="chat-shell__image-frame">
        <img src={url} alt={image.label || productName || 'Generated'} />
      </div>

      {showEdit ? (
        <div className="chat-shell__artifact-edit">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="Describe the image change…"
            disabled={isBusy}
          />
          <div className="chat-shell__artifact-edit-actions">
            <button
              type="button"
              className="chat-shell__artifact-action is-primary"
              disabled={!instruction.trim() || isBusy}
              onClick={() => void runEdit()}
            >
              {isBusy ? <Loader2 size={14} className="chat-shell__spin" /> : <Send size={14} />}
            </button>
            <button
              type="button"
              className="chat-shell__artifact-action"
              onClick={() => {
                setShowEdit(false)
                setInstruction('')
                setError(null)
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="chat-shell__artifact-error">{error}</div> : null}

      <div className="chat-shell__artifact-actions">
        <a
          className="chat-shell__artifact-action"
          href={url}
          download
          target="_blank"
          rel="noreferrer"
          aria-disabled={downloading}
        >
          <Download size={13} />
          Download
        </a>
        {onEditImage ? (
          <button
            type="button"
            className="chat-shell__artifact-action"
            disabled={isBusy}
            onClick={() => setShowEdit(true)}
          >
            <Pencil size={13} />
            Edit image
          </button>
        ) : null}
        {onOptimizeForPost ? (
          <button
            type="button"
            className="chat-shell__artifact-action"
            disabled={isBusy}
            onClick={() => void runOptimize()}
          >
            {isBusy ? <Loader2 size={13} className="chat-shell__spin" /> : <Wand2 size={13} />}
            Optimize for post
          </button>
        ) : null}
      </div>
    </article>
  )
}
