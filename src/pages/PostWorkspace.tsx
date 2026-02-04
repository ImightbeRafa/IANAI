import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProduct, getProductPosts, createPost, updatePostStatus } from '../services/database'
import type { Product, ImageModel } from '../types'
import Layout from '../components/Layout'
import { uploadPostImage } from '../utils/imageCompression'
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
  Loader2,
  Cpu,
  Wand2
} from 'lucide-react'
import { supabase } from '../lib/supabase'

interface GeneratedPost {
  id: string
  imageUrl: string
  prompt: string
  createdAt: Date
  model?: string
  saved?: boolean
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
  const [textWarning, setTextWarning] = useState(false)
  const [enhancing, setEnhancing] = useState(false)

  // Image settings
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:5' | '9:16'>('1:1')
  const [imageModel, setImageModel] = useState<ImageModel>('nano-banana')

  const labels = {
    es: {
      back: 'Volver',
      title: 'Generar Post',
      subtitle: 'Crea imágenes para redes sociales',
      promptLabel: 'Describe tu imagen',
      promptPlaceholder: 'Ej: Mi producto en una mesa de madera con luz natural...',
      enhancePrompt: 'Mejorar con IA',
      enhancing: 'Mejorando...',
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
      error: 'Error al generar imagen',
      textWarningTitle: 'Nota sobre texto en imágenes',
      textWarningMessage: 'La IA no puede generar texto legible en imágenes. El texto solicitado se ha removido del prompt. Usa herramientas de edición (Canva, Photoshop) para agregar texto después.',
      imageModel: 'Modelo de IA',
      flux: 'Flux',
      nanoBanana: 'Nano Banana',
      nanoBananaPro: 'Nano Banana Pro',
      grokImagine: 'Grok Imagine'
    },
    en: {
      back: 'Back',
      title: 'Generate Post',
      subtitle: 'Create images for social media',
      promptLabel: 'Describe your image',
      promptPlaceholder: 'E.g: My product on a wooden table with natural light...',
      enhancePrompt: 'Enhance with AI',
      enhancing: 'Enhancing...',
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
      error: 'Error generating image',
      textWarningTitle: 'Note about text in images',
      textWarningMessage: 'AI cannot generate readable text in images. Text requests have been removed from the prompt. Use editing tools (Canva, Photoshop) to add text afterwards.',
      imageModel: 'AI Model',
      flux: 'Flux',
      nanoBanana: 'Nano Banana',
      nanoBananaPro: 'Nano Banana Pro',
      grokImagine: 'Grok Imagine'
    }
  }

  const t = labels[language]

  useEffect(() => {
    async function loadProductAndPosts() {
      if (!productId || !user) return
      try {
        const productData = await getProduct(productId)
        setProduct(productData)

        // Load saved posts for this product
        const savedPosts = await getProductPosts(productId)
        const loadedPosts: GeneratedPost[] = savedPosts
          .filter(post => post.status === 'completed' && post.generated_image_url)
          .map(post => ({
            id: post.id,
            imageUrl: post.generated_image_url!,
            prompt: post.prompt,
            createdAt: new Date(post.created_at),
            model: post.model,
            saved: true
          }))
        setGeneratedPosts(loadedPosts)
      } catch (error) {
        console.error('Failed to load product:', error)
      } finally {
        setLoading(false)
      }
    }
    loadProductAndPosts()
  }, [productId, user])

  // Polling for generation result
  useEffect(() => {
    if (!pollingTaskId) return

    const pollInterval = setInterval(async () => {
      try {
        // Get auth token for polling
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        
        if (!token) {
          console.error('No auth token for polling')
          setPollingTaskId(null)
          setGenerating(false)
          return
        }

        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ action: 'poll', taskId: pollingTaskId })
        })

        const result = await response.json()

        if (result.status === 'Ready' && result.result?.sample) {
          // Save to storage and database
          const imageUrl = result.result.sample
          let savedUrl = imageUrl
          let postId = pollingTaskId
          
          try {
            if (user && productId) {
              // Upload compressed image to storage
              savedUrl = await uploadPostImage(user.id, productId, imageUrl)
              
              // Save post to database
              const post = await createPost(productId, user.id, {
                prompt,
                width: 1080,
                height: 1080,
                output_format: 'webp',
                flux_task_id: pollingTaskId,
                model: 'flux'
              })
              postId = post.id
              
              // Update with the saved URL
              await updatePostStatus(postId, 'completed', savedUrl)
            }
          } catch (saveErr) {
            console.error('Failed to save image:', saveErr)
            // Continue with unsaved image - user can still see and download it
          }
          
          setGeneratedPosts(prev => [{
            id: postId,
            imageUrl: savedUrl,
            prompt: prompt,
            createdAt: new Date(),
            model: 'flux',
            saved: !!user && !!productId
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

  const ENHANCE_API_URL = import.meta.env.PROD ? '/api/enhance-prompt' : 'http://localhost:3000/api/enhance-prompt'

  const handleEnhancePrompt = async () => {
    if (!prompt.trim() || enhancing) return

    setEnhancing(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      
      if (!token) {
        throw new Error('No estás autenticado. Por favor inicia sesión.')
      }

      // Build product context for better enhancement
      let productContext = ''
      if (product) {
        const parts: string[] = []
        if (product.name) parts.push(`Producto: ${product.name}`)
        if (product.description || product.product_description) {
          parts.push(`Descripción: ${product.description || product.product_description}`)
        }
        if (product.type) parts.push(`Tipo: ${product.type}`)
        productContext = parts.join('. ')
      }

      const response = await fetch(ENHANCE_API_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          prompt: prompt.trim(),
          type: 'image',
          productContext
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Error al mejorar el prompt')
      }

      if (result.enhancedPrompt) {
        setPrompt(result.enhancedPrompt)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al mejorar el prompt')
    } finally {
      setEnhancing(false)
    }
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
    setTextWarning(false)

    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      
      if (!token) {
        throw new Error('No estás autenticado. Por favor inicia sesión.')
      }

      const { width, height } = getAspectDimensions()
      
      const requestBody: Record<string, unknown> = {
        prompt: prompt,
        width,
        height,
        output_format: 'jpeg',
        model: imageModel
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

      // Check if text was requested (and filtered out)
      if (result.textWarning) {
        setTextWarning(true)
      }

      // For Gemini models, result is immediate (no polling needed)
      if (result.status === 'Ready' && result.result?.sample) {
        const imageUrl = result.result.sample
        let savedUrl = imageUrl
        let postId = `gemini-${Date.now()}`
        
        try {
          if (user && productId) {
            // Upload compressed image to storage
            savedUrl = await uploadPostImage(user.id, productId, imageUrl)
            
            // Save post to database
            const post = await createPost(productId, user.id, {
              prompt,
              width: requestBody.width as number || 1080,
              height: requestBody.height as number || 1080,
              output_format: 'webp',
              model: imageModel
            })
            postId = post.id
            
            // Update with the saved URL
            await updatePostStatus(postId, 'completed', savedUrl)
          }
        } catch (saveErr) {
          console.error('Failed to save image:', saveErr)
        }
        
        setGeneratedPosts(prev => [{
          id: postId,
          imageUrl: savedUrl,
          prompt: prompt,
          createdAt: new Date(),
          model: imageModel,
          saved: !!user && !!productId
        }, ...prev])
        setGenerating(false)
      } else if (result.taskId) {
        // For Flux, start polling for result
        setPollingTaskId(result.taskId)
      }
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
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-dark-700">
                  {t.promptLabel}
                </label>
                <button
                  onClick={handleEnhancePrompt}
                  disabled={!prompt.trim() || enhancing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {enhancing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t.enhancing}
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3.5 h-3.5" />
                      {t.enhancePrompt}
                    </>
                  )}
                </button>
              </div>
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

            {/* AI Model Selector */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-2">
                <Cpu className="w-4 h-4 text-primary-500" />
                {t.imageModel}
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setImageModel('flux')}
                  className={`p-3 rounded-lg text-sm transition-colors ${
                    imageModel === 'flux'
                      ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                      : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                  }`}
                >
                  <div className="font-medium">{t.flux}</div>
                  <div className={`text-xs mt-0.5 ${imageModel === 'flux' ? 'text-primary-600' : 'text-dark-400'}`}>
                    BFL Klein
                  </div>
                </button>
                <button
                  onClick={() => setImageModel('nano-banana')}
                  className={`p-3 rounded-lg text-sm transition-colors ${
                    imageModel === 'nano-banana'
                      ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                      : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                  }`}
                >
                  <div className="font-medium">{t.nanoBanana}</div>
                  <div className={`text-xs mt-0.5 ${imageModel === 'nano-banana' ? 'text-primary-600' : 'text-dark-400'}`}>
                    Gemini 2.5
                  </div>
                </button>
                <button
                  onClick={() => setImageModel('nano-banana-pro')}
                  className={`p-3 rounded-lg text-sm transition-colors ${
                    imageModel === 'nano-banana-pro'
                      ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                      : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                  }`}
                >
                  <div className="font-medium">{t.nanoBananaPro}</div>
                  <div className={`text-xs mt-0.5 ${imageModel === 'nano-banana-pro' ? 'text-primary-600' : 'text-dark-400'}`}>
                    Gemini 3
                  </div>
                </button>
                <button
                  onClick={() => setImageModel('grok-imagine')}
                  className={`p-3 rounded-lg text-sm transition-colors ${
                    imageModel === 'grok-imagine'
                      ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                      : 'bg-dark-50 text-dark-600 border-2 border-transparent hover:bg-dark-100'
                  }`}
                >
                  <div className="font-medium">{t.grokImagine}</div>
                  <div className={`text-xs mt-0.5 ${imageModel === 'grok-imagine' ? 'text-primary-600' : 'text-dark-400'}`}>
                    xAI
                  </div>
                </button>
              </div>
            </div>

            {/* Text warning message */}
            {textWarning && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-800">{t.textWarningTitle}</p>
                <p className="text-sm text-amber-700 mt-1">{t.textWarningMessage}</p>
              </div>
            )}

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
