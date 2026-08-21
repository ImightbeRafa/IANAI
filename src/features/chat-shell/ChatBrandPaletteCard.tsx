import { useState } from 'react'
import { normalizeHexColor, type PaletteDraft } from './chatShellBrandSetupFlow'

const COPY = {
  es: {
    title: 'Paleta de marca',
    hint: 'Ajustá los colores del sitio y guardalos. Los uso en los posts.',
    primary: 'Primario',
    secondary: 'Secundario',
    accent: 'Acento',
    fromSite: 'Del sitio',
    save: 'Guardar paleta',
    skip: 'Saltar',
  },
  en: {
    title: 'Brand palette',
    hint: 'Tune the site colors and save them. I’ll use them on posts.',
    primary: 'Primary',
    secondary: 'Secondary',
    accent: 'Accent',
    fromSite: 'From the site',
    save: 'Save palette',
    skip: 'Skip',
  },
} as const

type Slot = 'primary' | 'secondary' | 'accent'

interface ChatBrandPaletteCardProps {
  language?: 'en' | 'es'
  draft: PaletteDraft
  busy?: boolean
  onSave: (draft: PaletteDraft) => void | Promise<void>
  onSkip: () => void
}

export default function ChatBrandPaletteCard({
  language = 'es',
  draft,
  busy = false,
  onSave,
  onSkip,
}: ChatBrandPaletteCardProps) {
  const t = COPY[language]
  const [local, setLocal] = useState<PaletteDraft>(draft)
  const [active, setActive] = useState<Slot>('primary')

  const setSlot = (slot: Slot, value: string) => {
    const hex = normalizeHexColor(value) || value
    setLocal((prev) => ({ ...prev, [slot]: hex }))
  }

  const applyCandidate = (hex: string) => {
    setSlot(active, hex)
  }

  const slots: Slot[] = ['primary', 'secondary', 'accent']

  return (
    <div className="chat-shell__palette" aria-label={t.title}>
      <div className="chat-shell__palette-head">
        <strong>{t.title}</strong>
        <span>{t.hint}</span>
      </div>
      {local.logoUrl ? (
        <img className="chat-shell__palette-logo" src={local.logoUrl} alt="" />
      ) : null}
      <div className="chat-shell__palette-slots">
        {slots.map((slot) => (
          <label
            key={slot}
            className={`chat-shell__palette-slot${active === slot ? ' is-on' : ''}`}
          >
            <button
              type="button"
              className="chat-shell__palette-swatch"
              style={{ background: local[slot] || '#27272a' }}
              aria-label={t[slot]}
              onClick={() => setActive(slot)}
            />
            <span>{t[slot]}</span>
            <input
              type="text"
              value={local[slot]}
              spellCheck={false}
              disabled={busy}
              onFocus={() => setActive(slot)}
              onChange={(e) => setSlot(slot, e.target.value)}
            />
            <input
              type="color"
              value={normalizeHexColor(local[slot]) || '#71717a'}
              disabled={busy}
              onFocus={() => setActive(slot)}
              onChange={(e) => setSlot(slot, e.target.value)}
              aria-label={t[slot]}
            />
          </label>
        ))}
      </div>
      {local.candidates.length > 0 ? (
        <div className="chat-shell__palette-cands">
          <span>{t.fromSite}</span>
          {local.candidates.map((hex) => (
            <button
              key={hex}
              type="button"
              className="chat-shell__palette-cand"
              style={{ background: hex }}
              title={hex}
              disabled={busy}
              onClick={() => applyCandidate(hex)}
            />
          ))}
        </div>
      ) : null}
      <div className="chat-shell__palette-actions">
        <button
          type="button"
          className="chat-shell__setup-skip"
          disabled={busy}
          onClick={onSkip}
        >
          {t.skip}
        </button>
        <button
          type="button"
          className="chat-shell__btn chat-shell__btn--primary"
          disabled={busy}
          onClick={() => void onSave(local)}
        >
          {t.save}
        </button>
      </div>
    </div>
  )
}
