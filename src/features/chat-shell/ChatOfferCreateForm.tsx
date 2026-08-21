import { useId, useState } from 'react'
import type { ProductType } from '../../types'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

const OFFER_TYPES: Array<{ value: ProductType; labelEs: string; labelEn: string }> = [
  { value: 'product', labelEs: 'Producto', labelEn: 'Product' },
  { value: 'service', labelEs: 'Servicio', labelEn: 'Service' },
  { value: 'restaurant', labelEs: 'Restaurante', labelEn: 'Restaurant' },
  { value: 'real_estate', labelEs: 'Bienes raíces', labelEn: 'Real estate' },
  { value: 'indumentaria', labelEs: 'Indumentaria', labelEn: 'Apparel' },
]

interface ChatOfferCreateFormProps {
  language?: ChatShellLanguage
  busy?: boolean
  disabled?: boolean
  onCreate: (name: string, type: ProductType) => void | Promise<boolean | void>
}

export default function ChatOfferCreateForm({
  language = 'es',
  busy = false,
  disabled = false,
  onCreate,
}: ChatOfferCreateFormProps) {
  const t = shellT(language)
  const nameId = useId()
  const typeId = useId()
  const [name, setName] = useState('')
  const [type, setType] = useState<ProductType>('product')
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setLocalError(t.offerNameRequired)
      return
    }
    setLocalError(null)
    const ok = await onCreate(trimmed, type)
    if (ok !== false) {
      setName('')
      setType('product')
    }
  }

  return (
    <div className="chat-shell__offer-create">
      <p className="chat-shell__inspector-kicker">{t.createOfferTitle}</p>
      <p className="chat-shell__rail-hint">{t.createOfferHint}</p>
      <label className="chat-shell__field" htmlFor={nameId}>
        <span>{t.offerNameLabel}</span>
        <input
          id={nameId}
          value={name}
          disabled={busy || disabled}
          placeholder={t.offerNamePlaceholder}
          onChange={(e) => {
            setName(e.target.value)
            if (localError) setLocalError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
      </label>
      <label className="chat-shell__field" htmlFor={typeId}>
        <span>{t.offerTypeLabel}</span>
        <select
          id={typeId}
          value={type}
          disabled={busy || disabled}
          onChange={(e) => setType(e.target.value as ProductType)}
        >
          {OFFER_TYPES.map((row) => (
            <option key={row.value} value={row.value}>
              {language === 'es' ? row.labelEs : row.labelEn}
            </option>
          ))}
        </select>
      </label>
      {localError ? (
        <p className="chat-shell__modal-error" role="alert">{localError}</p>
      ) : null}
      <button
        type="button"
        className="chat-shell__setup-btn is-primary"
        disabled={busy || disabled || !name.trim()}
        onClick={() => void submit()}
      >
        {busy ? t.creatingOffer : t.createOfferAction}
      </button>
    </div>
  )

}
