import type { ReactNode } from 'react'
import type { ScriptFramework } from '../../types'
import { CREDIT_WEIGHTS } from '../../lib/creditsCatalog'
import ChatShellFlowSheet from './ChatShellFlowSheet'
import ChatShellReferencePicker from './ChatShellReferencePicker'
import { shellT, type ChatShellLanguage } from './chatShellLabels'
import {
  anuncioStyleChoices,
  IMAGE_ASPECT_CHOICES,
  IMAGE_DENSITY_CHOICES,
  organicStyleChoices,
  productStyleChoices,
  type ImageClarifyMode,
  type ShellImageAspect,
  type ShellImageDensity,
} from './chatShellImageIntent'
import { hasSelectedProductReference } from './chatShellReferenceSelection'
import {
  ingredientsPromptCopy,
  refsSoftMissingHint,
  skipIngredientLabel,
  type IngredientKind,
} from './chatShellIngredientsCheck'
import type {
  ImageClarifyState,
  ScriptClarifyState,
  ScriptCtaChannel,
} from './useChatSessionThread'

interface ChatShellClarifySheetProps {
  language: ChatShellLanguage
  scriptClarify: ScriptClarifyState | null
  imageClarify: ImageClarifyState | null
  imageBusy?: boolean
  onAnswerScriptClarify?: (answer: {
    type?: ScriptFramework | 'mixed'
    count?: number
    ctaChannel?: ScriptCtaChannel
    confirm?: boolean
  }) => void
  onCancelScriptClarify?: () => void
  onBackScriptClarify?: () => void
  onAnswerImageClarify?: (answer: {
    scriptChoiceId?: string
    mode?: ImageClarifyMode
    styleId?: string
    aspectRatio?: ShellImageAspect
    density?: ShellImageDensity
    skipStyleRef?: boolean
    skipIngredient?: IngredientKind
    useReferences?: boolean
    switchToAnuncio?: boolean
    toggleReferenceId?: string
  }) => void
  onCancelImageClarify?: () => void
  onBackImageClarify?: () => void
  onUploadOfferReference?: (file: File, kind: 'product' | 'context' | 'scene' | 'style' | 'logo', productId?: string) => void | Promise<void>
  onRemoveOfferReference?: (imageId: string) => void | Promise<void>
  onOpenImagesRail?: () => void
}

function ChipRow({ children }: { children: ReactNode }) {
  return <div className="chat-shell__flow-chips">{children}</div>
}

function scriptStepIndex(state: ScriptClarifyState): { step: number; total: number } {
  const order: Array<ScriptClarifyState['step']> = ['type', 'count', 'cta']
  const path = [state.step, ...state.remaining]
  const total = Math.max(path.length, 1)
  const idx = order.indexOf(state.step)
  return { step: Math.max(1, idx + 1), total: Math.max(total, idx + 1 + state.remaining.length) }
}

function imageFlowTitle(state: ImageClarifyState, language: ChatShellLanguage): string {
  const t = shellT(language)
  if (state.partial?.style?.kind === 'product' || state.mode === 'product') return t.flowFotoTitle
  return t.flowPostTitle
}

function imageStepMeta(state: ImageClarifyState): { step: number; total: number } {
  const historyLen = state.history?.length || 0
  const step = historyLen + 1
  let remainingAfter = 0
  switch (state.step) {
    case 'script':
      remainingAfter = 4
      break
    case 'mode':
      remainingAfter = 3
      break
    case 'style':
      remainingAfter = 2
      break
    case 'aspect':
      remainingAfter =
        Boolean(state.scriptText)
        || state.preferences?.style?.kind === 'preset'
        || state.preferences?.style?.kind === 'organic'
          ? 2
          : 1
      break
    case 'density':
      remainingAfter = 1
      break
    case 'styleRef':
      remainingAfter = 1
      break
    case 'refs':
      remainingAfter = 0
      break
    case 'ingredients':
      remainingAfter = 0
      break
    default: {
      const _never: never = state.step
      void _never
      remainingAfter = 0
    }
  }
  return { step, total: Math.max(step + remainingAfter, step) }
}

function imageCopy(state: ImageClarifyState, language: ChatShellLanguage): string {
  const t = shellT(language)
  switch (state.step) {
    case 'script':
      return t.flowPickScript
    case 'mode':
      return t.flowPickMode
    case 'style':
      return t.flowPickStyle
    case 'aspect':
      return t.flowPickAspect
    case 'density':
      return t.flowPickDensity
    case 'styleRef':
      return language === 'es' ? 'Subí un estilo de post o continuá sin referencia.' : 'Upload a post style or continue without a reference.'
    case 'refs':
      return t.flowPickRefs
    case 'ingredients':
      return ingredientsPromptCopy(state.missingIngredients || [], language)
    default: {
      const _never: never = state.step
      return _never
    }
  }
}

export default function ChatShellClarifySheet({
  language,
  scriptClarify,
  imageClarify,
  imageBusy,
  onAnswerScriptClarify,
  onCancelScriptClarify,
  onBackScriptClarify,
  onAnswerImageClarify,
  onCancelImageClarify,
  onBackImageClarify,
  onUploadOfferReference,
  onRemoveOfferReference,
  onOpenImagesRail,
}: ChatShellClarifySheetProps) {
  const t = shellT(language)
  const es = language === 'es'

  if (scriptClarify) {
    const meta = scriptStepIndex(scriptClarify)
    const count = Math.max(1, scriptClarify.settings.variations || 1)
    const credits = CREDIT_WEIGHTS.guion_oferta * count
    const isCtaStep = scriptClarify.step === 'cta'
    const creditsLine = isCtaStep
      ? t.flowCreditsScript.replace('{n}', String(credits)).replace('{count}', String(count))
      : null
    const question =
      scriptClarify.step === 'type'
        ? t.flowPickType
        : scriptClarify.step === 'count'
          ? t.flowPickCount
          : t.flowPickCta
    // CTA chips only select; Generar primary confirms. Show primary once a chip is picked.
    const ctaPicked = Boolean(scriptClarify.ctaChannel)

    return (
      <ChatShellFlowSheet
        open
        language={language}
        title={t.flowScriptsTitle}
        copy={question}
        step={meta.step}
        stepTotal={meta.total}
        creditsLine={creditsLine}
        onCancel={() => onCancelScriptClarify?.()}
        onBack={scriptClarify.history?.length ? () => onBackScriptClarify?.() : null}
        primary={
          isCtaStep && ctaPicked
            ? {
                label: t.flowGenerate,
                onClick: () => onAnswerScriptClarify?.({ confirm: true }),
              }
            : null
        }
      >
        <ChipRow>
          {scriptClarify.step === 'type' ? (
            ([
              ['venta_directa', es ? 'Venta directa' : 'Direct sale'],
              ['educativo', es ? 'Educativo' : 'Educational'],
              ['storytelling', 'Storytelling'],
              ['reconocimiento', es ? 'Reconocimiento' : 'Awareness'],
              ['mixed', es ? 'Mezcla inteligente' : 'Smart mix'],
            ] as Array<[ScriptFramework | 'mixed', string]>).map(([type, label]) => (
              <button
                key={type}
                type="button"
                className="chat-shell__btn chat-shell__btn--pill"
                onClick={() => onAnswerScriptClarify?.({ type })}
              >
                {label}
              </button>
            ))
          ) : scriptClarify.step === 'count' ? (
            [1, 2, 3, 5].map((countOption) => (
              <button
                key={countOption}
                type="button"
                className="chat-shell__btn chat-shell__btn--pill"
                onClick={() => onAnswerScriptClarify?.({ count: countOption })}
              >
                {countOption}
              </button>
            ))
          ) : (
            <>
              <button
                type="button"
                className={`chat-shell__btn chat-shell__btn--pill${scriptClarify.ctaChannel === 'website' ? ' is-on' : ''}`}
                onClick={() => onAnswerScriptClarify?.({ ctaChannel: 'website' })}
              >
                {es ? 'Comprar en web' : 'Buy on website'}
              </button>
              <button
                type="button"
                className={`chat-shell__btn chat-shell__btn--pill${scriptClarify.ctaChannel === 'messages' ? ' is-on' : ''}`}
                onClick={() => onAnswerScriptClarify?.({ ctaChannel: 'messages' })}
              >
                {es ? 'Enviar mensaje' : 'Send a message'}
              </button>
              <button
                type="button"
                className={`chat-shell__btn chat-shell__btn--pill${scriptClarify.ctaChannel === 'none' ? ' is-on' : ''}`}
                onClick={() => onAnswerScriptClarify?.({ ctaChannel: 'none' })}
              >
                {es ? 'Sin CTA' : 'No CTA'}
              </button>
            </>
          )}
        </ChipRow>
      </ChatShellFlowSheet>
    )
  }

  // Generar sets imageBusy before React may clear imageClarify — never keep the overlay over Generando…
  if (imageClarify && !imageBusy) {
    const meta = imageStepMeta(imageClarify)
    const isRefs = imageClarify.step === 'refs'
    const creditsLine = isRefs
      ? t.flowCreditsImage.replace('{n}', String(CREDIT_WEIGHTS.image_standard))
      : null
    const canContinueRefs =
      !imageClarify.referencesRequired
      || hasSelectedProductReference(imageClarify.referenceImages || [])
    const selectedRefs = (imageClarify.referenceImages || []).filter((img) => img.selected === true)
    const hasSelectedStyle = selectedRefs.some((img) => img.kind === 'style')
    const hasSelectedLogo = selectedRefs.some((img) => img.kind === 'logo')
    const softMissing: Array<'logo' | 'style'> = []
    if (isRefs && !hasSelectedStyle) softMissing.push('style')
    if (isRefs && !hasSelectedLogo) softMissing.push('logo')
    const softHint = isRefs ? refsSoftMissingHint(softMissing, language) : null

    return (
      <ChatShellFlowSheet
        open
        language={language}
        title={imageFlowTitle(imageClarify, language)}
        copy={imageCopy(imageClarify, language)}
        step={meta.step}
        stepTotal={meta.total}
        creditsLine={isRefs ? null : creditsLine}
        wide={imageClarify.step === 'script'}
        onCancel={() => onCancelImageClarify?.()}
        onBack={imageClarify.history?.length ? () => onBackImageClarify?.() : null}
        cancelDisabled={Boolean(imageBusy)}
        secondary={
          isRefs && !imageClarify.referencesRequired
            ? {
                label: es ? 'Crear sin referencias' : 'Create without references',
                disabled: Boolean(imageBusy),
                onClick: () => onAnswerImageClarify?.({ useReferences: false }),
              }
            : imageClarify.step === 'styleRef'
              ? {
                  label: es ? 'Continuar sin referencia' : 'Continue without reference',
                  disabled: Boolean(imageBusy),
                  onClick: () => onAnswerImageClarify?.({ skipStyleRef: true }),
                }
              : null
        }
        primary={
          isRefs
            ? {
                label: t.flowGenerate,
                disabled: Boolean(imageBusy) || !canContinueRefs,
                onClick: () => onAnswerImageClarify?.({ useReferences: true }),
              }
            : null
        }
      >
        {imageClarify.scriptTitle ? (
          <div className="chat-shell__clarify-selection">
            <strong>{es ? 'Guion seleccionado' : 'Selected script'}</strong>
            <span>{imageClarify.scriptTitle}</span>
          </div>
        ) : null}

        {imageClarify.step === 'refs' ? (
          <ChatShellReferencePicker
            images={imageClarify.referenceImages || []}
            currentProductId={imageClarify.productId}
            language={language}
            busy={Boolean(imageBusy)}
            creditsLine={creditsLine}
            onToggle={(id) => onAnswerImageClarify?.({ toggleReferenceId: id })}
            onUpload={(file, kind) => void onUploadOfferReference?.(file, kind, imageClarify.productId)}
            onRemove={onRemoveOfferReference}
          />
        ) : null}

        {softHint ? (
          <p className="chat-shell__clarify-soft-hint" role="note">
            {softHint}
          </p>
        ) : null}

        {imageClarify.step === 'script' ? (
          <div className="chat-shell__script-picker chat-shell__script-picker--sheet">
            {(imageClarify.scriptChoices || []).map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="chat-shell__script-choice"
                disabled={imageBusy}
                onClick={() => onAnswerImageClarify?.({ scriptChoiceId: choice.id })}
              >
                <strong>{choice.title}</strong>
                {choice.productName ? <span>{choice.productName}</span> : null}
                <small>{choice.preview}{choice.scriptText.length > choice.preview.length ? '…' : ''}</small>
              </button>
            ))}
          </div>
        ) : (
          <ChipRow>
            {imageClarify.step === 'mode' ? (
              <>
                <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled={imageBusy} onClick={() => onAnswerImageClarify?.({ mode: 'anuncio' })}>
                  {es ? 'Anuncio' : 'Ad'}
                </button>
                <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled={imageBusy} onClick={() => onAnswerImageClarify?.({ mode: 'product' })}>
                  {es ? 'Producto' : 'Product'}
                </button>
                <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled={imageBusy} onClick={() => onAnswerImageClarify?.({ mode: 'organic' })}>
                  {es ? 'Orgánico' : 'Organic'}
                </button>
              </>
            ) : imageClarify.step === 'aspect' ? (
              IMAGE_ASPECT_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="chat-shell__btn chat-shell__btn--pill"
                  disabled={imageBusy}
                  onClick={() => onAnswerImageClarify?.({ aspectRatio: choice.id })}
                >
                  {es ? choice.labelEs : choice.labelEn}
                  <small className="chat-shell__pill-hint"> · {choice.hint}</small>
                </button>
              ))
            ) : imageClarify.step === 'density' ? (
              IMAGE_DENSITY_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="chat-shell__btn chat-shell__btn--pill"
                  disabled={imageBusy}
                  onClick={() => onAnswerImageClarify?.({ density: choice.id })}
                >
                  {es ? choice.labelEs : choice.labelEn}
                  <small className="chat-shell__pill-hint"> · {choice.hint}</small>
                </button>
              ))
            ) : imageClarify.step === 'styleRef' ? (
              <button
                type="button"
                className="chat-shell__btn chat-shell__btn--pill"
                disabled={imageBusy}
                onClick={() => onOpenImagesRail?.()}
              >
                {es ? 'Subir estilo de post' : 'Upload post style'}
              </button>
            ) : imageClarify.step === 'ingredients' ? (
              <>
                <button
                  type="button"
                  className="chat-shell__btn chat-shell__btn--ghost"
                  disabled={imageBusy}
                  onClick={() => onOpenImagesRail?.()}
                >
                  {es ? 'Subir en el rail' : 'Upload in rail'}
                </button>
                {(imageClarify.missingIngredients || []).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onAnswerImageClarify?.({ skipIngredient: kind })}
                  >
                    {skipIngredientLabel(kind, language)}
                  </button>
                ))}
              </>
            ) : imageClarify.step === 'refs' ? (
              <>
                <button type="button" className="chat-shell__btn chat-shell__btn--ghost" onClick={() => onOpenImagesRail?.()}>
                  {es ? 'Administrar biblioteca' : 'Manage library'}
                </button>
                {imageClarify.referencesRequired && (imageClarify.availableReferenceCount || 0) === 0 ? (
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onAnswerImageClarify?.({ switchToAnuncio: true })}
                  >
                    {es ? 'Usar Anuncio' : 'Use Ad'}
                  </button>
                ) : null}
              </>
            ) : imageClarify.step === 'style' ? (
              (imageClarify.mode === 'product'
                ? productStyleChoices(language)
                : imageClarify.mode === 'organic'
                  ? organicStyleChoices(language)
                  : anuncioStyleChoices(language)
              ).map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="chat-shell__btn chat-shell__btn--pill"
                  disabled={imageBusy}
                  onClick={() => onAnswerImageClarify?.({ styleId: choice.id })}
                >
                  {choice.label}
                </button>
              ))
            ) : null}
          </ChipRow>
        )}
      </ChatShellFlowSheet>
    )
  }

  return null
}
