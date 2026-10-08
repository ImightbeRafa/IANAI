/**
 * DEV-ONLY QA harness: `/dev/adpack-studio` renders the Ad Pack studio standalone
 * against an in-memory mock client. App.tsx registers this route only when
 * `import.meta.env.DEV`, so neither this page nor the mock ships in prod bundles.
 *
 * Query params: `?lang=en`, `?credits=low` (insufficient credits), `?theme=light|dark`.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import ChatShellAdPackStudio from '../features/chat-shell/ChatShellAdPackStudio'
import type { AdPackClient } from '../features/chat-shell/adPackApi'
import {
  applyChatShellTheme,
  clearChatShellTheme,
  systemPrefersLight,
  type ChatShellTheme,
} from '../features/chat-shell/chatShellTheme'
import type { ChatShellLanguage } from '../features/chat-shell/chatShellLabels'
import '../features/chat-shell/chat-shell.css'

type MockClient = AdPackClient & { setCredits(n: number): void; credits(): number }

export default function DevAdPackStudioPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [language, setLanguage] = useState<ChatShellLanguage>(params.get('lang') === 'en' ? 'en' : 'es')
  const [theme, setTheme] = useState<ChatShellTheme>(() => {
    const q = params.get('theme')
    if (q === 'light') return 'obsidian-light'
    if (q === 'dark') return 'obsidian-dark'
    return systemPrefersLight() ? 'obsidian-light' : 'obsidian-dark'
  })
  const [api, setApi] = useState<MockClient | null>(null)
  const [open, setOpen] = useState(true)
  const [lowCredits, setLowCredits] = useState(params.get('credits') === 'low')
  const [credits, setCredits] = useState<number | null>(null)

  useLayoutEffect(() => {
    applyChatShellTheme(theme)
    return () => clearChatShellTheme()
  }, [theme])

  // Follow the OS / emulated color scheme unless pinned by ?theme=.
  useEffect(() => {
    if (params.get('theme') || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setTheme(mq.matches ? 'obsidian-light' : 'obsidian-dark')
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [params])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let cancelled = false
    void import('../features/chat-shell/adPackApi.mock').then(({ createMockAdPackApi }) => {
      if (!cancelled) setApi(createMockAdPackApi({ credits: lowCredits ? 12 : 500 }))
    })
    return () => {
      cancelled = true
    }
    // Created once; the credits toggle is applied by the effect below.
  }, [])

  useEffect(() => {
    if (!api) return
    api.setCredits(lowCredits ? 12 : 500)
    setCredits(api.credits())
  }, [api, lowCredits])

  return (
    <div className="chat-shell" data-theme={theme} style={{ display: 'block', padding: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <strong>Ad Pack studio · DEV harness (mock API)</strong>
        <button type="button" className="chat-shell__adpack-btn" onClick={() => setOpen(true)}>Abrir estudio</button>
        <button type="button" className="chat-shell__adpack-btn" onClick={() => setTheme((t) => (t === 'obsidian-dark' ? 'obsidian-light' : 'obsidian-dark'))}>
          Tema: {theme === 'obsidian-dark' ? 'oscuro' : 'claro'}
        </button>
        <button type="button" className="chat-shell__adpack-btn" onClick={() => setLanguage((l) => (l === 'es' ? 'en' : 'es'))}>
          Idioma: {language}
        </button>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={lowCredits} onChange={(e) => setLowCredits(e.target.checked)} />
          Créditos insuficientes ({credits ?? '…'})
        </label>
      </div>
      {api ? (
        <ChatShellAdPackStudio
          open={open}
          language={language}
          api={api}
          creditsEnabled
          creditsRemaining={credits}
          prefill={{
            brandName: 'Café Montaña',
            websiteUrl: 'https://cafemontana.cr',
            instagramUrl: 'https://instagram.com/cafemontana',
          }}
          onClose={() => setOpen(false)}
          onPackStatus={() => setCredits(api.credits())}
        />
      ) : null}
    </div>
  )
}
