import { useRef } from 'react'
import type { OfferReferenceImage, ReferenceRole } from './chatShellReferenceSelection'
import {
  MAX_POST_REFERENCE_IMAGES,
  groupOfferReferences,
} from './chatShellReferenceSelection'

interface ChatShellReferencePickerProps {
  images: OfferReferenceImage[]
  currentProductId?: string | null
  language?: 'en' | 'es'
  busy?: boolean
  compact?: boolean
  onToggle: (id: string) => void
  onUpload?: (file: File, kind: ReferenceRole) => void | Promise<void>
  onRemove?: (id: string) => void | Promise<void>
}

export default function ChatShellReferencePicker({
  images,
  currentProductId,
  language = 'es',
  busy = false,
  compact = false,
  onToggle,
  onUpload,
  onRemove,
}: ChatShellReferencePickerProps) {
  const es = language === 'es'
  const productInputRef = useRef<HTMLInputElement>(null)
  const contextInputRef = useRef<HTMLInputElement>(null)
  const groups = groupOfferReferences(images, currentProductId || '')
  const selectedCount = images.filter((img) => img.selected === true).length

  const renderTile = (image: OfferReferenceImage, groupLabel?: string) => (
    <div key={image.id} className="chat-shell__ref-picker-wrap">
      <button
        type="button"
        className={`chat-shell__ref-picker-tile${image.selected === true ? ' is-selected' : ''}`}
        disabled={busy}
        onClick={() => onToggle(image.id)}
      >
        <img src={image.url} alt={image.label || image.kind} />
        <span>
          {image.kind === 'context'
            ? (es ? 'Contexto' : 'Context')
            : (es ? 'Producto' : 'Product')}
        </span>
        <small>
          {image.selected === true
            ? (es ? 'Usar' : 'Use')
            : (es ? 'No usar' : 'Skip')}
        </small>
        {groupLabel ? <em>{groupLabel}</em> : null}
      </button>
      {onRemove ? (
        <button
          type="button"
          className="chat-shell__ref-picker-remove"
          disabled={busy}
          onClick={() => void onRemove(image.id)}
          aria-label={es ? 'Eliminar referencia' : 'Remove reference'}
        >
          ×
        </button>
      ) : null}
    </div>
  )

  return (
    <div className={`chat-shell__ref-picker${compact ? ' is-compact' : ''}`}>
      <p className="chat-shell__ref-picker-lead">
        {es
          ? `Elegí hasta ${MAX_POST_REFERENCE_IMAGES} fotos: producto (verdad visual), contexto (escena) y estilo. ${selectedCount} seleccionada${selectedCount === 1 ? '' : 's'}.`
          : `Pick up to ${MAX_POST_REFERENCE_IMAGES} photos: product (visual truth), context (scene), and style. ${selectedCount} selected.`}
      </p>
      {groups.currentProduct.length > 0 ? (
        <section className="chat-shell__ref-picker-group" aria-label={es ? 'Producto' : 'Product'}>
          <h4>{es ? 'Producto · ángulos' : 'Product · angles'}</h4>
          <div className="chat-shell__ref-picker-grid">
            {groups.currentProduct.map((image) => renderTile(image))}
          </div>
        </section>
      ) : null}
      {groups.currentContext.length > 0 ? (
        <section className="chat-shell__ref-picker-group" aria-label={es ? 'Contexto' : 'Context'}>
          <h4>{es ? 'Contexto / estilo' : 'Context / style'}</h4>
          <div className="chat-shell__ref-picker-grid">
            {groups.currentContext.map((image) => renderTile(image))}
          </div>
        </section>
      ) : null}
      {groups.otherOffers.length > 0 ? (
        <section className="chat-shell__ref-picker-group" aria-label={es ? 'Otras ofertas' : 'Other offers'}>
          <h4>{es ? 'Otras ofertas de la marca' : 'Other brand offers'}</h4>
          <div className="chat-shell__ref-picker-grid">
            {groups.otherOffers.map((image) => renderTile(image, image.productName || undefined))}
          </div>
        </section>
      ) : null}
      {images.length === 0 ? (
        <p className="chat-shell__ref-picker-empty">
          {es
            ? 'Todavía no hay fotos. Subí producto, contexto o un post de referencia.'
            : 'No photos yet. Upload a product, context, or style reference.'}
        </p>
      ) : null}
      {onUpload ? (
        <div className="chat-shell__ref-picker-actions">
          <input
            ref={productInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onUpload(file, 'product')
              event.target.value = ''
            }}
          />
          <input
            ref={contextInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onUpload(file, 'context')
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className="chat-shell__btn chat-shell__btn--pill"
            disabled={busy}
            onClick={() => productInputRef.current?.click()}
          >
            {es ? 'Subir producto' : 'Upload product'}
          </button>
          <button
            type="button"
            className="chat-shell__btn chat-shell__btn--pill"
            disabled={busy}
            onClick={() => contextInputRef.current?.click()}
          >
            {es ? 'Subir contexto o estilo' : 'Upload context or style'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
