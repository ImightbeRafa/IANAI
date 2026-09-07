import { Image as ImageIcon } from 'lucide-react'
import { LOGO_ARCHETYPES } from '../../data/image-presets'
import {
  anuncioStyleChoices,
  imageDensityUserLabel,
  organicStyleChoices,
  productStyleChoices,
  type ShellImagePreferences,
  type ShellImageStyle,
} from './chatShellImageIntent'
import type { ChatShellLanguage } from './chatShellLabels'

type ImageFamily = ShellImageStyle['kind']

interface ChatImageSettingsPanelProps {
  language: ChatShellLanguage
  preferences?: ShellImagePreferences
  onChange?: (patch: Partial<ShellImagePreferences>) => void
  onGenerate?: () => void | Promise<void>
  busy?: boolean
  hasOffer?: boolean
}

export default function ChatImageSettingsPanel({
  language,
  preferences,
  onChange,
  onGenerate,
  busy = false,
  hasOffer = false,
}: ChatImageSettingsPanelProps) {
  const es = language === 'es'
  const family: ImageFamily = preferences?.style?.kind || 'preset'
  const choices = family === 'preset'
    ? anuncioStyleChoices(language)
    : family === 'organic'
      ? organicStyleChoices(language)
      : family === 'product'
        ? productStyleChoices(language)
        : LOGO_ARCHETYPES.map((item) => ({ id: item.id, label: es ? item.nameEs : item.name }))
  const selectedStyle = family === 'preset'
    ? preferences?.style?.kind === 'preset' ? preferences.style.presetId : ''
    : family === 'organic'
      ? preferences?.style?.kind === 'organic' ? preferences.style.organicSubtype : ''
      : family === 'product'
        ? preferences?.style?.kind === 'product' ? preferences.style.productSubStyle : ''
        : preferences?.style?.kind === 'logo' ? preferences.style.archetype || 'auto' : 'auto'

  const chooseFamily = (next: ImageFamily) => {
    if (next === 'preset') onChange?.({ style: { kind: 'preset', presetId: 'venta-directa' } })
    if (next === 'organic') onChange?.({ style: { kind: 'organic', organicSubtype: 'quote-motivational' } })
    if (next === 'product') onChange?.({ style: { kind: 'product', productSubStyle: 'studio-hero' } })
    if (next === 'logo') onChange?.({ style: { kind: 'logo', archetype: 'auto' }, aspectRatio: '1:1', logoMode: 'generate' })
  }

  const chooseStyle = (id: string) => {
    if (family === 'preset') onChange?.({ style: { kind: 'preset', presetId: id } })
    if (family === 'organic') onChange?.({ style: { kind: 'organic', organicSubtype: id as 'quote-motivational' } })
    if (family === 'product') onChange?.({ style: { kind: 'product', productSubStyle: id } })
    if (family === 'logo') onChange?.({ style: { kind: 'logo', archetype: id }, aspectRatio: '1:1', logoMode: 'generate' })
  }

  return (
    <section className="chat-shell__image-settings">
      <div className="chat-shell__tool-panel-head">
        <ImageIcon size={16} />
        <div>
          <strong>{es ? 'Ajustes de imagen' : 'Image settings'}</strong>
          <p>{es
            ? 'Elegí un formato aquí o simplemente describilo en el chat.'
            : 'Choose a format here or simply describe it in chat.'}</p>
        </div>
      </div>

      <div className="chat-shell__segmented" role="tablist" aria-label={es ? 'Tipo de imagen' : 'Image type'}>
        {([
          ['preset', es ? 'Post' : 'Post'],
          ['organic', es ? 'Orgánico' : 'Organic'],
          ['product', es ? 'Producto' : 'Product'],
          ['logo', 'Logo'],
        ] as Array<[ImageFamily, string]>).map(([id, label]) => (
          <button key={id} type="button" className={family === id ? 'is-on' : ''} onClick={() => chooseFamily(id)}>
            {label}
          </button>
        ))}
      </div>

      <label className="chat-shell__field">
        <span>{es ? 'Estilo' : 'Style'}</span>
        <select value={selectedStyle} onChange={(event) => chooseStyle(event.target.value)}>
          {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>
      </label>

      <div className="chat-shell__image-setting-grid">
        <label className="chat-shell__field">
          <span>{es ? 'Formato' : 'Format'}</span>
          <select value={preferences?.aspectRatio || '9:16'} onChange={(event) => onChange?.({ aspectRatio: event.target.value as ShellImagePreferences['aspectRatio'] })}>
            <option value="9:16">9:16 · Story/Reel</option>
            <option value="3:4">3:4 · Feed</option>
            <option value="1:1">1:1 · Square</option>
          </select>
        </label>
        <label className="chat-shell__field">
          <span>{es ? 'Texto' : 'Text'}</span>
          <select value={preferences?.density || 'hard'} onChange={(event) => onChange?.({ density: event.target.value as ShellImagePreferences['density'] })}>
            <option value="hard">{imageDensityUserLabel('hard', language)}</option>
            <option value="medium">{es ? 'Medio' : 'Medium'}</option>
            <option value="standard">{es ? 'Completo' : 'Full'}</option>
          </select>
        </label>
      </div>

      <label className="chat-shell__field">
        <span>{es ? 'Modelo de imagen (elegí en cada generación)' : 'Image model (pick every generation)'}</span>
        <select
          value={preferences?.model || 'grok-imagine'}
          onChange={(event) => onChange?.({ model: event.target.value as ShellImagePreferences['model'] })}
        >
          <option value="grok-imagine">Grok Imagine 2.0</option>
          <option value="nano-banana-pro">Nano Banana Pro</option>
        </select>
        <small className="chat-shell__field-hint">
          {es
            ? 'Durante la comparación, confirmá el modelo antes de generar. No hay cambio automático entre proveedores.'
            : 'While comparing, confirm the model before generate. No automatic cross-provider switching.'}
        </small>
      </label>

      <button type="button" className="chat-shell__setup-btn is-primary" disabled={busy || !hasOffer || !preferences?.style} onClick={() => void onGenerate?.()}>
        {busy ? (es ? 'Generando…' : 'Generating…') : (es ? 'Crear en el chat' : 'Create in chat')}
      </button>
    </section>
  )
}
