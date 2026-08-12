import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Check, BookmarkPlus, Loader2, Pencil, X, Send, Wand2, Anchor, Sparkles } from 'lucide-react'
import type { ParsedScript } from '../../utils/scriptParser'
import type { ProductType } from '../../types'
import { getScriptsByMessage, getScriptVersions, recordAiSignal } from '../../services/database'
import { parseScriptSections } from './parseScriptSections'

type EditSource = 'manual' | 'enhance' | 'hook' | 'consciousness' | null

interface EditHistoryEntry {
  content: string
  source: EditSource
  label: string
}

interface ChatShellScriptCardProps {
  script: ParsedScript
  language?: 'en' | 'es'
  productName?: string | null
  productType?: ProductType
  productId?: string
  messageId?: string
  scriptIndex?: number
  savingScript?: boolean
  onSave?: (content: string, title: string, opts?: { edit_source?: string; message_id?: string; script_index?: number }) => Promise<string | null>
  onEdit?: (originalContent: string, instruction: string, editType?: 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness') => Promise<string>
  onSaveVersion?: (parentId: string, content: string, editSource: string, editLabel?: string) => Promise<string | null>
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
  savingScript,
  onSave,
  onEdit,
  onSaveVersion,
}: ChatShellScriptCardProps) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedOriginal, setSavedOriginal] = useState(false)
  const [savedScriptId, setSavedScriptId] = useState<string | null>(null)
  const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([])
  const [showEdit, setShowEdit] = useState(false)
  const [editInstruction, setEditInstruction] = useState('')
  const [editing, setEditing] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [hookOpen, setHookOpen] = useState(false)
  const [consciousnessOpen, setConsciousnessOpen] = useState(false)
  const [activeAction, setActiveAction] = useState<'edit' | null>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const initLoadedRef = useRef(false)

  useEffect(() => {
    if (initLoadedRef.current || !messageId) return
    initLoadedRef.current = true
    void (async () => {
      try {
        const saved = await getScriptsByMessage(messageId)
        const match = saved.find((s) => s.script_index === (scriptIndex ?? 0))
        if (!match) return
        setSavedScriptId(match.id)
        setSavedOriginal(true)
        const versions = await getScriptVersions(match.id)
        if (versions.length > 0) {
          const sorted = [...versions].sort((a, b) => a.version - b.version)
          setEditHistory(sorted.map((v) => ({
            content: v.content,
            source: (v.edit_source as EditSource) || 'manual',
            label: v.edit_label || '',
          })))
        }
      } catch (err) {
        console.error(err)
      }
    })()
  }, [messageId, scriptIndex])

  useEffect(() => {
    if (!hookOpen && !consciousnessOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setHookOpen(false)
        setConsciousnessOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [hookOpen, consciousnessOpen])

  const displayContent = editHistory.length > 0
    ? editHistory[editHistory.length - 1].content
    : script.content

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
    if (savedScriptId) return savedScriptId
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
    const parentId = await ensureOriginalSaved()
    if (parentId && onSaveVersion && source) {
      await onSaveVersion(parentId, content, source, label || undefined)
    }
  }

  const runEdit = async () => {
    if (!onEdit || !editInstruction.trim() || editing) return
    setEditing(true)
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
      setEditing(false)
    }
  }

  const runEnhance = async () => {
    if (!onEdit || enhancing || editing) return
    setEnhancing(true)
    setEditError(null)
    try {
      const result = await onEdit(displayContent, ENHANCE_PROMPT, 'script_enhance')
      await pushVersion(result, 'enhance')
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Enhance failed')
    } finally {
      setEnhancing(false)
    }
  }

  const runHook = async (opt: { label: string; prompt: string }) => {
    if (!onEdit || editing) return
    setHookOpen(false)
    setEditing(true)
    setEditError(null)
    try {
      const result = await onEdit(displayContent, opt.prompt, 'script_hook')
      await pushVersion(result, 'hook', opt.label)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Hook failed')
    } finally {
      setEditing(false)
    }
  }

  const runConsciousness = async (opt: { label: string; prompt: string }) => {
    if (!onEdit || editing) return
    setConsciousnessOpen(false)
    setEditing(true)
    setEditError(null)
    try {
      const result = await onEdit(displayContent, opt.prompt, 'script_consciousness')
      await pushVersion(result, 'consciousness', opt.label)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Consciousness failed')
    } finally {
      setEditing(false)
    }
  }

  const busy = editing || enhancing || saving || Boolean(savingScript)
  const es = language === 'es'

  return (
    <article className="chat-shell__artifact">
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
            disabled={editing}
            aria-label={es ? 'Instrucción de edición' : 'Edit instruction'}
          />
          <div className="chat-shell__artifact-edit-actions">
            <button type="button" className="chat-shell__artifact-action is-primary" onClick={() => void runEdit()} disabled={!editInstruction.trim() || editing}>
              {editing ? <Loader2 size={14} className="chat-shell__spin" /> : <Send size={14} />}
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

      {(busy && !showEdit) && (
        <div className="chat-shell__artifact-status">
          <Loader2 size={14} className="chat-shell__spin" />
          {enhancing ? (es ? 'Mejorando…' : 'Enhancing…') : (es ? 'Procesando…' : 'Processing…')}
        </div>
      )}

      {editError && <div className="chat-shell__artifact-error">{editError}</div>}

      <div className="chat-shell__artifact-body">
        {sectionNodes}
      </div>

      <div className="chat-shell__artifact-actions" ref={menuRef}>
        <button type="button" className="chat-shell__artifact-action" onClick={() => void handleCopy()}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? (es ? 'Copiado' : 'Copied') : (es ? 'Copiar' : 'Copy')}
        </button>
        <button
          type="button"
          className="chat-shell__artifact-action"
          onClick={() => void handleSave()}
          disabled={!onSave || savedOriginal || saving}
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
            setHookOpen(false)
            setConsciousnessOpen(false)
            setTimeout(() => editRef.current?.focus(), 50)
          }}
          disabled={!onEdit || busy}
        >
          <Pencil size={13} />
          {es ? 'Editar' : 'Edit'}
        </button>
        <button type="button" className="chat-shell__artifact-action" onClick={() => void runEnhance()} disabled={!onEdit || busy}>
          <Wand2 size={13} />
          {es ? 'Mejorar' : 'Improve'}
        </button>
        <div className="chat-shell__artifact-menu-wrap">
          <button
            type="button"
            className={`chat-shell__artifact-action${hookOpen ? ' is-on' : ''}`}
            onClick={() => {
              setHookOpen((v) => !v)
              setConsciousnessOpen(false)
            }}
            disabled={!onEdit || busy}
          >
            <Anchor size={13} />
            + Hooks
          </button>
          {hookOpen && (
            <div className="chat-shell__artifact-menu" role="menu">
              {HOOK_OPTIONS.map((opt) => (
                <button key={opt.label} type="button" role="menuitem" onClick={() => void runHook(opt)}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="chat-shell__artifact-menu-wrap">
          <button
            type="button"
            className={`chat-shell__artifact-action${consciousnessOpen ? ' is-on' : ''}`}
            onClick={() => {
              setConsciousnessOpen((v) => !v)
              setHookOpen(false)
            }}
            disabled={!onEdit || busy}
          >
            <Sparkles size={13} />
            {es ? 'Conciencia' : 'Consciousness'}
          </button>
          {consciousnessOpen && (
            <div className="chat-shell__artifact-menu" role="menu">
              {CONSCIOUSNESS_OPTIONS.map((opt) => (
                <button key={opt.label} type="button" role="menuitem" onClick={() => void runConsciousness(opt)}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
