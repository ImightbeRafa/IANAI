import type { Business, ChatSession } from '../../types'

interface ChatThreadProps {
  brand: Business | null
  session: ChatSession | null
}

export default function ChatThread({ brand, session }: ChatThreadProps) {
  const empty = !session

  return (
    <>
      <div className="chat-shell__thread" role="log" aria-label="Conversation">
        {empty ? (
          <div className="chat-shell__msg chat-shell__msg--ai">
            <span className="chat-shell__who">Advance AI</span>
            <div className="chat-shell__status-box">
              {brand
                ? `Select or create a session under ${brand.name}. Composer generation comes in a later phase.`
                : 'Select a brand in the sidebar (or create one from Dashboard) to start.'}
            </div>
          </div>
        ) : (
          <>
            <div className="chat-shell__msg chat-shell__msg--ai">
              <span className="chat-shell__who">Advance AI</span>
              <div className="chat-shell__status-box">
                Session ready{session.product_id == null ? ' · Quick (no product)' : ''}.
                Messages and generation are foundation-only for now — ask for scripts in a later phase.
              </div>
            </div>
            {session.context ? (
              <div className="chat-shell__msg chat-shell__msg--ai">
                <span className="chat-shell__who">Context</span>
                <div className="chat-shell__status-box">{session.context}</div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="chat-shell__composer-wrap">
        <div className="chat-shell__composer">
          <div className="chat-shell__composer-chips">
            <span className="chat-shell__btn chat-shell__btn--pill">
              {brand ? brand.name : 'No brand'}
            </span>
            <span className="chat-shell__btn chat-shell__btn--pill">
              {!session
                ? 'No session'
                : session.product_id == null
                  ? 'Quick · no product'
                  : 'Product session'}
            </span>
            <span className="chat-shell__btn chat-shell__btn--pill">Coming soon</span>
          </div>
          <button type="button" className="chat-shell__btn" disabled aria-disabled="true" aria-label="Attach">+</button>
          <textarea
            placeholder={session ? 'Ask for scripts, posts, images… (generation soon)' : 'Select a session to compose'}
            disabled
            aria-disabled="true"
            rows={2}
            aria-label="Message composer (coming soon)"
          />
          <button type="button" className="chat-shell__send" disabled aria-disabled="true" aria-label="Send">↑</button>
        </div>
      </div>
    </>
  )
}
