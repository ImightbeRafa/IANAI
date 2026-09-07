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
  /** Shown above the Subir rail (e.g. credits) — never overlapping the buttons. */
  creditsLine?: string | null
  onToggle: (id: string) => void
  onUpload?: (file: File, kind: ReferenceRole) => void | Promise<void>
  onRemove?: (id: string) => void | Promise<void>
}

function roleBadge(kind: ReferenceRole, es: boolean): string {
  if (kind === 'product') return es ? 'Producto' : 'Product'
  if (kind === 'style') return es ? 'Estilo' : 'Style'
  if (kind === 'logo') return es ? 'Logo' : 'Logo'
  return es ? 'Escena' : 'Scene'
}

export default function ChatShellReferencePicker({
  images,
  currentProductId,
  language = 'es',
  busy = false,
  compact = false,
  creditsLine = null,
  onToggle,
  onUpload,
  onRemove,
}: ChatShellReferencePickerProps) {
  const es = language === 'es'
  const productInputRef = useRef<HTMLInputElement>(null)
  const sceneInputRef = useRef<HTMLInputElement>(null)
  const styleInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
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
        <span>{roleBadge(image.kind, es)}</span>
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
          ? `Elegí hasta ${MAX_POST_REFERENCE_IMAGES} fotos: producto (verdad visual), escena, estilo o logo. ${selectedCount} seleccionada${selectedCount === 1 ? '' : 's'}.`
          : `Pick up to ${MAX_POST_REFERENCE_IMAGES} photos: product (visual truth), scene, style, or logo. ${selectedCount} selected.`}
      </p>
      {groups.currentProduct.length > 0 ? (
        <section className="chat-shell__ref-picker-group" aria-label={es ? 'Producto' : 'Product'}>
          <h4>{es ? 'Producto · ángulos' : 'Product · angles'}</h4>
          <div className="chat-shell__ref-picker-grid">
            {groups.currentProduct.map((image) => renderTile(image))}
          </div>
        </section>
      ) : null}
      {groups.currentScene.length > 0 ? (
        <section className="chat-shell__ref-picker-group" aria-label={es ? 'Escena' : 'Scene'}>
          <h4>{es ? 'Escena · inspiración' : 'Scene · inspiration'}</h4>
          <div className="chat-shell__ref-picker-grid">
            {groups.currentScene.map((image) => renderTile(image))}
          </div>
        </section>
      ) : null}
      {groups.currentStyle.length > 0 ? (
        <section className="chat-shell__ref-picker-group" aria-label={es ? 'Estilo' : 'Style'}>
          <h4>{es ? 'Estilo · post de referencia' : 'Style · post reference'}</h4>
          <div className="chat-shell__ref-picker-grid">
            {groups.currentStyle.map((image) => renderTile(image))}
          </div>
        </section>
      ) : null}
      {groups.currentLogo.length > 0 ? (
        <section className="chat-shell__ref-picker-group" aria-label={es ? 'Logo' : 'Logo'}>
          <h4>{es ? 'Logo · marca' : 'Logo · brand'}</h4>
          <div className="chat-shell__ref-picker-grid">
            {groups.currentLogo.map((image) => renderTile(image))}
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
            ? 'Todavía no hay fotos. Subí producto, escena, estilo o logo.'
            : 'No photos yet. Upload a product, scene, style, or logo.'}
        </p>
      ) : null}
      {creditsLine ? (
        <p className="chat-shell__modal-credits chat-shell__ref-picker-credits" role="status">
          {creditsLine}
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
            ref={sceneInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onUpload(file, 'scene')
              event.target.value = ''
            }}
          />
          <input
            ref={styleInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onUpload(file, 'style')
              event.target.value = ''
            }}
          />
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onUpload(file, 'logo')
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
            onClick={() => sceneInputRef.current?.click()}
          >
            {es ? 'Subir escena' : 'Upload scene'}
          </button>
          <button
            type="button"
            className="chat-shell__btn chat-shell__btn--pill"
            disabled={busy}
            onClick={() => styleInputRef.current?.click()}
          >
            {es ? 'Subir estilo' : 'Upload style'}
          </button>
          <button
            type="button"
            className="chat-shell__btn chat-shell__btn--pill"
            disabled={busy}
            onClick={() => logoInputRef.current?.click()}
          >
            {es ? 'Subir logo' : 'Upload logo'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
