import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProduct } from '../services/database'
import type { Product } from '../types'
import Layout from '../components/Layout'
import { 
  ArrowLeft,
  ImageIcon,
  Upload,
  X,
  Sparkles,
  Download,
  RefreshCw,
  Package,
  Briefcase,
  UtensilsCrossed,
  Home,
  Loader2
} from 'lucide-react'

interface GeneratedPost {
  id: string
  imageUrl: string
  prompt: string
  createdAt: Date
}

const API_URL = import.meta.env.PROD ? '/api/generate-image' : 'http://localhost:3000/api/generate-image'

export default function PostWorkspace() {
  const { productId } = useParams<{ productId: string }>()
  const { user } = useAuth()
  const { language } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([])
  const [error, setError] = useState('')
  const [pollingTaskId, setPollingTaskId] = useState<string | null>(null)

  // Image settings
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:5' | '9:16'>('1:1')

  const labels = {
    es: {
      back: 'Volver',
      title: 'Generar Post',
      subtitle: 'Crea imágenes para Instagram',
      promptLabel: 'Describe tu imagen',
      promptPlaceholder: 'Ej: Foto profesional del producto sobre fondo blanco con iluminación suave...',
      uploadImages: 'Subir imágenes de referencia',
      uploadHint: 'Arrastra imágenes o haz clic para subir (máx. 4)',
      generate: 'Generar Imagen',
      generating: 'Generando...',
      aspectRatio: 'Formato',
      square: 'Cuadrado (1:1)',
      portrait: 'Vertical (4:5)',
      story: 'Historia (9:16)',
      generatedImages: 'Imágenes Generadas',
      noImages: 'Aún no hay imágenes generadas',
      download: 'Descargar',
      regenerate: 'Regenerar',
      productInfo: 'Información del producto',
      useProductContext: 'Usar contexto del producto',
      error: 'Error al generar imagen'
    },
    en: {
      back: 'Back',
      title: 'Generate Post',
      subtitle: 'Create images for Instagram',
      promptLabel: 'Describe your image',
      promptPlaceholder: 'E.g: Professional product photo on white background with soft lighting...',
      uploadImages: 'Upload reference images',
      uploadHint: 'Drag images or click to upload (max 4)',
      generate: 'Generate Image',
      generating: 'Generating...',
      aspectRatio: 'Format',
      square: 'Square (1:1)',
      portrait: 'Portrait (4:5)',
      story: 'Story (9:16)',
      generatedImages: 'Generated Images',
      noImages: 'No images generated yet',
      download: 'Download',
      regenerate: 'Regenerate',
      productInfo: 'Product info',
      useProductContext: 'Use product context',
      error: 'Error generating image'
    }
  }

  const t = labels[language]

  useEffect(() => {
    async function loadProduct() {
      if (!productId || !user) return
      try {
        const productData = await getProduct(productId)
        setProduct(productData)
        
        // Pre-fill prompt with product context
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

  // Polling for generation result
  useEffect(() => {
    if (!pollingTaskId) return

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'poll', taskId: pollingTaskId })
        })

        const result = await response.json()

        if (result.status === 'Ready' && result.result?.sample) {
          setGeneratedPosts(prev => [{
            id: pollingTaskId,
            imageUrl: result.result.sample,
            prompt: prompt,
            createdAt: new Date()
          }, ...prev])
          setPollingTaskId(null)
          setGenerating(false)
        } else if (result.status === 'Error' || result.status === 'Failed') {
          setError(result.error || t.error)
          setPollingTaskId(null)
          setGenerating(false)
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }, 1000)

    return () => clearInterval(pollInterval)
  }, [pollingTaskId, prompt, t.error])

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
      ? `Create a professional Instagram post image for: ${parts.join('. ')}`
      : ''
  }

  const getAspectDimensions = () => {
    switch (aspectRatio) {
      case '4:5': return { width: 1080, height: 1350 }
      case '9:16': return { width: 1080, height: 1920 }
      default: return { width: 1080, height: 1080 }
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newImages: string[] = []
    const maxImages = 4 - uploadedImages.length

    Array.from(files).slice(0, maxImages).forEach(file => {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (e.target?.result) {
          newImages.push(e.target.result as string)
          if (newImages.length === Math.min(files.length, maxImages)) {
            setUploadedImages(prev => [...prev, ...newImages])
          }
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) return

    setGenerating(true)
    setError('')

    try {
      const { width, height } = getAspectDimensions()
      
      const requestBody: Record<string, unknown> = {
        prompt: prompt,
        width,
        height,
        output_format: 'jpeg'
      }

      // Add reference images if uploaded
      if (uploadedImages.length > 0) {
        uploadedImages.forEach((img, i) => {
          const key = i === 0 ? 'input_image' : `input_image_${i + 1}`
          requestBody[key] = img
        })
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || t.error)
      }

      // Start polling for result
      setPollingTaskId(result.taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error)
      setGenerating(false)
    }
  }

  const handleDownload = async (imageUrl: string, index: number) => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${product?.name || 'post'}-${index + 1}.jpg`
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

  const ProductIcon = getProductIcon(product.type)

  return (
    <Layout>
      <div className="h-full flex flex-col lg:flex-row">
        {/* Left Panel - Product Info & Settings */}
        <div className="w-full lg:w-96 bg-white border-b lg:border-b-0 lg:border-r border-dark-100 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-dark-100">
            <Link
              to="/posts"
              className="flex items-center gap-2 text-dark-600 hover:text-dark-900 mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              {t.back}
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                <ProductIcon className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h1 className="font-semibold text-dark-900">{product.name}</h1>
                <p className="text-sm text-dark-500 capitalize">{product.type}</p>
              </div>
            </div>
          </div>

          {/* Prompt Input */}
          <div className="p-4 flex-1 overflow-auto space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-2">
                {t.promptLabel}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t.promptPlaceholder}
                rows={4}
                className="input w-full resize-none"
              />
            </div>

            {/* Image Upload */}
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-2">
                {t.uploadImages}
              </label>
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
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
              
              {/* Uploaded images preview */}
              {uploadedImages.length > 0 && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {uploadedImages.map((img, i) => (
                    <div key={i} className="relative">
                      <img
                        src={img}
                        alt={`Reference ${i + 1}`}
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Aspect Ratio */}
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-2">
                {t.aspectRatio}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: '1:1', label: t.square },
                  { value: '4:5', label: t.portrait },
                  { value: '9:16', label: t.story }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setAspectRatio(option.value as '1:1' | '4:5' | '9:16')}
                    className={`p-2 rounded-lg text-sm font-medium transition-colors ${
                      aspectRatio === option.value
                        ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                        : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
          </div>

          {/* Generate Button */}
          <div className="p-4 border-t border-dark-100">
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.generating}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {t.generate}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Panel - Generated Images */}
        <div className="flex-1 bg-dark-50 p-6 overflow-auto">
          <h2 className="text-lg font-semibold text-dark-900 mb-4">{t.generatedImages}</h2>
          
          {generatedPosts.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {generatedPosts.map((post, index) => (
                <div key={post.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <img
                    src={post.imageUrl}
                    alt={`Generated post ${index + 1}`}
                    className="w-full aspect-square object-cover"
                  />
                  <div className="p-3 flex gap-2">
                    <button
                      onClick={() => handleDownload(post.imageUrl, index)}
                      className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
                    >
                      <Download className="w-4 h-4" />
                      {t.download}
                    </button>
                    <button
                      onClick={() => {
                        setPrompt(post.prompt)
                        handleGenerate()
                      }}
                      className="btn-secondary flex items-center justify-center gap-2 text-sm"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <ImageIcon className="w-16 h-16 text-dark-300 mb-4" />
              <p className="text-dark-500">{t.noImages}</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
