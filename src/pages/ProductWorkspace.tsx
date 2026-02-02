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
  saveScript
} from '../services/database'
import { sendMessageToGrok } from '../services/grokApi'
import type { Product, ChatSession, Message } from '../types'
import Layout from '../components/Layout'
import ThinkingAnimation from '../components/ThinkingAnimation'
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
  BookmarkPlus,
  RefreshCw,
  Info
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

        if (sessionId) {
          const sessionData = await getChatSession(sessionId)
          if (sessionData) {
            setCurrentSession(sessionData)
            setContext(sessionData.context || '')
            const messagesData = await getMessages(sessionId)
            setMessages(messagesData)
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

      const savedUserMessage = await addMessage(session.id, 'user', userMessage)
      setMessages(prev => [...prev, savedUserMessage])

      // Build context for AI
      const productContext = buildProductContext(product, context)
      const allMessages = [...messages, savedUserMessage]
      
      const aiResponse = await sendMessageToGrok(allMessages, productContext, language)
      
      const savedAiMessage = await addMessage(session.id, 'assistant', aiResponse)
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
    return {
      product_name: product.name,
      product_description: product.description,
      offer: product.offer,
      awareness_level: product.awareness_level,
      market_alternatives: product.market_alternatives,
      customer_values: product.customer_values,
      purchase_reason: product.purchase_reason,
      target_audience: product.target_audience,
      call_to_action: product.call_to_action,
      additional_context: additionalContext
    }
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

      // Add system message asking for scripts
      const generatePrompt = language === 'es' 
        ? 'Genera 5 guiones de venta únicos basándote en toda la información del producto que tienes.'
        : 'Generate 5 unique sales scripts based on all the product information you have.'
      
      const userMessage = await addMessage(session.id, 'user', generatePrompt)
      setMessages(prev => [...prev, userMessage])

      const productContext = buildProductContext(product, context)
      const allMessages = [...messages, userMessage]
      
      const aiResponse = await sendMessageToGrok(allMessages, productContext, language)
      
      const savedAiMessage = await addMessage(session.id, 'assistant', aiResponse)
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

  const handleSaveScript = async (content: string) => {
    if (!currentSession || !product || savingScript) return
    setSavingScript(true)
    try {
      await saveScript(
        currentSession.id,
        product.id,
        `Script - ${new Date().toLocaleDateString()}`,
        content
      )
      // Could show a toast notification here
    } catch (error) {
      console.error('Failed to save script:', error)
    } finally {
      setSavingScript(false)
    }
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
      description: 'Descripción',
      offer: 'Oferta',
      customerValues: 'Valores del cliente',
      purchaseReason: 'Razón de compra',
      awarenessLevel: 'Nivel de conciencia',
      marketAlternatives: 'Alternativas del mercado',
      targetAudience: 'Audiencia objetivo',
      cta: 'Llamado a la acción'
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
      description: 'Description',
      offer: 'Offer',
      customerValues: 'Customer Values',
      purchaseReason: 'Purchase Reason',
      awarenessLevel: 'Awareness Level',
      marketAlternatives: 'Market Alternatives',
      targetAudience: 'Target Audience',
      cta: 'Call to Action'
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
      <div className="flex h-[calc(100vh-64px)] lg:h-screen">
        {/* Left Sidebar - Sessions */}
        <div className="w-64 bg-dark-50 border-r border-dark-100 flex flex-col">
          <div className="p-4 border-b border-dark-100">
            <Link 
              to="/dashboard" 
              className="flex items-center gap-2 text-dark-500 hover:text-dark-700 text-sm mb-4"
            >
              <ChevronLeft className="w-4 h-4" />
              {t.back}
            </Link>
            <h2 className="font-semibold text-dark-900 truncate">{product.name}</h2>
            <p className="text-xs text-dark-400 capitalize">{product.type}</p>
          </div>

          <div className="p-3">
            <button 
              onClick={handleNewSession}
              className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
            >
              <Plus className="w-4 h-4" />
              {t.newSession}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <p className="px-4 py-2 text-xs font-medium text-dark-400 uppercase">
              {t.sessions}
            </p>
            {sessions.length === 0 ? (
              <p className="px-4 py-2 text-sm text-dark-400">{t.noSessions}</p>
            ) : (
              <div className="space-y-1 px-2">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => navigate(`/product/${productId}/session/${session.id}`)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      currentSession?.id === session.id
                        ? 'bg-primary-100 text-primary-700'
                        : 'hover:bg-dark-100 text-dark-600'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate text-sm">{session.title}</span>
                    </div>
                    <p className="text-xs text-dark-400 mt-1">
                      {new Date(session.updated_at).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="bg-white border-b border-dark-100 px-6 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-dark-900">
                {currentSession?.title || product.name}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button onClick={exportAsText} className="btn-secondary flex items-center gap-2 text-sm">
                  <Download className="w-4 h-4" />
                  {t.export}
                </button>
              )}
              <button 
                onClick={() => setShowProductInfo(!showProductInfo)}
                className={`p-2 rounded-lg transition-colors ${
                  showProductInfo ? 'bg-primary-100 text-primary-600' : 'hover:bg-dark-100 text-dark-500'
                }`}
              >
                <Info className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Sparkles className="w-12 h-12 text-primary-400 mx-auto mb-4" />
                  <p className="text-dark-500 mb-6">{t.startConversation}</p>
                  <button
                    onClick={handleGenerateScript}
                    disabled={loading}
                    className="btn-primary inline-flex items-center gap-2 text-lg px-8 py-3"
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
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-3xl rounded-2xl px-5 py-4 ${
                      message.role === 'user'
                        ? 'bg-primary-600 text-white'
                        : 'bg-white border border-dark-100 text-dark-800'
                    }`}
                  >
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {message.content}
                    </div>
                    {message.role === 'assistant' && message.content.length > 100 && (
                      <div className="mt-3 pt-3 border-t border-dark-100 flex items-center gap-2">
                        <button
                          onClick={() => handleSaveScript(message.content)}
                          disabled={savingScript}
                          className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                        >
                          <BookmarkPlus className="w-4 h-4" />
                          {t.saveScript}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex justify-start">
                <ThinkingAnimation language={language} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="bg-white border-t border-dark-100 p-4">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-end gap-3">
                {messages.length > 0 && (
                  <button
                    onClick={handleGenerateScript}
                    disabled={loading}
                    className="btn-secondary h-[52px] px-4 flex items-center gap-2"
                    title={t.regenerate}
                  >
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                )}
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t.placeholder}
                    className="input-field resize-none min-h-[52px] max-h-32 pr-12"
                    rows={1}
                    disabled={loading}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="btn-primary h-[52px] px-5"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Product Info & Context */}
        {showProductInfo && (
          <div className="w-80 bg-white border-l border-dark-100 flex flex-col overflow-hidden">
            {/* Product Info */}
            <div className="p-4 border-b border-dark-100 flex-1 overflow-y-auto">
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
                    <div>
                      <label className="text-xs text-dark-400 block mb-1">{t.description}</label>
                      <textarea
                        value={editedProduct.description || ''}
                        onChange={(e) => setEditedProduct(prev => ({ ...prev, description: e.target.value }))}
                        className="input-field text-sm min-h-[60px]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-dark-400 block mb-1">{t.offer}</label>
                      <textarea
                        value={editedProduct.offer || ''}
                        onChange={(e) => setEditedProduct(prev => ({ ...prev, offer: e.target.value }))}
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
                    <div>
                      <label className="text-xs text-dark-400 block mb-1">{t.marketAlternatives}</label>
                      <textarea
                        value={editedProduct.market_alternatives || ''}
                        onChange={(e) => setEditedProduct(prev => ({ ...prev, market_alternatives: e.target.value }))}
                        className="input-field text-sm min-h-[60px]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-dark-400 block mb-1">{t.customerValues}</label>
                      <textarea
                        value={editedProduct.customer_values || ''}
                        onChange={(e) => setEditedProduct(prev => ({ ...prev, customer_values: e.target.value }))}
                        className="input-field text-sm min-h-[60px]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-dark-400 block mb-1">{t.purchaseReason}</label>
                      <textarea
                        value={editedProduct.purchase_reason || ''}
                        onChange={(e) => setEditedProduct(prev => ({ ...prev, purchase_reason: e.target.value }))}
                        className="input-field text-sm min-h-[60px]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-dark-400 block mb-1">{t.cta}</label>
                      <input
                        type="text"
                        value={editedProduct.call_to_action || ''}
                        onChange={(e) => setEditedProduct(prev => ({ ...prev, call_to_action: e.target.value }))}
                        className="input-field text-sm"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-dark-400">{t.description}</p>
                      <p className="text-dark-700">{product.description || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-dark-400">{t.offer}</p>
                      <p className="text-dark-700">{product.offer || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-dark-400">{t.awarenessLevel}</p>
                      <p className="text-dark-700">{product.awareness_level || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-dark-400">{t.marketAlternatives}</p>
                      <p className="text-dark-700">{product.market_alternatives || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-dark-400">{t.customerValues}</p>
                      <p className="text-dark-700">{product.customer_values || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-dark-400">{t.purchaseReason}</p>
                      <p className="text-dark-700">{product.purchase_reason || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-dark-400">{t.cta}</p>
                      <p className="text-dark-700">{product.call_to_action || '-'}</p>
                    </div>
                  </>
                )}
              </div>
            </div>

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
          </div>
        )}
      </div>
    </Layout>
  )
}
