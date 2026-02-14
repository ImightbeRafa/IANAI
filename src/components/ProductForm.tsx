import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { ProductFormData, ProductType } from '../types'
import { Package, Briefcase, Loader2, ClipboardPaste, Sparkles, X, Home, UtensilsCrossed, Link2, Plus, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface ProductFormProps {
  onSubmit: (data: ProductFormData) => Promise<void>
  onCancel: () => void
  initialData?: Partial<ProductFormData>
  isEditing?: boolean
}

export default function ProductForm({ onSubmit, onCancel, initialData, isEditing }: ProductFormProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [processingPaste, setProcessingPaste] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [autoFillUrl, setAutoFillUrl] = useState('')
  const [processingUrl, setProcessingUrl] = useState(false)
  const [urlStatus, setUrlStatus] = useState('')
  const [formData, setFormData] = useState<ProductFormData>({
    name: initialData?.name || '',
    type: initialData?.type || 'product',
    product_description: initialData?.product_description || '',
    main_problem: initialData?.main_problem || '',
    best_customers: initialData?.best_customers || '',
    failed_attempts: initialData?.failed_attempts || '',
    attention_grabber: initialData?.attention_grabber || '',
    real_pain: initialData?.real_pain || '',
    pain_consequences: initialData?.pain_consequences || '',
    expected_result: initialData?.expected_result || '',
    differentiation: initialData?.differentiation || '',
    key_objection: initialData?.key_objection || '',
    shipping_info: initialData?.shipping_info || '',
    awareness_level: initialData?.awareness_level || '',
    context_links: initialData?.context_links || []
  })

  const labels = {
    es: {
      title: isEditing ? 'Editar Producto/Servicio' : 'Nuevo Producto/Servicio',
      subtitle: 'Responde estas preguntas para que la IA pueda generar scripts perfectos',
      step: 'Paso',
      of: 'de',
      next: 'Siguiente',
      back: 'Atrás',
      save: isEditing ? 'Guardar Cambios' : 'Crear',
      cancel: 'Cancelar',
      product: 'Producto Físico',
      service: 'Servicio',
      restaurant: 'Restaurante',
      realEstate: 'Inmobiliaria',
      quickPaste: 'Pegar Respuestas',
      quickPasteDesc: 'Pega todas las respuestas del cliente y la IA las organizará automáticamente',
      pasteHere: 'Pega aquí las respuestas del cliente...',
      processing: 'Procesando...',
      organize: 'Organizar con IA',
      // Product questions
      productQuestions: {
        name: '¿Cuál es el nombre de tu producto?',
        type: '¿Es un producto o un servicio?',
        product_description: '¿Qué producto estás vendiendo y para qué sirve?',
        main_problem: '¿Qué problema principal resuelve?',
        best_customers: 'Describe cómo son tus actuales mejores clientes que ya te compran',
        failed_attempts: '¿Qué han intentado antes que no les funcionó?',
        attention_grabber: '¿Qué es lo que más les llama la atención de tu producto?',
        expected_result: '¿Qué resultado espera lograr con tu producto?',
        differentiation: '¿Qué hace a este producto distinto o mejor que otros similares?',
        key_objection: '¿Qué es lo primero que la gente duda o pregunta antes de comprar?',
        shipping_info: '¿Cómo funciona el envío?',
        awareness_level: '¿Cómo llega la mayoría de tus compradores a este producto?'
      },
      // Service questions
      serviceQuestions: {
        name: '¿Cuál es el nombre de tu servicio?',
        type: '¿Es un producto o un servicio?',
        product_description: '¿Qué servicio ofrecés y qué hacés exactamente?',
        main_problem: '¿Qué problema principal resolvés con ese servicio?',
        best_customers: 'Describí cómo son tus mejores clientes actuales (los que sí pagan y se quedan)',
        failed_attempts: '¿Qué han intentado antes que no les funcionó?',
        attention_grabber: '¿Qué es lo que más les llama la atención de tu servicio?',
        real_pain: '¿Qué es lo que más les molesta a tus potenciales clientes hoy del problema que tienen?',
        pain_consequences: '¿Qué pasa si no lo resuelven? (tiempo, dinero, estrés, oportunidades perdidas)',
        expected_result: '¿Qué resultado concreto espera lograr tu cliente con el servicio?',
        differentiation: '¿Qué hacés distinto o mejor que otros que ofrecen lo mismo?',
        awareness_level: '¿Cómo llega la mayoría de tus clientes a este servicio?'
      },
      awarenessOptions: {
        active: 'Lo buscan activamente',
        passive: 'No lo buscan, pero lo necesitan',
        impulse: 'No lo necesitan, pero lo compran por impulso'
      },
      serviceAwarenessOptions: {
        active: 'Lo buscan activamente',
        passive: 'No lo buscan, pero saben que lo necesitan',
        impulse: 'No lo estaban buscando, pero el mensaje los activa'
      },
      // Real estate questions
      realEstateQuestions: {
        name: '¿Cuál es el nombre o referencia de la propiedad?',
        re_business_type: 'Tipo de negocio',
        re_price: 'Precio exacto',
        re_location: 'Ubicación (Barrio + Ciudad)',
        re_construction_size: 'Metros de construcción',
        re_bedrooms: 'Habitaciones',
        re_capacity: 'Para cuántas personas',
        re_bathrooms: 'Baños',
        re_parking: 'Estacionamientos',
        re_highlights: 'Puntos destacados (máximo 3, sé específico)',
        re_location_reference: 'Referencia de ubicación',
        re_cta: '¿Qué deben hacer los interesados?'
      },
      realEstateBusinessTypes: {
        sale: 'Venta (Precio Total)',
        rent: 'Alquiler Largo Plazo (Precio Mensual)',
        airbnb: 'Airbnb/Vacacional (Precio por Noche)'
      },
      // Restaurant questions
      restaurantQuestions: {
        name: '¿Cuál es el nombre de tu restaurante?',
        menu_text: 'Pega aquí tu menú completo (platillos con precios)',
        location: '¿Dónde está ubicado? (Barrio + Ciudad)',
        schedule: '¿Cuál es el horario de atención?',
        is_new_restaurant: '¿Es un restaurante nuevo o poco conocido?'
      },
      restaurantNewOptions: {
        yes: 'Sí, es nuevo o poco conocido',
        no: 'No, ya es conocido en la zona'
      },
      placeholders: {
        name: 'Ej: Café de Especialidad Premium',
        product_description: 'Describe qué vendes y para qué sirve...',
        main_problem: 'Ej: Café de mala calidad que no satisface...',
        best_customers: 'Ej: Profesionales que aprecian el buen café...',
        failed_attempts: 'Ej: Han probado marcas comerciales sin éxito...',
        attention_grabber: 'Ej: La frescura y el origen del grano...',
        expected_result: 'Ej: Disfrutar de un café de calidad en casa...',
        differentiation: 'Ej: Tostado artesanal y granos de origen único...',
        key_objection: 'Ej: ¿Vale la pena pagar más por café?',
        shipping_info: 'Ej: Envío gratis en 24-48 horas...',
        real_pain: 'Ej: Les frustra no ver resultados...',
        pain_consequences: 'Ej: Pierden tiempo y dinero...'
      },
      contextLinks: {
        title: 'Enlaces de Referencia',
        subtitle: 'Agrega enlaces de tu producto, landing pages, competencia o cualquier referencia útil',
        placeholder: 'Pega uno o varios enlaces (uno por línea):\nhttps://mi-producto.com\nhttps://competencia.com',
        add: 'Agregar',
        optional: 'Opcional'
      },
      autoFillUrl: {
        button: 'Llenar desde URL',
        title: 'Auto-llenar desde enlace',
        subtitle: 'Pega el enlace de tu producto o servicio y extraeremos toda la información automáticamente',
        placeholder: 'https://tu-producto.com',
        extract: 'Extraer información',
        extracting: 'Extrayendo página...',
        analyzing: 'Analizando contenido con IA...',
        success: '¡Formulario completado! Revisa y ajusta los campos.',
        error: 'No se pudo extraer información. Intenta con otro enlace o llena manualmente.'
      }
    },
    en: {
      title: isEditing ? 'Edit Product/Service' : 'New Product/Service',
      subtitle: 'Answer these questions so AI can generate perfect scripts',
      step: 'Step',
      of: 'of',
      next: 'Next',
      back: 'Back',
      save: isEditing ? 'Save Changes' : 'Create',
      cancel: 'Cancel',
      product: 'Physical Product',
      service: 'Service',
      restaurant: 'Restaurant',
      realEstate: 'Real Estate',
      quickPaste: 'Paste Answers',
      quickPasteDesc: 'Paste all client answers and AI will organize them automatically',
      pasteHere: 'Paste client answers here...',
      processing: 'Processing...',
      organize: 'Organize with AI',
      // Product questions
      productQuestions: {
        name: 'What is the name of your product?',
        type: 'Is it a product or a service?',
        product_description: 'What product are you selling and what is it for?',
        main_problem: 'What main problem does it solve?',
        best_customers: 'Describe your current best customers who already buy from you',
        failed_attempts: 'What have they tried before that didn\'t work?',
        attention_grabber: 'What catches their attention most about your product?',
        expected_result: 'What result do they expect to achieve with your product?',
        differentiation: 'What makes this product different or better than similar ones?',
        key_objection: 'What is the first thing people doubt or ask before buying?',
        shipping_info: 'How does shipping work?',
        awareness_level: 'How do most buyers find this product?'
      },
      // Service questions  
      serviceQuestions: {
        name: 'What is the name of your service?',
        type: 'Is it a product or a service?',
        product_description: 'What service do you offer and what exactly do you do?',
        main_problem: 'What main problem do you solve with this service?',
        best_customers: 'Describe your best current clients (the ones who pay and stay)',
        failed_attempts: 'What have they tried before that didn\'t work?',
        attention_grabber: 'What catches their attention most about your service?',
        real_pain: 'What bothers your potential clients most about the problem they have?',
        pain_consequences: 'What happens if they don\'t solve it? (time, money, stress, lost opportunities)',
        expected_result: 'What concrete result does your client expect from the service?',
        differentiation: 'What do you do differently or better than others who offer the same?',
        awareness_level: 'How do most clients find this service?'
      },
      awarenessOptions: {
        active: 'They actively search for it',
        passive: 'They don\'t search for it, but they need it',
        impulse: 'They don\'t need it, but buy on impulse'
      },
      serviceAwarenessOptions: {
        active: 'They actively search for it',
        passive: 'They don\'t search for it, but know they need it',
        impulse: 'They weren\'t looking, but the message activates them'
      },
      // Real estate questions
      realEstateQuestions: {
        name: 'What is the name or reference of the property?',
        re_business_type: 'Business type',
        re_price: 'Exact price',
        re_location: 'Location (Neighborhood + City)',
        re_construction_size: 'Construction size (m²)',
        re_bedrooms: 'Bedrooms',
        re_capacity: 'For how many people',
        re_bathrooms: 'Bathrooms',
        re_parking: 'Parking spaces',
        re_highlights: 'Key highlights (max 3, be specific)',
        re_location_reference: 'Location reference',
        re_cta: 'What should interested people do?'
      },
      realEstateBusinessTypes: {
        sale: 'Sale (Total Price)',
        rent: 'Long-term Rent (Monthly)',
        airbnb: 'Airbnb/Vacation (Per Night)'
      },
      // Restaurant questions
      restaurantQuestions: {
        name: 'What is the name of your restaurant?',
        menu_text: 'Paste your full menu here (dishes with prices)',
        location: 'Where is it located? (Neighborhood + City)',
        schedule: 'What are the opening hours?',
        is_new_restaurant: 'Is it a new or little-known restaurant?'
      },
      restaurantNewOptions: {
        yes: 'Yes, it\'s new or little-known',
        no: 'No, it\'s already known in the area'
      },
      placeholders: {
        name: 'E.g.: Premium Specialty Coffee',
        product_description: 'Describe what you sell and what it\'s for...',
        main_problem: 'E.g.: Poor quality coffee that doesn\'t satisfy...',
        best_customers: 'E.g.: Professionals who appreciate good coffee...',
        failed_attempts: 'E.g.: They\'ve tried commercial brands without success...',
        attention_grabber: 'E.g.: The freshness and origin of the beans...',
        expected_result: 'E.g.: Enjoy quality coffee at home...',
        differentiation: 'E.g.: Artisanal roasting and single-origin beans...',
        key_objection: 'E.g.: Is it worth paying more for coffee?',
        shipping_info: 'E.g.: Free shipping in 24-48 hours...',
        real_pain: 'E.g.: They\'re frustrated not seeing results...',
        pain_consequences: 'E.g.: They lose time and money...'
      },
      contextLinks: {
        title: 'Reference Links',
        subtitle: 'Add links to your product, landing pages, competitors or any useful reference',
        placeholder: 'Paste one or multiple links (one per line):\nhttps://my-product.com\nhttps://competitor.com',
        add: 'Add',
        optional: 'Optional'
      },
      autoFillUrl: {
        button: 'Fill from URL',
        title: 'Auto-fill from link',
        subtitle: 'Paste your product or service link and we\'ll extract all the information automatically',
        placeholder: 'https://your-product.com',
        extract: 'Extract information',
        extracting: 'Extracting page...',
        analyzing: 'Analyzing content with AI...',
        success: 'Form completed! Review and adjust the fields.',
        error: 'Could not extract information. Try another link or fill manually.'
      }
    }
  }

  const t = labels[language]
  const totalSteps = formData.type === 'real_estate' ? 3 : formData.type === 'restaurant' ? 2 : 5
  const questions = formData.type === 'service' ? t.serviceQuestions : 
                    formData.type === 'real_estate' ? t.realEstateQuestions : 
                    formData.type === 'restaurant' ? t.restaurantQuestions : 
                    t.productQuestions
  const awarenessOpts = formData.type === 'service' ? t.serviceAwarenessOptions : t.awarenessOptions

  const handleChange = (field: keyof ProductFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleTypeSelect = (type: ProductType) => {
    setFormData(prev => ({ ...prev, type }))
  }

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await onSubmit(formData)
    } finally {
      setLoading(false)
    }
  }

  const handleProcessPaste = async () => {
    if (!pasteText.trim()) return
    setProcessingPaste(true)
    try {
      const isProduct = formData.type === 'product'
      const prompt = isProduct 
        ? `Eres un asistente experto en marketing. Organiza las siguientes respuestas de un formulario de producto físico. Las preguntas son:
1. ¿Qué producto estás vendiendo y para qué sirve?
2. ¿Qué problema principal resuelve?
3. Describe cómo son tus actuales mejores clientes
4. ¿Qué han intentado antes que no les funcionó?
5. ¿Qué es lo que más les llama la atención de tu producto?
6. ¿Qué resultado espera lograr con tu producto?
7. ¿Qué hace a este producto distinto o mejor que otros similares?
8. ¿Qué es lo primero que la gente duda o pregunta antes de comprar?
9. ¿Cómo funciona el envío?
10. ¿Cómo llega la mayoría de tus compradores? (activo/pasivo/impulso)

Responde en JSON con estos campos: product_description, main_problem, best_customers, failed_attempts, attention_grabber, expected_result, differentiation, key_objection, shipping_info, awareness_level`
        : `Eres un asistente experto en marketing. Organiza las siguientes respuestas de un formulario de servicio. Las preguntas son:
1. ¿Qué servicio ofrecés y qué hacés exactamente?
2. ¿Qué problema principal resolvés?
3. Describí cómo son tus mejores clientes actuales
4. ¿Qué han intentado antes que no les funcionó?
5. ¿Qué es lo que más les llama la atención de tu servicio?
6. ¿Qué es lo que más les molesta del problema que tienen?
7. ¿Qué pasa si no lo resuelven?
8. ¿Qué resultado concreto espera lograr tu cliente?
9. ¿Qué hacés distinto o mejor que otros?
10. ¿Cómo llega la mayoría de tus clientes? (activo/pasivo/impulso)

Responde en JSON con estos campos: product_description, main_problem, best_customers, failed_attempts, attention_grabber, real_pain, pain_consequences, expected_result, differentiation, awareness_level`

      // Get auth token for API call
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      
      if (!token) {
        console.error('No auth token available')
        return
      }

      const chatUrl = import.meta.env.PROD ? '/api/chat' : 'http://localhost:3000/api/chat'
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `${prompt}\n\nRespuestas del cliente:\n${pasteText}` }],
          businessDetails: {},
          language
        })
      })
      
      const data = await response.json()
      if (data.content) {
        // Try to parse JSON from the response
        const jsonMatch = data.content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          setFormData(prev => ({ ...prev, ...parsed }))
          setShowPasteModal(false)
          setPasteText('')
          setStep(2) // Skip to step 2 since we have data
        }
      }
    } catch (error) {
      console.error('Failed to process paste:', error)
    } finally {
      setProcessingPaste(false)
    }
  }

  const handleAutoFillFromUrl = async () => {
    if (!autoFillUrl.trim() || processingUrl) return
    setProcessingUrl(true)
    setUrlStatus('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setUrlStatus('error'); return }

      // Step 1: Scrape the URL
      setUrlStatus('extracting')
      const fetchUrl = import.meta.env.PROD ? '/api/fetch-url' : 'http://localhost:3000/api/fetch-url'
      const scrapeRes = await fetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ url: autoFillUrl })
      })
      const scrapeData = await scrapeRes.json()
      if (!scrapeRes.ok || !scrapeData.content) {
        setUrlStatus('error')
        return
      }

      // Step 2: AI extracts form fields from the scraped content
      setUrlStatus('analyzing')
      const pageContent = scrapeData.content.slice(0, 12000)
      const pageTitle = scrapeData.title || ''

      let aiPrompt = ''
      let jsonFields = ''

      if (formData.type === 'restaurant') {
        aiPrompt = `Eres un experto en marketing de restaurantes. Analiza el siguiente contenido extraído de la página web de un restaurante y extrae la información relevante para crear scripts de publicidad.\n\nTítulo de la página: ${pageTitle}\n\nContenido:\n${pageContent}`
        jsonFields = 'name (nombre del restaurante), menu_text (menú con platillos y precios que encuentres), location (ubicación), schedule (horario si lo encuentras)'
      } else if (formData.type === 'real_estate') {
        aiPrompt = `Eres un experto en marketing inmobiliario. Analiza el siguiente contenido extraído de una página de propiedad y extrae toda la información relevante.\n\nTítulo de la página: ${pageTitle}\n\nContenido:\n${pageContent}`
        jsonFields = 'name (nombre o referencia de la propiedad), re_business_type ("sale" o "rent" o "airbnb"), re_price (precio), re_location (ubicación), re_construction_size (metros de construcción), re_bedrooms (habitaciones), re_bathrooms (baños), re_parking (estacionamientos), re_highlights (puntos destacados, máximo 3), re_location_reference (referencia de ubicación), re_cta (qué deben hacer los interesados)'
      } else if (formData.type === 'service') {
        aiPrompt = `Eres un experto en marketing de servicios. Analiza el siguiente contenido extraído de la página web de un servicio y extrae toda la información relevante para crear scripts de publicidad de alta conversión.\n\nTítulo de la página: ${pageTitle}\n\nContenido:\n${pageContent}`
        jsonFields = 'name (nombre del servicio), product_description (qué servicio ofrece y qué hace exactamente), main_problem (qué problema principal resuelve), best_customers (cómo son sus mejores clientes), failed_attempts (qué han intentado antes sin éxito), attention_grabber (qué es lo que más llama la atención), real_pain (qué es lo que más les molesta del problema), pain_consequences (qué pasa si no lo resuelven), expected_result (qué resultado concreto esperan), differentiation (qué hace distinto o mejor que otros), awareness_level ("active" si lo buscan, "passive" si no lo buscan pero lo necesitan, "impulse" si no lo buscaban)'
      } else {
        aiPrompt = `Eres un experto en marketing de productos. Analiza el siguiente contenido extraído de la página web de un producto y extrae toda la información relevante para crear scripts de publicidad de alta conversión.\n\nTítulo de la página: ${pageTitle}\n\nContenido:\n${pageContent}`
        jsonFields = 'name (nombre del producto), product_description (qué producto vende y para qué sirve), main_problem (qué problema principal resuelve), best_customers (cómo son sus mejores clientes), failed_attempts (qué han intentado antes sin éxito), attention_grabber (qué es lo que más llama la atención), expected_result (qué resultado esperan lograr), differentiation (qué lo hace distinto o mejor), key_objection (qué duda o pregunta la gente antes de comprar), shipping_info (cómo funciona el envío si se menciona), awareness_level ("active" si lo buscan, "passive" si no lo buscan pero lo necesitan, "impulse" si no lo buscaban)'
      }

      aiPrompt += `\n\nResponde SOLO con un JSON válido con estos campos: ${jsonFields}\n\nSi no encuentras información para un campo, déjalo como string vacío "". Infiere inteligentemente basándote en el contexto de la página. No inventes datos que no puedas inferir del contenido.`

      const chatUrl = import.meta.env.PROD ? '/api/chat' : 'http://localhost:3000/api/chat'
      const aiRes = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: aiPrompt }],
          businessDetails: {},
          language
        })
      })

      const aiData = await aiRes.json()
      if (aiData.content) {
        const jsonMatch = aiData.content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          // Only overwrite non-empty fields, preserve what user already typed
          const updates: Record<string, string> = {}
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string' && value.trim()) {
              updates[key] = value as string
            }
          }
          setFormData(prev => ({ ...prev, ...updates }))
          // Also save the URL as a context link
          setFormData(prev => ({
            ...prev,
            context_links: [...(prev.context_links || []).filter(l => l !== autoFillUrl), autoFillUrl]
          }))
          setUrlStatus('success')
          setTimeout(() => {
            setShowUrlModal(false)
            setAutoFillUrl('')
            setUrlStatus('')
            setStep(2)
          }, 1500)
          return
        }
      }
      setUrlStatus('error')
    } catch (error) {
      console.error('Auto-fill from URL failed:', error)
      setUrlStatus('error')
    } finally {
      setProcessingUrl(false)
    }
  }

  const [scrapingLinks, setScrapingLinks] = useState(false)
  const [linkErrors, setLinkErrors] = useState<string[]>([])

  const handleAddLinks = async () => {
    const newLinks = linkInput
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0 && (u.startsWith('http://') || u.startsWith('https://')))
    
    if (newLinks.length === 0) return
    
    const existing = formData.context_links || []
    const unique = newLinks.filter(l => !existing.includes(l))
    if (unique.length === 0) { setLinkInput(''); return }

    setScrapingLinks(true)
    setLinkErrors([])

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const fetchUrl = import.meta.env.PROD ? '/api/fetch-url' : 'http://localhost:3000/api/fetch-url'
      const scraped: string[] = []
      const failed: string[] = []

      for (const url of unique) {
        try {
          const res = await fetch(fetchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ url })
          })
          const data = await res.json()
          if (res.ok && data.content && !data.warning) {
            scraped.push(`[${data.title || url}]\n${data.content}`)
          } else {
            failed.push(url)
          }
        } catch {
          failed.push(url)
        }
      }

      // Update URLs and scraped content
      const existingContent = formData.context_links_content || ''
      const newContent = scraped.length > 0
        ? (existingContent ? existingContent + '\n\n---\n\n' : '') + scraped.join('\n\n---\n\n')
        : existingContent

      setFormData(prev => ({
        ...prev,
        context_links: [...(prev.context_links || []), ...unique],
        context_links_content: newContent
      }))

      if (failed.length > 0) {
        setLinkErrors(failed)
      }
    } catch (err) {
      console.error('Failed to scrape links:', err)
    } finally {
      setScrapingLinks(false)
      setLinkInput('')
    }
  }

  const handleRemoveLink = (url: string) => {
    setFormData(prev => ({ ...prev, context_links: (prev.context_links || []).filter(l => l !== url) }))
  }

  const canProceed = () => {
    switch (step) {
      case 1:
        return formData.name.trim() && formData.type
      case 2:
        if (formData.type === 'real_estate') {
          return formData.re_business_type && (formData.re_price || '').trim() && (formData.re_location || '').trim()
        }
        if (formData.type === 'restaurant') {
          return (formData.menu_text || '').trim() && (formData.location || '').trim() && (formData.schedule || '').trim()
        }
        return (formData.product_description || '').trim() && (formData.main_problem || '').trim()
      case 3:
        if (formData.type === 'real_estate') {
          return (formData.re_highlights || '').trim() && (formData.re_cta || '').trim()
        }
        return (formData.best_customers || '').trim() && (formData.attention_grabber || '').trim()
      case 4:
        return (formData.expected_result || '').trim() && (formData.differentiation || '').trim()
      case 5:
        return (formData.awareness_level || '').trim()
      default:
        return true
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-dark-100">
          <h2 className="text-xl font-bold text-dark-900">{t.title}</h2>
          <p className="text-dark-500 mt-1">{t.subtitle}</p>
          <div className="flex items-center gap-2 mt-4">
            {[...Array(totalSteps)].map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  i + 1 <= step ? 'bg-primary-600' : 'bg-dark-100'
                }`}
              />
            ))}
          </div>
          <p className="text-sm text-dark-400 mt-2">
            {t.step} {step} {t.of} {totalSteps}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Name, Type & Quick Paste */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.name}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder={t.placeholders.name}
                  className="input-field"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">
                  {language === 'es' ? '¿Qué tipo de negocio es?' : 'What type of business is it?'}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => handleTypeSelect('product')}
                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                      formData.type === 'product'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <Package className={`w-6 h-6 ${formData.type === 'product' ? 'text-primary-600' : 'text-dark-400'}`} />
                    <span className={`text-sm font-medium ${formData.type === 'product' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {t.product}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeSelect('service')}
                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                      formData.type === 'service'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <Briefcase className={`w-6 h-6 ${formData.type === 'service' ? 'text-primary-600' : 'text-dark-400'}`} />
                    <span className={`text-sm font-medium ${formData.type === 'service' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {t.service}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeSelect('restaurant')}
                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                      formData.type === 'restaurant'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <UtensilsCrossed className={`w-6 h-6 ${formData.type === 'restaurant' ? 'text-primary-600' : 'text-dark-400'}`} />
                    <span className={`text-sm font-medium ${formData.type === 'restaurant' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {t.restaurant}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeSelect('real_estate')}
                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                      formData.type === 'real_estate'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <Home className={`w-6 h-6 ${formData.type === 'real_estate' ? 'text-primary-600' : 'text-dark-400'}`} />
                    <span className={`text-sm font-medium ${formData.type === 'real_estate' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {t.realEstate}
                    </span>
                  </button>
                </div>
              </div>

              {/* Quick Fill Options */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setShowUrlModal(true)}
                  disabled={!formData.name.trim() || !formData.type}
                  className={`p-4 border-2 border-dashed rounded-xl transition-all flex flex-col items-center justify-center gap-2 ${
                    formData.name.trim() && formData.type
                      ? 'border-blue-200 hover:border-blue-400 hover:bg-blue-50 text-dark-500 hover:text-blue-600 cursor-pointer'
                      : 'border-dark-100 text-dark-300 cursor-not-allowed'
                  }`}
                >
                  <Globe className="w-5 h-5" />
                  <span className="font-medium text-sm">{t.autoFillUrl.button}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPasteModal(true)}
                  disabled={!formData.name.trim() || !formData.type}
                  className={`p-4 border-2 border-dashed rounded-xl transition-all flex flex-col items-center justify-center gap-2 ${
                    formData.name.trim() && formData.type
                      ? 'border-dark-200 hover:border-primary-400 hover:bg-primary-50 text-dark-500 hover:text-primary-600 cursor-pointer'
                      : 'border-dark-100 text-dark-300 cursor-not-allowed'
                  }`}
                >
                  <ClipboardPaste className="w-5 h-5" />
                  <span className="font-medium text-sm">{t.quickPaste}</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Product/Service Description & Problem (NOT for real_estate or restaurant) */}
          {step === 2 && formData.type !== 'real_estate' && formData.type !== 'restaurant' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {formData.type === 'service' ? t.serviceQuestions.product_description : t.productQuestions.product_description}
                </label>
                <textarea
                  value={formData.product_description}
                  onChange={(e) => handleChange('product_description', e.target.value)}
                  placeholder={t.placeholders.product_description}
                  className="input-field min-h-[100px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {formData.type === 'service' ? t.serviceQuestions.main_problem : t.productQuestions.main_problem}
                </label>
                <textarea
                  value={formData.main_problem}
                  onChange={(e) => handleChange('main_problem', e.target.value)}
                  placeholder={t.placeholders.main_problem}
                  className="input-field min-h-[80px]"
                />
              </div>
            </div>
          )}

          {/* REAL ESTATE Step 2: Business Type & Price */}
          {step === 2 && formData.type === 'real_estate' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">
                  {t.realEstateQuestions.re_business_type}
                </label>
                <div className="space-y-3">
                  {(['sale', 'rent', 'airbnb'] as const).map((bType) => (
                    <button
                      key={bType}
                      type="button"
                      onClick={() => handleChange('re_business_type', bType)}
                      className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                        formData.re_business_type === bType
                          ? 'border-primary-600 bg-primary-50'
                          : 'border-dark-200 hover:border-dark-300'
                      }`}
                    >
                      <span className={`font-medium ${formData.re_business_type === bType ? 'text-primary-600' : 'text-dark-600'}`}>
                        {t.realEstateBusinessTypes[bType]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.realEstateQuestions.re_price}
                </label>
                <input
                  type="text"
                  value={formData.re_price || ''}
                  onChange={(e) => handleChange('re_price', e.target.value)}
                  placeholder={language === 'es' ? 'Ej: $2.35 Millones / $1,200 mes' : 'E.g.: $2.35M / $1,200/mo'}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.realEstateQuestions.re_location}
                </label>
                <input
                  type="text"
                  value={formData.re_location || ''}
                  onChange={(e) => handleChange('re_location', e.target.value)}
                  placeholder={language === 'es' ? 'Ej: La Guácima, Alajuela' : 'E.g.: Downtown, Miami'}
                  className="input-field"
                />
              </div>
            </div>
          )}

          {/* RESTAURANT Step 2: Menu, Location, Schedule */}
          {step === 2 && formData.type === 'restaurant' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.restaurantQuestions.menu_text}
                </label>
                <textarea
                  value={formData.menu_text || ''}
                  onChange={(e) => handleChange('menu_text', e.target.value)}
                  placeholder={language === 'es' ? 'Pega aquí el menú completo con nombres de platillos y precios...' : 'Paste the full menu with dish names and prices...'}
                  className="input-field min-h-[150px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.restaurantQuestions.location}
                </label>
                <input
                  type="text"
                  value={formData.location || ''}
                  onChange={(e) => handleChange('location', e.target.value)}
                  placeholder={language === 'es' ? 'Ej: Curridabat, San José' : 'E.g.: Downtown, Miami'}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.restaurantQuestions.schedule}
                </label>
                <input
                  type="text"
                  value={formData.schedule || ''}
                  onChange={(e) => handleChange('schedule', e.target.value)}
                  placeholder={language === 'es' ? 'Ej: Lunes a Viernes 11am-9pm' : 'E.g.: Mon-Fri 11am-9pm'}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">
                  {t.restaurantQuestions.is_new_restaurant}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, is_new_restaurant: true }))}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.is_new_restaurant === true
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.is_new_restaurant === true ? 'text-primary-600' : 'text-dark-600'}`}>
                      {t.restaurantNewOptions.yes}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, is_new_restaurant: false }))}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.is_new_restaurant === false
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.is_new_restaurant === false ? 'text-primary-600' : 'text-dark-600'}`}>
                      {t.restaurantNewOptions.no}
                    </span>
                  </button>
                </div>
              </div>

              {/* Context Links */}
              <div className="border-t border-dark-100 pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 className="w-4 h-4 text-blue-500" />
                  <label className="text-sm font-medium text-dark-700">{t.contextLinks.title}</label>
                  <span className="text-xs text-dark-400 bg-dark-50 px-1.5 py-0.5 rounded">{t.contextLinks.optional}</span>
                </div>
                <p className="text-xs text-dark-400 mb-3">{t.contextLinks.subtitle}</p>
                {(formData.context_links || []).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {(formData.context_links || []).map((link, i) => (
                      <div key={i} className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-1.5 group">
                        <Link2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        <span className="text-xs text-dark-700 truncate flex-1">{link}</span>
                        <button type="button" onClick={() => handleRemoveLink(link)} className="p-0.5 text-dark-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea value={linkInput} onChange={(e) => setLinkInput(e.target.value)} placeholder={t.contextLinks.placeholder} className="w-full px-3 py-2 border border-dark-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none h-16" disabled={scrapingLinks} />
                {linkInput.trim() && (
                  <button type="button" onClick={handleAddLinks} disabled={scrapingLinks} className="mt-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                    {scrapingLinks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {scrapingLinks ? (language === 'es' ? 'Extrayendo...' : 'Extracting...') : t.contextLinks.add}
                  </button>
                )}
                {linkErrors.length > 0 && (
                  <p className="text-xs text-amber-600 mt-1">{language === 'es' ? `No se pudo extraer: ${linkErrors.join(', ')}` : `Failed to extract: ${linkErrors.join(', ')}`}</p>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Client & Context (NOT for real_estate or restaurant) */}
          {step === 3 && formData.type !== 'real_estate' && formData.type !== 'restaurant' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {formData.type === 'service' ? t.serviceQuestions.best_customers : t.productQuestions.best_customers}
                </label>
                <textarea
                  value={formData.best_customers || ''}
                  onChange={(e) => handleChange('best_customers', e.target.value)}
                  placeholder={t.placeholders.best_customers}
                  className="input-field min-h-[80px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {formData.type === 'service' ? t.serviceQuestions.failed_attempts : t.productQuestions.failed_attempts}
                </label>
                <textarea
                  value={formData.failed_attempts || ''}
                  onChange={(e) => handleChange('failed_attempts', e.target.value)}
                  placeholder={t.placeholders.failed_attempts}
                  className="input-field min-h-[80px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {formData.type === 'service' ? t.serviceQuestions.attention_grabber : t.productQuestions.attention_grabber}
                </label>
                <textarea
                  value={formData.attention_grabber || ''}
                  onChange={(e) => handleChange('attention_grabber', e.target.value)}
                  placeholder={t.placeholders.attention_grabber}
                  className="input-field min-h-[80px]"
                />
              </div>

              {/* Service-specific: Real Pain */}
              {formData.type === 'service' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {t.serviceQuestions.real_pain}
                    </label>
                    <textarea
                      value={formData.real_pain || ''}
                      onChange={(e) => handleChange('real_pain', e.target.value)}
                      placeholder={t.placeholders.real_pain}
                      className="input-field min-h-[80px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {t.serviceQuestions.pain_consequences}
                    </label>
                    <textarea
                      value={formData.pain_consequences || ''}
                      onChange={(e) => handleChange('pain_consequences', e.target.value)}
                      placeholder={t.placeholders.pain_consequences}
                      className="input-field min-h-[80px]"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* REAL ESTATE Step 3: Property Details */}
          {step === 3 && formData.type === 'real_estate' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">
                    {t.realEstateQuestions.re_construction_size}
                  </label>
                  <input
                    type="text"
                    value={formData.re_construction_size || ''}
                    onChange={(e) => handleChange('re_construction_size', e.target.value)}
                    placeholder="1,300 m²"
                    className="input-field"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">
                    {t.realEstateQuestions.re_bedrooms}
                  </label>
                  <input
                    type="text"
                    value={formData.re_bedrooms || ''}
                    onChange={(e) => handleChange('re_bedrooms', e.target.value)}
                    placeholder="4"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">
                    {t.realEstateQuestions.re_capacity}
                  </label>
                  <input
                    type="text"
                    value={formData.re_capacity || ''}
                    onChange={(e) => handleChange('re_capacity', e.target.value)}
                    placeholder="6"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">
                    {t.realEstateQuestions.re_bathrooms}
                  </label>
                  <input
                    type="text"
                    value={formData.re_bathrooms || ''}
                    onChange={(e) => handleChange('re_bathrooms', e.target.value)}
                    placeholder="3"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">
                    {t.realEstateQuestions.re_parking}
                  </label>
                  <input
                    type="text"
                    value={formData.re_parking || ''}
                    onChange={(e) => handleChange('re_parking', e.target.value)}
                    placeholder="2"
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.realEstateQuestions.re_highlights}
                </label>
                <textarea
                  value={formData.re_highlights || ''}
                  onChange={(e) => handleChange('re_highlights', e.target.value)}
                  placeholder={language === 'es' ? 'Ej: Vista al valle, Seguridad 24/7, Piscina privada' : 'E.g.: Valley view, 24/7 Security, Private pool'}
                  className="input-field min-h-[80px]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.realEstateQuestions.re_location_reference}
                </label>
                <input
                  type="text"
                  value={formData.re_location_reference || ''}
                  onChange={(e) => handleChange('re_location_reference', e.target.value)}
                  placeholder={language === 'es' ? 'Ej: A 15 min del aeropuerto' : 'E.g.: 15 min from airport'}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.realEstateQuestions.re_cta}
                </label>
                <input
                  type="text"
                  value={formData.re_cta || ''}
                  onChange={(e) => handleChange('re_cta', e.target.value)}
                  placeholder={language === 'es' ? 'Ej: Envíame un mensaje para agendar visita' : 'E.g.: Send me a message to schedule a visit'}
                  className="input-field"
                />
              </div>

              {/* Context Links */}
              <div className="border-t border-dark-100 pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 className="w-4 h-4 text-blue-500" />
                  <label className="text-sm font-medium text-dark-700">{t.contextLinks.title}</label>
                  <span className="text-xs text-dark-400 bg-dark-50 px-1.5 py-0.5 rounded">{t.contextLinks.optional}</span>
                </div>
                <p className="text-xs text-dark-400 mb-3">{t.contextLinks.subtitle}</p>
                {(formData.context_links || []).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {(formData.context_links || []).map((link, i) => (
                      <div key={i} className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-1.5 group">
                        <Link2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        <span className="text-xs text-dark-700 truncate flex-1">{link}</span>
                        <button type="button" onClick={() => handleRemoveLink(link)} className="p-0.5 text-dark-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea value={linkInput} onChange={(e) => setLinkInput(e.target.value)} placeholder={t.contextLinks.placeholder} className="w-full px-3 py-2 border border-dark-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none h-16" disabled={scrapingLinks} />
                {linkInput.trim() && (
                  <button type="button" onClick={handleAddLinks} disabled={scrapingLinks} className="mt-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                    {scrapingLinks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {scrapingLinks ? (language === 'es' ? 'Extrayendo...' : 'Extracting...') : t.contextLinks.add}
                  </button>
                )}
                {linkErrors.length > 0 && (
                  <p className="text-xs text-amber-600 mt-1">{language === 'es' ? `No se pudo extraer: ${linkErrors.join(', ')}` : `Failed to extract: ${linkErrors.join(', ')}`}</p>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Result & Differentiation (NOT for real_estate or restaurant) */}
          {step === 4 && formData.type !== 'real_estate' && formData.type !== 'restaurant' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {formData.type === 'service' ? t.serviceQuestions.expected_result : t.productQuestions.expected_result}
                </label>
                <textarea
                  value={formData.expected_result || ''}
                  onChange={(e) => handleChange('expected_result', e.target.value)}
                  placeholder={t.placeholders.expected_result}
                  className="input-field min-h-[80px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {formData.type === 'service' ? t.serviceQuestions.differentiation : t.productQuestions.differentiation}
                </label>
                <textarea
                  value={formData.differentiation || ''}
                  onChange={(e) => handleChange('differentiation', e.target.value)}
                  placeholder={t.placeholders.differentiation}
                  className="input-field min-h-[80px]"
                />
              </div>

              {/* Product-specific: Objection & Shipping */}
              {formData.type === 'product' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {t.productQuestions.key_objection}
                    </label>
                    <textarea
                      value={formData.key_objection || ''}
                      onChange={(e) => handleChange('key_objection', e.target.value)}
                      placeholder={t.placeholders.key_objection}
                      className="input-field min-h-[80px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {t.productQuestions.shipping_info}
                    </label>
                    <textarea
                      value={formData.shipping_info || ''}
                      onChange={(e) => handleChange('shipping_info', e.target.value)}
                      placeholder={t.placeholders.shipping_info}
                      className="input-field min-h-[80px]"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 5: Awareness Level (NOT for real_estate or restaurant) */}
          {step === 5 && formData.type !== 'real_estate' && formData.type !== 'restaurant' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">
                  {formData.type === 'service' ? t.serviceQuestions.awareness_level : t.productQuestions.awareness_level}
                </label>
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => handleChange('awareness_level', 'active')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      formData.awareness_level === 'active'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.awareness_level === 'active' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {awarenessOpts.active}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('awareness_level', 'passive')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      formData.awareness_level === 'passive'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.awareness_level === 'passive' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {awarenessOpts.passive}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('awareness_level', 'impulse')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      formData.awareness_level === 'impulse'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.awareness_level === 'impulse' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {awarenessOpts.impulse}
                    </span>
                  </button>
                </div>
              </div>

              {/* Context Links */}
              <div className="border-t border-dark-100 pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 className="w-4 h-4 text-blue-500" />
                  <label className="text-sm font-medium text-dark-700">{t.contextLinks.title}</label>
                  <span className="text-xs text-dark-400 bg-dark-50 px-1.5 py-0.5 rounded">{t.contextLinks.optional}</span>
                </div>
                <p className="text-xs text-dark-400 mb-3">{t.contextLinks.subtitle}</p>
                
                {(formData.context_links || []).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {(formData.context_links || []).map((link, i) => (
                      <div key={i} className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-1.5 group">
                        <Link2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        <span className="text-xs text-dark-700 truncate flex-1">{link}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveLink(link)}
                          className="p-0.5 text-dark-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <textarea
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  placeholder={t.contextLinks.placeholder}
                  className="w-full px-3 py-2 border border-dark-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none h-16"
                  disabled={scrapingLinks}
                />
                {linkInput.trim() && (
                  <button
                    type="button"
                    onClick={handleAddLinks}
                    disabled={scrapingLinks}
                    className="mt-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {scrapingLinks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {scrapingLinks ? (language === 'es' ? 'Extrayendo...' : 'Extracting...') : t.contextLinks.add}
                  </button>
                )}
                {linkErrors.length > 0 && (
                  <p className="text-xs text-amber-600 mt-1">{language === 'es' ? `No se pudo extraer: ${linkErrors.join(', ')}` : `Failed to extract: ${linkErrors.join(', ')}`}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick Paste Modal */}
        {showPasteModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-dark-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-dark-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary-600" />
                    {t.quickPaste}
                  </h3>
                  <p className="text-sm text-dark-500 mt-1">{t.quickPasteDesc}</p>
                </div>
                <button
                  onClick={() => {
                    setShowPasteModal(false)
                    setPasteText('')
                  }}
                  className="p-2 hover:bg-dark-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-dark-500" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={t.pasteHere}
                  className="input-field min-h-[300px] w-full"
                  autoFocus
                />
              </div>
              <div className="p-6 border-t border-dark-100 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowPasteModal(false)
                    setPasteText('')
                  }}
                  className="btn-secondary"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleProcessPaste}
                  disabled={!pasteText.trim() || processingPaste}
                  className="btn-primary flex items-center gap-2"
                >
                  {processingPaste ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t.processing}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      {t.organize}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* URL Auto-Fill Modal */}
        {showUrlModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden flex flex-col">
              <div className="p-6 border-b border-dark-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-dark-900 flex items-center gap-2">
                    <Globe className="w-5 h-5 text-blue-500" />
                    {t.autoFillUrl.title}
                  </h3>
                  <p className="text-sm text-dark-500 mt-1">{t.autoFillUrl.subtitle}</p>
                </div>
                <button
                  onClick={() => { setShowUrlModal(false); setAutoFillUrl(''); setUrlStatus('') }}
                  disabled={processingUrl}
                  className="p-2 hover:bg-dark-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <X className="w-5 h-5 text-dark-500" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <input
                  type="url"
                  value={autoFillUrl}
                  onChange={(e) => setAutoFillUrl(e.target.value)}
                  placeholder={t.autoFillUrl.placeholder}
                  className="input-field w-full"
                  autoFocus
                  disabled={processingUrl}
                />

                {urlStatus === 'extracting' && (
                  <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-4 py-3 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.autoFillUrl.extracting}
                  </div>
                )}
                {urlStatus === 'analyzing' && (
                  <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-4 py-3 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.autoFillUrl.analyzing}
                  </div>
                )}
                {urlStatus === 'success' && (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-4 py-3 rounded-lg">
                    <Sparkles className="w-4 h-4" />
                    {t.autoFillUrl.success}
                  </div>
                )}
                {urlStatus === 'error' && (
                  <div className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg">
                    {t.autoFillUrl.error}
                  </div>
                )}
              </div>
              <div className="p-6 border-t border-dark-100 flex justify-end gap-3">
                <button
                  onClick={() => { setShowUrlModal(false); setAutoFillUrl(''); setUrlStatus('') }}
                  disabled={processingUrl}
                  className="btn-secondary"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleAutoFillFromUrl}
                  disabled={!autoFillUrl.trim() || processingUrl || !autoFillUrl.startsWith('http')}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {processingUrl ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Globe className="w-4 h-4" />
                  )}
                  {t.autoFillUrl.extract}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-6 border-t border-dark-100 flex items-center justify-between">
          <button
            onClick={step === 1 ? onCancel : () => setStep(prev => prev - 1)}
            className="btn-secondary"
            disabled={loading}
          >
            {step === 1 ? t.cancel : t.back}
          </button>

          {step < totalSteps ? (
            <button
              onClick={() => setStep(prev => prev + 1)}
              disabled={!canProceed()}
              className="btn-primary"
            >
              {t.next}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canProceed() || loading}
              className="btn-primary flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t.save}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
