import { useEffect, useState } from 'react'
import { CREDIT_WEIGHTS } from '../../lib/creditsCatalog'
import { withRemainingBalance } from './chatShellCreditQuote'
import {
  clampComposerBulkCount,
  fetchBulkAngles,
  runBulkCampaignRequest,
  runBulkScriptsRequest,
  sanitizeComposerBulkCountDraft,
  stepComposerBulkCount,
  type AngleBoardItem,
  type BulkAnglesResponse,
  type StyleDna,
} from './chatShellBulk'
import ChatShellFlowSheet from './ChatShellFlowSheet'
import { shellT, type ChatShellLanguage } from './chatShellLabels'

export type PackLaunchInfo = {
  count: number
  mode: 'scripts' | 'campaign'
}

interface ChatShellBulkDialogProps {
  open: boolean
  language: ChatShellLanguage
  brandId: string
  offerId?: string
  sessionId?: string
  initialCount?: number
  creditsRemaining?: number
  creditsEnabled?: boolean
  onClose: () => void
  onLaunch?: (info: PackLaunchInfo) => void
  onDone: (summary: string, result?: { sessionId?: string }) => void
  onError?: (message: string) => void
}

export default function ChatShellBulkDialog({
  open,
  language,
  brandId,
  offerId,
  sessionId,
  initialCount = 10,
  creditsRemaining,
  creditsEnabled = false,
  onClose,
  onLaunch,
  onDone,
  onError,
}: ChatShellBulkDialogProps) {
  const t = shellT(language)
  const es = language === 'es'
  const [countDraft, setCountDraft] = useState(String(clampComposerBulkCount(initialCount)))
  const [mode, setMode] = useState<'scripts' | 'campaign'>('scripts')
  const [styleDnaId, setStyleDnaId] = useState('')
  const [board, setBoard] = useState<BulkAnglesResponse | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<'angles' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2>(1)

  useEffect(() => {
    if (!open) return
    setCountDraft(String(clampComposerBulkCount(initialCount)))
    setBoard(null)
    setSelected([])
    setError(null)
    setBusy(null)
    setStep(1)
  }, [open, initialCount])

  if (!open) return null

  const count = clampComposerBulkCount(countDraft === '' ? 10 : countDraft)
  const selectedAngles: AngleBoardItem[] = (board?.angles || []).filter((angle) => selected.includes(angle.id))
  const quote = mode === 'campaign' ? board?.quoteCampaign : board?.quoteScripts
  const styleDnas: StyleDna[] = board?.styleDnas || []
  const units = selectedAngles.length > 0 ? selectedAngles.length : count
  const estimatedCredits = mode === 'campaign'
    ? units * (CREDIT_WEIGHTS.guion_oferta + CREDIT_WEIGHTS.image_standard)
    : units * CREDIT_WEIGHTS.guion_oferta
  const creditsLine = withRemainingBalance(
    step === 2 && board && quote
      ? `${t.bulkQuote}: ${quote.totalCredits} · ${quote.note}`
      : (es
        ? `${estimatedCredits} créditos · máximo estimado`
        : `${estimatedCredits} credits · estimated maximum`),
    creditsEnabled ? creditsRemaining : null,
    language,
    creditsEnabled
  )
  const canConfirm = step === 2 && Boolean(board) && selectedAngles.length > 0

  async function loadAngles() {
    setBusy('angles')
    setError(null)
    const nextCount = clampComposerBulkCount(countDraft === '' ? 10 : countDraft)
    setCountDraft(String(nextCount))
    try {
      const next = await fetchBulkAngles({
        brandId,
        offerId,
        sessionId,
        count: nextCount,
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
    if (!board || selectedAngles.length === 0 || !canConfirm) return
    const fail = (message: string) => {
      onLaunch?.({ count: selectedAngles.length, mode })
      onError?.(message)
    }
    if (!sessionId) {
      fail(es
        ? 'No hay un chat abierto para guardar el pack.'
        : 'Open a chat before generating a pack.')
      return
    }
    onLaunch?.({ count: selectedAngles.length, mode })
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
        if (result.succeededScripts <= 0 && result.succeededPosts <= 0) {
          onError?.(es
            ? 'No se pudo generar el pack. Ningún guion se guardó.'
            : 'Could not generate the pack. No scripts were saved.')
          return
        }
        onDone(es
          ? `Pack ${result.packId.slice(0, 8)}: ${result.succeededScripts} guiones y ${result.succeededPosts} posts. ${result.charged} créditos.`
          : `Pack ${result.packId.slice(0, 8)}: ${result.succeededScripts} scripts and ${result.succeededPosts} posts. ${result.charged} credits.`, {
          sessionId: result.sessionId,
        })
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
        if (result.succeeded <= 0) {
          onError?.(es
            ? 'No se pudo generar el pack. Ningún guion se guardó.'
            : 'Could not generate the pack. No scripts were saved.')
          return
        }
        onDone(es
          ? `Pack ${result.packId.slice(0, 8)}: ${result.succeeded} guiones guardados. ${result.charged} créditos.`
          : `Pack ${result.packId.slice(0, 8)}: ${result.succeeded} scripts saved. ${result.charged} credits.`, {
          sessionId: result.sessionId,
        })
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t.bulkFailed)
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
      creditsLine={creditsLine}
      wide
      onCancel={onClose}
      onBack={step === 2 ? () => { setStep(1); setError(null) } : null}
      cancelDisabled={busy === 'run'}
      secondary={{
        label: busy === 'angles' ? t.generating : t.bulkPropose,
        disabled: Boolean(busy),
        onClick: () => void loadAngles(),
      }}
      primary={
        canConfirm
          ? {
              label: busy === 'run' ? t.generating : t.bulkConfirm,
              disabled: Boolean(busy) || selectedAngles.length === 0,
              onClick: () => void confirmRun(),
            }
          : null
      }
    >
      <label className="chat-shell__modal-label" htmlFor="chat-shell-bulk-count">
        {t.bulkCount}
      </label>
      <div className="chat-shell__qty">
        <button
          type="button"
          className="chat-shell__qty-btn"
          aria-label={es ? 'Menos' : 'Decrease'}
          disabled={Boolean(busy) || count <= 2}
          onClick={() => setCountDraft(stepComposerBulkCount(countDraft, -1))}
        >
          −
        </button>
        <input
          id="chat-shell-bulk-count"
          className="chat-shell__modal-input chat-shell__modal-input--qty"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={countDraft}
          disabled={Boolean(busy)}
          onChange={(event) => setCountDraft(sanitizeComposerBulkCountDraft(event.target.value))}
          onBlur={() => setCountDraft(String(clampComposerBulkCount(countDraft === '' ? 10 : countDraft)))}
        />
        <button
          type="button"
          className="chat-shell__qty-btn"
          aria-label={es ? 'Más' : 'Increase'}
          disabled={Boolean(busy) || count >= 25}
          onClick={() => setCountDraft(stepComposerBulkCount(countDraft, 1))}
        >
          +
        </button>
      </div>

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

      {error ? <p className="chat-shell__modal-error">{error}</p> : null}
    </ChatShellFlowSheet>
  )
}
