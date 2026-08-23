import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Loader2, Mic, Paperclip, Square } from 'lucide-react'
import ChatShellProgress, { type ChatShellProgressKind } from './ChatShellProgress'
import ChatShellScriptCard from './ChatShellScriptCard'
import ChatShellImageCard from './ChatShellImageCard'
import ChatSlashCommandPalette from './ChatSlashCommandPalette'
import { matchSlashCommands, type ShellCommandOption } from './chatShellCommands'
import { shellT } from './chatShellLabels'
import {
  appendComposerTranscript,
  useChatComposerVoice,
} from './useChatComposerVoice'
import type {
  Business,
  ChatSession,
  ImageModel,
  Message,
  MessageArtifact,
  Product,
  ScriptFramework,
} from '../../types'
import { isScriptContent, parseScripts, type ParsedScript } from '../../utils/scriptParser'
import {
  shouldReviewChosenScript,
  type FailedOfferBatch,
  type ImageClarifyState,
  type ScriptClarifyState,
  type ScriptCtaChannel,
} from './useChatSessionThread'
import ChatShellReferencePicker from './ChatShellReferencePicker'
import { catalogOfferReferences, hasSelectedProductReference } from './chatShellReferenceSelection'
import {
  buildImageWorkspaces,
  isImageWorkspaceAnchor,
  sortArtifactsByOrdinal,
  workspaceForImage,
  type ShellImageLike,
} from './chatShellImages'
import { shouldKeepMountedTranscript } from './chatShellThreadCache'
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

interface ChatThreadProps {
  brand: Business | null
  session: ChatSession | null
  messages: Message[]
  loadingMessages: boolean
  sending: boolean
  savingScript: boolean
  activeProduct: Product | null
  offerProductId: string | null
  offerCount: number
  latestImagesByOffer: Map<string, ShellImageLike>
  offerImages?: ShellImageLike[]
  imageBusy: boolean
  setupBusy?: boolean
  imageModel?: ImageModel
  imageAspect?: ShellImageAspect
  scriptType?: ScriptFramework | 'mixed' | string | null
  error: string | null
  notice: string | null
  failedBatch: FailedOfferBatch | null
  onRetryFailedOffers: () => void
  language?: 'en' | 'es'
  walkProgress?: { current: number; total: number; offerName: string } | null
  onSend: (text: string) => void | Promise<{ needOffers?: boolean; ignored?: boolean } | void>
  onNeedOffers?: () => void
  imageClarify?: ImageClarifyState | null
  onAnswerImageClarify?: (answer: {
    scriptChoiceId?: string
    mode?: ImageClarifyMode
    styleId?: string
    aspectRatio?: ShellImageAspect
    density?: ShellImageDensity
    skipStyleRef?: boolean
    useReferences?: boolean
    switchToAnuncio?: boolean
    toggleReferenceId?: string
  }) => void
  onCancelImageClarify?: () => void
  onSelectImageOffer?: (productId: string) => void
  scriptClarify?: ScriptClarifyState | null
  onLatestVersionChange?: (snapshotKey: string, content: string) => void
  onAnswerScriptClarify?: (answer: {
    type?: ScriptFramework | 'mixed'
    count?: number
    ctaChannel?: ScriptCtaChannel
  }) => void
  onCancelScriptClarify?: () => void
  onOpenImagesRail?: () => void
  onUploadOfferReference?: (file: File, kind: 'product' | 'context' | 'scene' | 'style', productId?: string) => void | Promise<void>
  onRemoveOfferReference?: (imageId: string) => void | Promise<void>
  offerProductNames?: Record<string, string>
  onPreparePostFromScript?: (scriptText: string, density?: 'hard' | 'medium') => Promise<string>
  onGenerateImageFromScript?: (
    scriptText: string,
    productId?: string | null,
    scriptTitle?: string | null,
    options?: {
      density?: 'hard' | 'medium'
      referenceImageIds?: string[]
      alreadyOptimized?: boolean
    }
  ) => void | Promise<void>
  onSaveScript: (
    content: string,
    title: string,
    opts?: { edit_source?: string; message_id?: string; script_index?: number; product_id?: string }
  ) => Promise<string | null>
  onEditScript: (
    originalContent: string,
    instruction: string,
    editType?: 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness',
    productOverride?: Product | null
  ) => Promise<string>
  onSaveVersion: (
    parentId: string,
    content: string,
    editSource: string,
    editLabel?: string,
    productIdOverride?: string
  ) => Promise<string | null>
  onOpenOfferImage: (options: {
    url: string
    alt: string
    productName?: string | null
    productId: string
    productImageId: string
  }) => void
  onEditOfferImage: (
    productImageId: string,
    imageUrl: string,
    instruction: string,
    productId?: string
  ) => Promise<void>
  setupCard?: ReactNode
  createDock?: ReactNode
  inlineSetupCard?: ReactNode
  setupTurns?: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
  setupPlaceholder?: string
  onUploadBrandAsset?: (file: File, kind: 'logo' | 'reference') => void | Promise<void>
  onUploadSetupDocument?: (file: File) => void | Promise<void>
}

function artifactToParsedScript(artifact: MessageArtifact): ParsedScript | null {
  const content = artifact.script?.content
  if (!content) return null
  const scriptTitle =
    typeof artifact.action_metadata?.script_title === 'string'
      ? artifact.action_metadata.script_title
      : null
  const offerName =
    (typeof artifact.action_metadata?.offer_name === 'string'
      ? artifact.action_metadata.offer_name
      : null)
    || artifact.product?.name
    || artifact.script?.title
    || `Offer ${artifact.ordinal}`
  const title =
    scriptTitle && scriptTitle !== offerName
      ? scriptTitle
      : (artifact.script?.title || offerName)
  return {
    index: artifact.ordinal,
    title,
    content,
  }
}

export function dedupeLegacySetupSummaries(messages: Message[]): Message[] {
  const seen = new Set<string>()
  let keptWelcome = false
  return messages.filter((message) => {
    if (message.role !== 'assistant' || message.artifacts?.length) return true
    const content = message.content.trim()
    if (/^¡Hola! Bienvenido a Advance AI|^Hi! Welcome to Advance AI/i.test(content)) {
      if (keptWelcome) return false
      keptWelcome = true
      return true
    }
    if (!/^(Armé este resumen|I drafted this from)/i.test(content)) return true
    const key = content.replace(/\s+/g, ' ').toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default memo(function ChatThread({
  brand,
  session,
  messages,
  loadingMessages,
  sending,
  savingScript,
  activeProduct,
  offerProductId,
  offerCount,
  latestImagesByOffer,
  offerImages = [],
  imageBusy,
  setupBusy = false,
  imageModel,
  imageAspect,
  scriptType = null,
  onSend,
  onNeedOffers,
  error,
  notice,
  failedBatch,
  onRetryFailedOffers,
  language = 'es',
  walkProgress = null,
  imageClarify = null,
  onAnswerImageClarify,
  onCancelImageClarify,
  onSelectImageOffer,
  scriptClarify = null,
  onLatestVersionChange,
  onAnswerScriptClarify,
  onCancelScriptClarify,
  onOpenImagesRail,
  onUploadOfferReference,
  onRemoveOfferReference,
  offerProductNames = {},
  onPreparePostFromScript,
  onGenerateImageFromScript,
  onSaveScript,
  onEditScript,
  onSaveVersion,
  onOpenOfferImage,
  onEditOfferImage,
  setupCard,
  createDock,
  inlineSetupCard,
  setupTurns = [],
  setupPlaceholder,
  onUploadBrandAsset,
  onUploadSetupDocument,
}: ChatThreadProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [attachOpen, setAttachOpen] = useState(false)
  const [postPreviewNonce, setPostPreviewNonce] = useState(0)
  const [postPreviewScriptKey, setPostPreviewScriptKey] = useState<string | null>(null)
  const [localNotice, setLocalNotice] = useState<string | null>(null)
  const sessionKey = session?.id || ''
  const composer = sessionKey ? (drafts[sessionKey] || '') : ''
  const composerEnabled = Boolean(session)
  const slashListId = useId()
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const slashCommands = useMemo(
    () => (slashDismissed ? [] : matchSlashCommands(composer)),
    [composer, slashDismissed]
  )
  const insertSlashCommand = useCallback((command: ShellCommandOption) => {
    if (!sessionKey) return
    setDrafts((prev) => ({ ...prev, [sessionKey]: command.insert }))
    setSlashDismissed(true)
    setSlashIndex(0)
  }, [sessionKey])
  const t = shellT(language)
  const visibleMessages = useMemo(() => dedupeLegacySetupSummaries(messages), [messages])
  const imageWorkspaces = useMemo(() => {
    const artifacts = visibleMessages.flatMap((message) =>
      (message.artifacts || []).map((artifact) => ({
        ...artifact,
        message_id: message.id,
      }))
    )
    return buildImageWorkspaces(offerImages, artifacts)
  }, [offerImages, visibleMessages])
  const libraryReferenceImages = useMemo(
    () => catalogOfferReferences(offerImages, offerProductNames),
    [offerImages, offerProductNames]
  )
  const threadRef = useRef<HTMLDivElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const offerProductRefInputRef = useRef<HTMLInputElement>(null)
  const offerContextRefInputRef = useRef<HTMLInputElement>(null)
  const insertTranscript = useCallback((text: string) => {
    if (!sessionKey) return
    setDrafts((prev) => ({
      ...prev,
      [sessionKey]: appendComposerTranscript(prev[sessionKey] || '', text),
    }))
  }, [sessionKey])
  const voice = useChatComposerVoice({
    language,
    enabled: composerEnabled && !loadingMessages,
    onTranscript: insertTranscript,
  })
  const voiceDiscard = voice.discard

  useEffect(() => {
    setAttachOpen(false)
    setSlashDismissed(false)
    setSlashIndex(0)
    setPostPreviewNonce(0)
    setPostPreviewScriptKey(null)
    setLocalNotice(null)
    voiceDiscard()
  }, [sessionKey, voiceDiscard])

  const submit = () => {
    const text = composer.trim()
    if (!text || sending || !session || loadingMessages || voice.isRecording || voice.isTranscribing) return
    const capturedKey = sessionKey
    setDrafts((prev) => ({ ...prev, [capturedKey]: '' }))
    void (async () => {
      const result = await onSend(text)
      if (result && result.ignored) {
        setDrafts((prev) => ({
          ...prev,
          [capturedKey]: (prev[capturedKey] || '').trim() ? prev[capturedKey] : text,
        }))
        return
      }
      if (result && result.needOffers) onNeedOffers?.()
    })()
  }

  const pickAttach = (kind: 'logo' | 'reference' | 'document') => {
    setAttachOpen(false)
    if (kind === 'logo') logoInputRef.current?.click()
    else if (kind === 'reference') referenceInputRef.current?.click()
    else documentInputRef.current?.click()
  }

  const handleAttachFiles = (kind: 'logo' | 'reference', files: FileList | null) => {
    const file = files?.[0]
    if (!file || !onUploadBrandAsset) return
    void onUploadBrandAsset(file, kind)
  }

  const voiceBusy = voice.isRecording || voice.isTranscribing
  const controlsLocked = loadingMessages || voiceBusy
  const canSend = Boolean(session) && !sending && !controlsLocked && Boolean(composer.trim())
  const keepMountedTranscript = shouldKeepMountedTranscript(loadingMessages, visibleMessages.length)
  const showInitialLoader = Boolean(session) && loadingMessages && !keepMountedTranscript && setupTurns.length === 0 && !inlineSetupCard
  const progressKind: ChatShellProgressKind | null = imageBusy
    ? 'image'
    : setupBusy
      ? 'setup'
      : sending && !imageClarify
        ? 'script'
        : null
  const progressSubtitle = walkProgress
    ? `${walkProgress.current}/${walkProgress.total}${walkProgress.offerName ? ` · ${walkProgress.offerName}` : ''}`
    : undefined
  const threadNotice = localNotice || notice

  const openScriptPostPreview = (scriptKey: string) => {
    if (!scriptKey) {
      setLocalNotice(language === 'es'
        ? 'Primero crea un guion. Después elegís cuál usar y revisás el texto antes de generar el post.'
        : 'Create a script first. Then choose which one to use and review it before generating the post.')
      return
    }
    setLocalNotice(null)
    onCancelScriptClarify?.()
    setPostPreviewScriptKey(scriptKey)
    setPostPreviewNonce((n) => n + 1)
  }

  useEffect(() => {
    if (loadingMessages) return
    const node = threadRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages.length, setupTurns.length, progressKind, sending, setupBusy, imageBusy, loadingMessages])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % slashCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + slashCommands.length) % slashCommands.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const selected = slashCommands[slashIndex] || slashCommands[0]
        if (selected) insertSlashCommand(selected)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!voiceBusy) submit()
    }
  }

  return (
    <div className="chat-shell__stage">
      {setupCard}
      <div
        className={`chat-shell__thread${loadingMessages ? ' is-busy' : ''}`}
        role="log"
        aria-label="Conversation"
        aria-busy={loadingMessages}
        ref={threadRef}
      >
        {!session ? (
          <div className="chat-shell__msg chat-shell__msg--ai">
            <span className="chat-shell__who">Advance AI</span>
            <div className="chat-shell__status-box">
              {brand
                ? t.emptyNoSession.replace('{brand}', brand.name)
                : t.emptyNoBrand}
            </div>
          </div>
        ) : showInitialLoader ? (
          <div className="chat-shell__msg chat-shell__msg--ai">
            <span className="chat-shell__who">Advance AI</span>
            <div className="chat-shell__status-box">{t.emptyLoading}</div>
          </div>
        ) : (
          <>
            {visibleMessages.length === 0 && setupTurns.length === 0 && !setupCard ? (
              <div className="chat-shell__msg chat-shell__msg--ai">
                <span className="chat-shell__who">Advance AI</span>
                <div className="chat-shell__status-box">
                  {offerProductId && activeProduct
                    ? t.emptyReadyWithOffer.replace(
                      '{detail}',
                      offerCount > 1
                        ? (language === 'es' ? `${offerCount} ofertas` : `${offerCount} offers`)
                        : (language === 'es' ? `oferta ${activeProduct.name}` : `offer ${activeProduct.name}`)
                    )
                    : t.emptyReadyNoOffer}
                </div>
              </div>
            ) : null}
            {visibleMessages.map((message) => {
            if (message.role === 'user') {
              return (
                <div key={message.id} className="chat-shell__msg chat-shell__msg--user">
                  <span className="chat-shell__who">You</span>
                  <div className="chat-shell__bubble">{message.content}</div>
                </div>
              )
            }

            const allArtifacts = sortArtifactsByOrdinal(message.artifacts || [])
            const artifacts = allArtifacts.filter(
              (a) =>
                (a.artifact_type === 'script' && a.script?.content)
                || (a.artifact_type === 'image'
                  && a.product_image?.image_url
                  && isImageWorkspaceAnchor(a.product_image.id, imageWorkspaces))
            )

            if (artifacts.length > 0) {
              return (
                <div key={message.id} className="chat-shell__msg chat-shell__msg--ai">
                  <span className="chat-shell__who">Advance AI</span>
                  <div className="chat-shell__script-stack">
                    {artifacts.map((artifact) => {
                      if (artifact.artifact_type === 'image') {
                        const workspace = workspaceForImage(imageWorkspaces, artifact.product_image?.id)
                        const openImage = (img: ShellImageLike) => {
                          if (!img.image_url) return
                          onOpenOfferImage({
                            url: img.image_url,
                            alt: img.label || artifact.product?.name || 'Image',
                            productName: artifact.product?.name,
                            productId: img.product_id || artifact.product_id,
                            productImageId: img.id,
                          })
                        }
                        return (
                          <ChatShellImageCard
                            key={artifact.id}
                            artifact={artifact}
                            productName={artifact.product?.name}
                            busy={imageBusy}
                            language={language}
                            versions={workspace?.versions || []}
                            onOpen={openImage}
                            onRequestEdit={openImage}
                          />
                        )
                      }

                      const parsed = artifactToParsedScript(artifact)
                      if (!parsed) return null
                      const product = artifact.product
                      const productId = artifact.product_id
                      const productName =
                        product?.name
                        || (typeof artifact.action_metadata?.offer_name === 'string'
                          ? artifact.action_metadata.offer_name
                          : null)
                        || `Offer ${artifact.ordinal}`
                      const offerImage = latestImagesByOffer.get(productId)
                      return (
                        <ChatShellScriptCard
                          key={artifact.id}
                          script={parsed}
                          language={language}
                          productName={productName}
                          productType={product?.type}
                          productId={productId}
                          messageId={message.id}
                          scriptIndex={artifact.ordinal}
                          savedScriptId={artifact.script_id || artifact.script?.id || null}
                          savingScript={savingScript}
                          offerImageId={offerImage?.id}
                          offerImageUrl={offerImage?.image_url}
                          referenceImages={libraryReferenceImages}
                          imageBusy={imageBusy}
                          onSave={(content, title, opts) =>
                            onSaveScript(content, title, {
                              ...opts,
                              product_id: productId,
                              message_id: message.id,
                              script_index: artifact.ordinal,
                            })
                          }
                          onEdit={(original, instruction, editType) =>
                            onEditScript(original, instruction, editType, product || null)
                          }
                          onSaveVersion={(parentId, content, editSource, editLabel) =>
                            onSaveVersion(parentId, content, editSource, editLabel, productId)
                          }
                          onGenerateImage={
                            onGenerateImageFromScript
                              ? (scriptText, options) =>
                                  void onGenerateImageFromScript(
                                    scriptText,
                                    productId,
                                    parsed.title,
                                    options
                                  )
                              : undefined
                          }
                          onPreparePost={onPreparePostFromScript}
                          onUploadPostReference={(file, kind) => void onUploadOfferReference?.(file, kind, productId)}
                          onOpenPostPreview={() => onCancelScriptClarify?.()}
                          onLatestVersionChange={onLatestVersionChange}
                          snapshotKey={artifact.id}
                          openPostPreviewNonce={
                            postPreviewScriptKey === artifact.id ? postPreviewNonce : 0
                          }
                          onEditOfferImage={
                            offerImage
                              ? (instruction) =>
                                  onEditOfferImage(
                                    offerImage.id,
                                    offerImage.image_url || '',
                                    instruction,
                                    productId
                                  )
                              : undefined
                          }
                        />
                      )
                    })}
                  </div>
                </div>
              )
            }

            if (allArtifacts.some((artifact) => artifact.artifact_type === 'image')) return null

            const hasScripts = isScriptContent(message.content)
            const parsed = hasScripts ? parseScripts(message.content) : []
            const showCards = hasScripts && parsed.length >= 1

            if (showCards) {
              return (
                <div key={message.id} className="chat-shell__msg chat-shell__msg--ai">
                  <span className="chat-shell__who">Advance AI</span>
                  <div className="chat-shell__script-stack">
                    {parsed.map((script) => (
                      <ChatShellScriptCard
                        key={`${message.id}-script-${script.index}`}
                        script={script}
                        language={language}
                        productName={activeProduct?.name}
                        productType={activeProduct?.type}
                        productId={offerProductId || undefined}
                        messageId={message.id}
                        scriptIndex={script.index}
                        savingScript={savingScript}
                        referenceImages={libraryReferenceImages}
                        readOnly={!offerProductId}
                        onSave={offerProductId ? onSaveScript : undefined}
                        onEdit={offerProductId ? onEditScript : undefined}
                        onSaveVersion={offerProductId ? onSaveVersion : undefined}
                        onGenerateImage={
                          onGenerateImageFromScript && offerProductId
                            ? (scriptText, options) =>
                                void onGenerateImageFromScript(
                                  scriptText,
                                  offerProductId,
                                  script.title,
                                  options
                                )
                            : undefined
                        }
                        onPreparePost={onPreparePostFromScript}
                        onUploadPostReference={(file, kind) => void onUploadOfferReference?.(file, kind, offerProductId || undefined)}
                        onOpenPostPreview={() => onCancelScriptClarify?.()}
                        onLatestVersionChange={onLatestVersionChange}
                        snapshotKey={`${message.id}:${script.index}`}
                        openPostPreviewNonce={
                          postPreviewScriptKey === `${message.id}:${script.index}` ? postPreviewNonce : 0
                        }
                      />
                    ))}
                  </div>
                </div>
              )
            }

            return (
              <div key={message.id} className="chat-shell__msg chat-shell__msg--ai">
                <span className="chat-shell__who">Advance AI</span>
                <div className="chat-shell__bubble chat-shell__bubble--ai">{message.content}</div>
              </div>
            )
          })}
          {setupTurns.map((turn) => (
              <div
                key={turn.id}
                className={`chat-shell__msg ${turn.role === 'user' ? 'chat-shell__msg--user' : 'chat-shell__msg--ai'}`}
              >
                <span className="chat-shell__who">{turn.role === 'user' ? 'You' : 'Advance AI'}</span>
                <div className={`chat-shell__bubble${turn.role === 'assistant' ? ' chat-shell__bubble--ai' : ''}`}>
                  {turn.content}
                </div>
              </div>
            ))}
          {progressKind ? (
            <ChatShellProgress
              key={`${progressKind}-${scriptType || ''}`}
              kind={progressKind}
              language={language}
              subtitle={progressKind === 'image' ? imageModel : progressSubtitle}
              imageModel={imageModel}
              aspectRatio={imageAspect}
              context={{
                scriptType,
                offerName: walkProgress?.offerName || activeProduct?.name,
              }}
            />
          ) : null}
          {keepMountedTranscript ? (
            <div className="chat-shell__thread-veil" role="status">
              {t.emptyLoading}
            </div>
          ) : null}
          </>
        )}
      </div>

      <div className="chat-shell__composer-wrap">
        <input
          ref={offerProductRefInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onUploadOfferReference?.(file, 'product')
            e.target.value = ''
          }}
        />
        <input
          ref={offerContextRefInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onUploadOfferReference?.(file, 'context')
            e.target.value = ''
          }}
        />
        {(error || threadNotice || voice.error) && (
          <div className={`chat-shell__thread-alert${error || voice.error ? ' is-error' : ''}`} role="status">
            {error || voice.error || threadNotice}
          </div>
        )}
        {scriptClarify && offerCount > 0 && !(imageClarify && !imageBusy) ? (
          <div className="chat-shell__clarify" role="group" aria-label="Script options">
            <p className="chat-shell__clarify-question">
              {scriptClarify.step === 'type'
                ? (language === 'es' ? '¿Qué tipo de guiones querés crear?' : 'What kind of scripts do you want?')
                : scriptClarify.step === 'count'
                  ? (language === 'es' ? '¿Cuántas versiones necesitás?' : 'How many versions do you need?')
                  : (language === 'es' ? '¿A dónde debe llevar el CTA?' : 'Where should the CTA send people?')}
            </p>
            <div className="chat-shell__clarify-chips">
              {scriptClarify.step === 'type' ? (
                <>
                  {([
                    ['venta_directa', language === 'es' ? 'Venta directa' : 'Direct sale'],
                    ['educativo', language === 'es' ? 'Educativo' : 'Educational'],
                    ['storytelling', 'Storytelling'],
                    ['reconocimiento', language === 'es' ? 'Reconocimiento' : 'Awareness'],
                    ['mixed', language === 'es' ? 'Mezcla inteligente' : 'Smart mix'],
                  ] as Array<[ScriptFramework | 'mixed', string]>).map(([type, label]) => (
                    <button key={type} type="button" className="chat-shell__btn chat-shell__btn--pill" onClick={() => onAnswerScriptClarify?.({ type })}>
                      {label}
                    </button>
                  ))}
                </>
              ) : scriptClarify.step === 'count' ? (
                [1, 2, 3, 5].map((count) => (
                  <button key={count} type="button" className="chat-shell__btn chat-shell__btn--pill" onClick={() => onAnswerScriptClarify?.({ count })}>
                    {count}
                  </button>
                ))
              ) : (
                <>
                  <button type="button" className="chat-shell__btn chat-shell__btn--pill" onClick={() => onAnswerScriptClarify?.({ ctaChannel: 'website' })}>
                    {language === 'es' ? 'Comprar en web' : 'Buy on website'}
                  </button>
                  <button type="button" className="chat-shell__btn chat-shell__btn--pill" onClick={() => onAnswerScriptClarify?.({ ctaChannel: 'messages' })}>
                    {language === 'es' ? 'Enviar mensaje' : 'Send a message'}
                  </button>
                  <button type="button" className="chat-shell__btn chat-shell__btn--pill" onClick={() => onAnswerScriptClarify?.({ ctaChannel: 'none' })}>
                    {language === 'es' ? 'Sin CTA' : 'No CTA'}
                  </button>
                </>
              )}
              <button type="button" className="chat-shell__btn chat-shell__btn--ghost" onClick={() => onCancelScriptClarify?.()}>
                {language === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : imageClarify && !imageBusy ? (
          <div className="chat-shell__clarify" role="group" aria-label="Image options">
            {imageClarify.scriptTitle ? (
              <div className="chat-shell__clarify-selection">
                <strong>{language === 'es' ? 'Guion seleccionado' : 'Selected script'}</strong>
                <span>{imageClarify.scriptTitle}</span>
              </div>
            ) : null}
            {imageClarify.step === 'refs' ? (
              <ChatShellReferencePicker
                images={imageClarify.referenceImages || []}
                currentProductId={imageClarify.productId}
                language={language}
                busy={imageBusy}
                onToggle={(id) => onAnswerImageClarify?.({ toggleReferenceId: id })}
                onUpload={(file, kind) => void onUploadOfferReference?.(file, kind, imageClarify.productId)}
                onRemove={onRemoveOfferReference}
              />
            ) : null}
            <div className="chat-shell__clarify-chips">
              {imageClarify.step === 'script' ? (
                <div className="chat-shell__script-picker">
                  <p className="chat-shell__script-picker-lead">
                    {language === 'es' ? 'Elegí el guion que querés convertir en post.' : 'Choose the script you want to turn into a post.'}
                  </p>
                  {(imageClarify.scriptChoices || []).map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className="chat-shell__script-choice"
                      disabled={imageBusy}
                      onClick={() => {
                        if (shouldReviewChosenScript(imageClarify.originText, imageClarify.source)) {
                          onCancelImageClarify?.()
                          onSelectImageOffer?.(choice.productId)
                          openScriptPostPreview(choice.id)
                          return
                        }
                        onAnswerImageClarify?.({ scriptChoiceId: choice.id })
                      }}
                    >
                      <strong>{choice.title}</strong>
                      {choice.productName ? <span>{choice.productName}</span> : null}
                      <small>{choice.preview}{choice.scriptText.length > choice.preview.length ? '…' : ''}</small>
                    </button>
                  ))}
                </div>
              ) : imageClarify.step === 'mode' ? (
                <>
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onAnswerImageClarify?.({ mode: 'anuncio' })}
                  >
                    {language === 'es' ? 'Anuncio' : 'Ad'}
                  </button>
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onAnswerImageClarify?.({ mode: 'product' })}
                  >
                    {language === 'es' ? 'Producto' : 'Product'}
                  </button>
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onAnswerImageClarify?.({ mode: 'organic' })}
                  >
                    {language === 'es' ? 'Orgánico' : 'Organic'}
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
                    {language === 'es' ? choice.labelEs : choice.labelEn}
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
                    {language === 'es' ? choice.labelEs : choice.labelEn}
                    <small className="chat-shell__pill-hint"> · {choice.hint}</small>
                  </button>
                ))
              ) : imageClarify.step === 'styleRef' ? (
                <>
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => offerContextRefInputRef.current?.click()}
                  >
                    {language === 'es' ? 'Subir estilo de post' : 'Upload post style'}
                  </button>
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onAnswerImageClarify?.({ skipStyleRef: true })}
                  >
                    {language === 'es' ? 'Continuar sin referencia' : 'Continue without reference'}
                  </button>
                </>
              ) : imageClarify.step === 'refs' ? (
                <>
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={
                      imageBusy
                      || (
                        Boolean(imageClarify.referencesRequired)
                        && !hasSelectedProductReference(imageClarify.referenceImages || [])
                      )
                    }
                    onClick={() => onAnswerImageClarify?.({ useReferences: true })}
                  >
                    {language === 'es' ? 'Continuar con las seleccionadas' : 'Continue with selected'}
                  </button>
                  {!imageClarify.referencesRequired ? (
                    <button
                      type="button"
                      className="chat-shell__btn chat-shell__btn--pill"
                      disabled={imageBusy}
                      onClick={() => onAnswerImageClarify?.({ useReferences: false })}
                    >
                      {language === 'es' ? 'Crear sin referencias' : 'Create without references'}
                    </button>
                  ) : null}
                  <button type="button" className="chat-shell__btn chat-shell__btn--ghost" onClick={() => onOpenImagesRail?.()}>
                    {language === 'es' ? 'Administrar biblioteca' : 'Manage library'}
                  </button>
                  {imageClarify.referencesRequired && (imageClarify.availableReferenceCount || 0) === 0 ? <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onAnswerImageClarify?.({ switchToAnuncio: true })}
                  >
                    {language === 'es' ? 'Usar Anuncio' : 'Use Ad'}
                  </button> : null}
                </>
              ) : (
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
              )}
              <button
                type="button"
                className="chat-shell__btn chat-shell__btn--ghost"
                disabled={imageBusy}
                onClick={() => onCancelImageClarify?.()}
              >
                {language === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : null}
        {failedBatch && failedBatch.productIds.length > 0 ? (
          <div className="chat-shell__retry-bar" role="status">
            <span>
              Failed offers: {failedBatch.names.join(', ')}. Retry creates a new message for those offers only.
            </span>
            <button
              type="button"
              className="chat-shell__retry-btn"
              disabled={sending}
              onClick={onRetryFailedOffers}
            >
              Retry failed offers
            </button>
          </div>
        ) : null}
        <div className={`chat-shell__composer${voice.isRecording ? ' is-listening' : ''}`}>
          {createDock}
          {slashCommands.length > 0 ? (
            <ChatSlashCommandPalette
              commands={slashCommands}
              activeIndex={Math.min(slashIndex, slashCommands.length - 1)}
              language={language}
              listId={slashListId}
              onHover={setSlashIndex}
              onSelect={insertSlashCommand}
            />
          ) : null}
          <textarea
            value={composer}
            onChange={(e) => {
              if (!sessionKey) return
              const value = e.target.value
              setSlashDismissed(false)
              setDrafts((prev) => ({ ...prev, [sessionKey]: value }))
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              voice.isRecording
                ? t.voiceListening
                : voice.isTranscribing
                  ? t.voiceTranscribing
                  : !session
                    ? t.selectSession
                    : setupPlaceholder
                      ? setupPlaceholder
                      : !offerProductId
                        ? t.chooseOffers
                        : imageClarify
                          ? t.askPost
                          : scriptClarify
                            ? t.askScriptType
                            : t.askScripts
            }
            disabled={!composerEnabled || voiceBusy || loadingMessages}
            aria-disabled={!composerEnabled || voiceBusy || loadingMessages}
            rows={2}
            aria-label={t.composer}
            role={slashCommands.length > 0 ? 'combobox' : undefined}
            aria-expanded={slashCommands.length > 0}
            aria-controls={slashCommands.length > 0 ? slashListId : undefined}
            aria-activedescendant={
              slashCommands.length > 0
                ? `${slashListId}-${slashCommands[slashIndex]?.id || slashCommands[0]?.id}`
                : undefined
            }
            aria-autocomplete={slashCommands.length > 0 ? 'list' : undefined}
          />
          <div className="chat-shell__composer-tools">
            {onUploadBrandAsset || onUploadSetupDocument ? (
              <div className="chat-shell__attach">
                {onUploadBrandAsset ? (
                  <>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      hidden
                      onChange={(e) => {
                        handleAttachFiles('logo', e.target.files)
                        e.target.value = ''
                      }}
                    />
                    <input
                      ref={referenceInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      hidden
                      onChange={(e) => {
                        handleAttachFiles('reference', e.target.files)
                        e.target.value = ''
                      }}
                    />
                  </>
                ) : null}
                {onUploadSetupDocument ? (
                  <input
                    ref={documentInputRef}
                    type="file"
                    accept="application/pdf,text/plain,text/markdown,text/csv,.pdf,.txt,.md,.csv"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void onUploadSetupDocument(file)
                      e.target.value = ''
                    }}
                  />
                ) : null}
                <button
                  type="button"
                  className="chat-shell__icon-btn"
                  disabled={!composerEnabled || sending || loadingMessages}
                  aria-label={t.attach}
                  title={t.attach}
                  onClick={() => setAttachOpen((open) => !open)}
                >
                  <Paperclip size={16} aria-hidden />
                </button>
                {attachOpen ? (
                  <div className="chat-shell__attach-menu" role="menu">
                    {onUploadBrandAsset ? (
                      <>
                        <button type="button" role="menuitem" onClick={() => pickAttach('logo')}>
                          {t.attachLogo}
                        </button>
                        <button type="button" role="menuitem" onClick={() => pickAttach('reference')}>
                          {t.attachReference}
                        </button>
                      </>
                    ) : null}
                    {onUploadSetupDocument ? (
                      <button type="button" role="menuitem" onClick={() => pickAttach('document')}>
                        {t.attachDocument}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className={`chat-shell__icon-btn chat-shell__mic${voice.isRecording ? ' is-recording' : ''}`}
              disabled={!composerEnabled || sending || voice.isTranscribing || loadingMessages}
              aria-disabled={!composerEnabled || sending || voice.isTranscribing || loadingMessages}
              aria-pressed={voice.isRecording}
              aria-label={voice.isRecording ? t.voiceStop : t.voice}
              title={voice.supported ? (voice.isRecording ? t.voiceStop : t.voice) : t.voiceUnsupported}
              onClick={() => void voice.toggle()}
            >
              {voice.isTranscribing
                ? <Loader2 size={16} className="chat-shell__spin" aria-hidden />
                : voice.isRecording
                  ? <Square size={14} aria-hidden />
                  : <Mic size={16} aria-hidden />}
            </button>
            <button
              type="button"
              className="chat-shell__send"
              disabled={!canSend}
              aria-disabled={!canSend}
              aria-label={sending ? t.generating : t.send}
              onClick={submit}
            >
              {sending
                ? <Loader2 size={16} className="chat-shell__spin" aria-hidden />
                : <ArrowUp size={18} strokeWidth={2.4} aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
