import { useState, useEffect, useRef } from 'react'
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
  getICPs,
  getClientICPs,
  getContextDocuments,
  createContextDocument,
  deleteContextDocument
} from '../services/database'
import { sendMessageToGrok, previewPrompt, DEFAULT_SCRIPT_SETTINGS } from '../services/grokApi'
import type { Product, ChatSession, Message, ScriptGenerationSettings, ICP, ContextDocument } from '../types'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import ThinkingAnimation from '../components/ThinkingAnimation'
import ScriptSettingsPanel from '../components/ScriptSettingsPanel'
import ScriptCard from '../components/ScriptCard'
import { parseScripts, isScriptContent } from '../utils/scriptParser'
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
  Settings,
  Users,
  Link2,
  FileText,
  Trash2,
  Upload,
  Pencil,
  Eye,
  EyeOff
} from 'lucide-react'

export default function ProductWorkspace() {
  const { productId, sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
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
  const [showSettings, setShowSettings] = useState(false)
  const [icps, setICPs] = useState<ICP[]>([])
  const [selectedICP, setSelectedICP] = useState<ICP | null>(null)
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
          navigate('/dashboard')
          return
        }
        setProduct(productData)
        setEditedProduct(productData)

        const sessionsData = await getChatSessions(productId)
        setSessions(sessionsData)

        // Load ICPs: client-scoped for team products, user-scoped for single accounts
        const icpsData = productData.client_id 
          ? await getClientICPs(productData.client_id)
          : await getICPs(user.id)
        setICPs(icpsData)

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

  const handleSend = async () => {
    if (!input.trim() || loading || !user || !product) return

    const userMessage = input.trim()
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

      // Build context for AI - use message with settings for API call
      const productContext = buildProductContext(product, context)
      const messageForApi = { ...savedUserMessage, content: messageWithSettings }
      const allMessages = [...messages, messageForApi]
      
      const aiResponse = await sendMessageToGrok(allMessages, productContext, language, scriptSettings, undefined, selectedICP, contextDocs)
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

  const buildProductContext = (product: Product, additionalContext: string) => {
    const baseContext = {
      product_name: product.name,
      product_type: product.type,
      // New form fields
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
      // Legacy fields for backward compatibility
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

    // Add restaurant-specific fields if applicable
    if (product.type === 'restaurant') {
      return {
        ...baseContext,
        menu_text: product.menu_text,
        location: product.location,
        schedule: product.schedule,
        is_new_restaurant: product.is_new_restaurant
      }
    }

    // Add real estate-specific fields if applicable
    if (product.type === 'real_estate') {
      return {
        ...baseContext,
        re_business_type: product.re_business_type,
        re_price: product.re_price,
        re_location: product.re_location,
        re_construction_size: product.re_construction_size,
        re_bedrooms: product.re_bedrooms,
        re_capacity: product.re_capacity,
        re_bathrooms: product.re_bathrooms,
        re_parking: product.re_parking,
        re_highlights: product.re_highlights,
        re_location_reference: product.re_location_reference,
        re_cta: product.re_cta
      }
    }

    return baseContext
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSaveContext = async () => {
    if (!currentSession) return
    try {
      await updateChatSession(currentSession.id, { context })
    } catch (error) {
      console.error('Failed to save context:', error)
    }
  }

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
          paso_a_paso: { es: 'Paso a Paso', en: 'Step by Step' }
        }
        const config = scriptSettings.scriptTypeConfig
        const parts: string[] = []
        for (const [key, count] of Object.entries(config)) {
          if (count > 0) {
            const label = typeLabels[key]?.[language] || key
            parts.push(language === 'es' 
              ? `${count} guión(es) de tipo "${label}"`
              : `${count} "${label}" script(s)`)
          }
        }
        const total = parts.reduce((sum, _) => sum, Object.values(config).reduce((s, n) => s + n, 0))
        generatePrompt = language === 'es'
          ? `Genera exactamente ${total} guión(es) de venta: ${parts.join(', ')}.`
          : `Generate exactly ${total} sales script(s): ${parts.join(', ')}.`
      } else {
        generatePrompt = language === 'es' 
          ? `Genera exactamente ${scriptSettings.variations} guión(es) de venta.`
          : `Generate exactly ${scriptSettings.variations} sales script(s).`
      }
      
      const userMessage = await addMessage(session.id, 'user', generatePrompt)
      setMessages(prev => [...prev, userMessage])

      const productContext = buildProductContext(product, context)
      const allMessages = [...messages, userMessage]
      
      const aiResponse = await sendMessageToGrok(allMessages, productContext, language, scriptSettings, undefined, selectedICP, contextDocs)
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
      const prompt = await previewPrompt(
        messages,
        productContext,
        language,
        scriptSettings,
        undefined,
        selectedICP,
        contextDocs
      )
      setPreviewSystemPrompt(prompt)
    } catch (error) {
      console.error('Failed to preview prompt:', error)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleSaveScript = async (content: string, title?: string): Promise<string | null> => {
    if (!currentSession || !product || savingScript) return null
    setSavingScript(true)
    try {
      const script = await saveScript(
        currentSession.id,
        product.id,
        title || `Script - ${new Date().toLocaleDateString()}`,
        content
      )
      return script.id
    } catch (error) {
      console.error('Failed to save script:', error)
      return null
    } finally {
      setSavingScript(false)
    }
  }

  const handleSaveIndividualScript = async (content: string, title: string): Promise<string | null> => {
    return handleSaveScript(content, title)
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
      productDescription: 'Descripción del producto/servicio',
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
      // Restaurant-specific labels
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
      rateScript: 'Calificar'
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
      productDescription: 'Product/Service Description',
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
      // Restaurant-specific labels
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
      rateScript: 'Rate'
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
      <div className="flex h-[calc(100vh-64px)] lg:h-screen" style={{ height: 'calc(100dvh - 64px)' }}>
        {/* Left Sidebar - Sessions */}
        <div className="w-64 bg-white border-r border-dark-100 flex flex-col">
          <div className="px-4 pt-4 pb-3">
            <Link 
              to="/dashboard" 
              className="inline-flex items-center gap-1.5 text-dark-400 hover:text-dark-600 text-xs font-medium tracking-wide uppercase transition-colors mb-3"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {t.back}
            </Link>
            <h2 className="font-semibold text-dark-900 truncate text-base">{product.name}</h2>
            <p className="text-xs text-dark-400 capitalize mt-0.5">{product.type}</p>
          </div>

          <div className="px-3 pb-3">
            <button 
              onClick={handleNewSession}
              className="w-full flex items-center justify-center gap-2 text-sm font-medium px-3 py-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t.newSession}
            </button>
          </div>

          <div className="border-t border-dark-100" />

          <div className="flex-1 overflow-y-auto py-2">
            <p className="px-4 py-1.5 text-[10px] font-semibold text-dark-400 uppercase tracking-wider">
              {t.sessions}
            </p>
            {sessions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-dark-400">{t.noSessions}</p>
            ) : (
              <div className="space-y-0.5 px-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group relative rounded-lg transition-all duration-150 ${
                      currentSession?.id === session.id
                        ? 'bg-dark-100'
                        : 'hover:bg-dark-50'
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
                          className="w-full px-2 py-1 text-sm border border-primary-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => navigate(`/product/${productId}/session/${session.id}`)}
                        onDoubleClick={() => {
                          setRenamingSessionId(session.id)
                          setRenameValue(session.title)
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-lg"
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
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col bg-gray-50/50">
          {/* Header */}
          <div className="bg-white border-b border-dark-100 px-6 py-3 flex items-center justify-between">
            <h1 className="text-sm font-semibold text-dark-800 truncate">
              {currentSession?.title || product.name}
            </h1>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={exportAsText} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-dark-500 hover:text-dark-700 hover:bg-dark-50 rounded-md transition-colors">
                  <Download className="w-3.5 h-3.5" />
                  {t.export}
                </button>
              )}
              <button
                onClick={handlePreviewPrompt}
                disabled={loadingPreview}
                className={`p-2 rounded-md transition-colors ${
                  previewSystemPrompt ? 'bg-amber-100 text-amber-700' : 'hover:bg-dark-50 text-dark-400'
                }`}
                title={language === 'es' ? 'Vista previa del prompt' : 'Preview prompt'}
              >
                {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              </button>
              <div className="relative">
                <button 
                  onClick={() => setShowSettings(!showSettings)}
                  className={`p-2 rounded-md transition-colors ${
                    showSettings ? 'bg-amber-50 text-amber-600' : 'hover:bg-dark-50 text-dark-400'
                  }`}
                  title={t.scriptSettings}
                >
                  <Settings className="w-4 h-4" />
                </button>
                {showSettings && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-lg border border-dark-100 z-50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-dark-900 flex items-center gap-2 text-sm">
                        <Settings className="w-4 h-4 text-amber-600" />
                        {t.scriptSettings}
                      </h3>
                      <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-dark-50 rounded-md text-dark-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <ScriptSettingsPanel
                      settings={scriptSettings}
                      onChange={setScriptSettings}
                      language={language}
                      onGenerate={() => { setShowSettings(false); handleGenerateScript() }}
                      loading={loading}
                    />
                  </div>
                )}
              </div>
              <button 
                onClick={() => setShowProductInfo(!showProductInfo)}
                className={`p-2 rounded-md transition-colors ${
                  showProductInfo ? 'bg-primary-50 text-primary-600' : 'hover:bg-dark-50 text-dark-400'
                }`}
              >
                <Info className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Preview: Full System Prompt */}
          {previewSystemPrompt && (
            <div className="border-b border-amber-300 bg-amber-50/80 px-6 py-3 max-h-[50vh] overflow-y-auto">
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
              <pre className="text-[11px] text-dark-700 whitespace-pre-wrap break-words font-mono bg-white p-3 rounded-lg border border-amber-200 leading-relaxed">
                {previewSystemPrompt}
              </pre>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-8 space-y-5">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-sm">
                  <div className="w-14 h-14 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto mb-5">
                    <Sparkles className="w-7 h-7 text-primary-500" />
                  </div>
                  <p className="text-dark-400 text-sm mb-8">{t.startConversation}</p>
                  <button
                    onClick={handleGenerateScript}
                    disabled={loading}
                    className="inline-flex items-center gap-2.5 text-base font-medium px-8 py-3 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Sparkles className="w-5 h-5" />
                    )}
                    {t.generateScript}
                  </button>
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
                        <div className="max-w-3xl px-5 py-4 bg-primary-600 text-white rounded-2xl rounded-br-md">
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
                            savingScript={savingScript}
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
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[10px] font-mono font-bold text-amber-800">
                                MASTER PROMPT ({message.system_prompt.length.toLocaleString()} chars / ~{Math.ceil(message.system_prompt.length / 4).toLocaleString()} tokens)
                              </p>
                              <button
                                onClick={() => navigator.clipboard.writeText(message.system_prompt!)}
                                className="text-[10px] px-2 py-0.5 bg-amber-200 hover:bg-amber-300 text-amber-800 rounded font-mono transition-colors"
                              >
                                Copy
                              </button>
                            </div>
                            <pre className="text-[10px] text-dark-700 whitespace-pre-wrap break-words font-mono bg-white p-2 rounded border border-amber-200 leading-relaxed max-h-[40vh] overflow-y-auto">
                              {message.system_prompt}
                            </pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Non-script assistant message (conversational) */
                      <div className="flex justify-start">
                        <div className="max-w-3xl px-5 py-4 bg-white border border-dark-100 text-dark-800 rounded-2xl rounded-bl-md shadow-sm">
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
                            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[10px] font-mono font-bold text-amber-800">
                                  MASTER PROMPT ({message.system_prompt.length.toLocaleString()} chars / ~{Math.ceil(message.system_prompt.length / 4).toLocaleString()} tokens)
                                </p>
                                <button
                                  onClick={() => navigator.clipboard.writeText(message.system_prompt!)}
                                  className="text-[10px] px-2 py-0.5 bg-amber-200 hover:bg-amber-300 text-amber-800 rounded font-mono transition-colors"
                                >
                                  Copy
                                </button>
                              </div>
                              <pre className="text-[10px] text-dark-700 whitespace-pre-wrap break-words font-mono bg-white p-2 rounded border border-amber-200 leading-relaxed max-h-[40vh] overflow-y-auto">
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

          {/* Input */}
          <div className="bg-white border-t border-dark-100 px-6 py-3">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t.placeholder}
                    className="w-full px-4 py-3 text-sm bg-gray-50 border border-dark-100 rounded-xl resize-none min-h-[48px] max-h-32 focus:outline-none focus:ring-1 focus:ring-dark-300 focus:bg-white transition-colors"
                    rows={1}
                    disabled={loading}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="h-[48px] w-[48px] flex items-center justify-center rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Product Info & Context */}
        {showProductInfo && (
          <div className="w-80 bg-white border-l border-dark-100 flex flex-col overflow-y-auto">
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
                    {/* Product & Service common fields - Edit Mode */}
                    {(product.type === 'product' || product.type === 'service') && (
                      <>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.productDescription}</label>
                          <textarea
                            value={editedProduct.product_description || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, product_description: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.mainProblem}</label>
                          <textarea
                            value={editedProduct.main_problem || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, main_problem: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.bestCustomers}</label>
                          <textarea
                            value={editedProduct.best_customers || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, best_customers: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.failedAttempts}</label>
                          <textarea
                            value={editedProduct.failed_attempts || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, failed_attempts: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.attentionGrabber}</label>
                          <textarea
                            value={editedProduct.attention_grabber || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, attention_grabber: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.expectedResult}</label>
                          <textarea
                            value={editedProduct.expected_result || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, expected_result: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.differentiation}</label>
                          <textarea
                            value={editedProduct.differentiation || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, differentiation: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.awarenessLevel}</label>
                          <textarea
                            value={editedProduct.awareness_level || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, awareness_level: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                      </>
                    )}
                    {/* Product-specific fields */}
                    {product.type === 'product' && (
                      <>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.keyObjection}</label>
                          <textarea
                            value={editedProduct.key_objection || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, key_objection: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.shippingInfo}</label>
                          <textarea
                            value={editedProduct.shipping_info || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, shipping_info: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                      </>
                    )}
                    {/* Service-specific fields */}
                    {product.type === 'service' && (
                      <>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.realPain}</label>
                          <textarea
                            value={editedProduct.real_pain || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, real_pain: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-dark-400 block mb-1">{t.painConsequences}</label>
                          <textarea
                            value={editedProduct.pain_consequences || ''}
                            onChange={(e) => setEditedProduct(prev => ({ ...prev, pain_consequences: e.target.value }))}
                            className="input-field text-sm min-h-[60px]"
                          />
                        </div>
                      </>
                    )}
                    {/* Restaurant-specific fields */}
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
                    {/* Product & Service common fields */}
                    {(product.type === 'product' || product.type === 'service') && (
                      <>
                        <div>
                          <p className="text-xs text-dark-400">{t.productDescription}</p>
                          <p className="text-dark-700">{product.product_description || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.mainProblem}</p>
                          <p className="text-dark-700">{product.main_problem || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.bestCustomers}</p>
                          <p className="text-dark-700">{product.best_customers || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.failedAttempts}</p>
                          <p className="text-dark-700">{product.failed_attempts || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.attentionGrabber}</p>
                          <p className="text-dark-700">{product.attention_grabber || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.expectedResult}</p>
                          <p className="text-dark-700">{product.expected_result || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.differentiation}</p>
                          <p className="text-dark-700">{product.differentiation || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.awarenessLevel}</p>
                          <p className="text-dark-700">{product.awareness_level || '-'}</p>
                        </div>
                      </>
                    )}
                    {/* Product-specific fields */}
                    {product.type === 'product' && (
                      <>
                        <div>
                          <p className="text-xs text-dark-400">{t.keyObjection}</p>
                          <p className="text-dark-700">{product.key_objection || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.shippingInfo}</p>
                          <p className="text-dark-700">{product.shipping_info || '-'}</p>
                        </div>
                      </>
                    )}
                    {/* Service-specific fields */}
                    {product.type === 'service' && (
                      <>
                        <div>
                          <p className="text-xs text-dark-400">{t.realPain}</p>
                          <p className="text-dark-700">{product.real_pain || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{t.painConsequences}</p>
                          <p className="text-dark-700">{product.pain_consequences || '-'}</p>
                        </div>
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

            {/* ICP Selector */}
            {icps.length > 0 && (
              <div className="p-4 border-t border-dark-100 bg-blue-50/50">
                <h3 className="font-semibold text-dark-900 mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  {language === 'es' ? 'Perfil de Cliente' : 'Client Profile'}
                </h3>
                <select
                  value={selectedICP?.id || ''}
                  onChange={(e) => {
                    const icp = icps.find(i => i.id === e.target.value) || null
                    setSelectedICP(icp)
                  }}
                  className="w-full px-3 py-2 border border-dark-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">{language === 'es' ? 'Sin ICP (general)' : 'No ICP (general)'}</option>
                  {icps.map(icp => (
                    <option key={icp.id} value={icp.id}>{icp.name}</option>
                  ))}
                </select>
                {selectedICP && (
                  <p className="text-xs text-dark-500 mt-2 line-clamp-2">{selectedICP.description}</p>
                )}
              </div>
            )}

            {/* Session Context */}
            <div className="p-4 border-t border-dark-100">
              <h3 className="font-semibold text-dark-900 mb-3">{t.context}</h3>
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder={t.contextPlaceholder}
                className="input-field resize-none text-sm h-24"
              />
              <button
                onClick={handleSaveContext}
                className="btn-secondary mt-3 text-sm w-full"
              >
                {t.saveContext}
              </button>
            </div>

            {/* Context Documents */}
            {currentSession && (
              <div className="p-4 border-t border-dark-100 bg-green-50/50">
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
                  <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">{pdfError}</p>
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
                      className="w-full px-3 py-2 border border-dark-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 resize-none h-20"
                      disabled={addingDoc}
                    />
                    {bulkLinkProgress && (
                      <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 px-3 py-1.5 rounded-lg">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {language === 'es' 
                          ? `Procesando ${bulkLinkProgress.current} de ${bulkLinkProgress.total}...` 
                          : `Processing ${bulkLinkProgress.current} of ${bulkLinkProgress.total}...`}
                      </div>
                    )}
                    {failedLinks.length > 0 && (
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
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
                    className="w-full px-3 py-2 border border-dark-200 rounded-lg text-sm h-16 resize-none focus:ring-2 focus:ring-green-500"
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
                      <div key={doc.id} className="bg-white rounded-lg border border-dark-100 overflow-hidden">
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
                          <div className="border-t border-dark-100 bg-amber-50/50 p-2">
                            <p className="text-[10px] font-mono text-amber-700 mb-1">DEBUG — Raw extracted content ({doc.content?.length || 0} chars) | type: {doc.type}{doc.url ? ` | url: ${doc.url}` : ''}</p>
                            <pre className="text-[11px] text-dark-600 whitespace-pre-wrap break-words max-h-60 overflow-y-auto font-mono bg-white p-2 rounded border border-amber-200">
                              {doc.content || '(empty — no content extracted)'}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
