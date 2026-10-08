import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  AdPackApiError,
  adPackClient,
  type AdPackClient,
  type AdPackQuote,
  type AdPackStatusResponse,
  type AdPackUpload,
  type AdPackUploadKind,
} from './adPackApi'
import type { AdAngle, AspectRatio, BrandDna, FactKey, OfferInput } from '../../../api/lib/adpack/types'
import {
  ADPACK_DEFAULT_SIZE,
  ADPACK_MAX_SIZE,
  ADPACK_MAX_UPLOADS,
  ADPACK_MIN_SIZE,
  ADPACK_RATIOS,
  buildConfirmPayload,
  categoryLabel,
  clampPackSize,
  confirmedFactCount,
  factLabel,
  factRowsFromDna,
  formatGlyph,
  formatLabel,
  gapSummary,
  hookLabel,
  quoteLine,
  readableDnaNote,
  sourceLabel,
  uploadKindLabel,
  type FactRow,
  type GapDraft,
} from './adPackStudioModel'
import { readFileAsDataUrl } from './chatShellComposerAttachments'
import ChatShellAdPackResults from './ChatShellAdPackResults'
import { adPackT, type ChatShellLanguage } from './chatShellLabels'
import './chat-shell-adpack-studio.css'

export interface AdPackStudioPrefill {
  brandName?: string
  offerName?: string
  websiteUrl?: string
  instagramUrl?: string
  logoUrl?: string
  productImageUrls?: string[]
  price?: string
  businessId?: string
  brandKitId?: string
  productId?: string
}

/** Uploads one file to storage and returns its public URL. */
export type AdPackUploadFn = (file: File, kind: AdPackUploadKind) => Promise<string>

export interface ChatShellAdPackStudioProps {
  open: boolean
  language: ChatShellLanguage
  api?: AdPackClient
  prefill?: AdPackStudioPrefill
  uploadFile?: AdPackUploadFn
  creditsRemaining?: number | null
  creditsEnabled?: boolean
  onClose: () => void
  onPackStarted?: (packId: string) => void
  onPackStatus?: (status: AdPackStatusResponse) => void
}

type Step = 1 | 2 | 3

interface UploadEntry {
  id: string
  kind: AdPackUploadKind
  name: string
  previewUrl: string
  url?: string
  state: 'uploading' | 'ready' | 'error'
  objectUrl?: string
}

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 10 * 1024 * 1024
const ENGINE_IMAGE_URL = /^(https:\/\/|data:image\/(png|jpe?g|webp);base64,)/i

let seq = 0
const nextId = () => `u${Date.now().toString(36)}${(seq += 1)}`

/** Fallback when no storage uploader is wired (DEV harness / tests): inline data URL. */
const dataUrlUpload: AdPackUploadFn = (file) => readFileAsDataUrl(file)

function prefillUploads(prefill?: AdPackStudioPrefill): UploadEntry[] {
  const out: UploadEntry[] = []
  for (const url of prefill?.productImageUrls ?? []) {
    if (!ENGINE_IMAGE_URL.test(url)) continue
    out.push({ id: nextId(), kind: 'product_photo', name: url.split('/').pop()?.split('?')[0] || 'producto', previewUrl: url, url, state: 'ready' })
  }
  if (prefill?.logoUrl && ENGINE_IMAGE_URL.test(prefill.logoUrl)) {
    out.push({ id: nextId(), kind: 'logo', name: 'logo', previewUrl: prefill.logoUrl, url: prefill.logoUrl, state: 'ready' })
  }
  return out.slice(0, ADPACK_MAX_UPLOADS)
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.closest('[hidden], [inert]'))
}

export default function ChatShellAdPackStudio({
  open,
  language,
  api = adPackClient,
  prefill,
  uploadFile = dataUrlUpload,
  creditsRemaining,
  creditsEnabled = false,
  onClose,
  onPackStarted,
  onPackStatus,
}: ChatShellAdPackStudioProps) {
  const t = adPackT(language)
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const dnaRef = useRef<HTMLElement>(null)

  const [step, setStep] = useState<Step>(1)
  // Step 1
  const [websiteUrl, setWebsiteUrl] = useState(prefill?.websiteUrl ?? '')
  const [instagramUrl, setInstagramUrl] = useState(prefill?.instagramUrl ?? '')
  const [offerName, setOfferName] = useState(prefill?.offerName ?? '')
  const [uploads, setUploads] = useState<UploadEntry[]>(() => prefillUploads(prefill))
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dna, setDna] = useState<BrandDna | null>(null)
  const [rows, setRows] = useState<FactRow[]>([])
  const [gapDrafts, setGapDrafts] = useState<GapDraft[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeTick, setAnalyzeTick] = useState(0)
  const [confirming, setConfirming] = useState(false)
  // Step 2
  const [confirmedDna, setConfirmedDna] = useState<BrandDna | null>(null)
  const [size, setSize] = useState(ADPACK_DEFAULT_SIZE)
  const [angles, setAngles] = useState<AdAngle[]>([])
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [ratios, setRatios] = useState<AspectRatio[]>([...ADPACK_RATIOS])
  const [quoteState, setQuote] = useState<AdPackQuote | null>(null)
  const [planning, setPlanning] = useState(false)
  const [starting, setStarting] = useState(false)
  // Step 3
  const [packId, setPackId] = useState<string | null>(null)
  const [packRatios, setPackRatios] = useState<AspectRatio[]>([...ADPACK_RATIOS])
  const [perAd, setPerAd] = useState(0)
  // Shared
  const [error, setError] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null)

  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads
  useEffect(() => () => {
    for (const u of uploadsRef.current) if (u.objectUrl) URL.revokeObjectURL(u.objectUrl)
  }, [])

  // Prefill arrives async in ChatShell (brand / offer load): fill only untouched fields.
  useEffect(() => {
    if (!prefill) return
    setWebsiteUrl((v) => v || prefill.websiteUrl || '')
    setInstagramUrl((v) => v || prefill.instagramUrl || '')
    setOfferName((v) => v || prefill.offerName || '')
    setUploads((prev) => (prev.length ? prev : prefillUploads(prefill)))
  }, [prefill])

  // Focus: remember opener, focus first field, restore on close.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    const id = window.setTimeout(() => {
      const root = dialogRef.current
      if (!root) return
      const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0]
      first?.focus()
    }, 0)
    return () => {
      window.clearTimeout(id)
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!lightbox) return
    const id = window.setTimeout(() => lightboxRef.current?.querySelector<HTMLElement>('button')?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [lightbox])

  // Rotating analyze messages.
  useEffect(() => {
    if (!analyzing) return
    const id = window.setInterval(() => setAnalyzeTick((n) => n + 1), 1800)
    return () => window.clearInterval(id)
  }, [analyzing])

  // Clear the live-region message shortly after it is read.
  useEffect(() => {
    if (!announce) return
    const id = window.setTimeout(() => setAnnounce(''), 2500)
    return () => window.clearTimeout(id)
  }, [announce])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (lightbox) setLightbox(null)
      else onClose()
      return
    }
    if (event.key !== 'Tab') return
    const root = lightbox ? lightboxRef.current : dialogRef.current
    if (!root) return
    const list = focusables(root)
    if (!list.length) return
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }, [lightbox, onClose])

  // -------------------------------------------------------------------------
  // Step 1 — uploads + ingest + confirm
  // -------------------------------------------------------------------------

  async function addFiles(files: FileList | null, kind: AdPackUploadKind) {
    if (!files?.length) return
    setUploadError(null)
    let list = Array.from(files)
    if (kind === 'logo') list = list.slice(0, 1)
    const room = ADPACK_MAX_UPLOADS - uploads.filter((u) => !(kind === 'logo' && u.kind === 'logo')).length
    if (list.length > room) {
      setUploadError(t.tooManyUploads(ADPACK_MAX_UPLOADS))
      list = list.slice(0, Math.max(0, room))
    }
    const accepted = list.filter((f) => ACCEPT.split(',').includes(f.type) && f.size <= MAX_BYTES)
    if (accepted.length < list.length) setUploadError(t.badFileType)
    if (!accepted.length) return
    const entries: UploadEntry[] = accepted.map((file) => {
      const objectUrl = URL.createObjectURL(file)
      return { id: nextId(), kind, name: file.name, previewUrl: objectUrl, objectUrl, state: 'uploading' }
    })
    setUploads((prev) => {
      const base = kind === 'logo' ? prev.filter((u) => u.kind !== 'logo') : prev
      return [...base, ...entries]
    })
    await Promise.all(entries.map(async (entry, i) => {
      try {
        const url = await uploadFile(accepted[i], kind)
        setUploads((prev) => prev.map((u) => (u.id === entry.id ? { ...u, url, state: 'ready' } : u)))
      } catch {
        setUploads((prev) => prev.map((u) => (u.id === entry.id ? { ...u, state: 'error' } : u)))
      }
    }))
  }

  function removeUpload(id: string) {
    setUploads((prev) => {
      const gone = prev.find((u) => u.id === id)
      if (gone?.objectUrl) URL.revokeObjectURL(gone.objectUrl)
      return prev.filter((u) => u.id !== id)
    })
  }

  function toggleReferenceKind(id: string) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, kind: u.kind === 'reference_ad' ? 'review_screenshot' : 'reference_ad' } : u)))
  }

  const readyUploads = uploads.filter((u) => u.state === 'ready' && u.url)
  const pendingUploads = uploads.some((u) => u.state === 'uploading')
  const productUrls = readyUploads.filter((u) => u.kind === 'product_photo').map((u) => u.url as string)
  const canAnalyze = !analyzing && !pendingUploads && Boolean(websiteUrl.trim() || instagramUrl.trim() || readyUploads.length)

  async function analyze() {
    if (!canAnalyze) {
      if (!pendingUploads) setError(t.needSource)
      return
    }
    setAnalyzing(true)
    setAnalyzeTick(0)
    setError(null)
    try {
      const payloadUploads: AdPackUpload[] = readyUploads.map((u) => ({ kind: u.kind, url: u.url, name: u.name }))
      const res = await api.ingestDna({
        websiteUrl: websiteUrl.trim() || undefined,
        instagramUrl: instagramUrl.trim() || undefined,
        uploads: payloadUploads.length ? payloadUploads : undefined,
        offerForm: {
          name: offerName.trim() || undefined,
          brandName: prefill?.brandName || undefined,
          facts: prefill?.price ? { price: prefill.price } : undefined,
        },
        language,
      })
      setDna(res.dna)
      setRows(factRowsFromDna(res.dna))
      setGapDrafts(res.dna.gaps.map((key) => ({ key, value: '' })))
      // Stacked layout: the DNA card sits below the form — bring it into view.
      if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 820px)').matches) {
        window.setTimeout(() => dnaRef.current?.scrollIntoView?.({ block: 'start' }), 50)
      }
      if (!offerName.trim()) {
        const offerFact = res.dna.facts.find((f) => f.key === 'offer_name')
        if (offerFact) setOfferName(offerFact.value)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnalyzing(false)
    }
  }

  async function continueToAngles() {
    if (!dna) return
    setConfirming(true)
    setError(null)
    try {
      const payload = buildConfirmPayload(dna, rows, gapDrafts)
      const res = await api.confirm(payload)
      setConfirmedDna(res.dna)
      setStep(2)
      void planAngles(res.dna, size)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConfirming(false)
    }
  }

  // -------------------------------------------------------------------------
  // Step 2 — angles + quote + start
  // -------------------------------------------------------------------------

  const productUrlsKey = productUrls.join('|')
  const offer = useMemo((): OfferInput | null => {
    const base = confirmedDna ?? dna
    if (!base) return null
    const name = offerName.trim() || base.facts.find((f) => f.key === 'offer_name')?.value || base.brandName
    const images = (base.productImageUrls?.length ? base.productImageUrls : productUrlsKey.split('|').filter(Boolean)).filter((u) => ENGINE_IMAGE_URL.test(u)).slice(0, 8)
    return { name, facts: [], productImageUrls: images, ...(prefill?.productId ? { productId: prefill.productId } : {}) }
  }, [confirmedDna, dna, offerName, productUrlsKey, prefill?.productId])

  const planSeq = useRef(0)
  async function planAngles(base: BrandDna, nextSize: number) {
    if (!offer && !base) return
    const mySeq = (planSeq.current += 1)
    setPlanning(true)
    setError(null)
    const off: OfferInput = offer ?? { name: base.brandName, facts: [], productImageUrls: [] }
    try {
      const res = await api.angles({ dna: base, offer: off, size: nextSize })
      if (mySeq !== planSeq.current) return
      setAngles(res.angles)
      setEnabled(new Set(res.angles.map((a) => a.id)))
    } catch (err) {
      if (mySeq === planSeq.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mySeq === planSeq.current) setPlanning(false)
    }
  }

  const enabledCount = angles.filter((a) => enabled.has(a.id)).length
  // Never show a quote for a different size while the new one loads.
  const quote = quoteState && quoteState.size === enabledCount ? quoteState : null

  useEffect(() => {
    if (step !== 2 || !enabledCount) {
      setQuote(null)
      return
    }
    let cancelled = false
    api.quote({ size: enabledCount })
      .then((q) => { if (!cancelled) setQuote(q) })
      .catch(() => { if (!cancelled) setQuote(null) })
    return () => { cancelled = true }
  }, [api, step, enabledCount])

  function changeSize(next: number) {
    const clamped = clampPackSize(next)
    setSize(clamped)
    if (confirmedDna) void planAngles(confirmedDna, clamped)
  }

  function toggleRatio(r: AspectRatio) {
    setRatios((prev) => {
      if (prev.includes(r)) return prev.length > 1 ? prev.filter((x) => x !== r) : prev
      return ADPACK_RATIOS.filter((x) => x === r || prev.includes(x))
    })
  }

  async function startPack() {
    if (!confirmedDna || !offer || !enabledCount || !ratios.length) return
    setStarting(true)
    setError(null)
    try {
      const res = await api.start({
        dna: confirmedDna,
        offer,
        size: angles.length,
        angleIds: angles.filter((a) => enabled.has(a.id)).map((a) => a.id),
        ratios,
        businessId: prefill?.businessId,
        brandKitId: prefill?.brandKitId,
      })
      setPackId(res.packId)
      setPackRatios(ratios)
      setPerAd(res.quote.perAd)
      setStep(3)
      onPackStarted?.(res.packId)
    } catch (err) {
      if (err instanceof AdPackApiError && err.code === 'INSUFFICIENT_CREDITS') {
        setError(t.insufficient(err.body.creditsRequired ?? quote?.credits ?? 0, err.body.remaining ?? creditsRemaining ?? undefined))
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setStarting(false)
    }
  }

  function resetAll() {
    setStep(1)
    setPackId(null)
    setAngles([])
    setQuote(null)
    setConfirmedDna(null)
    setError(null)
  }

  if (!open) return null

  const dnaView = dna
  const confirmedN = confirmedFactCount(rows, gapDrafts)
  const creditsNote = creditsEnabled && creditsRemaining != null ? ` · ${t.creditsLeft(creditsRemaining)}` : ''
  const notEnough = creditsEnabled && creditsRemaining != null && quote != null && quote.credits > creditsRemaining

  // Footer actions per step.
  let primary: { label: string; disabled: boolean; onClick: () => void } | null = null
  if (step === 1) {
    primary = { label: confirming ? t.confirming : t.continue, disabled: !dna || analyzing || confirming, onClick: () => void continueToAngles() }
  } else if (step === 2) {
    primary = {
      label: starting ? t.starting : `${t.generate} · ${quoteLine(enabledCount, quote?.credits ?? null, language)}`,
      disabled: starting || planning || !enabledCount || !ratios.length,
      onClick: () => void startPack(),
    }
  }

  return (
    <div className="chat-shell__adpack-root" role="presentation" onKeyDown={onKeyDown}>
      <div className="chat-shell__adpack-backdrop" aria-hidden="true" onClick={() => { if (!lightbox) onClose() }} />
      <div
        ref={dialogRef}
        className="chat-shell__adpack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={lightbox ? true : undefined}
      >
        <header className="chat-shell__adpack-header">
          <div className="chat-shell__adpack-titles">
            <h2 id={titleId} className="chat-shell__adpack-title">{t.title}</h2>
            <p className="chat-shell__adpack-sub">{t.subtitle}</p>
          </div>
          <ol className="chat-shell__adpack-steps" aria-label={t.stepOf(step, 3)}>
            {t.steps.map((label, i) => (
              <li
                key={label}
                className={`chat-shell__adpack-step${step === i + 1 ? ' is-current' : ''}${step > i + 1 ? ' is-done' : ''}`}
                aria-current={step === i + 1 ? 'step' : undefined}
              >
                <span className="chat-shell__adpack-step-n" aria-hidden="true">{i + 1}</span>
                <span className="chat-shell__adpack-step-label">{label}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="chat-shell__adpack-close" aria-label={t.close} onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="chat-shell__adpack-body">
          {step === 1 ? (
            <div className="chat-shell__adpack-brand">
              <section className="chat-shell__adpack-panel" aria-labelledby="adpack-sources-h">
                <h3 id="adpack-sources-h" className="chat-shell__adpack-h">{t.sourcesHeading}</h3>
                <label className="chat-shell__adpack-field">
                  <span>{t.website}</span>
                  <input
                    data-autofocus
                    className="chat-shell__modal-input"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder={t.websitePlaceholder}
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                  />
                </label>
                <label className="chat-shell__adpack-field">
                  <span>{t.instagram}</span>
                  <input
                    className="chat-shell__modal-input"
                    type="url"
                    inputMode="url"
                    placeholder={t.instagramPlaceholder}
                    value={instagramUrl}
                    onChange={(e) => setInstagramUrl(e.target.value)}
                  />
                </label>
                <label className="chat-shell__adpack-field">
                  <span>{t.offerName}</span>
                  <input
                    className="chat-shell__modal-input"
                    placeholder={t.offerNamePlaceholder}
                    value={offerName}
                    onChange={(e) => setOfferName(e.target.value)}
                  />
                </label>

                <UploadZone
                  title={t.productPhotos}
                  hint={t.productPhotosHint}
                  kind="product_photo"
                  multiple
                  entries={uploads.filter((u) => u.kind === 'product_photo')}
                  language={language}
                  labels={t}
                  onAdd={(files) => void addFiles(files, 'product_photo')}
                  onRemove={removeUpload}
                />
                <UploadZone
                  title={t.logo}
                  kind="logo"
                  entries={uploads.filter((u) => u.kind === 'logo')}
                  language={language}
                  labels={t}
                  onAdd={(files) => void addFiles(files, 'logo')}
                  onRemove={removeUpload}
                />
                <UploadZone
                  title={t.references}
                  hint={t.referencesHint}
                  kind="reference_ad"
                  multiple
                  entries={uploads.filter((u) => u.kind === 'reference_ad' || u.kind === 'review_screenshot')}
                  language={language}
                  labels={t}
                  onAdd={(files) => void addFiles(files, 'reference_ad')}
                  onRemove={removeUpload}
                  onToggleKind={toggleReferenceKind}
                />
                {uploadError ? <p className="chat-shell__adpack-error" role="alert">{uploadError}</p> : null}

                <button
                  type="button"
                  className="chat-shell__adpack-btn is-primary is-block"
                  disabled={analyzing || pendingUploads}
                  aria-describedby={!canAnalyze ? 'adpack-analyze-hint' : undefined}
                  onClick={() => void analyze()}
                >
                  {analyzing ? t.analyzing : dna ? t.reanalyze : t.analyze}
                </button>
                {!canAnalyze && !analyzing ? <p id="adpack-analyze-hint" className="chat-shell__adpack-hint">{pendingUploads ? t.uploading : t.needSource}</p> : null}
              </section>

              <section ref={dnaRef} className="chat-shell__adpack-panel chat-shell__adpack-dna" aria-labelledby="adpack-dna-h" aria-busy={analyzing}>
                <h3 id="adpack-dna-h" className="chat-shell__adpack-h">{t.dnaHeading}</h3>
                {analyzing ? (
                  <div className="chat-shell__adpack-dna-loading" role="status">
                    <p>{t.analyzingSteps[analyzeTick % t.analyzingSteps.length]}</p>
                    <div className="chat-shell__adpack-skeleton-lines is-block" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ) : !dnaView ? (
                  <p className="chat-shell__adpack-empty">{t.dnaEmpty}</p>
                ) : (
                  <DnaCard
                    dna={dnaView}
                    rows={rows}
                    gaps={gapDrafts}
                    confirmedN={confirmedN}
                    language={language}
                    labels={t}
                    onRowChange={(id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))}
                    onGapChange={(key, value) => setGapDrafts((prev) => prev.map((g) => (g.key === key ? { ...g, value } : g)))}
                  />
                )}
              </section>
            </div>
          ) : null}

          {step === 2 ? (
            <section className="chat-shell__adpack-angles" aria-labelledby="adpack-angles-h">
              <div className="chat-shell__adpack-angles-top">
                <div>
                  <h3 id="adpack-angles-h" className="chat-shell__adpack-h">{t.anglesHeading}</h3>
                  <p className="chat-shell__adpack-hint">{t.anglesCopy}</p>
                </div>
                <div className="chat-shell__adpack-controls">
                  <div className="chat-shell__adpack-field is-inline">
                    <span id="adpack-size-label">{t.packSize}</span>
                    <div className="chat-shell__qty" role="group" aria-labelledby="adpack-size-label">
                      <button type="button" className="chat-shell__qty-btn" aria-label={t.less} disabled={planning || size <= ADPACK_MIN_SIZE} onClick={() => changeSize(size - 1)}>−</button>
                      <output className="chat-shell__adpack-size" aria-live="polite">{size}</output>
                      <button type="button" className="chat-shell__qty-btn" aria-label={t.more} disabled={planning || size >= ADPACK_MAX_SIZE} onClick={() => changeSize(size + 1)}>+</button>
                    </div>
                  </div>
                  <div className="chat-shell__adpack-field is-inline">
                    <span id="adpack-ratios-label">{t.ratios}</span>
                    <div className="chat-shell__adpack-ratios" role="group" aria-labelledby="adpack-ratios-label">
                      {ADPACK_RATIOS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          aria-pressed={ratios.includes(r)}
                          className={`chat-shell__adpack-ratio${ratios.includes(r) ? ' is-on' : ''}`}
                          onClick={() => toggleRatio(r)}
                        >
                          <span className={`chat-shell__adpack-ratio-box r-${r.replace(':', 'x')}`} aria-hidden="true" />
                          <span>{r}</span>
                          <small>{t.ratioNames[r]}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <p className="chat-shell__adpack-quote" role="status">
                <strong>{quoteLine(enabledCount, quote?.credits ?? null, language)}</strong>
                {creditsNote}
                {angles.length ? <span className="chat-shell__adpack-muted"> · {t.selected(enabledCount, angles.length)}</span> : null}
              </p>
              {!enabledCount && angles.length ? <p className="chat-shell__adpack-hint is-warn">{t.minAngles}</p> : null}
              {notEnough ? <p className="chat-shell__adpack-hint is-warn">{t.insufficient(quote!.credits, creditsRemaining ?? undefined)}</p> : null}

              <ul className={`chat-shell__adpack-angle-grid${planning ? ' is-loading' : ''}`} aria-busy={planning}>
                {planning && !angles.length
                  ? Array.from({ length: size }, (_, i) => <li key={`sk-${i}`} className="chat-shell__adpack-angle is-skeleton" aria-hidden="true" />)
                  : angles.map((angle, i) => {
                    const on = enabled.has(angle.id)
                    return (
                      <li key={angle.id} className={`chat-shell__adpack-angle${on ? ' is-on' : ''}`}>
                        <label>
                          <span className="chat-shell__adpack-angle-head">
                            <span className="chat-shell__adpack-chip">
                              <span aria-hidden="true">{formatGlyph(angle.format)}</span> {formatLabel(angle.format, language)}
                            </span>
                            <span className="chat-shell__adpack-chip is-muted">{hookLabel(angle.hookType, language)}</span>
                            <span className="chat-shell__adpack-switch">
                              <input
                                type="checkbox"
                                role="switch"
                                checked={on}
                                aria-label={t.angleOn(i + 1)}
                                onChange={() => setEnabled((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(angle.id)) next.delete(angle.id)
                                  else next.add(angle.id)
                                  return next
                                })}
                              />
                              <span aria-hidden="true" />
                            </span>
                          </span>
                          <strong className="chat-shell__adpack-angle-msg">{angle.message}</strong>
                          <small>{t.target}: {angle.target}</small>
                        </label>
                      </li>
                    )
                  })}
              </ul>
              {planning && angles.length ? <p className="chat-shell__adpack-hint" role="status">{t.planning}</p> : null}
            </section>
          ) : null}

          {step === 3 && packId ? (
            <ChatShellAdPackResults
              api={api}
              packId={packId}
              language={language}
              labels={t}
              brandName={confirmedDna?.brandName ?? dna?.brandName ?? ''}
              ratios={packRatios}
              perAd={perAd}
              onOpenImage={setLightbox}
              onStatus={onPackStatus}
              onAnnounce={setAnnounce}
            />
          ) : null}
        </div>

        {error ? <p className="chat-shell__adpack-error chat-shell__adpack-footer-error" role="alert">{error}</p> : null}

        <footer className="chat-shell__adpack-footer">
          {step === 2 ? (
            <button type="button" className="chat-shell__adpack-btn" disabled={starting} onClick={() => { setStep(1); setError(null) }}>
              {t.back}
            </button>
          ) : null}
          <span className="chat-shell__adpack-footer-spacer" />
          {step === 1 && dna ? (
            <span className="chat-shell__adpack-muted chat-shell__adpack-footer-meta">{t.confirmedCount(confirmedN, rows.length + gapDrafts.length)}</span>
          ) : null}
          {step === 3 ? (
            <button type="button" className="chat-shell__adpack-btn" onClick={resetAll}>{t.newPack}</button>
          ) : null}
          <button type="button" className="chat-shell__adpack-btn" onClick={onClose}>{t.close}</button>
          {primary ? (
            <button type="button" className="chat-shell__adpack-btn is-primary" disabled={primary.disabled} onClick={primary.onClick}>
              {primary.label}
            </button>
          ) : null}
        </footer>
        <p className="chat-shell__sr-only" aria-live="polite">{announce}</p>
      </div>

      {lightbox ? (
        <div ref={lightboxRef} className="chat-shell__adpack-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.alt}>
          <button type="button" className="chat-shell__adpack-lightbox-close" aria-label={t.closePreview} onClick={() => setLightbox(null)}>
            <span aria-hidden="true">×</span>
          </button>
          <img src={lightbox.url} alt={lightbox.alt} />
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload zone
// ---------------------------------------------------------------------------

interface UploadZoneProps {
  title: string
  hint?: string
  kind: AdPackUploadKind
  multiple?: boolean
  entries: UploadEntry[]
  language: ChatShellLanguage
  labels: ReturnType<typeof adPackT>
  onAdd: (files: FileList | null) => void
  onRemove: (id: string) => void
  onToggleKind?: (id: string) => void
}

function UploadZone({ title, hint, kind, multiple, entries, language, labels: t, onAdd, onRemove, onToggleKind }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={`chat-shell__adpack-upload${dragging ? ' is-drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); onAdd(e.dataTransfer.files) }}
    >
      <div className="chat-shell__adpack-upload-head">
        <span className="chat-shell__adpack-upload-title">{title}</span>
        <button type="button" className="chat-shell__adpack-btn is-small" aria-label={`${t.addFiles}: ${title}`} onClick={() => inputRef.current?.click()}>
          + {t.addFiles}
        </button>
        <input
          ref={inputRef}
          hidden
          tabIndex={-1}
          type="file"
          accept={ACCEPT}
          multiple={multiple}
          aria-label={`${t.addFiles}: ${title}`}
          onChange={(e) => { onAdd(e.target.files); e.target.value = '' }}
          data-kind={kind}
        />
      </div>
      {hint ? <p className="chat-shell__adpack-hint">{hint}</p> : null}
      {entries.length ? (
        <ul className="chat-shell__adpack-thumbs">
          {entries.map((u) => (
            <li key={u.id} className={`chat-shell__adpack-thumb is-${u.state}`}>
              <img src={u.previewUrl} alt={u.name} />
              {u.state === 'uploading' ? <span className="chat-shell__adpack-thumb-state">{t.uploading}</span> : null}
              {u.state === 'error' ? <span className="chat-shell__adpack-thumb-state is-error">{t.uploadFailed}</span> : null}
              {onToggleKind ? (
                <button type="button" className="chat-shell__adpack-thumb-kind" title={t.switchKind} aria-label={`${t.switchKind}: ${uploadKindLabel(u.kind, language)}`} onClick={() => onToggleKind(u.id)}>
                  {uploadKindLabel(u.kind, language)}
                </button>
              ) : null}
              <button type="button" className="chat-shell__adpack-thumb-x" aria-label={t.removeFile(u.name)} onClick={() => onRemove(u.id)}>
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DNA card
// ---------------------------------------------------------------------------

interface DnaCardProps {
  dna: BrandDna
  rows: FactRow[]
  gaps: GapDraft[]
  confirmedN: number
  language: ChatShellLanguage
  labels: ReturnType<typeof adPackT>
  onRowChange: (id: string, patch: Partial<FactRow>) => void
  onGapChange: (key: FactKey, value: string) => void
}

function DnaCard({ dna, rows, gaps, confirmedN, language, labels: t, onRowChange, onGapChange }: DnaCardProps) {
  const notes = (dna.notes ?? []).map((n) => readableDnaNote(n, language))
  const missing = gaps.filter((g) => !g.value.trim()).map((g) => g.key)
  return (
    <div className="chat-shell__adpack-dna-card">
      <div className="chat-shell__adpack-dna-id">
        {dna.visual?.logoUrl ? <img className="chat-shell__adpack-dna-logo" src={dna.visual.logoUrl} alt="" /> : null}
        <div>
          <p className="chat-shell__adpack-dna-name">{dna.brandName}</p>
          {dna.oneLiner ? <p className="chat-shell__adpack-muted">{dna.oneLiner}</p> : null}
        </div>
      </div>
      <dl className="chat-shell__adpack-dl">
        <div>
          <dt>{t.category}</dt>
          <dd>{categoryLabel(dna.category, language)}</dd>
        </div>
        {dna.voice ? (
          <div>
            <dt>{t.voice}</dt>
            <dd>{dna.voice}</dd>
          </div>
        ) : null}
        {dna.audience?.length ? (
          <div>
            <dt>{t.audience}</dt>
            <dd className="chat-shell__adpack-tags">
              {dna.audience.map((a) => <span key={a} className="chat-shell__adpack-chip is-muted">{a}</span>)}
            </dd>
          </div>
        ) : null}
      </dl>

      {dna.sources.length ? (
        <div className="chat-shell__adpack-sources" aria-label={t.sourcesStatus}>
          {dna.sources.map((s, i) => (
            <p key={`${s.kind}-${i}`} className={`chat-shell__adpack-source${s.ok ? '' : ' is-bad'}${s.note ? ' has-note' : ''}`}>
              <span className="chat-shell__adpack-source-dot" aria-hidden="true" />
              <strong>{sourceLabel(s.kind, language)}</strong>
              <span>{s.note ?? (s.ok ? t.sourceOk : t.sourceFailed)}</span>
            </p>
          ))}
        </div>
      ) : null}

      {notes.filter((n) => n.kind === 'conflict').map((n) => (
        <p key={n.text} className="chat-shell__adpack-hint is-warn">{n.text}</p>
      ))}

      <div className="chat-shell__adpack-facts-head">
        <h4 className="chat-shell__adpack-h4">{t.factsHeading}</h4>
        <span className="chat-shell__adpack-muted">{t.confirmedCount(confirmedN, rows.length + gaps.length)}</span>
      </div>
      <p className="chat-shell__adpack-hint">{t.factsExplain}</p>

      {missing.length ? <p className="chat-shell__adpack-gaps" role="status">{gapSummary(missing, language)}</p> : null}

      <ul className="chat-shell__adpack-facts">
        {gaps.map((g) => {
          const id = `adpack-gap-${g.key}`
          const label = factLabel(g.key, language)
          return (
            <li key={`gap-${g.key}`} className={`chat-shell__adpack-fact is-gap${g.value.trim() ? ' is-confirmed' : ''}`}>
              <label htmlFor={id} className="chat-shell__adpack-fact-key">{label}</label>
              <input id={id} className="chat-shell__modal-input" placeholder={t.gapPlaceholder(label)} value={g.value} onChange={(e) => onGapChange(g.key, e.target.value)} />
              <span className="chat-shell__adpack-fact-src">{g.value.trim() ? sourceLabel('user', language) : t.gapsAdd}</span>
            </li>
          )
        })}
        {rows.map((row) => {
          const id = `adpack-fact-${row.id}`
          return (
            <li key={row.id} className={`chat-shell__adpack-fact${row.confirmed ? ' is-confirmed' : ''}`}>
              <label htmlFor={id} className="chat-shell__adpack-fact-key">{factLabel(row.key, language)}</label>
              <input
                id={id}
                className="chat-shell__modal-input"
                value={row.value}
                title={row.evidence}
                onChange={(e) => onRowChange(row.id, { value: e.target.value, confirmed: true })}
              />
              <span className="chat-shell__adpack-fact-src">{sourceLabel(row.source, language)}</span>
              <label className="chat-shell__adpack-confirm">
                <input
                  type="checkbox"
                  checked={row.confirmed}
                  aria-label={`${t.confirm}: ${factLabel(row.key, language)}`}
                  onChange={(e) => onRowChange(row.id, { confirmed: e.target.checked })}
                />
                <span>{t.confirm}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
