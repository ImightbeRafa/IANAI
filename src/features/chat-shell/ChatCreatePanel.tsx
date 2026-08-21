import ScriptSettingsPanel from '../../components/ScriptSettingsPanel'
import { LOGO_ARCHETYPES } from '../../data/image-presets'
import type { ScriptGenerationSettings } from '../../types'
import {
  anuncioStyleChoices,
  organicStyleChoices,
  productStyleChoices,
  type ShellImagePreferences,
} from './chatShellImageIntent'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

interface ChatCreatePanelProps {
  language: ChatShellLanguage
  scriptSettings: ScriptGenerationSettings
  onScriptSettingsChange: (settings: ScriptGenerationSettings) => void
  onGenerateScripts: () => void
  sending: boolean
  imagePrefs?: ShellImagePreferences
  onPatchImagePreferences?: (patch: Partial<ShellImagePreferences>) => void
  onGeneratePost: () => void | Promise<void>
  imageBusy: boolean
  hasOffer: boolean
}

export default function ChatCreatePanel({
  language,
  scriptSettings,
  onScriptSettingsChange,
  onGenerateScripts,
  sending,
  imagePrefs,
  onPatchImagePreferences,
  onGeneratePost,
  imageBusy,
  hasOffer,
}: ChatCreatePanelProps) {
  const t = shellT(language)
  const es = language === 'es'
  const postReady = Boolean(imagePrefs?.style) && hasOffer && !imageBusy

  return (
    <div className="chat-shell__rail-form chat-shell__create">
      <p className="chat-shell__rail-hint">{t.createHint}</p>

      <section className="chat-shell__create-block">
        <h3 className="chat-shell__nav-label">{t.scripts}</h3>
        <ScriptSettingsPanel
          settings={scriptSettings}
          onChange={onScriptSettingsChange}
          language={language}
          onGenerate={onGenerateScripts}
          loading={sending}
        />
      </section>

      <section className="chat-shell__create-block">
        <h3 className="chat-shell__nav-label">{t.posts}</h3>
        <p className="chat-shell__rail-note">
          {es
            ? 'Mismos estilos que el workspace de posts: anuncio, orgánico, foto de producto y logo. Carrusel y tipos custom siguen en Posts.'
            : 'Same styles as the posts workspace: ad, organic, product photo, and logo. Carousel and custom types stay in Posts.'}
        </p>
        {!hasOffer ? (
          <p className="chat-shell__rail-hint">{t.chooseOffers}</p>
        ) : null}

        <p className="chat-shell__rail-hint">{es ? 'Anuncio' : 'Ad'}</p>
        <div className="chat-shell__clarify-chips">
          {anuncioStyleChoices(language).slice(0, 10).map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`chat-shell__btn chat-shell__btn--pill${imagePrefs?.style?.kind === 'preset' && imagePrefs.style.presetId === choice.id ? ' is-on' : ''}`}
              disabled={imageBusy}
              onClick={() => onPatchImagePreferences?.({ style: { kind: 'preset', presetId: choice.id } })}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <p className="chat-shell__rail-hint">{es ? 'Orgánico' : 'Organic'}</p>
        <div className="chat-shell__clarify-chips">
          {organicStyleChoices(language).map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`chat-shell__btn chat-shell__btn--pill${imagePrefs?.style?.kind === 'organic' && imagePrefs.style.organicSubtype === choice.id ? ' is-on' : ''}`}
              disabled={imageBusy}
              onClick={() => onPatchImagePreferences?.({ style: { kind: 'organic', organicSubtype: choice.id } })}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <p className="chat-shell__rail-hint">{t.productPhoto}</p>
        <div className="chat-shell__clarify-chips">
          {productStyleChoices(language).map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`chat-shell__btn chat-shell__btn--pill${imagePrefs?.style?.kind === 'product' && imagePrefs.style.productSubStyle === choice.id ? ' is-on' : ''}`}
              disabled={imageBusy}
              onClick={() => onPatchImagePreferences?.({ style: { kind: 'product', productSubStyle: choice.id } })}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <p className="chat-shell__rail-hint">{t.logo}</p>
        <div className="chat-shell__clarify-chips">
          {LOGO_ARCHETYPES.slice(0, 8).map((arch) => (
            <button
              key={arch.id}
              type="button"
              className={`chat-shell__btn chat-shell__btn--pill${imagePrefs?.style?.kind === 'logo' && (imagePrefs.style.archetype || 'auto') === arch.id ? ' is-on' : ''}`}
              disabled={imageBusy}
              onClick={() => onPatchImagePreferences?.({
                style: { kind: 'logo', archetype: arch.id },
                aspectRatio: '1:1',
                logoMode: 'generate',
              })}
            >
              {language === 'es' ? arch.nameEs : arch.name}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="chat-shell__setup-btn is-primary"
          disabled={!postReady}
          onClick={() => void onGeneratePost()}
        >
          {imageBusy ? t.generating : t.generatePost}
        </button>
      </section>
    </div>
  )
}
