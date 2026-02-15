import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProduct, getProductPosts, createPost, updatePostStatus, getScripts } from '../services/database'
import type { Product, Script, ImageModel } from '../types'
import Layout from '../components/Layout'
import { uploadPostImage } from '../utils/imageCompression'
import { 
  ArrowLeft,
  ImageIcon,
  Upload,
  X,
  Sparkles,
  Download,
  FileText,
  Loader2,
  Cpu,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import GeneratingPlaceholder from '../components/GeneratingPlaceholder'
import UsageBanner from '../components/UsageBanner'
import { useUsageLimits } from '../hooks/useUsageLimits'

type PostAspectRatio = '9:16' | '3:4'

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
  const [scripts, setScripts] = useState<Script[]>([])
  const [selectedScript, setSelectedScript] = useState<Script | null>(null)
  const [scriptText, setScriptText] = useState('')
  const [showScriptPicker, setShowScriptPicker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([])
  const [error, setError] = useState('')
  const [imageModel, setImageModel] = useState<ImageModel>('nano-banana-pro')
  const [aspectRatio, setAspectRatio] = useState<PostAspectRatio>('9:16')
  const usageLimits = useUsageLimits()

  const labels = {
    es: {
      back: 'Volver',
      title: 'Generar Post',
      subtitle: 'Transforma un guión en un post de venta directa',
      scriptLabel: 'Guión',
      selectScript: 'Seleccionar guión guardado',
      pasteScript: 'O pega un guión directamente',
      scriptPlaceholder: 'Pega aquí tu guión con estructura Gancho / Desarrollo / CTA...',
      noScripts: 'No hay guiones guardados. Genera guiones primero en Scripts.',
      scriptsFor: 'Guiones de',
      selectedScript: 'Guión seleccionado',
      refImages: 'Imágenes del producto (opcional)',
      refHint: 'Sube fotos del producto para mayor precisión visual (máx. 4)',
      generate: 'Generar Post',
      generating: 'Generando post...',
      generatedImages: 'Posts Generados',
      noImages: 'Selecciona un guión y genera tu primer post',
      download: 'Descargar',
      error: 'Error al generar post',
      imageModel: 'Modelo de IA',
      nanoBanana: 'Gemini Flash',
      nanoBananaPro: 'Gemini Pro',
      grokImagine: 'Grok Imagine',
      formatLabel: 'Formato',
      reelStory: 'Reel / Story',
      squarePost: 'Post Feed'
    },
    en: {
      back: 'Back',
      title: 'Generate Post',
      subtitle: 'Transform a script into a direct sale post',
      scriptLabel: 'Script',
      selectScript: 'Select saved script',
      pasteScript: 'Or paste a script directly',
      scriptPlaceholder: 'Paste your script with Hook / Development / CTA structure...',
      noScripts: 'No saved scripts. Generate scripts first in Scripts workspace.',
      scriptsFor: 'Scripts for',
      selectedScript: 'Selected script',
      refImages: 'Product images (optional)',
      refHint: 'Upload product photos for better visual accuracy (max 4)',
      generate: 'Generate Post',
      generating: 'Generating post...',
      generatedImages: 'Generated Posts',
      noImages: 'Select a script and generate your first post',
      download: 'Download',
      error: 'Error generating post',
      imageModel: 'AI Model',
      nanoBanana: 'Gemini Flash',
      nanoBananaPro: 'Gemini Pro',
      grokImagine: 'Grok Imagine',
      formatLabel: 'Format',
      reelStory: 'Reel / Story',
      squarePost: 'Feed Post'
    }
  }

  const t = labels[language]

  useEffect(() => {
    async function loadData() {
      if (!productId || !user) return
      try {
        const [productData, scriptsData, savedPosts] = await Promise.all([
          getProduct(productId),
          getScripts(productId),
          getProductPosts(productId)
        ])
        setProduct(productData)
        setScripts(scriptsData)

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
      } catch (err) {
        console.error('Failed to load data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [productId, user])

  const getScriptPrompt = (): string => {
    if (selectedScript) return selectedScript.content
    return scriptText.trim()
  }

  const normalizeImageToJpeg = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('Canvas not supported')); return }
          ctx.drawImage(img, 0, 0)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
          URL.revokeObjectURL(url)
          resolve(dataUrl)
        } catch (err) {
          URL.revokeObjectURL(url)
          reject(err)
        }
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        if (['heic', 'heif'].includes(ext)) {
          reject(new Error(language === 'es'
            ? 'Formato HEIC no soportado. Exporta la foto como JPEG desde tu iPhone o usa Safari.'
            : 'HEIC format not supported. Export the photo as JPEG from your iPhone or use Safari.'))
        } else {
          reject(new Error(language === 'es' ? `Formato no soportado: .${ext}` : `Unsupported format: .${ext}`))
        }
      }
      img.src = url
    })
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const maxImages = 4 - uploadedImages.length
    const filesToProcess = Array.from(files).slice(0, maxImages)

    const results: string[] = []
    for (const file of filesToProcess) {
      try {
        const jpeg = await normalizeImageToJpeg(file)
        results.push(jpeg)
      } catch (err) {
        console.error('Image processing failed:', err)
        setError(err instanceof Error ? err.message : (language === 'es' ? 'Error al procesar imagen' : 'Error processing image'))
      }
    }
    if (results.length > 0) {
      setUploadedImages(prev => [...prev, ...results])
    }
  }

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    const script = getScriptPrompt()
    if (!script) return

    setGenerating(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error(language === 'es' ? 'No estás autenticado.' : 'Not authenticated.')

      const isVertical = aspectRatio === '9:16'
      const requestBody: Record<string, unknown> = {
        prompt: script,
        mode: 'post',
        aspectRatio,
        width: isVertical ? 1080 : 1080,
        height: isVertical ? 1920 : 1440,
        output_format: 'jpeg',
        model: imageModel
      }

      if (uploadedImages.length > 0) {
        uploadedImages.forEach((img, i) => {
          requestBody[i === 0 ? 'input_image' : `input_image_${i + 1}`] = img
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
      if (!response.ok) throw new Error(result.error || t.error)

      if (result.status === 'Ready' && result.result?.sample) {
        const imageUrl = result.result.sample
        let savedUrl = imageUrl
        let postId = `post-${Date.now()}`

        try {
          if (user && productId) {
            savedUrl = await uploadPostImage(user.id, productId, imageUrl)
            const post = await createPost(productId, user.id, {
              prompt: script,
              width: aspectRatio === '9:16' ? 1080 : 1080,
              height: aspectRatio === '9:16' ? 1920 : 1440,
              output_format: 'webp',
              model: imageModel
            })
            postId = post.id
            await updatePostStatus(postId, 'completed', savedUrl)
          }
        } catch (saveErr) {
          console.error('Failed to save image:', saveErr)
        }

        setGeneratedPosts(prev => [{
          id: postId,
          imageUrl: savedUrl,
          prompt: script,
          createdAt: new Date(),
          model: imageModel,
          saved: !!user && !!productId
        }, ...prev])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error)
    } finally {
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

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
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

  const hasScript = !!selectedScript || !!scriptText.trim()

  return (
    <Layout>
      <div className="h-full flex flex-col lg:flex-row">
        {/* Left Panel — Script Input & Settings */}
        <div className="w-full lg:w-[420px] bg-white border-b lg:border-b-0 lg:border-r border-dark-100 flex flex-col min-h-0 lg:overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-dark-100">
            <Link
              to="/posts"
              className="inline-flex items-center gap-1.5 text-dark-400 hover:text-dark-600 text-xs font-medium tracking-wide uppercase transition-colors mb-3"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t.back}
            </Link>
            <h1 className="text-lg font-semibold text-dark-900">{product.name}</h1>
            <p className="text-xs text-dark-400 mt-0.5">{t.subtitle}</p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
            {/* Script selector */}
            <div>
              <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                {t.scriptLabel}
              </label>

              {/* Saved scripts picker */}
              <div className="relative">
                <button
                  onClick={() => setShowScriptPicker(!showScriptPicker)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-dark-50 rounded-lg text-sm text-dark-700 hover:bg-dark-100 transition-colors"
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 text-dark-400 flex-shrink-0" />
                    {selectedScript
                      ? selectedScript.title
                      : t.selectScript
                    }
                  </span>
                  {showScriptPicker ? <ChevronUp className="w-4 h-4 text-dark-400" /> : <ChevronDown className="w-4 h-4 text-dark-400" />}
                </button>

                {showScriptPicker && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-dark-100 z-50 max-h-[50vh] overflow-y-auto">
                    {scripts.length > 0 ? (
                      <div className="p-2 space-y-0.5">
                        {scripts.map(script => (
                          <button
                            key={script.id}
                            onClick={() => {
                              setSelectedScript(script)
                              setScriptText('')
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

              {/* Selected script preview */}
              {selectedScript && (
                <div className="mt-2 bg-primary-50/50 border border-primary-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-semibold text-primary-700 uppercase tracking-wide">{t.selectedScript}</p>
                    <button
                      onClick={() => setSelectedScript(null)}
                      className="text-[10px] text-primary-500 hover:text-primary-700 font-medium"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-xs text-dark-600 leading-relaxed line-clamp-6 whitespace-pre-wrap">{selectedScript.content}</p>
                </div>
              )}

              {/* Or paste directly */}
              {!selectedScript && (
                <>
                  <p className="text-[10px] text-dark-400 text-center my-2">{t.pasteScript}</p>
                  <textarea
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    placeholder={t.scriptPlaceholder}
                    rows={6}
                    className="w-full text-sm border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                  />
                </>
              )}
            </div>

            {/* Product images (optional) */}
            <div>
              <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                {t.refImages}
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-dashed border-dark-200 rounded-lg p-3 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
              >
                <Upload className="w-5 h-5 text-dark-300 mx-auto mb-1" />
                <p className="text-[10px] text-dark-400">{t.refHint}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
              {uploadedImages.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {uploadedImages.map((img, i) => (
                    <div key={i} className="relative">
                      <img src={img} alt={`Ref ${i + 1}`} className="w-14 h-14 object-cover rounded-lg" />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-dark-600 text-white rounded-full flex items-center justify-center hover:bg-dark-800 transition-colors"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Model */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                <Cpu className="w-3.5 h-3.5 text-primary-500" />
                {t.imageModel}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { id: 'nano-banana' as ImageModel, name: t.nanoBanana, sub: 'Gemini 2.5' },
                  { id: 'nano-banana-pro' as ImageModel, name: t.nanoBananaPro, sub: 'Gemini 3' },
                  { id: 'grok-imagine' as ImageModel, name: t.grokImagine, sub: 'xAI' },
                ] as const).map(m => (
                  <button
                    key={m.id}
                    onClick={() => setImageModel(m.id)}
                    className={`p-2.5 rounded-lg text-xs transition-colors ${
                      imageModel === m.id
                        ? 'bg-primary-50 text-primary-700 border border-primary-300'
                        : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                    }`}
                  >
                    <div className="font-medium">{m.name}</div>
                    <div className={`text-[10px] mt-0.5 ${imageModel === m.id ? 'text-primary-500' : 'text-dark-400'}`}>
                      {m.sub}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                <ImageIcon className="w-3.5 h-3.5 text-primary-500" />
                {t.formatLabel}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: '9:16' as PostAspectRatio, name: t.reelStory, sub: '9:16' },
                  { id: '3:4' as PostAspectRatio, name: t.squarePost, sub: '3:4' },
                ] as const).map(f => (
                  <button
                    key={f.id}
                    onClick={() => setAspectRatio(f.id)}
                    className={`p-2.5 rounded-lg text-xs transition-colors ${
                      aspectRatio === f.id
                        ? 'bg-primary-50 text-primary-700 border border-primary-300'
                        : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                    }`}
                  >
                    <div className="font-medium">{f.name}</div>
                    <div className={`text-[10px] mt-0.5 ${aspectRatio === f.id ? 'text-primary-500' : 'text-dark-400'}`}>
                      {f.sub}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}
          </div>

          {/* Usage Banner */}
          <UsageBanner usage={usageLimits} resource="image" />

          {/* Generate Button */}
          <div className="px-5 py-4 border-t border-dark-100">
            <button
              onClick={handleGenerate}
              disabled={generating || !hasScript}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary-600 text-white font-medium text-sm hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* Right Panel — Generated Posts */}
        <div className="flex-1 bg-dark-50/50 overflow-auto">
          <div className="p-6">
            <h2 className="text-sm font-semibold text-dark-700 tracking-wide uppercase mb-4">{t.generatedImages}</h2>

            {generatedPosts.length > 0 || generating ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {generating && (
                  <GeneratingPlaceholder
                    aspectRatio={aspectRatio === '9:16' ? '9/16' : '3/4'}
                    label={t.generating}
                    sublabel={imageModel}
                  />
                )}
                {generatedPosts.map((post, index) => (
                  <div key={post.id} className="bg-white rounded-xl shadow-sm border border-dark-100 overflow-hidden group">
                    <div className="relative">
                      <img
                        src={post.imageUrl}
                        alt={`Post ${index + 1}`}
                        className={`w-full object-cover ${post.imageUrl.includes('1440') || (post as any).aspectRatio === '3:4' ? 'aspect-[3/4]' : 'aspect-[9/16]'}`}
                        loading="lazy"
                      />
                      {post.model && (
                        <span className="absolute top-2 right-2 text-[9px] font-mono px-1.5 py-0.5 bg-black/40 text-white/80 rounded-md backdrop-blur-sm">
                          {post.model}
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <button
                        onClick={() => handleDownload(post.imageUrl, index)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dark-200 text-dark-600 text-xs font-medium hover:bg-dark-50 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {t.download}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-80 text-center">
                <div className="w-16 h-16 rounded-2xl bg-dark-100 flex items-center justify-center mb-4">
                  <ImageIcon className="w-8 h-8 text-dark-300" />
                </div>
                <p className="text-sm text-dark-400">{t.noImages}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
