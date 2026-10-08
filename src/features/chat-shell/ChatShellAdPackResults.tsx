import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AdPackApiError,
  type AdPackClient,
  type AdPackItemView,
  type AdPackStatusResponse,
} from './adPackApi'
import type { AspectRatio } from '../../../api/lib/adpack/types'
import {
  adFilename,
  captionsText,
  copyDraftFromItem,
  copyPatchFromDraft,
  describeCopyIssue,
  formatGlyph,
  formatLabel,
  hookLabel,
  isTerminalPackStatus,
  itemStageLabel,
  mergeItem,
  nextPollDelay,
  packStatusLabel,
  progressLine,
  ratioCss,
  shouldKeepPolling,
  type CopyDraft,
} from './adPackStudioModel'
import { downloadShellImage } from './chatShellDownload'
import type { AdPackStudioLabels, ChatShellLanguage } from './chatShellLabels'

export interface AdPackResultsProps {
  api: AdPackClient
  packId: string
  language: ChatShellLanguage
  labels: AdPackStudioLabels
  brandName: string
  ratios: AspectRatio[]
  perAd: number
  onOpenImage: (image: { url: string; alt: string }) => void
  onStatus?: (status: AdPackStatusResponse) => void
  onAnnounce: (message: string) => void
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function errorMessage(err: unknown, labels: AdPackStudioLabels): string {
  if (err instanceof AdPackApiError) {
    if (err.code === 'INSUFFICIENT_CREDITS') return labels.insufficient(err.body.creditsRequired ?? 0, err.body.remaining)
    if (err.code === 'BUSY') return labels.busy
  }
  return err instanceof Error ? err.message : String(err)
}

export default function ChatShellAdPackResults({
  api,
  packId,
  language,
  labels: t,
  brandName,
  ratios,
  perAd,
  onOpenImage,
  onStatus,
  onAnnounce,
}: AdPackResultsProps) {
  const [status, setStatus] = useState<AdPackStatusResponse | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [pollNonce, setPollNonce] = useState(0)
  const [cancelAsk, setCancelAsk] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{ n: number; total: number } | null>(null)
  const [packError, setPackError] = useState<string | null>(null)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  const applyStatus = useCallback((next: AdPackStatusResponse) => {
    setStatus(next)
    onStatusRef.current?.(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let errors = 0
    const tick = async () => {
      try {
        const next = await api.status({ packId })
        if (cancelled) return
        errors = 0
        setPollError(null)
        applyStatus(next)
        if (!shouldKeepPolling(next)) return
      } catch (err) {
        if (cancelled) return
        if (err instanceof AdPackApiError && err.code === 'NOT_FOUND') {
          setPollError(err.message)
          return
        }
        errors += 1
        setPollError(t.reconnecting)
      }
      timer = setTimeout(() => void tick(), nextPollDelay(errors))
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [api, packId, pollNonce, applyStatus, t.reconnecting])

  const updateItem = useCallback((item: AdPackItemView, restartPolling: boolean) => {
    setStatus((prev) => {
      if (!prev) return prev
      const next = mergeItem(prev, item)
      onStatusRef.current?.(next)
      return next
    })
    if (restartPolling) setPollNonce((n) => n + 1)
  }, [])

  const items = status?.items ?? []
  const packRatios = status?.ratios?.length ? status.ratios : ratios
  const doneItems = items.filter((i) => i.status === 'done')
  const total = status?.progress.total ?? 0
  const pct = total ? Math.round(((status?.progress.done ?? 0) / total) * 100) : 0
  const running = status ? !isTerminalPackStatus(status.status) : true

  async function cancelPack() {
    setCancelling(true)
    setPackError(null)
    try {
      await api.cancel({ packId })
      setCancelAsk(false)
      setPollNonce((n) => n + 1)
    } catch (err) {
      setPackError(errorMessage(err, t))
    } finally {
      setCancelling(false)
    }
  }

  async function downloadAll() {
    const files = doneItems.flatMap((item) => item.renders.map((r) => ({ item, render: r })))
    if (!files.length) return
    setPackError(null)
    try {
      for (let i = 0; i < files.length; i += 1) {
        setDownloadProgress({ n: i + 1, total: files.length })
        const { item, render } = files[i]
        await downloadShellImage(render.imageUrl, adFilename(brandName, item, render.ratio))
        await sleep(350)
      }
    } catch (err) {
      setPackError(errorMessage(err, t))
    } finally {
      setDownloadProgress(null)
    }
  }

  async function copyCaptions() {
    const ok = await copyToClipboard(captionsText(items, language))
    onAnnounce(ok ? t.copied : t.copyFailed)
  }

  return (
    <section className="chat-shell__adpack-results" aria-labelledby="adpack-results-heading">
      <div className="chat-shell__adpack-packbar">
        <div className="chat-shell__adpack-packbar-top">
          <h3 id="adpack-results-heading" className="chat-shell__adpack-h">
            {t.resultsHeading}
            {status ? <span className={`chat-shell__adpack-pill is-${status.status}`}>{packStatusLabel(status.status, language)}</span> : null}
          </h3>
          <p className="chat-shell__adpack-progress-text" aria-live="polite">
            {status ? progressLine(status.progress, language) : t.starting}
            {pollError ? <span className="chat-shell__adpack-warn"> · {pollError}</span> : null}
          </p>
        </div>
        <div
          className="chat-shell__adpack-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total || 1}
          aria-valuenow={status?.progress.done ?? 0}
          aria-label={status ? progressLine(status.progress, language) : t.starting}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="chat-shell__adpack-packbar-actions">
          {running && !cancelAsk ? (
            <button type="button" className="chat-shell__adpack-btn" onClick={() => setCancelAsk(true)}>
              {t.cancelPack}
            </button>
          ) : null}
          {cancelAsk ? (
            <span className="chat-shell__adpack-inline-confirm" role="group" aria-label={t.cancelPack}>
              <span>{t.cancelConfirm}</span>
              <button type="button" className="chat-shell__adpack-btn is-danger" disabled={cancelling} onClick={() => void cancelPack()}>
                {cancelling ? t.cancelling : t.cancelPack}
              </button>
              <button type="button" className="chat-shell__adpack-btn" disabled={cancelling} onClick={() => setCancelAsk(false)}>
                {t.cancel}
              </button>
            </span>
          ) : null}
          <button
            type="button"
            className="chat-shell__adpack-btn"
            disabled={!doneItems.length || Boolean(downloadProgress)}
            onClick={() => void downloadAll()}
          >
            {downloadProgress ? t.downloading(downloadProgress.n, downloadProgress.total) : t.downloadAll}
          </button>
          <button
            type="button"
            className="chat-shell__adpack-btn"
            disabled={!items.some((i) => i.copy?.caption)}
            onClick={() => void copyCaptions()}
          >
            {t.copyCaptions}
          </button>
        </div>
        {running ? <p className="chat-shell__adpack-hint">{t.keepsRunning}</p> : null}
        {packError ? <p className="chat-shell__adpack-error" role="alert">{packError}</p> : null}
      </div>

      <ul className="chat-shell__adpack-grid" aria-busy={running}>
        {(status ? items : Array.from({ length: 6 }, () => null)).map((item, idx) =>
          item ? (
            <AdCard
              key={item.id}
              api={api}
              packId={packId}
              item={item}
              ratios={packRatios}
              language={language}
              labels={t}
              brandName={brandName}
              perAd={perAd}
              cancelled={status?.status === 'cancelled'}
              onUpdate={updateItem}
              onOpenImage={onOpenImage}
              onAnnounce={onAnnounce}
            />
          ) : (
            <li key={`sk-${idx}`} className="chat-shell__adpack-card is-skeleton" aria-hidden="true">
              <div className="chat-shell__adpack-media" style={{ aspectRatio: ratioCss(ratios[0] ?? '1:1') }} />
            </li>
          )
        )}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// One ad card
// ---------------------------------------------------------------------------

interface AdCardProps {
  api: AdPackClient
  packId: string
  item: AdPackItemView
  ratios: AspectRatio[]
  language: ChatShellLanguage
  labels: AdPackStudioLabels
  brandName: string
  perAd: number
  cancelled: boolean
  onUpdate: (item: AdPackItemView, restartPolling: boolean) => void
  onOpenImage: (image: { url: string; alt: string }) => void
  onAnnounce: (message: string) => void
}

function AdCard({ api, packId, item, ratios, language, labels: t, brandName, perAd, cancelled, onUpdate, onOpenImage, onAnnounce }: AdCardProps) {
  const [ratio, setRatio] = useState<AspectRatio>(ratios[0] ?? '1:1')
  const [mode, setMode] = useState<'view' | 'edit' | 'regen'>('view')
  const [draft, setDraft] = useState<CopyDraft>(() => copyDraftFromItem(item))
  const [regenMode, setRegenMode] = useState<'scene' | 'copy'>('scene')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const n = item.index + 1
  const render = item.renders.find((r) => r.ratio === ratio) ?? item.renders[0]
  const isDone = item.status === 'done' && Boolean(render)
  const isFailed = item.status === 'failed'
  const working = !isDone && !isFailed
  const tabsId = `adpack-${item.id}-tabs`

  useEffect(() => {
    if (!ratios.includes(ratio) && ratios[0]) setRatio(ratios[0])
  }, [ratios, ratio])

  function startEdit() {
    setDraft(copyDraftFromItem(item))
    setIssues([])
    setError(null)
    setMode('edit')
  }

  async function saveEdit() {
    const patch = copyPatchFromDraft(item, draft)
    if (!patch) {
      setError(t.noChanges)
      return
    }
    setBusy(true)
    setError(null)
    setIssues([])
    try {
      const res = await api.editText({ packId, itemId: item.id, copy: patch })
      onUpdate(res.item, false)
      setMode('view')
    } catch (err) {
      if (err instanceof AdPackApiError && err.code === 'COPY_REJECTED') {
        setError(t.rejected)
        setIssues((err.body.issues ?? []).map((issue) => describeCopyIssue(issue, language)))
      } else {
        setError(errorMessage(err, t))
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirmRegenerate() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.regenerate({ packId, itemId: item.id, mode: regenMode })
      onUpdate(res.item, true)
      setMode('view')
    } catch (err) {
      setError(errorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    if (!render) return
    try {
      await downloadShellImage(render.imageUrl, adFilename(brandName, item, render.ratio))
    } catch (err) {
      setError(errorMessage(err, t))
    }
  }

  async function copyCaption() {
    const ok = item.copy?.caption ? await copyToClipboard(item.copy.caption) : false
    onAnnounce(ok ? t.copied : t.copyFailed)
  }

  const alt = `${t.adLabel(n)} — ${item.copy?.headline ?? item.message}`

  return (
    <li className={`chat-shell__adpack-card is-${item.status}`} aria-label={t.adLabel(n)}>
      <div className="chat-shell__adpack-card-head">
        <span className="chat-shell__adpack-chip" title={formatLabel(item.format, language)}>
          <span aria-hidden="true">{formatGlyph(item.format)}</span> {formatLabel(item.format, language)}
        </span>
        <span className="chat-shell__adpack-chip is-muted">{hookLabel(item.hookType, language)}</span>
        <span className="chat-shell__adpack-num">#{n}</span>
      </div>

      {ratios.length > 1 ? (
        <div className="chat-shell__adpack-tabs" role="tablist" aria-label={`${t.ratioTabs} ${n}`} id={tabsId}>
          {ratios.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === ratio}
              tabIndex={r === ratio ? 0 : -1}
              className={`chat-shell__adpack-tab${r === ratio ? ' is-on' : ''}`}
              onClick={() => setRatio(r)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                event.preventDefault()
                const i = ratios.indexOf(ratio)
                const next = ratios[(i + (event.key === 'ArrowRight' ? 1 : ratios.length - 1)) % ratios.length]
                setRatio(next)
                const el = document.getElementById(tabsId)?.querySelector<HTMLButtonElement>(`[data-ratio="${next}"]`)
                el?.focus()
              }}
              data-ratio={r}
            >
              {r}
            </button>
          ))}
        </div>
      ) : null}

      <div className="chat-shell__adpack-media" style={{ aspectRatio: ratioCss(ratio) }}>
        {isDone && render ? (
          <button type="button" className="chat-shell__adpack-media-btn" aria-label={t.openAd(n)} onClick={() => onOpenImage({ url: render.imageUrl, alt })}>
            <img src={render.imageUrl} alt={alt} loading="lazy" decoding="async" />
          </button>
        ) : (
          <div className={`chat-shell__adpack-preview${item.sceneUrl ? ' has-scene' : ''}${working && !cancelled ? ' is-working' : ''}`}>
            {item.sceneUrl ? <img src={item.sceneUrl} alt="" aria-hidden="true" /> : null}
            {item.copy ? (
              <div className="chat-shell__adpack-copy-preview">
                <strong>{item.copy.headline}</strong>
                {item.copy.subline ? <span>{item.copy.subline}</span> : null}
                {item.copy.cta ? <em>{item.copy.cta}</em> : null}
              </div>
            ) : (
              <div className="chat-shell__adpack-skeleton-lines" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
            <span className={`chat-shell__adpack-stage${isFailed ? ' is-failed' : ''}`}>
              {cancelled && working ? packStatusLabel('cancelled', language) : itemStageLabel(item, language)}
            </span>
          </div>
        )}
      </div>

      <p className="chat-shell__adpack-message">{item.message}</p>
      {isFailed && item.error ? <p className="chat-shell__adpack-error">{item.error}</p> : null}

      {mode === 'edit' ? (
        <form
          className="chat-shell__adpack-edit"
          onSubmit={(event) => {
            event.preventDefault()
            void saveEdit()
          }}
        >
          <label>
            {t.headline}
            <input className="chat-shell__modal-input" value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
          </label>
          <label>
            {t.subline}
            <input className="chat-shell__modal-input" value={draft.subline} onChange={(e) => setDraft({ ...draft, subline: e.target.value })} />
          </label>
          <label>
            {t.cta}
            <input className="chat-shell__modal-input" value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} />
          </label>
          <label>
            {t.bullets}
            <textarea className="chat-shell__modal-input" rows={3} value={draft.bullets} onChange={(e) => setDraft({ ...draft, bullets: e.target.value })} />
          </label>
          {error ? (
            <div className="chat-shell__adpack-error" role="alert">
              <p>{error}</p>
              {issues.length ? (
                <ul>
                  {issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="chat-shell__adpack-row">
            <button type="submit" className="chat-shell__adpack-btn is-primary" disabled={busy}>
              {busy ? t.saving : t.save}
            </button>
            <button type="button" className="chat-shell__adpack-btn" disabled={busy} onClick={() => setMode('view')}>
              {t.cancel}
            </button>
          </div>
        </form>
      ) : null}

      {mode === 'regen' ? (
        <div className="chat-shell__adpack-regen" role="group" aria-label={t.regenerate}>
          <label className="chat-shell__adpack-radio">
            <input type="radio" name={`regen-${item.id}`} checked={regenMode === 'scene'} disabled={!item.copy} onChange={() => setRegenMode('scene')} />
            {t.regenScene}
          </label>
          <label className="chat-shell__adpack-radio">
            <input type="radio" name={`regen-${item.id}`} checked={regenMode === 'copy'} onChange={() => setRegenMode('copy')} />
            {t.regenCopy}
          </label>
          <p className="chat-shell__adpack-hint">{t.regenCost(perAd)}</p>
          {error ? <p className="chat-shell__adpack-error" role="alert">{error}</p> : null}
          <div className="chat-shell__adpack-row">
            <button type="button" className="chat-shell__adpack-btn is-primary" disabled={busy} onClick={() => void confirmRegenerate()}>
              {busy ? t.starting : t.regenConfirm}
            </button>
            <button type="button" className="chat-shell__adpack-btn" disabled={busy} onClick={() => setMode('view')}>
              {t.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'view' ? (
        <>
          {error ? <p className="chat-shell__adpack-error" role="alert">{error}</p> : null}
          <div className="chat-shell__adpack-card-actions">
            {isDone ? (
              <>
                <button type="button" className="chat-shell__adpack-btn" onClick={startEdit}>{t.editText}</button>
                <button type="button" className="chat-shell__adpack-btn" onClick={() => void download()}>{t.download}</button>
                <button type="button" className="chat-shell__adpack-btn" onClick={() => void copyCaption()} disabled={!item.copy?.caption}>{t.copyCaption}</button>
              </>
            ) : null}
            {(isDone || isFailed) && !cancelled ? (
              <button
                type="button"
                className="chat-shell__adpack-btn"
                onClick={() => {
                  setRegenMode(item.copy ? 'scene' : 'copy')
                  setError(null)
                  setMode('regen')
                }}
              >
                {t.regenerate}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </li>
  )
}
