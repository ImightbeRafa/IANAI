import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProduct } from '../services/database'
import type { Product, AspectRatio, VideoResolution } from '../types'
import Layout from '../components/Layout'
import { 
  ArrowLeft,
  Video,
  Upload,
  X,
  Sparkles,
  Download,
  Package,
  Briefcase,
  UtensilsCrossed,
  Home,
  Loader2,
  Clock,
  Play,
  FileText,
  Eye,
  EyeOff,
  Clapperboard
} from 'lucide-react'
import { supabase } from '../lib/supabase'

interface GeneratedVideo {
  id: string
  videoUrl: string
  prompt: string
  duration: number
  createdAt: Date
}

const VIDEO_API_URL = import.meta.env.PROD ? '/api/generate-video' : 'http://localhost:3000/api/generate-video'
const BUILD_PROMPT_API_URL = import.meta.env.PROD ? '/api/build-ad-prompt' : 'http://localhost:3000/api/build-ad-prompt'

export default function BRollWorkspace() {
  const { productId } = useParams<{ productId: string }>()
  const { user } = useAuth()
  const { language } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Data
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)

  // Step 1: Inputs
  const [scriptText, setScriptText] = useState('')
  const [uploadedImages, setUploadedImages] = useState<string[]>([])

  // Step 2: Build prompt (Module A+B+C)
  const [buildingPrompt, setBuildingPrompt] = useState(false)
  const [motherPrompt, setMotherPrompt] = useState('')
  const [visualDNA, setVisualDNA] = useState('')
  const [cinematicScript, setCinematicScript] = useState('')
  const [showPromptPreview, setShowPromptPreview] = useState(false)

  // Step 3: Generate video
  const [generating, setGenerating] = useState(false)
  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>([])
  const [error, setError] = useState('')
  const [pollingRequestId, setPollingRequestId] = useState<string | null>(null)
  const [pollCount, setPollCount] = useState(0)
  const [pollStartTime, setPollStartTime] = useState<number | null>(null)
  const [lastPollStatus, setLastPollStatus] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Video settings
  const [duration, setDuration] = useState<number>(15)
  const [resolution, setResolution] = useState<VideoResolution>('720p')

  const labels = {
    es: {
      back: 'Volver',
      title: 'Generar Ad Video',
      subtitle: 'Crea videos de anuncios a partir de guiones ganadores',
      step1: 'Paso 1: Pega tu guión ganador',
      step2: 'Paso 2: Fotos del producto (opcional)',
      step3: 'Paso 3: Genera tu video',
      pasteScript: 'Pega aquí tu guión ganador...',
      uploadPhotos: 'Sube fotos de tu producto',
      uploadHint: 'Las fotos ayudan a la IA a mantener la identidad visual',
      buildPrompt: 'Construir Prompt de Anuncio',
      building: 'Procesando módulos A → B → C...',
      promptReady: 'Prompt listo para generar',
      viewPrompt: 'Ver prompt',
      hidePrompt: 'Ocultar prompt',
      generate: 'Generar Video',
      generating: 'Generando...',
      duration: 'Duración',
      seconds: 'segundos',
      resolution: 'Resolución',
      generatedVideos: 'Videos Generados',
      noVideos: 'Aún no hay videos generados',
      download: 'Descargar',
      error: 'Error al generar video',
      processing: 'Procesando video...',
      visualDNA: 'ADN Visual',
      cinematicScript: 'Guión Cinematográfico',
      motherPromptLabel: 'Prompt Madre'
    },
    en: {
      back: 'Back',
      title: 'Generate Ad Video',
      subtitle: 'Create ad videos from winning scripts',
      step1: 'Step 1: Paste your winning script',
      step2: 'Step 2: Product photos (optional)',
      step3: 'Step 3: Generate your video',
      pasteScript: 'Paste your winning script here...',
      uploadPhotos: 'Upload product photos',
      uploadHint: 'Photos help the AI maintain visual identity',
      buildPrompt: 'Build Ad Prompt',
      building: 'Processing modules A → B → C...',
      promptReady: 'Prompt ready to generate',
      viewPrompt: 'View prompt',
      hidePrompt: 'Hide prompt',
      generate: 'Generate Video',
      generating: 'Generating...',
      duration: 'Duration',
      seconds: 'seconds',
      resolution: 'Resolution',
      generatedVideos: 'Generated Videos',
      noVideos: 'No videos generated yet',
      download: 'Download',
      error: 'Error generating video',
      processing: 'Processing video...',
      visualDNA: 'Visual DNA',
      cinematicScript: 'Cinematic Script',
      motherPromptLabel: 'Mother Prompt'
    }
  }

  const t = labels[language]

  // Load product and scripts
  useEffect(() => {
    async function loadData() {
      if (!productId || !user) return
      try {
        const productData = await getProduct(productId)
        setProduct(productData)
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [productId, user])

  // Timer for elapsed seconds display
  useEffect(() => {
    if (!pollStartTime) {
      setElapsedSeconds(0)
      return
    }
    const timerInterval = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - pollStartTime) / 1000))
    }, 1000)
    return () => clearInterval(timerInterval)
  }, [pollStartTime])

  // Polling for video result
  useEffect(() => {
    if (!pollingRequestId) return

    if (!pollStartTime) {
      setPollStartTime(Date.now())
      setPollCount(0)
      setLastPollStatus(language === 'es' ? 'Iniciando...' : 'Starting...')
    }

    const pollInterval = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        
        if (!token) {
          setPollingRequestId(null)
          setGenerating(false)
          setPollStartTime(null)
          return
        }

        setPollCount(prev => prev + 1)

        const response = await fetch(VIDEO_API_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ action: 'poll', requestId: pollingRequestId })
        })

        const result = await response.json()
        const debugInfo = result.debug || {}
        setLastPollStatus(`${result.status} | ${debugInfo.rawStatus || '...'}`)

        if (result.status === 'Ready' && result.result?.sample) {
          setGeneratedVideos(prev => [{
            id: pollingRequestId,
            videoUrl: result.result.sample,
            prompt: motherPrompt || scriptText,
            duration: result.result.duration || duration,
            createdAt: new Date()
          }, ...prev])
          setPollingRequestId(null)
          setGenerating(false)
          setPollStartTime(null)
          setLastPollStatus(null)
        } else if (result.status === 'Error' || result.status === 'Failed') {
          setError(`Error: ${result.error || result.debug?.rawStatus || t.error}`)
          setPollingRequestId(null)
          setGenerating(false)
          setPollStartTime(null)
          setLastPollStatus(null)
        }
        
        if (pollCount > 100) {
          setError(language === 'es' 
            ? 'Generación de video agotó el tiempo (5 min). Intenta de nuevo.'
            : 'Video generation timed out (5 min). Please try again.')
          setPollingRequestId(null)
          setGenerating(false)
          setPollStartTime(null)
          setLastPollStatus(null)
        }
      } catch (err) {
        console.error('Polling error:', err)
        setLastPollStatus(language === 'es' ? 'Error de conexión' : 'Connection error')
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [pollingRequestId, motherPrompt, scriptText, duration, t.error, pollStartTime, pollCount, language])

  // Handle multiple image uploads
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setUploadedImages(prev => [...prev, ev.target!.result as string])
        }
      }
      reader.readAsDataURL(file)
    })
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
  }

  // Build product context string
  const getProductContext = () => {
    if (!product) return ''
    const parts: string[] = []
    if (product.name) parts.push(`Producto: ${product.name}`)
    if (product.description || product.product_description) {
      parts.push(`Descripción: ${product.description || product.product_description}`)
    }
    if (product.type) parts.push(`Tipo: ${product.type}`)
    if (product.main_problem) parts.push(`Problema principal: ${product.main_problem}`)
    if (product.expected_result) parts.push(`Resultado esperado: ${product.expected_result}`)
    if (product.differentiation) parts.push(`Diferenciación: ${product.differentiation}`)
    return parts.join('. ')
  }

  // STEP 2: Build Ad Prompt (Module A → B → C)
  const handleBuildPrompt = async () => {
    if (!scriptText.trim()) return

    setBuildingPrompt(true)
    setError('')
    setMotherPrompt('')
    setVisualDNA('')
    setCinematicScript('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      
      if (!token) {
        throw new Error(language === 'es' ? 'No estás autenticado.' : 'Not authenticated.')
      }

      // Build photo descriptions for Module A
      let productPhotosDescription = ''
      if (uploadedImages.length > 0) {
        productPhotosDescription = `${uploadedImages.length} foto(s) del producto subidas. `
      }
      // Add product context as visual reference
      productPhotosDescription += getProductContext()

      const response = await fetch(BUILD_PROMPT_API_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          script: scriptText.trim(),
          productContext: getProductContext(),
          productPhotosDescription,
          duration
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || result.message || 'Failed to build prompt')
      }

      setMotherPrompt(result.motherPrompt)
      setVisualDNA(result.visualDNA || '')
      setCinematicScript(result.cinematicScript || '')
      setShowPromptPreview(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error building ad prompt')
    } finally {
      setBuildingPrompt(false)
    }
  }

  // STEP 3: Generate Video with Mother Prompt
  const handleGenerate = async () => {
    if (!motherPrompt && !scriptText.trim()) return

    setGenerating(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      
      if (!token) {
        throw new Error(language === 'es' ? 'No estás autenticado.' : 'Not authenticated.')
      }
      
      const requestBody: Record<string, unknown> = {
        prompt: scriptText.trim() || 'Ad video generation',
        motherPrompt: motherPrompt || undefined,
        duration,
        aspect_ratio: '9:16' as AspectRatio,
        resolution
      }

      // If we have an uploaded image, send the first one as reference
      if (uploadedImages.length > 0) {
        requestBody.image_url = uploadedImages[0]
      }

      const response = await fetch(VIDEO_API_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || t.error)
      }

      if (result.requestId) {
        setPollingRequestId(result.requestId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error)
      setGenerating(false)
    }
  }

  const handleDownload = async (videoUrl: string, index: number) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      
      const proxyUrl = import.meta.env.PROD 
        ? `/api/proxy-video?url=${encodeURIComponent(videoUrl)}`
        : `http://localhost:3000/api/proxy-video?url=${encodeURIComponent(videoUrl)}`
      
      const response = await fetch(proxyUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      
      if (!response.ok) throw new Error('Download failed')
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${product?.name || 'ad-video'}-${index + 1}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download failed:', err)
      setError(language === 'es' ? 'Error al descargar el video' : 'Failed to download video')
    }
  }

  const getProductIcon = (type: string) => {
    switch (type) {
      case 'service': return Briefcase
      case 'restaurant': return UtensilsCrossed
      case 'real_estate': return Home
      default: return Package
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </Layout>
    )
  }

  if (!product) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <p className="text-dark-600">{language === 'es' ? 'Producto no encontrado' : 'Product not found'}</p>
        </div>
      </Layout>
    )
  }

  const ProductIcon = getProductIcon(product.type)

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link 
            to="/broll" 
            className="p-2 hover:bg-dark-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-600" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <ProductIcon className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-dark-800">{product.name}</h1>
              <p className="text-sm text-dark-500">{t.subtitle}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Ad Video Builder */}
          <div className="space-y-5">
            {/* STEP 1: Select Winning Script */}
            <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-6">
              <h2 className="text-sm font-semibold text-dark-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary-600" />
                {t.step1}
              </h2>

              <textarea
                value={scriptText}
                onChange={(e) => {
                  setScriptText(e.target.value)
                  setMotherPrompt('')
                  setVisualDNA('')
                  setCinematicScript('')
                }}
                placeholder={t.pasteScript}
                rows={6}
                className="w-full px-4 py-3 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none text-sm"
              />
            </div>

            {/* STEP 2: Product Photos */}
            <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-6">
              <h2 className="text-sm font-semibold text-dark-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Upload className="w-4 h-4 text-primary-600" />
                {t.step2}
              </h2>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-dark-200 rounded-xl p-4 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors"
              >
                <Upload className="w-6 h-6 text-dark-400 mx-auto mb-1" />
                <p className="text-sm text-dark-500">{t.uploadHint}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>

              {uploadedImages.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {uploadedImages.map((img, i) => (
                    <div key={i} className="relative">
                      <img src={img} alt={`Photo ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-dark-100" />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* STEP 3: Build & Generate */}
            <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-6">
              <h2 className="text-sm font-semibold text-dark-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Clapperboard className="w-4 h-4 text-primary-600" />
                {t.step3}
              </h2>

              {/* Video Settings */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-dark-600 mb-1.5">
                    {t.duration}: {duration}s
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="15"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-dark-400 mt-0.5">
                    <span>5s</span>
                    <span>15s</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-dark-600 mb-1.5">
                    {t.resolution}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => setResolution('720p')}
                      className={`p-1.5 rounded-lg text-xs transition-colors ${
                        resolution === '720p'
                          ? 'bg-primary-100 text-primary-700 border border-primary-500'
                          : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                      }`}
                    >
                      720p HD
                    </button>
                    <button
                      onClick={() => setResolution('480p')}
                      className={`p-1.5 rounded-lg text-xs transition-colors ${
                        resolution === '480p'
                          ? 'bg-primary-100 text-primary-700 border border-primary-500'
                          : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                      }`}
                    >
                      480p
                    </button>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Build Prompt Button */}
              {!motherPrompt && (
                <button
                  onClick={handleBuildPrompt}
                  disabled={!scriptText.trim() || buildingPrompt}
                  className="w-full py-3 bg-dark-800 text-white rounded-lg font-medium hover:bg-dark-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 mb-3"
                >
                  {buildingPrompt ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t.building}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      {t.buildPrompt}
                    </>
                  )}
                </button>
              )}

              {/* Prompt Preview */}
              {motherPrompt && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-green-700 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4" />
                      {t.promptReady}
                    </span>
                    <button
                      onClick={() => setShowPromptPreview(!showPromptPreview)}
                      className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                    >
                      {showPromptPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {showPromptPreview ? t.hidePrompt : t.viewPrompt}
                    </button>
                  </div>

                  {showPromptPreview && (
                    <div className="space-y-3">
                      {visualDNA && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="text-xs font-semibold text-blue-700 mb-1">{t.visualDNA}</p>
                          <p className="text-xs text-blue-600 whitespace-pre-wrap max-h-24 overflow-y-auto">{visualDNA}</p>
                        </div>
                      )}
                      {cinematicScript && (
                        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                          <p className="text-xs font-semibold text-purple-700 mb-1">{t.cinematicScript}</p>
                          <p className="text-xs text-purple-600 whitespace-pre-wrap max-h-32 overflow-y-auto">{cinematicScript}</p>
                        </div>
                      )}
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-xs font-semibold text-green-700 mb-1">{t.motherPromptLabel}</p>
                        <p className="text-xs text-green-600 whitespace-pre-wrap max-h-40 overflow-y-auto">{motherPrompt}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Generate Video Button */}
              <button
                onClick={handleGenerate}
                disabled={generating || !motherPrompt}
                className="w-full py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t.generating}
                  </>
                ) : (
                  <>
                    <Video className="w-5 h-5" />
                    {t.generate}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right: Generated Videos */}
          <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-6 h-fit lg:sticky lg:top-24">
            <h2 className="text-lg font-semibold text-dark-800 mb-4 flex items-center gap-2">
              <Play className="w-5 h-5 text-primary-600" />
              {t.generatedVideos}
            </h2>

            {generating && pollingRequestId && (
              <div className="mb-4 p-4 bg-primary-50 rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                  <div>
                    <p className="text-sm font-medium text-primary-700">{t.processing}</p>
                    <p className="text-xs text-primary-500">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {duration}s @ {resolution} • 9:16
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-primary-100 text-xs text-primary-600 space-y-1">
                  <p>⏱️ {elapsedSeconds}s</p>
                  <p>🔄 {pollCount}</p>
                  {lastPollStatus && <p>📡 {lastPollStatus}</p>}
                </div>
              </div>
            )}

            {generatedVideos.length === 0 && !generating ? (
              <div className="text-center py-16 text-dark-400">
                <Video className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">{t.noVideos}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {generatedVideos.map((video, index) => (
                  <div key={video.id} className="relative group">
                    <video
                      src={video.videoUrl}
                      controls
                      className="w-full rounded-lg bg-black"
                      style={{ maxHeight: '400px' }}
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-xs text-dark-500">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {video.duration}s • {new Date(video.createdAt).toLocaleTimeString()}
                      </div>
                      <button
                        onClick={() => handleDownload(video.videoUrl, index)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-dark-100 text-dark-700 rounded-lg hover:bg-dark-200 transition-colors text-sm"
                      >
                        <Download className="w-4 h-4" />
                        {t.download}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
