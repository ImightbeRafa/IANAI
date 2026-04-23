// Distilled from the external library of verified winning scripts.
// This is intentionally pattern-based instead of copying examples verbatim.

type Language = 'en' | 'es'
type Mode = 'sales' | 'organic' | 'awareness'
type CtaStrength = 'none' | 'soft' | 'brand_mention' | 'sales'

interface BusinessContextLike {
  name?: string
  sales_channels?: string[]
  location?: string
  does_shipping?: boolean
  shipping_method?: string
}

interface ProductContextLike {
  name?: string
  type?: string
  product_category?: string
  product_description?: string
  product_variations?: string[]
  technical_specs?: string
  utility?: string
  result?: string
  has_guarantee?: boolean
  guarantee_details?: string
  current_alternatives?: string
  alternatives_disadvantages?: string
  price_range?: string
  svc_service_type?: string
  svc_process_steps?: string
  svc_has_success_cases?: boolean
  svc_has_guarantee?: boolean
  svc_guarantee_details?: string
  ind_article_type?: string
  ind_model_count?: number
  ind_variations_description?: string
  ind_sizes?: string
  ind_main_material?: string
  ind_accepts_changes?: boolean
  ind_change_policy?: string
  ind_customizable?: boolean
  ind_customization_description?: string
  menu_text?: string
  location?: string
  schedule?: string
  is_new_restaurant?: boolean
  re_business_type?: string
  re_price?: string
  re_location?: string
  re_construction_size?: string
  re_bedrooms?: string
  re_bathrooms?: string
  re_parking?: string
  re_highlights?: string
  re_location_reference?: string
  [key: string]: unknown
}

interface WinningScriptDnaInput {
  language: Language
  mode: Mode
  business?: BusinessContextLike
  product?: ProductContextLike
  activeSalesChannel?: 'physical' | 'messages' | 'website'
  ctaStrength?: CtaStrength
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function collectFactSlots(product?: ProductContextLike, business?: BusinessContextLike, language: Language = 'es'): string[] {
  const isEs = language === 'es'
  const facts: string[] = []

  if (hasText(product?.name)) facts.push(`${isEs ? 'nombre' : 'name'}: ${product?.name}`)
  if (hasText(product?.product_category)) facts.push(`${isEs ? 'categoria' : 'category'}: ${product?.product_category}`)
  if (hasText(product?.svc_service_type)) facts.push(`${isEs ? 'tipo de servicio' : 'service type'}: ${product?.svc_service_type}`)
  if (hasText(product?.ind_article_type)) facts.push(`${isEs ? 'tipo de prenda/articulo' : 'apparel/item type'}: ${product?.ind_article_type}`)
  if (hasArray(product?.product_variations)) facts.push(`${isEs ? 'variaciones' : 'variations'}: ${(product?.product_variations as unknown[]).join(', ')}`)
  if (hasText(product?.technical_specs)) facts.push(`${isEs ? 'datos tecnicos' : 'technical data'} disponibles`)
  if (hasText(product?.svc_process_steps)) facts.push(`${isEs ? 'proceso' : 'process'} disponible`)
  if (hasText(product?.ind_main_material)) facts.push(`${isEs ? 'material' : 'material'}: ${product?.ind_main_material}`)
  if (product?.ind_model_count && product.ind_model_count > 1) facts.push(`${product.ind_model_count} ${isEs ? 'modelos/disenos' : 'models/designs'}`)
  if (hasText(product?.ind_sizes)) facts.push(`${isEs ? 'tallas' : 'sizes'}: ${product?.ind_sizes}`)
  if (product?.has_guarantee || product?.svc_has_guarantee) facts.push(isEs ? 'garantia' : 'guarantee')
  if (business?.does_shipping || hasText(business?.shipping_method)) facts.push(isEs ? 'envios/logistica' : 'shipping/logistics')
  if (hasText(business?.location) || hasText(product?.location) || hasText(product?.re_location)) facts.push(isEs ? 'ubicacion' : 'location')
  if (hasText(product?.schedule)) facts.push(isEs ? 'horario' : 'schedule')
  if (hasText(product?.re_price)) facts.push(`${isEs ? 'precio' : 'price'}: ${product?.re_price}`)
  if (hasText(product?.re_construction_size)) facts.push(`${isEs ? 'tamano' : 'size'}: ${product?.re_construction_size}`)
  if (product?.svc_has_success_cases) facts.push(isEs ? 'casos de exito' : 'success cases')

  return facts.slice(0, 12)
}

function buildLens(product: ProductContextLike | undefined, language: Language): string {
  const isEs = language === 'es'
  const type = product?.type

  if (type === 'restaurant') {
    return isEs
      ? `LENTE DE RESTAURANTE:
- Cada guion debe vender un plato real del menu. No inventes platos.
- El desarrollo debe sonar antojable: cantidad, textura, salsa, acompanamientos, porcion, horario y ubicacion.
- Si falta una cantidad, usa placeholder especifico: [GRAMOS], [PORCIONES], [PRECIO], [HORARIO].`
      : `RESTAURANT LENS:
- Each script must sell a real dish from the menu. Do not invent dishes.
- The development must create craving: quantity, texture, sauce, sides, portion, schedule, and location.
- If a quantity is missing, use a specific placeholder: [GRAMS], [SERVINGS], [PRICE], [SCHEDULE].`
  }

  if (type === 'real_estate') {
    return isEs
      ? `LENTE INMOBILIARIO:
- El gancho debe filtrar por precio y ubicacion cuando esos datos existan.
- El desarrollo debe usar datos duros: m2, habitaciones, banos, parqueos, amenidades, referencia y oportunidad.
- Evita adjetivos vacios como "hermoso" si no estan respaldados por un dato visible.`
      : `REAL ESTATE LENS:
- The hook must filter by price and location when those facts exist.
- Development must use hard data: square meters, bedrooms, bathrooms, parking, amenities, reference point, and opportunity.
- Avoid empty adjectives like "beautiful" unless backed by a concrete visible fact.`
  }

  if (type === 'service') {
    return isEs
      ? `LENTE DE SERVICIO:
- Convierte el intangible en proceso: pasos, herramientas, duracion, resultado, garantia, casos y criterio profesional.
- Si hay casos de exito reales, usalos. Si faltan datos, deja placeholders utiles y especificos.
- El CTA debe filtrar: valoracion, agenda, diagnostico, "vemos si podemos ayudarte".`
      : `SERVICE LENS:
- Turn the intangible into a process: steps, tools, duration, outcome, guarantee, cases, and professional criteria.
- If real success cases exist, use them. If facts are missing, leave useful and specific placeholders.
- The CTA should filter: assessment, booking, diagnosis, "we see if we can help you".`
  }

  if (type === 'indumentaria') {
    return isEs
      ? `LENTE DE INDUMENTARIA:
- Vende identidad y certeza: modelos, material, tallas, cambios, personalizacion, calidad y uso real.
- Usa ganchos de coleccion, comparacion de versiones, drop, fanatismo, outfit o "no compres X sin saber esto".
- No digas "alta calidad" solo; explica de que material, que version, que cambio o que detalle lo prueba.`
      : `APPAREL LENS:
- Sell identity and certainty: models, material, sizes, exchanges, customization, quality, and real use.
- Use hooks around collection, version comparison, drop, fandom, outfit, or "do not buy X before knowing this".
- Do not only say "high quality"; explain the material, version, exchange policy, or detail that proves it.`
  }

  if (type === 'product') {
    return isEs
      ? `LENTE DE PRODUCTO:
- El producto debe quedar claro en la primera frase.
- Desarrollo recomendado: variantes/opciones, para quien es cada una, prueba de calidad, precio/logistica, garantia o cambio.
- Si el producto compite contra alternativas comunes, usa contraste especifico y etico.`
      : `PRODUCT LENS:
- The product must be clear in the first sentence.
- Recommended development: variants/options, who each one is for, proof of quality, price/logistics, guarantee or exchange.
- If the product competes with common alternatives, use specific and ethical contrast.`
  }

  return isEs
    ? `LENTE GENERAL:
- Primero claridad de que se vende, para quien y por que ahora.
- Luego detalles concretos que eliminen duda: proceso, numeros, opciones, tiempos, garantia, ubicacion o forma de compra.`
    : `GENERAL LENS:
- First clarify what is being sold, who it is for, and why now.
- Then add concrete details that remove doubt: process, numbers, options, timing, guarantee, location, or buying method.`
}

export function buildWinningScriptDnaPrompt(input: WinningScriptDnaInput): string {
  const { language, mode, business, product, activeSalesChannel, ctaStrength } = input
  const isEs = language === 'es'
  const facts = collectFactSlots(product, business, language)
  const factLine = facts.length > 0
    ? facts.join(' | ')
    : (isEs ? 'No hay suficientes datos concretos. Usa placeholders especificos donde falten datos.' : 'Not enough concrete facts. Use specific placeholders where data is missing.')
  const lens = buildLens(product, language)

  if (mode === 'organic') {
    return isEs
      ? `\n\n===================================================================\nADN DE GUIONES GANADORES - CAPA ORGANICA\n===================================================================\nEsta capa viene de una biblioteca externa de guiones reales ganadores. Usala como criterio de calidad, no como texto para copiar.\n\nPATRONES QUE SI FUNCIONAN EN ORGANICO:\n1. La primera linea debe ser una verdad, escena, error, lista o situacion concreta del nicho. No abras con saludo ni promesa generica.\n2. Aunque no sea venta, debe haber detalles reales: materiales, pasos, errores, opciones, casos, lugares, numeros o situaciones cotidianas.\n3. Si el producto aparece, aparece como parte natural de la historia o tip, no como protagonista comercial.\n4. Cada pieza debe tener una sola idea fuerte. Si intenta decir cinco cosas, se vuelve media.\n5. Si falta contexto, usa un placeholder util en vez de inventar.\n\nFILTRO ANTI-MID:\nAntes de responder, revisa internamente cada guion. Si podria servir para cualquier negocio cambiando el nombre, reescribelo con mas contexto especifico.\n\nDATOS CONCRETOS DISPONIBLES:\n${factLine}\n\n${lens}`
      : `\n\n===================================================================\nWINNING SCRIPT DNA - ORGANIC LAYER\n===================================================================\nThis layer comes from an external library of real winning scripts. Use it as a quality bar, not as text to copy.\n\nPATTERNS THAT WORK IN ORGANIC CONTENT:\n1. The first line must be a truth, scene, mistake, list, or concrete niche situation. Do not open with a greeting or generic promise.\n2. Even when it is not sales content, it needs real details: materials, steps, mistakes, options, cases, places, numbers, or everyday situations.\n3. If the product appears, it appears naturally inside the story or tip, not as the commercial protagonist.\n4. Each piece needs one strong idea. If it tries to say five things, it becomes mediocre.\n5. If context is missing, use a useful placeholder instead of inventing.\n\nANTI-MID FILTER:\nBefore answering, internally review each script. If it could fit any business by changing the name, rewrite it with more specific context.\n\nCONCRETE FACTS AVAILABLE:\n${factLine}\n\n${lens}`
  }

  if (mode === 'awareness') {
    return isEs
      ? `\n\n===================================================================\nADN DE GUIONES GANADORES - RECONOCIMIENTO\n===================================================================\nLa biblioteca de ganadores muestra que las mejores micro-historias no explican la marca: muestran una situacion real donde la marca tiene sentido.\n\nREGLAS:\n1. Empieza con una escena humana concreta, una contradiccion o una frase incomoda del publico objetivo.\n2. La marca debe entrar como consecuencia, no como venta.\n3. Usa detalles especificos del negocio para que la historia no sea generica.\n4. Cierra con payoff, no con CTA comercial.\n\nDATOS CONCRETOS DISPONIBLES:\n${factLine}\n\n${lens}`
      : `\n\n===================================================================\nWINNING SCRIPT DNA - AWARENESS\n===================================================================\nThe winning library shows that the best micro-stories do not explain the brand: they show a real situation where the brand makes sense.\n\nRULES:\n1. Start with a concrete human scene, contradiction, or uncomfortable audience truth.\n2. The brand must enter as a consequence, not as a sale.\n3. Use specific business details so the story is not generic.\n4. Close with payoff, not a commercial CTA.\n\nCONCRETE FACTS AVAILABLE:\n${factLine}\n\n${lens}`
  }

  const ctaLineEs = activeSalesChannel === 'physical'
    ? 'CTA: dirige a visitar el local con referencia clara. Si las reglas del negocio exigen "Los esperamos", respeta eso.'
    : activeSalesChannel === 'website'
      ? 'CTA: dirige a click, web o link del anuncio. No mandes al local como accion principal.'
      : activeSalesChannel === 'messages'
        ? 'CTA: dirige a enviar mensaje/DM con una accion concreta.'
        : 'CTA: usa la accion de compra mas coherente con los canales disponibles.'

  const ctaLineEn = activeSalesChannel === 'physical'
    ? 'CTA: drive to visit the store with a clear reference. If business rules require "We will be waiting for you", respect that.'
    : activeSalesChannel === 'website'
      ? 'CTA: drive to click, website, or ad link. Do not make store visit the primary action.'
      : activeSalesChannel === 'messages'
        ? 'CTA: drive to message/DM with a concrete action.'
        : 'CTA: use the buying action most consistent with available channels.'

  const ctaNote = ctaStrength && ctaStrength !== 'sales'
    ? (isEs ? `CTA configurado como ${ctaStrength}: respeta la capa de CTA suave/no comercial.` : `CTA configured as ${ctaStrength}: respect the soft/non-commercial CTA layer.`)
    : (isEs ? ctaLineEs : ctaLineEn)

  return isEs
    ? `\n\n===================================================================\nADN DE GUIONES GANADORES - CAPA OBLIGATORIA\n===================================================================\nEsta capa viene de una biblioteca externa de 109 guiones reales ganadores en 24 nichos. No copies ejemplos. Copia la logica de alto rendimiento.\n\nLO QUE MAS SE REPITE EN LOS GANADORES:\n1. CONTEXTO EN LA PRIMERA FRASE: el espectador entiende de inmediato producto, situacion, precio, ubicacion, problema o tipo de cliente.\n2. DENSIDAD DE DETALLE: cada desarrollo incluye 3 a 6 datos concretos: cantidades, modelos, materiales, pasos, tecnologias, tiempos, garantia, ubicacion, envio, precio, casos o limites reales.\n3. LOGISTICA COMO VALOR: envio, agenda, garantia, cambios, tiempos, reporte, ubicacion o metodo de compra van dentro del desarrollo, no como nota perdida al final.\n4. GANCHOS DE NICHO, NO GENERICOS: usa patrones como "No compres X sin saber esto", "Estas son las 3 opciones de X", "Si estas a punto de X", "Esto es lo que consigues por [precio] en [lugar]", "Hacemos X con [numero] opciones", "Acabas de X y todavia puedes Y".\n5. UNA IDEA POR GUION: no mezcles autoridad, variedad, proceso y oferta en el mismo guion salvo que el tipo lo pida.\n6. CTA SECO: una sola instruccion. Nada de despedidas largas ni cierre motivacional.\n\nREGLAS ANTI-GENERICO:\n- Prohibido usar "alta calidad", "servicio personalizado", "mejor opcion", "rapido y facil", "solucion ideal" sin probarlo inmediatamente con un dato concreto.\n- Si falta un dato critico, deja un placeholder especifico como [PRECIO], [TIEMPO DE ENTREGA], [NUMERO DE MODELOS], [GARANTIA], [UBICACION]. No inventes.\n- Cada guion debe incluir por lo menos 4 detalles especificos del contexto disponible o placeholders utiles.\n- Si el primer borrador podria vender cualquier cosa, reescribelo antes de responder.\n\nMAPA RAPIDO DE ANGULOS:\n- Buyer fear: "Si estas a punto de comprar/contratar X, mira esto antes".\n- Options/menu: "Estas son las 3 opciones de X segun lo que necesitas".\n- Proof/milestone: "Ya entregamos/atendimos/instalamos X y esto es lo que mas nos piden".\n- Process certainty: "Asi funciona X de principio a fin".\n- Alternative invalidation: "No compres/contrates X sin saber la diferencia entre A y B".\n- Price/location: "Esto es lo que consigues por [precio] en [lugar]".\n- Urgency/logistics: "Si necesitas X esta semana, asi lo resolvemos".\n\nDATOS CONCRETOS DISPONIBLES:\n${factLine}\n\n${lens}\n\n${ctaNote}\n\nCONTROL FINAL ANTES DE ENTREGAR:\nCada guion debe pasar estas preguntas: Es especifico? Elimina una duda real? Incluye logistica o prueba? Suena como alguien hablando en Reels/TikTok? Tiene un CTA directo? Si falla una, reescribe ese guion.`
    : `\n\n===================================================================\nWINNING SCRIPT DNA - MANDATORY LAYER\n===================================================================\nThis layer comes from an external library of 109 real winning scripts across 24 niches. Do not copy examples. Copy the high-performance logic.\n\nWHAT REPEATS MOST IN WINNERS:\n1. CONTEXT IN THE FIRST LINE: the viewer immediately understands product, situation, price, location, problem, or customer type.\n2. DETAIL DENSITY: each development includes 3 to 6 concrete facts: quantities, models, materials, steps, technologies, timing, guarantee, location, shipping, price, cases, or real constraints.\n3. LOGISTICS AS VALUE: shipping, booking, warranty, exchanges, timing, report, location, or buying method belong inside the development, not as a lost note at the end.\n4. NICHE HOOKS, NOT GENERIC HOOKS: use patterns like "Do not buy X before knowing this", "These are the 3 X options", "If you are about to X", "This is what you get for [price] in [place]", "We do X with [number] options", "You just bought X and you can still Y".\n5. ONE IDEA PER SCRIPT: do not mix authority, variety, process, and offer in the same script unless the requested type needs it.\n6. DRY CTA: one instruction. No long goodbyes or motivational closing.\n\nANTI-GENERIC RULES:\n- Forbidden to use "high quality", "personalized service", "best option", "fast and easy", "ideal solution" without immediately proving it with a concrete fact.\n- If a critical fact is missing, leave a specific placeholder like [PRICE], [DELIVERY TIME], [NUMBER OF MODELS], [GUARANTEE], [LOCATION]. Do not invent.\n- Each script must include at least 4 specific context details or useful placeholders.\n- If the first draft could sell anything, rewrite it before answering.\n\nFAST ANGLE MAP:\n- Buyer fear: "If you are about to buy/hire X, watch this first".\n- Options/menu: "These are the 3 X options depending on what you need".\n- Proof/milestone: "We have delivered/served/installed X and this is what people ask for most".\n- Process certainty: "This is how X works from start to finish".\n- Alternative invalidation: "Do not buy/hire X before knowing the difference between A and B".\n- Price/location: "This is what you get for [price] in [place]".\n- Urgency/logistics: "If you need X this week, this is how we solve it".\n\nCONCRETE FACTS AVAILABLE:\n${factLine}\n\n${lens}\n\n${ctaNote}\n\nFINAL CHECK BEFORE DELIVERING:\nEach script must pass these questions: Is it specific? Does it remove a real doubt? Does it include logistics or proof? Does it sound like someone speaking on Reels/TikTok? Does it have a direct CTA? If one fails, rewrite that script.`
}
