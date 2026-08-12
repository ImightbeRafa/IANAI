const SCRIPT_SAMPLE = `[GANCHO]
Si dormís mal, el parche no es “relax” — es dosis.

[CTA]
Escribí SLEEP y te armamos el pack.`

export default function ChatThread() {
  return (
    <>
      <div className="chat-shell__thread" role="log" aria-label="Conversation">
        <div className="chat-shell__msg chat-shell__msg--user">
          3 guiones for Sleep patch + Melatonin 5mg, then image for #1.
        </div>
        <div className="chat-shell__msg chat-shell__msg--ai">
          Using 2 offers. Scripts in-thread; Images rail open for the creative.
        </div>

        <article className="chat-shell__card">
          <h3>
            Venta Directa
            <span className="chat-shell__tag">Sleep patch</span>
            #1
          </h3>
          <div className="chat-shell__script">{SCRIPT_SAMPLE}</div>
          <div className="chat-shell__actions">
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled>Copiar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled>Guardar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill is-active" disabled>Editar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled>Mejorar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled>+ Hooks</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled>→ Imagen</button>
          </div>
        </article>

        <article className="chat-shell__card">
          <h3>
            Imagen · guion #1
            <span className="chat-shell__tag">Sleep patch</span>
          </h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="chat-shell__thumb" style={{ width: 72, flexShrink: 0 }}>thumb</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Ad creative — opens the right rail for editing.
            </div>
          </div>
          <div className="chat-shell__actions">
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled>Descargar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill is-active" disabled>Open in panel</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled>Usar en post</button>
          </div>
        </article>
      </div>

      <div className="chat-shell__composer-wrap">
        <div className="chat-shell__chips">
          <span className="chat-shell__btn chat-shell__btn--pill">2 offers</span>
          <span className="chat-shell__btn chat-shell__btn--pill">Mensajes</span>
          <span className="chat-shell__btn chat-shell__btn--pill">Pipeline</span>
        </div>
        <div className="chat-shell__composer">
          <button type="button" className="chat-shell__btn" disabled aria-label="Attach">+</button>
          <textarea
            placeholder="Ask for scripts, posts, images..."
            disabled
            rows={2}
            aria-label="Message composer (coming soon)"
          />
          <button type="button" className="chat-shell__send" disabled aria-label="Send">↑</button>
        </div>
      </div>
    </>
  )
}
