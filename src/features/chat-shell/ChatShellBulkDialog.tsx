import { useEffect, useId, useState } from 'react'
import {
  clampComposerBulkCount,
  fetchBulkAngles,
  runBulkCampaignRequest,
  runBulkScriptsRequest,
  type AngleBoardItem,
  type BulkAnglesResponse,
  type StyleDna,
} from './chatShellBulk'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

interface ChatShellBulkDialogProps {
  open: boolean
  language: ChatShellLanguage
  brandId: string
  offerId?: string
  sessionId?: string
  initialCount?: number
  onClose: () => void
  onDone: (summary: string) => void
}

export default function ChatShellBulkDialog({
  open,
  language,
  brandId,
  offerId,
  sessionId,
  initialCount = 10,
  onClose,
  onDone,
}: ChatShellBulkDialogProps) {
  const t = shellT(language)
  const titleId = useId()
  const es = language === 'es'
  const [count, setCount] = useState(clampComposerBulkCount(initialCount))
  const [mode, setMode] = useState<'scripts' | 'campaign'>('scripts')
  const [styleDnaId, setStyleDnaId] = useState('')
  const [board, setBoard] = useState<BulkAnglesResponse | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<'angles' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCount(clampComposerBulkCount(initialCount))
    setBoard(null)
    setSelected([])
    setError(null)
    setProgress(null)
    setBusy(null)
  }, [open, initialCount])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose, open])

  if (!open) return null

  const selectedAngles: AngleBoardItem[] = (board?.angles || []).filter((angle) => selected.includes(angle.id))
  const quote = mode === 'campaign' ? board?.quoteCampaign : board?.quoteScripts
  const styleDnas: StyleDna[] = board?.styleDnas || []

  async function loadAngles() {
    setBusy('angles')
    setError(null)
    try {
      const next = await fetchBulkAngles({
        brandId,
        offerId,
        sessionId,
        count,
        language,
      })
      setBoard(next)
      setSelected(next.angles.map((angle) => angle.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.bulkFailed)
    } finally {
      setBusy(null)
    }
  }

  async function confirmRun() {
    if (!board || selectedAngles.length === 0) return
    setBusy('run')
    setError(null)
    setProgress(es ? 'Generando…' : 'Generating…')
    try {
      if (mode === 'campaign') {
        const result = await runBulkCampaignRequest({
          brandId,
          offerId,
          sessionId,
          count: selectedAngles.length,
          language,
          angles: selectedAngles,
          angleIds: selected,
          styleDnaId: styleDnaId || undefined,
        })
        onDone(es
          ? `Pack ${result.packId.slice(0, 8)}: ${result.succeededScripts} guiones y ${result.succeededPosts} posts. ${result.charged} créditos.`
          : `Pack ${result.packId.slice(0, 8)}: ${result.succeededScripts} scripts and ${result.succeededPosts} posts. ${result.charged} credits.`)
      } else {
        const result = await runBulkScriptsRequest({
          brandId,
          offerId,
          sessionId,
          count: selectedAngles.length,
          language,
          angles: selectedAngles,
          angleIds: selected,
        })
        onDone(es
          ? `Pack ${result.packId.slice(0, 8)}: ${result.succeeded} guiones guardados. ${result.charged} créditos.`
          : `Pack ${result.packId.slice(0, 8)}: ${result.succeeded} scripts saved. ${result.charged} credits.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.bulkFailed)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  return (
    <div className="chat-shell__modal-root" role="presentation">
      <button
        type="button"
        className="chat-shell__modal-backdrop"
        aria-label={t.cancel}
        disabled={busy === 'run'}
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        className="chat-shell__modal chat-shell__modal--bulk"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="chat-shell__modal-title">{t.bulkTitle}</h2>
        <p className="chat-shell__modal-copy">{t.bulkCopy}</p>

        <label className="chat-shell__modal-label" htmlFor={`${titleId}-count`}>
          {t.bulkCount}
        </label>
        <input
          id={`${titleId}-count`}
          className="chat-shell__modal-input"
          type="number"
          min={2}
          max={25}
          value={count}
          disabled={Boolean(busy)}
          onChange={(event) => setCount(clampComposerBulkCount(event.target.value))}
        />

        <div className="chat-shell__bulk-modes">
          <button
            type="button"
            className={`chat-shell__btn chat-shell__btn--pill${mode === 'scripts' ? ' is-on' : ''}`}
            disabled={Boolean(busy)}
            onClick={() => setMode('scripts')}
          >
            {t.bulkScriptsOnly}
          </button>
          <button
            type="button"
            className={`chat-shell__btn chat-shell__btn--pill${mode === 'campaign' ? ' is-on' : ''}`}
            disabled={Boolean(busy)}
            onClick={() => setMode('campaign')}
          >
            {t.bulkCampaign}
          </button>
        </div>

        {styleDnas.length > 0 ? (
          <>
            <label className="chat-shell__modal-label" htmlFor={`${titleId}-dna`}>
              {t.bulkStyleDna}
            </label>
            <select
              id={`${titleId}-dna`}
              className="chat-shell__modal-input"
              value={styleDnaId}
              disabled={Boolean(busy)}
              onChange={(event) => setStyleDnaId(event.target.value)}
            >
              <option value="">{t.bulkStyleDnaNone}</option>
              {styleDnas.map((dna) => (
                <option key={dna.id} value={dna.id}>{dna.name} ({dna.kind})</option>
              ))}
            </select>
          </>
        ) : null}

        {board ? (
          <ul className="chat-shell__bulk-angles">
            {board.angles.map((angle) => (
              <li key={angle.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(angle.id)}
                    disabled={Boolean(busy)}
                    onChange={() => {
                      setSelected((prev) => (
                        prev.includes(angle.id)
                          ? prev.filter((id) => id !== angle.id)
                          : [...prev, angle.id]
                      ))
                    }}
                  />
                  <span>
                    <strong>{angle.title}</strong>
                    <small>{angle.niche} · {angle.hookStyle}</small>
                    <em>{angle.whyItBuys}</em>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="chat-shell__modal-copy">{t.bulkNeedBoard}</p>
        )}

        {quote ? (
          <p className="chat-shell__bulk-quote">
            {t.bulkQuote}: {quote.totalCredits} · {quote.note}
          </p>
        ) : null}
        {progress ? <p className="chat-shell__modal-copy">{progress}</p> : null}
        {error ? <p className="chat-shell__modal-error">{error}</p> : null}

        <div className="chat-shell__modal-actions">
          <button type="button" className="chat-shell__modal-btn" disabled={busy === 'run'} onClick={onClose}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="chat-shell__modal-btn"
            disabled={Boolean(busy)}
            onClick={() => void loadAngles()}
          >
            {busy === 'angles' ? t.generating : t.bulkPropose}
          </button>
          <button
            type="button"
            className="chat-shell__modal-btn is-primary"
            disabled={Boolean(busy) || selectedAngles.length === 0}
            onClick={() => void confirmRun()}
          >
            {busy === 'run' ? t.generating : t.bulkConfirm}
          </button>
        </div>
      </div>
    </div>
  )
}
