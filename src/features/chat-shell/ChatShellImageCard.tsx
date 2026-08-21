import { useMemo, useState } from 'react'
import { Loader2, Download, Pencil } from 'lucide-react'
import type { MessageArtifact } from '../../types'
import { shellT, type ChatShellLanguage } from './chatShellLabels'
import type { ShellImageLike } from './chatShellImages'
import { downloadShellImage, filenameForShellImage } from './chatShellDownload'

interface ChatShellImageCardProps {
  artifact: MessageArtifact
  productName?: string | null
  busy?: boolean
  language?: ChatShellLanguage
  versions?: ShellImageLike[]
  onOpen?: (image: ShellImageLike) => void
  onRequestEdit?: (image: ShellImageLike) => void
}

function aspectFromAssumptions(text: string | null): string | undefined {
  const match = text?.match(/\b(9:16|3:4|1:1|16:9|4:5|4:3)\b/)
  return match?.[1]
}

function versionTitle(index: number, total: number, language: ChatShellLanguage): string {
  const es = language === 'es'
  if (index === total - 1) return es ? 'Última' : 'Latest'
  if (index === 0) return es ? 'Original' : 'Original'
  return `v${index + 1}`
}

export default function ChatShellImageCard({
  artifact,
  productName,
  busy = false,
  language = 'es',
  versions = [],
  onOpen,
  onRequestEdit,
}: ChatShellImageCardProps) {
  const t = shellT(language)
  const orderedVersions = useMemo(() => {
    if (versions.length) return versions
    return artifact.product_image ? [artifact.product_image] : []
  }, [artifact.product_image, versions])
  const latestIndex = Math.max(0, orderedVersions.length - 1)
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const activeIndex = viewIndex == null || viewIndex > latestIndex ? latestIndex : viewIndex
  const image = orderedVersions[activeIndex] || artifact.product_image
  const url = image?.image_url
  const [error, setError] = useState<string | null>(null)
  const [imageStatus, setImageStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [downloading, setDownloading] = useState(false)

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

  const isBusy = busy
  const openSelected = () => onOpen?.(image)

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

      {orderedVersions.length > 1 ? (
        <div className="chat-shell__script-versions" aria-label={language === 'es' ? 'Versiones de la imagen' : 'Image versions'}>
          {orderedVersions.map((version, index) => {
            const title = versionTitle(index, orderedVersions.length, language)
            return (
              <button
                key={version.id}
                type="button"
                className={index === activeIndex ? 'is-on' : ''}
                title={version.label || title}
                aria-label={title}
                onClick={() => setViewIndex(index === latestIndex ? null : index)}
              >
                {title}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="chat-shell__image-version-layout">
        <button
          type="button"
          className="chat-shell__image-shot-wrap"
          onClick={openSelected}
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
      </div>

      {error ? <div className="chat-shell__artifact-error">{error}</div> : null}

      <div className="chat-shell__artifact-actions">
        <button
          type="button"
          className="chat-shell__artifact-action"
          disabled={downloading}
          onClick={() => {
            setDownloading(true)
            void downloadShellImage(
              url,
              filenameForShellImage({ productName, label: image.label, url })
            ).finally(() => setDownloading(false))
          }}
        >
          {downloading ? <Loader2 size={13} className="chat-shell__spin" /> : <Download size={13} />}
          {t.downloadImage}
        </button>
        {onRequestEdit ? (
          <button
            type="button"
            className="chat-shell__artifact-action"
            disabled={isBusy}
            onClick={() => onRequestEdit(image)}
          >
            <Pencil size={13} />
            {t.requestEdit}
          </button>
        ) : null}
      </div>
    </article>
  )
}
