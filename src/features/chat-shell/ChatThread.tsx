export default function ChatThread() {
  return (
    <>
      <div className="chat-shell__thread" role="log" aria-label="Conversation">
        <div className="chat-shell__msg chat-shell__msg--user">
          <span className="chat-shell__who">You</span>
          3 guiones for Sleep patch + Melatonin 5mg, then image for #1.
        </div>
        <div className="chat-shell__msg chat-shell__msg--ai">
          <span className="chat-shell__who">Advance AI</span>
          <div className="chat-shell__status-box">
            Using 2 offers. Scripts in-thread; Images rail open for the creative.
          </div>
        </div>

        <article className="chat-shell__card">
          <h3>
            Venta Directa
            <span className="chat-shell__tag">Sleep patch</span>
            #1
          </h3>
          <div className="chat-shell__script">
            <span className="chat-shell__script-label">[GANCHO]</span>
            {'\n'}
            Si dormís mal, el parche no es “relax” — es dosis.
            {'\n\n'}
            <span className="chat-shell__script-label">[CTA]</span>
            {'\n'}
            Escribí SLEEP y te armamos el pack.
          </div>
          <div className="chat-shell__actions">
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled aria-disabled="true">Copiar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled aria-disabled="true">Guardar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill is-active" disabled aria-disabled="true">Editar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled aria-disabled="true">Mejorar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled aria-disabled="true">+ Hooks</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled aria-disabled="true">→ Imagen</button>
          </div>
        </article>

        <article className="chat-shell__card is-selected">
          <h3>
            Imagen · guion #1
            <span className="chat-shell__tag">Sleep patch</span>
          </h3>
          <div className="chat-shell__media-row">
            <div className="chat-shell__thumb chat-shell__media-thumb">thumb</div>
            <div className="chat-shell__media-copy">
              Ad creative — opens the right rail for editing.
            </div>
          </div>
          <div className="chat-shell__actions">
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled aria-disabled="true">Descargar</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill is-active" disabled aria-disabled="true">Open in panel</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--pill" disabled aria-disabled="true">Usar en post</button>
          </div>
        </article>
      </div>

      <div className="chat-shell__composer-wrap">
        <div className="chat-shell__composer">
          <div className="chat-shell__composer-chips">
            <span className="chat-shell__btn chat-shell__btn--pill">2 offers</span>
            <span className="chat-shell__btn chat-shell__btn--pill">Mensajes</span>
            <span className="chat-shell__btn chat-shell__btn--pill">Pipeline</span>
          </div>
          <button type="button" className="chat-shell__btn" disabled aria-disabled="true" aria-label="Attach">+</button>
          <textarea
            placeholder="Ask for scripts, posts, images..."
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
