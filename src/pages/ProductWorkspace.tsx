import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  getProduct, 
  getChatSessions, 
  getChatSession,
  createChatSession, 
  getMessages, 
  addMessage,
  updateChatSession,
  updateProduct,
  saveScript,
  createScriptVersion,
  getContextDocuments,
  createContextDocument,
  deleteContextDocument,
  recordAiSignal,
  getUserAiMemory,
  getProductAiMemory,
  updateUserAiMemorySummary,
  updateProductAiMemorySummary,
  resetProductAiMemory,
  getAiMemories
} from '../services/database'
import { sendMessageToGrok, previewPrompt, editScript, DEFAULT_SCRIPT_SETTINGS, buildApiBusinessContext, buildApiProductContext } from '../services/grokApi'
import type { Product, ChatSession, Message, ScriptGenerationSettings, ContextDocument, SalesChannel, UserAiMemory, ProductAiMemory, AiMemory } from '../types'
import { getSuccessCases } from '../services/database'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import ThinkingAnimation from '../components/ThinkingAnimation'
import ScriptSettingsPanel from '../components/ScriptSettingsPanel'
import ScriptCard from '../components/ScriptCard'
import { parseScripts, isScriptContent } from '../utils/scriptParser'
import UsageBanner from '../components/UsageBanner'
import BrandKitSelector from '../components/BrandKitSelector'
import { useUsageLimits } from '../hooks/useUsageLimits'
import { 
  Send, 
  Loader2, 
  Plus, 
  MessageSquare, 
  ChevronLeft,
  Edit3,
  Save,
  X,
  Download,
  Sparkles,
  Info,
  Link2,
  FileText,
  Trash2,
  Upload,
  Pencil,
  Eye,
  EyeOff,
  Mic,
  Square,
  Building2,
  MapPin,
  Globe,
  Brain,
  ChevronDown,
  RefreshCw,
  Check,
  Anchor,
  Target,
  ScrollText,
  MessageCircle
} from 'lucide-react'

export default function ProductWorkspace() {
  const { productId, sessionId } = useParams()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const { language } = useLanguage()
  
  const [product, setProduct] = useState<Product | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [context, setContext] = useState('')
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [showProductInfo, setShowProductInfo] = useState(true)
  const [editingProduct, setEditingProduct] = useState(false)
  const [editedProduct, setEditedProduct] = useState<Partial<Product>>({})
  const [savingScript, setSavingScript] = useState(false)
  const [scriptSettings, setScriptSettings] = useState<ScriptGenerationSettings>(DEFAULT_SCRIPT_SETTINGS)
  const [showMobileConfig, setShowMobileConfig] = useState(false)
  const [contextDocs, setContextDocs] = useState<ContextDocument[]>([])
  const [showAddLink, setShowAddLink] = useState(false)
  const [newLinkUrl, setNewLinkUrl] = useState('')
  const [newTextContent, setNewTextContent] = useState('')
  const [addingDoc, setAddingDoc] = useState(false)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [debugDocId, setDebugDocId] = useState<string | null>(null)
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({})
  const [previewSystemPrompt, setPreviewSystemPrompt] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [bulkLinkProgress, setBulkLinkProgress] = useState<{ current: number; total: number } | null>(null)
  const [failedLinks, setFailedLinks] = useState<string[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [activeSalesChannel, setActiveSalesChannel] = useState<SalesChannel | null>(null)
  // AI Memory panel state
  const [globalMemory, setGlobalMemory] = useState<UserAiMemory | null>(null)
  const [productMemory, setProductMemory] = useState<ProductAiMemory | null>(null)
  const [showMemoryPanel, setShowMemoryPanel] = useState(true)
  const [editingGlobalMemory, setEditingGlobalMemory] = useState(false)
  const [editingProductMemory, setEditingProductMemory] = useState(false)
  const [globalMemoryDraft, setGlobalMemoryDraft] = useState('')
  const [productMemoryDraft, setProductMemoryDraft] = useState('')
  const [savingMemory, setSavingMemory] = useState(false)
  const [synthesisingMemory, setSynthesisingMemory] = useState(false)
  const [showSynthesisPreview, setShowSynthesisPreview] = useState(false)
  const [aiMemoryEnabled, setAiMemoryEnabled] = useState(() => {
    const stored = localStorage.getItem('ai_memory_enabled')
    return stored !== null ? stored === 'true' : true
  })
  const [recentMemories, setRecentMemories] = useState<AiMemory[]>([])
  const [showTeachModal, setShowTeachModal] = useState(false)
  const [selectedBrandKitId, setSelectedBrandKitId] = useState<string | null>(null)
  const [teachInput, setTeachInput] = useState('')
  const [teachingSaving, setTeachingSaving] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const handleSendRef = useRef<(directMessage?: string) => Promise<void>>(null as any)
  const usageLimits = useUsageLimits()
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    async function loadData() {
      if (!productId || !user) return
      setInitializing(true)

      try {
        const productData = await getProduct(productId)
        if (!productData) {
          navigate('/scripts')
          return
        }
        setProduct(productData)
        setEditedProduct(productData)
        if (productData.business?.sales_channels?.length) {
          setActiveSalesChannel(productData.business.sales_channels[0])
        }

        const allSessions = await getChatSessions(productId)
        const sessionsData = allSessions.filter(s => !s.title?.startsWith('__desc__'))
        setSessions(sessionsData)

        if (sessionId) {
          const sessionData = await getChatSession(sessionId)
          if (sessionData) {
            setCurrentSession(sessionData)
            setContext(sessionData.context || '')
            const messagesData = await getMessages(sessionId)
            setMessages(messagesData)
            // Load context documents for this session
            const docsData = await getContextDocuments(sessionId)
            setContextDocs(docsData)
          }
        } else if (sessionsData.length > 0) {
          navigate(`/product/${productId}/session/${sessionsData[0].id}`, { replace: true })
        }
      } catch (error) {
        console.error('Failed to load product:', error)
      } finally {
        setInitializing(false)
      }
    }

    loadData()
  }, [productId, sessionId, user, navigate])

  // Load AI Memory data
  const refreshMemory = async () => {
    if (!productId || !user) return
    try {
      const [gMem, pMem, typedMems] = await Promise.all([
        getUserAiMemory(user.id),
        getProductAiMemory(productId, user.id),
        getAiMemories(user.id, productId, { limit: 5 })
      ])
      setGlobalMemory(gMem)
      setProductMemory(pMem)
      setRecentMemories(typedMems)
    } catch (e) {
      console.warn('Failed to load AI memory:', e)
    }
  }

  useEffect(() => {
    refreshMemory()
  }, [productId, user])

  // Real-time refresh when signals are recorded
  useEffect(() => {
    const handler = () => { refreshMemory() }
    window.addEventListener('ai-signal-recorded', handler)
    return () => window.removeEventListener('ai-signal-recorded', handler)
  }, [productId, user])

  // Listen for reflection completion — refresh memories + show toast
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.productId === productId) {
        refreshMemory()
      }
    }
    window.addEventListener('ai-memory-reflected', handler)
    return () => window.removeEventListener('ai-memory-reflected', handler)
  }, [productId, user])

  // Teach Me handler
  const handleTeachMe = async () => {
    if (!teachInput.trim() || !product || teachingSaving) return
    setTeachingSaving(true)
    try {
      await recordAiSignal(product.id, 'user_explicit', { instruction: teachInput.trim() })
      setTeachInput('')
      setShowTeachModal(false)
    } catch (e) {
      console.warn('Teach me failed:', e)
    } finally {
      setTeachingSaving(false)
    }
  }

  const handleSaveGlobalMemory = async () => {
    if (!user) return
    setSavingMemory(true)
    try {
      await updateUserAiMemorySummary(user.id, globalMemoryDraft)
      setGlobalMemory(prev => prev ? { ...prev, style_summary: globalMemoryDraft } : { id: '', user_id: user.id, style_summary: globalMemoryDraft, signals: {}, sample_hooks: [], sample_ctas: [], edit_patterns: [], avoid_patterns: [], signals_since_last_synthesis: 0, last_synthesized_at: null, created_at: '', updated_at: '' })
      setEditingGlobalMemory(false)
    } catch (e) {
      console.error('Failed to save global memory:', e)
    } finally {
      setSavingMemory(false)
    }
  }

  const handleSaveProductMemory = async () => {
    if (!user || !productId) return
    setSavingMemory(true)
    try {
      await updateProductAiMemorySummary(productId, user.id, productMemoryDraft)
      setProductMemory(prev => prev ? { ...prev, style_summary: productMemoryDraft } : { id: '', product_id: productId, user_id: user.id, style_summary: productMemoryDraft, signals: {}, sample_hooks: [], sample_ctas: [], sample_scripts: [], edit_instructions: [], avoid_patterns: [], edit_transformations: [], signals_since_last_synthesis: 0, last_synthesized_at: null, created_at: '', updated_at: '' })
      setEditingProductMemory(false)
    } catch (e) {
      console.error('Failed to save product memory:', e)
    } finally {
      setSavingMemory(false)
    }
  }

  const handleRelearn = async () => {
    if (!user || !productId) return
    setSynthesisingMemory(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      const res = await fetch('/api/synthesize-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ productId })
      })
      if (res.ok) {
        const result = await res.json()
        if (result.globalSummary) {
          setGlobalMemory(prev => prev ? { ...prev, style_summary: result.globalSummary } : null)
        }
        if (result.productSummary) {
          setProductMemory(prev => prev ? { ...prev, style_summary: result.productSummary } : null)
        }
      }
    } catch (e) {
      console.error('Failed to re-learn:', e)
    } finally {
      setSynthesisingMemory(false)
    }
  }

  const handleResetMemory = async () => {
    if (!user || !productId) return
    const confirmed = window.confirm(language === 'es' ? 'Esto eliminará toda la memoria de este producto. ¿Continuar?' : 'This will delete all memory for this product. Continue?')
    if (!confirmed) return
    try {
      await resetProductAiMemory(productId, user.id)
      setProductMemory(null)
    } catch (e) {
      console.error('Failed to reset memory:', e)
    }
  }

  const handleRenameSession = async (sessionId: string) => {
    if (!renameValue.trim()) {
      setRenamingSessionId(null)
      return
    }
    try {
      await updateChatSession(sessionId, { title: renameValue.trim() })
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: renameValue.trim() } : s))
      if (currentSession?.id === sessionId) {
        setCurrentSession(prev => prev ? { ...prev, title: renameValue.trim() } : prev)
      }
    } catch (error) {
      console.error('Failed to rename session:', error)
    } finally {
      setRenamingSessionId(null)
    }
  }

  const handleNewSession = async () => {
    if (!product || !user) return
    
    try {
      const newSession = await createChatSession(product.id, user.id, 'Nueva Sesión')
      setSessions(prev => [newSession, ...prev])
      navigate(`/product/${product.id}/session/${newSession.id}`)
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }

  const handleSend = async (directMessage?: string) => {
    const msg = directMessage ?? input
    if (!msg.trim() || loading || !user || !product) return

    const userMessage = msg.trim()
    setInput('')
    setLoading(true)

    try {
      let session = currentSession

      if (!session) {
        session = await createChatSession(product.id, user.id, userMessage.slice(0, 50), context)
        setCurrentSession(session)
        setSessions(prev => [session!, ...prev])
        navigate(`/product/${product.id}/session/${session.id}`, { replace: true })
      }

      // Add settings context to feedback messages so AI applies current config
      let settingsContext: string
      if (scriptSettings.generationMode === 'by_type') {
        const total = Object.values(scriptSettings.scriptTypeConfig).reduce((s, n) => s + n, 0)
        settingsContext = language === 'es'
          ? `\n\n[Config: ${total} guión(es) por tipo]`
          : `\n\n[Config: ${total} script(s) by type]`
      } else {
        settingsContext = language === 'es'
          ? `\n\n[Config: ${scriptSettings.variations} guión(es)]`
          : `\n\n[Config: ${scriptSettings.variations} script(s)]`
      }
      
      const messageWithSettings = messages.length > 0 ? userMessage + settingsContext : userMessage

      const savedUserMessage = await addMessage(session.id, 'user', userMessage)
      setMessages(prev => [...prev, savedUserMessage])

      const productContext = buildProductContext(product, context)
      const messageForApi = { ...savedUserMessage, content: messageWithSettings }
      const allMessages = [...messages, messageForApi]
      
      const { bizCtx, prodCtx } = await getStructuredContexts(product)
      const aiResponse = await sendMessageToGrok(allMessages, productContext, language, scriptSettings, undefined, contextDocs, undefined, bizCtx, prodCtx, undefined, activeSalesChannel ?? undefined, product.id, aiMemoryEnabled, selectedBrandKitId ?? undefined)
      const usedPrompt = aiResponse._debug?.systemPrompt || undefined

      const savedAiMessage = await addMessage(session.id, 'assistant', aiResponse.content, usedPrompt)
      setMessages(prev => [...prev, savedAiMessage])

    } catch (error) {
      console.error('Failed to send message:', error)
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        session_id: currentSession?.id || '',
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
        created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  // Keep ref in sync so voice callback always calls latest handleSend
  handleSendRef.current = handleSend

  const buildProductContext = (product: Product, additionalContext: string) => {
    const baseContext = {
      product_name: product.name,
      product_type: product.type,
      product_description: product.product_description,
      main_problem: product.main_problem,
      best_customers: product.best_customers,
      failed_attempts: product.failed_attempts,
      attention_grabber: product.attention_grabber,
      real_pain: product.real_pain,
      pain_consequences: product.pain_consequences,
      expected_result: product.expected_result,
      differentiation: product.differentiation,
      key_objection: product.key_objection,
      shipping_info: product.shipping_info,
      awareness_level: product.awareness_level,
      offer: product.offer,
      market_alternatives: product.market_alternatives,
      customer_values: product.customer_values,
      purchase_reason: product.purchase_reason,
      target_audience: product.target_audience,
      call_to_action: product.call_to_action,
      additional_context: additionalContext,
      context_links: product.context_links || [],
      context_links_content: product.context_links_content || ''
    }

    if (product.type === 'restaurant') {
      return { ...baseContext, menu_text: product.menu_text, location: product.location, schedule: product.schedule, is_new_restaurant: product.is_new_restaurant }
    }
    if (product.type === 'real_estate') {
      return { ...baseContext, re_business_type: product.re_business_type, re_price: product.re_price, re_location: product.re_location, re_construction_size: product.re_construction_size, re_bedrooms: product.re_bedrooms, re_capacity: product.re_capacity, re_bathrooms: product.re_bathrooms, re_parking: product.re_parking, re_highlights: product.re_highlights, re_location_reference: product.re_location_reference, re_cta: product.re_cta }
    }

    return baseContext
  }

  const getStructuredContexts = async (product: Product) => {
    const bizCtx = buildApiBusinessContext(product.business)
    const prodCtx = buildApiProductContext(product)
    if (product.type === 'service' && product.svc_has_success_cases) {
      const cases = await getSuccessCases(product.id)
      if (cases.length > 0) {
        (prodCtx as Record<string, unknown>).success_cases = cases.map(c => ({
          client_name: c.client_name,
          before_state: c.before_state,
          what_they_did: c.what_they_did,
          result: c.result,
          timeline: c.timeline,
          life_change: c.life_change,
        }))
      }
    }
    return { bizCtx, prodCtx }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleVoiceToggle = useCallback(async () => {
    if (isRecording) {
      // Stop recording
      mediaRecorderRef.current?.stop()
      setIsRecording(false)
      return
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        if (blob.size < 100) return // too small, ignore

        setIsTranscribing(true)
        try {
          const reader = new FileReader()
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              const result = reader.result as string
              resolve(result.split(',')[1])
            }
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })

          const { data: { session: authSession } } = await supabase.auth.getSession()
          const token = authSession?.access_token

          const apiUrl = import.meta.env.PROD
            ? '/api/transcribe-audio'
            : 'http://localhost:3000/api/transcribe-audio'

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              audio: base64,
              mimeType: mimeType.split(';')[0],
              language
            })
          })

          const result = await response.json()
          if (response.ok && result.text) {
            handleSendRef.current(result.text)
          } else {
            console.error('Transcription failed:', result.error)
          }
        } catch (err) {
          console.error('Voice transcription error:', err)
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error('Microphone access denied:', err)
    }
  }, [isRecording, language])

  const handleAddLink = async () => {
    if (!currentSession || !user || !newLinkUrl.trim() || addingDoc) return
    setAddingDoc(true)
    
    // Parse multiple URLs (one per line, filter empty lines)
    const urls = newLinkUrl
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0 && (u.startsWith('http://') || u.startsWith('https://')))
    
    if (urls.length === 0) {
      setAddingDoc(false)
      return
    }

    setBulkLinkProgress({ current: 0, total: urls.length })
    setFailedLinks([])
    
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const token = authSession?.access_token

      const fetchUrl = import.meta.env.PROD 
        ? '/api/fetch-url' 
        : 'http://localhost:3000/api/fetch-url'

      const failed: string[] = []

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        setBulkLinkProgress({ current: i + 1, total: urls.length })
        
        try {
          const response = await fetch(fetchUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ url })
          })

          const result = await response.json()
          
          if (!response.ok) {
            failed.push(url)
            continue
          }

          if (result.warning === 'minimal_content') {
            failed.push(url)
          }

          const newDoc = await createContextDocument(currentSession.id, user.id, {
            type: 'link',
            name: result.title || url,
            content: result.content,
            url
          })

          setContextDocs(prev => [newDoc, ...prev])
        } catch (err) {
          console.warn(`Failed to add link ${url}:`, err)
          failed.push(url)
        }
      }

      if (failed.length > 0) {
        setFailedLinks(failed)
      } else {
        setNewLinkUrl('')
        setShowAddLink(false)
      }
    } catch (error) {
      console.error('Failed to add links:', error)
    } finally {
      setAddingDoc(false)
      setBulkLinkProgress(null)
    }
  }

  const handleAddText = async () => {
    if (!currentSession || !user || !newTextContent.trim() || addingDoc) return
    setAddingDoc(true)
    
    try {
      const newDoc = await createContextDocument(currentSession.id, user.id, {
        type: 'text',
        name: language === 'es' ? 'Texto adicional' : 'Additional text',
        content: newTextContent
      })

      setContextDocs(prev => [newDoc, ...prev])
      setNewTextContent('')
    } catch (error) {
      console.error('Failed to add text:', error)
    } finally {
      setAddingDoc(false)
    }
  }

  const handleDeleteDoc = async (docId: string) => {
    try {
      await deleteContextDocument(docId)
      setContextDocs(prev => prev.filter(d => d.id !== docId))
    } catch (error) {
      console.error('Failed to delete document:', error)
    }
  }

  const [pdfError, setPdfError] = useState<string | null>(null)

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !currentSession || !user || addingDoc) return
    
    if (!file.type.includes('pdf')) {
      setPdfError(language === 'es' ? 'Por favor sube un archivo PDF' : 'Please upload a PDF file')
      return
    }

    setAddingDoc(true)
    setPdfError(null)
    
    try {
      // Read file as base64
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const base64 = (e.target?.result as string)?.split(',')[1]
          if (!base64) {
            setAddingDoc(false)
            return
          }

          // Extract text via API
          const { data: { session: authSession } } = await supabase.auth.getSession()
          const token = authSession?.access_token

          const extractUrl = import.meta.env.PROD 
            ? '/api/extract-pdf' 
            : 'http://localhost:3000/api/extract-pdf'

          const response = await fetch(extractUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ base64Content: base64, fileName: file.name })
          })

          const result = await response.json()
          
          if (!response.ok) {
            setPdfError(result.error || (language === 'es' ? 'Error al extraer el PDF' : 'Failed to extract PDF'))
            setAddingDoc(false)
            return
          }

          // Save to database
          const newDoc = await createContextDocument(currentSession.id, user.id, {
            type: 'pdf',
            name: file.name,
            content: result.content
          })

          setContextDocs(prev => [newDoc, ...prev])
          setAddingDoc(false)
        } catch (err) {
          console.error('Failed to process PDF:', err)
          setPdfError(language === 'es' ? 'Error al procesar el PDF' : 'Failed to process PDF')
          setAddingDoc(false)
        }
      }
      reader.onerror = () => {
        setPdfError(language === 'es' ? 'Error al leer el archivo' : 'Failed to read file')
        setAddingDoc(false)
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Failed to upload PDF:', error)
      setPdfError(language === 'es' ? 'Error al subir el PDF' : 'Failed to upload PDF')
      setAddingDoc(false)
    }
    
    // Reset input
    event.target.value = ''
  }

  const handleSaveProduct = async () => {
    if (!product) return
    try {
      await updateProduct(product.id, editedProduct)
      setProduct({ ...product, ...editedProduct })
      setEditingProduct(false)
    } catch (error) {
      console.error('Failed to update product:', error)
    }
  }

  const handleGenerateScript = async () => {
    if (loading || !user || !product) return
    setLoading(true)

    try {
      let session = currentSession

      if (!session) {
        session = await createChatSession(product.id, user.id, `Script - ${new Date().toLocaleDateString()}`, context)
        setCurrentSession(session)
        setSessions(prev => [session!, ...prev])
        navigate(`/product/${product.id}/session/${session.id}`, { replace: true })
      }

      // Build generation prompt based on mode
      let generatePrompt: string

      if (scriptSettings.generationMode === 'by_type') {
        const typeLabels: Record<string, { es: string; en: string }> = {
          venta_directa: { es: 'Venta Directa', en: 'Direct Sale' },
          desvalidar_alternativas: { es: 'Desvalidar Alternativas', en: 'Invalidate Alternatives' },
          mostrar_servicio: { es: 'Mostrar el Servicio/Producto', en: 'Show Service/Product' },
          variedad_productos: { es: 'Variedad de Productos', en: 'Product Variety' },
          paso_a_paso: { es: 'Paso a Paso', en: 'Step by Step' },
          reconocimiento: { es: 'Reconocimiento (TOF / Branding)', en: 'Brand Awareness (TOF / Branding)' }
        }
        const config = scriptSettings.scriptTypeConfig
        const reconocimientoCount = config.reconocimiento ?? 0
        const otherCount = Object.entries(config).filter(([k]) => k !== 'reconocimiento').reduce((s, [, n]) => s + n, 0)
        const isOnlyReconocimiento = reconocimientoCount > 0 && otherCount === 0

        if (isOnlyReconocimiento) {
          generatePrompt = language === 'es'
            ? `Genera exactamente ${reconocimientoCount} guión(es) de reconocimiento de marca (micro-historias).\nCada guión DEBE tener un MOTOR EMOCIONAL DIFERENTE.\nLa marca debe aparecer como consecuencia natural de la historia, NO como protagonista.\nNO repitas la misma emoción o enfoque. Varía obligatoriamente.`
            : `Generate exactly ${reconocimientoCount} brand awareness script(s) (micro-stories).\nEach script MUST have a DIFFERENT EMOTIONAL MOTOR.\nThe brand must appear as a natural consequence of the story, NOT as the protagonist.\nDo NOT repeat the same emotion or approach. Vary obligatorily.`
        } else {
          const parts: string[] = []
          for (const [key, count] of Object.entries(config)) {
            if (count > 0) {
              const label = typeLabels[key]?.[language] || key
              parts.push(language === 'es' 
                ? `${count} guión(es) de tipo "${label}"`
                : `${count} "${label}" script(s)`)
            }
          }
          const total = Object.values(config).reduce((s, n) => s + n, 0)
          generatePrompt = language === 'es'
            ? `Genera exactamente ${total} guión(es) de venta: ${parts.join(', ')}.`
            : `Generate exactly ${total} sales script(s): ${parts.join(', ')}.`
        }
      } else {
        generatePrompt = language === 'es' 
          ? `Genera exactamente ${scriptSettings.variations} guión(es) de venta.`
          : `Generate exactly ${scriptSettings.variations} sales script(s).`
      }

      // Append user style/tone preferences while preserving master format
      const isReconocimientoOnly = scriptSettings.generationMode === 'by_type' 
        && (scriptSettings.scriptTypeConfig.reconocimiento ?? 0) > 0
        && Object.entries(scriptSettings.scriptTypeConfig).every(([k, n]) => k === 'reconocimiento' || n === 0)
      if (input.trim()) {
        const userInstruction = input.trim()
        if (isReconocimientoOnly) {
          generatePrompt += language === 'es'
            ? `\n\nPREFERENCIA DE ESTILO DEL USUARIO: "${userInstruction}"\nIMPORTANTE: Aplica esta preferencia de tono/enfoque en las micro-historias. NO cambies el formato de entrega. NO respondas de forma conversacional. Genera los guiones exactamente en el formato establecido por el sistema.`
            : `\n\nUSER STYLE PREFERENCE: "${userInstruction}"\nIMPORTANT: Apply this tone/focus preference within the micro-stories. Do NOT change the delivery format. Do NOT respond conversationally. Generate scripts exactly in the format established by the system.`
        } else {
          generatePrompt += language === 'es'
            ? `\n\nPREFERENCIA DE ESTILO DEL USUARIO: "${userInstruction}"\nIMPORTANTE: Aplica esta preferencia de tono/enfoque DENTRO de la estructura obligatoria de guiones (GANCHO/DESARROLLO/CTA). NO cambies el formato de entrega. NO respondas de forma conversacional. Genera los guiones exactamente en el formato establecido por el sistema.`
            : `\n\nUSER STYLE PREFERENCE: "${userInstruction}"\nIMPORTANT: Apply this tone/focus preference WITHIN the mandatory script structure (HOOK/DEVELOPMENT/CTA). Do NOT change the delivery format. Do NOT respond conversationally. Generate scripts exactly in the format established by the system.`
        }
        // Record instruction as AI memory signal
        if (product) {
          recordAiSignal(product.id, 'user_instruction', { instruction: userInstruction })
        }
        setInput('')
      }
      
      const userMessage = await addMessage(session.id, 'user', generatePrompt)
      setMessages(prev => [...prev, userMessage])

      const productContext = buildProductContext(product, context)
      const allMessages = [...messages, userMessage]
      
      const { bizCtx, prodCtx } = await getStructuredContexts(product)
      const aiResponse = await sendMessageToGrok(allMessages, productContext, language, scriptSettings, undefined, contextDocs, undefined, bizCtx, prodCtx, undefined, activeSalesChannel ?? undefined, product.id, aiMemoryEnabled, selectedBrandKitId ?? undefined)
      const usedPrompt = aiResponse._debug?.systemPrompt || undefined

      const savedAiMessage = await addMessage(session.id, 'assistant', aiResponse.content, usedPrompt)
      setMessages(prev => [...prev, savedAiMessage])

    } catch (error) {
      console.error('Failed to generate script:', error)
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        session_id: currentSession?.id || '',
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to generate script'}`,
        created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  const handlePreviewPrompt = async () => {
    if (!product || loadingPreview) return
    setLoadingPreview(true)
    try {
      const productContext = buildProductContext(product, context)
      const { bizCtx, prodCtx } = await getStructuredContexts(product)
      const prompt = await previewPrompt(
        messages,
        productContext,
        language,
        scriptSettings,
        undefined,
        contextDocs,
        bizCtx,
        prodCtx
      )
      setPreviewSystemPrompt(prompt)
    } catch (error) {
      console.error('Failed to preview prompt:', error)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleSaveScript = async (
    content: string,
    title?: string,
    opts?: { edit_source?: string; message_id?: string; script_index?: number }
  ): Promise<string | null> => {
    if (!currentSession || !product || savingScript) return null
    setSavingScript(true)
    try {
      const script = await saveScript(
        currentSession.id,
        product.id,
        title || `Script - ${new Date().toLocaleDateString()}`,
        content,
        undefined,
        opts
      )
      return script.id
    } catch (error) {
      console.error('Failed to save script:', error)
      return null
    } finally {
      setSavingScript(false)
    }
  }

  const handleSaveIndividualScript = async (
    content: string,
    title: string,
    opts?: { edit_source?: string; message_id?: string; script_index?: number }
  ): Promise<string | null> => {
    return handleSaveScript(content, title, opts)
  }

  const handleSaveVersion = async (
    parentId: string,
    content: string,
    editSource: string,
    editLabel?: string
  ): Promise<string | null> => {
    if (!currentSession || !product) return null
    try {
      const version = await createScriptVersion(
        parentId,
        currentSession.id,
        product.id,
        `Script`,
        content,
        editSource,
        editLabel
      )
      return version.id
    } catch (error) {
      console.error('Failed to save script version:', error)
      return null
    }
  }

  const handleEditScript = async (
    originalContent: string,
    instruction: string,
    editType?: 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness'
  ): Promise<string> => {
    let bizCtx: Record<string, unknown> | undefined
    let prodCtx: Record<string, unknown> | undefined
    if (product) {
      const ctxs = await getStructuredContexts(product)
      bizCtx = ctxs.bizCtx as Record<string, unknown> | undefined
      prodCtx = ctxs.prodCtx as Record<string, unknown> | undefined
    }
    return editScript(originalContent, instruction, language, bizCtx, prodCtx, editType)
  }

  const exportAsText = () => {
    const text = messages
      .map(m => `${m.role.toUpperCase()}:\n${m.content}\n`)
      .join('\n---\n\n')
    
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${product?.name}-scripts-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const labels = {
    es: {
      back: 'Volver',
      newSession: 'Nueva Sesión',
      sessions: 'Sesiones',
      noSessions: 'No hay sesiones aún',
      productInfo: 'Info del Producto',
      context: 'Contexto Adicional',
      contextPlaceholder: 'Añade contexto específico para esta sesión (ideas, enfoque del script, feedback...)',
      saveContext: 'Guardar Contexto',
      editProduct: 'Editar',
      save: 'Guardar',
      cancel: 'Cancelar',
      export: 'Exportar',
      placeholder: 'Escribe feedback o pide cambios al script...',
      generating: 'Generando...',
      startConversation: 'Genera tu primer script con el botón de abajo',
      generateScript: 'Generar Script',
      regenerate: 'Regenerar',
      saveScript: 'Guardar Script',
      scriptSaved: '¡Script guardado!',
      businessInfo: 'Información del Negocio',
      bizName: 'Nombre',
      bizSalesChannels: 'Canales de venta',
      bizLocation: 'Ubicación',
      bizShipping: 'Envíos',
      bizShippingMethod: 'Método de envío',
      bizTargetAudience: 'Audiencia objetivo',
      bizAge: 'Edad',
      bizSex: 'Sexo',
      bizGeo: 'Alcance geográfico',
      bizProfession: 'Profesión',
      channelPhysical: 'Local físico',
      channelMessages: 'Mensajes',
      channelWebsite: 'Sitio web',
      sexMale: 'Masculino',
      sexFemale: 'Femenino',
      sexBoth: 'Ambos',
      geoLocal: 'Local',
      geoCountry: 'Nacional',
      geoWorld: 'Internacional',
      productDescription: 'Beneficios / Descripción',
      currentAlternatives: 'Alternativas actuales',
      alternativesDisadvantages: 'Desventajas de alternativas',
      productCategory: 'Categoría',
      productVariations: 'Variaciones',
      technicalSpecs: 'Especificaciones técnicas',
      utility: 'Utilidad',
      result: 'Resultado',
      hasGuarantee: 'Garantía',
      priceRange: 'Rango de precio',
      stockLimited: 'Stock limitado',
      // Service labels
      svcServiceType: 'Tipo de servicio',
      svcProblem: 'Problema que resuelve',
      svcCurrentPain: 'Dolor actual',
      svcAlternativesTried: 'Alternativas intentadas',
      svcAlternativesFailures: 'Por qué fallan',
      svcConcreteResult: 'Resultado concreto',
      svcResultTimeline: 'Tiempo para resultados',
      svcLifeChange: 'Cambio de vida',
      svcProcessSteps: 'Proceso',
      svcServiceFormat: 'Formato',
      svcServiceDuration: 'Duración',
      svcDifferentiation: 'Diferenciación',
      svcMethodName: 'Método propio',
      svcMainObjection: 'Objeción principal',
      svcGuarantee: 'Garantía del servicio',
      // Indumentaria labels
      indArticleType: 'Tipo de artículo',
      indModelCount: 'Cantidad de modelos',
      indVariations: 'Variaciones',
      indSizes: 'Tallas',
      indMaterial: 'Material principal',
      indQuality: 'Calidad',
      indChanges: 'Acepta cambios',
      indCustomizable: 'Personalizable',
      // Legacy labels (for old products)
      mainProblem: 'Problema principal',
      bestCustomers: 'Mejores clientes',
      failedAttempts: 'Intentos fallidos',
      attentionGrabber: 'Lo que más llama la atención',
      realPain: 'Dolor real',
      painConsequences: 'Consecuencias del dolor',
      expectedResult: 'Resultado esperado',
      differentiation: 'Diferenciación',
      keyObjection: 'Objeción principal',
      shippingInfo: 'Información de envío',
      awarenessLevel: 'Nivel de conciencia',
      // Restaurant labels
      menuText: 'Menú',
      location: 'Ubicación',
      schedule: 'Horario',
      isNewRestaurant: '¿Es nuevo?',
      // Real estate labels
      reBusinessType: 'Tipo de negocio',
      rePrice: 'Precio',
      reLocation: 'Ubicación',
      reConstructionSize: 'Metros construcción',
      reBedrooms: 'Habitaciones',
      reCapacity: 'Capacidad',
      reBathrooms: 'Baños',
      reParking: 'Estacionamientos',
      reHighlights: 'Puntos destacados',
      reLocationReference: 'Referencia ubicación',
      reCta: 'Llamado a acción',
      scriptSettings: 'Configuración del Script',
      rateScript: 'Calificar',
      yes: 'Sí',
      no: 'No'
    },
    en: {
      back: 'Back',
      newSession: 'New Session',
      sessions: 'Sessions',
      noSessions: 'No sessions yet',
      productInfo: 'Product Info',
      context: 'Additional Context',
      contextPlaceholder: 'Add specific context for this session (ideas, script focus, feedback...)',
      saveContext: 'Save Context',
      editProduct: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      export: 'Export',
      placeholder: 'Write feedback or request changes to the script...',
      generating: 'Generating...',
      startConversation: 'Generate your first script with the button below',
      generateScript: 'Generate Script',
      regenerate: 'Regenerate',
      saveScript: 'Save Script',
      scriptSaved: 'Script saved!',
      businessInfo: 'Business Info',
      bizName: 'Name',
      bizSalesChannels: 'Sales Channels',
      bizLocation: 'Location',
      bizShipping: 'Shipping',
      bizShippingMethod: 'Shipping Method',
      bizTargetAudience: 'Target Audience',
      bizAge: 'Age',
      bizSex: 'Sex',
      bizGeo: 'Geographic Scope',
      bizProfession: 'Profession',
      channelPhysical: 'Physical store',
      channelMessages: 'Messages',
      channelWebsite: 'Website',
      sexMale: 'Male',
      sexFemale: 'Female',
      sexBoth: 'Both',
      geoLocal: 'Local',
      geoCountry: 'Country',
      geoWorld: 'International',
      productDescription: 'Benefits / Description',
      currentAlternatives: 'Current Alternatives',
      alternativesDisadvantages: 'Alternatives Disadvantages',
      productCategory: 'Category',
      productVariations: 'Variations',
      technicalSpecs: 'Technical Specs',
      utility: 'Utility',
      result: 'Result',
      hasGuarantee: 'Guarantee',
      priceRange: 'Price Range',
      stockLimited: 'Limited Stock',
      // Service labels
      svcServiceType: 'Service Type',
      svcProblem: 'Problem It Solves',
      svcCurrentPain: 'Current Pain',
      svcAlternativesTried: 'Alternatives Tried',
      svcAlternativesFailures: 'Why They Fail',
      svcConcreteResult: 'Concrete Result',
      svcResultTimeline: 'Time to Results',
      svcLifeChange: 'Life Change',
      svcProcessSteps: 'Process',
      svcServiceFormat: 'Format',
      svcServiceDuration: 'Duration',
      svcDifferentiation: 'Differentiation',
      svcMethodName: 'Own Method',
      svcMainObjection: 'Main Objection',
      svcGuarantee: 'Service Guarantee',
      // Indumentaria labels
      indArticleType: 'Article Type',
      indModelCount: 'Number of Models',
      indVariations: 'Variations',
      indSizes: 'Sizes',
      indMaterial: 'Main Material',
      indQuality: 'Quality',
      indChanges: 'Accepts Returns',
      indCustomizable: 'Customizable',
      // Legacy labels (for old products)
      mainProblem: 'Main Problem',
      bestCustomers: 'Best Customers',
      failedAttempts: 'Failed Attempts',
      attentionGrabber: 'What Grabs Attention',
      realPain: 'Real Pain',
      painConsequences: 'Pain Consequences',
      expectedResult: 'Expected Result',
      differentiation: 'Differentiation',
      keyObjection: 'Key Objection',
      shippingInfo: 'Shipping Info',
      awarenessLevel: 'Awareness Level',
      // Restaurant labels
      menuText: 'Menu',
      location: 'Location',
      schedule: 'Schedule',
      isNewRestaurant: 'Is new?',
      // Real estate labels
      reBusinessType: 'Business Type',
      rePrice: 'Price',
      reLocation: 'Location',
      reConstructionSize: 'Construction Size',
      reBedrooms: 'Bedrooms',
      reCapacity: 'Capacity',
      reBathrooms: 'Bathrooms',
      reParking: 'Parking',
      reHighlights: 'Highlights',
      reLocationReference: 'Location Reference',
      reCta: 'Call to Action',
      scriptSettings: 'Script Settings',
      rateScript: 'Rate',
      yes: 'Yes',
      no: 'No'
    }
  }

  const t = labels[language]

  if (initializing) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </Layout>
    )
  }

  if (!product) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <p>Product not found</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      {/* Maintenance Disclaimer */}
      <div className="bg-amber-900/30 border-b border-amber-700/30 px-4 py-2 text-center">
        <p className="text-xs text-amber-200">
          {language === 'es'
            ? '⚠️ Estamos realizando mejoras. Podrías experimentar cambios temporales. ¡Gracias por tu paciencia!'
            : '⚠️ We\'re making improvements. You may experience temporary changes. Thanks for your patience!'}
        </p>
      </div>
      <div className="flex h-[calc(100vh-64px)] lg:h-screen" style={{ height: 'calc(100dvh - 64px)' }}>
        {/* Left Panel — Script Config & Sessions */}
        <div className="hidden lg:flex w-[420px] bg-dark-100 border-r border-dark-100 flex-col min-h-0 overflow-hidden max-h-[100dvh]">
          {/* Header */}
          <div className="px-5 py-4 border-b border-dark-100">
            <Link 
              to="/scripts" 
              className="inline-flex items-center gap-1.5 text-dark-400 hover:text-dark-600 text-xs font-medium tracking-wide uppercase transition-colors mb-3"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {t.back}
            </Link>
            <h1 className="text-lg font-semibold text-dark-900 truncate">{product.name}</h1>
            <p className="text-xs text-dark-400 capitalize mt-0.5">{product.type}</p>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
            {/* Script Settings — no generate button here */}
            <ScriptSettingsPanel
              settings={scriptSettings}
              onChange={setScriptSettings}
              language={language}
              loading={loading}
            />

            {/* Brand Kit Selector */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2.5">
                Brand Kit
              </label>
              <BrandKitSelector
                selectedKitId={selectedBrandKitId}
                onSelect={setSelectedBrandKitId}
                productId={productId}
              />
            </div>

            {/* Active Sales Channel */}
            {product?.business?.sales_channels && product.business.sales_channels.length > 0 && (
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                  {language === 'es' ? 'Canal de Venta' : 'Sales Channel'}
                </label>
                <div className={`grid gap-1.5 bg-dark-200/50 p-1 rounded-xl ${
                  product.business.sales_channels.length === 1 ? 'grid-cols-1' :
                  product.business.sales_channels.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
                }`}>
                  {product.business.sales_channels.map(channel => {
                    const channelConfig = {
                      physical: { label: language === 'es' ? 'Local Físico' : 'Physical Store', icon: <MapPin className="w-3.5 h-3.5" /> },
                      messages: { label: language === 'es' ? 'Mensajes' : 'Messages', icon: <MessageSquare className="w-3.5 h-3.5" /> },
                      website: { label: language === 'es' ? 'Página Web' : 'Website', icon: <Globe className="w-3.5 h-3.5" /> },
                    }
                    const cfg = channelConfig[channel]
                    if (!cfg) return null
                    return (
                      <button
                        key={channel}
                        onClick={() => setActiveSalesChannel(channel)}
                        className={`py-2 px-2 rounded-lg text-xs font-medium transition-all duration-200 flex flex-col items-center gap-1 ${
                          activeSalesChannel === channel
                            ? 'bg-dark-100 text-dark-900 shadow-sm border border-dark-200'
                            : 'text-dark-500 hover:text-dark-700 border border-transparent'
                        }`}
                      >
                        {cfg.icon}
                        <span className="text-[10px] leading-tight text-center">{cfg.label}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-dark-400 mt-1.5 text-center">
                  {activeSalesChannel === 'physical'
                    ? (language === 'es' ? 'CTA: Visita al local' : 'CTA: Visit store')
                    : activeSalesChannel === 'messages'
                      ? (language === 'es' ? 'CTA: Enviar mensaje' : 'CTA: Send message')
                      : activeSalesChannel === 'website'
                        ? (language === 'es' ? 'CTA: Click en anuncio' : 'CTA: Click ad')
                        : (language === 'es' ? 'Selecciona un canal' : 'Select a channel')}
                </p>
              </div>
            )}

            {/* Chat Input — Apple-like pill */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2.5">
                <Send className="w-3.5 h-3.5 text-primary-500" />
                {language === 'es' ? 'Instrucciones' : 'Instructions'}
              </label>
              <div className="bg-dark-50 border border-dark-200 rounded-2xl p-1.5 input-glow transition-all">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isRecording
                    ? (language === 'es' ? 'Grabando...' : 'Recording...')
                    : isTranscribing
                      ? (language === 'es' ? 'Transcribiendo...' : 'Transcribing...')
                      : (language === 'es' ? 'Describe lo que necesitas...' : 'Describe what you need...')}
                  className="w-full px-3 py-2 text-sm bg-transparent resize-none min-h-[60px] max-h-28 focus:outline-none text-dark-800 placeholder:text-dark-400"
                  rows={2}
                  disabled={loading || isTranscribing}
                />
                <div className="flex items-center justify-between px-1.5 pb-0.5">
                  <button
                    onClick={handleVoiceToggle}
                    disabled={loading || isTranscribing}
                    className={`h-8 w-8 flex items-center justify-center rounded-full transition-all duration-200 ${
                      isRecording
                        ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse'
                        : isTranscribing
                          ? 'bg-dark-200 text-dark-400'
                          : 'text-dark-400 hover:text-dark-600 hover:bg-dark-200'
                    }`}
                    title={isRecording
                      ? (language === 'es' ? 'Detener' : 'Stop')
                      : (language === 'es' ? 'Grabar audio' : 'Record audio')}
                  >
                    {isTranscribing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isRecording ? (
                      <Square className="w-3 h-3 fill-current" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || loading}
                    className="h-8 w-8 flex items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Generate Scripts Button */}
            <button
              onClick={handleGenerateScript}
              disabled={loading || (scriptSettings.generationMode === 'by_type' && Object.values(scriptSettings.scriptTypeConfig).reduce((s, n) => s + n, 0) === 0)}
              className="w-full py-3.5 flex items-center justify-center gap-2 text-base font-medium btn-glow rounded-xl"
            >
              <Sparkles className={`w-5 h-5 ${loading ? 'animate-pulse' : ''}`} />
              {language === 'es' ? 'Generar Guiones' : 'Generate Scripts'}
            </button>

            {/* Sessions */}
            <div className="pt-2 border-t border-dark-200/60">
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase">
                  <MessageSquare className="w-3.5 h-3.5 text-dark-400" />
                  {t.sessions}
                </label>
                <button 
                  onClick={handleNewSession}
                  className="flex items-center gap-1 text-xs font-medium text-primary-500 hover:text-primary-400 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t.newSession}
                </button>
              </div>
              {sessions.length === 0 ? (
                <p className="text-sm text-dark-400 py-2">{t.noSessions}</p>
              ) : (
                <div className="space-y-0.5">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`group relative rounded-lg transition-all duration-150 ${
                        currentSession?.id === session.id
                          ? 'bg-dark-200/60 border border-dark-200'
                          : 'hover:bg-dark-50 border border-transparent'
                      }`}
                    >
                      {renamingSessionId === session.id ? (
                        <div className="p-2">
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameSession(session.id)
                              if (e.key === 'Escape') setRenamingSessionId(null)
                            }}
                            onBlur={() => handleRenameSession(session.id)}
                            className="w-full px-2 py-1 text-sm border border-primary-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 bg-dark-100"
                            autoFocus
                          />
                        </div>
                      ) : (
                        <div
                          onClick={() => navigate(`/product/${productId}/session/${session.id}`)}
                          onDoubleClick={() => {
                            setRenamingSessionId(session.id)
                            setRenameValue(session.title)
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg cursor-pointer"
                          role="button"
                          tabIndex={0}
                        >
                          <div className="flex items-center gap-2">
                            <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${
                              currentSession?.id === session.id ? 'text-dark-700' : 'text-dark-400'
                            }`} />
                            <span className={`truncate text-sm ${
                              currentSession?.id === session.id ? 'font-medium text-dark-800' : 'text-dark-600'
                            }`}>{session.title}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setRenamingSessionId(session.id)
                                setRenameValue(session.title)
                              }}
                              className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 rounded text-dark-400 hover:text-dark-600 transition-opacity"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-[11px] text-dark-400 mt-0.5 pl-5.5">
                            {new Date(session.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Memory Panel */}
            <div className="pt-2 border-t border-dark-200/60">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setShowMemoryPanel(!showMemoryPanel)}
                  className="flex items-center gap-1.5 cursor-pointer"
                >
                  <Brain className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-xs font-semibold text-dark-600 tracking-wide uppercase">
                    {language === 'es' ? 'Memoria IA' : 'AI Memory'}
                  </span>
                  <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                    Experimental
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-dark-400 transition-transform ${showMemoryPanel ? '' : '-rotate-90'}`} />
                </button>
                <button
                  onClick={() => {
                    const next = !aiMemoryEnabled
                    setAiMemoryEnabled(next)
                    localStorage.setItem('ai_memory_enabled', String(next))
                  }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${aiMemoryEnabled ? 'bg-purple-600' : 'bg-dark-300'}`}
                  title={aiMemoryEnabled
                    ? (language === 'es' ? 'Memoria activa — click para desactivar' : 'Memory active — click to disable')
                    : (language === 'es' ? 'Memoria inactiva — click para activar' : 'Memory inactive — click to enable')}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${aiMemoryEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </button>
              </div>

              {showMemoryPanel && (
                <div className="space-y-3">
                  {/* Global Style */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-dark-500 uppercase tracking-wide">
                        {language === 'es' ? 'Estilo Global' : 'Global Style'}
                      </span>
                      {!editingGlobalMemory ? (
                        <button
                          onClick={() => {
                            setGlobalMemoryDraft(globalMemory?.style_summary || '')
                            setEditingGlobalMemory(true)
                          }}
                          className="p-0.5 rounded text-dark-400 hover:text-dark-600 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={handleSaveGlobalMemory}
                            disabled={savingMemory}
                            className="p-0.5 rounded text-green-500 hover:text-green-600 transition-colors"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setEditingGlobalMemory(false)}
                            className="p-0.5 rounded text-dark-400 hover:text-dark-600 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    {editingGlobalMemory ? (
                      <textarea
                        value={globalMemoryDraft}
                        onChange={(e) => setGlobalMemoryDraft(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs bg-dark-50 border border-dark-200 rounded-lg text-dark-700 resize-none focus:outline-none focus:ring-1 focus:ring-purple-500 min-h-[80px]"
                        placeholder={language === 'es' ? 'Escribe instrucciones de estilo para la IA...' : 'Write style instructions for the AI...'}
                      />
                    ) : (
                      <p className="text-xs text-dark-500 bg-dark-50/50 rounded-lg px-2.5 py-2 min-h-[32px]">
                        {globalMemory?.style_summary || (language === 'es' ? 'Guarda guiones para que la IA aprenda tu estilo' : 'Save scripts so the AI learns your style')}
                      </p>
                    )}
                  </div>

                  {/* Product Style */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-dark-500 uppercase tracking-wide">
                        {language === 'es' ? 'Este Producto' : 'This Product'}
                      </span>
                      {!editingProductMemory ? (
                        <button
                          onClick={() => {
                            setProductMemoryDraft(productMemory?.style_summary || '')
                            setEditingProductMemory(true)
                          }}
                          className="p-0.5 rounded text-dark-400 hover:text-dark-600 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={handleSaveProductMemory}
                            disabled={savingMemory}
                            className="p-0.5 rounded text-green-500 hover:text-green-600 transition-colors"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setEditingProductMemory(false)}
                            className="p-0.5 rounded text-dark-400 hover:text-dark-600 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    {editingProductMemory ? (
                      <textarea
                        value={productMemoryDraft}
                        onChange={(e) => setProductMemoryDraft(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs bg-dark-50 border border-dark-200 rounded-lg text-dark-700 resize-none focus:outline-none focus:ring-1 focus:ring-purple-500 min-h-[80px]"
                        placeholder={language === 'es' ? 'Instrucciones específicas para este producto...' : 'Product-specific instructions...'}
                      />
                    ) : (
                      <p className="text-xs text-dark-500 bg-dark-50/50 rounded-lg px-2.5 py-2 min-h-[32px]">
                        {productMemory?.style_summary || (language === 'es' ? 'La IA aprenderá las preferencias de este producto' : 'AI will learn preferences for this product')}
                      </p>
                    )}
                  </div>

                  {/* AI Synthesis → Prompt Injection Preview */}
                  {(globalMemory?.style_summary || productMemory?.style_summary) && (
                    <div className="border border-purple-500/20 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setShowSynthesisPreview(!showSynthesisPreview)}
                        className="flex items-center justify-between w-full px-2.5 py-1.5 bg-purple-900/10 hover:bg-purple-900/20 transition-colors"
                      >
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-purple-400 uppercase tracking-wide">
                          <Sparkles className="w-3 h-3" />
                          {language === 'es' ? 'Síntesis → Inyección al Prompt' : 'Synthesis → Prompt Injection'}
                        </span>
                        <ChevronDown className={`w-3 h-3 text-purple-400 transition-transform ${showSynthesisPreview ? '' : '-rotate-90'}`} />
                      </button>
                      {showSynthesisPreview && (
                        <div className="px-2.5 py-2 space-y-2">
                          <p className="text-[10px] text-dark-400 italic">
                            {language === 'es'
                              ? 'Este es el texto exacto que se inyecta en cada generación de guión:'
                              : 'This is the exact text injected into every script generation:'}
                          </p>
                          <div className="bg-dark-50 border border-dark-200/60 rounded-lg p-2 font-mono text-[10px] text-dark-500 leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                            {(() => {
                              const isEs = language === 'es'
                              const header = isEs
                                ? '═══════════════════════════════════\nMEMORIA DE ESTILO — PREFERENCIAS DEL USUARIO (APRENDIDO)\n═══════════════════════════════════\nEl siguiente perfil de estilo fue extraído del comportamiento real del usuario. APLICA estas preferencias manteniendo las reglas estructurales del sistema.'
                                : '═══════════════════════════════════\nSTYLE MEMORY — USER PREFERENCES (LEARNED)\n═══════════════════════════════════\nThe following style profile was extracted from the user\'s actual behavior. APPLY these preferences while maintaining the system\'s structural rules.'
                              const parts = [header]
                              if (globalMemory?.style_summary) {
                                parts.push(`\n${isEs ? 'ESTILO GLOBAL' : 'GLOBAL STYLE'}:\n${globalMemory.style_summary}`)
                              }
                              if (productMemory?.style_summary) {
                                parts.push(`\n${isEs ? 'ESTILO PARA ESTE PRODUCTO' : 'STYLE FOR THIS PRODUCT'}:\n${productMemory.style_summary}`)
                              }
                              parts.push('\n═══════════════════════════════════')
                              return parts.join('')
                            })()}
                          </div>
                          {productMemory?.last_synthesized_at && (
                            <p className="text-[9px] text-dark-400">
                              {language === 'es' ? 'Última síntesis:' : 'Last synthesis:'}{' '}
                              {new Date(productMemory.last_synthesized_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Collected Memory Data */}
                  {(productMemory || globalMemory) && (
                    <div className="space-y-2">
                      {/* Hooks collected */}
                      {(productMemory?.sample_hooks?.length ?? 0) > 0 && (
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <Anchor className="w-3 h-3 text-blue-400" />
                            <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide">
                              {language === 'es' ? 'Ganchos guardados' : 'Saved Hooks'} ({productMemory!.sample_hooks.length})
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {productMemory!.sample_hooks.map((hook, i) => (
                              <p key={i} className="text-[10px] text-dark-400 bg-dark-200/40 rounded px-2 py-1 truncate" title={hook}>
                                {hook}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* CTAs collected */}
                      {(productMemory?.sample_ctas?.length ?? 0) > 0 && (
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <Target className="w-3 h-3 text-green-400" />
                            <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide">
                              CTAs ({productMemory!.sample_ctas.length})
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {productMemory!.sample_ctas.map((cta, i) => (
                              <p key={i} className="text-[10px] text-dark-400 bg-dark-200/40 rounded px-2 py-1 truncate" title={cta}>
                                {cta}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Scripts collected */}
                      {(productMemory?.sample_scripts?.length ?? 0) > 0 && (
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <ScrollText className="w-3 h-3 text-amber-400" />
                            <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide">
                              {language === 'es' ? 'Guiones' : 'Scripts'} ({productMemory!.sample_scripts.length})
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {productMemory!.sample_scripts.map((s, i) => (
                              <p key={i} className="text-[10px] text-dark-400 bg-dark-200/40 rounded px-2 py-1 line-clamp-2" title={s.substring(0, 300)}>
                                {s.substring(0, 120)}{s.length > 120 ? '…' : ''}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Edit instructions */}
                      {(productMemory?.edit_instructions?.length ?? 0) > 0 && (
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <MessageCircle className="w-3 h-3 text-purple-400" />
                            <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide">
                              {language === 'es' ? 'Instrucciones' : 'Instructions'} ({productMemory!.edit_instructions.length})
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {productMemory!.edit_instructions.map((inst, i) => (
                              <p key={i} className="text-[10px] text-dark-400 bg-dark-200/40 rounded px-2 py-1 truncate" title={inst}>
                                {inst}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Anti-patterns (things user rejects) */}
                      {(productMemory?.avoid_patterns?.length ?? 0) > 0 && (
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <X className="w-3 h-3 text-red-400" />
                            <span className="text-[10px] font-semibold text-red-400/80 uppercase tracking-wide">
                              {language === 'es' ? 'Anti-patrones' : 'Anti-patterns'} ({productMemory!.avoid_patterns.length})
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {productMemory!.avoid_patterns.map((ap, i) => (
                              <p key={i} className="text-[10px] text-red-400/70 bg-red-900/10 rounded px-2 py-1 truncate" title={ap}>
                                ❌ {ap.substring(0, 100)}{ap.length > 100 ? '…' : ''}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Edit transformations (before → after) */}
                      {(productMemory?.edit_transformations?.length ?? 0) > 0 && (
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <RefreshCw className="w-3 h-3 text-cyan-400" />
                            <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide">
                              {language === 'es' ? 'Correcciones' : 'Corrections'} ({productMemory!.edit_transformations.length})
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {productMemory!.edit_transformations.map((t, i) => {
                              try {
                                const parsed = JSON.parse(t)
                                return (
                                  <div key={i} className="text-[10px] bg-dark-200/40 rounded px-2 py-1">
                                    <span className="text-red-400/70 line-through">{parsed.before?.substring(0, 60)}</span>
                                    <span className="text-dark-400 mx-1">→</span>
                                    <span className="text-green-400/70">{parsed.after?.substring(0, 60)}</span>
                                  </div>
                                )
                              } catch { return null }
                            })}
                          </div>
                        </div>
                      )}

                      {/* Signal counters summary */}
                      {productMemory?.signals && Object.keys(productMemory.signals).length > 0 && (
                        <div>
                          <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide">
                            {language === 'es' ? 'Señales' : 'Signals'}
                          </span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(productMemory.signals).map(([key, val]) => (
                              <span key={key} className="text-[10px] bg-dark-200/60 text-dark-500 px-1.5 py-0.5 rounded-full">
                                {key.replace(/_/g, ' ')}: {val as number}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Synthesis status */}
                      {productMemory?.signals_since_last_synthesis != null && productMemory.signals_since_last_synthesis > 0 && (
                        <p className="text-[10px] text-dark-400 italic">
                          {language === 'es'
                            ? `${productMemory.signals_since_last_synthesis} señales nuevas desde última síntesis`
                            : `${productMemory.signals_since_last_synthesis} new signals since last synthesis`}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Typed Memories (from hybrid system) */}
                  {recentMemories.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <Sparkles className="w-3 h-3 text-violet-400" />
                        <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide">
                          {language === 'es' ? 'Memorias Aprendidas' : 'Learned Memories'} ({recentMemories.length})
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {recentMemories.map((mem) => {
                          const typeIcon = mem.memory_type === 'anti_pattern' ? '🚫'
                            : mem.memory_type === 'rule' ? '📏'
                            : mem.memory_type === 'example' ? '✨'
                            : mem.memory_type === 'visual_style' ? '🎨'
                            : mem.memory_type === 'fact' ? '📌'
                            : '💡'
                          const bgClass = mem.memory_type === 'anti_pattern' ? 'bg-red-900/10 text-red-400/70' : 'bg-dark-200/40 text-dark-400'
                          return (
                            <p key={mem.id} className={`text-[10px] ${bgClass} rounded px-2 py-1 truncate`} title={mem.content}>
                              {typeIcon} {mem.content.substring(0, 100)}{mem.content.length > 100 ? '…' : ''}
                            </p>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowTeachModal(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
                    >
                      <Brain className="w-3 h-3" />
                      {language === 'es' ? 'Enseñar' : 'Teach Me'}
                    </button>
                    <button
                      onClick={handleRelearn}
                      disabled={synthesisingMemory}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${synthesisingMemory ? 'animate-spin' : ''}`} />
                      {synthesisingMemory
                        ? (language === 'es' ? 'Aprendiendo...' : 'Learning...')
                        : (language === 'es' ? 'Re-aprender' : 'Re-learn')}
                    </button>
                    <button
                      onClick={handleResetMemory}
                      className="flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-dark-400 hover:text-red-500 bg-dark-50 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      {language === 'es' ? 'Reset' : 'Reset'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col bg-dark-50/50">
          {/* Header */}
          <div className="glass-panel px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setShowMobileConfig(!showMobileConfig)}
                className={`lg:hidden p-2 rounded-md transition-colors ${
                  showMobileConfig ? 'bg-primary-900/20 text-primary-500' : 'hover:bg-dark-50 text-dark-400'
                }`}
              >
                <Sparkles className="w-4 h-4" />
              </button>
              <h1 className="text-sm font-semibold text-dark-800 truncate">
                {currentSession?.title || product.name}
              </h1>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={exportAsText} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-dark-500 hover:text-dark-700 hover:bg-dark-50 rounded-md transition-colors">
                  <Download className="w-3.5 h-3.5" />
                  {t.export}
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={handlePreviewPrompt}
                  disabled={loadingPreview}
                  className={`p-2 rounded-md transition-colors ${
                    previewSystemPrompt ? 'bg-amber-900/20 text-amber-400' : 'hover:bg-dark-50 text-dark-400'
                  }`}
                  title={language === 'es' ? 'Vista previa del prompt' : 'Preview prompt'}
                >
                  {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
              <button 
                onClick={() => setShowProductInfo(!showProductInfo)}
                className={`p-2 rounded-md transition-colors ${
                  showProductInfo ? 'bg-primary-900/20 text-primary-600' : 'hover:bg-dark-50 text-dark-400'
                }`}
              >
                <Info className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mobile Config Panel */}
          {showMobileConfig && (
            <div className="lg:hidden border-b border-dark-100 bg-dark-100 px-5 py-4 max-h-[60vh] overflow-y-auto space-y-4">
              <ScriptSettingsPanel
                settings={scriptSettings}
                onChange={setScriptSettings}
                language={language}
                onGenerate={() => { setShowMobileConfig(false); handleGenerateScript() }}
                loading={loading}
              />
            </div>
          )}

          {/* Preview: Full System Prompt (admin only) */}
          {isAdmin && previewSystemPrompt && (
            <div className="border-b border-amber-700/30 bg-amber-900/20 px-6 py-3 max-h-[50vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-mono font-bold text-amber-800">
                  {language === 'es' ? 'VISTA PREVIA DEL PROMPT' : 'PROMPT PREVIEW'} ({previewSystemPrompt.length.toLocaleString()} chars / ~{Math.ceil(previewSystemPrompt.length / 4).toLocaleString()} tokens)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(previewSystemPrompt)}
                    className="text-[10px] px-2 py-1 bg-amber-200 hover:bg-amber-300 text-amber-800 rounded font-mono transition-colors"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => setPreviewSystemPrompt(null)}
                    className="text-[10px] px-2 py-1 bg-amber-200 hover:bg-amber-300 text-amber-800 rounded font-mono transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <pre className="text-[11px] text-dark-700 whitespace-pre-wrap break-words font-mono bg-dark-100 p-3 rounded-lg border border-amber-200 leading-relaxed">
                {previewSystemPrompt}
              </pre>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-8 space-y-5">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-sm empty-ambient-bg rounded-3xl px-10 py-12 animate-entrance">
                  <div className="relative w-16 h-16 mx-auto mb-5">
                    <div className="w-16 h-16 rounded-2xl bg-primary-900/30 flex items-center justify-center border border-primary-800/30">
                      <Sparkles className="w-8 h-8 text-primary-400 gen-placeholder-icon" />
                    </div>
                    <div className="absolute -inset-2 rounded-3xl border border-primary-700/20 gen-placeholder-ring" />
                  </div>
                  <p className="text-dark-300 text-sm font-medium mb-2">{t.startConversation}</p>
                  <p className="text-dark-500 text-xs leading-relaxed">
                    {language === 'es' ? 'Configura las opciones a la izquierda y presiona "Generar Guiones"' : 'Configure options on the left and press "Generate Scripts"'}
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => {
                const hasScripts = message.role === 'assistant' && isScriptContent(message.content)
                const parsedScripts = hasScripts ? parseScripts(message.content) : []
                const showAsCards = parsedScripts.length >= 1 && hasScripts

                return (
                  <div key={message.id}>
                    {message.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="max-w-3xl px-5 py-4 bg-gradient-to-br from-primary-600 to-primary-500 text-white rounded-2xl rounded-br-md shadow-lg shadow-primary-900/20">
                          <div className="whitespace-pre-wrap text-sm leading-relaxed">
                            {message.content}
                          </div>
                        </div>
                      </div>
                    ) : showAsCards ? (
                      /* Script cards — each script rendered individually */
                      <div className="space-y-3 max-w-3xl">
                        {parsedScripts.map((script) => (
                          <ScriptCard
                            key={`${message.id}-script-${script.index}`}
                            script={script}
                            language={language}
                            onSave={handleSaveIndividualScript}
                            onEdit={handleEditScript}
                            onSaveVersion={handleSaveVersion}
                            savingScript={savingScript}
                            productType={product?.type}
                            productId={productId}
                            sessionId={currentSession?.id}
                            messageId={message.id}
                            scriptIndex={script.index}
                          />
                        ))}
                        {/* Prompt toggle for script messages */}
                        {message.system_prompt && (
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => setExpandedPrompts(prev => ({ ...prev, [message.id]: !prev[message.id] }))}
                              className={`text-xs flex items-center gap-1 transition-colors ${
                                expandedPrompts[message.id]
                                  ? 'text-amber-600'
                                  : 'text-dark-400 hover:text-amber-600'
                              }`}
                              title="View master prompt used for this generation"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Prompt
                            </button>
                          </div>
                        )}
                        {message.system_prompt && expandedPrompts[message.id] && (
                          <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[10px] font-mono font-bold text-amber-400">
                                MASTER PROMPT ({message.system_prompt.length.toLocaleString()} chars / ~{Math.ceil(message.system_prompt.length / 4).toLocaleString()} tokens)
                              </p>
                              <button
                                onClick={() => navigator.clipboard.writeText(message.system_prompt!)}
                                className="text-[10px] px-2 py-0.5 bg-amber-200 hover:bg-amber-300 text-amber-800 rounded font-mono transition-colors"
                              >
                                Copy
                              </button>
                            </div>
                            <pre className="text-[10px] text-dark-700 whitespace-pre-wrap break-words font-mono bg-dark-100 p-2 rounded border border-amber-200 leading-relaxed max-h-[40vh] overflow-y-auto">
                              {message.system_prompt}
                            </pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Non-script assistant message (conversational) */
                      <div className="flex justify-start">
                        <div className="max-w-3xl px-5 py-4 bg-dark-100 border border-dark-200/60 text-dark-800 rounded-2xl rounded-bl-md shadow-sm chat-ai-border">
                          <div className="whitespace-pre-wrap text-sm leading-relaxed">
                            {message.content}
                          </div>
                          {message.system_prompt && (
                            <div className="mt-3 pt-3 border-t border-dark-100/60 flex items-center gap-2">
                              <button
                                onClick={() => setExpandedPrompts(prev => ({ ...prev, [message.id]: !prev[message.id] }))}
                                className={`text-xs flex items-center gap-1 transition-colors ${
                                  expandedPrompts[message.id]
                                    ? 'text-amber-600'
                                    : 'text-dark-400 hover:text-amber-600'
                                }`}
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Prompt
                              </button>
                            </div>
                          )}
                          {message.system_prompt && expandedPrompts[message.id] && (
                            <div className="mt-3 bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[10px] font-mono font-bold text-amber-400">
                                  MASTER PROMPT ({message.system_prompt.length.toLocaleString()} chars / ~{Math.ceil(message.system_prompt.length / 4).toLocaleString()} tokens)
                                </p>
                                <button
                                  onClick={() => navigator.clipboard.writeText(message.system_prompt!)}
                                  className="text-[10px] px-2 py-0.5 bg-amber-200 hover:bg-amber-300 text-amber-800 rounded font-mono transition-colors"
                                >
                                  Copy
                                </button>
                              </div>
                              <pre className="text-[10px] text-dark-700 whitespace-pre-wrap break-words font-mono bg-dark-100 p-2 rounded border border-amber-200 leading-relaxed max-h-[40vh] overflow-y-auto">
                                {message.system_prompt}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
            {loading && (
              <div className="flex justify-start">
                <ThinkingAnimation language={language} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Usage Banner */}
          <UsageBanner usage={usageLimits} resource="script" />
        </div>

        {/* Right Sidebar - Business Info, Product Info & Context */}
        {showProductInfo && (
          <div className="w-80 bg-dark-100/90 backdrop-blur-lg border-l border-white/[0.04] flex flex-col overflow-y-auto">
            {/* Business Info */}
            {product?.business && (
              <div className="p-4 border-b border-dark-100">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-4 h-4 text-primary-500" />
                  <h3 className="font-semibold text-dark-900">{t.businessInfo}</h3>
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-dark-400">{t.bizName}</p>
                    <p className="text-dark-700">{product.business.name}</p>
                  </div>
                  {product.business.sales_channels?.length > 0 && (
                    <div>
                      <p className="text-xs text-dark-400">{t.bizSalesChannels}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {product.business.sales_channels.map((ch: string) => (
                          <span key={ch} className="px-2 py-0.5 bg-dark-200 rounded text-xs text-dark-600">
                            {ch === 'physical' ? t.channelPhysical : ch === 'messages' ? t.channelMessages : t.channelWebsite}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {product.business.location && (
                    <div>
                      <p className="text-xs text-dark-400">{t.bizLocation}</p>
                      <p className="text-dark-700">{product.business.location}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-dark-400">{t.bizShipping}</p>
                    <p className="text-dark-700">{product.business.does_shipping ? (product.business.shipping_method || (language === 'es' ? 'Sí' : 'Yes')) : (language === 'es' ? 'No' : 'No')}</p>
                  </div>
                  {product.business.target_audiences && product.business.target_audiences.length > 0 && (
                    <div>
                      <p className="text-xs text-dark-400 mb-1">{t.bizTargetAudience}</p>
                      {product.business.target_audiences.map((ta: { id: string; sex: string; age_min: number; age_max: number; geographic_scope: string; geographic_scope_custom?: string; has_specific_profession: boolean; profession_description?: string }, idx: number) => (
                        <div key={ta.id} className="pl-2 border-l-2 border-primary-300 mb-2 space-y-1">
                          {product.business!.target_audiences!.length > 1 && (
                            <p className="text-xs font-medium text-dark-500">#{idx + 1}</p>
                          )}
                          <p className="text-xs text-dark-600">
                            <span className="text-dark-400">{t.bizSex}:</span> {ta.sex === 'male' ? t.sexMale : ta.sex === 'female' ? t.sexFemale : t.sexBoth}
                          </p>
                          <p className="text-xs text-dark-600">
                            <span className="text-dark-400">{t.bizAge}:</span> {ta.age_min} - {ta.age_max}
                          </p>
                          <p className="text-xs text-dark-600">
                            <span className="text-dark-400">{t.bizGeo}:</span> {ta.geographic_scope === 'local' ? t.geoLocal : ta.geographic_scope === 'country' ? t.geoCountry : ta.geographic_scope === 'world' ? t.geoWorld : ta.geographic_scope_custom || ta.geographic_scope}
                          </p>
                          {ta.has_specific_profession && ta.profession_description && (
                            <p className="text-xs text-dark-600">
                              <span className="text-dark-400">{t.bizProfession}:</span> {ta.profession_description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Product Info */}
            <div className="p-4 border-b border-dark-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-dark-900">{t.productInfo}</h3>
                {!editingProduct ? (
                  <button
                    onClick={() => setEditingProduct(true)}
                    className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-1"
                  >
                    <Edit3 className="w-4 h-4" />
                    {t.editProduct}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingProduct(false)
                        setEditedProduct(product || {})
                      }}
                      className="text-dark-400 hover:text-dark-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleSaveProduct}
                      className="text-primary-600 hover:text-primary-700"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-3 text-sm">
                {editingProduct ? (
                  <>
                    {/* Product edit fields */}
                    {product.type === 'product' && (
                      <>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.productDescription}</label>
                          <textarea value={editedProduct.product_description || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, product_description: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.currentAlternatives}</label>
                          <textarea value={editedProduct.current_alternatives || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, current_alternatives: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.alternativesDisadvantages}</label>
                          <textarea value={editedProduct.alternatives_disadvantages || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, alternatives_disadvantages: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.technicalSpecs}</label>
                          <textarea value={editedProduct.technical_specs || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, technical_specs: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.utility}</label>
                          <textarea value={editedProduct.utility || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, utility: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.result}</label>
                          <textarea value={editedProduct.result || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, result: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.hasGuarantee}</label>
                          <textarea value={editedProduct.guarantee_details || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, guarantee_details: e.target.value }))} className="input-field text-sm min-h-[40px]" placeholder={language === 'es' ? 'Detalles de garantía (dejar vacío si no hay)' : 'Guarantee details (leave empty if none)'} />
                        </div>
                      </>
                    )}
                    {/* Service edit fields */}
                    {product.type === 'service' && (
                      <>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.svcProblem}</label>
                          <textarea value={editedProduct.svc_problem || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, svc_problem: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.svcCurrentPain}</label>
                          <textarea value={editedProduct.svc_current_pain || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, svc_current_pain: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.svcConcreteResult}</label>
                          <textarea value={editedProduct.svc_concrete_result || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, svc_concrete_result: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.svcProcessSteps}</label>
                          <textarea value={editedProduct.svc_process_steps || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, svc_process_steps: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.svcDifferentiation}</label>
                          <textarea value={editedProduct.svc_differentiation || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, svc_differentiation: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.svcMainObjection}</label>
                          <textarea value={editedProduct.svc_main_objection || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, svc_main_objection: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.svcGuarantee}</label>
                          <textarea value={editedProduct.svc_guarantee_details || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, svc_guarantee_details: e.target.value }))} className="input-field text-sm min-h-[40px]" placeholder={language === 'es' ? 'Detalles de garantía (dejar vacío si no hay)' : 'Guarantee details (leave empty if none)'} />
                        </div>
                      </>
                    )}
                    {/* Indumentaria edit fields */}
                    {product.type === 'indumentaria' && (
                      <>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.productDescription}</label>
                          <textarea value={editedProduct.product_description || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, product_description: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.indVariations}</label>
                          <textarea value={editedProduct.ind_variations_description || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, ind_variations_description: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.indMaterial}</label>
                          <input type="text" value={editedProduct.ind_main_material || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, ind_main_material: e.target.value }))} className="input-field text-sm" />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.indQuality}</label>
                          <textarea value={editedProduct.ind_quality_description || ''} onChange={(e) => setEditedProduct(prev => ({ ...prev, ind_quality_description: e.target.value }))} className="input-field text-sm min-h-[60px]" />
                        </div>
                      </>
                    )}
                    {/* Restaurant edit fields */}
                    {product.type === 'restaurant' && (
                      <>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.menuText}</label>
                          <textarea
                            value={editedProduct.menu_text || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, menu_text: e.target.value }))}
                            className="input-field text-sm min-h-[100px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.location}</label>
                          <input
                            type="text"
                            value={editedProduct.location || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, location: e.target.value }))}
                            className="input-field text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.schedule}</label>
                          <input
                            type="text"
                            value={editedProduct.schedule || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, schedule: e.target.value }))}
                            className="input-field text-sm"
                          />
                        </div>
                      </>
                    )}
                    {/* Real estate edit fields */}
                    {product.type === 'real_estate' && (
                      <>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.reBusinessType}</label>
                          <select
                            value={editedProduct.re_business_type || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, re_business_type: e.target.value as 'sale' | 'rent' | 'airbnb' }))}
                            className="input-field text-sm"
                          >
                            <option value="sale">{language === 'es' ? 'Venta' : 'Sale'}</option>
                            <option value="rent">{language === 'es' ? 'Alquiler' : 'Rent'}</option>
                            <option value="airbnb">Airbnb</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.rePrice}</label>
                          <input
                            type="text"
                            value={editedProduct.re_price || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, re_price: e.target.value }))}
                            className="input-field text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.reLocation}</label>
                          <input
                            type="text"
                            value={editedProduct.re_location || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, re_location: e.target.value }))}
                            className="input-field text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.reHighlights}</label>
                          <textarea
                            value={editedProduct.re_highlights || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, re_highlights: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.reCta}</label>
                          <input
                            type="text"
                            value={editedProduct.re_cta || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, re_cta: e.target.value }))}
                            className="input-field text-sm"
                          />
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {/* New product fields */}
                    {product.type === 'product' && (
                      <>
                        {product.product_category && <div><p className="text-xs text-dark-400">{t.productCategory}</p><p className="text-dark-700">{product.product_category}</p></div>}
                        {product.product_description && <div><p className="text-xs text-dark-400">{t.productDescription}</p><p className="text-dark-700">{product.product_description}</p></div>}
                        {product.current_alternatives && <div><p className="text-xs text-dark-400">{t.currentAlternatives}</p><p className="text-dark-700">{product.current_alternatives}</p></div>}
                        {product.alternatives_disadvantages && <div><p className="text-xs text-dark-400">{t.alternativesDisadvantages}</p><p className="text-dark-700">{product.alternatives_disadvantages}</p></div>}
                        {product.product_variations && product.product_variations.length > 0 && <div><p className="text-xs text-dark-400">{t.productVariations}</p><p className="text-dark-700">{product.product_variations.join(', ')}</p></div>}
                        {product.technical_specs && <div><p className="text-xs text-dark-400">{t.technicalSpecs}</p><p className="text-dark-700">{product.technical_specs}</p></div>}
                        {product.utility && <div><p className="text-xs text-dark-400">{t.utility}</p><p className="text-dark-700">{product.utility}</p></div>}
                        {product.result && <div><p className="text-xs text-dark-400">{t.result}</p><p className="text-dark-700">{product.result}</p></div>}
                        {(product.has_guarantee !== undefined && product.has_guarantee !== null) && <div><p className="text-xs text-dark-400">{t.hasGuarantee}</p><p className="text-dark-700">{product.has_guarantee ? `${t.yes}${product.guarantee_details ? ` — ${product.guarantee_details}` : ''}` : t.no}</p></div>}
                        {product.price_range && <div><p className="text-xs text-dark-400">{t.priceRange}</p><p className="text-dark-700">{product.price_range}</p></div>}
                        {product.stock_limited && <div><p className="text-xs text-dark-400">{t.stockLimited}</p><p className="text-dark-700">{t.yes}</p></div>}
                        {/* Legacy fields for old products */}
                        {product.main_problem && <div><p className="text-xs text-dark-400">{t.mainProblem}</p><p className="text-dark-700">{product.main_problem}</p></div>}
                        {product.best_customers && <div><p className="text-xs text-dark-400">{t.bestCustomers}</p><p className="text-dark-700">{product.best_customers}</p></div>}
                        {product.differentiation && <div><p className="text-xs text-dark-400">{t.differentiation}</p><p className="text-dark-700">{product.differentiation}</p></div>}
                        {product.key_objection && <div><p className="text-xs text-dark-400">{t.keyObjection}</p><p className="text-dark-700">{product.key_objection}</p></div>}
                        {product.shipping_info && <div><p className="text-xs text-dark-400">{t.shippingInfo}</p><p className="text-dark-700">{product.shipping_info}</p></div>}
                      </>
                    )}
                    {/* Service fields */}
                    {product.type === 'service' && (
                      <>
                        {product.svc_service_type && <div><p className="text-xs text-dark-400">{t.svcServiceType}</p><p className="text-dark-700">{product.svc_service_type}</p></div>}
                        {product.product_description && <div><p className="text-xs text-dark-400">{t.productDescription}</p><p className="text-dark-700">{product.product_description}</p></div>}
                        {product.svc_problem && <div><p className="text-xs text-dark-400">{t.svcProblem}</p><p className="text-dark-700">{product.svc_problem}</p></div>}
                        {product.svc_current_pain && <div><p className="text-xs text-dark-400">{t.svcCurrentPain}</p><p className="text-dark-700">{product.svc_current_pain}</p></div>}
                        {product.svc_alternatives_tried && <div><p className="text-xs text-dark-400">{t.svcAlternativesTried}</p><p className="text-dark-700">{product.svc_alternatives_tried}</p></div>}
                        {product.svc_alternatives_failures && <div><p className="text-xs text-dark-400">{t.svcAlternativesFailures}</p><p className="text-dark-700">{product.svc_alternatives_failures}</p></div>}
                        {product.svc_concrete_result && <div><p className="text-xs text-dark-400">{t.svcConcreteResult}</p><p className="text-dark-700">{product.svc_concrete_result}</p></div>}
                        {product.svc_result_timeline && <div><p className="text-xs text-dark-400">{t.svcResultTimeline}</p><p className="text-dark-700">{product.svc_result_timeline}</p></div>}
                        {product.svc_life_change && <div><p className="text-xs text-dark-400">{t.svcLifeChange}</p><p className="text-dark-700">{product.svc_life_change}</p></div>}
                        {product.svc_process_steps && <div><p className="text-xs text-dark-400">{t.svcProcessSteps}</p><p className="text-dark-700 whitespace-pre-wrap">{product.svc_process_steps}</p></div>}
                        {product.svc_service_format && <div><p className="text-xs text-dark-400">{t.svcServiceFormat}</p><p className="text-dark-700">{product.svc_service_format}</p></div>}
                        {product.svc_service_duration && <div><p className="text-xs text-dark-400">{t.svcServiceDuration}</p><p className="text-dark-700">{product.svc_service_duration}</p></div>}
                        {product.svc_differentiation && <div><p className="text-xs text-dark-400">{t.svcDifferentiation}</p><p className="text-dark-700">{product.svc_differentiation}</p></div>}
                        {product.svc_has_own_method && product.svc_method_name && <div><p className="text-xs text-dark-400">{t.svcMethodName}</p><p className="text-dark-700">{product.svc_method_name}</p></div>}
                        {product.svc_main_objection && <div><p className="text-xs text-dark-400">{t.svcMainObjection}</p><p className="text-dark-700">{product.svc_main_objection}</p></div>}
                        {(product.svc_has_guarantee) && <div><p className="text-xs text-dark-400">{t.svcGuarantee}</p><p className="text-dark-700">{product.svc_guarantee_details || t.yes}</p></div>}
                        {/* Legacy fields for old services */}
                        {product.main_problem && <div><p className="text-xs text-dark-400">{t.mainProblem}</p><p className="text-dark-700">{product.main_problem}</p></div>}
                        {product.real_pain && <div><p className="text-xs text-dark-400">{t.realPain}</p><p className="text-dark-700">{product.real_pain}</p></div>}
                        {product.differentiation && <div><p className="text-xs text-dark-400">{t.differentiation}</p><p className="text-dark-700">{product.differentiation}</p></div>}
                      </>
                    )}
                    {/* Indumentaria fields */}
                    {product.type === 'indumentaria' && (
                      <>
                        {product.ind_article_type && <div><p className="text-xs text-dark-400">{t.indArticleType}</p><p className="text-dark-700">{product.ind_article_type}</p></div>}
                        {product.product_description && <div><p className="text-xs text-dark-400">{t.productDescription}</p><p className="text-dark-700">{product.product_description}</p></div>}
                        {product.ind_model_count && <div><p className="text-xs text-dark-400">{t.indModelCount}</p><p className="text-dark-700">{product.ind_model_count}</p></div>}
                        {product.ind_variations_description && <div><p className="text-xs text-dark-400">{t.indVariations}</p><p className="text-dark-700">{product.ind_variations_description}</p></div>}
                        {product.ind_sizes && <div><p className="text-xs text-dark-400">{t.indSizes}</p><p className="text-dark-700">{product.ind_sizes}</p></div>}
                        {product.ind_main_material && <div><p className="text-xs text-dark-400">{t.indMaterial}</p><p className="text-dark-700">{product.ind_main_material}</p></div>}
                        {product.ind_quality_description && <div><p className="text-xs text-dark-400">{t.indQuality}</p><p className="text-dark-700">{product.ind_quality_description}</p></div>}
                        {(product.ind_accepts_changes !== undefined && product.ind_accepts_changes !== null) && <div><p className="text-xs text-dark-400">{t.indChanges}</p><p className="text-dark-700">{product.ind_accepts_changes ? `${t.yes}${product.ind_change_policy ? ` — ${product.ind_change_policy}` : ''}` : t.no}</p></div>}
                        {(product.has_guarantee !== undefined && product.has_guarantee !== null) && <div><p className="text-xs text-dark-400">{t.hasGuarantee}</p><p className="text-dark-700">{product.has_guarantee ? `${t.yes}${product.guarantee_details ? ` — ${product.guarantee_details}` : ''}` : t.no}</p></div>}
                        {(product.ind_customizable !== undefined && product.ind_customizable !== null) && <div><p className="text-xs text-dark-400">{t.indCustomizable}</p><p className="text-dark-700">{product.ind_customizable ? `${t.yes}${product.ind_customization_description ? ` — ${product.ind_customization_description}` : ''}` : t.no}</p></div>}
                      </>
                    )}
                    {/* Restaurant-specific fields */}
                    {product.type === 'restaurant' && (
                      <>
                        <div>
                          <p className="text-xs text-dark-400">{t.menuText}</p>
                          <p className="text-dark-700 whitespace-pre-wrap">{product.menu_text || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.location}</p>
                          <p className="text-dark-700">{product.location || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.schedule}</p>
                          <p className="text-dark-700">{product.schedule || '-'}</p>
                        </div>
                      </>
                    )}
                    {/* Real estate-specific fields */}
                    {product.type === 'real_estate' && (
                      <>
                        <div>
                          <p className="text-xs text-dark-400">{t.reBusinessType}</p>
                          <p className="text-dark-700">{product.re_business_type || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.rePrice}</p>
                          <p className="text-dark-700">{product.re_price || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.reLocation}</p>
                          <p className="text-dark-700">{product.re_location || '-'}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-xs text-dark-400">{t.reConstructionSize}</p>
                            <p className="text-dark-700">{product.re_construction_size || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-dark-400">{t.reBedrooms}</p>
                            <p className="text-dark-700">{product.re_bedrooms || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-dark-400">{t.reBathrooms}</p>
                            <p className="text-dark-700">{product.re_bathrooms || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-dark-400">{t.reParking}</p>
                            <p className="text-dark-700">{product.re_parking || '-'}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.reHighlights}</p>
                          <p className="text-dark-700">{product.re_highlights || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.reLocationReference}</p>
                          <p className="text-dark-700">{product.re_location_reference || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.reCta}</p>
                          <p className="text-dark-700">{product.re_cta || '-'}</p>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Context Documents */}
              <div className="p-4 border-t border-dark-100 bg-green-900/10">
                <h3 className="font-semibold text-dark-900 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-green-600" />
                  {language === 'es' ? 'Documentos de Contexto' : 'Context Documents'}
                </h3>

                {/* Add Link & PDF Buttons */}
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setShowAddLink(true)}
                    disabled={showAddLink}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-dark-300 rounded-lg text-sm text-dark-500 hover:border-green-500 hover:text-green-600 transition-colors disabled:opacity-50"
                  >
                    <Link2 className="w-4 h-4" />
                    {language === 'es' ? 'Enlace' : 'Link'}
                  </button>
                  <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-dark-300 rounded-lg text-sm text-dark-500 hover:border-green-500 hover:text-green-600 transition-colors cursor-pointer">
                    <Upload className="w-4 h-4" />
                    {language === 'es' ? 'PDF' : 'PDF'}
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={handlePdfUpload}
                      className="hidden"
                      disabled={addingDoc}
                    />
                  </label>
                </div>
                {pdfError && (
                  <p className="text-xs text-red-400 bg-red-900/20 px-3 py-1.5 rounded-lg">{pdfError}</p>
                )}

                {/* Add Link Form */}
                {showAddLink && (
                  <div className="space-y-2">
                    <textarea
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                      placeholder={language === 'es' 
                        ? 'Pega uno o varios enlaces (uno por línea):\nhttps://ejemplo.com\nhttps://otro-enlace.com' 
                        : 'Paste one or multiple links (one per line):\nhttps://example.com\nhttps://another-link.com'}
                      className="w-full px-3 py-2 bg-dark-50 text-dark-900 border border-dark-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 resize-none h-20 placeholder:text-dark-400"
                      disabled={addingDoc}
                    />
                    {bulkLinkProgress && (
                      <div className="flex items-center gap-2 text-xs text-green-400 bg-green-900/20 px-3 py-1.5 rounded-lg">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {language === 'es' 
                          ? `Procesando ${bulkLinkProgress.current} de ${bulkLinkProgress.total}...` 
                          : `Processing ${bulkLinkProgress.current} of ${bulkLinkProgress.total}...`}
                      </div>
                    )}
                    {failedLinks.length > 0 && (
                      <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 px-3 py-2 rounded-lg">
                        <p className="font-medium">{language === 'es' ? 'No se pudo extraer contenido de:' : 'Failed to extract content from:'}</p>
                        {failedLinks.map((link, i) => (
                          <p key={i} className="truncate mt-0.5 text-amber-600">{link}</p>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddLink}
                        disabled={addingDoc || !newLinkUrl.trim()}
                        className="flex-1 px-3 py-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        {addingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {language === 'es' ? 'Agregar' : 'Add'}
                      </button>
                      <button
                        onClick={() => { setShowAddLink(false); setNewLinkUrl(''); setFailedLinks([]) }}
                        disabled={addingDoc}
                        className="px-3 py-2 text-dark-500 hover:bg-dark-100 rounded-lg text-sm disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Add Text */}
                <div className="mt-3">
                  <textarea
                    value={newTextContent}
                    onChange={(e) => setNewTextContent(e.target.value)}
                    placeholder={language === 'es' ? 'Agregar texto adicional...' : 'Add additional text...'}
                    className="w-full px-3 py-2 bg-dark-50 text-dark-900 border border-dark-200 rounded-lg text-sm h-16 resize-none focus:ring-2 focus:ring-green-500 placeholder:text-dark-400"
                  />
                  {newTextContent.trim() && (
                    <button
                      onClick={handleAddText}
                      disabled={addingDoc}
                      className="mt-2 w-full px-3 py-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {addingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {language === 'es' ? 'Agregar texto' : 'Add text'}
                    </button>
                  )}
                </div>

                {/* Document List */}
                {contextDocs.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs text-dark-500 font-medium">
                      {language === 'es' ? 'Documentos agregados:' : 'Added documents:'}
                    </p>
                    {contextDocs.map(doc => (
                      <div key={doc.id} className="bg-dark-100 rounded-lg border border-dark-100 overflow-hidden">
                        <div className="flex items-center justify-between p-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {doc.type === 'link' ? <Link2 className="w-4 h-4 text-blue-500 flex-shrink-0" /> : <FileText className="w-4 h-4 text-green-500 flex-shrink-0" />}
                            <span className="text-xs text-dark-700 truncate">{doc.name}</span>
                            <span className="text-[10px] text-dark-400 bg-dark-50 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                              {doc.content ? `${doc.content.length}c` : '0c'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => setDebugDocId(debugDocId === doc.id ? null : doc.id)}
                              className="p-1 text-dark-400 hover:text-amber-600 transition-colors"
                              title="Debug: view extracted content"
                            >
                              {debugDocId === doc.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleDeleteDoc(doc.id)}
                              className="p-1 text-dark-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        {debugDocId === doc.id && (
                          <div className="border-t border-dark-100 bg-amber-900/10 p-2">
                            <p className="text-[10px] font-mono text-amber-700 mb-1">DEBUG — Raw extracted content ({doc.content?.length || 0} chars) | type: {doc.type}{doc.url ? ` | url: ${doc.url}` : ''}</p>
                            <pre className="text-[11px] text-dark-600 whitespace-pre-wrap break-words max-h-60 overflow-y-auto font-mono bg-dark-100 p-2 rounded border border-amber-200">
                              {doc.content || '(empty — no content extracted)'}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </div>
        )}
      </div>
      {/* Teach Me Modal */}
      {showTeachModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-dark-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-violet-500" />
                <h3 className="text-sm font-semibold text-dark-800">
                  {language === 'es' ? 'Enseñar a la IA' : 'Teach the AI'}
                </h3>
              </div>
              <button onClick={() => setShowTeachModal(false)} className="p-1 rounded-lg hover:bg-dark-50 text-dark-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-dark-500">
                {language === 'es'
                  ? 'Escribe una instrucción directa para la IA. Ejemplo: "Nunca uses preguntas retóricas como gancho" o "Mi tono es agresivo y directo, sin rodeos".'
                  : 'Write a direct instruction for the AI. Example: "Never use rhetorical questions as hooks" or "My tone is aggressive and direct, no fluff".'}
              </p>
              <textarea
                value={teachInput}
                onChange={(e) => setTeachInput(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-dark-50 border border-dark-200 rounded-lg text-dark-700 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 min-h-[100px] placeholder-dark-400"
                placeholder={language === 'es' ? 'Escribe tu instrucción aquí...' : 'Write your instruction here...'}
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowTeachModal(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-dark-500 bg-dark-50 hover:bg-dark-100 rounded-lg transition-colors"
                >
                  {language === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
                <button
                  onClick={handleTeachMe}
                  disabled={!teachInput.trim() || teachingSaving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {teachingSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Brain className="w-4 h-4" />
                  )}
                  {teachingSaving
                    ? (language === 'es' ? 'Guardando...' : 'Saving...')
                    : (language === 'es' ? 'Enseñar' : 'Teach')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
