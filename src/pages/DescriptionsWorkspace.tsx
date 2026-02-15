import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProduct, getScripts } from '../services/database'
import { sendMessageToGrok, DEFAULT_SCRIPT_SETTINGS } from '../services/grokApi'
import type { Product, Script, Message, ScriptGenerationSettings } from '../types'
import Layout from '../components/Layout'
import ThinkingAnimation from '../components/ThinkingAnimation'
import { 
  Send, 
  Loader2, 
  ArrowLeft, 
  FileText, 
  Sparkles, 
  Copy,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react'

interface LocalMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export default function DescriptionsWorkspace() {
  const { productId } = useParams<{ productId: string }>()
  const { user } = useAuth()
  const { language } = useLanguage()
  
  const [product, setProduct] = useState<Product | null>(null)
  const [scripts, setScripts] = useState<Script[]>([])
  const [selectedScript, setSelectedScript] = useState<Script | null>(null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [showScriptPicker, setShowScriptPicker] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const labels = {
    es: {
      title: 'Descripciones de Video',
      back: 'Volver a Descripciones',
      selectScript: 'Seleccionar Guión',
      noScripts: 'No hay guiones guardados para este producto. Genera guiones primero en el workspace de Scripts.',
      selectedScript: 'Guión seleccionado',
      changeScript: 'Cambiar',
      placeholder: 'Escribe instrucciones adicionales para la descripción...',
      generateDesc: 'Generar Descripciones',
      startPrompt: 'Selecciona un guión guardado y genera descripciones para tus videos de redes sociales.',
      copy: 'Copiar',
      copied: '¡Copiado!',
      pasteScript: 'O pega un guión directamente en el chat',
      scriptsFor: 'Guiones de'
    },
    en: {
      title: 'Video Descriptions',
      back: 'Back to Descriptions',
      selectScript: 'Select Script',
      noScripts: 'No saved scripts for this product. Generate scripts first in the Scripts workspace.',
      selectedScript: 'Selected script',
      changeScript: 'Change',
      placeholder: 'Type additional instructions for the description...',
      generateDesc: 'Generate Descriptions',
      startPrompt: 'Select a saved script and generate descriptions for your social media videos.',
      copy: 'Copy',
      copied: 'Copied!',
      pasteScript: 'Or paste a script directly in the chat',
      scriptsFor: 'Scripts for'
    }
  }

  const t = labels[language]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    async function loadData() {
      if (!productId || !user) return
      try {
        const [productData, scriptsData] = await Promise.all([
          getProduct(productId),
          getScripts(productId)
        ])
        setProduct(productData)
        setScripts(scriptsData)
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setPageLoading(false)
      }
    }
    loadData()
  }, [productId, user])

  const handleGenerateDescriptions = async () => {
    if (loading || !product) return
    
    const scriptContent = selectedScript?.content || input.trim()
    if (!scriptContent) return

    setLoading(true)
    
    const userMsg: LocalMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: selectedScript 
        ? (language === 'es' 
          ? `Genera descripciones de video para redes sociales basándote en este guión:\n\n${scriptContent}`
          : `Generate social media video descriptions based on this script:\n\n${scriptContent}`)
        : scriptContent
    }
    setMessages(prev => [...prev, userMsg])
    if (!selectedScript) setInput('')

    try {
      const descriptionContext = {
        product_name: product.name,
        product_type: product.type,
        product_description: product.product_description,
        additional_context: language === 'es'
          ? 'Genera descripciones cortas y atractivas para videos de redes sociales (Instagram, TikTok, YouTube Shorts). Incluye hashtags relevantes. Formato: 3-5 variaciones de descripción, cada una con diferente enfoque (informativo, emocional, urgente, social proof).'
          : 'Generate short, engaging descriptions for social media videos (Instagram, TikTok, YouTube Shorts). Include relevant hashtags. Format: 3-5 description variations, each with a different approach (informative, emotional, urgent, social proof).'
      }

      const apiMessages: Message[] = messages.map(m => ({
        id: m.id,
        session_id: '',
        role: m.role,
        content: m.content,
        created_at: new Date().toISOString()
      }))
      apiMessages.push({
        id: userMsg.id,
        session_id: '',
        role: 'user',
        content: userMsg.content,
        created_at: new Date().toISOString()
      })

      const settings: ScriptGenerationSettings = {
        ...DEFAULT_SCRIPT_SETTINGS,
        variations: 4
      }

      const aiResponse = await sendMessageToGrok(
        apiMessages,
        descriptionContext,
        language,
        settings,
        undefined,
        undefined,
        undefined,
        'description'
      )

      const aiMsg: LocalMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: aiResponse.content
      }
      setMessages(prev => [...prev, aiMsg])
    } catch (error) {
      console.error('Failed to generate descriptions:', error)
      const errorMsg: LocalMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to generate descriptions'}`
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || loading) return
    await handleGenerateDescriptions()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (pageLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </Layout>
    )
  }

  if (!product) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <p className="text-dark-500">Product not found</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-64px)]" style={{ height: 'calc(100dvh - 64px)' }}>
        {/* Header */}
        <div className="bg-white border-b border-dark-100 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/descriptions"
              className="p-1.5 hover:bg-dark-50 rounded-md text-dark-400 hover:text-dark-700 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-sm font-semibold text-dark-800">{t.title}</h1>
              <p className="text-xs text-dark-400">{product.name}</p>
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowScriptPicker(!showScriptPicker)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-primary-50 text-primary-700 hover:bg-primary-100 rounded-lg transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              {selectedScript ? t.changeScript : t.selectScript}
              {showScriptPicker ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showScriptPicker && (
              <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-lg border border-dark-100 z-50 max-h-[60vh] overflow-y-auto">
                <div className="p-3 border-b border-dark-100">
                  <p className="text-xs font-semibold text-dark-700">{t.scriptsFor} {product.name}</p>
                </div>
                {scripts.length > 0 ? (
                  <div className="p-2 space-y-1">
                    {scripts.map(script => (
                      <button
                        key={script.id}
                        onClick={() => {
                          setSelectedScript(script)
                          setShowScriptPicker(false)
                        }}
                        className={`w-full text-left p-3 rounded-lg transition-colors ${
                          selectedScript?.id === script.id
                            ? 'bg-primary-50 border border-primary-200'
                            : 'hover:bg-dark-50'
                        }`}
                      >
                        <p className="text-xs font-medium text-dark-800 truncate">{script.title}</p>
                        <p className="text-[10px] text-dark-400 mt-1 line-clamp-2">{script.content.slice(0, 120)}...</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center">
                    <p className="text-xs text-dark-400">{t.noScripts}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Selected script banner */}
        {selectedScript && (
          <div className="bg-primary-50/50 border-b border-primary-100 px-6 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-3.5 h-3.5 text-primary-600 flex-shrink-0" />
              <p className="text-xs text-primary-700 truncate">
                <span className="font-medium">{t.selectedScript}:</span> {selectedScript.title}
              </p>
            </div>
            <button
              onClick={() => setSelectedScript(null)}
              className="text-[10px] text-primary-600 hover:text-primary-800 font-medium"
            >
              ✕
            </button>
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
                <p className="text-dark-400 text-sm mb-4">{t.startPrompt}</p>
                <p className="text-dark-300 text-xs mb-8">{t.pasteScript}</p>
                {selectedScript && (
                  <button
                    onClick={handleGenerateDescriptions}
                    disabled={loading}
                    className="inline-flex items-center gap-2.5 text-base font-medium px-8 py-3 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Sparkles className="w-5 h-5" />
                    )}
                    {t.generateDesc}
                  </button>
                )}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-3xl px-5 py-4 ${
                    message.role === 'user'
                      ? 'bg-primary-600 text-white rounded-2xl rounded-br-md'
                      : 'bg-white border border-dark-100 text-dark-800 rounded-2xl rounded-bl-md shadow-sm'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {message.content}
                  </div>
                  {message.role === 'assistant' && (
                    <div className="mt-3 pt-3 border-t border-dark-100/60">
                      <button
                        onClick={() => handleCopy(message.content, message.id)}
                        className="text-xs flex items-center gap-1 text-dark-400 hover:text-primary-600 transition-colors"
                      >
                        {copiedId === message.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-green-600" />
                            <span className="text-green-600">{t.copied}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            {t.copy}
                          </>
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
    </Layout>
  )
}
