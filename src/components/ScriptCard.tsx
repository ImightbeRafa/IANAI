import { useState, useRef, useEffect } from 'react'
import { Copy, Check, BookmarkPlus, Loader2, Pencil, X, Send, Wand2, Anchor, Sparkles } from 'lucide-react'
import type { ParsedScript } from '../utils/scriptParser'
import type { ProductType } from '../types'

type EditSource = 'manual' | 'enhance' | 'hook' | 'consciousness' | null

interface EditHistoryEntry {
  content: string
  source: EditSource
  label: string
}

interface ScriptCardProps {
  script: ParsedScript
  language: 'en' | 'es'
  onSave?: (content: string, title: string) => Promise<string | null>
  onEdit?: (originalContent: string, instruction: string) => Promise<string>
  isSaved?: boolean
  savingScript?: boolean
  productType?: ProductType
}

export default function ScriptCard({ script, language, onSave, onEdit, isSaved, savingScript, productType }: ScriptCardProps) {
  const [copiedVersion, setCopiedVersion] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedOriginal, setSavedOriginal] = useState(isSaved || false)
  const [savedVersions, setSavedVersions] = useState<Set<number>>(new Set())

  const [showEditInput, setShowEditInput] = useState(false)
  const [editInstruction, setEditInstruction] = useState('')
  const [editingFromVersion, setEditingFromVersion] = useState<number>(-1)
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)

  const [enhancing, setEnhancing] = useState(false)

  const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([])

  const [hookPickerVersion, setHookPickerVersion] = useState<number | null>(null)
  const hookPickerRef = useRef<HTMLDivElement>(null)

  const [consciousnessPickerVersion, setConsciousnessPickerVersion] = useState<number | null>(null)
  const consciousnessPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hookPickerVersion === null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (hookPickerRef.current && !hookPickerRef.current.contains(e.target as Node)) {
        setHookPickerVersion(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [hookPickerVersion])

  useEffect(() => {
    if (consciousnessPickerVersion === null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (consciousnessPickerRef.current && !consciousnessPickerRef.current.contains(e.target as Node)) {
        setConsciousnessPickerVersion(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [consciousnessPickerVersion])

  const getVersionContent = (versionIndex: number): string => {
    return versionIndex === -1 ? script.content : editHistory[versionIndex].content
  }

  const handleCopy = (versionIndex: number) => {
    navigator.clipboard.writeText(getVersionContent(versionIndex))
    setCopiedVersion(versionIndex)
    setTimeout(() => setCopiedVersion(null), 2000)
  }

  const handleSave = async (versionIndex: number) => {
    if (!onSave || saving) return
    if (versionIndex === -1 && savedOriginal) return
    if (versionIndex >= 0 && savedVersions.has(versionIndex)) return
    setSaving(true)
    try {
      const content = getVersionContent(versionIndex)
      const entry = versionIndex >= 0 ? editHistory[versionIndex] : null
      const title = versionIndex === -1
        ? script.title
        : `${script.title} (${entry?.source || 'edited'})`
      const id = await onSave(content, title)
      if (id) {
        if (versionIndex === -1) setSavedOriginal(true)
        else setSavedVersions(prev => new Set(prev).add(versionIndex))
      }
    } finally {
      setSaving(false)
    }
  }

  const openEditInput = (fromVersion: number) => {
    setEditingFromVersion(fromVersion)
    setShowEditInput(true)
    setTimeout(() => editInputRef.current?.focus(), 100)
  }

  const handleEdit = async () => {
    if (!onEdit || !editInstruction.trim() || editing) return
    setEditing(true)
    setEditError(null)
    try {
      const source = getVersionContent(editingFromVersion)
      const result = await onEdit(source, editInstruction.trim())
      setEditHistory(prev => [...prev, { content: result, source: 'manual', label: '' }])
      setShowEditInput(false)
      setEditInstruction('')
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setEditing(false)
    }
  }

  const handleDiscardVersion = (index: number) => {
    setEditHistory(prev => prev.filter((_, i) => i !== index))
    setSavedVersions(prev => {
      const next = new Set<number>()
      for (const v of prev) {
        if (v < index) next.add(v)
        else if (v > index) next.add(v - 1)
      }
      return next
    })
  }

  const ENHANCE_PROMPT = `Corrige el guión: El video se dirige únicamente a potenciales compradores que en este momento están activamente buscando o potencialmente interesados en adquirir en corto plazo el producto o servicio a promover. No debes dirigir estos guiones a personas que probablemente no necesiten/quieran/interese el producto o servicio a promover. Busca y comprende quién es el perfil de cliente ideal que está listo para adquirir producto o servicio, y háblale directamente a su mente. El gancho debe estrictamente dar contexto sobre qué es lo que se está promoviendo y tocar ya sea un dolor o un deseo del potencial comprador. Puedes añadir solamente si vale la pena, una propuesta única de valor que ofrezca un outcome directo que facilite o mejore la vida del potencial cliente en relación al producto o servicio que está comprando. O bien, un diferenciador clave. Pero solamente si la propuesta única de valor o el diferenciador es tangible y de gran impacto. Los ganchos deben dar a entender que el video mostrara "nuestro producto o servicio" para que se entienda que se está promoviendo algo y que no se confunda con un video educativo o de entretenimiento. En el desarrollo debe responder la premisa de ambos ganchos A y B, no cometas el error de dar una premisa en el gancho y no responderla correctamente en el desarrollo. Independientemente de la estructura que se esté utilizando... es importante que siempre se incluyan las propuestas de valor - pero pásalas de propuestas abstractas a frases que venden a la mente. Haz una revisión para verificar que los guiones tienen sentido, el objetivo es promover los productos o servicios de forma directa, segmentando y llamando la atención correctamente desde el inicio en el gancho, generando deseo y claridad sobre la oferta, producto o servicio en el desarrollo y guiando al siguiente paso (en este caso enviar un mensaje) para llevarlos al proceso de compra. Instrucciones adicionales: Cuando hablas de un "dolor" o "frustración", debe ser real. No utilices términos como "sin estrés", "sin complicarte", ya que son muy genéricos y no impactan al espectador emocionalmente, ya que ni si quiera se lo cuestiona. Utiliza dolores o frustraciones solamente si puedes verificar que los potenciales clientes de este producto o servicio lo piensan o expresan realmente. Tangibilidad. No uses frases de relleno para extender el video. Cada frase en el desarrollo debe referise a una propuesta de valor tangible, medible, outcomes reales y directos. Siempre relacionado a la premisa que se dió en los ganchos A y B. El método de comunicación en el desarrollo debe ser en formato de bulletpoints para mantener el dinamismo, directo al grano. La totalidad del video debe vender tangiblemente los outcomes a la mente del espectador. Que sean tan tangibles que no quede duda a qué nos referimos. Por ejemplo, no digas "te brindamos acompañamiento en todo el proceso" ya que eso no es tangible, no se sabe... Mejor evitarlo a menos que tengas información que te indique por ejemplo: "Hacemos llamadas 1:1 todas las semanas para... [acción tangible]". De lo contrario, mejor no mencionarlo. Revisa la información del negocio y fíjate que todo haga sentido.\nEntrega el guión nuevamente con el mismo formato que entregaste antes pero con las correcciones correspondientes.`

  const handleEnhanceFrom = async (fromVersion: number) => {
    if (!onEdit || enhancing || editing) return
    setEnhancing(true)
    setEditError(null)
    try {
      const source = getVersionContent(fromVersion)
      const result = await onEdit(source, ENHANCE_PROMPT)
      setEditHistory(prev => [...prev, { content: result, source: 'enhance', label: '' }])
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Enhance failed')
    } finally {
      setEnhancing(false)
    }
  }

  const getHookTemplates = (): { label: string; prompt: string }[] => {
    const type = productType || 'product'
    if (type === 'restaurant') return [
      { label: language === 'es' ? 'Variedad + ubicación' : 'Variety + location', prompt: 'Cambia los ganchos A y B usando la estructura: "Estos son los [cantidad] [tipos de comida] que tenemos en [nombre] ubicado en [ciudad]." Adapta esta estructura al contexto del negocio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Producto estrella' : 'Star product', prompt: 'Cambia los ganchos A y B usando la estructura: "Si todavía no probaste la [comida estrella], tenés que venir a [nombre] en [ciudad]." Adapta al contexto del negocio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Autoridad local' : 'Local authority', prompt: 'Cambia los ganchos A y B usando la estructura: "La mejor [tipo de comida] de [ciudad] está aquí en [nombre]." Adapta al contexto del negocio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Plato + propuesta de valor' : 'Dish + value prop', prompt: 'Cambia los ganchos A y B usando la estructura: "[Nombre del plato] + [propuesta de valor] en [ciudad]." Adapta al contexto del negocio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Visual / experiencia' : 'Visual / experience', prompt: 'Cambia los ganchos A y B usando la estructura: "Vean este/a [ingrediente/textura] como se ve… esto es en [nombre] en [ciudad]." Adapta al contexto del negocio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Momento del día' : 'Time of day', prompt: 'Cambia los ganchos A y B usando la estructura: "Si estás en [ciudad] y no sabés dónde almorzar hoy…" Adapta al contexto del negocio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Social proof implícito' : 'Implicit social proof', prompt: 'Cambia los ganchos A y B usando la estructura: "Esto es lo que más están pidiendo esta semana en [nombre]." Adapta al contexto del negocio. Mantén el desarrollo y CTA igual.' },
    ]
    if (type === 'real_estate') return [
      { label: language === 'es' ? 'Pregunta por intención' : 'Intent question', prompt: 'Cambia los ganchos A y B usando la estructura: "¿Buscando [alquilar/comprar] [propiedad] en [ciudad] para [cantidad de personas]?" Adapta al contexto de la propiedad. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Oferta directa' : 'Direct offer', prompt: 'Cambia los ganchos A y B usando la estructura: "[Alquila/Compra] este/esta [propiedad] en [ciudad] de [habitaciones] por [precio]." Adapta al contexto de la propiedad. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'No te mudes sin ver esto' : "Don\'t move without seeing this", prompt: 'Cambia los ganchos A y B usando la estructura: "Todavía no te mudes sin antes ver este/esta [propiedad] en [ciudad] por [precio]." Adapta al contexto de la propiedad. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Definición directa' : 'Direct definition', prompt: 'Cambia los ganchos A y B usando la estructura: "Este/esta es el/la [propiedad] que podés [alquilar/comprar] por [precio] en [ciudad]." Adapta al contexto de la propiedad. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Variedad comparativa' : 'Comparative variety', prompt: 'Cambia los ganchos A y B usando la estructura: "Estos son 3 [propiedades] de [habitaciones] que podés [alquilar/comprar] por menos de [precio] en [ciudad]." Adapta al contexto. Mantén el desarrollo y CTA igual.' },
    ]
    if (type === 'service') return [
      { label: language === 'es' ? 'Afirmación del problema' : 'Problem affirmation', prompt: 'Cambia los ganchos A y B usando la estructura: "Sabes que [situación actual] pero no has hecho nada al respecto…" Adapta al contexto del servicio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Verbo + problema + propuesta' : 'Verb + problem + prop', prompt: 'Cambia los ganchos A y B usando la estructura: "[Verbo] + [problema/objetivo] + [propuesta de valor única]." Adapta al contexto del servicio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Negación del método actual' : 'Current method negation', prompt: 'Cambia los ganchos A y B usando la estructura: "No sigas haciendo X sin saber esto." Adapta al contexto del servicio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Llamado a perfil específico' : 'Specific profile call', prompt: 'Cambia los ganchos A y B usando la estructura: "Estamos buscando a [perfil específico]." Adapta al contexto del servicio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Caso de éxito' : 'Success case', prompt: 'Cambia los ganchos A y B usando la estructura: "Así fue como ayudamos a [caso] a [resultado específico]." Adapta al contexto del servicio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Servicio + propuesta directa' : 'Service + direct prop', prompt: 'Cambia los ganchos A y B usando la estructura: "[Servicio] + [propuesta de valor única]." Ejemplo: "Te ayudamos a [objetivo específico relacionado 100% con lo que vendemos para generar contexto]." Adapta al contexto del servicio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Momento crítico' : 'Critical moment', prompt: 'Cambia los ganchos A y B usando la estructura: "Si ya intentaste [solución común] y no funcionó, esto es para vos." Adapta al contexto del servicio. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Costo invisible' : 'Invisible cost', prompt: 'Cambia los ganchos A y B usando la estructura: "Cada mes que no resolvés esto, estás perdiendo [consecuencia concreta]." Adapta al contexto del servicio. Mantén el desarrollo y CTA igual.' },
    ]
    if (type === 'indumentaria') return [
      { label: language === 'es' ? 'Prenda + propuesta de valor' : 'Garment + value prop', prompt: 'Cambia los ganchos A y B usando la estructura: "Este/a es un/a [prenda/producto] + [propuesta de valor]." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Variedad' : 'Variety', prompt: 'Cambia los ganchos A y B usando la estructura: "Estas son [cantidad] [producto] + [temática / funcionalidad / propuesta única]." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Pide tu producto + info clave' : 'Order + key info', prompt: 'Cambia los ganchos A y B usando la estructura: "Pide tu [producto] + [envío o propuesta de valor de alto impacto]." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Identidad directa' : 'Direct identity', prompt: 'Cambia los ganchos A y B usando la estructura: "Si te gusta [estilo/identidad], mira esto." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Uso real' : 'Real use', prompt: 'Cambia los ganchos A y B usando la estructura: "Esto es lo que usarías si querés algo [cualidad] sin que parezca [negativo]." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Diferencia tangible' : 'Tangible difference', prompt: 'Cambia los ganchos A y B usando la estructura: "La diferencia entre [genérico] y esta está en [diferenciador tangible]." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Para quien valora calidad' : 'Quality seekers', prompt: 'Cambia los ganchos A y B usando la estructura: "Si sos de los que [acción que denota cuidado por calidad], escucha esto." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Dolor estético' : 'Aesthetic pain', prompt: 'Cambia los ganchos A y B usando la estructura: "Si estás cansado de que tu ropa [problema común]…" Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
    ]
    return [
      { label: language === 'es' ? 'Definición directa + funcionalidad' : 'Direct definition + function', prompt: 'Cambia los ganchos A y B usando la estructura: "Este es un [tipo de producto] y sirve para [funcionalidad]." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Verbo + problema + propuesta' : 'Verb + problem + prop', prompt: 'Cambia los ganchos A y B usando la estructura: "[Verbo] + [problema o solución/objetivo] + [propuesta de valor única]." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Producto + propuesta sin rodeos' : 'Product + direct prop', prompt: 'Cambia los ganchos A y B usando la estructura: "[Producto] + [propuesta de valor única]." Sin rodeos. Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Afirmación del problema' : 'Problem affirmation', prompt: 'Cambia los ganchos A y B usando la estructura: "Sabes que [situación actual del cliente] pero no has hecho nada al respecto…" Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Negación del método actual' : 'Current method negation', prompt: 'Cambia los ganchos A y B usando la estructura: "No sigas haciendo/comprando X, y te explico por qué." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Solo para variedad' : 'Variety only', prompt: 'Cambia los ganchos A y B usando la estructura: "Estos son [cantidad] [productos] que tenés que probar sí o sí." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Llamado a perfil específico' : 'Specific profile call', prompt: 'Cambia los ganchos A y B usando la estructura: "Estamos buscando a [perfil específico de cliente ideal]." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Contexto de uso específico' : 'Specific use context', prompt: 'Cambia los ganchos A y B usando la estructura: "Si todavía estás [usando/haciendo algo inferior], esto te va a interesar." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Precio implícito vs valor' : 'Implicit price vs value', prompt: 'Cambia los ganchos A y B usando la estructura: "Si pagarías por [outcome deseado], escucha esto." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
      { label: language === 'es' ? 'Micro nicho claro' : 'Clear micro niche', prompt: 'Cambia los ganchos A y B usando la estructura: "Si sos [perfil muy específico], esto es para vos." Adapta al contexto del producto. Mantén el desarrollo y CTA igual.' },
    ]
  }

  const getConsciousnessTemplates = (): { label: string; emoji: string; prompt: string }[] => [
    {
      label: language === 'es' ? 'Frío' : 'Cold',
      emoji: '🧊',
      prompt: language === 'es'
        ? 'Reescribe este guión para un espectador FRÍO que NO sabe que tiene el problema. Debes: Primero REVELAR un problema que no sabía que tenía. Usar ganchos de curiosidad que le hagan darse cuenta de una carencia o riesgo. EDUCAR antes de vender — el desarrollo debe construir la conciencia del problema de forma progresiva. Mostrar las CONSECUENCIAS de no actuar. Solo al final presentar el producto/servicio como la solución natural. El tono debe generar curiosidad y "momento ajá", NO presión de compra directa. Los ganchos deben usar formatos como: "Lo que nadie te dice sobre...", "¿Sabías que...?", "El error que comete el 90% de la gente con...". Mantén el mismo formato y estructura general del guión (ganchos A/B, desarrollo, CTA).'
        : 'Rewrite this script for a COLD viewer who does NOT know they have the problem. You must: First REVEAL a problem they didn\'t know they had. Use curiosity-driven hooks. EDUCATE before selling — build problem awareness progressively. Show CONSEQUENCES of not acting. Only at the end present the product/service as the natural solution. Tone should generate curiosity and "aha moments", NOT direct buying pressure. Hooks should use formats like: "What nobody tells you about...", "Did you know...?". Keep the same format and structure (hooks A/B, development, CTA).'
    },
    {
      label: language === 'es' ? 'Tibio' : 'Warm',
      emoji: '🌡️',
      prompt: language === 'es'
        ? 'Reescribe este guión para un espectador TIBIO que YA SABE que tiene el problema y está explorando soluciones. Debes: RECONOCER su dolor directamente en el gancho — hablarle de lo que ya está sintiendo. Posicionarte como la MEJOR solución comparada con lo que ya intentó. VALIDAR sus intentos fallidos anteriores y explicar por qué no funcionaron. El desarrollo debe enfocarse en por qué ESTA solución es diferente y mejor. Incluir propuestas de valor concretas, resultados tangibles y diferenciadores claros. El CTA debe guiar al siguiente paso lógico. Mantén el mismo formato y estructura general del guión (ganchos A/B, desarrollo, CTA).'
        : 'Rewrite this script for a WARM viewer who already KNOWS they have the problem and is exploring solutions. You must: ACKNOWLEDGE their pain directly in the hook. Position as the BEST solution compared to what they\'ve tried. VALIDATE previous failed attempts and explain why they didn\'t work. Development should focus on why THIS solution is different and better. Include concrete value propositions, tangible results, clear differentiators. CTA should guide to the next logical step. Keep the same format and structure (hooks A/B, development, CTA).'
    },
    {
      label: language === 'es' ? 'Caliente' : 'Hot',
      emoji: '🔥',
      prompt: language === 'es'
        ? 'Reescribe este guión para un espectador CALIENTE que está LISTO PARA COMPRAR — busca activamente este producto/servicio. Debes: Ser DIRECTO y específico desde el primer segundo. No educar, no contar historias largas. Liderar con la OFERTA concreta: qué es exactamente, especificaciones, precio/valor. Usar ganchos de definición directa: "Este es un [producto] que [beneficio principal]". El desarrollo debe ser una lista de propuestas de valor tangibles, sin relleno. Incluir pruebas sociales, garantías, y elementos que eliminen la última duda. Crear URGENCIA real solo si es verdad. El CTA debe ser muy claro y directo: exactamente qué hacer y cómo comprar AHORA. Formato dinámico tipo bulletpoints — cada frase debe vender. Mantén el mismo formato y estructura general del guión (ganchos A/B, desarrollo, CTA).'
        : 'Rewrite this script for a HOT viewer who is READY TO BUY — actively looking for this product/service. You must: Be DIRECT and specific from the first second. No educating, no long stories. Lead with the CONCRETE OFFER: what it is, specs, price/value. Use direct definition hooks: "This is a [product] that [main benefit]". Development should be a list of tangible value propositions, no filler. Include social proof, guarantees, elements that eliminate last doubt. Create REAL urgency only if true. CTA must be very clear: exactly what to do and how to buy NOW. Dynamic bullet-point format — every sentence should sell. Keep the same format and structure (hooks A/B, development, CTA).'
    },
  ]

  const handleConsciousnessChangeFrom = async (fromVersion: number, prompt: string, label: string) => {
    if (!onEdit || editing || enhancing) return
    setConsciousnessPickerVersion(null)
    setEditing(true)
    setEditError(null)
    try {
      const source = getVersionContent(fromVersion)
      const result = await onEdit(source, prompt)
      setEditHistory(prev => [...prev, { content: result, source: 'consciousness', label }])
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Consciousness change failed')
    } finally {
      setEditing(false)
    }
  }

  const handleHookChangeFrom = async (fromVersion: number, hookPrompt: string, hookLabel: string) => {
    if (!onEdit || editing || enhancing) return
    setHookPickerVersion(null)
    setEditing(true)
    setEditError(null)
    try {
      const source = getVersionContent(fromVersion)
      const result = await onEdit(source, hookPrompt)
      setEditHistory(prev => [...prev, { content: result, source: 'hook', label: hookLabel }])
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Hook change failed')
    } finally {
      setEditing(false)
    }
  }

  const t = {
    copy: language === 'es' ? 'Copiar' : 'Copy',
    copied: language === 'es' ? 'Copiado' : 'Copied',
    save: language === 'es' ? 'Guardar' : 'Save',
    saved: language === 'es' ? 'Guardado' : 'Saved',
    edit: language === 'es' ? 'Editar' : 'Edit',
    cancel: language === 'es' ? 'Cancelar' : 'Cancel',
    editPlaceholder: language === 'es' ? 'Describe qué quieres cambiar...' : 'Describe what you want to change...',
    original: language === 'es' ? 'Original' : 'Original',
    edited: language === 'es' ? 'Editado' : 'Edited',
    enhanced: language === 'es' ? 'Mejorado' : 'Enhanced',
    discard: language === 'es' ? 'Descartar' : 'Discard',
    enhance: language === 'es' ? 'Mejorar' : 'Enhance',
    enhancing: language === 'es' ? 'Mejorando...' : 'Enhancing...',
    changeHooks: '+ Hooks',
    pickHook: language === 'es' ? 'Selecciona un tipo de gancho' : 'Select a hook type',
  }

  const getBadgeForSource = (source: EditSource, label: string) => {
    switch (source) {
      case 'enhance':
        return { label: t.enhanced, color: 'text-amber-500', icon: <Wand2 className="w-3 h-3" /> }
      case 'hook':
        return { label: `Hook: ${label}`, color: 'text-blue-500', icon: <Anchor className="w-3 h-3" /> }
      case 'consciousness':
        return { label: `${language === 'es' ? 'Conciencia' : 'Consciousness'}: ${label}`, color: 'text-violet-500', icon: <Sparkles className="w-3 h-3" /> }
      case 'manual':
      default:
        return { label: t.edited, color: 'text-primary-500', icon: <Pencil className="w-3 h-3" /> }
    }
  }

  const CopyBtn = ({ versionIndex }: { versionIndex: number }) => (
    <button
      onClick={() => handleCopy(versionIndex)}
      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors ${
        copiedVersion === versionIndex
          ? 'bg-green-900/20 text-green-400'
          : 'text-dark-400 hover:bg-dark-200 hover:text-dark-700'
      }`}
    >
      {copiedVersion === versionIndex ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copiedVersion === versionIndex ? t.copied : t.copy}
    </button>
  )

  const SaveBtn = ({ versionIndex }: { versionIndex: number }) => {
    if (!onSave) return null
    const isSavedState = versionIndex === -1 ? savedOriginal : savedVersions.has(versionIndex)
    return (
      <button
        onClick={() => handleSave(versionIndex)}
        disabled={isSavedState || saving || savingScript}
        className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors ${
          isSavedState
            ? 'bg-green-900/20 text-green-400'
            : 'text-dark-400 hover:bg-primary-900/20 hover:text-primary-400'
        }`}
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
        {isSavedState ? t.saved : t.save}
      </button>
    )
  }

  const VersionActions = ({ versionIndex }: { versionIndex: number }) => {
    if (!onEdit) return null
    return (
      <>
        <button
          onClick={() => openEditInput(versionIndex)}
          disabled={isProcessing || showEditInput}
          className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-primary-500 px-2 py-0.5 rounded-md transition-colors disabled:opacity-40"
        >
          <Pencil className="w-3 h-3" />
          {t.edit}
        </button>
        <button
          onClick={() => handleEnhanceFrom(versionIndex)}
          disabled={enhancing || editing}
          className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-amber-400 px-2 py-0.5 rounded-md transition-colors disabled:opacity-40"
          title={t.enhance}
        >
          {enhancing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
          {enhancing ? t.enhancing : t.enhance}
        </button>
        <div className="relative" ref={hookPickerVersion === versionIndex ? hookPickerRef : undefined}>
          <button
            onClick={() => setHookPickerVersion(hookPickerVersion === versionIndex ? null : versionIndex)}
            disabled={editing || enhancing}
            className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-blue-400 px-2 py-0.5 rounded-md transition-colors disabled:opacity-40"
          >
            <Anchor className="w-3 h-3" />
            {t.changeHooks}
          </button>
          {hookPickerVersion === versionIndex && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-dark-100 border border-dark-200 rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto">
              <div className="px-3 py-2 border-b border-dark-200">
                <p className="text-[11px] font-semibold text-dark-500">{t.pickHook}</p>
              </div>
              {getHookTemplates().map((hook, i) => (
                <button
                  key={i}
                  onClick={() => handleHookChangeFrom(versionIndex, hook.prompt, hook.label)}
                  className="w-full text-left px-3 py-2 text-xs text-dark-600 hover:bg-primary-900/10 hover:text-primary-400 transition-colors border-b border-dark-200/50 last:border-0"
                >
                  {hook.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative" ref={consciousnessPickerVersion === versionIndex ? consciousnessPickerRef : undefined}>
          <button
            onClick={() => setConsciousnessPickerVersion(consciousnessPickerVersion === versionIndex ? null : versionIndex)}
            disabled={editing || enhancing}
            className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-violet-400 px-2 py-0.5 rounded-md transition-colors disabled:opacity-40"
          >
            <Sparkles className="w-3 h-3" />
            {language === 'es' ? 'Conciencia' : 'Consciousness'}
          </button>
          {consciousnessPickerVersion === versionIndex && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-dark-100 border border-dark-200 rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto">
              <div className="px-3 py-2 border-b border-dark-200">
                <p className="text-[11px] font-semibold text-dark-500">{language === 'es' ? 'Nivel de conciencia' : 'Consciousness level'}</p>
              </div>
              {getConsciousnessTemplates().map((level, i) => (
                <button
                  key={i}
                  onClick={() => handleConsciousnessChangeFrom(versionIndex, level.prompt, level.label)}
                  className="w-full text-left px-3 py-2 text-xs text-dark-600 hover:bg-violet-900/10 hover:text-violet-400 transition-colors border-b border-dark-200/50 last:border-0"
                >
                  <span className="mr-1.5">{level.emoji}</span>
                  {level.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </>
    )
  }

  const isProcessing = editing || enhancing

  return (
    <div className="bg-dark-100 border border-dark-200 rounded-xl transition-shadow hover:shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dark-200 bg-dark-200/40 rounded-t-xl">
        <span className="text-xs font-semibold text-dark-600 tracking-wide">
          {script.title}
        </span>
        <span className="text-[10px] text-dark-300 font-mono">
          #{script.index}
        </span>
      </div>

      {/* Edit instruction input */}
      {showEditInput && (
        <div className="px-4 py-3 border-b border-dark-200 bg-primary-900/5">
          <div className="flex gap-2">
            <textarea
              ref={editInputRef}
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit() } }}
              placeholder={t.editPlaceholder}
              className="flex-1 px-3 py-2 text-sm bg-dark-50 border border-dark-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary-500 min-h-[40px] max-h-20"
              rows={1}
              disabled={editing}
            />
            <div className="flex flex-col gap-1">
              <button
                onClick={handleEdit}
                disabled={!editInstruction.trim() || editing}
                className="h-8 w-8 flex items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {editing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => { setShowEditInput(false); setEditInstruction(''); setEditError(null) }}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-dark-400 hover:bg-dark-200 hover:text-dark-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {editError && <p className="text-xs text-red-400 mt-1.5">{editError}</p>}
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && !showEditInput && (
        <div className="px-4 py-2 border-b border-dark-200 bg-dark-200/30">
          <div className="flex items-center gap-2 text-xs text-dark-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {enhancing ? t.enhancing : (language === 'es' ? 'Procesando...' : 'Processing...')}
          </div>
        </div>
      )}

      {/* Original version — always visible and editable */}
      <div className="px-4 py-3">
        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-dark-400 mb-2">
          {t.original}
        </div>
        <div className="text-sm text-dark-700 leading-relaxed whitespace-pre-wrap">
          {script.content}
        </div>
      </div>
      <div className="flex items-center flex-wrap gap-1.5 px-4 py-2 border-t border-dark-200">
        <CopyBtn versionIndex={-1} />
        <SaveBtn versionIndex={-1} />
        <VersionActions versionIndex={-1} />
      </div>

      {/* Edit history entries */}
      {editHistory.map((entry, index) => {
        const badge = getBadgeForSource(entry.source, entry.label)
        return (
          <div key={index} className="border-t-2 border-dark-200">
            <div className="px-4 pt-3 pb-3">
              <div className="flex items-center justify-between mb-2">
                <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${badge.color}`}>
                  {badge.icon}
                  {badge.label}
                </div>
                <button
                  onClick={() => handleDiscardVersion(index)}
                  className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-red-400 px-1.5 py-0.5 rounded transition-colors"
                  title={t.discard}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="text-sm text-dark-700 leading-relaxed whitespace-pre-wrap">
                {entry.content}
              </div>
            </div>
            <div className="flex items-center flex-wrap gap-1.5 px-4 py-2 border-t border-dark-200">
              <CopyBtn versionIndex={index} />
              <SaveBtn versionIndex={index} />
              <VersionActions versionIndex={index} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
