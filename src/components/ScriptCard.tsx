import { useState, useRef, useEffect } from 'react'
import { Copy, Check, BookmarkPlus, Loader2, Pencil, X, Send, RotateCcw, Wand2, Anchor } from 'lucide-react'
import type { ParsedScript } from '../utils/scriptParser'
import type { ProductType } from '../types'

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
  const [copied, setCopied] = useState<'original' | 'edited' | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(isSaved || false)
  const [savedEdited, setSavedEdited] = useState(false)

  // Edit state
  const [showEditInput, setShowEditInput] = useState(false)
  const [editInstruction, setEditInstruction] = useState('')
  const [editedContent, setEditedContent] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)

  // Enhance (magic wand) state
  const [enhancing, setEnhancing] = useState(false)

  // Change hooks state
  const [showHookPicker, setShowHookPicker] = useState(false)
  const hookPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showHookPicker) return
    const handleClickOutside = (e: MouseEvent) => {
      if (hookPickerRef.current && !hookPickerRef.current.contains(e.target as Node)) {
        setShowHookPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showHookPicker])

  const handleCopy = (content: string, which: 'original' | 'edited') => {
    navigator.clipboard.writeText(content)
    setCopied(which)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleSave = async (content: string, title: string, isEdited: boolean) => {
    if (!onSave || saving) return
    if (isEdited && savedEdited) return
    if (!isEdited && saved) return
    setSaving(true)
    try {
      const id = await onSave(content, title)
      if (id) {
        if (isEdited) setSavedEdited(true)
        else setSaved(true)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async () => {
    if (!onEdit || !editInstruction.trim() || editing) return
    setEditing(true)
    setEditError(null)
    try {
      const result = await onEdit(script.content, editInstruction.trim())
      setEditedContent(result)
      setShowEditInput(false)
      setEditInstruction('')
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setEditing(false)
    }
  }

  const handleDiscardEdit = () => {
    setEditedContent(null)
    setSavedEdited(false)
  }

  const ENHANCE_PROMPT = `Corrige el guión: El video se dirige únicamente a potenciales compradores que en este momento están activamente buscando o potencialmente interesados en adquirir en corto plazo el producto o servicio a promover. No debes dirigir estos guiones a personas que probablemente no necesiten/quieran/interese el producto o servicio a promover. Busca y comprende quién es el perfil de cliente ideal que está listo para adquirir producto o servicio, y háblale directamente a su mente. El gancho debe estrictamente dar contexto sobre qué es lo que se está promoviendo y tocar ya sea un dolor o un deseo del potencial comprador. Puedes añadir solamente si vale la pena, una propuesta única de valor que ofrezca un outcome directo que facilite o mejore la vida del potencial cliente en relación al producto o servicio que está comprando. O bien, un diferenciador clave. Pero solamente si la propuesta única de valor o el diferenciador es tangible y de gran impacto. Los ganchos deben dar a entender que el video mostrara "nuestro producto o servicio" para que se entienda que se está promoviendo algo y que no se confunda con un video educativo o de entretenimiento. En el desarrollo debe responder la premisa de ambos ganchos A y B, no cometas el error de dar una premisa en el gancho y no responderla correctamente en el desarrollo. Independientemente de la estructura que se esté utilizando... es importante que siempre se incluyan las propuestas de valor - pero pásalas de propuestas abstractas a frases que venden a la mente. Haz una revisión para verificar que los guiones tienen sentido, el objetivo es promover los productos o servicios de forma directa, segmentando y llamando la atención correctamente desde el inicio en el gancho, generando deseo y claridad sobre la oferta, producto o servicio en el desarrollo y guiando al siguiente paso (en este caso enviar un mensaje) para llevarlos al proceso de compra. Instrucciones adicionales: Cuando hablas de un "dolor" o "frustración", debe ser real. No utilices términos como "sin estrés", "sin complicarte", ya que son muy genéricos y no impactan al espectador emocionalmente, ya que ni si quiera se lo cuestiona. Utiliza dolores o frustraciones solamente si puedes verificar que los potenciales clientes de este producto o servicio lo piensan o expresan realmente. Tangibilidad. No uses frases de relleno para extender el video. Cada frase en el desarrollo debe referise a una propuesta de valor tangible, medible, outcomes reales y directos. Siempre relacionado a la premisa que se dió en los ganchos A y B. El método de comunicación en el desarrollo debe ser en formato de bulletpoints para mantener el dinamismo, directo al grano. La totalidad del video debe vender tangiblemente los outcomes a la mente del espectador. Que sean tan tangibles que no quede duda a qué nos referimos. Por ejemplo, no digas "te brindamos acompañamiento en todo el proceso" ya que eso no es tangible, no se sabe... Mejor evitarlo a menos que tengas información que te indique por ejemplo: "Hacemos llamadas 1:1 todas las semanas para... [acción tangible]". De lo contrario, mejor no mencionarlo. Revisa la información del negocio y fíjate que todo haga sentido.
Entrega el guión nuevamente con el mismo formato que entregaste antes pero con las correcciones correspondientes.`

  const handleEnhance = async () => {
    if (!onEdit || enhancing) return
    setEnhancing(true)
    setEditError(null)
    try {
      const source = editedContent || script.content
      const result = await onEdit(source, ENHANCE_PROMPT)
      setEditedContent(result)
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
    // Default: product
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

  const handleHookChange = async (hookPrompt: string) => {
    if (!onEdit || editing) return
    setShowHookPicker(false)
    setEditing(true)
    setEditError(null)
    try {
      const source = editedContent || script.content
      const result = await onEdit(source, hookPrompt)
      setEditedContent(result)
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
    discard: language === 'es' ? 'Descartar' : 'Discard',
    enhance: language === 'es' ? 'Mejorar' : 'Enhance',
    enhancing: language === 'es' ? 'Mejorando...' : 'Enhancing...',
    changeHooks: '+ Hooks',
    pickHook: language === 'es' ? 'Selecciona un tipo de gancho' : 'Select a hook type',
  }

  const ActionButtons = ({ content, which, isSavedState, title }: { content: string; which: 'original' | 'edited'; isSavedState: boolean; title: string }) => (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => handleCopy(content, which)}
        className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors ${
          copied === which
            ? 'bg-green-900/20 text-green-400'
            : 'text-dark-400 hover:bg-dark-200 hover:text-dark-700'
        }`}
      >
        {copied === which ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied === which ? t.copied : t.copy}
      </button>
      {onSave && (
        <button
          onClick={() => handleSave(content, title, which === 'edited')}
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
      )}
      {onEdit && (
        <>
          <button
            onClick={handleEnhance}
            disabled={enhancing || editing}
            className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-amber-400 px-2 py-0.5 rounded-md transition-colors disabled:opacity-40"
            title={t.enhance}
          >
            {enhancing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {enhancing ? t.enhancing : t.enhance}
          </button>
          <div className="relative" ref={hookPickerRef}>
            <button
              onClick={() => setShowHookPicker(!showHookPicker)}
              disabled={editing || enhancing}
              className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-blue-400 px-2 py-0.5 rounded-md transition-colors disabled:opacity-40"
            >
              <Anchor className="w-3 h-3" />
              {t.changeHooks}
            </button>
            {showHookPicker && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-dark-100 border border-dark-200 rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto">
                <div className="px-3 py-2 border-b border-dark-200">
                  <p className="text-[11px] font-semibold text-dark-500">{t.pickHook}</p>
                </div>
                {getHookTemplates().map((hook, i) => (
                  <button
                    key={i}
                    onClick={() => handleHookChange(hook.prompt)}
                    className="w-full text-left px-3 py-2 text-xs text-dark-600 hover:bg-primary-900/10 hover:text-primary-400 transition-colors border-b border-dark-200/50 last:border-0"
                  >
                    {hook.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="bg-dark-100 border border-dark-200 rounded-xl overflow-hidden transition-shadow hover:shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dark-200 bg-dark-200/40">
        <span className="text-xs font-semibold text-dark-600 tracking-wide">
          {script.title}
        </span>
        <div className="flex items-center gap-2">
          {onEdit && !editedContent && !showEditInput && (
            <button
              onClick={() => { setShowEditInput(true); setTimeout(() => editInputRef.current?.focus(), 100) }}
              className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-primary-500 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {t.edit}
            </button>
          )}
          <span className="text-[10px] text-dark-300 font-mono">
            #{script.index}
          </span>
        </div>
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

      {/* Content — show original vs edited when edited exists */}
      {editedContent ? (
        <div>
          {/* Original */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-dark-400 uppercase tracking-wider">{t.original}</span>
              <ActionButtons content={script.content} which="original" isSavedState={saved} title={script.title} />
            </div>
            <div className="text-sm text-dark-500 leading-relaxed whitespace-pre-wrap line-clamp-6 opacity-70">
              {script.content}
            </div>
          </div>
          <div className="mx-4 border-t border-dashed border-dark-200" />
          {/* Edited */}
          <div className="px-4 pt-2 pb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-primary-500 uppercase tracking-wider">{t.edited}</span>
              <div className="flex items-center gap-1.5">
                <ActionButtons content={editedContent} which="edited" isSavedState={savedEdited} title={`${script.title} (edited)`} />
                <button
                  onClick={handleDiscardEdit}
                  className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-red-400 px-2 py-0.5 rounded-md transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t.discard}
                </button>
              </div>
            </div>
            <div className="text-sm text-dark-700 leading-relaxed whitespace-pre-wrap">
              {editedContent}
            </div>
          </div>
          {/* Re-edit button */}
          {onEdit && (
            <div className="px-4 py-2 border-t border-dark-200">
              <button
                onClick={() => { setShowEditInput(true); setTimeout(() => editInputRef.current?.focus(), 100) }}
                className="inline-flex items-center gap-1.5 text-[11px] text-dark-400 hover:text-primary-500 transition-colors"
              >
                <Pencil className="w-3 h-3" />
                {t.edit}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Single content view */}
          <div className="px-4 py-3">
            <div className="text-sm text-dark-700 leading-relaxed whitespace-pre-wrap">
              {script.content}
            </div>
          </div>
          {/* Actions */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-dark-200">
            <ActionButtons content={script.content} which="original" isSavedState={saved} title={script.title} />
          </div>
        </>
      )}
    </div>
  )
}
