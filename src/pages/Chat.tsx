import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { sendMessageToGrok, getInitialPrompt, INTERVIEW_QUESTIONS } from '../services/grokApi'
import { 
  createConversation, 
  getConversation, 
  getMessages, 
  addMessage,
  updateConversation 
} from '../services/database'
import type { Message, BusinessDetails } from '../types'
import Layout from '../components/Layout'
import ThinkingAnimation from '../components/ThinkingAnimation'
import { Send, Loader2, Download } from 'lucide-react'

export default function Chat() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { language } = useLanguage()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(conversationId || null)
  const [businessDetails, setBusinessDetails] = useState<BusinessDetails>({})
  const [interviewStep, setInterviewStep] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    async function initializeChat() {
      if (!user) return
      setInitializing(true)

      try {
        if (conversationId) {
          const conversation = await getConversation(conversationId)
          if (conversation && conversation.user_id === user.id) {
            const existingMessages = await getMessages(conversationId)
            setMessages(existingMessages)
            setCurrentConversationId(conversationId)
          } else {
            navigate('/chat')
            return
          }
        } else {
          const initialMessage: Message = {
            id: 'initial',
            conversation_id: '',
            role: 'assistant',
            content: getInitialPrompt(language),
            created_at: new Date().toISOString()
          }
          setMessages([initialMessage])
        }
      } catch (error) {
        console.error('Failed to initialize chat:', error)
      } finally {
        setInitializing(false)
      }
    }

    initializeChat()
  }, [conversationId, user, navigate])

  const handleSend = async () => {
    if (!input.trim() || loading || !user) return

    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    try {
      let convId = currentConversationId

      if (!convId) {
        const title = userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '')
        const conversation = await createConversation(user.id, title)
        convId = conversation.id
        setCurrentConversationId(convId)
        navigate(`/chat/${convId}`, { replace: true })

        const initialAssistantMsg = await addMessage(convId, 'assistant', getInitialPrompt(language))
        setMessages([initialAssistantMsg])
      }

      const savedUserMessage = await addMessage(convId, 'user', userMessage)
      setMessages(prev => [...prev, savedUserMessage])

      const updatedDetails = { ...businessDetails }
      if (interviewStep < INTERVIEW_QUESTIONS[language].length) {
        const detailKeys: (keyof BusinessDetails)[] = [
          'product_description',
          'target_audience',
          'competitors',
          'unique_value',
          'emotional_trigger'
        ]
        if (detailKeys[interviewStep]) {
          updatedDetails[detailKeys[interviewStep]] = userMessage
        }
        setBusinessDetails(updatedDetails)
        setInterviewStep(prev => prev + 1)
      }

      const allMessages = [...messages.filter(m => m.id !== 'initial'), savedUserMessage]
      const aiResponse = await sendMessageToGrok(allMessages, updatedDetails, language)
      
      const savedAiMessage = await addMessage(convId, 'assistant', aiResponse)
      setMessages(prev => [...prev, savedAiMessage])

      if (interviewStep >= INTERVIEW_QUESTIONS[language].length - 1) {
        await updateConversation(convId, { status: 'completed' })
      }

    } catch (error) {
      console.error('Failed to send message:', error)
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        conversation_id: currentConversationId || '',
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response. Please try again.'}`,
        created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const exportAsText = () => {
    const text = messages
      .filter(m => m.id !== 'initial')
      .map(m => `${m.role.toUpperCase()}:\n${m.content}\n`)
      .join('\n---\n\n')
    
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ad-scripts-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-64px)] lg:h-screen">
        {/* Header */}
        <div className="bg-white border-b border-dark-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-dark-900">
              {currentConversationId ? 'Continue Script' : 'Create New Ad Script'}
            </h1>
            <p className="text-sm text-dark-500">
              {interviewStep < INTERVIEW_QUESTIONS[language].length 
                ? `${language === 'es' ? 'Pregunta' : 'Question'} ${interviewStep + 1} ${language === 'es' ? 'de' : 'of'} ${INTERVIEW_QUESTIONS[language].length}`
                : 'Scripts generated - request updates or export'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 1 && (
              <button
                onClick={exportAsText}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {initializing ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
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
              <div className="flex-1 relative">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your response..."
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
            <p className="text-xs text-dark-400 mt-2 text-center">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </Layout>
  )
}
