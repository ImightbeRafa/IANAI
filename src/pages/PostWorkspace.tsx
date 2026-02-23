import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProduct, getProductPostsPaginated, createPost, updatePostStatus, getScripts, getProductImages, createProductImage, deleteProductImage } from '../services/database'
import type { ProductImage } from '../services/database'
import type { Product, Script, ImageModel } from '../types'
import Layout from '../components/Layout'
import { uploadPostImageOriginal, uploadProductImage, urlToBase64, compressBase64ForApi } from '../utils/imageCompression'
import { 
  ArrowLeft,
  ImageIcon,
  Upload,
  X,
  Sparkles,
  Download,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Send,
  Wand2,
  Plus,
  Trash2,
  Pipette,
  Check
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import GeneratingPlaceholder from '../components/GeneratingPlaceholder'
import UsageBanner from '../components/UsageBanner'
import { useUsageLimits } from '../hooks/useUsageLimits'
import { IMAGE_PRESETS } from '../data/image-presets'
import { COLOR_PALETTES } from '../data/color-palettes'
import { getCustomPalettes, createCustomPalette, deleteCustomPalette } from '../services/database'
import type { CustomColorPalette } from '../services/database'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { language } = useLanguage()

  const [product, setProduct] = useState<Product | null>(null)
  const [scripts, setScripts] = useState<Script[]>([])
  const [selectedScript, setSelectedScript] = useState<Script | null>(null)
  const [scriptText, setScriptText] = useState('')
  const [showScriptPicker, setShowScriptPicker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([])
  const [error, setError] = useState('')
  const imageModel: ImageModel = 'nano-banana-pro'
  const [aspectRatio, setAspectRatio] = useState<PostAspectRatio>('9:16')
  const [postStyle, setPostStyle] = useState<string>('venta-directa')
  const [showStyleDropdown, setShowStyleDropdown] = useState(false)
  const [colorPaletteId, setColorPaletteId] = useState<string>('auto')
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [editing, setEditing] = useState(false)
  const [editRefImages, setEditRefImages] = useState<string[]>([])
  const editFileInputRef = useRef<HTMLInputElement>(null)
  const usageLimits = useUsageLimits()
  const [enhancingPostId, setEnhancingPostId] = useState<string | null>(null)
  const [customPalettes, setCustomPalettes] = useState<CustomColorPalette[]>([])
  const [showColorCreator, setShowColorCreator] = useState(false)
  const [newPaletteName, setNewPaletteName] = useState('')
  const [newPaletteColors, setNewPaletteColors] = useState<[string, string, string]>(['#000000', '#FFFFFF', '#0284c7'])
  const [customColors, setCustomColors] = useState<string[] | null>(null)
  const paletteImageInputRef = useRef<HTMLInputElement>(null)
  const [productImages, setProductImages] = useState<ProductImage[]>([])
  const [selectedProductImageIds, setSelectedProductImageIds] = useState<Set<string>>(new Set())
  const [uploadingProductImage, setUploadingProductImage] = useState(false)
  const productImageInputRef = useRef<HTMLInputElement>(null)
  const POSTS_PAGE_SIZE = 20
  const [totalPostCount, setTotalPostCount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  const labels = {
    es: {
      back: 'Volver',
      title: 'Generar Post',
      subtitle: 'Transforma un guión en un post visual profesional',
      styleLabel: 'Tipo de Post',
      styleDirectSale: 'Venta Directa',
      styleDirectSaleDesc: 'Headline + bullets + CTA',
      styleOrganic: 'Contenido Orgánico',
      styleOrganicDesc: 'Foto + frase educativa',
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
      edit: 'Editar',
      editPlaceholder: 'Describe qué cambiar... ej: "hacé el fondo más oscuro"',
      editRefHint: 'Imágenes de referencia (opcional)',
      editing: 'Editando...',
      editError: 'Error al editar imagen',
      error: 'Error al generar post',
      formatLabel: 'Formato',
      reelStory: 'Reel / Story',
      squarePost: 'Post Feed',
      colorLabel: 'Paleta de Colores',
      enhance: 'Mejorar',
      enhancing: 'Mejorando...',
      enhanceError: 'Error al mejorar imagen',
      createPalette: 'Crear paleta',
      paletteName: 'Nombre',
      paletteColors: 'Colores',
      savePalette: 'Guardar',
      orUploadImage: 'O sube una imagen para extraer colores',
      customPalette: 'Personalizada',
      deletePalette: 'Eliminar'
    },
    en: {
      back: 'Back',
      title: 'Generate Post',
      subtitle: 'Transform a script into a professional visual post',
      styleLabel: 'Post Type',
      styleDirectSale: 'Direct Sale',
      styleDirectSaleDesc: 'Headline + bullets + CTA',
      styleOrganic: 'Organic Content',
      styleOrganicDesc: 'Photo + educational phrase',
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
      edit: 'Edit',
      editPlaceholder: 'Describe what to change... e.g. "make the background darker"',
      editRefHint: 'Reference images (optional)',
      editing: 'Editing...',
      editError: 'Error editing image',
      error: 'Error generating post',
      formatLabel: 'Format',
      reelStory: 'Reel / Story',
      squarePost: 'Feed Post',
      colorLabel: 'Color Palette',
      enhance: 'Enhance',
      enhancing: 'Enhancing...',
      enhanceError: 'Error enhancing image',
      createPalette: 'Create palette',
      paletteName: 'Name',
      paletteColors: 'Colors',
      savePalette: 'Save',
      orUploadImage: 'Or upload an image to extract colors',
      customPalette: 'Custom',
      deletePalette: 'Delete'
    }
  }

  const t = labels[language]

  // Handle script content passed from ScriptCard via sessionStorage
  useEffect(() => {
    const scriptKey = searchParams.get('scriptKey')
    if (scriptKey) {
      const content = sessionStorage.getItem(scriptKey)
      if (content) {
        setScriptText(content)
        sessionStorage.removeItem(scriptKey)
      }
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function loadData() {
      if (!productId || !user) return
      try {
        const [productData, scriptsData, postsResult, userPalettes, prodImages] = await Promise.all([
          getProduct(productId),
          getScripts(productId),
          getProductPostsPaginated(productId, POSTS_PAGE_SIZE, 0),
          getCustomPalettes(user.id),
          getProductImages(productId)
        ])
        setProduct(productData)
        setScripts(scriptsData)
        setCustomPalettes(userPalettes)
        setProductImages(prodImages)
        setTotalPostCount(postsResult.total)

        const loadedPosts: GeneratedPost[] = postsResult.posts
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

  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !user || !productId) return
    const maxNew = 4 - productImages.length
    if (maxNew <= 0) return
    const filesToProcess = Array.from(files).slice(0, maxNew)

    setUploadingProductImage(true)
    try {
      for (const file of filesToProcess) {
        const dataUrl = await normalizeImageToJpeg(file)
        const publicUrl = await uploadProductImage(user.id, productId, dataUrl)
        const saved = await createProductImage(productId, user.id, publicUrl, file.name)
        setProductImages(prev => [saved, ...prev])
      }
    } catch (err) {
      console.error('Product image upload failed:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingProductImage(false)
      if (productImageInputRef.current) productImageInputRef.current.value = ''
    }
  }

  const handleDeleteProductImage = async (imgId: string) => {
    try {
      await deleteProductImage(imgId)
      setProductImages(prev => prev.filter(i => i.id !== imgId))
      setSelectedProductImageIds(prev => {
        const next = new Set(prev)
        next.delete(imgId)
        return next
      })
    } catch (err) {
      console.error('Delete product image failed:', err)
    }
  }

  const toggleProductImageSelection = (imgId: string) => {
    setSelectedProductImageIds(prev => {
      const next = new Set(prev)
      if (next.has(imgId)) {
        next.delete(imgId)
      } else {
        next.add(imgId)
      }
      return next
    })
  }

  const getSelectedProductImageUrls = (): string[] => {
    return productImages
      .filter(img => selectedProductImageIds.has(img.id))
      .map(img => img.image_url)
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
        postStyle: postStyle === 'venta-directa' ? 'venta-directa' : 'preset',
        presetId: postStyle === 'venta-directa' ? undefined : postStyle,
        aspectRatio,
        width: isVertical ? 1080 : 1080,
        height: isVertical ? 1920 : 1440,
        model: imageModel,
        language,
        colorPaletteId: colorPaletteId !== 'auto' && colorPaletteId !== 'custom' ? colorPaletteId : undefined,
        customColors: colorPaletteId === 'custom' && customColors ? customColors : undefined
      }

      const selectedUrls = getSelectedProductImageUrls()
      if (selectedUrls.length > 0) {
        const base64Images = await Promise.all(selectedUrls.map(async u => compressBase64ForApi(await urlToBase64(u))))
        base64Images.forEach((img, i) => {
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

      if (response.status === 413) throw new Error(language === 'es' ? 'La imagen es demasiado grande. Intenta con una imagen más pequeña o de menor resolución.' : 'Image is too large. Try a smaller or lower-resolution image.')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t.error)

      if (result.status === 'Ready' && result.result?.sample) {
        const imageUrl = result.result.sample
        let savedUrl = imageUrl
        let postId = `post-${Date.now()}`

        try {
          if (user && productId) {
            savedUrl = await uploadPostImageOriginal(user.id, productId, imageUrl)
            const post = await createPost(productId, user.id, {
              prompt: script,
              width: aspectRatio === '9:16' ? 1080 : 1080,
              height: aspectRatio === '9:16' ? 1920 : 1440,
              output_format: 'png',
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

  const handleEdit = async (postId: string, imageUrl: string) => {
    if (!editPrompt.trim() || editing) return

    setEditing(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error(language === 'es' ? 'No estás autenticado.' : 'Not authenticated.')

      const base64Image = await compressBase64ForApi(await urlToBase64(imageUrl))
      const compressedRefImages = editRefImages.length > 0
        ? await Promise.all(editRefImages.map(img => compressBase64ForApi(img)))
        : undefined

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'edit',
          editPrompt: editPrompt.trim(),
          editImage: base64Image,
          aspectRatio,
          ...(compressedRefImages ? { editReferenceImages: compressedRefImages } : {})
        })
      })

      if (response.status === 413) throw new Error(language === 'es' ? 'La imagen es demasiado grande. Intenta con una imagen más pequeña o de menor resolución.' : 'Image is too large. Try a smaller or lower-resolution image.')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t.editError)

      if (result.status === 'Ready' && result.result?.sample) {
        const editedUrl = result.result.sample

        // Try to upload the edited image to storage
        let savedUrl = editedUrl
        try {
          if (user && productId) {
            savedUrl = await uploadPostImageOriginal(user.id, productId, editedUrl)
          }
        } catch (saveErr) {
          console.error('Failed to save edited image:', saveErr)
        }

        // Add the edited image as a NEW post card right after the original (before + after)
        const editedPost: GeneratedPost = {
          id: `edit-${Date.now()}`,
          imageUrl: savedUrl,
          prompt: `✏️ ${editPrompt.trim()}`,
          createdAt: new Date(),
          model: 'nano-banana-pro',
          saved: true
        }

        // Save to DB as a new post if possible
        try {
          if (user && productId) {
            const dbPost = await createPost(productId, user.id, {
              prompt: `Edit: ${editPrompt.trim()}`,
              width: 0,
              height: 0,
              output_format: 'png',
              model: 'nano-banana-pro'
            })
            editedPost.id = dbPost.id
            await updatePostStatus(dbPost.id, 'completed', savedUrl)
          }
        } catch (dbErr) {
          console.error('Failed to save edited post to DB:', dbErr)
        }

        // Insert right after the original post
        setGeneratedPosts(prev => {
          const idx = prev.findIndex(p => p.id === postId)
          const next = [...prev]
          next.splice(idx + 1, 0, editedPost)
          return next
        })

        // Clear edit state
        setEditPrompt('')
        setEditRefImages([])
        setEditingPostId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.editError)
    } finally {
      setEditing(false)
    }
  }

  const handleEditRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newImages: string[] = []
    for (const file of Array.from(files).slice(0, 4 - editRefImages.length)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
      newImages.push(dataUrl)
    }
    setEditRefImages(prev => [...prev, ...newImages].slice(0, 4))
    if (editFileInputRef.current) editFileInputRef.current.value = ''
  }

  const handleEnhance = async (postId: string, imageUrl: string) => {
    if (enhancingPostId) return

    setEnhancingPostId(postId)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error(language === 'es' ? 'No estás autenticado.' : 'Not authenticated.')

      const base64Image = await compressBase64ForApi(await urlToBase64(imageUrl))

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'enhance',
          enhanceImage: base64Image,
          aspectRatio,
          language,
          productReferenceImages: selectedProductImageIds.size > 0
            ? await Promise.all(getSelectedProductImageUrls().map(async u => compressBase64ForApi(await urlToBase64(u))))
            : undefined
        })
      })

      if (response.status === 413) throw new Error(language === 'es' ? 'La imagen es demasiado grande. Intenta con una imagen más pequeña o de menor resolución.' : 'Image is too large. Try a smaller or lower-resolution image.')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t.enhanceError)

      if (result.status === 'Ready' && result.result?.sample) {
        const enhancedUrl = result.result.sample

        let savedUrl = enhancedUrl
        try {
          if (user && productId) {
            savedUrl = await uploadPostImageOriginal(user.id, productId, enhancedUrl)
          }
        } catch (saveErr) {
          console.error('Failed to save enhanced image:', saveErr)
        }

        const enhancedPost: GeneratedPost = {
          id: `enhance-${Date.now()}`,
          imageUrl: savedUrl,
          prompt: `✨ Enhanced`,
          createdAt: new Date(),
          model: 'nano-banana-pro',
          saved: true
        }

        try {
          if (user && productId) {
            const dbPost = await createPost(productId, user.id, {
              prompt: 'Enhanced version',
              width: 0,
              height: 0,
              output_format: 'png',
              model: 'nano-banana-pro'
            })
            enhancedPost.id = dbPost.id
            await updatePostStatus(dbPost.id, 'completed', savedUrl)
          }
        } catch (dbErr) {
          console.error('Failed to save enhanced post to DB:', dbErr)
        }

        setGeneratedPosts(prev => {
          const idx = prev.findIndex(p => p.id === postId)
          const next = [...prev]
          next.splice(idx + 1, 0, enhancedPost)
          return next
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.enhanceError)
    } finally {
      setEnhancingPostId(null)
    }
  }

  const handleSavePalette = async () => {
    if (!user) return
    try {
      const name = newPaletteName.trim() || (language === 'es' ? 'Mi paleta' : 'My palette')
      const palette = await createCustomPalette(user.id, name, newPaletteColors)
      setCustomPalettes(prev => [palette, ...prev])
      setShowColorCreator(false)
      setNewPaletteName('')
      // Auto-select the newly created palette
      setColorPaletteId('custom')
      setCustomColors([palette.color_1, palette.color_2, palette.color_3])
    } catch (err) {
      console.error('Failed to save palette:', err)
    }
  }

  const handleDeletePalette = async (paletteId: string) => {
    try {
      await deleteCustomPalette(paletteId)
      setCustomPalettes(prev => prev.filter(p => p.id !== paletteId))
      if (colorPaletteId === 'custom') {
        setColorPaletteId('auto')
        setCustomColors(null)
      }
    } catch (err) {
      console.error('Failed to delete palette:', err)
    }
  }

  const handleExtractColors = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const url = URL.createObjectURL(file)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 50
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, size, size)
      const data = ctx.getImageData(0, 0, size, size).data

      // Simple k-means-ish: sample pixels and find 3 dominant colors
      const pixels: [number, number, number][] = []
      for (let i = 0; i < data.length; i += 4) {
        pixels.push([data[i], data[i + 1], data[i + 2]])
      }

      // Pick 3 spread-out colors: darkest, middle, brightest
      pixels.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))
      const pick = (frac: number) => {
        const idx = Math.min(Math.floor(frac * pixels.length), pixels.length - 1)
        const [r, g, b] = pixels[idx]
        return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
      }

      const c1 = pick(0.15)
      const c2 = pick(0.5)
      const c3 = pick(0.85)
      setNewPaletteColors([c1, c2, c3])
      URL.revokeObjectURL(url)
    }
    img.src = url
    if (paletteImageInputRef.current) paletteImageInputRef.current.value = ''
  }

  const handleLoadMore = async () => {
    if (!productId || loadingMore) return
    setLoadingMore(true)
    try {
      const offset = generatedPosts.filter(p => p.saved).length
      const result = await getProductPostsPaginated(productId, POSTS_PAGE_SIZE, offset)
      const morePosts: GeneratedPost[] = result.posts
        .filter(post => post.status === 'completed' && post.generated_image_url)
        .map(post => ({
          id: post.id,
          imageUrl: post.generated_image_url!,
          prompt: post.prompt,
          createdAt: new Date(post.created_at),
          model: post.model,
          saved: true
        }))
      setGeneratedPosts(prev => [...prev, ...morePosts])
    } catch (err) {
      console.error('Failed to load more posts:', err)
    } finally {
      setLoadingMore(false)
    }
  }

  const handleBuyBoost = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const checkoutUrl = import.meta.env.PROD ? '/api/tilopay/create-checkout' : 'http://localhost:3000/api/tilopay/create-checkout'
      const response = await fetch(checkoutUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ plan: 'image_boost' })
      })
      const data = await response.json()
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, '_blank')
      }
    } catch (err) {
      console.error('Boost checkout error:', err)
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
      {/* Maintenance Disclaimer */}
      <div className="bg-amber-900/30 border-b border-amber-700/30 px-4 py-2 text-center">
        <p className="text-xs text-amber-200">
          {language === 'es'
            ? '⚠️ Estamos realizando mejoras. Podrías experimentar cambios temporales. ¡Gracias por tu paciencia!'
            : '⚠️ We\'re making improvements. You may experience temporary changes. Thanks for your patience!'}
        </p>
      </div>
      <div className="h-full flex flex-col lg:flex-row lg:overflow-hidden">
        {/* Left Panel — Script Input & Settings */}
        <div className="w-full lg:w-[420px] bg-dark-100 border-b lg:border-b-0 lg:border-r border-dark-100 flex flex-col min-h-0 overflow-hidden max-h-[100dvh]">
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
            {/* Post Style selector — dropdown */}
            <div className="relative">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                <Sparkles className="w-3.5 h-3.5 text-primary-500" />
                {t.styleLabel}
              </label>
              <button
                onClick={() => setShowStyleDropdown(!showStyleDropdown)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-dark-50 rounded-lg text-sm text-dark-700 hover:bg-dark-100 transition-colors border border-dark-200"
              >
                <span className="flex items-center gap-2 truncate">
                  <ImageIcon className="w-4 h-4 text-dark-400 flex-shrink-0" />
                  {postStyle === 'venta-directa'
                    ? t.styleDirectSale
                    : (IMAGE_PRESETS.find(p => p.id === postStyle)?.[language === 'es' ? 'nameEs' : 'name'] || postStyle)
                  }
                </span>
                {showStyleDropdown ? <ChevronUp className="w-4 h-4 text-dark-400" /> : <ChevronDown className="w-4 h-4 text-dark-400" />}
              </button>

              {showStyleDropdown && (
                <div className="absolute z-30 mt-1 w-full bg-dark-100 rounded-xl shadow-xl border border-dark-200 max-h-[400px] overflow-y-auto">
                  {/* Venta Directa — always first */}
                  <button
                    onClick={() => { setPostStyle('venta-directa'); setShowStyleDropdown(false) }}
                    className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-dark-50 border-b border-dark-100 ${
                      postStyle === 'venta-directa' ? 'bg-primary-900/20' : ''
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-dark-800">{t.styleDirectSale}</div>
                      <div className="text-[11px] text-dark-400 mt-0.5">{t.styleDirectSaleDesc}</div>
                    </div>
                    {postStyle === 'venta-directa' && (
                      <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                    )}
                  </button>

                  {/* Preset styles */}
                  {IMAGE_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => { setPostStyle(preset.id); setShowStyleDropdown(false) }}
                      className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-dark-50 border-b border-dark-100 last:border-b-0 ${
                        postStyle === preset.id ? 'bg-primary-900/20' : ''
                      }`}
                    >
                      <img
                        src={preset.thumbnails[0]}
                        alt={preset.name}
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-dark-800">
                          {language === 'es' ? preset.nameEs : preset.name}
                        </div>
                        <div className="text-[11px] text-dark-400 mt-0.5 line-clamp-2">
                          {language === 'es' ? preset.descriptionEs : preset.description}
                        </div>
                      </div>
                      {postStyle === preset.id && (
                        <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Color Palette selector */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                <Sparkles className="w-3.5 h-3.5 text-primary-500" />
                {t.colorLabel}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {/* Predefined palettes */}
                {COLOR_PALETTES.map(palette => (
                  <button
                    key={palette.id}
                    onClick={() => { setColorPaletteId(palette.id); setCustomColors(null) }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                      colorPaletteId === palette.id
                        ? 'bg-primary-900/20 text-primary-700 border border-primary-300 shadow-sm'
                        : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                    }`}
                  >
                    {palette.colors.length > 0 ? (
                      <span className="flex gap-0.5">
                        {palette.colors.slice(0, 3).map((c, i) => (
                          <span
                            key={i}
                            className="w-3 h-3 rounded-full border border-dark-200/50"
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </span>
                    ) : (
                      <span className="w-3 h-3 rounded-full bg-gradient-to-br from-primary-300 to-sky-300 border border-dark-200/50" />
                    )}
                    {language === 'es' ? palette.nameEs : palette.name}
                  </button>
                ))}

                {/* Saved custom palettes */}
                {customPalettes.map(cp => (
                  <button
                    key={cp.id}
                    onClick={() => {
                      setColorPaletteId('custom')
                      setCustomColors([cp.color_1, cp.color_2, cp.color_3])
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all group/cp ${
                      colorPaletteId === 'custom' && customColors?.[0] === cp.color_1 && customColors?.[1] === cp.color_2
                        ? 'bg-primary-900/20 text-primary-700 border border-primary-300 shadow-sm'
                        : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                    }`}
                  >
                    <span className="flex gap-0.5">
                      {[cp.color_1, cp.color_2, cp.color_3].map((c, i) => (
                        <span key={i} className="w-3 h-3 rounded-full border border-dark-200/50" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                    {cp.name}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeletePalette(cp.id) }}
                      className="ml-0.5 opacity-0 group-hover/cp:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-2.5 h-2.5 text-dark-400 hover:text-red-500" />
                    </button>
                  </button>
                ))}

                {/* Create palette button */}
                <button
                  onClick={() => setShowColorCreator(!showColorCreator)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    showColorCreator
                      ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                      : 'bg-dark-50 text-dark-600 border border-dashed border-dark-300 hover:bg-dark-100'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  {t.createPalette}
                </button>
              </div>

              {/* Color creator inline form */}
              {showColorCreator && (
                <div className="mt-2 p-3 bg-dark-50 rounded-lg border border-dark-200 space-y-2.5">
                  <input
                    type="text"
                    value={newPaletteName}
                    onChange={(e) => setNewPaletteName(e.target.value)}
                    placeholder={t.paletteName}
                    className="w-full text-xs bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                  />
                  <div className="flex items-center gap-2">
                    {newPaletteColors.map((color, i) => (
                      <label key={i} className="relative cursor-pointer">
                        <span
                          className="block w-8 h-8 rounded-lg border-2 border-dark-200 shadow-sm"
                          style={{ backgroundColor: color }}
                        />
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => {
                            const updated = [...newPaletteColors] as [string, string, string]
                            updated[i] = e.target.value
                            setNewPaletteColors(updated)
                          }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </label>
                    ))}
                    <span className="text-[10px] text-dark-400 ml-1">{t.paletteColors}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => paletteImageInputRef.current?.click()}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-dark-100 border border-dark-200 text-dark-600 hover:bg-dark-50 transition-colors"
                    >
                      <Pipette className="w-3 h-3" />
                      {t.orUploadImage}
                    </button>
                    <input
                      ref={paletteImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleExtractColors}
                      className="hidden"
                    />
                  </div>
                  <button
                    onClick={handleSavePalette}
                    className="w-full px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 transition-colors"
                  >
                    {t.savePalette}
                  </button>
                </div>
              )}
            </div>

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
                  <div className="absolute left-0 right-0 top-full mt-1 bg-dark-100 rounded-xl shadow-lg border border-dark-100 z-50 max-h-[50vh] overflow-y-auto">
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
                                ? 'bg-primary-900/20 border border-primary-200'
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
                <div className="mt-2 bg-primary-900/20 border border-primary-100 rounded-lg p-3">
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
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                  />
                </>
              )}
            </div>

            {/* Product images — persistent, selectable */}
            <div>
              <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                {t.refImages}
              </label>
              <p className="text-[10px] text-dark-400 mb-2">
                {language === 'es'
                  ? 'Sube fotos de tu producto. Selecciona las que quieras usar como referencia en generación y mejora.'
                  : 'Upload product photos. Select the ones you want to use as reference for generation and enhancement.'}
              </p>

              {/* Image grid */}
              <div className="flex gap-2 flex-wrap">
                {productImages.map((img) => {
                  const isSelected = selectedProductImageIds.has(img.id)
                  return (
                    <div key={img.id} className="relative group">
                      <button
                        onClick={() => toggleProductImageSelection(img.id)}
                        className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                          isSelected
                            ? 'border-primary-500 ring-2 ring-primary-500/30'
                            : 'border-dark-200 hover:border-dark-300'
                        }`}
                      >
                        <img src={img.image_url} alt="Product" className="w-full h-full object-cover" />
                        {isSelected && (
                          <div className="absolute inset-0 bg-primary-500/20 flex items-center justify-center">
                            <div className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          </div>
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteProductImage(img.id)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )
                })}

                {/* Upload button */}
                {productImages.length < 4 && (
                  <button
                    onClick={() => productImageInputRef.current?.click()}
                    disabled={uploadingProductImage}
                    className="w-16 h-16 rounded-lg border-2 border-dashed border-dark-200 flex flex-col items-center justify-center text-dark-400 hover:border-primary-400 hover:text-primary-500 transition-colors disabled:opacity-50"
                  >
                    {uploadingProductImage ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        <span className="text-[8px] mt-0.5">
                          {language === 'es' ? 'Subir' : 'Upload'}
                        </span>
                      </>
                    )}
                  </button>
                )}
                <input
                  ref={productImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
                  multiple
                  onChange={handleProductImageUpload}
                  className="hidden"
                />
              </div>

              {selectedProductImageIds.size > 0 && (
                <p className="text-[10px] text-primary-500 mt-1.5 font-medium">
                  {language === 'es'
                    ? `${selectedProductImageIds.size} imagen(es) seleccionada(s) como referencia`
                    : `${selectedProductImageIds.size} image(s) selected as reference`}
                </p>
              )}
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
                        ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
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
              <div className="p-3 bg-red-900/20 border border-red-700/30 rounded-lg">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* Usage Banner */}
          <UsageBanner usage={usageLimits} resource="image" onBuyBoost={handleBuyBoost} />

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
              <>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {generating && (
                  <GeneratingPlaceholder
                    aspectRatio={aspectRatio === '9:16' ? '9/16' : '3/4'}
                    label={t.generating}
                    sublabel={imageModel}
                  />
                )}
                {generatedPosts.map((post, index) => (
                  <div key={post.id} className="bg-dark-100 rounded-xl shadow-sm border border-dark-100 overflow-hidden group">
                    <div className="relative">
                      <img
                        src={post.imageUrl}
                        alt={`Post ${index + 1}`}
                        className="w-full h-auto"
                        loading="lazy"
                      />
                      {/* Magic Wand — enhance button */}
                      <button
                        onClick={() => handleEnhance(post.id, post.imageUrl)}
                        disabled={!!enhancingPostId || editing}
                        className="absolute top-2 right-2 w-9 h-9 rounded-lg bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/80 hover:bg-black/60 hover:text-white transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t.enhance}
                      >
                        <Wand2 className="w-5 h-5" />
                      </button>
                      {enhancingPostId === post.id && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-sm">
                          <div className="flex items-center gap-2 text-white text-sm font-medium">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            {t.enhancing}
                          </div>
                        </div>
                      )}
                      {editing && editingPostId === post.id && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-sm">
                          <div className="flex items-center gap-2 text-white text-sm font-medium">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            {t.editing}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDownload(post.imageUrl, index)}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dark-200 text-dark-600 text-xs font-medium hover:bg-dark-50 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {t.download}
                        </button>
                        <button
                          onClick={() => {
                            if (editingPostId === post.id) {
                              setEditingPostId(null)
                              setEditPrompt('')
                              setEditRefImages([])
                            } else {
                              setEditingPostId(post.id)
                              setEditPrompt('')
                              setEditRefImages([])
                            }
                          }}
                          disabled={editing}
                          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                            editingPostId === post.id
                              ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                              : 'border border-dark-200 text-dark-600 hover:bg-dark-50'
                          }`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          {t.edit}
                        </button>
                      </div>

                      {editingPostId === post.id && (
                        <div className="space-y-2">
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={editPrompt}
                              onChange={(e) => setEditPrompt(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && editPrompt.trim()) {
                                  handleEdit(post.id, post.imageUrl)
                                }
                              }}
                              placeholder={t.editPlaceholder}
                              disabled={editing}
                              className="flex-1 text-xs border border-dark-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300 disabled:opacity-50"
                              autoFocus
                            />
                            <button
                              onClick={() => handleEdit(post.id, post.imageUrl)}
                              disabled={editing || !editPrompt.trim()}
                              className="px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {editRefImages.map((img, i) => (
                              <div key={i} className="relative">
                                <img src={img} alt={`Ref ${i + 1}`} className="w-10 h-10 object-cover rounded-md border border-dark-200" />
                                <button
                                  onClick={() => setEditRefImages(prev => prev.filter((_, idx) => idx !== i))}
                                  className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-dark-600 text-white rounded-full flex items-center justify-center hover:bg-dark-800"
                                >
                                  <X className="w-2 h-2" />
                                </button>
                              </div>
                            ))}
                            {editRefImages.length < 4 && (
                              <button
                                onClick={() => editFileInputRef.current?.click()}
                                disabled={editing}
                                className="w-10 h-10 rounded-md border border-dashed border-dark-300 flex items-center justify-center text-dark-400 hover:border-primary-400 hover:text-primary-500 transition-colors disabled:opacity-50"
                                title={t.editRefHint}
                              >
                                <Upload className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <input
                              ref={editFileInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/*"
                              multiple
                              onChange={handleEditRefUpload}
                              className="hidden"
                            />
                            {editRefImages.length === 0 && (
                              <span className="text-[10px] text-dark-400">{t.editRefHint}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Load More button */}
              {generatedPosts.filter(p => p.saved).length < totalPostCount && (
                <div className="flex justify-center mt-6">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-dark-200 text-dark-600 text-sm font-medium hover:bg-dark-100 transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {language === 'es' ? 'Cargando...' : 'Loading...'}
                      </>
                    ) : (
                      <>
                        {language === 'es' ? 'Cargar más' : 'Load More'}
                        <span className="text-xs text-dark-400">
                          ({generatedPosts.filter(p => p.saved).length}/{totalPostCount})
                        </span>
                      </>
                    )}
                  </button>
                </div>
              )}
              </>
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
