import { useEffect, useState } from 'react'
import {
  clampComposerBulkCount,
  fetchBulkAngles,
  runBulkCampaignRequest,
  runBulkScriptsRequest,
  type AngleBoardItem,
  type BulkAnglesResponse,
  type StyleDna,
} from './chatShellBulk'
import ChatShellFlowSheet from './ChatShellFlowSheet'
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
  const es = language === 'es'
  const [count, setCount] = useState(clampComposerBulkCount(initialCount))
  const [mode, setMode] = useState<'scripts' | 'campaign'>('scripts')
  const [styleDnaId, setStyleDnaId] = useState('')
  const [board, setBoard] = useState<BulkAnglesResponse | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<'angles' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2>(1)

  useEffect(() => {
    if (!open) return
    setCount(clampComposerBulkCount(initialCount))
    setBoard(null)
    setSelected([])
    setError(null)
    setProgress(null)
    setBusy(null)
    setStep(1)
  }, [open, initialCount])

  if (!open) return null

  const selectedAngles: AngleBoardItem[] = (board?.angles || []).filter((angle) => selected.includes(angle.id))
  const quote = mode === 'campaign' ? board?.quoteCampaign : board?.quoteScripts
  const styleDnas: StyleDna[] = board?.styleDnas || []
  const creditsLine = quote
    ? `${t.bulkQuote}: ${quote.totalCredits} · ${quote.note}`
    : null

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
      setStep(2)
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
    <ChatShellFlowSheet
      open={open}
      language={language}
      title={t.bulkTitle}
      copy={t.bulkCopy}
      step={step}
      stepTotal={2}
      creditsLine={step === 2 ? creditsLine : null}
      wide
      onCancel={onClose}
      onBack={step === 2 ? () => { setStep(1); setError(null) } : null}
      cancelDisabled={busy === 'run'}
      secondary={{
        label: busy === 'angles' ? t.generating : t.bulkPropose,
        disabled: Boolean(busy),
        onClick: () => void loadAngles(),
      }}
      primary={{
        label: busy === 'run' ? t.generating : t.bulkConfirm,
        disabled: Boolean(busy) || selectedAngles.length === 0,
        onClick: () => void confirmRun(),
      }}
    >
      <label className="chat-shell__modal-label" htmlFor="chat-shell-bulk-count">
        {t.bulkCount}
      </label>
      <input
        id="chat-shell-bulk-count"
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
          <label className="chat-shell__modal-label" htmlFor="chat-shell-bulk-dna">
            {t.bulkStyleDna}
          </label>
          <select
            id="chat-shell-bulk-dna"
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

      {progress ? <p className="chat-shell__modal-copy">{progress}</p> : null}
      {error ? <p className="chat-shell__modal-error">{error}</p> : null}
    </ChatShellFlowSheet>
  )
}
