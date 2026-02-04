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
  Play
} from 'lucide-react'
import { supabase } from '../lib/supabase'

interface GeneratedVideo {
  id: string
  videoUrl: string
  prompt: string
  duration: number
  createdAt: Date
  saved?: boolean
}

const API_URL = import.meta.env.PROD ? '/api/generate-video' : 'http://localhost:3000/api/generate-video'

export default function BRollWorkspace() {
  const { productId } = useParams<{ productId: string }>()
  const { user } = useAuth()
  const { language } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>([])
  const [error, setError] = useState('')
  const [pollingRequestId, setPollingRequestId] = useState<string | null>(null)

  // Video settings
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9')
  const [duration, setDuration] = useState<number>(5)
  const [resolution, setResolution] = useState<VideoResolution>('720p')

  const labels = {
    es: {
      back: 'Volver',
      title: 'Generar B-Roll',
      subtitle: 'Crea videos cortos para contenido',
      promptLabel: 'Describe tu video',
      promptPlaceholder: 'Ej: Toma cinematográfica de café siendo servido con vapor...',
      uploadImage: 'Imagen de referencia (opcional)',
      uploadHint: 'Genera video a partir de una imagen',
      generate: 'Generar Video',
      generating: 'Generando...',
      aspectRatio: 'Formato',
      landscape: 'Horizontal (16:9)',
      square: 'Cuadrado (1:1)',
      portrait: 'Vertical (9:16)',
      duration: 'Duración',
      seconds: 'segundos',
      resolution: 'Resolución',
      generatedVideos: 'Videos Generados',
      noVideos: 'Aún no hay videos generados',
      download: 'Descargar',
      regenerate: 'Regenerar',
      productInfo: 'Información del producto',
      useProductContext: 'Usar contexto del producto',
      error: 'Error al generar video',
      processing: 'Procesando video...',
      ready: 'Video listo'
    },
    en: {
      back: 'Back',
      title: 'Generate B-Roll',
      subtitle: 'Create short videos for content',
      promptLabel: 'Describe your video',
      promptPlaceholder: 'E.g: Cinematic shot of coffee being poured with steam...',
      uploadImage: 'Reference image (optional)',
      uploadHint: 'Generate video from an image',
      generate: 'Generate Video',
      generating: 'Generating...',
      aspectRatio: 'Format',
      landscape: 'Landscape (16:9)',
      square: 'Square (1:1)',
      portrait: 'Portrait (9:16)',
      duration: 'Duration',
      seconds: 'seconds',
      resolution: 'Resolution',
      generatedVideos: 'Generated Videos',
      noVideos: 'No videos generated yet',
      download: 'Download',
      regenerate: 'Regenerate',
      productInfo: 'Product info',
      useProductContext: 'Use product context',
      error: 'Error generating video',
      processing: 'Processing video...',
      ready: 'Video ready'
    }
  }

  const t = labels[language]

  useEffect(() => {
    async function loadProduct() {
      if (!productId || !user) return
      try {
        const productData = await getProduct(productId)
        setProduct(productData)
        
        if (productData) {
          const contextPrompt = buildProductContextPrompt(productData)
          setPrompt(contextPrompt)
        }
      } catch (error) {
        console.error('Failed to load product:', error)
      } finally {
        setLoading(false)
      }
    }
    loadProduct()
  }, [productId, user])

  // Polling for video result
  useEffect(() => {
    if (!pollingRequestId) return

    const pollInterval = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        
        if (!token) {
          console.error('No auth token for polling')
          setPollingRequestId(null)
          setGenerating(false)
          return
        }

        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ action: 'poll', requestId: pollingRequestId })
        })

        const result = await response.json()

        if (result.status === 'Ready' && result.result?.sample) {
          setGeneratedVideos(prev => [{
            id: pollingRequestId,
            videoUrl: result.result.sample,
            prompt: prompt,
            duration: result.result.duration || duration,
            createdAt: new Date()
          }, ...prev])
          setPollingRequestId(null)
          setGenerating(false)
        } else if (result.status === 'Error' || result.status === 'Failed') {
          setError(result.error || t.error)
          setPollingRequestId(null)
          setGenerating(false)
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }, 3000) // Poll every 3 seconds for video (takes longer than images)

    return () => clearInterval(pollInterval)
  }, [pollingRequestId, prompt, duration, t.error])

  const buildProductContextPrompt = (product: Product): string => {
    const parts: string[] = []
    
    if (product.name) {
      parts.push(`Product: ${product.name}`)
    }
    if (product.description || product.product_description) {
      parts.push(`Description: ${product.description || product.product_description}`)
    }
    if (product.type) {
      parts.push(`Type: ${product.type}`)
    }

    return parts.length > 0 
      ? `B-Roll video for: ${parts.join('. ')}`
      : ''
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      if (e.target?.result) {
        setUploadedImage(e.target.result as string)
      }
    }
    reader.readAsDataURL(file)
  }

  const removeImage = () => {
    setUploadedImage(null)
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) return

    setGenerating(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      
      if (!token) {
        throw new Error('No estás autenticado. Por favor inicia sesión.')
      }
      
      const requestBody: Record<string, unknown> = {
        prompt: prompt,
        duration,
        aspect_ratio: aspectRatio,
        resolution
      }

      if (uploadedImage) {
        requestBody.image_url = uploadedImage
      }

      const response = await fetch(API_URL, {
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
      const response = await fetch(videoUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${product?.name || 'broll'}-${index + 1}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download failed:', err)
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
          <p className="text-dark-600">Producto no encontrado</p>
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
          {/* Left: Video Generation Form */}
          <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-6">
            <h2 className="text-lg font-semibold text-dark-800 mb-4 flex items-center gap-2">
              <Video className="w-5 h-5 text-primary-600" />
              {t.title}
            </h2>

            <div className="space-y-4">
              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.promptLabel}
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t.promptPlaceholder}
                  rows={4}
                  className="w-full px-4 py-3 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                />
              </div>

              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.uploadImage}
                </label>
                {!uploadedImage ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-dark-200 rounded-xl p-4 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors"
                  >
                    <Upload className="w-8 h-8 text-dark-400 mx-auto mb-2" />
                    <p className="text-sm text-dark-500">{t.uploadHint}</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </div>
                ) : (
                  <div className="relative inline-block">
                    <img
                      src={uploadedImage}
                      alt="Reference"
                      className="w-32 h-32 object-cover rounded-lg"
                    />
                    <button
                      onClick={removeImage}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Aspect Ratio */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.aspectRatio}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setAspectRatio('16:9')}
                    className={`p-2 rounded-lg text-sm transition-colors ${
                      aspectRatio === '16:9'
                        ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                        : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                    }`}
                  >
                    {t.landscape}
                  </button>
                  <button
                    onClick={() => setAspectRatio('1:1')}
                    className={`p-2 rounded-lg text-sm transition-colors ${
                      aspectRatio === '1:1'
                        ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                        : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                    }`}
                  >
                    {t.square}
                  </button>
                  <button
                    onClick={() => setAspectRatio('9:16')}
                    className={`p-2 rounded-lg text-sm transition-colors ${
                      aspectRatio === '9:16'
                        ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                        : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                    }`}
                  >
                    {t.portrait}
                  </button>
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.duration}: {duration} {t.seconds}
                </label>
                <input
                  type="range"
                  min="1"
                  max="15"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-dark-400 mt-1">
                  <span>1s</span>
                  <span>15s</span>
                </div>
              </div>

              {/* Resolution */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.resolution}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setResolution('720p')}
                    className={`p-2 rounded-lg text-sm transition-colors ${
                      resolution === '720p'
                        ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                        : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                    }`}
                  >
                    720p HD
                  </button>
                  <button
                    onClick={() => setResolution('480p')}
                    className={`p-2 rounded-lg text-sm transition-colors ${
                      resolution === '480p'
                        ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                        : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                    }`}
                  >
                    480p
                  </button>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className="w-full py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t.generating}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    {t.generate}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right: Generated Videos */}
          <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-6">
            <h2 className="text-lg font-semibold text-dark-800 mb-4 flex items-center gap-2">
              <Play className="w-5 h-5 text-primary-600" />
              {t.generatedVideos}
            </h2>

            {generating && pollingRequestId && (
              <div className="mb-4 p-4 bg-primary-50 rounded-lg flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                <div>
                  <p className="text-sm font-medium text-primary-700">{t.processing}</p>
                  <p className="text-xs text-primary-500">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {duration}s video
                  </p>
                </div>
              </div>
            )}

            {generatedVideos.length === 0 && !generating ? (
              <div className="text-center py-12 text-dark-400">
                <Video className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t.noVideos}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {generatedVideos.map((video, index) => (
                  <div key={video.id} className="relative group">
                    <video
                      src={video.videoUrl}
                      controls
                      className="w-full rounded-lg bg-black"
                      style={{ maxHeight: '300px' }}
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-xs text-dark-500">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {video.duration}s • {new Date(video.createdAt).toLocaleTimeString()}
                      </div>
                      <button
                        onClick={() => handleDownload(video.videoUrl, index)}
                        className="flex items-center gap-1 px-3 py-1 bg-dark-100 text-dark-700 rounded-lg hover:bg-dark-200 transition-colors text-sm"
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
