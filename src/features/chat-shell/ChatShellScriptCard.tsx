import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Check, BookmarkPlus, Loader2, Pencil, X, Send, Wand2, Anchor, Sparkles, MoreHorizontal } from 'lucide-react'
import type { ParsedScript } from '../../utils/scriptParser'
import type { ProductType } from '../../types'
import { getScriptsByMessage, getScriptVersions, recordAiSignal } from '../../services/database'
import { parseScriptSections } from './parseScriptSections'
import { IMAGE_DENSITY_CHOICES } from './chatShellImageIntent'
import ChatShellReferencePicker from './ChatShellReferencePicker'
import {
  confirmedReferenceImageIds,
  postOptimizeDensityFromLabel,
  postOptimizeVersionLabel,
  shouldPersistPostOptimizeVersion,
  toggleReferenceSelection,
  withPreselectedReferences,
  type OfferReferenceImage,
} from './chatShellReferenceSelection'

const EMPTY_REFERENCE_IMAGES: OfferReferenceImage[] = []
const EMPTY_REFERENCE_URLS: string[] = []

type ScriptOpSource = 'manual' | 'enhance' | 'hook' | 'consciousness'
type EditSource = ScriptOpSource | 'post_optimize' | null

interface EditHistoryEntry {
  content: string
  source: EditSource
  label: string
  version?: number
}

function asEditSource(value: unknown): EditSource {
  if (
    value === 'enhance'
    || value === 'hook'
    || value === 'consciousness'
    || value === 'manual'
    || value === 'post_optimize'
  ) return value
  return 'manual'
}

function sourceLabel(source: EditSource, language: 'en' | 'es'): string {
  const es = language === 'es'
  switch (source) {
    case 'enhance':
      return es ? 'Mejora' : 'Enhance'
    case 'hook':
      return es ? 'Hook' : 'Hook'
    case 'consciousness':
      return es ? 'Conciencia' : 'Awareness'
    case 'manual':
      return es ? 'Edición' : 'Edit'
    case 'post_optimize':
      return es ? 'Post' : 'Post'
    case null:
      return es ? 'Original' : 'Original'
    default: {
      const _never: never = source
      return _never
    }
  }
}

interface ChatShellScriptCardProps {
  script: ParsedScript
  language?: 'en' | 'es'
  productName?: string | null
  productType?: ProductType
  productId?: string
  messageId?: string
  scriptIndex?: number
  savedScriptId?: string | null
  readOnly?: boolean
  savingScript?: boolean
  offerImageId?: string
  offerImageUrl?: string
  referenceImageUrls?: string[]
  referenceImages?: OfferReferenceImage[]
  imageBusy?: boolean
  onSave?: (content: string, title: string, opts?: { edit_source?: string; message_id?: string; script_index?: number }) => Promise<string | null>
  onEdit?: (originalContent: string, instruction: string, editType?: 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness') => Promise<string>
  onSaveVersion?: (parentId: string, content: string, editSource: string, editLabel?: string) => Promise<string | null>
  onEditOfferImage?: (instruction: string) => Promise<void>
  onPreparePost?: (scriptText: string, density?: 'hard' | 'medium') => Promise<string>
  onGenerateImage?: (scriptText: string, options?: {
    density?: 'hard' | 'medium'
    referenceImageIds?: string[]
    alreadyOptimized?: boolean
  }) => void | Promise<void>
  onUploadPostReference?: (file: File, kind: 'product' | 'context' | 'scene' | 'style' | 'logo') => void | Promise<void>
  onOpenPostPreview?: () => void
  onLatestVersionChange?: (snapshotKey: string, content: string) => void
  snapshotKey?: string
  openPostPreviewNonce?: number
}

const ENHANCE_PROMPT =
  'Mejora claridad, buyer qualification, hechos concretos y CTA. Conserva el formato del guión. Devuelve UN solo guión completo.'

const HOOK_OPTIONS = [
  { label: 'Definición directa', prompt: 'Cambia el gancho a definición directa del producto/servicio. Mantén desarrollo y CTA. Devuelve UN solo guión.' },
  { label: 'Dolor tangible', prompt: 'Cambia el gancho a un dolor tangible y específico del comprador ideal. Mantén desarrollo y CTA. Devuelve UN solo guión.' },
  { label: 'Oferta directa', prompt: 'Cambia el gancho a oferta directa (qué es + beneficio). Mantén desarrollo y CTA. Devuelve UN solo guión.' },
]

const CONSCIOUSNESS_OPTIONS = [
  { label: 'Frío', prompt: 'Ajusta el guión a conciencia FRÍA (revela el problema). Conserva formato. Devuelve UN solo guión.' },
  { label: 'Tibio', prompt: 'Ajusta el guión a conciencia TIBIA (ya conoce el problema). Conserva formato. Devuelve UN solo guión.' },
  { label: 'Caliente', prompt: 'Ajusta el guión a conciencia CALIENTE (listo para comprar). Conserva formato. Devuelve UN solo guión.' },
]

function operationCopy(
  op: { kind: ScriptOpSource; label?: string },
  language: 'en' | 'es',
  instruction?: string
): string {
  const es = language === 'es'
  switch (op.kind) {
    case 'manual': {
      const snippet = instruction?.trim()
      if (snippet) return es ? `Editando el guión: ${snippet.slice(0, 80)}` : `Editing the script: ${snippet.slice(0, 80)}`
      return es ? 'Editando el guión…' : 'Editing the script…'
    }
    case 'enhance':
      return es ? 'Mejorando el guión…' : 'Improving the script…'
    case 'hook':
      return es ? `Cambiando el gancho${op.label ? `: ${op.label}` : '…'}` : `Changing the hook${op.label ? `: ${op.label}` : '…'}`
    case 'consciousness':
      return es ? `Ajustando conciencia${op.label ? `: ${op.label}` : '…'}` : `Adjusting awareness${op.label ? `: ${op.label}` : '…'}`
    default: {
      const _never: never = op.kind
      return _never
    }
  }
}

function renderScriptSections(text: string) {
  const sections = parseScriptSections(text)
  return sections.map((section, i) => (
    <section
      key={`${section.kind}-${i}`}
      className={`chat-shell__script-section${section.label ? '' : ' is-unmarked'}`}
    >
      {section.label ? (
        <h4 className="chat-shell__script-section-label">{section.label}</h4>
      ) : null}
      {section.body ? (
        <p className="chat-shell__script-section-body">{section.body}</p>
      ) : null}
    </section>
  ))
}

export default function ChatShellScriptCard({
  script,
  language = 'es',
  productName,
  productId,
  messageId,
  scriptIndex,
  savedScriptId = null,
  readOnly = false,
  savingScript,
  offerImageId,
  offerImageUrl,
  referenceImageUrls = EMPTY_REFERENCE_URLS,
  referenceImages = EMPTY_REFERENCE_IMAGES,
  imageBusy,
  onSave,
  onEdit,
  onSaveVersion,
  onEditOfferImage,
  onPreparePost,
  onGenerateImage,
  onUploadPostReference,
  onOpenPostPreview,
  onLatestVersionChange,
  snapshotKey,
  openPostPreviewNonce = 0,
}: ChatShellScriptCardProps) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedOriginal, setSavedOriginal] = useState(Boolean(savedScriptId))
  const [savedScriptIdState, setSavedScriptId] = useState<string | null>(savedScriptId)
  const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([])
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [showImageEdit, setShowImageEdit] = useState(false)
  const [imageEditInstruction, setImageEditInstruction] = useState('')
  const [editInstruction, setEditInstruction] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [activeAction, setActiveAction] = useState<'edit' | null>(null)
  const [operation, setOperation] = useState<{ kind: ScriptOpSource; label?: string } | null>(null)
  const [postPreviewOpen, setPostPreviewOpen] = useState(false)
  const [postDrafts, setPostDrafts] = useState<Partial<Record<'hard' | 'medium', string>>>({})
  const [postDensity, setPostDensity] = useState<'hard' | 'medium'>('hard')
  const [preparingPost, setPreparingPost] = useState(false)
  const [savingPost, setSavingPost] = useState(false)
  const [previewRefs, setPreviewRefs] = useState<OfferReferenceImage[]>([])
  const [versionsReady, setVersionsReady] = useState(!messageId && !savedScriptId)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const initLoadedRef = useRef(false)
  const prepareSeqRef = useRef(0)

  useEffect(() => {
    if (initLoadedRef.current) return
    initLoadedRef.current = true
    void (async () => {
      try {
        let parentId = savedScriptId || savedScriptIdState
        if (!parentId && messageId) {
          const saved = await getScriptsByMessage(messageId)
          const match = saved.find((s) => s.script_index === (scriptIndex ?? 0))
          if (!match) return
          parentId = match.id
          setSavedScriptId(match.id)
          setSavedOriginal(true)
        }
        if (!parentId) return
        const rows = await getScriptVersions(parentId)
        if (!rows.length) return
        const sorted = [...rows].sort((a, b) => a.version - b.version)
        setEditHistory(sorted.map((row) => ({
          content: row.content,
          source: asEditSource(row.edit_source),
          label: row.edit_label || '',
          version: row.version,
        })))
      } catch (err) {
        console.error(err)
      } finally {
        setVersionsReady(true)
      }
    })()
  }, [messageId, scriptIndex, savedScriptId])

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  const versions: EditHistoryEntry[] = [
    { content: script.content, source: null, label: '', version: 1 },
    ...editHistory,
  ]
  const latestIndex = Math.max(0, versions.length - 1)
  const activeIndex = viewIndex == null || viewIndex > latestIndex ? latestIndex : viewIndex
  const displayContent = versions[activeIndex]?.content || script.content
  const latestContent = versions[latestIndex]?.content || script.content

  useEffect(() => {
    if (!snapshotKey || !latestContent.trim()) return
    onLatestVersionChange?.(snapshotKey, latestContent)
  }, [snapshotKey, latestContent, onLatestVersionChange])

  const catalogFromProps = useMemo<OfferReferenceImage[]>(() => {
    if (referenceImages.length) return referenceImages
    return referenceImageUrls.map((url, index) => ({
      id: `url-${index}`,
      url,
      kind: 'product' as const,
      dbKind: 'product' as const,
      productId: productId || '',
      selected: index < 4,
    }))
  }, [referenceImages, referenceImageUrls, productId])

  useEffect(() => {
    if (!postPreviewOpen) return
    setPreviewRefs((prev) => {
      if (!catalogFromProps.length) return []
      if (!prev.length) return withPreselectedReferences(catalogFromProps, productId || '')
      const selected = new Set(prev.filter((img) => img.selected === true).map((img) => img.id))
      for (const img of catalogFromProps) {
        if (!prev.some((item) => item.id === img.id)) selected.add(img.id)
      }
      return catalogFromProps.map((img) => ({ ...img, selected: selected.has(img.id) }))
    })
  }, [postPreviewOpen, catalogFromProps, productId])

  const sectionNodes = useMemo(
    () => renderScriptSections(displayContent),
    [displayContent]
  )

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const ensureOriginalSaved = async (): Promise<string | null> => {
    if (savedScriptIdState) return savedScriptIdState
    if (!onSave) return null
    const id = await onSave(script.content, script.title, {
      edit_source: 'original',
      message_id: messageId,
      script_index: scriptIndex,
    })
    if (id) {
      setSavedScriptId(id)
      setSavedOriginal(true)
    }
    return id
  }

  const handleSave = async () => {
    if (!onSave || saving || savedOriginal) return
    setSaving(true)
    try {
      const id = await onSave(script.content, script.title, {
        edit_source: 'original',
        message_id: messageId,
        script_index: scriptIndex,
      })
      if (id) {
        setSavedScriptId(id)
        setSavedOriginal(true)
        if (productId) {
          recordAiSignal(productId, 'script_saved', { script: script.content.substring(0, 2000) })
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const pushVersion = async (content: string, source: EditSource, label = '') => {
    setEditHistory((prev) => [...prev, { content, source, label }])
    setViewIndex(null)
    const parentId = await ensureOriginalSaved()
    if (parentId && onSaveVersion && source) {
      await onSaveVersion(parentId, content, source, label || undefined)
    }
  }

  const runEdit = async () => {
    if (!onEdit || !editInstruction.trim() || operation) return
    setOperation({ kind: 'manual' })
    setEditError(null)
    try {
      const result = await onEdit(displayContent, editInstruction.trim(), 'script_edit')
      await pushVersion(result, 'manual')
      setShowEdit(false)
      setEditInstruction('')
      setActiveAction(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setOperation(null)
    }
  }

  const runEnhance = async () => {
    if (!onEdit || operation) return
    setOperation({ kind: 'enhance' })
    setEditError(null)
    try {
      const result = await onEdit(displayContent, ENHANCE_PROMPT, 'script_enhance')
      await pushVersion(result, 'enhance')
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Enhance failed')
    } finally {
      setOperation(null)
    }
  }

  const runHook = async (opt: { label: string; prompt: string }) => {
    if (!onEdit || operation) return
    setMoreOpen(false)
    setOperation({ kind: 'hook', label: opt.label })
    setEditError(null)
    try {
      const result = await onEdit(displayContent, opt.prompt, 'script_hook')
      await pushVersion(result, 'hook', opt.label)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Hook failed')
    } finally {
      setOperation(null)
    }
  }

  const runConsciousness = async (opt: { label: string; prompt: string }) => {
    if (!onEdit || operation) return
    setMoreOpen(false)
    setOperation({ kind: 'consciousness', label: opt.label })
    setEditError(null)
    try {
      const result = await onEdit(displayContent, opt.prompt, 'script_consciousness')
      await pushVersion(result, 'consciousness', opt.label)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Consciousness failed')
    } finally {
      setOperation(null)
    }
  }

  const loadDensityDraft = async (density: 'hard' | 'medium') => {
    const seq = ++prepareSeqRef.current
    const saved = versions.find((entry) => (
      entry.source === 'post_optimize' && entry.label === postOptimizeVersionLabel(density, language)
    ))?.content
    const sourceText = versions[activeIndex]?.source === 'post_optimize'
      ? (versions[0]?.content || displayContent)
      : displayContent
    setPreparingPost(true)
    setEditError(null)
    try {
      const optimized = saved
        || (onPreparePost ? await onPreparePost(sourceText, density) : sourceText)
      if (seq !== prepareSeqRef.current) return
      setPostDrafts((prev) => ({ ...prev, [density]: optimized }))
    } catch (err) {
      if (seq !== prepareSeqRef.current) return
      setEditError(err instanceof Error ? err.message : 'Could not prepare post')
    } finally {
      if (seq === prepareSeqRef.current) setPreparingPost(false)
    }
  }

  const openPostPreview = async (density: 'hard' | 'medium' = postDensity) => {
    if (!onGenerateImage || operation) return
    onOpenPostPreview?.()
    const active = versions[activeIndex]
    const activeDensity = active?.source === 'post_optimize'
      ? postOptimizeDensityFromLabel(active.label)
      : null
    const startDensity = activeDensity || density
    if (postPreviewOpen) {
      setPostDensity(startDensity)
      if (!postDrafts[startDensity]) await loadDensityDraft(startDensity)
      return
    }
    const seq = ++prepareSeqRef.current
    const saved = versions.find((entry) => (
      entry.source === 'post_optimize' && entry.label === postOptimizeVersionLabel(startDensity, language)
    ))?.content
    const sourceText = active?.source === 'post_optimize'
      ? (versions[0]?.content || displayContent)
      : displayContent
    setPreparingPost(true)
    setEditError(null)
    try {
      const optimized = saved
        || (onPreparePost ? await onPreparePost(sourceText, startDensity) : sourceText)
      if (seq !== prepareSeqRef.current) return
      setPostDensity(startDensity)
      setPostDrafts({ [startDensity]: optimized })
      setPostPreviewOpen(true)
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch (err) {
      if (seq !== prepareSeqRef.current) return
      setEditError(err instanceof Error ? err.message : 'Could not prepare post')
    } finally {
      if (seq === prepareSeqRef.current) setPreparingPost(false)
    }
  }

  useEffect(() => {
    if (!openPostPreviewNonce || !versionsReady) return
    void openPostPreview()
    // Fire only when an image card (or similar) asks this script to open the post draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPostPreviewNonce, versionsReady])

  const applyPostDensity = (density: 'hard' | 'medium') => {
    if (density === postDensity) return
    setPostDensity(density)
    if (!postDrafts[density]) void loadDensityDraft(density)
  }

  const postDraft = postDrafts[postDensity] ?? ''
  const visibleDraft = postDraft || postDrafts.hard || postDrafts.medium || ''

  const persistApprovedPostCopy = async (draft: string, density: 'hard' | 'medium') => {
    const label = postOptimizeVersionLabel(density, language)
    const latest = versions[latestIndex]
    if (!shouldPersistPostOptimizeVersion({ latestContent: latest?.content, draft })) {
      return true
    }
    if (!onSaveVersion) {
      throw new Error(language === 'es'
        ? 'No pude guardar el texto del post. Reintentá.'
        : 'Could not save the post copy. Try again.')
    }
    const parentId = await ensureOriginalSaved()
    if (!parentId) {
      throw new Error(language === 'es'
        ? 'No pude guardar el texto del post. Reintentá.'
        : 'Could not save the post copy. Try again.')
    }
    const versionId = await onSaveVersion(parentId, draft, 'post_optimize', label)
    if (!versionId) {
      throw new Error(language === 'es'
        ? 'No pude guardar el texto del post. Reintentá.'
        : 'Could not save the post copy. Try again.')
    }
    setEditHistory((prev) => [...prev, { content: draft, source: 'post_optimize', label }])
    setViewIndex(null)
    return true
  }

  const continueToPostType = async () => {
    const draft = postDraft.trim()
    if (!draft || imageBusy || savingPost) return
    setSavingPost(true)
    setEditError(null)
    try {
      await persistApprovedPostCopy(draft, postDensity)
      const referenceImageIds = confirmedReferenceImageIds(previewRefs)
        .filter((id) => !id.startsWith('url-'))
      await onGenerateImage?.(draft, {
        density: postDensity,
        referenceImageIds,
        alreadyOptimized: true,
      })
    } catch (err) {
      setEditError(err instanceof Error ? err.message : (language === 'es' ? 'No pude guardar el texto del post.' : 'Could not save the post copy.'))
    } finally {
      setSavingPost(false)
    }
  }

  const busy = Boolean(operation) || saving || Boolean(savingScript) || savingPost
  const locked = readOnly
  const es = language === 'es'
  const previewVersionLabel = (() => {
    const entry = versions[activeIndex]
    if (!entry || entry.source == null) return es ? 'Original' : 'Original'
    const isLatest = activeIndex === latestIndex
    const base = isLatest ? (es ? 'Última' : 'Latest') : `v${entry.version || activeIndex + 1}`
    return `${base} · ${entry.label || sourceLabel(entry.source, language)}`
  })()

  if (postPreviewOpen) {
    return (
      <article
        ref={cardRef}
        className={`chat-shell__artifact chat-shell__artifact--post${savingPost ? ' is-busy' : ''}`}
        aria-busy={preparingPost || savingPost}
      >
        <header className="chat-shell__post-preview-head">
          <div>
            <span className="chat-shell__post-preview-source">
              {es ? 'Guion elegido' : 'Chosen script'} · {script.title || `#${script.index}`} · {previewVersionLabel}
            </span>
            <strong>{es ? 'Optimizar texto' : 'Refine the copy'}</strong>
            <p>
              {es
                ? 'Revisá gancho, desarrollo y CTA. Confirmá las fotos y seguí al tipo de post.'
                : 'Review hook, development, and CTA. Confirm the photos, then choose the post type.'}
            </p>
          </div>
          <button
            type="button"
            className="chat-shell__post-preview-close"
            disabled={imageBusy}
            onClick={() => setPostPreviewOpen(false)}
            aria-label={es ? 'Cerrar' : 'Close'}
          >
            <X size={16} />
          </button>
        </header>
        {savingPost ? (
          <div className="chat-shell__artifact-status" role="status" aria-live="polite">
            <Loader2 size={14} className="chat-shell__spin" />
            {es ? 'Guardando el texto del post…' : 'Saving the post copy…'}
          </div>
        ) : null}
        {editError ? <div className="chat-shell__artifact-error">{editError}</div> : null}
        <div className="chat-shell__post-preview-editor">
          <textarea
            value={visibleDraft}
            onChange={(event) => {
              const value = event.target.value
              setPostDrafts((prev) => ({ ...prev, [postDensity]: value }))
            }}
            rows={5}
            disabled={imageBusy || savingPost || (preparingPost && !postDraft)}
            aria-label={es ? 'Vista previa editable del post' : 'Editable post preview'}
          />
          {preparingPost && !postDraft ? (
            <div className="chat-shell__post-preview-editor-busy" role="status" aria-live="polite">
              <Loader2 size={14} className="chat-shell__spin" />
              <span>{es ? 'Ajustando el texto…' : 'Adjusting the copy…'}</span>
            </div>
          ) : null}
        </div>
        <div className="chat-shell__post-preview-toolbar">
          <div className="chat-shell__post-preview-density" role="radiogroup" aria-label={es ? 'Cantidad de texto' : 'How much text'}>
            {IMAGE_DENSITY_CHOICES.map((choice) => {
              const selected = postDensity === choice.id
              return (
                <button
                  key={choice.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? 'is-on' : ''}
                  disabled={imageBusy || (choice.id !== 'hard' && choice.id !== 'medium')}
                  onClick={() => {
                    if (choice.id === 'hard' || choice.id === 'medium') applyPostDensity(choice.id)
                  }}
                >
                  {es ? choice.labelEs : choice.labelEn}
                </button>
              )
            })}
          </div>
          {previewRefs.length > 0 || onUploadPostReference ? (
            <div className="chat-shell__post-preview-refs">
              <ChatShellReferencePicker
                images={previewRefs}
                currentProductId={productId}
                language={language}
                busy={Boolean(imageBusy || savingPost)}
                compact
                onToggle={(id) => setPreviewRefs((prev) => toggleReferenceSelection(prev, id))}
                onUpload={onUploadPostReference}
              />
            </div>
          ) : null}
          <button
            type="button"
            className="chat-shell__post-preview-continue"
            disabled={!postDraft.trim() || imageBusy || savingPost}
            onClick={() => void continueToPostType()}
          >
            {savingPost ? <Loader2 size={15} className="chat-shell__spin" /> : null}
            {es ? 'Continuar al tipo de post' : 'Continue to post type'}
          </button>
        </div>
      </article>
    )
  }

  return (
    <article ref={cardRef} className={`chat-shell__artifact${operation ? ' is-busy' : ''}`} aria-busy={Boolean(operation || preparingPost)}>
      <header className="chat-shell__artifact-head">
        <div className="chat-shell__artifact-title-row">
          <strong className="chat-shell__artifact-title">{script.title || 'Script'}</strong>
          {productName ? (
            <span className="chat-shell__artifact-offer">{productName}</span>
          ) : null}
        </div>
        <span className="chat-shell__artifact-index">#{script.index}</span>
      </header>

      {showEdit && (
        <div className="chat-shell__artifact-edit">
          <textarea
            ref={editRef}
            value={editInstruction}
            onChange={(e) => setEditInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void runEdit()
              }
            }}
            placeholder={es ? 'Describe el cambio…' : 'Describe the change…'}
            rows={2}
            disabled={Boolean(operation)}
            aria-label={es ? 'Instrucción de edición' : 'Edit instruction'}
          />
          <div className="chat-shell__artifact-edit-actions">
            <button type="button" className="chat-shell__artifact-action is-primary" onClick={() => void runEdit()} disabled={!editInstruction.trim() || Boolean(operation)} aria-label={es ? 'Aplicar edición' : 'Apply edit'}>
              {operation?.kind === 'manual' ? <Loader2 size={14} className="chat-shell__spin" /> : <Send size={14} />}
            </button>
            <button
              type="button"
              className="chat-shell__artifact-action"
              onClick={() => {
                setShowEdit(false)
                setEditInstruction('')
                setEditError(null)
                setActiveAction(null)
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {(operation || preparingPost) && (
        <div className="chat-shell__artifact-status" role="status" aria-live="polite">
          <Loader2 size={14} className="chat-shell__spin" />
          {operation
            ? operationCopy(operation, language, editInstruction)
            : (es ? 'Optimizando el texto para el post…' : 'Optimizing the copy for the post…')}
        </div>
      )}

      {editError && <div className="chat-shell__artifact-error">{editError}</div>}

      {versions.length > 1 ? (
        <div className="chat-shell__script-versions" aria-label={es ? 'Versiones del guion' : 'Script versions'}>
          {versions.map((entry, index) => {
            const isLatest = index === latestIndex
            const isOn = index === activeIndex
            const title = isLatest
              ? (es ? 'Última' : 'Latest')
              : `v${entry.version || index + 1}`
            const hint = entry.label || sourceLabel(entry.source, language)
            return (
              <button
                key={`${entry.version || index}-${entry.source || 'original'}-${index}`}
                type="button"
                className={isOn ? 'is-on' : ''}
                onClick={() => setViewIndex(isLatest ? null : index)}
                title={hint}
                aria-label={`${title}${hint ? ` · ${hint}` : ''}`}
              >
                {title}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className={`chat-shell__artifact-body${operation || preparingPost ? ' is-busy' : ''}`}>
        {sectionNodes}
      </div>

      {showImageEdit && onEditOfferImage ? (
        <div className="chat-shell__artifact-edit">
          <textarea
            value={imageEditInstruction}
            onChange={(e) => setImageEditInstruction(e.target.value)}
            placeholder={es ? '¿Cómo editar la imagen?' : 'How should we edit this image?'}
            rows={2}
            disabled={imageBusy}
          />
          <div className="chat-shell__artifact-edit-actions">
            <button
              type="button"
              className="chat-shell__artifact-action is-primary"
              disabled={!imageEditInstruction.trim() || imageBusy}
              onClick={() => {
                const instruction = imageEditInstruction.trim()
                if (!instruction) return
                void onEditOfferImage(instruction).then(() => {
                  setShowImageEdit(false)
                  setImageEditInstruction('')
                })
              }}
            >
              {imageBusy ? <Loader2 size={14} className="chat-shell__spin" /> : <Send size={14} />}
            </button>
            <button type="button" className="chat-shell__artifact-action" onClick={() => setShowImageEdit(false)}>
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="chat-shell__artifact-actions" ref={menuRef}>
        <button type="button" className="chat-shell__artifact-action" onClick={() => void handleCopy()} title={es ? 'Copiar' : 'Copy'}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? (es ? 'Copiado' : 'Copied') : (es ? 'Copiar' : 'Copy')}
        </button>
        <button
          type="button"
          className="chat-shell__artifact-action"
          onClick={() => void handleSave()}
          disabled={locked || !onSave || savedOriginal || saving}
          title={savedOriginal ? (es ? 'Guardado' : 'Saved') : (es ? 'Guardar' : 'Save')}
        >
          {saving ? <Loader2 size={13} className="chat-shell__spin" /> : <BookmarkPlus size={13} />}
          {savedOriginal ? (es ? 'Guardado' : 'Saved') : (es ? 'Guardar' : 'Save')}
        </button>
        <button
          type="button"
          className={`chat-shell__artifact-action${activeAction === 'edit' || showEdit ? ' is-on' : ''}`}
          onClick={() => {
            setActiveAction('edit')
            setShowEdit(true)
            setMoreOpen(false)
            setTimeout(() => editRef.current?.focus(), 50)
          }}
          disabled={locked || !onEdit || busy}
          title={es ? 'Editar' : 'Edit'}
        >
          <Pencil size={13} />
          {es ? 'Editar' : 'Edit'}
        </button>
        {onGenerateImage ? (
          <button
            type="button"
            className="chat-shell__artifact-action is-primary"
            disabled={busy || imageBusy || preparingPost}
            onClick={() => void openPostPreview()}
            title={es ? 'Crear post' : 'Create post'}
          >
            {imageBusy || preparingPost ? <Loader2 size={13} className="chat-shell__spin" /> : <Wand2 size={13} />}
            {preparingPost ? (es ? 'Optimizando…' : 'Optimizing…') : (es ? 'Crear post' : 'Create post')}
          </button>
        ) : null}
        <div className="chat-shell__artifact-menu-wrap">
          <button
            type="button"
            className={`chat-shell__artifact-action${moreOpen ? ' is-on' : ''}`}
            onClick={() => {
              setMoreOpen((v) => !v)
            }}
            disabled={locked || busy}
            aria-label={es ? 'Más acciones' : 'More actions'}
            title={es ? 'Más' : 'More'}
          >
            <MoreHorizontal size={13} />
          </button>
          {moreOpen && (
            <div className="chat-shell__artifact-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); void runEnhance() }} disabled={!onEdit}>
                <Wand2 size={13} />
                {es ? 'Mejorar' : 'Improve'}
              </button>
              <div className="chat-shell__artifact-menu-label">{es ? 'Hooks' : 'Hooks'}</div>
              {HOOK_OPTIONS.map((opt) => (
                <button key={opt.label} type="button" role="menuitem" onClick={() => { setMoreOpen(false); void runHook(opt) }} disabled={!onEdit}>
                  <Anchor size={13} />
                  {opt.label}
                </button>
              ))}
              <div className="chat-shell__artifact-menu-label">{es ? 'Conciencia' : 'Awareness'}</div>
              {CONSCIOUSNESS_OPTIONS.map((opt) => (
                <button key={opt.label} type="button" role="menuitem" onClick={() => { setMoreOpen(false); void runConsciousness(opt) }} disabled={!onEdit}>
                  <Sparkles size={13} />
                  {opt.label}
                </button>
              ))}
              {onGenerateImage ? (
                <button type="button" role="menuitem" disabled={imageBusy || preparingPost} onClick={() => { setMoreOpen(false); void openPostPreview() }}>
                  <Wand2 size={13} />
                  {es ? 'Optimizar para post' : 'Optimize for post'}
                </button>
              ) : null}
              {offerImageId && offerImageUrl && onEditOfferImage ? (
                <button type="button" role="menuitem" disabled={imageBusy} onClick={() => { setMoreOpen(false); setShowImageEdit(true) }}>
                  <Pencil size={13} />
                  {es ? 'Editar imagen' : 'Edit image'}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
