import { type KeyboardEvent } from 'react'
import ChatShellScriptCard from './ChatShellScriptCard'
import ChatShellImageCard from './ChatShellImageCard'
import type {
  Business,
  ChatSession,
  Message,
  MessageArtifact,
  Product,
} from '../../types'
import { isScriptContent, parseScripts, type ParsedScript } from '../../utils/scriptParser'
import type { FailedOfferBatch, ImageClarifyState } from './useChatSessionThread'
import { sortArtifactsByOrdinal, type ShellImageLike } from './chatShellImages'
import {
  anuncioStyleChoices,
  productStyleChoices,
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
  imageBusy: boolean
  composer: string
  onComposerChange: (value: string) => void
  onSend: () => void
  error: string | null
  notice: string | null
  failedBatch: FailedOfferBatch | null
  onRetryFailedOffers: () => void
  language?: 'en' | 'es'
  imageClarify?: ImageClarifyState | null
  onAnswerImageClarify?: (answer: {
    mode?: 'anuncio' | 'product'
    styleId?: string
    switchToAnuncio?: boolean
  }) => void
  onCancelImageClarify?: () => void
  onOpenImagesRail?: () => void
  onGenerateImageFromScript?: (
    scriptText: string,
    productId?: string | null,
    scriptTitle?: string | null
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
  onEditOfferImage: (
    productImageId: string,
    imageUrl: string,
    instruction: string,
    productId?: string
  ) => Promise<void>
  onOptimizeOfferImage: (
    productImageId: string,
    imageUrl: string,
    productId?: string,
    scriptText?: string
  ) => Promise<void>
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

export default function ChatThread({
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
  imageBusy,
  composer,
  onComposerChange,
  onSend,
  error,
  notice,
  failedBatch,
  onRetryFailedOffers,
  language = 'es',
  imageClarify = null,
  onAnswerImageClarify,
  onCancelImageClarify,
  onOpenImagesRail,
  onGenerateImageFromScript,
  onSaveScript,
  onEditScript,
  onSaveVersion,
  onEditOfferImage,
  onOptimizeOfferImage,
}: ChatThreadProps) {
  const composerEnabled = Boolean(session) && !sending
  const generateBlocked = Boolean(session) && !offerProductId

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (composer.trim() && !sending) onSend()
    }
  }

  return (
    <>
      <div className="chat-shell__thread" role="log" aria-label="Conversation">
        {!session ? (
          <div className="chat-shell__msg chat-shell__msg--ai">
            <span className="chat-shell__who">Advance AI</span>
            <div className="chat-shell__status-box">
              {brand
                ? `Select or create a session under ${brand.name}.`
                : 'Select a brand in the sidebar (or create one from Dashboard) to start.'}
            </div>
          </div>
        ) : loadingMessages ? (
          <div className="chat-shell__msg chat-shell__msg--ai">
            <span className="chat-shell__who">Advance AI</span>
            <div className="chat-shell__status-box">Loading conversation…</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-shell__msg chat-shell__msg--ai">
            <span className="chat-shell__who">Advance AI</span>
            <div className="chat-shell__status-box">
              {offerProductId && activeProduct
                ? `Session ready · ${offerCount > 1 ? `${offerCount} offers` : `offer ${activeProduct.name}`}. Ask for a script to generate.`
                : 'Session ready · Quick / no offer yet. Choose products in the Offers rail before generating.'}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            if (message.role === 'user') {
              return (
                <div key={message.id} className="chat-shell__msg chat-shell__msg--user">
                  <span className="chat-shell__who">You</span>
                  <div className="chat-shell__bubble">{message.content}</div>
                </div>
              )
            }

            const artifacts = sortArtifactsByOrdinal(message.artifacts || []).filter(
              (a) =>
                (a.artifact_type === 'script' && a.script?.content)
                || (a.artifact_type === 'image' && a.product_image?.image_url)
            )

            if (artifacts.length > 0) {
              return (
                <div key={message.id} className="chat-shell__msg chat-shell__msg--ai">
                  <span className="chat-shell__who">Advance AI</span>
                  <div className="chat-shell__script-stack">
                    {artifacts.map((artifact) => {
                      if (artifact.artifact_type === 'image') {
                        return (
                          <ChatShellImageCard
                            key={artifact.id}
                            artifact={artifact}
                            productName={artifact.product?.name}
                            busy={imageBusy}
                            onEditImage={(productImageId, imageUrl, instruction) =>
                              onEditOfferImage(
                                productImageId,
                                imageUrl,
                                instruction,
                                artifact.product_id
                              )
                            }
                            onOptimizeForPost={(productImageId, imageUrl) =>
                              onOptimizeOfferImage(
                                productImageId,
                                imageUrl,
                                artifact.product_id
                              )
                            }
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
                          savingScript={savingScript}
                          offerImageId={offerImage?.id}
                          offerImageUrl={offerImage?.image_url}
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
                              ? (scriptText) =>
                                  void onGenerateImageFromScript(
                                    scriptText,
                                    productId,
                                    parsed.title
                                  )
                              : undefined
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
                          onOptimizeOfferImage={
                            offerImage
                              ? () =>
                                  onOptimizeOfferImage(
                                    offerImage.id,
                                    offerImage.image_url || '',
                                    productId,
                                    parsed.content
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
                        onSave={offerProductId ? onSaveScript : undefined}
                        onEdit={offerProductId ? onEditScript : undefined}
                        onSaveVersion={offerProductId ? onSaveVersion : undefined}
                        onGenerateImage={
                          onGenerateImageFromScript && offerProductId
                            ? (scriptText) =>
                                void onGenerateImageFromScript(
                                  scriptText,
                                  offerProductId,
                                  script.title
                                )
                            : undefined
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
          })
        )}
      </div>

      <div className="chat-shell__composer-wrap">
        {(error || notice) && (
          <div className={`chat-shell__thread-alert${error ? ' is-error' : ''}`} role="status">
            {error || notice}
          </div>
        )}
        {imageClarify ? (
          <div className="chat-shell__clarify" role="group" aria-label="Image options">
            <div className="chat-shell__clarify-chips">
              {imageClarify.step === 'mode' ? (
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
                </>
              ) : imageClarify.step === 'refs' ? (
                <>
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onOpenImagesRail?.()}
                  >
                    {language === 'es' ? 'Subir Ref' : 'Upload Ref'}
                  </button>
                  <button
                    type="button"
                    className="chat-shell__btn chat-shell__btn--pill"
                    disabled={imageBusy}
                    onClick={() => onAnswerImageClarify?.({ switchToAnuncio: true })}
                  >
                    {language === 'es' ? 'Usar Anuncio' : 'Use Ad'}
                  </button>
                </>
              ) : (
                (imageClarify.mode === 'product'
                  ? productStyleChoices(language)
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
        <div className="chat-shell__composer">
          <div className="chat-shell__composer-chips">
            <span className="chat-shell__btn chat-shell__btn--pill">
              {brand ? brand.name : 'No brand'}
            </span>
            <span className="chat-shell__btn chat-shell__btn--pill">
              {!session
                ? 'No session'
                : offerCount > 1
                  ? `${offerCount} offers`
                  : activeProduct
                    ? `Offer · ${activeProduct.name}`
                    : 'Quick · choose offer'}
            </span>
          </div>
          <button type="button" className="chat-shell__btn" disabled aria-disabled="true" aria-label="Attach">+</button>
          <textarea
            value={composer}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !session
                ? 'Select a session to compose'
                : generateBlocked
                  ? 'Choose offers in the rail, then ask for a script…'
                  : 'Ask for scripts…'
            }
            disabled={!composerEnabled}
            aria-disabled={!composerEnabled}
            rows={2}
            aria-label="Message composer"
          />
          <button
            type="button"
            className="chat-shell__send"
            disabled={!session || sending || !composer.trim() || generateBlocked}
            aria-disabled={!session || sending || !composer.trim() || generateBlocked}
            aria-label="Send"
            onClick={onSend}
          >
            {sending ? '…' : '↑'}
          </button>
        </div>
      </div>
    </>
  )
}
