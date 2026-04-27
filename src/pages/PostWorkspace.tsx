import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProduct, getProductPostsPaginated, createPost, updatePostStatus, getScripts, getProductImages, createProductImage, deleteProductImage, recordAiSignal, ratePost, deletePost } from '../services/database'
import type { ProductImage } from '../services/database'
import type { Product, Script, ImageModel, OrganicSingleSubtype, CTAStrength } from '../types'
import OrganicCarouselModal from '../components/OrganicCarouselModal'
import CarouselGroupCard, { type CarouselSlide } from '../components/CarouselGroupCard'
import Layout from '../components/Layout'
import { uploadPostImageOriginal, uploadProductImage, urlToBase64, compressBase64ForApi } from '../utils/imageCompression'
import { fetchJson } from '../utils/apiFetch'
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
  Palette,
  ThumbsUp,
  ThumbsDown,
  Camera
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import GeneratingPlaceholder from '../components/GeneratingPlaceholder'
import UsageBanner from '../components/UsageBanner'
import { useUsageLimits } from '../hooks/useUsageLimits'
import { IMAGE_PRESETS, PRODUCT_SUB_STYLES, LOGO_ARCHETYPES, LOGO_BACKGROUNDS, LOGO_ENHANCE_TIERS } from '../data/image-presets'
import { COLOR_PALETTES } from '../data/color-palettes'
import { getCustomPalettes, createCustomPalette, deleteCustomPalette, getCustomPostTypes, createCustomPostType, deleteCustomPostType } from '../services/database'
import type { CustomColorPalette } from '../services/database'
import type { CustomPostType } from '../types'
import CreateCustomPostType from '../components/CreateCustomPostType'
import BrandKitSelector from '../components/BrandKitSelector'

type PostAspectRatio = '9:16' | '3:4' | '1:1'

interface GeneratedPost {
  id: string
  imageUrl: string
  prompt: string
  createdAt: Date
  model?: string
  saved?: boolean
  // Carousel grouping (organic carousels only; undefined for standalone posts)
  carouselGroupId?: string | null
  slideIndex?: number | null
  slideTotal?: number | null
  carouselSubtype?: string | null
}

const API_URL = import.meta.env.PROD ? '/api/generate-image' : 'http://localhost:3000/api/generate-image'
const STREAMLINE_API_URL = import.meta.env.PROD ? '/api/streamline-script' : 'http://localhost:3000/api/streamline-script'
const IMAGE_REQUEST_TIMEOUT_MS = 150_000

type ImageApiResponse = {
  status?: string
  result?: { sample?: string }
  model?: string
  textWarning?: boolean
  enhanced?: boolean
  edited?: boolean
}

const imageApiMessages = (language: string, fallback: string) => ({
  timeoutMessage: language === 'es'
    ? 'La generación está tardando demasiado. Intenta de nuevo en unos segundos o usa una imagen/prompt más simple.'
    : 'Image generation is taking too long. Try again in a few seconds or use a simpler image/prompt.',
  invalidJsonMessage: language === 'es'
    ? 'El servidor devolvió una respuesta inválida durante la generación'
    : 'The server returned an invalid response during generation',
  fallbackError: fallback,
  statusMessages: {
    413: language === 'es'
      ? 'La imagen es demasiado grande. Intenta con una imagen más pequeña o de menor resolución.'
      : 'Image is too large. Try a smaller or lower-resolution image.',
    504: language === 'es'
      ? 'La generación tardó demasiado y fue detenida. Intenta de nuevo en unos segundos.'
      : 'Generation took too long and was stopped. Try again in a few seconds.',
  }
})

// Preload an image into the browser cache so URL swaps don't cause a blank flash
const preloadImage = (url: string): Promise<void> =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve() // resolve anyway — the <img> tag will retry
    img.src = url
  })

// Detect the actual aspect ratio of an image from its URL so edits/enhances preserve it
const detectImageAspectRatio = (imageUrl: string): Promise<PostAspectRatio> =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight
      if (Math.abs(ratio - 1) < 0.1) resolve('1:1')
      else if (Math.abs(ratio - 3 / 4) < 0.1) resolve('3:4')
      else resolve('9:16')
    }
    img.onerror = () => resolve('9:16') // fallback
    img.crossOrigin = 'anonymous'
    img.src = imageUrl
  })

export default function PostWorkspace() {
  const { productId } = useParams<{ productId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { language } = useLanguage()

  const [product, setProduct] = useState<Product | null>(null)
  const [scripts, setScripts] = useState<Script[]>([])
  const [selectedScript, setSelectedScript] = useState<Script | null>(null)
  const [scriptText, setScriptText] = useState('')
  const [additionalInstructions, setAdditionalInstructions] = useState('')
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
  const enhancingPostIdRef = useRef<string | null>(null)
  const [enhanceMenuFor, setEnhanceMenuFor] = useState<string | null>(null)
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<string | null>(null)
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null)
  const [customPalettes, setCustomPalettes] = useState<CustomColorPalette[]>([])
  const [showColorCreator, setShowColorCreator] = useState(false)
  const [newPaletteName, setNewPaletteName] = useState('')
  const [newPaletteColors, setNewPaletteColors] = useState<[string, string, string]>(['#000000', '#FFFFFF', '#0284c7'])
  const [customColors, setCustomColors] = useState<string[] | null>(null)
  const paletteImageInputRef = useRef<HTMLInputElement>(null)
  const [customPostTypes, setCustomPostTypes] = useState<CustomPostType[]>([])
  const [showCreatePostType, setShowCreatePostType] = useState(false)
  const [createTypeFromImage, setCreateTypeFromImage] = useState<string | null>(null)
  const [showEnhanceTip, setShowEnhanceTip] = useState(false)
  const [productImages, setProductImages] = useState<ProductImage[]>([])
  const [uploadingProductImage, setUploadingProductImage] = useState(false)
  const [selectedBrandKitId, setSelectedBrandKitId] = useState<string | null>(null)
  const [streamlinedScript, setStreamlinedScript] = useState<string | null>(null)
  const [streamlining, setStreamlining] = useState(false)
  const productImageInputRef = useRef<HTMLInputElement>(null)
  const contextImageInputRef = useRef<HTMLInputElement>(null)
  const [uploadingContextImage, setUploadingContextImage] = useState(false)
  const POSTS_PAGE_SIZE = 20
  const [totalPostCount, setTotalPostCount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [postRatings, setPostRatings] = useState<Record<string, 'good' | 'bad'>>({})
  const [productSubStyle, setProductSubStyle] = useState<string>('studio-hero')
  const [backgroundDescription, setBackgroundDescription] = useState('')
  const [mobileConfigOpen, setMobileConfigOpen] = useState(() => window.innerWidth >= 1024)

  // Logo generator state
  const [logoMode, setLogoMode] = useState<'generate' | 'enhance'>('generate')
  const [logoArchetype, setLogoArchetype] = useState<string>('auto')
  const [logoBackground, setLogoBackground] = useState<'transparent' | 'white' | 'dark'>('transparent')
  const [logoEnhanceTier, setLogoEnhanceTier] = useState<'refine' | 'modernize' | 'rebuild'>('modernize')
  const [logoBusinessName, setLogoBusinessName] = useState<string>('')
  const [logoIndustry, setLogoIndustry] = useState<string>('')
  const [logoAvoid, setLogoAvoid] = useState<string>('')
  const [logoStylePref, setLogoStylePref] = useState<string>('')
  const [logoUserKeeps, setLogoUserKeeps] = useState<string>('')
  const [logoUserChanges, setLogoUserChanges] = useState<string>('')
  const [existingLogoImage, setExistingLogoImage] = useState<string | null>(null)
  const existingLogoInputRef = useRef<HTMLInputElement>(null)

  const isProductMode = postStyle === 'product'
  const isAnuncioMode = postStyle === 'anuncio-conversion'
  const isLogoMode = postStyle === 'logo'
  // Organic post state
  // postStyle 'organic-single:<subtype>' → single-image organic post (routed through /api/generate-image).
  // postStyle 'organic-carousel'         → opens the OrganicCarouselModal (routed through /api/generate-carousel).
  const isOrganicSingleMode = postStyle.startsWith('organic-single:')
  const organicSingleSubtype: OrganicSingleSubtype | null = isOrganicSingleMode
    ? (postStyle.replace('organic-single:', '') as OrganicSingleSubtype)
    : null
  const [ctaStrength, setCtaStrength] = useState<CTAStrength>('soft')
  const [carouselModalOpen, setCarouselModalOpen] = useState(false)

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
      logoType: 'Generador de Logos',
      logoTypeDesc: 'Crea o mejora el logo de tu marca',
      logoModeGenerate: 'Crear Nuevo',
      logoModeEnhance: 'Mejorar Existente',
      logoArchetypeLabel: 'Arquetipo de Logo',
      logoBackgroundLabel: 'Fondo',
      logoEnhanceTierLabel: 'Nivel de Mejora',
      logoBusinessNameLabel: 'Nombre del negocio',
      logoBusinessNamePlaceholder: 'Ej: Nova Café',
      logoIndustryLabel: 'Industria / Nicho',
      logoIndustryPlaceholder: 'Ej: Cafetería, SaaS, Moda, Consultoría...',
      logoStylePrefLabel: 'Estilo (opcional)',
      logoStylePrefPlaceholder: 'Ej: moderno, minimalista, clásico, playful...',
      logoAvoidLabel: 'Evitar (opcional)',
      logoAvoidPlaceholder: 'Ej: no usar azul, no usar imágenes literales...',
      logoAdditionalLabel: 'Instrucciones adicionales (opcional)',
      logoAdditionalPlaceholder: 'Preferencias, referencias de marcas que te gusten...',
      logoExistingLabel: 'Sube tu logo actual (requerido)',
      logoExistingHint: 'Se analizará y mejorará preservando el equity de marca.',
      logoUserKeepsLabel: 'Qué conservar (opcional)',
      logoUserKeepsPlaceholder: 'Ej: las iniciales, el color azul, el símbolo...',
      logoUserChangesLabel: 'Qué cambiar (opcional)',
      logoUserChangesPlaceholder: 'Ej: tipografía anticuada, el gradiente...',
      generateLogo: 'Generar Logo',
      generatingLogo: 'Diseñando logo...',
      scriptLabel: 'Guión',
      selectScript: 'Seleccionar guión guardado',
      pasteScript: 'O pega un guión directamente',
      scriptPlaceholder: 'Pega aquí tu guión con estructura Gancho / Desarrollo / CTA...',
      additionalInstructions: 'Instrucciones adicionales (opcional)',
      additionalPlaceholder: 'Ej: "Usa fondo oscuro", "Resalta el precio", "Estilo minimalista"...',
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
      saveAsStyle: 'Guardar como estilo',
      deletePost: 'Eliminar post',
      deletePostConfirm: '¿Eliminar este post? Esta acción no se puede deshacer.',
      deletePostError: 'Error al eliminar el post',
      cancel: 'Cancelar',
      enhanceTip: '¡Prueba mejorarla!',
      tierPolish: 'Pulir',
      tierPolishDesc: 'Cambios mínimos. Mejor tipografía, espaciado y color.',
      tierModernize: 'Modernizar',
      tierModernizeDesc: 'Actualiza ejecución. Mantiene concepto y elementos clave.',
      tierRebuild: 'Reconstruir',
      tierRebuildDesc: 'Reinterpretación creativa agresiva. Puede cambiar composición.',
      createPalette: 'Crear paleta',
      paletteName: 'Nombre',
      paletteColors: 'Colores',
      savePalette: 'Guardar',
      orUploadImage: 'O sube una imagen para extraer colores',
      customPalette: 'Personalizada',
      deletePalette: 'Eliminar',
      streamline: 'Optimizar para post',
      streamlining: 'Optimizando...',
      streamlined: 'Guión optimizado',
      revertStreamline: 'Usar original',
      productType: 'Foto de Producto',
      productTypeDesc: 'Imagen profesional del producto',
      productSubStyleLabel: 'Estilo de foto',
      backgroundDesc: 'Describe el fondo deseado (opcional)',
      backgroundPlaceholder: 'Ej: "Mármol blanco", "Hojas tropicales", "Fondo navideño"...',
      squareFormat: 'Cuadrado',
      productRefRequired: 'Sube al menos una foto del producto',
      generateProduct: 'Generar Foto',
      generatingProduct: 'Generando foto...',
      productInstructions: 'Instrucciones adicionales (opcional)',
      productInstructionsPlaceholder: 'Ej: "Ángulo lateral", "Colores cálidos", "Fondo oscuro"...',
      anuncioType: 'Anuncio de Conversión',
      anuncioTypeDesc: 'Imagen publicitaria de alto impacto para Instagram Ads'
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
      logoType: 'Logo Generator',
      logoTypeDesc: 'Create or enhance your brand logo',
      logoModeGenerate: 'Create New',
      logoModeEnhance: 'Enhance Existing',
      logoArchetypeLabel: 'Logo Archetype',
      logoBackgroundLabel: 'Background',
      logoEnhanceTierLabel: 'Enhancement Tier',
      logoBusinessNameLabel: 'Business name',
      logoBusinessNamePlaceholder: 'E.g. Nova Café',
      logoIndustryLabel: 'Industry / Niche',
      logoIndustryPlaceholder: 'E.g. Café, SaaS, Fashion, Consulting...',
      logoStylePrefLabel: 'Style (optional)',
      logoStylePrefPlaceholder: 'E.g. modern, minimal, classic, playful...',
      logoAvoidLabel: 'Avoid (optional)',
      logoAvoidPlaceholder: 'E.g. no blue, no literal imagery...',
      logoAdditionalLabel: 'Additional instructions (optional)',
      logoAdditionalPlaceholder: 'Preferences, brand references you like...',
      logoExistingLabel: 'Upload your current logo (required)',
      logoExistingHint: 'It will be analyzed and improved while preserving brand equity.',
      logoUserKeepsLabel: 'What to keep (optional)',
      logoUserKeepsPlaceholder: 'E.g. the initials, the blue color, the symbol...',
      logoUserChangesLabel: 'What to change (optional)',
      logoUserChangesPlaceholder: 'E.g. outdated typography, the gradient...',
      generateLogo: 'Generate Logo',
      generatingLogo: 'Designing logo...',
      scriptLabel: 'Script',
      selectScript: 'Select saved script',
      pasteScript: 'Or paste a script directly',
      scriptPlaceholder: 'Paste your script with Hook / Development / CTA structure...',
      additionalInstructions: 'Additional instructions (optional)',
      additionalPlaceholder: 'E.g.: "Use dark background", "Highlight the price", "Minimalist style"...',
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
      saveAsStyle: 'Save as style',
      deletePost: 'Delete post',
      deletePostConfirm: 'Delete this post? This cannot be undone.',
      deletePostError: 'Failed to delete post',
      cancel: 'Cancel',
      enhanceTip: 'Try enhancing it!',
      tierPolish: 'Polish',
      tierPolishDesc: 'Minimal changes. Refines typography, spacing, and color.',
      tierModernize: 'Modernize',
      tierModernizeDesc: 'Updates execution. Keeps concept and key elements.',
      tierRebuild: 'Rebuild',
      tierRebuildDesc: 'Aggressive creative reinterpretation. May change composition.',
      createPalette: 'Create palette',
      paletteName: 'Name',
      paletteColors: 'Colors',
      savePalette: 'Save',
      orUploadImage: 'Or upload an image to extract colors',
      customPalette: 'Custom',
      deletePalette: 'Delete',
      streamline: 'Optimize for post',
      streamlining: 'Optimizing...',
      streamlined: 'Optimized script',
      revertStreamline: 'Use original',
      productType: 'Product Photo',
      productTypeDesc: 'Professional product image',
      productSubStyleLabel: 'Photo style',
      backgroundDesc: 'Describe the desired background (optional)',
      backgroundPlaceholder: 'E.g.: "White marble", "Tropical leaves", "Christmas background"...',
      squareFormat: 'Square',
      productRefRequired: 'Upload at least one product photo',
      generateProduct: 'Generate Photo',
      generatingProduct: 'Generating photo...',
      productInstructions: 'Additional instructions (optional)',
      productInstructionsPlaceholder: 'E.g.: "Side angle", "Warm colors", "Dark background"...',
      anuncioType: 'Conversion Ad',
      anuncioTypeDesc: 'High-impact ad image for Instagram Ads'
    }
  }

  const t = labels[language]

  // Force 1:1 aspect ratio whenever logo mode becomes active
  useEffect(() => {
    if (isLogoMode && aspectRatio !== '1:1') {
      setAspectRatio('1:1')
    }
  }, [isLogoMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle script content passed from ScriptCard via sessionStorage.
  // Optional ?autoOpen=carousel → opens the OrganicCarouselModal with the script pre-filled.
  useEffect(() => {
    const scriptKey = searchParams.get('scriptKey')
    const autoOpen = searchParams.get('autoOpen')
    if (scriptKey) {
      const content = sessionStorage.getItem(scriptKey)
      if (content) {
        setScriptText(content)
        sessionStorage.removeItem(scriptKey)
        if (autoOpen === 'carousel') {
          setCarouselModalOpen(true)
        }
      }
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function loadData() {
      if (!productId || !user) return
      try {
        const [productData, scriptsData, postsResult, userPalettes, prodImages, userPostTypes] = await Promise.all([
          getProduct(productId),
          getScripts(productId),
          getProductPostsPaginated(productId, POSTS_PAGE_SIZE, 0),
          getCustomPalettes(user.id),
          getProductImages(productId),
          getCustomPostTypes(user.id)
        ])
        setProduct(productData)
        // Prefill logo fields from product
        if (productData?.name && !logoBusinessName) setLogoBusinessName(productData.name)
        if (!logoIndustry) {
          const inferredIndustry = (productData?.product_category_custom ||
            productData?.product_category ||
            productData?.svc_service_type_custom ||
            productData?.svc_service_type ||
            productData?.type || '') as string
          if (inferredIndustry) setLogoIndustry(inferredIndustry)
        }
        setScripts(scriptsData)
        setCustomPalettes(userPalettes)
        setProductImages(prodImages)
        setCustomPostTypes(userPostTypes)
        setTotalPostCount(postsResult.total)

        const completedPosts = postsResult.posts
          .filter(post => post.status === 'completed' && post.generated_image_url)
        const loadedPosts: GeneratedPost[] = completedPosts
          .map(post => ({
            id: post.id,
            imageUrl: post.generated_image_url!,
            prompt: post.prompt,
            createdAt: new Date(post.created_at),
            model: post.model,
            saved: true,
            carouselGroupId: post.carousel_group_id ?? null,
            slideIndex: post.slide_index ?? null,
            slideTotal: post.slide_total ?? null,
            carouselSubtype: post.carousel_subtype ?? null,
          }))
        setGeneratedPosts(loadedPosts)

        const restoredRatings: Record<string, 'good' | 'bad'> = {}
        for (const post of completedPosts) {
          if (post.rating === 5) restoredRatings[post.id] = 'good'
          else if (post.rating === 1) restoredRatings[post.id] = 'bad'
        }
        if (Object.keys(restoredRatings).length > 0) setPostRatings(restoredRatings)
      } catch (err) {
        console.error('Failed to load data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [productId, user?.id])

  const getScriptPrompt = (): string => {
    let base = ''
    if (streamlinedScript) base = streamlinedScript
    else if (selectedScript) base = selectedScript.content
    else if (scriptText.trim()) base = scriptText.trim()
    if (!base) return ''
    const extra = additionalInstructions.trim()
    if (extra) return `${base}\n\n[INSTRUCCIONES ADICIONALES / ADDITIONAL INSTRUCTIONS]:\n${extra}`
    return base
  }

  const handleStreamline = async () => {
    const rawScript = selectedScript?.content || scriptText.trim()
    if (!rawScript || streamlining) return

    setStreamlining(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return

      // Resolve the actual post style name for the API
      let resolvedStyle = postStyle
      if (postStyle.startsWith('custom-')) {
        resolvedStyle = 'custom-type'
      } else if (postStyle !== 'venta-directa' && postStyle !== 'organico') {
        // It's a preset ID — use it directly
        resolvedStyle = postStyle
      }

      // Build product context to anchor the output on THIS specific product
      const productContext = product ? {
        name: product.name || undefined,
        description: product.product_description || product.description || undefined,
        niche: product.product_category_custom || product.product_category || undefined,
        differentiation: product.differentiation || product.unique_value || undefined,
      } : undefined

      const resp = await fetch(STREAMLINE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          script: rawScript,
          postStyle: resolvedStyle,
          language,
          productContext
        })
      })

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to streamline')
      }

      const data = await resp.json()
      if (data.streamlined) {
        setStreamlinedScript(data.streamlined)
      }
    } catch (err) {
      console.error('Streamline error:', err)
      setError(language === 'es' ? 'Error al optimizar guión' : 'Error streamlining script')
    } finally {
      setStreamlining(false)
    }
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

  const handleImageUploadByKind = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'product' | 'context'
  ) => {
    const files = e.target.files
    if (!files || !user || !productId) return
    const current = productImages.filter(i => (i.kind || 'product') === kind)
    const maxNew = 4 - current.length
    if (maxNew <= 0) return
    const filesToProcess = Array.from(files).slice(0, maxNew)

    const setBusy = kind === 'product' ? setUploadingProductImage : setUploadingContextImage
    const inputRef = kind === 'product' ? productImageInputRef : contextImageInputRef

    setBusy(true)
    try {
      for (const file of filesToProcess) {
        const dataUrl = await normalizeImageToJpeg(file)
        const publicUrl = await uploadProductImage(user.id, productId, dataUrl)
        const saved = await createProductImage(productId, user.id, publicUrl, file.name, kind)
        setProductImages(prev => [saved, ...prev])
      }
    } catch (err) {
      console.error(`${kind} image upload failed:`, err)
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDeleteProductImage = async (imgId: string) => {
    try {
      await deleteProductImage(imgId)
      setProductImages(prev => prev.filter(i => i.id !== imgId))
    } catch (err) {
      console.error('Delete product image failed:', err)
    }
  }

  const getProductImageUrls = (): string[] => {
    return productImages.filter(img => (img.kind || 'product') === 'product').map(img => img.image_url)
  }

  const getContextImageUrls = (): string[] => {
    return productImages.filter(img => img.kind === 'context').map(img => img.image_url)
  }

  const getCarouselProductImageUrls = (): string[] => {
    const urls = [
      ...getProductImageUrls(),
      ...((product?.ind_product_images || []) as string[]),
    ].filter(Boolean)
    return Array.from(new Set(urls)).slice(0, 4)
  }

  const getCarouselProductContext = () => {
    if (!product) return undefined
    const category = product.product_category_custom || product.product_category ||
      product.svc_service_type_custom || product.svc_service_type ||
      product.ind_article_type_custom || product.ind_article_type ||
      product.re_business_type || product.type
    const audience = product.best_customers || product.target_audience || product.business?.icp_description
    const description = [
      product.product_description || product.description || product.menu_text,
      product.ind_variations_description ? `Variaciones: ${product.ind_variations_description}` : '',
      product.ind_main_material ? `Material: ${product.ind_main_material}` : '',
      product.ind_quality_description ? `Calidad: ${product.ind_quality_description}` : '',
      product.technical_specs ? `Specs: ${product.technical_specs}` : '',
    ].filter(Boolean).join('\n')
    const result = product.expected_result || product.result || product.svc_concrete_result ||
      product.svc_life_change || product.re_highlights
    const objection = product.key_objection || product.svc_main_objection
    const logistics = product.shipping_info || product.price_range || product.re_price || product.re_cta || product.location

    return {
      name: product.name || undefined,
      type: product.type || undefined,
      category: category || undefined,
      description: description || undefined,
      audience: audience || undefined,
      differentiation: product.differentiation || product.unique_value || product.svc_differentiation || undefined,
      result: result || undefined,
      objection: objection || undefined,
      logistics: logistics || undefined,
    }
  }

  const handleGenerate = async () => {
    if (isLogoMode) {
      if (!logoBusinessName.trim()) {
        setError(language === 'es' ? 'Ingresá el nombre del negocio.' : 'Enter the business name.')
        return
      }
      if (logoMode === 'enhance' && !existingLogoImage) {
        setError(language === 'es' ? 'Subí el logo actual para mejorar.' : 'Upload the existing logo to enhance.')
        return
      }
    } else if (isProductMode) {
      if (productImages.length === 0) {
        setError(t.productRefRequired)
        return
      }
    } else {
      const script = getScriptPrompt()
      if (!script) return
    }

    setGenerating(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error(language === 'es' ? 'No estás autenticado.' : 'Not authenticated.')

      const isVertical = aspectRatio === '9:16'
      const isSquare = aspectRatio === '1:1'
      const isCustomType = postStyle.startsWith('custom-')

      let requestBody: Record<string, unknown>

      if (isLogoMode) {
        const extra = additionalInstructions.trim()
        requestBody = {
          prompt: extra || '',
          mode: 'post',
          postStyle: 'logo',
          productId,
          aspectRatio: '1:1',
          width: 1024,
          height: 1024,
          model: imageModel,
          language,
          brandKitId: selectedBrandKitId || undefined,
          colorPaletteId: colorPaletteId !== 'auto' && colorPaletteId !== 'custom' ? colorPaletteId : undefined,
          customColors: colorPaletteId === 'custom' && customColors ? customColors : undefined,
          logoMode,
          logoArchetype,
          logoBackground,
          logoEnhanceTier,
          logoBusinessName: logoBusinessName.trim(),
          logoIndustry: logoIndustry.trim() || undefined,
          logoStyle: logoStylePref.trim() || undefined,
          logoAvoid: logoAvoid.trim() || undefined,
          logoUserKeeps: logoUserKeeps.trim() || undefined,
          logoUserChanges: logoUserChanges.trim() || undefined
        }
        // Attach uploaded logo as input_image for enhance mode
        if (logoMode === 'enhance' && existingLogoImage) {
          const base64 = await compressBase64ForApi(existingLogoImage)
          requestBody.input_image = base64
        }
      } else if (isProductMode) {
        const extraInstructions = additionalInstructions.trim()
        requestBody = {
          prompt: extraInstructions,
          mode: 'post',
          postStyle: 'product',
          productSubStyle: productSubStyle,
          backgroundDescription: productSubStyle === 'background-swap' ? backgroundDescription.trim() || undefined : undefined,
          productId,
          aspectRatio,
          width: 1080,
          height: isSquare ? 1080 : isVertical ? 1920 : 1440,
          model: imageModel,
          language,
          colorPaletteId: colorPaletteId !== 'auto' && colorPaletteId !== 'custom' ? colorPaletteId : undefined,
          customColors: colorPaletteId === 'custom' && customColors ? customColors : undefined,
          brandKitId: selectedBrandKitId || undefined
        }
      } else if (isOrganicSingleMode && organicSingleSubtype) {
        // ORGANIC SINGLE IMAGE — top-of-funnel aesthetic post (quote, infographic, showcase, brand aesthetic).
        const script = getScriptPrompt()
        requestBody = {
          prompt: script || additionalInstructions.trim() || '',
          mode: 'post',
          postStyle: 'organic-single',
          organicSubtype: organicSingleSubtype,
          ctaStrength,
          // Pass raw script as context so prompt builder has the underlying idea (non-literal).
          scriptContext: script || undefined,
          // Map organic-single idea text into content hints based on subtype.
          organicHeadline: organicSingleSubtype === 'infographic' || organicSingleSubtype === 'product-showcase-organic' || organicSingleSubtype === 'aesthetic-brand'
            ? (script || additionalInstructions.trim() || undefined)
            : undefined,
          organicQuote: organicSingleSubtype === 'quote-motivational'
            ? (script || additionalInstructions.trim() || undefined)
            : undefined,
          productId,
          aspectRatio,
          width: 1080,
          height: isVertical ? 1920 : aspectRatio === '1:1' ? 1080 : 1440,
          model: imageModel,
          language,
          colorPaletteId: colorPaletteId !== 'auto' && colorPaletteId !== 'custom' ? colorPaletteId : undefined,
          customColors: colorPaletteId === 'custom' && customColors ? customColors : undefined,
          brandKitId: selectedBrandKitId || undefined
        }
      } else {
        const script = getScriptPrompt()
        requestBody = {
          prompt: script,
          mode: 'post',
          postStyle: postStyle === 'anuncio-conversion' ? 'anuncio-conversion' : postStyle === 'venta-directa' ? 'venta-directa' : isCustomType ? 'custom-type' : 'preset',
          presetId: postStyle === 'venta-directa' || postStyle === 'anuncio-conversion' || isCustomType ? undefined : postStyle,
          customPostTypeId: isCustomType ? postStyle.replace('custom-', '') : undefined,
          productId,
          aspectRatio,
          width: 1080,
          height: isVertical ? 1920 : aspectRatio === '1:1' ? 1080 : 1440,
          model: imageModel,
          language,
          colorPaletteId: colorPaletteId !== 'auto' && colorPaletteId !== 'custom' ? colorPaletteId : undefined,
          customColors: colorPaletteId === 'custom' && customColors ? customColors : undefined,
          brandKitId: selectedBrandKitId || undefined
        }
      }

      // Attach product images as input_image[s] — skipped in logo mode (logo uses its own uploaded logo)
      if (!isLogoMode) {
        const selectedUrls = getProductImageUrls()
        if (selectedUrls.length > 0) {
          const base64Images = await Promise.all(selectedUrls.map(async u => compressBase64ForApi(await urlToBase64(u))))
          base64Images.forEach((img, i) => {
            requestBody[i === 0 ? 'input_image' : `input_image_${i + 1}`] = img
          })
        }

        // Attach context/inspiration images (mood, audience, scene) — separate from product truth.
        // Not used in product mode (product mode is strict single-product rendering).
        if (!isProductMode) {
          const contextUrls = getContextImageUrls()
          if (contextUrls.length > 0) {
            const base64Context = await Promise.all(contextUrls.map(async u => compressBase64ForApi(await urlToBase64(u))))
            requestBody.contextImages = base64Context
          }
        }
      }

      const result = await fetchJson<ImageApiResponse>(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      }, {
        timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
        ...imageApiMessages(language, t.error)
      })

      if (result.status === 'Ready' && result.result?.sample) {
        const imageUrl = result.result.sample
        const tempId = `post-${Date.now()}`
        const usedPrompt = requestBody.prompt as string || ''

        // Record AI memory signal for post generation
        if (productId) {
          recordAiSignal(productId, 'post_generated', {
            signal_key: `post_style_${postStyle}`,
          })
          if (colorPaletteId !== 'auto') {
            recordAiSignal(productId, 'color_palette_used', {
              signal_key: `palette_${colorPaletteId}`,
            })
          }
        }

        // Collapse config on mobile so user sees the result
        if (window.innerWidth < 1024) setMobileConfigOpen(false)

        // Show immediately with base64
        setGeneratedPosts(prev => [{
          id: tempId,
          imageUrl,
          prompt: usedPrompt,
          createdAt: new Date(),
          model: imageModel,
          saved: false
        }, ...prev])

        // Show enhance tip once (guard against redundant timeouts)
        if (!localStorage.getItem('enhance_tip_dismissed') && !showEnhanceTip) {
          const tipTimer = setTimeout(() => setShowEnhanceTip(true), 2000)
          // Auto-dismiss after 12 seconds
          setTimeout(() => {
            clearTimeout(tipTimer)
            setShowEnhanceTip(prev => {
              if (prev) localStorage.setItem('enhance_tip_dismissed', '1')
              return false
            })
          }, 14000)
        }

        // Upload to Supabase in background, then swap URL + save to DB
        if (user && productId) {
          (async () => {
            try {
              const savedUrl = await uploadPostImageOriginal(user.id, productId, imageUrl)
              const post = await createPost(productId, user.id, {
                prompt: usedPrompt,
                width: isLogoMode ? 1024 : 1080,
                height: isLogoMode ? 1024 : (aspectRatio === '1:1' ? 1080 : aspectRatio === '9:16' ? 1920 : 1440),
                output_format: 'png',
                model: imageModel
              })
              await updatePostStatus(post.id, 'completed', savedUrl)
              // Preload into browser cache before swapping URL to avoid blank flash
              await preloadImage(savedUrl)
              setGeneratedPosts(prev => prev.map(p =>
                p.id === tempId ? { ...p, id: post.id, imageUrl: savedUrl, saved: true } : p
              ))
              // Sync enhancing/editing refs if they were tracking this tempId
              if (enhancingPostIdRef.current === tempId) {
                enhancingPostIdRef.current = post.id
                setEnhancingPostId(post.id)
              }
              setEditingPostId(prev => prev === tempId ? post.id : prev)
            } catch (saveErr) {
              console.error('Failed to save image:', saveErr)
            }
          })()
        }
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

  // Download a single carousel slide with a meaningful filename (product-carousel-slide-N.jpg).
  const handleDownloadCarouselSlide = async (slide: CarouselSlide) => {
    try {
      const response = await fetch(slide.imageUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${product?.name || 'post'}-carousel-slide-${slide.slideIndex}.jpg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download slide failed:', err)
    }
  }

  // Download every slide of a carousel sequentially (tiny delay prevents browser rate-limit on download prompt).
  const handleDownloadCarouselAll = async (slides: CarouselSlide[]) => {
    for (const slide of slides) {
      await handleDownloadCarouselSlide(slide)
      await new Promise(r => setTimeout(r, 150))
    }
  }

  // Delete all slides of a carousel (one DB delete per slide; optimistic UI).
  const handleDeleteCarousel = async (slides: CarouselSlide[]) => {
    if (deletingPostId) return
    const slideIds = new Set(slides.map(s => s.id))
    const previousPosts = generatedPosts
    setDeletingPostId(slides[0]?.id ?? null)
    setGeneratedPosts(prev => prev.filter(p => !slideIds.has(p.id)))
    try {
      // Only persisted slides hit the DB (ids starting with 'post-'/'enhance-'/'edit-' are in-flight temp ids).
      await Promise.all(
        slides
          .filter(s => !/^(post-|enhance-|edit-)/.test(s.id))
          .map(s => deletePost(s.id))
      )
      setTotalPostCount(c => Math.max(0, c - slides.length))
    } catch (err) {
      console.error('Delete carousel failed:', err)
      setError(err instanceof Error ? err.message : t.deletePostError)
      setGeneratedPosts(previousPosts)
    } finally {
      setDeletingPostId(null)
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

      const detectedAR = await detectImageAspectRatio(imageUrl)
      const base64Image = await compressBase64ForApi(await urlToBase64(imageUrl))
      const compressedRefImages = editRefImages.length > 0
        ? await Promise.all(editRefImages.map(img => compressBase64ForApi(img)))
        : undefined

      const result = await fetchJson<ImageApiResponse>(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'edit',
          editPrompt: editPrompt.trim(),
          editImage: base64Image,
          aspectRatio: detectedAR,
          brandKitId: selectedBrandKitId || undefined,
          ...(compressedRefImages ? { editReferenceImages: compressedRefImages } : {})
        })
      }, {
        timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
        ...imageApiMessages(language, t.editError)
      })

      if (result.status === 'Ready' && result.result?.sample) {
        const editedUrl = result.result.sample
        const tempId = `edit-${Date.now()}`
        const editText = editPrompt.trim()

        // Show immediately with base64 + clear edit state
        setGeneratedPosts(prev => {
          const idx = prev.findIndex(p => p.id === postId)
          const next = [...prev]
          next.splice(idx + 1, 0, {
            id: tempId,
            imageUrl: editedUrl,
            prompt: `✏️ ${editText}`,
            createdAt: new Date(),
            model: 'nano-banana-pro',
            saved: false
          })
          return next
        })
        setEditPrompt('')
        setEditRefImages([])
        setEditingPostId(null)

        // Upload to Supabase in background
        if (user && productId) {
          (async () => {
            try {
              const savedUrl = await uploadPostImageOriginal(user.id, productId, editedUrl)
              const dbPost = await createPost(productId, user.id, {
                prompt: `Edit: ${editText}`,
                width: 0,
                height: 0,
                output_format: 'png',
                model: 'nano-banana-pro'
              })
              await updatePostStatus(dbPost.id, 'completed', savedUrl)
              // Preload into browser cache before swapping URL to avoid blank flash
              await preloadImage(savedUrl)
              setGeneratedPosts(prev => prev.map(p =>
                p.id === tempId ? { ...p, id: dbPost.id, imageUrl: savedUrl, saved: true } : p
              ))
              // Sync enhancing ref if it was tracking this tempId
              if (enhancingPostIdRef.current === tempId) {
                enhancingPostIdRef.current = dbPost.id
                setEnhancingPostId(dbPost.id)
              }
            } catch (saveErr) {
              console.error('Failed to save edited image:', saveErr)
            }
          })()
        }
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

  const handleDeletePost = async (postId: string) => {
    if (deletingPostId) return
    setDeletingPostId(postId)
    setDeleteConfirmFor(null)
    setError('')
    // Optimistic removal from UI
    const previousPosts = generatedPosts
    setGeneratedPosts(prev => prev.filter(p => p.id !== postId))
    try {
      // Only delete the DB row if this post was actually persisted (tempIds from
      // in-flight generations start with 'post-' / 'enhance-' / 'edit-' and are
      // not UUIDs — skip the DB call for those).
      const isPersistedId = !/^(post|enhance|edit)-/.test(postId)
      if (isPersistedId) {
        await deletePost(postId)
      }
      // NOTE: we intentionally do NOT adjust usage counters here.
      // The generation was already billed against the user's quota at the
      // moment the image was produced. Deleting the post is a UI cleanup only,
      // so usage, bonus_images, and admin logs remain untouched.
    } catch (err) {
      console.error('Delete post failed:', err)
      setError(err instanceof Error ? err.message : t.deletePostError)
      // Roll back on failure
      setGeneratedPosts(previousPosts)
    } finally {
      setDeletingPostId(null)
    }
  }

  const handleEnhance = async (postId: string, imageUrl: string, tier: 'polish' | 'modernize' | 'rebuild' = 'modernize') => {
    if (enhancingPostId) return

    setEnhancingPostId(postId)
    enhancingPostIdRef.current = postId
    setEnhanceMenuFor(null)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error(language === 'es' ? 'No estás autenticado.' : 'Not authenticated.')

      const detectedAR = await detectImageAspectRatio(imageUrl)
      const base64Image = await compressBase64ForApi(await urlToBase64(imageUrl))

      const result = await fetchJson<ImageApiResponse>(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'enhance',
          enhanceImage: base64Image,
          aspectRatio: detectedAR,
          language,
          enhanceTier: tier,
          brandKitId: selectedBrandKitId || undefined,
          productReferenceImages: getProductImageUrls().length > 0
            ? await Promise.all(getProductImageUrls().map(async u => compressBase64ForApi(await urlToBase64(u))))
            : undefined,
          contextReferenceImages: getContextImageUrls().length > 0
            ? await Promise.all(getContextImageUrls().map(async u => compressBase64ForApi(await urlToBase64(u))))
            : undefined
        })
      }, {
        timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
        ...imageApiMessages(language, t.enhanceError)
      })

      if (result.status === 'Ready' && result.result?.sample) {
        const enhancedUrl = result.result.sample
        const tempId = `enhance-${Date.now()}`

        // Use ref to get the CURRENT post id (may have changed via background save)
        const currentPostId = enhancingPostIdRef.current || postId

        // Show immediately with base64
        setGeneratedPosts(prev => {
          const idx = prev.findIndex(p => p.id === currentPostId)
          const next = [...prev]
          next.splice(idx + 1, 0, {
            id: tempId,
            imageUrl: enhancedUrl,
            prompt: `✨ Enhanced`,
            createdAt: new Date(),
            model: 'nano-banana-pro',
            saved: false
          })
          return next
        })

        // Upload to Supabase in background
        if (user && productId) {
          (async () => {
            try {
              const savedUrl = await uploadPostImageOriginal(user.id, productId, enhancedUrl)
              const dbPost = await createPost(productId, user.id, {
                prompt: 'Enhanced version',
                width: 0,
                height: 0,
                output_format: 'png',
                model: 'nano-banana-pro'
              })
              await updatePostStatus(dbPost.id, 'completed', savedUrl)
              // Preload into browser cache before swapping URL to avoid blank flash
              await preloadImage(savedUrl)
              setGeneratedPosts(prev => prev.map(p =>
                p.id === tempId ? { ...p, id: dbPost.id, imageUrl: savedUrl, saved: true } : p
              ))
              // Sync enhancing ref if user started enhancing this post before save finished
              if (enhancingPostIdRef.current === tempId) {
                enhancingPostIdRef.current = dbPost.id
                setEnhancingPostId(dbPost.id)
              }
            } catch (saveErr) {
              console.error('Failed to save enhanced image:', saveErr)
            }
          })()
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.enhanceError)
    } finally {
      setEnhancingPostId(null)
      enhancingPostIdRef.current = null
    }
  }

  const handleCreateStyleFromPost = async (imageUrl: string) => {
    try {
      const base64 = await urlToBase64(imageUrl)
      setCreateTypeFromImage(base64)
      setShowCreatePostType(true)
    } catch (err) {
      console.error('Failed to load post image for style creation:', err)
      setError(language === 'es' ? 'No se pudo cargar la imagen para crear el estilo.' : 'Failed to load image for style creation.')
    }
  }

  const dismissEnhanceTip = () => {
    setShowEnhanceTip(false)
    localStorage.setItem('enhance_tip_dismissed', '1')
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
          saved: true,
          carouselGroupId: post.carousel_group_id ?? null,
          slideIndex: post.slide_index ?? null,
          slideTotal: post.slide_total ?? null,
          carouselSubtype: post.carousel_subtype ?? null,
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
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Panel — Script Input & Settings */}
        {/* Mobile overlay backdrop */}
        {mobileConfigOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileConfigOpen(false)} />
        )}
        <div className={`fixed inset-y-0 left-0 z-50 w-[90vw] max-w-[420px] lg:static lg:z-auto lg:w-[420px] bg-dark-100/90 backdrop-blur-lg border-r border-white/[0.04] flex flex-col min-h-0 overflow-hidden transition-transform duration-200 ${!mobileConfigOpen ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'}`}>
          {/* Header */}
          <div className="px-5 py-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between mb-3">
              <Link
                to="/posts"
                className="inline-flex items-center gap-1.5 text-dark-400 hover:text-dark-600 text-xs font-medium tracking-wide uppercase transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t.back}
              </Link>
              <button
                onClick={() => setMobileConfigOpen(false)}
                className="lg:hidden p-2 hover:bg-dark-200 rounded-lg text-dark-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
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
                  {isProductMode ? <Camera className="w-4 h-4 text-primary-400 flex-shrink-0" /> : isAnuncioMode ? <Sparkles className="w-4 h-4 text-orange-500 flex-shrink-0" /> : isLogoMode ? <Sparkles className="w-4 h-4 text-pink-500 flex-shrink-0" /> : <ImageIcon className="w-4 h-4 text-dark-400 flex-shrink-0" />}
                  {postStyle === 'anuncio-conversion'
                    ? t.anuncioType
                    : postStyle === 'product'
                      ? t.productType
                      : postStyle === 'logo'
                        ? t.logoType
                        : postStyle === 'venta-directa'
                          ? t.styleDirectSale
                          : postStyle.startsWith('custom-')
                            ? (customPostTypes.find(c => `custom-${c.id}` === postStyle)?.name || postStyle)
                            : (IMAGE_PRESETS.find(p => p.id === postStyle)?.[language === 'es' ? 'nameEs' : 'name'] || postStyle)
                  }
                </span>
                {showStyleDropdown ? <ChevronUp className="w-4 h-4 text-dark-400" /> : <ChevronDown className="w-4 h-4 text-dark-400" />}
              </button>

              {showStyleDropdown && (
                <div className="absolute z-30 mt-1 w-full bg-dark-100 rounded-xl shadow-xl border border-dark-200 max-h-[400px] overflow-y-auto">
                  {/* Anuncio de Conversión — top of dropdown */}
                  <button
                    onClick={() => { setPostStyle('anuncio-conversion'); setStreamlinedScript(null); setShowStyleDropdown(false); if (aspectRatio === '9:16') setAspectRatio('3:4') }}
                    className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-dark-50 border-b border-dark-100 ${
                      postStyle === 'anuncio-conversion' ? 'bg-primary-900/20' : ''
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-dark-800">{t.anuncioType}</div>
                      <div className="text-[11px] text-dark-400 mt-0.5">{t.anuncioTypeDesc}</div>
                    </div>
                    {postStyle === 'anuncio-conversion' && (
                      <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                    )}
                  </button>

                  {/* Venta Directa — always first */}
                  <button
                    onClick={() => { setPostStyle('venta-directa'); setStreamlinedScript(null); setShowStyleDropdown(false) }}
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

                  {/* Product Photo — second */}
                  <button
                    onClick={() => { setPostStyle('product'); setStreamlinedScript(null); setShowStyleDropdown(false) }}
                    className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-dark-50 border-b border-dark-100 ${
                      postStyle === 'product' ? 'bg-primary-900/20' : ''
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center flex-shrink-0">
                      <Camera className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-dark-800">{t.productType}</div>
                      <div className="text-[11px] text-dark-400 mt-0.5">{t.productTypeDesc}</div>
                    </div>
                    {postStyle === 'product' && (
                      <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                    )}
                  </button>

                  {/* Logo Generator — third */}
                  <button
                    onClick={() => { setPostStyle('logo'); setStreamlinedScript(null); setShowStyleDropdown(false); setAspectRatio('1:1') }}
                    className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-dark-50 border-b border-dark-100 ${
                      postStyle === 'logo' ? 'bg-primary-900/20' : ''
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-dark-800">{t.logoType}</div>
                      <div className="text-[11px] text-dark-400 mt-0.5">{t.logoTypeDesc}</div>
                    </div>
                    {postStyle === 'logo' && (
                      <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                    )}
                  </button>

                  {/* ORGANIC SECTION — top-of-funnel content (no hard sales CTA) */}
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-900/10 border-y border-emerald-800/30">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                      {language === 'es' ? 'Orgánico' : 'Organic'}
                    </span>
                    <span className="text-[9px] text-dark-400 truncate">
                      · {language === 'es' ? 'valor, historia, aesthetic' : 'value, story, aesthetic'}
                    </span>
                  </div>

                  {/* Organic Carousel — opens dedicated modal */}
                  <button
                    onClick={() => { setCarouselModalOpen(true); setShowStyleDropdown(false) }}
                    className="w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-emerald-900/10 border-b border-dark-100"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-dark-800">
                        {language === 'es' ? 'Carrusel Orgánico' : 'Organic Carousel'}
                      </div>
                      <div className="text-[11px] text-dark-400 mt-0.5">
                        {language === 'es' ? '2–10 slides con consistencia visual' : '2–10 slides with visual consistency'}
                      </div>
                    </div>
                    <div className="px-2 py-0.5 rounded-md bg-emerald-900/30 text-emerald-300 text-[9px] font-bold uppercase tracking-wider">
                      Nuevo
                    </div>
                  </button>

                  {/* Organic Single Images — 4 subtypes */}
                  {([
                    { id: 'quote-motivational', es: 'Cita / Motivacional', en: 'Quote / Motivational', desc_es: 'Frase dominante, fondo aesthetic', desc_en: 'Dominant quote, aesthetic background' },
                    { id: 'infographic', es: 'Infografía', en: 'Infographic', desc_es: 'Datos con jerarquía visual', desc_en: 'Data with visual hierarchy' },
                    { id: 'product-showcase-organic', es: 'Showcase Orgánico', en: 'Organic Showcase', desc_es: 'Producto editorial (no ad)', desc_en: 'Editorial product (not ad)' },
                    { id: 'aesthetic-brand', es: 'Brand Aesthetic', en: 'Brand Aesthetic', desc_es: 'Full-bleed de marca', desc_en: 'Full-bleed brand statement' },
                  ] as { id: OrganicSingleSubtype; es: string; en: string; desc_es: string; desc_en: string }[]).map(o => {
                    const value = `organic-single:${o.id}`
                    return (
                      <button
                        key={o.id}
                        onClick={() => { setPostStyle(value); setStreamlinedScript(null); setShowStyleDropdown(false); if (aspectRatio === '9:16') setAspectRatio('1:1') }}
                        className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-emerald-900/10 border-b border-dark-100 ${
                          postStyle === value ? 'bg-emerald-900/25' : ''
                        }`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-emerald-900/30 border border-emerald-800/40 flex items-center justify-center flex-shrink-0">
                          <Sparkles className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-dark-800">{language === 'es' ? o.es : o.en}</div>
                          <div className="text-[11px] text-dark-400 mt-0.5">{language === 'es' ? o.desc_es : o.desc_en}</div>
                        </div>
                        {postStyle === value && (
                          <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2 flex-shrink-0" />
                        )}
                      </button>
                    )
                  })}

                  {/* Preset styles */}
                  {IMAGE_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => { setPostStyle(preset.id); setStreamlinedScript(null); setShowStyleDropdown(false) }}
                      className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-dark-50 border-b border-dark-100 ${
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

                  {/* Custom post types */}
                  {customPostTypes.length > 0 && (
                    <div className="border-t border-dark-200 pt-1">
                      <div className="px-3 py-1.5">
                        <span className="text-[10px] font-bold text-dark-400 uppercase tracking-wider">
                          {language === 'es' ? 'Mis Estilos' : 'My Styles'}
                        </span>
                      </div>
                      {customPostTypes.map(ct => (
                        <button
                          key={ct.id}
                          onClick={() => { setPostStyle(`custom-${ct.id}`); setStreamlinedScript(null); setShowStyleDropdown(false) }}
                          className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-dark-50 border-b border-dark-100 ${
                            postStyle === `custom-${ct.id}` ? 'bg-primary-900/20' : ''
                          }`}
                        >
                          {ct.reference_images?.[0] ? (
                            <img src={ct.reference_images[0]} alt={ct.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                              <Sparkles className="w-5 h-5 text-white" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-dark-800">{ct.name}</div>
                            {ct.description && (
                              <div className="text-[11px] text-dark-400 mt-0.5 line-clamp-2">{ct.description}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 mt-1">
                            {postStyle === `custom-${ct.id}` && (
                              <div className="w-2 h-2 rounded-full bg-primary-500" />
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (confirm(language === 'es' ? '¿Eliminar este estilo?' : 'Delete this style?')) {
                                  deleteCustomPostType(ct.id).then(() => {
                                    setCustomPostTypes(prev => prev.filter(c => c.id !== ct.id))
                                    if (postStyle === `custom-${ct.id}`) setPostStyle('venta-directa')
                                  })
                                }
                              }}
                              className="p-1.5 rounded hover:bg-red-100 text-dark-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Create custom post type button */}
                  <button
                    onClick={() => { setShowCreatePostType(true); setShowStyleDropdown(false) }}
                    className="w-full flex items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-dark-50 border-t border-dark-200"
                  >
                    <div className="w-10 h-10 rounded-lg border-2 border-dashed border-dark-300 flex items-center justify-center flex-shrink-0">
                      <Plus className="w-5 h-5 text-dark-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-primary-600">
                        {language === 'es' ? 'Crear Estilo Personalizado' : 'Create Custom Style'}
                      </div>
                      <div className="text-[11px] text-dark-400 mt-0.5">
                        {language === 'es' ? 'Sube imágenes de referencia y la IA creará tu estilo' : 'Upload reference images and AI will create your style'}
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Brand Kit Selector */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                Brand Kit
              </label>
              <BrandKitSelector
                selectedKitId={selectedBrandKitId}
                onSelect={setSelectedBrandKitId}
                productId={productId}
              />
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
                      className="ml-0.5 opacity-100 lg:opacity-0 lg:group-hover/cp:opacity-100 transition-opacity p-0.5"
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

            {/* Product mode: sub-style picker + background input */}
            {isProductMode && (
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                  <Camera className="w-3.5 h-3.5 text-primary-500" />
                  {t.productSubStyleLabel}
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRODUCT_SUB_STYLES.map(style => (
                    <button
                      key={style.id}
                      onClick={() => setProductSubStyle(style.id)}
                      className={`flex items-start gap-2 p-2.5 rounded-lg text-left transition-all ${
                        productSubStyle === style.id
                          ? 'bg-primary-900/20 text-primary-700 border border-primary-300 shadow-sm'
                          : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                      }`}
                    >
                      <span className="text-base leading-none mt-0.5">{style.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold">{language === 'es' ? style.nameEs : style.name}</div>
                        <div className="text-[9px] text-dark-400 mt-0.5 leading-tight">{language === 'es' ? style.descriptionEs : style.description}</div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Background description for background-swap sub-style */}
                {productSubStyle === 'background-swap' && (
                  <div className="mt-3">
                    <label className="block text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">
                      {t.backgroundDesc}
                    </label>
                    <textarea
                      value={backgroundDescription}
                      onChange={(e) => setBackgroundDescription(e.target.value)}
                      placeholder={t.backgroundPlaceholder}
                      rows={2}
                      className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300 input-glow"
                    />
                  </div>
                )}

                {/* Additional instructions for product mode */}
                <div className="mt-3">
                  <label className="block text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">
                    {t.productInstructions}
                  </label>
                  <textarea
                    value={additionalInstructions}
                    onChange={(e) => setAdditionalInstructions(e.target.value)}
                    placeholder={t.productInstructionsPlaceholder}
                    rows={2}
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300 input-glow"
                  />
                </div>
              </div>
            )}

            {/* Logo Generator config — only when in logo mode */}
            {isLogoMode && (
              <div className="space-y-3">
                {/* Mode toggle: generate vs enhance */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-pink-500" />
                    {language === 'es' ? 'Modo' : 'Mode'}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => setLogoMode('generate')}
                      className={`p-2.5 rounded-lg text-xs transition-colors ${
                        logoMode === 'generate'
                          ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                          : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                      }`}
                    >
                      <div className="font-medium">{t.logoModeGenerate}</div>
                    </button>
                    <button
                      onClick={() => setLogoMode('enhance')}
                      className={`p-2.5 rounded-lg text-xs transition-colors ${
                        logoMode === 'enhance'
                          ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                          : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                      }`}
                    >
                      <div className="font-medium">{t.logoModeEnhance}</div>
                    </button>
                  </div>
                </div>

                {/* Existing logo uploader — enhance mode only */}
                {logoMode === 'enhance' && (
                  <div>
                    <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                      {t.logoExistingLabel}
                    </label>
                    <p className="text-[10px] text-dark-400 mb-2">{t.logoExistingHint}</p>
                    <div className="flex gap-2 items-center">
                      {existingLogoImage ? (
                        <div className="relative group">
                          <div className="w-20 h-20 rounded-lg overflow-hidden border-2 border-primary-500 ring-2 ring-primary-500/30 bg-white">
                            <img src={existingLogoImage} alt="Existing logo" className="w-full h-full object-contain" />
                          </div>
                          <button
                            onClick={() => setExistingLogoImage(null)}
                            className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center hover:bg-red-700"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => existingLogoInputRef.current?.click()}
                          className="w-20 h-20 rounded-lg border-2 border-dashed border-dark-200 flex flex-col items-center justify-center text-dark-400 hover:border-primary-400 hover:text-primary-500 transition-colors"
                        >
                          <Upload className="w-4 h-4" />
                          <span className="text-[9px] mt-0.5">{language === 'es' ? 'Subir logo' : 'Upload logo'}</span>
                        </button>
                      )}
                      <input
                        ref={existingLogoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onloadend = () => setExistingLogoImage(reader.result as string)
                          reader.readAsDataURL(file)
                          if (existingLogoInputRef.current) existingLogoInputRef.current.value = ''
                        }}
                        className="hidden"
                      />
                    </div>
                  </div>
                )}

                {/* Enhance tier — enhance mode only */}
                {logoMode === 'enhance' && (
                  <div>
                    <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                      {t.logoEnhanceTierLabel}
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {LOGO_ENHANCE_TIERS.map(tier => (
                        <button
                          key={tier.id}
                          onClick={() => setLogoEnhanceTier(tier.id)}
                          className={`p-2 rounded-lg text-left transition-colors ${
                            logoEnhanceTier === tier.id
                              ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                              : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                          }`}
                        >
                          <div className="text-[11px] font-semibold">{language === 'es' ? tier.nameEs : tier.name}</div>
                          <div className="text-[9px] text-dark-400 mt-0.5 leading-tight">{language === 'es' ? tier.descriptionEs : tier.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* What to keep / change — enhance mode only */}
                {logoMode === 'enhance' && (
                  <>
                    <div>
                      <label className="block text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">
                        {t.logoUserKeepsLabel}
                      </label>
                      <input
                        type="text"
                        value={logoUserKeeps}
                        onChange={(e) => setLogoUserKeeps(e.target.value)}
                        placeholder={t.logoUserKeepsPlaceholder}
                        className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">
                        {t.logoUserChangesLabel}
                      </label>
                      <input
                        type="text"
                        value={logoUserChanges}
                        onChange={(e) => setLogoUserChanges(e.target.value)}
                        placeholder={t.logoUserChangesPlaceholder}
                        className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                      />
                    </div>
                  </>
                )}

                {/* Business name */}
                <div>
                  <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                    {t.logoBusinessNameLabel}
                  </label>
                  <input
                    type="text"
                    value={logoBusinessName}
                    onChange={(e) => setLogoBusinessName(e.target.value)}
                    placeholder={t.logoBusinessNamePlaceholder}
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300 input-glow"
                  />
                </div>

                {/* Industry */}
                <div>
                  <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                    {t.logoIndustryLabel}
                  </label>
                  <input
                    type="text"
                    value={logoIndustry}
                    onChange={(e) => setLogoIndustry(e.target.value)}
                    placeholder={t.logoIndustryPlaceholder}
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300 input-glow"
                  />
                </div>

                {/* Archetype picker — generate mode only */}
                {logoMode === 'generate' && (
                  <div>
                    <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                      {t.logoArchetypeLabel}
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {LOGO_ARCHETYPES.map(arch => (
                        <button
                          key={arch.id}
                          onClick={() => setLogoArchetype(arch.id)}
                          className={`flex items-start gap-2 p-2.5 rounded-lg text-left transition-all ${
                            logoArchetype === arch.id
                              ? 'bg-primary-900/20 text-primary-700 border border-primary-300 shadow-sm'
                              : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                          }`}
                        >
                          <span className="text-base leading-none mt-0.5 font-bold">{arch.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold">{language === 'es' ? arch.nameEs : arch.name}</div>
                            <div className="text-[9px] text-dark-400 mt-0.5 leading-tight">{language === 'es' ? arch.descriptionEs : arch.description}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Background picker */}
                <div>
                  <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                    {t.logoBackgroundLabel}
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {LOGO_BACKGROUNDS.map(bg => (
                      <button
                        key={bg.id}
                        onClick={() => setLogoBackground(bg.id)}
                        className={`p-2 rounded-lg text-xs transition-colors ${
                          logoBackground === bg.id
                            ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                            : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-100'
                        }`}
                      >
                        <div className={`w-full h-6 rounded mb-1 border ${bg.id === 'white' ? 'bg-white border-dark-200' : bg.id === 'dark' ? 'bg-dark-900 border-dark-800' : 'bg-gradient-to-br from-dark-50 to-white border-dark-200'}`} />
                        <div className="font-medium">{language === 'es' ? bg.nameEs : bg.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Style preference */}
                <div>
                  <label className="block text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">
                    {t.logoStylePrefLabel}
                  </label>
                  <input
                    type="text"
                    value={logoStylePref}
                    onChange={(e) => setLogoStylePref(e.target.value)}
                    placeholder={t.logoStylePrefPlaceholder}
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                  />
                </div>

                {/* Avoid */}
                <div>
                  <label className="block text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">
                    {t.logoAvoidLabel}
                  </label>
                  <input
                    type="text"
                    value={logoAvoid}
                    onChange={(e) => setLogoAvoid(e.target.value)}
                    placeholder={t.logoAvoidPlaceholder}
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                  />
                </div>

                {/* Additional instructions */}
                <div>
                  <label className="block text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">
                    {t.logoAdditionalLabel}
                  </label>
                  <textarea
                    value={additionalInstructions}
                    onChange={(e) => setAdditionalInstructions(e.target.value)}
                    placeholder={t.logoAdditionalPlaceholder}
                    rows={2}
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300 input-glow"
                  />
                </div>
              </div>
            )}

            {/* Script selector — hidden in product and logo modes */}
            {!isProductMode && !isLogoMode && (
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
                              setStreamlinedScript(null)
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
                    <div className="flex items-center gap-1.5">
                      {!streamlinedScript && (
                        <button
                          onClick={handleStreamline}
                          disabled={streamlining}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-dark-100 border border-dark-200 text-amber-400 hover:bg-dark-200 transition-colors disabled:opacity-50"
                          title={t.streamline}
                        >
                          {streamlining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                          {streamlining ? t.streamlining : t.streamline}
                        </button>
                      )}
                      <button
                        onClick={() => { setSelectedScript(null); setStreamlinedScript(null) }}
                        className="text-[10px] text-primary-500 hover:text-primary-700 font-medium"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-dark-600 leading-relaxed line-clamp-3 whitespace-pre-wrap">{selectedScript.content}</p>
                </div>
              )}

              {/* Streamlined script card */}
              {streamlinedScript && (
                <div className="mt-2 bg-dark-100 border border-emerald-500/30 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                      <Wand2 className="w-3 h-3" />
                      {t.streamlined}
                    </p>
                    <button
                      onClick={() => setStreamlinedScript(null)}
                      className="flex items-center gap-1 text-[10px] text-dark-400 hover:text-dark-600 font-medium"
                    >
                      <X className="w-3 h-3" />
                      {t.revertStreamline}
                    </button>
                  </div>
                  <textarea
                    value={streamlinedScript}
                    onChange={(e) => setStreamlinedScript(e.target.value)}
                    rows={6}
                    className="w-full text-xs text-dark-500 leading-relaxed bg-dark-50 border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-transparent"
                  />
                </div>
              )}

              {/* Or paste directly */}
              {!selectedScript && (
                <>
                  <p className="text-[10px] text-dark-400 text-center my-2">{t.pasteScript}</p>
                  <textarea
                    value={scriptText}
                    onChange={(e) => { setScriptText(e.target.value); setStreamlinedScript(null) }}
                    placeholder={t.scriptPlaceholder}
                    rows={4}
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300 input-glow"
                  />
                  {scriptText.trim() && !streamlinedScript && (
                    <button
                      onClick={handleStreamline}
                      disabled={streamlining}
                      className="mt-1.5 flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium bg-dark-100 border border-dark-200 text-amber-400 hover:bg-dark-200 transition-colors disabled:opacity-50"
                    >
                      {streamlining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                      {streamlining ? t.streamlining : t.streamline}
                    </button>
                  )}
                </>
              )}

              {/* Additional instructions — always visible */}
              {(selectedScript || scriptText.trim()) && (
                <div className="mt-3">
                  <label className="block text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">
                    {t.additionalInstructions}
                  </label>
                  <textarea
                    value={additionalInstructions}
                    onChange={(e) => setAdditionalInstructions(e.target.value)}
                    placeholder={t.additionalPlaceholder}
                    rows={3}
                    className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300 input-glow"
                  />
                </div>
              )}
            </div>
            )}

            {/* Product images — persistent, used as strict product truth. Hidden in logo mode. */}
            {!isLogoMode && (() => {
              const productRefs = productImages.filter(i => (i.kind || 'product') === 'product')
              const contextRefs = productImages.filter(i => i.kind === 'context')
              return (
              <>
              <div>
                <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                  {isProductMode
                    ? (language === 'es' ? 'Foto del producto (requerida)' : 'Product photo (required)')
                    : (language === 'es' ? 'Imágenes del producto (opcional)' : 'Product images (optional)')}
                </label>
                <p className="text-[10px] text-dark-400 mb-2">
                  {isProductMode
                    ? (language === 'es'
                      ? 'Sube la foto de tu producto. La IA generará una versión profesional.'
                      : 'Upload your product photo. AI will generate a professional version.')
                    : (language === 'es'
                      ? 'Fotos reales del producto. La IA las respetará EXACTAMENTE (forma, color, detalles).'
                      : 'Real product photos. AI will preserve them EXACTLY (shape, color, details).')}
                </p>

                <div className="flex gap-2 flex-wrap">
                  {productRefs.map((img) => (
                      <div key={img.id} className="relative group">
                        <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-primary-500 ring-2 ring-primary-500/30">
                          <img src={img.image_url} alt="Product" className="w-full h-full object-cover" />
                        </div>
                        <button
                          onClick={() => handleDeleteProductImage(img.id)}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity hover:bg-red-700"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}

                  {productRefs.length < 4 && (
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
                    onChange={(e) => handleImageUploadByKind(e, 'product')}
                    className="hidden"
                  />
                </div>

                {productRefs.length > 0 && (
                  <p className="text-[10px] text-primary-500 mt-1.5 font-medium">
                    {language === 'es'
                      ? `${productRefs.length} imagen(es) del producto`
                      : `${productRefs.length} product image(s)`}
                  </p>
                )}
              </div>

              {/* Context / inspiration images — mood, audience, scene. Not product truth. */}
              {!isProductMode && (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                  {language === 'es' ? 'Imágenes de contexto (opcional)' : 'Context images (optional)'}
                </label>
                <p className="text-[10px] text-dark-400 mb-2">
                  {language === 'es'
                    ? 'Inspiración: familia feliz, escena, audiencia, estilo de vida. La IA usa el ambiente — no copia el producto de estas.'
                    : 'Inspiration: happy family, scene, audience, lifestyle. AI uses the mood — not the product from these.'}
                </p>

                <div className="flex gap-2 flex-wrap">
                  {contextRefs.map((img) => (
                      <div key={img.id} className="relative group">
                        <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-amber-400 ring-2 ring-amber-400/30">
                          <img src={img.image_url} alt="Context" className="w-full h-full object-cover" />
                        </div>
                        <button
                          onClick={() => handleDeleteProductImage(img.id)}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity hover:bg-red-700"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}

                  {contextRefs.length < 4 && (
                    <button
                      onClick={() => contextImageInputRef.current?.click()}
                      disabled={uploadingContextImage}
                      className="w-16 h-16 rounded-lg border-2 border-dashed border-dark-200 flex flex-col items-center justify-center text-dark-400 hover:border-amber-400 hover:text-amber-500 transition-colors disabled:opacity-50"
                    >
                      {uploadingContextImage ? (
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
                    ref={contextImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
                    multiple
                    onChange={(e) => handleImageUploadByKind(e, 'context')}
                    className="hidden"
                  />
                </div>

                {contextRefs.length > 0 && (
                  <p className="text-[10px] text-amber-600 mt-1.5 font-medium">
                    {language === 'es'
                      ? `${contextRefs.length} imagen(es) de inspiración`
                      : `${contextRefs.length} inspiration image(s)`}
                  </p>
                )}
              </div>
              )}
              </>
              )
            })()}


            {/* Aspect Ratio — hidden in logo mode (forced to 1:1) */}
            {!isLogoMode && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                <ImageIcon className="w-3.5 h-3.5 text-primary-500" />
                {t.formatLabel}
              </label>
              <div className={`grid gap-1.5 ${isProductMode ? 'grid-cols-3' : isAnuncioMode ? 'grid-cols-2' : 'grid-cols-2'}`}>
                {(isAnuncioMode ? [
                  { id: '3:4' as PostAspectRatio, name: t.squarePost, sub: '3:4 (1080×1350)' },
                  { id: '1:1' as PostAspectRatio, name: t.squareFormat, sub: '1:1 (1080×1080)' },
                ] : [
                  { id: '9:16' as PostAspectRatio, name: t.reelStory, sub: '9:16' },
                  { id: '3:4' as PostAspectRatio, name: t.squarePost, sub: '3:4' },
                  ...(isProductMode || isOrganicSingleMode ? [{ id: '1:1' as PostAspectRatio, name: t.squareFormat, sub: '1:1' }] : []),
                ] as { id: PostAspectRatio; name: string; sub: string }[]).map(f => (
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
            )}

            {/* CTA Strength — organic-single only */}
            {isOrganicSingleMode && (
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-dark-600 tracking-wide uppercase mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  {language === 'es' ? 'Fuerza del CTA' : 'CTA Strength'}
                </label>
                <div className="grid grid-cols-4 gap-1">
                  {(['none', 'soft', 'brand_mention', 'sales'] as CTAStrength[]).map(s => {
                    const labels: Record<CTAStrength, { es: string; en: string }> = {
                      none: { es: 'Ninguno', en: 'None' },
                      soft: { es: 'Suave', en: 'Soft' },
                      brand_mention: { es: 'Marca', en: 'Brand' },
                      sales: { es: 'Ventas', en: 'Sales' },
                    }
                    const active = ctaStrength === s
                    const isSales = s === 'sales'
                    return (
                      <button
                        key={s}
                        onClick={() => setCtaStrength(s)}
                        className={`px-2 py-2 text-[11px] font-medium rounded-lg transition-all ${
                          active
                            ? isSales
                              ? 'bg-primary-500 text-white shadow-md'
                              : 'bg-emerald-600 text-white shadow-md'
                            : 'bg-dark-50 text-dark-500 hover:bg-dark-100 border border-dark-200'
                        }`}
                      >
                        {language === 'es' ? labels[s].es : labels[s].en}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

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
              disabled={generating || (
                isLogoMode
                  ? (!logoBusinessName.trim() || (logoMode === 'enhance' && !existingLogoImage))
                  : isProductMode
                    ? productImages.length === 0
                    : !hasScript
              )}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl btn-glow font-medium text-sm"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isLogoMode ? t.generatingLogo : isProductMode ? t.generatingProduct : t.generating}
                </>
              ) : (
                <>
                  {isLogoMode ? <Sparkles className="w-4 h-4" /> : isProductMode ? <Camera className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  {isLogoMode ? t.generateLogo : isProductMode ? t.generateProduct : t.generate}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Panel — Generated Posts */}
        <div className="flex-1 bg-dark-50/50 overflow-auto">
          {/* Mobile toolbar — always visible on mobile */}
          <div className="lg:hidden flex items-center gap-2 px-4 py-3 bg-dark-100 border-b border-dark-200">
            <Link to="/posts" className="p-2 hover:bg-dark-200 rounded-lg transition-colors">
              <ArrowLeft className="w-4 h-4 text-dark-500" />
            </Link>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-dark-800 truncate">{product.name}</p>
            </div>
            <button
              onClick={() => setMobileConfigOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-dark-200 hover:bg-dark-300 rounded-lg text-xs font-medium text-dark-600 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary-500" />
              {language === 'es' ? 'Configurar' : 'Configure'}
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || (
                isLogoMode
                  ? (!logoBusinessName.trim() || (logoMode === 'enhance' && !existingLogoImage))
                  : isProductMode
                    ? productImages.length === 0
                    : !hasScript
              )}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg btn-glow text-xs font-medium"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {language === 'es' ? 'Generar' : 'Generate'}
            </button>
          </div>
          <div className="p-6">
            <h2 className="text-sm font-semibold text-dark-700 tracking-wide uppercase mb-4">{t.generatedImages}</h2>

            {generatedPosts.length > 0 || generating ? (
              <>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {generating && (
                  <GeneratingPlaceholder
                    aspectRatio={aspectRatio === '9:16' ? '9/16' : aspectRatio === '1:1' ? '1/1' : '3/4'}
                    label={isProductMode ? t.generatingProduct : t.generating}
                    sublabel={imageModel}
                  />
                )}
                {generatedPosts.map((post, index) => {
                  // Carousel grouping: skip non-anchor slides; render CarouselGroupCard for anchor slides.
                  if (post.carouselGroupId) {
                    const siblings = generatedPosts
                      .filter(p => p.carouselGroupId === post.carouselGroupId)
                      .sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0))
                    const anchorId = siblings[0]?.id
                    if (post.id !== anchorId) return null // skip non-anchor slides
                    const slides: CarouselSlide[] = siblings.map(s => ({
                      id: s.id,
                      imageUrl: s.imageUrl,
                      slideIndex: s.slideIndex ?? 1,
                      slideTotal: s.slideTotal ?? siblings.length,
                      prompt: s.prompt,
                    }))
                    const isDeleting = deletingPostId != null && siblings.some(s => s.id === deletingPostId)
                    return (
                      <CarouselGroupCard
                        key={post.carouselGroupId}
                        groupId={post.carouselGroupId}
                        subtype={post.carouselSubtype ?? null}
                        slides={slides}
                        onDownloadSlide={handleDownloadCarouselSlide}
                        onDownloadAll={handleDownloadCarouselAll}
                        onDeleteCarousel={handleDeleteCarousel}
                        deleting={isDeleting}
                        language={language}
                      />
                    )
                  }
                  const isEnhancing = enhancingPostId === post.id
                  const isEditing = editing && editingPostId === post.id
                  const isProcessing = isEnhancing || isEditing
                  return (
                  <div key={post.id} className={`bg-dark-100 rounded-xl shadow-sm overflow-hidden group transition-all duration-700 animate-entrance stagger-${Math.min((index % 6) + 1, 6)} ${isProcessing ? 'proc-border border-2' : 'border border-dark-100 card-hover'}`}>
                    <div className="relative overflow-hidden">
                      <img
                        src={post.imageUrl}
                        alt={`Post ${index + 1}`}
                        className={`w-full h-auto transition-all duration-700 ${isProcessing ? 'blur-[8px] scale-[1.04] brightness-[0.5]' : ''}`}
                      />
                      {/* Top-right action buttons */}
                      <div className="absolute top-2 right-2 flex flex-col gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all z-20">
                        {/* Magic Wand — opens tier popover */}
                        <div className="relative">
                          <button
                            onClick={() => {
                              dismissEnhanceTip()
                              setEnhanceMenuFor(prev => prev === post.id ? null : post.id)
                            }}
                            disabled={!!enhancingPostId || editing}
                            className={`w-9 h-9 rounded-lg backdrop-blur-sm flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                              enhanceMenuFor === post.id
                                ? 'bg-primary-600 text-white'
                                : 'bg-black/40 text-white/80 hover:bg-black/60 hover:text-white'
                            }`}
                            title={t.enhance}
                          >
                            <Wand2 className="w-5 h-5" />
                          </button>
                          {enhanceMenuFor === post.id && (
                            <>
                              {/* Click-outside backdrop */}
                              <div
                                className="fixed inset-0 z-30"
                                onClick={() => setEnhanceMenuFor(null)}
                              />
                              <div className="absolute top-0 right-11 w-60 bg-dark-100 border border-dark-200 rounded-xl shadow-2xl overflow-hidden z-40">
                                <div className="px-3 py-2 border-b border-dark-200 bg-dark-50">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dark-500 flex items-center gap-1.5">
                                    <Wand2 className="w-3 h-3" />
                                    {t.enhance}
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleEnhance(post.id, post.imageUrl, 'polish')}
                                  className="w-full text-left px-3 py-2.5 hover:bg-dark-200 transition-colors border-b border-dark-200"
                                >
                                  <p className="text-sm font-medium text-dark-700">{t.tierPolish}</p>
                                  <p className="text-[11px] text-dark-500 mt-0.5 leading-tight">{t.tierPolishDesc}</p>
                                </button>
                                <button
                                  onClick={() => handleEnhance(post.id, post.imageUrl, 'modernize')}
                                  className="w-full text-left px-3 py-2.5 hover:bg-dark-200 transition-colors border-b border-dark-200"
                                >
                                  <p className="text-sm font-medium text-dark-700">{t.tierModernize}</p>
                                  <p className="text-[11px] text-dark-500 mt-0.5 leading-tight">{t.tierModernizeDesc}</p>
                                </button>
                                <button
                                  onClick={() => handleEnhance(post.id, post.imageUrl, 'rebuild')}
                                  className="w-full text-left px-3 py-2.5 hover:bg-dark-200 transition-colors"
                                >
                                  <p className="text-sm font-medium text-dark-700">{t.tierRebuild}</p>
                                  <p className="text-[11px] text-dark-500 mt-0.5 leading-tight">{t.tierRebuildDesc}</p>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        {/* Save as style button */}
                        <button
                          onClick={() => handleCreateStyleFromPost(post.imageUrl)}
                          className="w-9 h-9 rounded-lg bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/80 hover:bg-black/60 hover:text-white transition-all"
                          title={t.saveAsStyle}
                        >
                          <Palette className="w-5 h-5" />
                        </button>
                        {/* Delete button — removes post from DB but does NOT refund usage */}
                        <div className="relative">
                          <button
                            onClick={() => setDeleteConfirmFor(prev => prev === post.id ? null : post.id)}
                            disabled={deletingPostId === post.id || isProcessing}
                            className={`w-9 h-9 rounded-lg backdrop-blur-sm flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                              deleteConfirmFor === post.id
                                ? 'bg-red-600 text-white'
                                : 'bg-black/40 text-white/80 hover:bg-red-600/80 hover:text-white'
                            }`}
                            title={t.deletePost}
                          >
                            {deletingPostId === post.id ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                              <Trash2 className="w-5 h-5" />
                            )}
                          </button>
                          {deleteConfirmFor === post.id && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={() => setDeleteConfirmFor(null)}
                              />
                              <div className="absolute top-0 right-11 w-60 bg-dark-100 border border-dark-200 rounded-xl shadow-2xl overflow-hidden z-40">
                                <div className="px-3 py-2.5 border-b border-dark-200 bg-dark-50">
                                  <p className="text-[11px] text-dark-600 leading-snug">{t.deletePostConfirm}</p>
                                </div>
                                <div className="flex">
                                  <button
                                    onClick={() => setDeleteConfirmFor(null)}
                                    className="flex-1 px-3 py-2 text-xs font-medium text-dark-600 hover:bg-dark-200 transition-colors border-r border-dark-200"
                                  >
                                    {t.cancel}
                                  </button>
                                  <button
                                    onClick={() => handleDeletePost(post.id)}
                                    className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors"
                                  >
                                    {t.deletePost}
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      {/* Enhance tip tooltip — shows once on first post */}
                      {showEnhanceTip && index === 0 && (
                        <button
                          onClick={dismissEnhanceTip}
                          className="absolute top-2 right-13 bg-primary-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg animate-bounce-subtle whitespace-nowrap z-20"
                        >
                          <span className="mr-1">✨</span>{t.enhanceTip}
                          <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[6px] border-l-primary-600" />
                        </button>
                      )}
                      {isProcessing && (
                        <>
                          {/* Organic cell/scale pattern layer 1 */}
                          <div className="absolute inset-0 proc-cells-layer" />
                          {/* Counter-drift layer for depth */}
                          <div className="absolute inset-0 proc-cells-layer-alt" />
                          {/* Sweeping light pass */}
                          <div className="absolute inset-0 proc-sweep" />
                          {/* Dark overlay pulse */}
                          <div className="absolute inset-0 bg-dark-900/30 proc-pulse" />
                          {/* Center status pill */}
                          <div className="absolute inset-0 flex items-center justify-center z-10">
                            <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10">
                              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                              <span className="text-white/90 text-sm font-medium tracking-wide">
                                {isEnhancing ? t.enhancing : t.editing}
                              </span>
                            </div>
                          </div>
                        </>
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
                        {productId && (
                          <div className="inline-flex items-center gap-0.5">
                            <button
                              onClick={() => {
                                const current = postRatings[post.id]
                                if (current === 'good') {
                                  setPostRatings(prev => { const next = { ...prev }; delete next[post.id]; return next })
                                  if (post.saved) ratePost(post.id, null).catch(() => {})
                                  return
                                }
                                setPostRatings(prev => ({ ...prev, [post.id]: 'good' }))
                                if (post.saved) ratePost(post.id, 5).catch(() => {})
                                recordAiSignal(productId, 'post_rated', {
                                  signal_key: 'rated_good',
                                  rating: 'good',
                                  prompt: post.prompt?.substring(0, 500) || '',
                                  post_style: postStyle,
                                  model: post.model || imageModel
                                })
                              }}
                              className={`p-2 rounded-lg transition-colors ${
                                postRatings[post.id] === 'good'
                                  ? 'text-emerald-600 bg-emerald-50'
                                  : 'text-dark-400 hover:text-emerald-600 hover:bg-emerald-50/50'
                              }`}
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                const current = postRatings[post.id]
                                if (current === 'bad') {
                                  setPostRatings(prev => { const next = { ...prev }; delete next[post.id]; return next })
                                  if (post.saved) ratePost(post.id, null).catch(() => {})
                                  return
                                }
                                setPostRatings(prev => ({ ...prev, [post.id]: 'bad' }))
                                if (post.saved) ratePost(post.id, 1).catch(() => {})
                                recordAiSignal(productId, 'post_rated', {
                                  signal_key: 'rated_bad',
                                  rating: 'bad',
                                  prompt: post.prompt?.substring(0, 500) || '',
                                  post_style: postStyle,
                                  model: post.model || imageModel
                                })
                              }}
                              className={`p-2 rounded-lg transition-colors ${
                                postRatings[post.id] === 'bad'
                                  ? 'text-red-500 bg-red-50'
                                  : 'text-dark-400 hover:text-red-500 hover:bg-red-50/50'
                              }`}
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
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
                  )
                })}
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
                <div className="empty-ambient-bg rounded-3xl px-10 py-12 animate-entrance">
                  <div className="relative w-16 h-16 mx-auto mb-5">
                    <div className="w-16 h-16 rounded-2xl bg-primary-900/30 flex items-center justify-center border border-primary-800/30">
                      <ImageIcon className="w-8 h-8 text-primary-400 gen-placeholder-icon" />
                    </div>
                    <div className="absolute -inset-2 rounded-3xl border border-primary-700/20 gen-placeholder-ring" />
                  </div>
                  <p className="text-sm text-dark-300 font-medium">{t.noImages}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Create Custom Post Type Modal */}
      {showCreatePostType && (
        <CreateCustomPostType
          onClose={() => { setShowCreatePostType(false); setCreateTypeFromImage(null) }}
          initialReferenceImages={createTypeFromImage ? [createTypeFromImage] : undefined}
          onSave={async (data) => {
            if (!user) return
            const saved = await createCustomPostType(user.id, {
              name: data.name,
              description: data.description,
              reference_images: data.referenceImages,
              master_prompt_es: data.masterPromptEs,
              master_prompt_en: data.masterPromptEn,
              style_preferences: data.stylePreferences,
              thumbnail_url: data.thumbnailUrl
            })
            setCustomPostTypes(prev => [saved, ...prev])
            setPostStyle(`custom-${saved.id}`)
          }}
        />
      )}

      {/* Organic Carousel Modal */}
      {user && productId && (
        <OrganicCarouselModal
          open={carouselModalOpen}
          onClose={() => setCarouselModalOpen(false)}
          productId={productId}
          userId={user.id}
          language={language}
          brandKitId={selectedBrandKitId || undefined}
          initialScriptContent={selectedScript?.content || scriptText}
          savedScripts={scripts.map(s => ({ id: s.id, title: s.title, content: s.content }))}
          productContext={getCarouselProductContext()}
          productReferenceImageUrls={getCarouselProductImageUrls()}
          contextReferenceImageUrls={getContextImageUrls()}
          remainingImageCredits={
            usageLimits.imagesLimit === -1
              ? null
              : Math.max(0, usageLimits.imagesLimit - usageLimits.imagesUsed + (usageLimits.bonusImages || 0))
          }
          onPersisted={(inserted) => {
            // Refresh the posts list so the new carousel appears in the gallery.
            const newPosts: GeneratedPost[] = inserted.map(p => ({
              id: p.id,
              imageUrl: p.generated_image_url || '',
              prompt: p.prompt,
              createdAt: new Date(p.created_at),
              model: p.model,
              saved: true,
              carouselGroupId: p.carousel_group_id ?? null,
              slideIndex: p.slide_index ?? null,
              slideTotal: p.slide_total ?? null,
              carouselSubtype: p.carousel_subtype ?? null,
            }))
            // Sort slides by index so Slide 1 displays first when rendered as a group.
            newPosts.sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0))
            setGeneratedPosts(prev => [...newPosts, ...prev])
            setTotalPostCount(c => c + inserted.length)
            usageLimits.refresh()
          }}
        />
      )}
    </Layout>
  )
}
