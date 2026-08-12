import type { KeyboardEvent } from 'react'
import ScriptCard from '../../components/ScriptCard'
import type { Business, ChatSession, Message, Product } from '../../types'
import { isScriptContent, parseScripts } from '../../utils/scriptParser'

interface ChatThreadProps {
  brand: Business | null
  session: ChatSession | null
  messages: Message[]
  loadingMessages: boolean
  sending: boolean
  savingScript: boolean
  activeProduct: Product | null
  offerProductId: string | null
  composer: string
  onComposerChange: (value: string) => void
  onSend: () => void
  error: string | null
  notice: string | null
  onSaveScript: (
    content: string,
    title: string,
    opts?: { edit_source?: string; message_id?: string; script_index?: number }
  ) => Promise<string | null>
  onEditScript: (
    originalContent: string,
    instruction: string,
    editType?: 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness'
  ) => Promise<string>
  onSaveVersion: (
    parentId: string,
    content: string,
    editSource: string,
    editLabel?: string
  ) => Promise<string | null>
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
  composer,
  onComposerChange,
  onSend,
  error,
  notice,
  onSaveScript,
  onEditScript,
  onSaveVersion,
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
                ? `Session ready · offer ${activeProduct.name}. Ask for a script to generate.`
                : 'Session ready · Quick / no offer yet. Choose a product in the Offers rail before generating.'}
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

            const hasScripts = isScriptContent(message.content)
            const parsed = hasScripts ? parseScripts(message.content) : []
            const showCards = hasScripts && parsed.length >= 1

            if (showCards) {
              return (
                <div key={message.id} className="chat-shell__msg chat-shell__msg--ai">
                  <span className="chat-shell__who">Advance AI</span>
                  <div className="chat-shell__script-stack">
                    {parsed.map((script) => (
                      <ScriptCard
                        key={`${message.id}-script-${script.index}`}
                        script={script}
                        language="es"
                        actionsPreset="shell"
                        onSave={offerProductId ? onSaveScript : undefined}
                        onEdit={offerProductId ? onEditScript : undefined}
                        onSaveVersion={offerProductId ? onSaveVersion : undefined}
                        savingScript={savingScript}
                        productType={activeProduct?.type}
                        productId={offerProductId || undefined}
                        sessionId={session.id}
                        messageId={message.id}
                        scriptIndex={script.index}
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
        <div className="chat-shell__composer">
          <div className="chat-shell__composer-chips">
            <span className="chat-shell__btn chat-shell__btn--pill">
              {brand ? brand.name : 'No brand'}
            </span>
            <span className="chat-shell__btn chat-shell__btn--pill">
              {!session
                ? 'No session'
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
                  ? 'Choose an offer in the rail, then ask for a script…'
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
            disabled={!session || sending || !composer.trim()}
            aria-disabled={!session || sending || !composer.trim()}
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
