import { useEffect, useRef, useState } from 'react'
import { autoFillFromText, autoFillFromUrl } from '../../utils/formAutoFill'
import type { ChatSessionSafeUpdates } from '../../services/database'
import type { ChatSession } from '../../types'
import {
  buildSessionSetupUpdates,
  draftFromSession,
  normalizeSessionContextAutofill,
  SETUP_AWARENESS,
  SETUP_CHANNELS,
  shouldShowSetupInterview,
  type SessionSetupDraft,
} from './chatContextSetup'

interface ChatContextSetupCardProps {
  session: ChatSession
  skipped: boolean
  forceOpen: boolean
  onSkipped: () => void
  onForceOpenConsumed?: () => void
  onSaved: (updates: ChatSessionSafeUpdates) => void | Promise<void>
}

export default function ChatContextSetupCard({
  session,
  skipped,
  forceOpen,
  onSkipped,
  onForceOpenConsumed,
  onSaved,
}: ChatContextSetupCardProps) {
  const visible = shouldShowSetupInterview({
    session,
    skippedSessionIds: skipped ? new Set([session.id]) : new Set(),
    forceOpen,
  })

  const [draft, setDraft] = useState<SessionSetupDraft>(() => draftFromSession(session))
  const [url, setUrl] = useState('')
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const sessionIdRef = useRef(session.id)
  sessionIdRef.current = session.id

  useEffect(() => {
    setDraft(draftFromSession(session))
    setUrl('')
    setPaste('')
    setError(null)
    setSaveError(null)
    setStatus('')
    requestRef.current += 1
  }, [session.id])

  useEffect(() => {
    if (forceOpen) onForceOpenConsumed?.()
  }, [forceOpen, onForceOpenConsumed])

  if (!visible) return null

  const patchDraft = (partial: Partial<SessionSetupDraft>) => {
    setDraft((prev) => ({ ...prev, ...partial }))
  }

  const runAutofill = async (source: 'url' | 'paste') => {
    if (busy) return
    const requestId = ++requestRef.current
    const originSessionId = session.id
    setBusy(true)
    setError(null)
    setSaveError(null)
    setStatus(source === 'url' ? 'Fetching URL…' : 'Analyzing…')
    try {
      if (source === 'url') {
        if (!url.trim()) {
          setError('Paste a URL first.')
          return
        }
        setStatus('Fetching URL…')
        const { data, error: err } = await autoFillFromUrl(url.trim(), 'session_context', 'en')
        if (requestId !== requestRef.current || sessionIdRef.current !== originSessionId) return
        if (!data || err) {
          setError(err || 'Could not extract content from link')
          setStatus('')
          return
        }
        patchDraft(normalizeSessionContextAutofill(data))
        setStatus('Draft filled — review and save.')
      } else {
        if (!paste.trim()) {
          setError('Paste document text first.')
          return
        }
        setStatus('Analyzing…')
        const { data, error: err } = await autoFillFromText(paste.trim(), 'session_context', 'en')
        if (requestId !== requestRef.current || sessionIdRef.current !== originSessionId) return
        if (!data || err) {
          setError(err || 'Could not analyze pasted text')
          setStatus('')
          return
        }
        patchDraft(normalizeSessionContextAutofill(data))
        setStatus('Draft filled — review and save.')
      }
    } catch (err) {
      if (requestId !== requestRef.current || sessionIdRef.current !== originSessionId) return
      setError(err instanceof Error ? err.message : 'Setup autofill failed')
      setStatus('')
    } finally {
      if (requestId === requestRef.current) setBusy(false)
    }
  }

  const handleSave = async () => {
    const result = buildSessionSetupUpdates(draft)
    if (!result.ok) {
      setSaveError(result.error)
      return
    }
    setSaveError(null)
    await onSaved(result.updates as ChatSessionSafeUpdates)
  }

  return (
    <div className="chat-shell__setup" aria-label="Session setup">
      <div className="chat-shell__setup-head">
        <strong>Setup</strong>
        <span>Brief this session — does not create products or offers.</span>
      </div>

      <label className="chat-shell__field">
        <span>Paste URL</span>
        <div className="chat-shell__setup-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            disabled={busy}
            aria-label="Setup URL"
          />
          <button
            type="button"
            className="chat-shell__setup-btn"
            disabled={busy || !url.trim()}
            onClick={() => void runAutofill('url')}
          >
            Fetch
          </button>
        </div>
      </label>

      <label className="chat-shell__field">
        <span>Or paste doc text</span>
        <textarea
          rows={3}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste brand / offer notes…"
          disabled={busy}
          aria-label="Setup paste text"
        />
        <button
          type="button"
          className="chat-shell__setup-btn chat-shell__setup-btn--block"
          disabled={busy || !paste.trim()}
          onClick={() => void runAutofill('paste')}
        >
          Analyze text
        </button>
      </label>

      {(error || status) && (
        <p className={`chat-shell__setup-status${error ? ' is-error' : ''}`} role="status">
          {error || status}
        </p>
      )}

      <label className="chat-shell__field">
        <span>Title (optional)</span>
        <input
          value={draft.title}
          onChange={(e) => patchDraft({ title: e.target.value })}
          disabled={busy}
        />
      </label>

      <label className="chat-shell__field">
        <span>Context</span>
        <textarea
          rows={5}
          value={draft.context}
          onChange={(e) => patchDraft({ context: e.target.value })}
          placeholder="Session brief for script generation…"
          disabled={busy}
        />
      </label>

      <label className="chat-shell__field">
        <span>Primary channel</span>
        <select
          value={draft.primary_channel}
          onChange={(e) =>
            patchDraft({
              primary_channel: (e.target.value || '') as SessionSetupDraft['primary_channel'],
            })
          }
          disabled={busy}
        >
          <option value="">—</option>
          {SETUP_CHANNELS.map((ch) => (
            <option key={ch} value={ch}>
              {ch === 'messages' ? 'Messages' : ch === 'website' ? 'Website' : 'Physical'}
            </option>
          ))}
        </select>
      </label>

      <label className="chat-shell__field">
        <span>Awareness (optional)</span>
        <select
          value={draft.awareness_level}
          onChange={(e) =>
            patchDraft({
              awareness_level: (e.target.value || '') as SessionSetupDraft['awareness_level'],
            })
          }
          disabled={busy}
        >
          <option value="">—</option>
          {SETUP_AWARENESS.map((level) => (
            <option key={level} value={level}>
              {level === 'cold' ? 'Cold' : level === 'warm' ? 'Warm' : 'Hot'}
            </option>
          ))}
        </select>
      </label>

      {saveError ? (
        <p className="chat-shell__setup-status is-error" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="chat-shell__setup-actions">
        <button
          type="button"
          className="chat-shell__setup-btn is-primary"
          disabled={busy}
          onClick={() => void handleSave()}
        >
          Save & continue
        </button>
        <button
          type="button"
          className="chat-shell__setup-btn"
          disabled={busy}
          onClick={onSkipped}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
