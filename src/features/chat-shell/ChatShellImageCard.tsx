import { useState } from 'react'
import { Loader2, Download, Pencil, Wand2 } from 'lucide-react'
import type { MessageArtifact } from '../../types'
import { shellT, type ChatShellLanguage } from './chatShellLabels'
import type { ShellImageLike } from './chatShellImages'

interface ChatShellImageCardProps {
  artifact: MessageArtifact
  productName?: string | null
  busy?: boolean
  language?: ChatShellLanguage
  onOpen?: () => void
  onRequestEdit?: () => void
  onOptimizeForPost?: (productId: string) => void
  versions?: ShellImageLike[]
  onOpenVersion?: (image: ShellImageLike) => void
}

function aspectFromAssumptions(text: string | null): string | undefined {
  const match = text?.match(/\b(9:16|3:4|1:1|16:9|4:5|4:3)\b/)
  return match?.[1]
}

export default function ChatShellImageCard({
  artifact,
  productName,
  busy = false,
  language = 'es',
  onOpen,
  onRequestEdit,
  onOptimizeForPost,
  versions = [],
  onOpenVersion,
}: ChatShellImageCardProps) {
  const t = shellT(language)
  const image = artifact.product_image
  const url = image?.image_url
  const [error, setError] = useState<string | null>(null)
  const [imageStatus, setImageStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  const assumptions =
    typeof artifact.action_metadata?.assumptions === 'string'
      ? artifact.action_metadata.assumptions
      : null
  const aspect = aspectFromAssumptions(assumptions)

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

  const runOptimize = () => {
    if (!onOptimizeForPost) return
    const productId = artifact.product_id
    if (!productId) return
    onOptimizeForPost(productId)
  }

  const isBusy = busy

  return (
    <article className="chat-shell__artifact chat-shell__artifact--image">
      <header className="chat-shell__artifact-head">
        <div className="chat-shell__artifact-title-row">
          <strong className="chat-shell__artifact-title">
            {productName || image.label || 'Image'}
          </strong>
          {assumptions ? (
            <span className="chat-shell__artifact-offer">{assumptions}</span>
          ) : productName ? (
            <span className="chat-shell__artifact-offer">{productName}</span>
          ) : null}
        </div>
        <span className="chat-shell__artifact-index">#{artifact.ordinal}</span>
      </header>

      <div className="chat-shell__image-version-layout">
        <button
          type="button"
          className="chat-shell__image-shot-wrap"
          onClick={onOpen}
          aria-label={t.viewImage}
        >
          <img
            className="chat-shell__image-shot"
            src={url}
            alt={image.label || productName || 'Generated'}
            data-aspect={aspect || undefined}
            onLoad={() => setImageStatus('ready')}
            onError={() => {
              setImageStatus('failed')
              setError(language === 'es'
                ? 'La imagen existe, pero el navegador no pudo mostrarla. Abrila o descargala para reintentar.'
                : 'The image exists, but the browser could not display it. Open or download it to retry.')
            }}
          />
          {imageStatus === 'loading' ? (
            <span className="chat-shell__image-loading"><Loader2 size={18} className="chat-shell__spin" /></span>
          ) : null}
        </button>
        {versions.length > 1 ? (
          <div className="chat-shell__image-versions" aria-label={language === 'es' ? 'Versiones anteriores' : 'Previous versions'}>
            {versions.slice(1, 6).map((version, index) => (
              <button key={version.id} type="button" onClick={() => onOpenVersion?.(version)} title={version.label || `Version ${index + 2}`}>
                <img src={version.image_url} alt={version.label || `Version ${index + 2}`} />
                <span>v{versions.length - index - 1}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <div className="chat-shell__artifact-error">{error}</div> : null}

      <div className="chat-shell__artifact-actions">
        <a
          className="chat-shell__artifact-action"
          href={url}
          download
          target="_blank"
          rel="noreferrer"
        >
          <Download size={13} />
          Download
        </a>
        {onRequestEdit ? (
          <button
            type="button"
            className="chat-shell__artifact-action"
            disabled={isBusy}
            onClick={onRequestEdit}
          >
            <Pencil size={13} />
            {t.requestEdit}
          </button>
        ) : null}
        {onOptimizeForPost ? (
          <button
            type="button"
            className="chat-shell__artifact-action"
            disabled={isBusy}
            onClick={runOptimize}
          >
            <Wand2 size={13} />
            {t.optimizeForPost}
          </button>
        ) : null}
      </div>
    </article>
  )
}
