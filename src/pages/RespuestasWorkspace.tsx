import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import {
  getProduct,
  getReplySessions,
  createReplySession,
  deleteReplySession,
  getReplyMessages,
  addReplyMessage,
  getReplyContextSources,
  createReplyContextSource,
  deleteReplyContextSource,
  recordAiSignal
} from '../services/database'
import { supabase } from '../lib/supabase'
import type { Product, ReplySession, ReplyMessage, ReplyContextSource } from '../types'
import Layout from '../components/Layout'
import UsageBanner from '../components/UsageBanner'
import BrandKitSelector from '../components/BrandKitSelector'
import { useUsageLimits } from '../hooks/useUsageLimits'
import {
  Send,
  Loader2,
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  Check,
  Link2,
  FileText,
  ImageIcon,
  MessageCircle,
  X,
  Upload,
  Globe,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react'

const REPLY_API_URL = import.meta.env.PROD ? '/api/reply-chat' : 'http://localhost:3000/api/reply-chat'
const FETCH_URL_API = import.meta.env.PROD ? '/api/fetch-url' : 'http://localhost:3000/api/fetch-url'
const OCR_API_URL = import.meta.env.PROD ? '/api/ocr-image' : 'http://localhost:3000/api/ocr-image'

export default function RespuestasWorkspace() {
  const { productId } = useParams<{ productId: string }>()
  const { user } = useAuth()
  const { language } = useLanguage()
  const usageLimits = useUsageLimits()

  // Core state
  const [product, setProduct] = useState<Product | null>(null)
  const [sessions, setSessions] = useState<ReplySession[]>([])
  const [currentSession, setCurrentSession] = useState<ReplySession | null>(null)
  const [messages, setMessages] = useState<ReplyMessage[]>([])
  const [contextSources, setContextSources] = useState<ReplyContextSource[]>([])

  // UI state
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Context source modals
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [showTextInput, setShowTextInput] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [textTitle, setTextTitle] = useState('')
  const [textValue, setTextValue] = useState('')
  const [addingSource, setAddingSource] = useState(false)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [selectedBrandKitId, setSelectedBrandKitId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const labels = {
    es: {
      title: 'Respuestas',
      back: 'Volver a Respuestas',
      newSession: 'Nueva conversación',
      placeholder: 'Pega la conversación del cliente o escribe tu pregunta...',
      send: 'Generar respuesta',
      copy: 'Copiar',
      copied: '¡Copiado!',
      startPrompt: 'Pega una conversación de tu cliente y genera la respuesta perfecta.',
      knowledgeBase: 'Base de Conocimiento',
      addUrl: 'Agregar URL',
      addText: 'Agregar Texto',
      uploadImage: 'Subir Captura',
      urlPlaceholder: 'https://ejemplo.com/pagina-de-producto',
      addUrlBtn: 'Agregar',
      textTitlePlaceholder: 'Título (ej: Preguntas frecuentes)',
      textPlaceholder: 'Pega aquí información relevante sobre tu producto, FAQs, etc...',
      addTextBtn: 'Guardar',
      cancel: 'Cancelar',
      noSources: 'Sin fuentes de contexto aún. Agrega URLs, texto o capturas para mejorar las respuestas.',
      deletingSource: 'Eliminando...',
      loadingUrl: 'Cargando URL...',
      ocrProcessing: 'Procesando imagen...',
      sessions: 'Sesiones',
      deleteSession: 'Eliminar sesión',
      productInfo: 'Producto',
      limitReached: 'Límite de respuestas alcanzado'
    },
    en: {
      title: 'Replies',
      back: 'Back to Replies',
      newSession: 'New conversation',
      placeholder: 'Paste the client conversation or type your question...',
      send: 'Generate reply',
      copy: 'Copy',
      copied: 'Copied!',
      startPrompt: 'Paste a client conversation and generate the perfect reply.',
      knowledgeBase: 'Knowledge Base',
      addUrl: 'Add URL',
      addText: 'Add Text',
      uploadImage: 'Upload Screenshot',
      urlPlaceholder: 'https://example.com/product-page',
      addUrlBtn: 'Add',
      textTitlePlaceholder: 'Title (e.g. FAQ)',
      textPlaceholder: 'Paste relevant information about your product, FAQs, etc...',
      addTextBtn: 'Save',
      cancel: 'Cancel',
      noSources: 'No context sources yet. Add URLs, text, or screenshots to improve replies.',
      deletingSource: 'Deleting...',
      loadingUrl: 'Loading URL...',
      ocrProcessing: 'Processing image...',
      sessions: 'Sessions',
      deleteSession: 'Delete session',
      productInfo: 'Product',
      limitReached: 'Reply limit reached'
    }
  }

  const t = labels[language]

  // =============================================
  // DATA LOADING
  // =============================================
  useEffect(() => {
    async function loadData() {
      if (!productId || !user) return
      try {
        const [productData, sessionsData, sourcesData] = await Promise.all([
          getProduct(productId),
          getReplySessions(productId),
          getReplyContextSources(productId, user.id)
        ])
        setProduct(productData)
        setContextSources(sourcesData)

        if (sessionsData.length > 0) {
          setSessions(sessionsData)
          setCurrentSession(sessionsData[0])
          const msgs = await getReplyMessages(sessionsData[0].id)
          setMessages(msgs)
        } else {
          // Create first session automatically
          const newSession = await createReplySession(productId, user.id)
          setSessions([newSession])
          setCurrentSession(newSession)
          setMessages([])
        }
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setPageLoading(false)
      }
    }
    loadData()
  }, [productId, user])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // =============================================
  // SESSION MANAGEMENT
  // =============================================
  const handleNewSession = async () => {
    if (!productId || !user) return
    try {
      const newSession = await createReplySession(productId, user.id)
      setSessions(prev => [newSession, ...prev])
      setCurrentSession(newSession)
      setMessages([])
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }

  const handleSwitchSession = async (session: ReplySession) => {
    if (session.id === currentSession?.id) return
    setCurrentSession(session)
    try {
      const msgs = await getReplyMessages(session.id)
      setMessages(msgs)
    } catch (error) {
      console.error('Failed to load messages:', error)
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteReplySession(sessionId)
      const remaining = sessions.filter(s => s.id !== sessionId)
      setSessions(remaining)
      if (currentSession?.id === sessionId) {
        if (remaining.length > 0) {
          setCurrentSession(remaining[0])
          const msgs = await getReplyMessages(remaining[0].id)
          setMessages(msgs)
        } else if (productId && user) {
          const newSession = await createReplySession(productId, user.id)
          setSessions([newSession])
          setCurrentSession(newSession)
          setMessages([])
        }
      }
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  // =============================================
  // SEND MESSAGE / GENERATE REPLY
  // =============================================
  const handleSend = async () => {
    if (loading || !input.trim() || !currentSession || !user) return

    const userContent = input.trim()
    setInput('')
    setLoading(true)

    // Save user message to DB
    try {
      const userMsg = await addReplyMessage(currentSession.id, 'user', userContent)
      setMessages(prev => [...prev, userMsg])
    } catch (error) {
      console.error('Failed to save user message:', error)
    }

    // Build message history for API
    const apiMessages = [...messages, { role: 'user' as const, content: userContent }]
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const response = await fetch(REPLY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          messages: apiMessages,
          productId,
          language,
          sessionId: currentSession.id,
          brandKitId: selectedBrandKitId || undefined
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API error: ${response.status}`)
      }

      const data = await response.json()
      const assistantContent = data.content || 'No response generated'

      // Save assistant message to DB
      const assistantMsg = await addReplyMessage(currentSession.id, 'assistant', assistantContent)
      setMessages(prev => [...prev, assistantMsg])

      // Record AI signal for memory learning
      if (productId) {
        recordAiSignal(productId, 'reply_generated', {
          responseLength: assistantContent.length,
          messageCount: apiMessages.length
        })
      }

      usageLimits.refresh()
    } catch (error) {
      console.error('Reply generation error:', error)
      // Show error in UI only — do NOT persist to DB to avoid polluting conversation history
      const errorContent = language === 'es'
        ? `Error: ${error instanceof Error ? error.message : 'No se pudo generar la respuesta'}`
        : `Error: ${error instanceof Error ? error.message : 'Failed to generate reply'}`

      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        session_id: currentSession.id,
        role: 'assistant' as const,
        content: errorContent,
        attachments: [],
        created_at: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  // =============================================
  // CONTEXT SOURCES
  // =============================================
  const handleAddUrl = async () => {
    if (!urlValue.trim() || !productId || !user || addingSource) return
    setAddingSource(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      // Scrape URL content
      const response = await fetch(FETCH_URL_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ url: urlValue.trim() })
      })

      if (!response.ok) throw new Error('Failed to fetch URL')

      const data = await response.json()
      const title = data.title || new URL(urlValue.trim()).hostname
      const content = data.content || ''

      // Save as context source
      const source = await createReplyContextSource(
        productId, user.id, 'url', title, content, urlValue.trim()
      )
      setContextSources(prev => [source, ...prev])
      setUrlValue('')
      setShowUrlInput(false)
    } catch (error) {
      console.error('Failed to add URL:', error)
    } finally {
      setAddingSource(false)
    }
  }

  const handleAddText = async () => {
    if (!textValue.trim() || !productId || !user || addingSource) return
    setAddingSource(true)

    try {
      const title = textTitle.trim() || (language === 'es' ? 'Texto agregado' : 'Added text')
      const source = await createReplyContextSource(
        productId, user.id, 'text', title, textValue.trim()
      )
      setContextSources(prev => [source, ...prev])
      setTextTitle('')
      setTextValue('')
      setShowTextInput(false)
    } catch (error) {
      console.error('Failed to add text:', error)
    } finally {
      setAddingSource(false)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !productId || !user) return

    setOcrLoading(true)
    try {
      // Convert to base64
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string
          // Remove data:image/...;base64, prefix
          const base64Data = result.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const mimeType = file.type || 'image/jpeg'

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      // Send to OCR API
      const response = await fetch(OCR_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ image: base64, mimeType })
      })

      if (!response.ok) throw new Error('OCR failed')

      const data = await response.json()
      const extractedText = data.text || ''

      if (!extractedText.trim()) {
        alert(language === 'es' ? 'No se pudo extraer texto de la imagen' : 'Could not extract text from image')
        return
      }

      // Save as context source
      const title = file.name || (language === 'es' ? 'Captura de conversación' : 'Conversation screenshot')
      const source = await createReplyContextSource(
        productId, user.id, 'image', title, extractedText, null, { originalFileName: file.name }
      )
      setContextSources(prev => [source, ...prev])
    } catch (error) {
      console.error('Image OCR failed:', error)
    } finally {
      setOcrLoading(false)
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeleteSource = async (sourceId: string) => {
    try {
      await deleteReplyContextSource(sourceId)
      setContextSources(prev => prev.filter(s => s.id !== sourceId))
    } catch (error) {
      console.error('Failed to delete source:', error)
    }
  }

  // =============================================
  // COPY
  // =============================================
  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)

    // Record signal for memory
    if (productId) {
      recordAiSignal(productId, 'reply_copied', {})
    }
  }

  // =============================================
  // KEY HANDLER
  // =============================================
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // =============================================
  // RENDER
  // =============================================
  if (pageLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </Layout>
    )
  }

  const sourceIcon = (type: string) => {
    switch (type) {
      case 'url': return <Globe className="w-3.5 h-3.5" />
      case 'text': return <FileText className="w-3.5 h-3.5" />
      case 'image': return <ImageIcon className="w-3.5 h-3.5" />
      default: return <FileText className="w-3.5 h-3.5" />
    }
  }

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="border-b border-dark-200 bg-dark-100 px-4 py-3 flex items-center gap-3">
          <Link to="/respuestas" className="p-1.5 hover:bg-dark-200 rounded-lg transition-colors">
            <ArrowLeft className="w-4 h-4 text-dark-600" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-dark-900 truncate">
              {t.title} — {product?.name || ''}
            </h1>
          </div>
          <BrandKitSelector
            selectedKitId={selectedBrandKitId}
            onSelect={setSelectedBrandKitId}
            productId={productId}
            compact
          />
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 hover:bg-dark-200 rounded-lg transition-colors text-dark-500"
            title={t.knowledgeBase}
          >
            {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>
        </div>

        {/* Usage banner — uses script resource slot since UsageBanner doesn't support reply yet */}
        <UsageBanner usage={usageLimits} resource="script" />

        <div className="flex flex-1 min-h-0">
          {/* Left sidebar — Knowledge Base */}
          {sidebarOpen && (
            <div className="w-72 border-r border-dark-200 bg-dark-50 flex flex-col overflow-hidden">
              {/* Sessions section */}
              <div className="p-3 border-b border-dark-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-dark-500 uppercase tracking-wider">{t.sessions}</span>
                  <button
                    onClick={handleNewSession}
                    className="p-1 hover:bg-dark-200 rounded transition-colors text-dark-500 hover:text-primary-600"
                    title={t.newSession}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {sessions.map(session => (
                    <div
                      key={session.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer group ${
                        currentSession?.id === session.id
                          ? 'bg-primary-900/20 text-primary-400'
                          : 'text-dark-500 hover:bg-dark-200'
                      }`}
                      onClick={() => handleSwitchSession(session)}
                    >
                      <MessageCircle className="w-3 h-3 flex-shrink-0" />
                      <span className="flex-1 truncate">{session.title}</span>
                      {sessions.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id) }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
                          title={t.deleteSession}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Knowledge Base section */}
              <div className="flex-1 p-3 overflow-y-auto">
                <span className="text-xs font-semibold text-dark-500 uppercase tracking-wider">{t.knowledgeBase}</span>

                {/* Action buttons */}
                <div className="flex gap-1.5 mt-2 mb-3">
                  <button
                    onClick={() => { setShowUrlInput(true); setShowTextInput(false) }}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-dark-200 hover:bg-dark-300 rounded transition-colors text-dark-600"
                  >
                    <Link2 className="w-3 h-3" /> {t.addUrl}
                  </button>
                  <button
                    onClick={() => { setShowTextInput(true); setShowUrlInput(false) }}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-dark-200 hover:bg-dark-300 rounded transition-colors text-dark-600"
                  >
                    <FileText className="w-3 h-3" /> {t.addText}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={ocrLoading}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-dark-200 hover:bg-dark-300 rounded transition-colors text-dark-600 disabled:opacity-50"
                  >
                    {ocrLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    {ocrLoading ? (language === 'es' ? 'OCR...' : 'OCR...') : t.uploadImage}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </div>

                {/* URL input form */}
                {showUrlInput && (
                  <div className="mb-3 p-2 bg-dark-100 rounded-lg border border-dark-200">
                    <input
                      type="url"
                      value={urlValue}
                      onChange={e => setUrlValue(e.target.value)}
                      placeholder={t.urlPlaceholder}
                      className="w-full text-xs px-2 py-1.5 bg-dark-50 border border-dark-200 rounded text-dark-900 placeholder-dark-400 mb-2"
                      onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleAddUrl}
                        disabled={addingSource || !urlValue.trim()}
                        className="flex-1 text-[10px] font-medium px-2 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        {addingSource ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        {addingSource ? t.loadingUrl : t.addUrlBtn}
                      </button>
                      <button
                        onClick={() => { setShowUrlInput(false); setUrlValue('') }}
                        className="text-[10px] px-2 py-1 text-dark-500 hover:text-dark-700"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                )}

                {/* Text input form */}
                {showTextInput && (
                  <div className="mb-3 p-2 bg-dark-100 rounded-lg border border-dark-200">
                    <input
                      type="text"
                      value={textTitle}
                      onChange={e => setTextTitle(e.target.value)}
                      placeholder={t.textTitlePlaceholder}
                      className="w-full text-xs px-2 py-1.5 bg-dark-50 border border-dark-200 rounded text-dark-900 placeholder-dark-400 mb-1.5"
                    />
                    <textarea
                      value={textValue}
                      onChange={e => setTextValue(e.target.value)}
                      placeholder={t.textPlaceholder}
                      rows={4}
                      className="w-full text-xs px-2 py-1.5 bg-dark-50 border border-dark-200 rounded text-dark-900 placeholder-dark-400 resize-none mb-2"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleAddText}
                        disabled={addingSource || !textValue.trim()}
                        className="flex-1 text-[10px] font-medium px-2 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
                      >
                        {t.addTextBtn}
                      </button>
                      <button
                        onClick={() => { setShowTextInput(false); setTextTitle(''); setTextValue('') }}
                        className="text-[10px] px-2 py-1 text-dark-500 hover:text-dark-700"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                )}

                {/* Context sources list */}
                {contextSources.length === 0 ? (
                  <p className="text-[10px] text-dark-400 mt-2">{t.noSources}</p>
                ) : (
                  <div className="space-y-1.5 mt-1">
                    {contextSources.map(source => (
                      <div
                        key={source.id}
                        className="flex items-start gap-2 px-2 py-1.5 bg-dark-100 rounded border border-dark-200 group"
                      >
                        <span className="text-dark-400 mt-0.5">{sourceIcon(source.source_type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-dark-700 truncate">{source.title}</p>
                          {source.url && (
                            <p className="text-[9px] text-dark-400 truncate">{source.url}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteSource(source.id)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-dark-400 hover:text-red-400 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Main chat area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <MessageCircle className="w-12 h-12 text-dark-300 mx-auto mb-3" />
                    <p className="text-dark-500 text-sm">{t.startPrompt}</p>
                  </div>
                </div>
              ) : (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-primary-600 text-white'
                        : 'bg-dark-100 text-dark-900 border border-dark-200'
                    }`}>
                      <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dark-200/50">
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className="flex items-center gap-1 text-[10px] text-dark-400 hover:text-primary-600 transition-colors"
                          >
                            {copiedId === msg.id ? (
                              <><Check className="w-3 h-3" /> {t.copied}</>
                            ) : (
                              <><Copy className="w-3 h-3" /> {t.copy}</>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-dark-100 border border-dark-200 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2 text-dark-500 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {language === 'es' ? 'Generando respuesta...' : 'Generating reply...'}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="border-t border-dark-200 p-4 bg-dark-50">
              <div className="flex gap-2 items-end">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t.placeholder}
                  rows={3}
                  className="flex-1 resize-none rounded-xl border border-dark-200 bg-dark-100 px-4 py-3 text-sm text-dark-900 placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  disabled={loading}
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
