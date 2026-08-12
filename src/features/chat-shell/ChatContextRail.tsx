import { useState } from 'react'

type RailTab = 'context' | 'offers' | 'images'

export default function ChatContextRail() {
  const [tab, setTab] = useState<RailTab>('images')

  return (
    <aside className="chat-shell__rail" aria-label="Context rail">
      <div className="chat-shell__tabs" role="tablist" aria-label="Rail sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'context'}
          className={`chat-shell__tab${tab === 'context' ? ' is-on' : ''}`}
          onClick={() => setTab('context')}
        >
          Context
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'offers'}
          className={`chat-shell__tab${tab === 'offers' ? ' is-on' : ''}`}
          onClick={() => setTab('offers')}
        >
          Offers (2)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'images'}
          className={`chat-shell__tab${tab === 'images' ? ' is-on' : ''}`}
          onClick={() => setTab('images')}
        >
          Images (3)
        </button>
      </div>

      {tab === 'context' && (
        <div>
          <strong>Session context</strong>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            Funnel and brand context will appear here in a later phase. P0 shows layout only.
          </p>
        </div>
      )}

      {tab === 'offers' && (
        <div className="chat-shell__stack">
          <div className="chat-shell__nav-item is-active">1 · Sleep patch</div>
          <div className="chat-shell__nav-item">2 · Melatonin 5mg</div>
          <p style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>
            Max 5 offers · sequential generation (later phase)
          </p>
        </div>
      )}

      {tab === 'images' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <strong>Selected creative</strong>
            <span style={{ color: 'var(--accent-muted)', fontSize: '0.8rem' }}>edit</span>
          </div>
          <div className="chat-shell__preview">Sleep patch preview</div>
          <div className="chat-shell__stack">
            <button type="button" className="chat-shell__btn" disabled>Editar imagen</button>
            <button type="button" className="chat-shell__btn" disabled>Restyle</button>
            <button type="button" className="chat-shell__btn" disabled>Variaciones</button>
            <button type="button" className="chat-shell__btn" disabled>Change product photo</button>
          </div>
          <div className="chat-shell__nav-label">Thread images</div>
          <div className="chat-shell__thumbs">
            <div className="chat-shell__thumb is-sel">#1</div>
            <div className="chat-shell__thumb">#2</div>
            <div className="chat-shell__thumb">var</div>
            <div className="chat-shell__thumb">+</div>
          </div>
        </>
      )}
    </aside>
  )
}
