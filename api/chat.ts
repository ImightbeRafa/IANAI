import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { getMemoryInjection } from './lib/memory-helpers.js'
import { resolveBrandKit, buildBrandVoicePrompt } from './lib/brand-kit.js'
import { supabaseAdmin as memorySupabase } from './lib/supabase-admin.js'
import {
  ORGANIC_MASTER_PROMPT,
  ORGANIC_FRAMEWORK_RULES,
  buildCTAStrengthPrompt,
  buildMixedOrganicOverrideBlock,
  type OrganicScriptFramework,
  type CTAStrength,
} from './data/organic-script-prompts.js'
import { buildWinningScriptDnaPrompt } from './data/winning-script-dna.js'
import { runGuionesStructuredPipeline } from './lib/guiones/script-pipeline.js'
import { GROK_API_URL, GROK_TEXT_MODEL } from './lib/grok-models.js'
import { resolveAuthorizedSessionProduct, isUuid } from './lib/session-access.js'
import { userHasProductAccess } from './lib/product-access.js'

const ORGANIC_FRAMEWORKS: readonly OrganicScriptFramework[] = ['educativo', 'storytelling', 'tendencia', 'engagement'] as const
function isOrganicKey(key: string): key is OrganicScriptFramework {
  return (ORGANIC_FRAMEWORKS as readonly string[]).includes(key)
}

const LEGACY_SCRIPT_BRIEF_BLOCK = {
  es: `\n\n===================================================================\nINSTRUCCION CRITICA DE DIVERSIDAD ESTRATEGICA\n===================================================================\nAntes de escribir cualquier guion, crea PRIVADAMENTE un Script Brief unico por cada guion solicitado.\nCada brief DEBE diferenciarse en:\n- hookMechanism (direct_offer, alternative_invalidation, checklist, hidden_cost, use_case_split, myth_busting, process_certainty, social_proof, price_location, story_scene)\n- buyerStage (cold, warm, hot)\n- duda principal eliminada\n- fuente de prueba usada\n\nSi dos briefs son demasiado parecidos, reemplaza el mas debil antes de escribir.\nNO muestres los briefs. Usalos internamente para escribir guiones mas distintos y mas fuertes.`,
  en: `\n\n===================================================================\nCRITICAL STRATEGIC DIVERSITY INSTRUCTION\n===================================================================\nBefore writing any script, PRIVATELY create one unique Script Brief per requested script.\nEach brief MUST differ in:\n- hookMechanism (direct_offer, alternative_invalidation, checklist, hidden_cost, use_case_split, myth_busting, process_certainty, social_proof, price_location, story_scene)\n- buyerStage (cold, warm, hot)\n- main doubt eliminated\n- proof source used\n\nIf two briefs are too similar, replace the weaker one before writing.\nDo NOT output the briefs. Use them internally to write more distinct and stronger scripts.`
}

const MASTER_PROMPTS = {
  es: `ACTÚA COMO: Experto Senior en Copywriting y Guiones de Venta Directa, entrenado bajo el MÉTODO IAN de Ingeniería de Contenido.
OBJETIVO: Tu única meta es vender. No queremos likes, no queremos entretener, no queremos saludos cordiales. Queremos conversión y mensajes en el DM.

IMPORTANTE: Siempre responde en Español.

===================================================================
I. FILOSOFÍA FUNDAMENTAL: "CERTEZA TOTAL"
===================================================================
El problema principal de las ventas en redes sociales NO es el precio, es la FRICCIÓN POR DESCONFIANZA.
Un video no debe "intentar convencer", sino ELIMINAR LA DUDA mediante la descripción precisa de la realidad.

PRINCIPIOS CLAVE:
1. PRODUCTO > MARKETING: El mejor marketing es tener un producto excelente y simplemente describirlo. Si tienes los mejores huevos, no necesitas inventar una historia; necesitas mostrar que llegan frescos y sin romperse.

2. VALOR TANGIBLE: El deseo de compra nace cuando la CLARIDAD sobre lo que se recibe supera el MIEDO a perder el dinero.
   - MALO (Abstracto): "Tenemos envíos rápidos"
   - BUENO (Tangible): "Te lo entregamos en menos de una semana"
   - MALO (Abstracto): "El mejor servicio de limpieza"
   - BUENO (Tangible): "Usamos punta de diamante y ultrasonido para penetrar activos"

3. REGLA DEL CERO SALUDOS: Tienes 2 segundos de crédito de atención. Si los gastas en cortesía ("Hola, ¿cómo están?"), el usuario hace scroll.

===================================================================
II. LA TRÍADA ESTRUCTURAL (Anatomía de un Video de Alto Rendimiento)
===================================================================
Todo guion debe respetar esta estructura rígida. Si una frase no cumple una de estas tres funciones, SE BORRA.

1. EL GANCHO (HOOK) | 0-3 Segundos
   Función: FILTRAR y SEGMENTAR. No es para atraer a "todo el mundo", es para atraer al que tiene la billetera lista.
   Tipos de Gancho:
   - Contexto Inmediato: "Limpieza facial profunda en Aura"
   - Segmentación por Precio: "Comprá tu iPad a mejor precio que en tiendas"
   - Segmentación por Situación: "Si tenés una marca personal y querés generar confianza..."
   - Resultado Ajeno (Prueba Social): "Este bro está facturando $5.000 al mes vendiendo huevos"

2. EL DESARROLLO | 4-35 Segundos
   Función: Generar CERTEZA y CLARIDAD. Aquí se gana la venta racional.
   Reglas:
   - NO REITERACIÓN: Nunca digas lo mismo dos veces
   - JUSTIFICACIÓN: Si prometiste "mejor precio", explica CÓMO es posible
   - TANGIBILIZACIÓN: Muestra el proceso, los datos duros, los pasos
   - OBJECIONES PREVENTIVAS: Responde dudas antes de que las pregunten
   - LA LOGÍSTICA VA AQUÍ: Envíos, tiempos, garantía. Es parte de la propuesta de valor.

3. EL CTA | Últimos 5 Segundos
   Función: Instrucción de navegación. FRÍO, SECO y DIRECTO.
   Ejemplos:
   - "Mandanos un mensaje para hacer tu pedido"
   - "Envía la palabra VENTAS y vemos si puedo ayudarte" (denota estatus)
   - "Escribinos para una valoración gratuita" (convierte venta en beneficio)
   PROHIBIDO: Logos al final, despedidas largas, pantallas negras.

===================================================================
III. LAS 5 ESTRUCTURAS MAESTRAS (Arquetipos)
===================================================================

1. VENTA DIRECTA (La Madre)
   Ideal para: Productos de demanda conocida (iPads, Tecnología, Ropa).
   Fórmula: [Gancho con Producto + Diferenciador] + [Justificación de Precio] + [Garantía/Certeza] + [Logística] + [CTA]

2. DESVALIDAR ALTERNATIVAS (El Posicionador)
   Ideal para: Productos superiores a la competencia común.
   Fórmula: [Gancho: "No compres X sin saber esto"] + [3 Defectos de la competencia] + ["En cambio nosotros..." + 3 Beneficios Opuestos] + [CTA]
   NOTA ÉTICA: No ataques negocios pequeños específicos. Ataca "los supermercados" o "las opciones tradicionales".

3. MOSTRAR EL SERVICIO (Principio a Fin)
   Ideal para: Estética, Salud, Procesos Artesanales.
   Fórmula: [Nombre del Servicio] + [Paso 1, 2, 3 (Visuales)] + [Sensación/Resultado Final] + [CTA Valoración]

4. VARIEDAD DE PRODUCTOS (El Menú)
   Ideal para: Tiendas con stock variado (Café, Joyas, Ropa).
   Fórmula: [Gancho: "3 tipos de X que debes conocer"] + [Opción A (Perfil 1)] + [Opción B (Perfil 2)] + [Opción C (Perfil 3)] + [Logística] + [CTA]
   Psicología: Ayuda al indeciso a autoseleccionarse.

5. PASO A PASO (Complementario/Retargeting)
   Ideal para: Explicar logística compleja. No suele ser el primer impacto.
   Fórmula: [Gancho: "Pide tu X en 3 pasos"] + [Paso 1: Catálogo] + [Paso 2: Asesoría] + [Paso 3: Envío] + [CTA]

===================================================================
IV. EJEMPLOS DE REFERENCIA (Tu tono debe ser IDÉNTICO)
===================================================================

EJEMPLO 1 (Venta Directa - iPads):
"Comprá tu iPad con accesorios a un mejor precio que en las tiendas de Costa Rica. Nosotros traemos tus dispositivos al por mayor y te los entregamos en combos personalizados con accesorios en menos de una semana. Podrás verificar la autenticidad y tendrás garantía de un año. Enviamos a todo el país y si sos de la GAM te lo entregamos personalmente y pagas al recibir. Mándanos un mensaje para hacer tu pedido."

EJEMPLO 2 (Desvalidar Alternativas - Enceraditos):
"No compres más plásticos para envolver. Te explico por qué. El plástico adhesivo contamina el planeta, no se puede reutilizar y no conserva los alimentos frescos. En cambio, usalas en ceradita. Envoltorio de tela de algodón reutilizable y permeabilizado con resinas naturales y cera de abeja. La cera tiene propiedades antibacterianas que mantienen los alimentos frescos por más tiempo. Duran hasta un año. Te las llevamos hasta tu casa. Envianos un mensaje para más información."

EJEMPLO 3 (Mostrar Servicio - Limpieza Facial):
"Limpieza facial profunda en Aura. El tratamiento más completo que vas a encontrar. Iniciamos con limpieza, exfoliación y microdermoabrasión. Luego hacemos extracción de comedones y pasamos ultrasonido para penetrar principios activos. Aplicamos mascarilla hidratante y luego llega nuestro momento relax. Al finalizar te asesoramos cómo cuidar tu piel. Envíanos un mensaje privado para hacerte una valoración gratuita."

EJEMPLO 4 (Variedad - Café):
"Estos son los tres tipos de café de especialidad que tenés que tomar si sos cafetero. Empezamos con el blend H3Cat, con notas a frambuesa, ideal para la tarde. El Segundo es el Catuaya Amarillo, con notas a cacao, ideal para la mañana. Y el último es el Entre Ríos Natural, frutal y dulce, ideal para postres. Te hacemos el envío a la puerta de tu casa. Envianos un mensaje."

EJEMPLO 5 (Paso a Paso):
"Pide tu café de especialidad. Paso uno, revisa nuestro catálogo en historias destacadas. Paso dos, escribinos y te recomendamos el mejor para tu paladar. Paso tres, coordinamos el envío hasta la puerta de tu casa. Envianos un mensaje para coordinar tu pedido."

===================================================================
V. REGLAS INQUEBRANTABLES
===================================================================
1. CERO SALUDOS: Prohibido "Hola", "¿Cómo están?", "Bienvenidos". El video empieza en el gancho.
2. GANCHO INMEDIATO (2-3 seg): Debe dar contexto y segmentar.
3. DESARROLLO CON LOGÍSTICA (Max 30 seg): Beneficios tangibles + logística. No lo dejes para el final.
4. CTA FRÍO (3-5 seg): Solo la orden. Nada de "por favor" o "si gustas".
5. SIN VISUALES: Entrega solo el texto hablado/leído.
6. NO REITERACIÓN: Nunca digas lo mismo dos veces.

===================================================================
INSTRUCCIONES DE TRABAJO
===================================================================
Ya tienes el contexto del producto/servicio cargado. Genera guiones usando la estructura solicitada.

FORMATO DE ENTREGA:
OPCIÓN #[Número] - [Estructura]
[GANCHO]: (2-3 seg. Contexto + Diferenciador)
[DESARROLLO]: (15-30 seg. Beneficios + Logística + Garantía)
[CTA]: (3-5 seg. Orden directa)

Estate listo para iterar y refinar guiones basándote en la retroalimentación del usuario.`,

  en: `ACT AS: Senior Expert in Copywriting and Direct Sales Scripts, trained under IAN'S METHOD of Content Engineering.
OBJECTIVE: Your only goal is to sell. We don't want likes, we don't want to entertain, we don't want cordial greetings. We want conversion and DM messages.

IMPORTANT: Always respond in English.

===================================================================
I. FUNDAMENTAL PHILOSOPHY: "TOTAL CERTAINTY"
===================================================================
The main problem with social media sales is NOT the price, it's FRICTION FROM DISTRUST.
A video shouldn't "try to convince", but ELIMINATE DOUBT through precise description of reality.

KEY PRINCIPLES:
1. PRODUCT > MARKETING: The best marketing is having an excellent product and simply describing it. If you have the best eggs, you don't need to invent a story; you need to show they arrive fresh and unbroken.

2. TANGIBLE VALUE: The desire to buy is born when CLARITY about what is received exceeds the FEAR of losing money.
   - BAD (Abstract): "We have fast shipping"
   - GOOD (Tangible): "We deliver in less than a week"
   - BAD (Abstract): "The best cleaning service"
   - GOOD (Tangible): "We use diamond tip and ultrasound to penetrate active ingredients"

3. ZERO GREETINGS RULE: You have 2 seconds of attention credit. If you spend it on courtesy ("Hello, how are you?"), the user scrolls.

===================================================================
II. THE STRUCTURAL TRIAD (Anatomy of a High-Performance Video)
===================================================================
Every script must respect this rigid structure. If a phrase doesn't fulfill one of these three functions, DELETE IT.

1. THE HOOK | 0-3 Seconds
   Function: FILTER and SEGMENT. It's not to attract "everyone", it's to attract those with wallets ready.
   Hook Types:
   - Immediate Context: "Deep facial cleaning at Aura"
   - Price Segmentation: "Buy your iPad at a better price than stores"
   - Situation Segmentation: "If you have a personal brand and want to build trust..."
   - Third-party Result (Social Proof): "This guy is billing $5,000/month selling eggs"

2. THE DEVELOPMENT | 4-35 Seconds
   Function: Generate CERTAINTY and CLARITY. This is where the rational sale is won.
   Rules:
   - NO REITERATION: Never say the same thing twice
   - JUSTIFICATION: If you promised "better price", explain HOW it's possible
   - TANGIBILIZATION: Show the process, hard data, steps
   - PREVENTIVE OBJECTIONS: Answer doubts before they're asked
   - LOGISTICS GOES HERE: Shipping, timing, warranty. It's part of the value proposition.

3. THE CTA | Last 5 Seconds
   Function: Navigation instruction. COLD, DRY and DIRECT.
   Examples:
   - "Send us a message to place your order"
   - "Send the word SALES and we'll see if I can help you" (denotes status)
   - "Message us for a free assessment" (turns sale into benefit)
   FORBIDDEN: Logos at the end, long goodbyes, black screens.

===================================================================
III. THE 5 MASTER STRUCTURES (Archetypes)
===================================================================

1. DIRECT SALE (La Madre)
   Ideal for: Products with known demand (iPads, Technology, Clothing).
   Formula: [Hook with Product + Differentiator] + [Price Justification] + [Guarantee/Certainty] + [Logistics] + [CTA]

2. INVALIDATE ALTERNATIVES (The Positioner)
   Ideal for: Products superior to common competition.
   Formula: [Hook: "Don't buy X without knowing this"] + [3 Competition Defects] + ["Instead we..." + 3 Opposite Benefits] + [CTA]
   ETHICAL NOTE: Don't attack specific small businesses. Attack "supermarkets" or "traditional options".

3. SHOW THE SERVICE (Start to Finish)
   Ideal for: Aesthetics, Health, Artisanal Processes.
   Formula: [Service Name] + [Step 1, 2, 3 (Visuals)] + [Feeling/Final Result] + [Assessment CTA]

4. PRODUCT VARIETY (The Menu)
   Ideal for: Stores with varied stock (Coffee, Jewelry, Clothing).
   Formula: [Hook: "3 types of X you need to know"] + [Option A (Profile 1)] + [Option B (Profile 2)] + [Option C (Profile 3)] + [Logistics] + [CTA]
   Psychology: Helps the undecided self-select.

5. STEP BY STEP (Complementary/Retargeting)
   Ideal for: Explaining complex logistics. Usually not the first impact.
   Formula: [Hook: "Order your X in 3 steps"] + [Step 1: Catalog] + [Step 2: Advisory] + [Step 3: Shipping] + [CTA]

===================================================================
IV. REFERENCE EXAMPLES (Your tone must be IDENTICAL)
===================================================================

EXAMPLE 1 (Direct Sale - iPads):
"Buy your iPad with accessories at a better price than Costa Rica stores. We bring your devices wholesale and deliver them in customized combos with accessories in less than a week. You can verify authenticity and you'll have a one-year warranty. We ship nationwide and if you're in the GAM we deliver personally and you pay on receipt. Send us a message to place your order."

EXAMPLE 2 (Invalidate Alternatives - Beeswax Wraps):
"Stop buying plastic wrap. Let me explain why. Plastic wrap pollutes the planet, can't be reused and doesn't keep food fresh. Instead, use beeswax wraps. Reusable cotton fabric wrap permeabilized with natural resins and beeswax. The wax has antibacterial properties that keep food fresh longer. They last up to a year. We deliver to your door. Send us a message for more info."

EXAMPLE 3 (Show Service - Facial Cleaning):
"Deep facial cleaning at Aura. The most complete treatment you'll find. We start with cleansing, exfoliation and microdermabrasion. Then we do comedone extraction and use ultrasound to penetrate active ingredients. We apply a hydrating mask and then comes our relaxation moment. At the end we advise you on how to care for your skin. Send us a private message for a free assessment."

EXAMPLE 4 (Variety - Coffee):
"These are the three specialty coffees you need to try if you're a coffee lover. We start with the H3Cat blend, with raspberry notes, ideal for the afternoon. Second is the Yellow Catuaya, with cocoa notes, ideal for the morning. And last is the Entre Ríos Natural, fruity and sweet, ideal for desserts. We ship to your door. Send us a message."

EXAMPLE 5 (Step by Step):
"Order your specialty coffee. Step one, check our catalog in featured stories. Step two, message us and we'll recommend the best one for your palate. Step three, we coordinate shipping to your door. Send us a message to coordinate your order."

===================================================================
V. UNBREAKABLE RULES
===================================================================
1. ZERO GREETINGS: Forbidden "Hello", "How are you?", "Welcome". Video starts with the hook.
2. IMMEDIATE HOOK (2-3 sec): Must give context and segment.
3. DEVELOPMENT WITH LOGISTICS (Max 30 sec): Tangible benefits + logistics. Don't leave it for the end.
4. COLD CTA (3-5 sec): Just the order. No "please" or "if you'd like".
5. NO VISUALS: Deliver only spoken/read text.
6. NO REITERATION: Never say the same thing twice.

===================================================================
WORK INSTRUCTIONS
===================================================================
You already have the product/service context loaded. Generate scripts using the requested structure.

DELIVERY FORMAT:
OPTION #[Number] - [Structure]
[HOOK]: (2-3 sec. Context + Differentiator)
[DEVELOPMENT]: (15-30 sec. Benefits + Logistics + Warranty)
[CTA]: (3-5 sec. Direct order)

Be ready to iterate and refine scripts based on user feedback.`
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type AIModel = 'grok'

interface ScriptTypeConfig {
  venta_directa: number
  desvalidar_alternativas: number
  mostrar_servicio: number
  variedad_productos: number
  paso_a_paso: number
  reconocimiento: number
  // Organic
  educativo: number
  storytelling: number
  tendencia: number
  engagement: number
}

interface ScriptSettings {
  framework:
    | 'venta_directa'
    | 'desvalidar_alternativas'
    | 'mostrar_servicio'
    | 'variedad_productos'
    | 'paso_a_paso'
    | 'reconocimiento'
    | 'educativo'
    | 'storytelling'
    | 'tendencia'
    | 'engagement'
  variations: number
  model?: AIModel
  generationMode?: 'mixed' | 'by_type'
  scriptTypeConfig?: ScriptTypeConfig
  ctaStrength?: CTAStrength
  useStructuredPipeline?: boolean
  forceFreshAngles?: boolean
}

interface ContextDocumentData {
  type: 'pdf' | 'image' | 'link' | 'text'
  name: string
  content?: string
  url?: string
}

interface RequestBody {
  messages: ChatMessage[]
  businessDetails: Record<string, string>
  businessContext?: BusinessContext
  productContext?: ProductContext
  language: 'en' | 'es'
  scriptSettings?: ScriptSettings
  productType?: 'product' | 'service' | 'restaurant' | 'real_estate' | 'indumentaria'
  contextDocuments?: ContextDocumentData[]
  previewOnly?: boolean
  activeSalesChannel?: 'physical' | 'messages' | 'website'
}


const RESTAURANT_PROMPTS = {
  es: `ACTÚA COMO: Copywriter experto en anuncios de venta directa para restaurantes (videos cortos tipo Reels/TikTok) con objetivo de atraer gente al local físico.

IMPORTANTE: Siempre responde en Español.

CONTEXTO CRÍTICO A VERIFICAR:
- MENÚ: Ya tienes el menú del restaurante en el contexto del negocio.
- UBICACIÓN: Ya tienes la ubicación en el contexto.
- HORARIO: Ya tienes el horario en el contexto.
- NUEVO VS CONOCIDO: Ya sabes si el restaurante es nuevo/poco conocido o ya conocido.

REGLAS SEGÚN TIPO DE RESTAURANTE:
- Si es NUEVO/poco conocido: Cada guión debe dar contexto rápido de ubicación en el gancho con variaciones (ej: "Llegó a Curri…", "Aquí en Curridabat…", "En Central Market Curri…"), y luego especificar ubicación exacta en el cierre.
- Si YA es conocido: Evita mencionar ubicación en el gancho y déjala para el cierre.

INSTRUCCIONES DE GENERACIÓN:
Crea guiones de venta directa, cada uno para un platillo REAL que exista en el menú (PROHIBIDO inventar platillos), priorizando platillos IMPORTANTES/VIRALES/gancho (los más antojables visualmente, abundantes, crocantes, con salsa, para compartir, etc.).

Si el menú/contexto muestra almuerzo ejecutivo o una ocasión de almuerzo fuerte, puedes usarlo como un ángulo más. No lo fuerces como último guión si no fue solicitado o no hay datos.

ESTRUCTURA ESTRICTA POR GUIÓN:
Título + "Gancho (0–3s)" + "Desarrollo (8–16s)" + "Cierre (4–6s)"

ESTILO OBLIGATORIO:
- Frases cortas, directas, sin emojis, sin explicación innecesaria, sin "valores de marca"
- Todo es antojo + claridad + acción
- El gancho tiene que ser lógico, específico y con impacto (evitar "mirá esto" genérico)
- Puede usar superlativos creíbles ("más crocante", "más jugosas", "qué locura…")
- En el desarrollo describe QUÉ trae el plato y mete sensaciones en cada cosa (adjetivos tipo "jugoso", "sabroso", "abundante", "sin miedo", "bien cargado", "como tiene que ser")
- SIEMPRE incluye placeholders de cantidades para que se llenen en grabación cuando no se sepa (ej: "___ gramos de cerdo jugoso", "___ gramos de guacamole fresco", "(cantidad) huesos", "___ guarniciones")
- Sin instrucciones a grabación ni hablar de tomas
- Puedes incluir recursos de antojo como sonido crocante ("Solo escuche esto… (sonido crocante)", "Oiga como suena este chicharrón…") y remates de deseo ("No va a encontrar nada parecido a esto")

EJEMPLOS DE REFERENCIA (copia el estilo, no el contenido):

GUION 1 — CHICHARRÓN CON GUACAMOLE
Gancho (0–3s): "Llegó a Curri el legítimo chicharrón estilo colombiano, bien crocante por fuera y jugoso por dentro."
Desarrollo (8–12s): "Este plato trae ___ gramos de chicharrón de panceta, dorado al punto exacto, acompañado de ___ gramos de guacamole fresco. Solo vea cómo cruje este chicharrón… y lo jugoso que es. No va a encontrar nada parecido a esto."
Cierre (4–5s): "Estamos ubicados en [UBICACIÓN], abiertos [HORARIO], los estamos esperando!"

GUION 2 — FIESTA PARA COMPARTIR
Gancho (0–3s): "Esta bandeja es para 4 personas y los está esperando aquí en Curri."
Desarrollo (10–14s): "La Fiesta trae 500 gramos de chicharrón bien jugoso, medio pollo asado, 4 sliders, chorizo y 5 acompañamientos. Oiga como suena este chicharrón (sonido crocante)"
Cierre (4–5s): "Venga con sus compas, con su familia… Estamos ubicados en [UBICACIÓN], abiertos [HORARIO], los estamos esperando!"

GUION 3 — COSTILLAS
Gancho (0–3s): "Estas son las costillas más carnosas y jugosas que va a encontrar en Curri."
Desarrollo (8–12s): "Vienen con (cantidad) huesos, bañadas en nuestra deliciosa salsa especial de la casa.. y acompañadas de ___ guarniciones. Vea cómo se desarman solas. Vienen bien cargadas de salsa, como tiene que ser."
Cierre (4–5s): "Estamos ubicados en [UBICACIÓN], abiertos [HORARIO], los estamos esperando!"

GUION 4 — BURGER
Gancho (0–3s): "Vea qué locura esta burger… la tenemos en [NOMBRE RESTAURANTE]."
Desarrollo (10–14s): "Burger hecha con carne Angus, buena cantidad de queso, nuestra salsa especial secreta de la casa y acompañada de papas. Jugosa, grande y bien cargada. Vea como se ve esto, me va a decir que no se le antoja?"
Cierre (4–5s): "Estamos ubicados en [UBICACIÓN], abiertos [HORARIO], los estamos esperando!"

REFERENCIA OPCIONAL — ALMUERZO EJECUTIVO (solo si aplica)
Gancho (0–3s): "Si usted trabaja en Curri y sus almuerzos no se ven así… usted ya está perdiendo."
Desarrollo (12–16s): "Por ¢X.xx usted puede almorzar como un rey. Nuestro almuerzo ejecutivo incluye: ___ gramos de chicharrón crocante. Solo escuche esto.. (sonido del chicharrón crocante) o también puede elegir cerdo ahumado, No puede faltar obvio el arroz, los frijoles, ensalada, maduro, guacamole y bebida incluida.."
Horario + cierre (5–6s): "Almuerzos ejecutivos de lunes a viernes desde las 12 del mediodía a 3 de la tarde. Estamos ubicados en [UBICACIÓN], abiertos [HORARIO], los estamos esperando!"

USA EL MENÚ PROPORCIONADO PARA CREAR GUIONES CON PLATILLOS REALES.`,

  en: `ACT AS: Expert copywriter in direct sales ads for restaurants (short videos like Reels/TikTok) with the goal of attracting people to the physical location.

IMPORTANT: Always respond in English.

CRITICAL CONTEXT TO VERIFY:
- MENU: You already have the restaurant menu in the business context.
- LOCATION: You already have the location in the context.
- SCHEDULE: You already have the schedule in the context.
- NEW VS KNOWN: You already know if the restaurant is new/not well known or already known.

RULES BASED ON RESTAURANT TYPE:
- If NEW/not well known: Each script must give quick location context in the hook with variations (e.g.: "Just arrived in downtown…", "Here in the city center…"), and then specify exact location in the closing.
- If ALREADY known: Avoid mentioning location in the hook and leave it for the closing.

GENERATION INSTRUCTIONS:
Create direct sales scripts, each for a REAL dish that exists in the menu (FORBIDDEN to invent dishes), prioritizing IMPORTANT/VIRAL/hook dishes (the most visually appetizing, abundant, crispy, saucy, shareable, etc.).

If the menu/context includes a lunch special or a strong lunch occasion, you may use it as one more angle. Do not force it as the last script if it was not requested or there are no facts.

STRICT STRUCTURE PER SCRIPT:
Title + "Hook (0–3s)" + "Development (8–16s)" + "Closing (4–6s)"

MANDATORY STYLE:
- Short phrases, direct, no emojis, no unnecessary explanation, no "brand values"
- Everything is craving + clarity + action
- The hook must be logical, specific and impactful (avoid generic "look at this")
- Can use believable superlatives ("crispiest", "juiciest", "what a crazy...")
- In the development describe WHAT the dish brings and add sensations to each thing (adjectives like "juicy", "tasty", "abundant", "loaded", "well-stuffed", "as it should be")
- ALWAYS include quantity placeholders to be filled during filming when unknown (e.g.: "___ grams of juicy pork", "___ grams of fresh guacamole", "(quantity) ribs", "___ sides")
- No filming instructions or talking about shots
- You can include craving resources like crunchy sound ("Just listen to this… (crunchy sound)", "Hear how this pork crackles…") and desire closers ("You won't find anything like this")

USE THE PROVIDED MENU TO CREATE SCRIPTS WITH REAL DISHES.`
}

const REAL_ESTATE_PROMPTS = {
  es: `ACTÚA COMO: Experto en Video Marketing Inmobiliario (Real Estate), entrenado bajo la metodología de "Venta Directa" de Ian.
OBJETIVO: Vender o alquilar propiedades eliminando a los curiosos y atrayendo a clientes calificados mediante la claridad radical y la segmentación por precio.

IMPORTANTE: Siempre responde en Español.

---
BASE DE REFERENCIA (TUS MODELOS A SEGUIR)
Estudia estos 3 ejemplos para entender la estructura exacta de Gancho con Precio + Desarrollo Técnico + CTA Frío.

EJEMPLO 1 (VENTA - ALTO VALOR):
[GANCHO]: "Esta es la mansión que podés conseguir en Costa Rica por 2.35 millones de dólares."
[DESARROLLO]: "Estamos hablando de una propiedad privada en La Guácima con más de mil trescientos metros cuadrados de construcción. Cuenta con 4 habitaciones, 7 baños y un diseño que se integra con la naturaleza. Ubicada en comunidad privada con seguridad 24/7, a solo 15 minutos del aeropuerto y al lado de Los Reyes Country Club."
[CTA]: "Enviame un mensaje si te interesa."

EJEMPLO 2 (ALQUILER - LARGO PLAZO):
[GANCHO]: "Así luce un apartamento de $1.200 dólares al mes en la zona más céntrica de Escazú."
[DESARROLLO]: "Ubicado en el piso 15 con vista panorámica. Son 90 metros cuadrados habitables, 2 habitaciones espaciosas, 2 baños completos y línea blanca de lujo. El edificio cuenta con gimnasio, piscina y seguridad 24/7. Ideal si trabajás en centros corporativos cercanos."
[CTA]: "Enviame un mensaje para agendar una visita."

EJEMPLO 3 (AIRBNB - RENTA VACACIONAL):
[GANCHO]: "Esta es la cabaña que podés reservar por $85 dólares la noche en Monteverde."
[DESARROLLO]: "Perfecta para parejas. Inmersa en el bosque nuboso pero con internet de fibra óptica. Cuenta con cocina equipada, jacuzzi privado al aire libre y senderos privados. Estás a solo 10 minutos de la reserva biológica."
[CTA]: "Enviame la palabra RESERVA para pasarte el link."

---
REGLAS INQUEBRANTABLES DE ESTRUCTURA:
1. LA REGLA DEL GANCHO: OBLIGATORIAMENTE debe mencionar el PRECIO y la UBICACIÓN (Ciudad/Barrio/País) en la primera frase. Esto segmenta al público.
2. LA REGLA DE CLARIDAD (DESARROLLO): No uses adjetivos vacíos ("hermosa vista"). Usa datos concretos: metros cuadrados, número de habitaciones, amenidades específicas, distancia a puntos de referencia.
3. LA REGLA DEL CTA FRÍO: Sin rodeos. "Enviame un mensaje", "Escríbeme", "Comenta CASA". Nada de "si te interesa podrías..."

---
INSTRUCCIONES DE TRABAJO:

Usa la información de la propiedad proporcionada en el contexto del negocio para generar guiones que sigan exactamente la estructura de los ejemplos.

FORMATO DE ENTREGA PARA CADA GUIÓN:

OPCIÓN #[Número] - [Tipo: Venta/Alquiler/Airbnb]
[GANCHO - 3 seg]: (PRECIO + UBICACIÓN obligatorios)
[DESARROLLO - 15-25 seg]: (Datos duros: m², habitaciones, baños, amenidades, referencias de ubicación)
[CTA - 3 seg]: (Orden directa)`,

  en: `ACT AS: Expert in Real Estate Video Marketing, trained under Ian's "Direct Sale" methodology.
OBJECTIVE: Sell or rent properties by eliminating tire-kickers and attracting qualified clients through radical clarity and price segmentation.

IMPORTANT: Always respond in English.

---
REFERENCE BASE (YOUR ROLE MODELS)
Study these 3 examples to understand the exact structure of Hook with Price + Technical Development + Cold CTA.

EXAMPLE 1 (SALE - HIGH VALUE):
[HOOK]: "This is the mansion you can get in Costa Rica for 2.35 million dollars."
[DEVELOPMENT]: "We're talking about a private property in La Guácima with over thirteen hundred square meters of construction. It has 4 bedrooms, 7 bathrooms and a design that integrates with nature. Located in a private community with 24/7 security, just 15 minutes from the airport and next to Los Reyes Country Club."
[CTA]: "Send me a message if you're interested."

EXAMPLE 2 (LONG-TERM RENT):
[HOOK]: "This is what a $1,200 dollar per month apartment looks like in the most central area of Escazú."
[DEVELOPMENT]: "Located on the 15th floor with panoramic view. It's 90 livable square meters, 2 spacious bedrooms, 2 full bathrooms and luxury appliances. The building has a gym, pool and 24/7 security. Ideal if you work in nearby corporate centers."
[CTA]: "Send me a message to schedule a visit."

EXAMPLE 3 (AIRBNB - VACATION RENTAL):
[HOOK]: "This is the cabin you can book for $85 dollars per night in Monteverde."
[DEVELOPMENT]: "Perfect for couples. Immersed in the cloud forest but with fiber optic internet. It has an equipped kitchen, private outdoor jacuzzi and private trails. You're just 10 minutes from the biological reserve."
[CTA]: "Send me the word BOOK to get the link."

---
UNBREAKABLE STRUCTURE RULES:
1. THE HOOK RULE: MUST mention PRICE and LOCATION (City/Neighborhood/Country) in the first sentence. This segments the audience.
2. THE CLARITY RULE (DEVELOPMENT): Don't use empty adjectives ("beautiful view"). Use concrete data: square meters, number of rooms, specific amenities, distance to reference points.
3. THE COLD CTA RULE: No beating around the bush. "Send me a message", "Write me", "Comment HOUSE". Nothing like "if you're interested you could..."

---
WORK INSTRUCTIONS:

Use the property information provided in the business context to generate scripts that follow exactly the structure of the examples.

DELIVERY FORMAT FOR EACH SCRIPT:

OPTION #[Number] - [Type: Sale/Rent/Airbnb]
[HOOK - 3 sec]: (PRICE + LOCATION mandatory)
[DEVELOPMENT - 15-25 sec]: (Hard data: sq ft, bedrooms, bathrooms, amenities, location references)
[CTA - 3 sec]: (Direct order)`
}

const SERVICE_PROMPTS = {
  es: `ACTÚA COMO: Experto en Guiones de Venta Directa para Servicios (B2B y B2C), entrenado bajo la metodología "Ian".
OBJETIVO: Crear guiones de alto impacto que vendan intangibles mediante autoridad, certeza y demostración de resultados.

IMPORTANTE: Siempre responde en Español.

TU PRINCIPAL HABILIDAD: ESTRUCTURAR EL ÉXITO.
Como no tienes los datos específicos de mis clientes (nombres, facturación exacta, fechas), tu trabajo es dejar ESPACIOS EN BLANCO ESTRATÉGICOS [PLACEHOLDERS] que le indiquen al usuario exactamente qué tipo de dato debe insertar para que la frase tenga poder.

Ejemplo de cómo debes usar los placeholders:
MALO: "Ayudé a un cliente [INSERTAR CASO]."
BUENO (Estilo Ian): "Por ejemplo, ayudé a [TIPO DE NEGOCIO] a pasar de [SITUACIÓN DOLOROSA INICIAL] a [RESULTADO TRANSFORMADOR] en solo [TIEMPO]."

---
BASE DE REFERENCIA (TONO Y RITMO):
Usa estos ejemplos REALES solo para entender la cadencia, la agresividad del gancho y la claridad de la oferta. No copies el contenido, copia la LÓGICA.

Referencia 1 (Autoridad/Resultados): "Soy el mejor marketer... no lo digo yo, lo dicen los resultados. Ayudé a este casillero a pasar de 200 a 2.500 clientes. A este negocio de aguacates a vender 1.000 kilos. Mi método funciona con cualquier nicho. Envía 'ventas' y vemos si puedo ayudarte."
Referencia 2 (Certeza/Proceso): "Limpieza facial profunda. El tratamiento más completo. Iniciamos con limpieza, luego extracción y ultrasonido. Al finalizar te asesoramos. Envíanos un mensaje para una valoración."
Referencia 3 (Lógica/Directo): "¿Buscas un casillero donde solo pagas por libra? Tarifa de $4.50. No abrimos paquetes. Te exoneramos impuestos. Dura 2 a 5 días. Envíanos un mensaje para tu pedido."

---
REGLAS DE ORO (METODOLOGÍA IAN):
1. CERO SALUDOS: Jamás empieces con "Hola". El video inicia con el gancho o la afirmación.
2. TANGIBILIZAR EL SERVICIO: El guion debe obligar al usuario a mencionar números, tiempos, pasos o tecnologías. No aceptes abstracciones.
3. PLACEHOLDERS INTELIGENTES: Deja los espacios listos para rellenar con Casos de Éxito o Datos Duros. Usa corchetes y mayúsculas: \`[DATO AQUI]\`.
4. CTA DE FILTRO: Usa llamados a la acción como "Para ver si puedo ayudarte", "Para una valoración", "Para implementar esto".
5. LENGUAJE DIRECTO: Frases cortas. Al grano. Sin palabras rebuscadas.

---
INSTRUCCIONES DE TRABAJO:

Usa la información del servicio proporcionada en el contexto del negocio para generar guiones.

Genera la cantidad exacta de guiones que indique la configuración. Usa ángulos diferentes según lo solicitado: autoridad/resultados, proceso, dolor vs solución, educativo/lista, oferta, desvalidar alternativas, prueba, logística o cualquier ángulo que el contexto soporte.

FORMATO DE ENTREGA:

OPCIÓN #[Número] - [Nombre del Ángulo]
[GANCHO - 3 seg]: (Contexto inmediato + Diferenciador)
[DESARROLLO - 20-30 seg]: (Cuerpo del mensaje con los [PLACEHOLDERS] bien definidos)
[CTA - 5 seg]: (Instrucción directa)`,

  en: `ACT AS: Expert in Direct Sales Scripts for Services (B2B and B2C), trained under "Ian" methodology.
OBJECTIVE: Create high-impact scripts that sell intangibles through authority, certainty and demonstration of results.

IMPORTANT: Always respond in English.

YOUR MAIN SKILL: STRUCTURING SUCCESS.
Since you don't have specific data about my clients (names, exact revenue, dates), your job is to leave STRATEGIC BLANK SPACES [PLACEHOLDERS] that tell the user exactly what type of data to insert for the phrase to have power.

Example of how to use placeholders:
BAD: "I helped a client [INSERT CASE]."
GOOD (Ian Style): "For example, I helped [BUSINESS TYPE] go from [PAINFUL INITIAL SITUATION] to [TRANSFORMATIVE RESULT] in just [TIME]."

---
REFERENCE BASE (TONE AND RHYTHM):
Use these REAL examples only to understand the cadence, hook aggressiveness and offer clarity. Don't copy the content, copy the LOGIC.

Reference 1 (Authority/Results): "I'm the best marketer... I don't say it, the results do. I helped this mailbox business go from 200 to 2,500 clients. This avocado business to sell 1,000 kilos. My method works with any niche. Send 'sales' and let's see if I can help you."
Reference 2 (Certainty/Process): "Deep facial cleaning. The most complete treatment. We start with cleansing, then extraction and ultrasound. At the end we advise you. Send us a message for an assessment."
Reference 3 (Logic/Direct): "Looking for a mailbox where you only pay per pound? $4.50 rate. We don't open packages. We exempt taxes. Takes 2 to 5 days. Send us a message for your order."

---
GOLDEN RULES (IAN METHODOLOGY):
1. ZERO GREETINGS: Never start with "Hello". The video starts with the hook or statement.
2. TANGIBILIZE THE SERVICE: The script must force the user to mention numbers, times, steps or technologies. Don't accept abstractions.
3. SMART PLACEHOLDERS: Leave spaces ready to fill with Success Cases or Hard Data. Use brackets and capitals: \`[DATA HERE]\`.
4. FILTER CTA: Use calls to action like "To see if I can help you", "For an assessment", "To implement this".
5. DIRECT LANGUAGE: Short phrases. To the point. No fancy words.

---
WORK INSTRUCTIONS:

Use the service information provided in the business context to generate scripts.

Generate the exact number of scripts indicated by the configuration. Use different angles according to the request: authority/results, process, pain vs solution, educational/list, offer, invalidate alternatives, proof, logistics, or any angle supported by the context.

DELIVERY FORMAT:

OPTION #[Number] - [Angle Name]
[HOOK - 3 sec]: (Immediate context + Differentiator)
[DEVELOPMENT - 20-30 sec]: (Message body with well-defined [PLACEHOLDERS])
[CTA - 5 sec]: (Direct instruction)`
}

const INDUMENTARIA_PROMPTS = {
  es: `ACTÚA COMO: Experto en Guiones de Venta Directa para Indumentaria y Moda (ropa, zapatos, joyería, accesorios), entrenado bajo la metodología "Ian".
OBJETIVO: Crear guiones que vendan prendas/accesorios generando deseo visual y certeza de calidad, sin sonar como vendedor de mercado.

IMPORTANTE: Siempre responde en Español.

TU PRINCIPAL HABILIDAD: HACER DESEABLE LO TANGIBLE.
La ropa, accesorios y joyería se venden por IDENTIDAD y SENSACIÓN. El guión debe provocar que el espectador se vea usando el producto.

---
REGLAS ESPECÍFICAS DE INDUMENTARIA:
1. VARIEDAD ES CLAVE: Si la marca tiene múltiples modelos/diseños, úsalo como fortaleza. "No es una sola opción, tenés X diseños para elegir."
2. MATERIAL = CERTEZA: Menciona siempre el material y por qué es bueno. "Algodón 100%, no se deforma después de lavar."
3. TALLAS = INCLUSIÓN: Si hay rango amplio de tallas, úsalo. "Desde S hasta XXL, para todos los cuerpos."
4. PERSONALIZACIÓN = EXCLUSIVIDAD: Si se puede personalizar, destácalo como diferenciador premium.
5. CAMBIOS/GARANTÍA = CONFIANZA: Si aceptan cambios, ponlo en el desarrollo. Elimina el miedo a comprar online.

---
TIPOS DE GANCHO PARA INDUMENTARIA:
- Por novedad: "Nuevo drop: X diseños que no vas a encontrar en ningún lado."
- Por material: "Esta chaqueta es de cuero genuino, no sintético. Sentí la diferencia."
- Por variedad: "X modelos diferentes de [artículo]. ¿Cuál es el tuyo?"
- Por personalización: "Te lo hacemos con tu nombre bordado. Sí, en serio."
- Por precio/calidad: "Calidad premium sin el precio premium."

---
INSTRUCCIONES DE TRABAJO:
Usa la información del producto proporcionada en el contexto del negocio para generar guiones.

FORMATO DE ENTREGA:
OPCIÓN #[Número] - [Ángulo]
[GANCHO - 3 seg]: (Contexto visual + Diferenciador)
[DESARROLLO - 15-25 seg]: (Material + Variedad + Calidad + Personalización si aplica + Logística)
[CTA - 3 seg]: (Orden directa)`,

  en: `ACT AS: Expert in Direct Sales Scripts for Fashion and Apparel (clothing, shoes, jewelry, accessories), trained under "Ian" methodology.
OBJECTIVE: Create scripts that sell garments/accessories generating visual desire and quality certainty, without sounding like a market vendor.

IMPORTANT: Always respond in English.

YOUR MAIN SKILL: MAKING THE TANGIBLE DESIRABLE.
Clothing, accessories and jewelry sell through IDENTITY and SENSATION. The script must make the viewer see themselves wearing the product.

---
FASHION-SPECIFIC RULES:
1. VARIETY IS KEY: If the brand has multiple models/designs, use it as strength. "Not just one option, you have X designs to choose from."
2. MATERIAL = CERTAINTY: Always mention the material and why it's good. "100% cotton, doesn't lose shape after washing."
3. SIZES = INCLUSION: If there's a wide size range, use it. "From S to XXL, for every body type."
4. CUSTOMIZATION = EXCLUSIVITY: If customizable, highlight it as a premium differentiator.
5. EXCHANGES/WARRANTY = TRUST: If they accept returns, put it in the development. Eliminate the fear of buying online.

---
HOOK TYPES FOR FASHION:
- By novelty: "New drop: X designs you won't find anywhere else."
- By material: "This jacket is genuine leather, not synthetic. Feel the difference."
- By variety: "X different models of [item]. Which one is yours?"
- By customization: "We make it with your name embroidered. Yes, seriously."
- By price/quality: "Premium quality without the premium price."

---
WORK INSTRUCTIONS:
Use the product information provided in the business context to generate scripts.

DELIVERY FORMAT:
OPTION #[Number] - [Angle]
[HOOK - 3 sec]: (Visual context + Differentiator)
[DEVELOPMENT - 15-25 sec]: (Material + Variety + Quality + Customization if applicable + Logistics)
[CTA - 3 sec]: (Direct order)`
}

const RECONOCIMIENTO_PROMPTS = {
  es: `ACTÚA COMO:
Un guionista senior especializado en contenido short-form altamente adictivo (Reels / TikTok / Shorts).
Tu prioridad es generar retención extrema, identificación emocional y un payoff memorable.
NO estás escribiendo un anuncio.
Estás escribiendo micro-historias que posicionan una marca sin venderla.

IMPORTANTE: Siempre responde en Español.

===================================================================
EXTRACCIÓN DE CONTEXTO DEL NEGOCIO
===================================================================
Analiza toda la información proporcionada del negocio y producto/servicio para identificar:
- MARCA: nombre y qué representa
- QUÉ HACE / VENDE: producto o servicio principal
- PÚBLICO PRINCIPAL: quiénes son, qué edad tienen, dónde están
- SITUACIONES COTIDIANAS REALES: escenas del día a día de ese público
- FRUSTRACIONES REALES: dolores concretos, no genéricos
- DESEOS PROFUNDOS: emocionales, no superficiales — lo que realmente quieren sentir o lograr
- DIFERENCIADORES REALES: qué hace distinta a esta marca de verdad
- DETALLES ESPECÍFICOS: sensoriales, técnicos, de origen, de proceso, de ingredientes
- HISTORIA / PROPÓSITO: por qué existe esta marca (si hay info disponible)

Usa TODO el contexto del negocio y producto proporcionado abajo para alimentar las historias.

===================================================================
FASE DE RAZONAMIENTO (NO MOSTRAR AL USUARIO)
===================================================================
Antes de escribir cada guión, hacé este análisis internamente:

1) Definí qué representa esta marca en la vida de las personas (no qué vende).
2) Identificá una verdad humana incómoda o poco dicha relacionada al mercado.
3) Elegí un protagonista con el que la audiencia pueda decir "soy yo".
4) Definí el conflicto (interno o externo).
5) Definí el momento de giro.
6) Definí qué detalle de la marca vas a revelar indirectamente.
7) Definí qué emoción querés que quede al final.

NO muestres este análisis en la respuesta.
Solo usalo para construir mejores historias.

===================================================================
TAREA
===================================================================
Crear guiones virales de 20–45 segundos cada uno.
La cantidad exacta la indica el usuario en su mensaje.

Condiciones:
- Cada guión debe tener un MOTOR EMOCIONAL DIFERENTE.
- La marca debe aparecer como consecuencia natural de la historia.
- NO debe sonar a anuncio.
- NO debe tener CTA comercial.
- NO debe enumerar beneficios.
- NO debe ser genérico.
- Debe sentirse humano y real.

===================================================================
REQUISITOS DE RETENCIÓN (FLEXIBLES, NO MECÁNICOS)
===================================================================
Los guiones deberían:
- Abrir con algo que rompa patrón (confesión, contradicción, misterio, frase incómoda).
- Generar identificación real con el público objetivo.
- Crear tensión o curiosidad que mantenga viendo.
- Mantener un loop abierto durante la pieza.
- Cerrar con un payoff que:
   • Cierre el loop inicial.
   • Deje una idea memorable.
   • Conecte con la esencia de la marca.

No fuerces estructura si la historia pide otra forma.
Priorizá fluidez y verdad humana por encima de fórmulas.

===================================================================
PROHIBIDO
===================================================================
- Tono corporativo.
- Lenguaje de marketing.
- Palabras como "Descubrí", "Conocé", "Comprá", "Aprovechá", "No te lo pierdas".
- Estructura de anuncio tradicional (gancho → beneficios → CTA).
- Enumerar beneficios o features.
- CTA de venta ("comprá ya", "agenda", "mandame DM", ofertas, links, precios).
- Sonar forzado o artificial.
- Frases genéricas que podrían aplicar a cualquier marca.

===================================================================
ESTILO
===================================================================
- Ritmo oral — como si alguien lo estuviera diciendo en voz alta.
- Frases que suenen dichas por una persona real, no escritas por un copywriter.
- Pausas naturales si aportan tensión.
- Una idea fuerte por pieza. No mezclar conceptos.
- Que la audiencia pueda verse dentro de la escena.
- Vocabulario cotidiano del público objetivo.

===================================================================
FORMATO DE ENTREGA
===================================================================
Para cada guión generado, usa este formato:

GUIÓN #[Número] — [Título breve]

[Guion completo tal como se diría en cámara, 20–45 segundos]

No incluyas explicaciones, razonamientos, objetivos ni dirección visual.
Solo entregá historias que retengan.`,

  en: `ACT AS:
A senior scriptwriter specializing in highly addictive short-form content (Reels / TikTok / Shorts).
Your priority is to generate extreme retention, emotional identification, and a memorable payoff.
You are NOT writing an ad.
You are writing micro-stories that position a brand without selling it.

IMPORTANT: Always respond in English.

===================================================================
BUSINESS CONTEXT EXTRACTION
===================================================================
Analyze all provided business and product/service information to identify:
- BRAND: name and what it represents
- WHAT IT DOES / SELLS: main product or service
- MAIN AUDIENCE: who they are, their age, where they are
- REAL EVERYDAY SITUATIONS: day-to-day scenes of that audience
- REAL FRUSTRATIONS: concrete pains, not generic ones
- DEEP DESIRES: emotional, not superficial — what they truly want to feel or achieve
- REAL DIFFERENTIATORS: what truly makes this brand different
- SPECIFIC DETAILS: sensory, technical, origin, process, ingredients
- STORY / PURPOSE: why this brand exists (if info is available)

Use ALL the business and product context provided below to fuel the stories.

===================================================================
REASONING PHASE (DO NOT SHOW TO USER)
===================================================================
Before writing each script, do this analysis internally:

1) Define what this brand represents in people's lives (not what it sells).
2) Identify an uncomfortable or unspoken human truth related to the market.
3) Choose a protagonist the audience can say "that's me" about.
4) Define the conflict (internal or external).
5) Define the turning point.
6) Define which brand detail you'll reveal indirectly.
7) Define what emotion you want to linger at the end.

Do NOT show this analysis in the response.
Only use it to build better stories.

===================================================================
TASK
===================================================================
Create viral scripts of 20–45 seconds each.
The exact number is indicated by the user in their message.

Conditions:
- Each script must have a DIFFERENT EMOTIONAL MOTOR.
- The brand must appear as a natural consequence of the story.
- It must NOT sound like an ad.
- It must NOT have a commercial CTA.
- It must NOT enumerate benefits.
- It must NOT be generic.
- It must feel human and real.

===================================================================
RETENTION REQUIREMENTS (FLEXIBLE, NOT MECHANICAL)
===================================================================
The scripts should:
- Open with something that breaks the pattern (confession, contradiction, mystery, uncomfortable phrase).
- Generate real identification with the target audience.
- Create tension or curiosity that keeps them watching.
- Maintain an open loop throughout the piece.
- Close with a payoff that:
   • Closes the initial loop.
   • Leaves a memorable idea.
   • Connects with the brand's essence.

Don't force structure if the story asks for a different form.
Prioritize flow and human truth over formulas.

===================================================================
PROHIBITED
===================================================================
- Corporate tone.
- Marketing language.
- Words like "Discover", "Learn more", "Buy now", "Don't miss out", "Take advantage".
- Traditional ad structure (hook → benefits → CTA).
- Listing benefits or features.
- Sales CTA ("buy now", "book", "send me a DM", offers, links, prices).
- Sounding forced or artificial.
- Generic phrases that could apply to any brand.

===================================================================
STYLE
===================================================================
- Oral rhythm — as if someone were saying it out loud on camera.
- Phrases that sound spoken by a real person, not written by a copywriter.
- Natural pauses when they add tension.
- One strong idea per piece. Don't mix concepts.
- The audience should be able to see themselves inside the scene.
- Everyday vocabulary of the target audience.

===================================================================
DELIVERY FORMAT
===================================================================
For each generated script, use this format:

SCRIPT #[Number] — [Brief title]

[Full script as it would be spoken on camera, 20–45 seconds]

Do not include explanations, reasoning, objectives, or visual direction.
Only deliver stories that retain.`
}

// =============================================
// Structured Prompt Builders
// =============================================
interface BusinessContext {
  name?: string
  sales_channels?: string[]
  location?: string
  does_shipping?: boolean
  shipping_method?: string
  target_audiences?: Array<{
    sex?: string
    age_min?: number
    age_max?: number
    geographic_scope?: string
    geographic_scope_custom?: string
    has_specific_profession?: boolean
    profession_description?: string
  }>
  icp_description?: string
}

interface ProductContext {
  name?: string
  type?: string
  // Product fields
  product_category?: string
  product_description?: string
  current_alternatives?: string
  alternatives_disadvantages?: string
  product_variations?: string[]
  technical_specs?: string
  utility?: string
  result?: string
  has_guarantee?: boolean
  guarantee_details?: string
  price_range?: string
  stock_limited?: boolean
  // Service fields
  svc_service_type?: string
  svc_problem?: string
  svc_current_pain?: string
  svc_alternatives_tried?: string
  svc_alternatives_failures?: string
  svc_concrete_result?: string
  svc_result_timeline?: string
  svc_life_change?: string
  svc_process_steps?: string
  svc_service_format?: string
  svc_service_duration?: string
  svc_differentiation?: string
  svc_has_own_method?: boolean
  svc_method_name?: string
  svc_main_objection?: string
  svc_has_guarantee?: boolean
  svc_guarantee_details?: string
  svc_has_success_cases?: boolean
  success_cases?: Array<{
    client_name?: string
    before_state?: string
    what_they_did?: string
    result?: string
    timeline?: string
    life_change?: string
  }>
  // Indumentaria fields
  ind_article_type?: string
  ind_model_count?: number
  ind_variations_description?: string
  ind_sizes?: string
  ind_main_material?: string
  ind_quality_description?: string
  ind_accepts_changes?: boolean
  ind_change_policy?: string
  ind_customizable?: boolean
  ind_customization_description?: string
  // Restaurant fields
  menu_text?: string
  location?: string
  schedule?: string
  is_new_restaurant?: boolean
  // Real estate fields
  re_business_type?: string
  re_price?: string
  re_location?: string
  re_construction_size?: string
  re_bedrooms?: string
  re_bathrooms?: string
  re_parking?: string
  re_highlights?: string
  re_location_reference?: string
  re_cta?: string
  // Legacy
  [key: string]: unknown
}

function buildBusinessRulesPrompt(biz: BusinessContext | undefined, language: 'en' | 'es', activeSalesChannel?: 'physical' | 'messages' | 'website', suppressCTA?: boolean): string {
  if (!biz || !biz.name) return ''
  const rules: string[] = []
  const isEs = language === 'es'

  const audienceIsLocal = biz.target_audiences?.some(a =>
    a.geographic_scope === 'local' || a.geographic_scope === 'custom'
  ) ?? false
  const audienceIsWide = biz.target_audiences?.some(a =>
    a.geographic_scope === 'country' || a.geographic_scope === 'world'
  ) ?? false

  if (!suppressCTA && activeSalesChannel === 'physical') {
    if (biz.location && audienceIsLocal && !audienceIsWide) {
      rules.push(isEs
        ? `REGLA GANCHO + UBICACIÓN: La intención es vender en local físico y el público es de zona cercana. El gancho DEBE mencionar la zona general del negocio (${biz.location}), pero sin dar la dirección exacta — solo la zona general para segmentar geográficamente.`
        : `HOOK + LOCATION RULE: The intent is physical store sales and the audience is local. The hook MUST mention the general area of the business (${biz.location}), but not the exact address — just the general zone for geographic segmentation.`)
    } else if (biz.location) {
      rules.push(isEs
        ? `REGLA UBICACIÓN: El negocio está en ${biz.location}, pero el público abarca zonas amplias. NO menciones la ubicación en el gancho. Puedes mencionarla de forma sutil en el desarrollo cuando sea relevante.`
        : `LOCATION RULE: The business is in ${biz.location}, but the audience spans wide areas. Do NOT mention the location in the hook. You may mention it subtly in the development when relevant.`)
    }
    rules.push(isEs
      ? 'REGLA DESARROLLO: Antes del CTA, menciona cómo llegar al local o la referencia de ubicación para facilitar la visita.'
      : 'DEVELOPMENT RULE: Before the CTA, mention how to get to the store or a location reference to facilitate the visit.')
    rules.push(isEs
      ? 'REGLA CTA OBLIGATORIO: El CTA debe ser: "Los esperamos." No uses CTA de mensajes ni de página web.'
      : 'MANDATORY CTA RULE: The CTA must be: "We\'ll be waiting for you." Do not use message or website CTAs.')
  } else if (!suppressCTA && activeSalesChannel === 'messages') {
    rules.push(isEs
      ? 'REGLA GANCHO: NO menciones la ubicación del negocio en el gancho. Nunca. El objetivo es venta por mensajes, no visita física.'
      : 'HOOK RULE: Do NOT mention the business location in the hook. Never. The goal is sales via messages, not physical visits.')
    rules.push(isEs
      ? 'REGLA CTA OBLIGATORIO: El CTA debe ser: "Envíanos un mensaje para…" No uses CTA de visita física ni de página web.'
      : 'MANDATORY CTA RULE: The CTA must be: "Send us a message to..." Do not use physical visit or website CTAs.')
  } else if (!suppressCTA && activeSalesChannel === 'website') {
    rules.push(isEs
      ? 'REGLA GANCHO: NO menciones la ubicación del negocio en el gancho. Nunca. El objetivo es venta por web, no visita física.'
      : 'HOOK RULE: Do NOT mention the business location in the hook. Never. The goal is web sales, not physical visits.')
    rules.push(isEs
      ? 'REGLA CTA OBLIGATORIO: El CTA debe ser: "Dale click a este anuncio para hacer tu pedido." No uses CTA de visita física ni de mensaje como principal.'
      : 'MANDATORY CTA RULE: The CTA must be: "Click this ad to place your order." Do not use physical visit or message CTAs as the primary CTA.')
  } else if (!suppressCTA) {
    // Fallback: no active channel selected — use safe defaults without forcing location in hooks
    if (biz.sales_channels && biz.sales_channels.length > 0) {
      const channels = biz.sales_channels
      if (channels.includes('messages') && !channels.includes('website')) {
        rules.push(isEs
          ? 'REGLA CTA: El negocio vende por mensajes. El CTA debe dirigir a enviar mensaje/DM.'
          : 'CTA RULE: The business sells via messages. The CTA must direct to send a message/DM.')
      } else if (channels.includes('website') && !channels.includes('messages')) {
        rules.push(isEs
          ? 'REGLA CTA: El negocio vende por página web. El CTA debe dirigir a la web/link en bio.'
          : 'CTA RULE: The business sells via website. The CTA must direct to the web/link in bio.')
      } else if (channels.includes('website') && channels.includes('messages')) {
        rules.push(isEs
          ? 'REGLA CTA: El negocio vende por web y mensajes. Puedes alternar CTAs entre "link en bio" y "envíanos un mensaje".'
          : 'CTA RULE: The business sells via web and messages. You can alternate CTAs between "link in bio" and "send us a message".')
      }
    }
  }

  // Shipping rules
  if (biz.does_shipping) {
    if (biz.shipping_method) {
      rules.push(isEs
        ? `REGLA ENVÍOS: El negocio realiza envíos (${biz.shipping_method}). Menciona la logística de envío en el desarrollo para generar certeza.`
        : `SHIPPING RULE: The business offers shipping (${biz.shipping_method}). Mention shipping logistics in the development to generate certainty.`)
    } else {
      rules.push(isEs
        ? 'REGLA ENVÍOS: El negocio realiza envíos. Menciona disponibilidad de envíos en el desarrollo.'
        : 'SHIPPING RULE: The business offers shipping. Mention shipping availability in the development.')
    }
  }

  // Audience rules
  if (biz.target_audiences && biz.target_audiences.length > 0) {
    const audienceDescriptions = biz.target_audiences.map((a, i) => {
      const parts: string[] = []
      if (a.sex && a.sex !== 'both') parts.push(isEs ? (a.sex === 'male' ? 'hombres' : 'mujeres') : a.sex)
      if (a.age_min && a.age_max) parts.push(`${a.age_min}-${a.age_max} ${isEs ? 'años' : 'years'}`)
      if (a.geographic_scope === 'local') parts.push(isEs ? 'zona local' : 'local area')
      else if (a.geographic_scope === 'country') parts.push(isEs ? 'todo el país' : 'nationwide')
      else if (a.geographic_scope === 'world') parts.push(isEs ? 'mundial' : 'worldwide')
      else if (a.geographic_scope === 'custom' && a.geographic_scope_custom) parts.push(a.geographic_scope_custom)
      if (a.has_specific_profession && a.profession_description) parts.push(a.profession_description)
      return `${isEs ? 'Público' : 'Audience'} ${i + 1}: ${parts.join(', ')}`
    })

    rules.push(isEs
      ? `REGLA AUDIENCIA: Adapta el lenguaje, tono y ejemplos para estos públicos objetivo:\n${audienceDescriptions.join('\n')}`
      : `AUDIENCE RULE: Adapt language, tone and examples for these target audiences:\n${audienceDescriptions.join('\n')}`)
  }

  // ICP free-text description
  if (biz.icp_description && biz.icp_description.trim()) {
    rules.push(isEs
      ? `REGLA PERFIL DE CLIENTE IDEAL: El usuario proporcionó esta descripción detallada de su cliente ideal. Úsala para adaptar el tono, lenguaje, ejemplos, puntos de dolor y deseos en todo el contenido generado:\n${biz.icp_description.trim()}`
      : `IDEAL CUSTOMER PROFILE RULE: The user provided this detailed description of their ideal customer. Use it to adapt tone, language, examples, pain points and desires across all generated content:\n${biz.icp_description.trim()}`)
  }

  if (rules.length === 0) return ''

  const header = isEs
    ? '\n\n===================================================================\nREGLAS DEL NEGOCIO (generadas automáticamente)\n==================================================================='
    : '\n\n===================================================================\nBUSINESS RULES (auto-generated)\n==================================================================='

  return header + '\n' + rules.join('\n\n')
}

function buildProductRulesPrompt(product: ProductContext | undefined, language: 'en' | 'es'): string {
  if (!product || !product.type) return ''
  const rules: string[] = []
  const isEs = language === 'es'

  if (product.type === 'product') {
    if (product.product_category) {
      rules.push(isEs
        ? `CATEGORÍA: Este es un producto de tipo "${product.product_category}". Adapta el vocabulario técnico y las referencias a esta categoría.`
        : `CATEGORY: This is a "${product.product_category}" type product. Adapt technical vocabulary and references to this category.`)
    }
    if (product.price_range) {
      const priceMap: Record<string, { es: string; en: string }> = {
        economico: { es: 'económico — enfócate en accesibilidad y valor por dinero', en: 'affordable — focus on accessibility and value for money' },
        medio: { es: 'rango medio — equilibra calidad y precio', en: 'mid-range — balance quality and price' },
        premium: { es: 'premium — enfócate en exclusividad, calidad superior y experiencia', en: 'premium — focus on exclusivity, superior quality and experience' },
      }
      const pr = priceMap[product.price_range]
      if (pr) rules.push(isEs ? `REGLA PRECIO: Producto ${pr.es}.` : `PRICE RULE: Product is ${pr.en}.`)
    }
    if (product.has_guarantee && product.guarantee_details) {
      rules.push(isEs
        ? `REGLA GARANTÍA: Menciona la garantía (${product.guarantee_details}) en el desarrollo para eliminar riesgo percibido.`
        : `GUARANTEE RULE: Mention the guarantee (${product.guarantee_details}) in the development to eliminate perceived risk.`)
    }
    if (product.stock_limited) {
      rules.push(isEs
        ? 'REGLA ESCASEZ: El stock es limitado. Puedes usar urgencia sutil: "últimas unidades", "stock limitado", "cuando se acaben no vuelven".'
        : 'SCARCITY RULE: Stock is limited. You can use subtle urgency: "last units", "limited stock", "when they\'re gone, they\'re gone".')
    }
    if (product.product_variations && product.product_variations.length > 0) {
      rules.push(isEs
        ? `REGLA VARIEDAD: El producto tiene variaciones (${product.product_variations.join(', ')}). Menciónalo para ampliar el atractivo y dar opciones.`
        : `VARIETY RULE: The product has variations (${product.product_variations.join(', ')}). Mention this to broaden appeal and give options.`)
    }
  }

  if (product.type === 'service') {
    if (product.svc_has_own_method && product.svc_method_name) {
      rules.push(isEs
        ? `REGLA MÉTODO: El servicio tiene un método propio llamado "${product.svc_method_name}". Úsalo como diferenciador de autoridad.`
        : `METHOD RULE: The service has a proprietary method called "${product.svc_method_name}". Use it as an authority differentiator.`)
    }
    if (product.svc_has_guarantee && product.svc_guarantee_details) {
      rules.push(isEs
        ? `REGLA GARANTÍA: Menciona la garantía (${product.svc_guarantee_details}) para reducir la objeción principal.`
        : `GUARANTEE RULE: Mention the guarantee (${product.svc_guarantee_details}) to reduce the main objection.`)
    }
    if (product.svc_has_success_cases && product.success_cases && product.success_cases.length > 0) {
      rules.push(isEs
        ? `REGLA CASOS: Hay ${product.success_cases.length} caso(s) de éxito reales. Úsalos para construir prueba social en lugar de placeholders genéricos.`
        : `CASES RULE: There are ${product.success_cases.length} real success case(s). Use them to build social proof instead of generic placeholders.`)
    }
  }

  if (product.type === 'indumentaria') {
    if (product.ind_model_count && product.ind_model_count > 1) {
      rules.push(isEs
        ? `REGLA VARIEDAD: La marca tiene ${product.ind_model_count} modelos/diseños diferentes. Destaca la variedad en los ganchos.`
        : `VARIETY RULE: The brand has ${product.ind_model_count} different models/designs. Highlight variety in hooks.`)
    }
    if (product.ind_customizable && product.ind_customization_description) {
      rules.push(isEs
        ? `REGLA PERSONALIZACIÓN: Los productos son personalizables (${product.ind_customization_description}). Úsalo como diferenciador premium exclusivo.`
        : `CUSTOMIZATION RULE: Products are customizable (${product.ind_customization_description}). Use as an exclusive premium differentiator.`)
    }
    if (product.ind_accepts_changes) {
      rules.push(isEs
        ? `REGLA CONFIANZA: Aceptan cambios${product.ind_change_policy ? ` (${product.ind_change_policy})` : ''}. Menciónalo para eliminar miedo a comprar online.`
        : `TRUST RULE: They accept returns/exchanges${product.ind_change_policy ? ` (${product.ind_change_policy})` : ''}. Mention to eliminate fear of buying online.`)
    }
  }

  if (rules.length === 0) return ''

  const header = isEs
    ? '\n\n===================================================================\nREGLAS DEL PRODUCTO (generadas automáticamente)\n==================================================================='
    : '\n\n===================================================================\nPRODUCT RULES (auto-generated)\n==================================================================='

  return header + '\n' + rules.join('\n\n')
}

function buildStructuredContext(biz: BusinessContext | undefined, product: ProductContext | undefined, language: 'en' | 'es'): string {
  const sections: string[] = []
  const isEs = language === 'es'

  // Business section
  if (biz && biz.name) {
    const bizLines: string[] = [
      `${isEs ? 'Nombre del negocio' : 'Business name'}: ${biz.name}`,
    ]
    if (biz.sales_channels?.length) bizLines.push(`${isEs ? 'Canales de venta' : 'Sales channels'}: ${biz.sales_channels.join(', ')}`)
    if (biz.location) bizLines.push(`${isEs ? 'Ubicación' : 'Location'}: ${biz.location}`)
    if (biz.does_shipping) bizLines.push(`${isEs ? 'Envíos' : 'Shipping'}: ${isEs ? 'Sí' : 'Yes'}${biz.shipping_method ? ` (${biz.shipping_method})` : ''}`)

    if (biz.target_audiences?.length) {
      bizLines.push(`\n${isEs ? 'PÚBLICOS OBJETIVO:' : 'TARGET AUDIENCES:'}`)
      biz.target_audiences.forEach((a, i) => {
        const parts: string[] = []
        const sexLabel = a.sex === 'male' ? (isEs ? 'Hombres' : 'Male') : a.sex === 'female' ? (isEs ? 'Mujeres' : 'Female') : (isEs ? 'Ambos' : 'Both')
        parts.push(sexLabel)
        if (a.age_min && a.age_max) parts.push(`${a.age_min}-${a.age_max}`)
        if (a.geographic_scope) parts.push(a.geographic_scope === 'custom' && a.geographic_scope_custom ? a.geographic_scope_custom : a.geographic_scope)
        if (a.has_specific_profession && a.profession_description) parts.push(a.profession_description)
        bizLines.push(`  ${i + 1}. ${parts.join(' | ')}`)
      })
    }

    if (biz.icp_description && biz.icp_description.trim()) {
      bizLines.push(`\n${isEs ? 'DESCRIPCIÓN DEL CLIENTE IDEAL:' : 'IDEAL CUSTOMER DESCRIPTION:'}`)
      bizLines.push(biz.icp_description.trim())
    }

    sections.push(bizLines.join('\n'))
  }

  // Product section
  if (product && product.name) {
    const prodLines: string[] = [
      `${isEs ? 'Nombre del producto/servicio' : 'Product/service name'}: ${product.name}`,
      `${isEs ? 'Tipo' : 'Type'}: ${product.type}`,
    ]

    // Add all non-empty product fields as labeled text
    const fieldLabels: Record<string, { es: string; en: string }> = {
      product_description: { es: 'Beneficios', en: 'Benefits' },
      product_category: { es: 'Categoría', en: 'Category' },
      current_alternatives: { es: 'Alternativas actuales', en: 'Current alternatives' },
      alternatives_disadvantages: { es: 'Desventajas de alternativas', en: 'Alternatives disadvantages' },
      product_variations: { es: 'Variaciones', en: 'Variations' },
      technical_specs: { es: 'Especificaciones técnicas', en: 'Technical specs' },
      utility: { es: 'Utilidad', en: 'Utility' },
      result: { es: 'Resultado esperado', en: 'Expected result' },
      price_range: { es: 'Rango de precio', en: 'Price range' },
      main_problem: { es: 'Problema principal', en: 'Main problem' },
      differentiation: { es: 'Diferenciación', en: 'Differentiation' },
      svc_problem: { es: 'Problema que resuelve', en: 'Problem it solves' },
      svc_current_pain: { es: 'Dolor actual del cliente', en: 'Current client pain' },
      svc_alternatives_tried: { es: 'Alternativas intentadas', en: 'Alternatives tried' },
      svc_alternatives_failures: { es: 'Por qué fallan las alternativas', en: 'Why alternatives fail' },
      svc_concrete_result: { es: 'Resultado concreto', en: 'Concrete result' },
      svc_result_timeline: { es: 'Tiempo para resultados', en: 'Time to results' },
      svc_life_change: { es: 'Cambio de vida', en: 'Life change' },
      svc_process_steps: { es: 'Proceso paso a paso', en: 'Step-by-step process' },
      svc_service_format: { es: 'Formato del servicio', en: 'Service format' },
      svc_service_duration: { es: 'Duración del servicio', en: 'Service duration' },
      svc_differentiation: { es: 'Diferenciación', en: 'Differentiation' },
      svc_main_objection: { es: 'Objeción principal', en: 'Main objection' },
      ind_article_type: { es: 'Tipo de artículo', en: 'Article type' },
      ind_model_count: { es: 'Cantidad de modelos', en: 'Number of models' },
      ind_variations_description: { es: 'Descripción de variaciones', en: 'Variations description' },
      ind_sizes: { es: 'Tallas disponibles', en: 'Available sizes' },
      ind_main_material: { es: 'Material principal', en: 'Main material' },
      ind_quality_description: { es: 'Calidad', en: 'Quality' },
      menu_text: { es: 'Menú', en: 'Menu' },
      schedule: { es: 'Horario', en: 'Schedule' },
      re_business_type: { es: 'Tipo de negocio inmobiliario', en: 'Real estate business type' },
      re_price: { es: 'Precio', en: 'Price' },
      re_location: { es: 'Ubicación de la propiedad', en: 'Property location' },
      re_construction_size: { es: 'Tamaño de construcción', en: 'Construction size' },
      re_bedrooms: { es: 'Habitaciones', en: 'Bedrooms' },
      re_bathrooms: { es: 'Baños', en: 'Bathrooms' },
      re_parking: { es: 'Estacionamientos', en: 'Parking' },
      re_highlights: { es: 'Puntos destacados', en: 'Highlights' },
      re_location_reference: { es: 'Referencia de ubicación', en: 'Location reference' },
      re_cta: { es: 'CTA de la propiedad', en: 'Property CTA' },
    }

    for (const [key, labels] of Object.entries(fieldLabels)) {
      const val = product[key]
      if (val === null || val === undefined || val === '' || val === false) continue
      if (Array.isArray(val) && val.length === 0) continue
      const label = labels[language]
      const display = Array.isArray(val) ? val.join(', ') : String(val)
      prodLines.push(`${label}: ${display}`)
    }

    // Guarantee
    if (product.has_guarantee || product.svc_has_guarantee) {
      const details = product.guarantee_details || product.svc_guarantee_details
      prodLines.push(`${isEs ? 'Garantía' : 'Guarantee'}: ${isEs ? 'Sí' : 'Yes'}${details ? ` — ${details}` : ''}`)
    }

    // Success cases
    if (product.success_cases && product.success_cases.length > 0) {
      prodLines.push(`\n${isEs ? 'CASOS DE ÉXITO:' : 'SUCCESS CASES:'}`)
      product.success_cases.forEach((sc, i) => {
        prodLines.push(`  ${isEs ? 'Caso' : 'Case'} ${i + 1}${sc.client_name ? ` (${sc.client_name})` : ''}:`)
        prodLines.push(`    ${isEs ? 'Antes' : 'Before'}: ${sc.before_state}`)
        prodLines.push(`    ${isEs ? 'Qué hizo' : 'What they did'}: ${sc.what_they_did}`)
        prodLines.push(`    ${isEs ? 'Resultado' : 'Result'}: ${sc.result}`)
        prodLines.push(`    ${isEs ? 'Tiempo' : 'Timeline'}: ${sc.timeline}`)
        prodLines.push(`    ${isEs ? 'Cambio' : 'Life change'}: ${sc.life_change}`)
      })
    }

    sections.push(prodLines.join('\n'))
  }

  if (sections.length === 0) return ''

  const header = isEs
    ? '\n\n===================================================================\nCONTEXTO DEL NEGOCIO Y PRODUCTO\n==================================================================='
    : '\n\n===================================================================\nBUSINESS AND PRODUCT CONTEXT\n==================================================================='

  return header + '\n\n' + sections.join('\n\n---\n\n')
}

function buildScriptSettingsPrompt(settings: ScriptSettings | undefined, language: 'en' | 'es'): string {
  if (!settings) return ''

  // By-type mode: explicit per-type instructions
  if (settings.generationMode === 'by_type' && settings.scriptTypeConfig) {
    const typeLabels: Record<string, { es: string; en: string }> = {
      venta_directa: { es: 'Venta Directa', en: 'Direct Sale' },
      desvalidar_alternativas: { es: 'Desvalidar Alternativas', en: 'Invalidate Alternatives' },
      mostrar_servicio: { es: 'Mostrar el Servicio/Producto', en: 'Show Service/Product' },
      variedad_productos: { es: 'Variedad de Productos (Beneficios)', en: 'Product Variety (Benefits)' },
      paso_a_paso: { es: 'Paso a Paso', en: 'Step by Step' },
      reconocimiento: { es: 'Reconocimiento (TOF / Branding)', en: 'Brand Awareness (TOF / Branding)' },
      educativo: { es: 'Educativo (organico)', en: 'Educational (organic)' },
      storytelling: { es: 'Storytelling (organico)', en: 'Storytelling (organic)' },
      tendencia: { es: 'Tendencia (organico)', en: 'Trending (organic)' },
      engagement: { es: 'Engagement (organico)', en: 'Engagement (organic)' }
    }

    const config = settings.scriptTypeConfig
    const total = Object.values(config).reduce((s, n) => s + n, 0)
    const reconocimientoCount = config.reconocimiento ?? 0
    const otherCount = Object.entries(config).filter(([k]) => k !== 'reconocimiento').reduce((s, [, n]) => s + n, 0)
    const isOnlyReconocimiento = reconocimientoCount > 0 && otherCount === 0

    // Special handling for reconocimiento-only: reinforce emotional motor variation + story format
    if (isOnlyReconocimiento) {
      if (language === 'es') {
        return `\n\n⚠️ REQUISITOS OBLIGATORIOS PARA ESTA GENERACIÓN:
- CANTIDAD TOTAL: Genera EXACTAMENTE ${reconocimientoCount} guión(es) de reconocimiento de marca (micro-historias). NI MÁS NI MENOS.
- MOTOR EMOCIONAL: Cada guión DEBE tener un motor emocional DIFERENTE. No repitas la misma emoción o enfoque.
- FORMATO: Cada guión debe usar el formato "GUIÓN #[N] — [Título breve]" seguido del guion completo.
- DURACIÓN: Cada guión debe durar 20–45 segundos al ser dicho en voz alta.
- NO incluyas CTA, ni beneficios, ni estructura de anuncio. Solo micro-historias.`
      } else {
        return `\n\n⚠️ MANDATORY REQUIREMENTS FOR THIS GENERATION:
- TOTAL QUANTITY: Generate EXACTLY ${reconocimientoCount} brand awareness script(s) (micro-stories). NO MORE, NO LESS.
- EMOTIONAL MOTOR: Each script MUST have a DIFFERENT emotional motor. Do not repeat the same emotion or approach.
- FORMAT: Each script must use the format "SCRIPT #[N] — [Brief title]" followed by the full script.
- DURATION: Each script should be 20–45 seconds when spoken aloud.
- Do NOT include CTAs, benefits, or ad structure. Only micro-stories.`
      }
    }

    const parts: string[] = []

    for (const [key, count] of Object.entries(config)) {
      if (count > 0) {
        const label = typeLabels[key]?.[language] || key
        parts.push(language === 'es'
          ? `- ${count} guión(es) de tipo "${label}"`
          : `- ${count} "${label}" script(s)`)
      }
    }

    if (language === 'es') {
      return `\n\n⚠️ REQUISITOS OBLIGATORIOS PARA ESTA GENERACIÓN:
- CANTIDAD TOTAL: Genera EXACTAMENTE ${total} guión(es). NI MÁS NI MENOS.
- TIPOS ESPECÍFICOS SOLICITADOS:
${parts.join('\n')}
- Cada guión debe estar claramente etiquetado con su tipo (ej: "OPCIÓN #1 - Venta Directa").
- Si se piden múltiples guiones del mismo tipo, varía el enfoque/gancho entre ellos.
- Cada guión debe usar un mecanismo de gancho distinto cuando sea posible: miedo de compra, lista/opciones, prueba, proceso, precio/ubicación, comparación o logística.
- Cada guión comercial debe incluir minimo 4 detalles concretos del contexto o placeholders especificos si faltan datos.
- Prohibido entregar frases genericas sin prueba inmediata: "alta calidad", "mejor servicio", "solucion ideal", "rapido y facil".`
    } else {
      return `\n\n⚠️ MANDATORY REQUIREMENTS FOR THIS GENERATION:
- TOTAL QUANTITY: Generate EXACTLY ${total} script(s). NO MORE, NO LESS.
- SPECIFIC TYPES REQUESTED:
${parts.join('\n')}
- Each script must be clearly labeled with its type (e.g., "OPTION #1 - Direct Sale").
- If multiple scripts of the same type are requested, vary the approach/hook between them.
- Each script should use a different hook mechanism when possible: buyer fear, list/options, proof, process, price/location, comparison, or logistics.
- Each commercial script must include at least 4 concrete context details or specific placeholders if facts are missing.
- Forbidden to deliver generic phrases without immediate proof: "high quality", "best service", "ideal solution", "fast and easy".`
    }
  }

  // Mixed mode: just count
  const variationInstruction = language === 'es'
    ? `\n\n⚠️ REQUISITOS OBLIGATORIOS PARA ESTA GENERACIÓN:
- CANTIDAD: Genera EXACTAMENTE ${settings.variations} guión(es). NI MÁS NI MENOS.
- No repitas el mismo tipo de gancho. Elige los angulos mas fuertes segun el contexto: venta directa, miedo de compra, comparacion, lista/opciones, proceso, prueba social, logistica o precio/ubicacion.
- Cada guión comercial debe incluir minimo 4 detalles concretos del negocio/producto o placeholders especificos si faltan datos.
- Antes de responder, elimina cualquier guion que suene generico y reescribelo con mas hechos.`
    : `\n\n⚠️ MANDATORY REQUIREMENTS FOR THIS GENERATION:
- QUANTITY: Generate EXACTLY ${settings.variations} script(s). NO MORE, NO LESS.
- Do not repeat the same hook type. Choose the strongest angles from the context: direct sale, buyer fear, comparison, list/options, process, social proof, logistics, or price/location.
- Each commercial script must include at least 4 concrete business/product details or specific placeholders if facts are missing.
- Before answering, remove any script that sounds generic and rewrite it with more facts.`
  
  return variationInstruction
}

function buildContextDocumentsPrompt(docs: ContextDocumentData[] | undefined, language: 'en' | 'es'): string {
  if (!docs || docs.length === 0) return ''

  const header = language === 'es'
    ? `\n\n===================================================================
DOCUMENTOS DE CONTEXTO ADICIONAL
===================================================================
El usuario ha proporcionado los siguientes documentos/enlaces como contexto adicional para la generación de guiones. USA esta información para enriquecer y personalizar los guiones:`
    : `\n\n===================================================================
ADDITIONAL CONTEXT DOCUMENTS
===================================================================
The user has provided the following documents/links as additional context for script generation. USE this information to enrich and personalize the scripts:`

  const docsContent = docs.map((doc, i) => {
    const docType = doc.type === 'link' 
      ? (language === 'es' ? 'Enlace web' : 'Web link')
      : doc.type === 'pdf'
        ? (language === 'es' ? 'Documento PDF' : 'PDF Document')
        : (language === 'es' ? 'Texto' : 'Text')
    
    return `
--- ${docType}: ${doc.name} ---
${doc.content || '(Sin contenido / No content)'}
${doc.url ? `URL: ${doc.url}` : ''}`
  }).join('\n')

  return `${header}\n${docsContent}`
}

const DESCRIPTION_PROMPTS = {
  es: `ACTÚA COMO: Especialista en descripciones para anuncios y posts en Instagram y Facebook, optimizadas para el algoritmo de Meta.

IMPORTANTE: Siempre responde en Español.

===================================================================
TU MISIÓN
===================================================================
Escribir descripciones para anuncios y posts de venta en Instagram y Facebook.
Estas NO son guiones. Son el texto (caption) que acompaña al anuncio o post.

===================================================================
OBJETIVO PRINCIPAL: OPTIMIZACIÓN PARA EL ALGORITMO DE META
===================================================================
La descripción debe estar cargada de PALABRAS CLAVE que ayuden a la IA de Meta (Instagram y Facebook) a entender con precisión:
- QUÉ se está vendiendo (producto/servicio, categoría, tipo)
- A QUIÉN se le está vendiendo (perfil del cliente ideal)
- DÓNDE se vende (ubicación, alcance, envío)
- CÓMO se compra (proceso, método de contacto)
- POR QUÉ es diferente (diferenciadores, beneficios clave)

El algoritmo de Meta usa el texto de la descripción para categorizar el anuncio y mostrarlo a las personas correctas. Cuanto más contexto semántico tenga la descripción, mejor segmentará Meta el anuncio.

===================================================================
REGLAS INQUEBRANTABLES
===================================================================
1. La descripción NO puede ser igual ni parecida al guión base. Debe ser contenido completamente diferente.
2. NO usar hashtags. Están prohibidos en anuncios pagados de Meta.
3. Debe incluir un llamado a la acción claro y directo.
4. Incluir palabras clave de la categoría, el producto, el problema que resuelve, la ubicación y el público objetivo.
5. Escribir de forma natural y fluida — no una lista de keywords. Las palabras clave deben integrarse orgánicamente en frases con sentido.
6. Máximo 200 palabras por variación.
7. NO uses emojis excesivos. Máximo 2-3 solo si aportan.
8. Estructura limpia con saltos de línea para fácil lectura.

===================================================================
FORMATO DE ENTREGA
===================================================================
Genera 4 variaciones, cada una con un enfoque distinto:

**VARIACIÓN 1 — INFORMATIVA + KEYWORDS**
Descripción directa y rica en contexto. Menciona categoría, producto, beneficios, ubicación y método de compra. Optimizada para que la IA de Meta entienda exactamente qué se ofrece.

**VARIACIÓN 2 — PROBLEMA → SOLUCIÓN**
Describe el problema del cliente ideal y posiciona el producto/servicio como la solución. Usa palabras que el público objetivo buscaría o con las que se identificaría.

**VARIACIÓN 3 — PROPUESTA DE VALOR**
Enfócate en los diferenciadores y beneficios tangibles. Explica por qué elegir este producto/servicio sobre las alternativas. Rico en contexto de categoría.

**VARIACIÓN 4 — SOCIAL PROOF + ACCIÓN**
Usa estructura de resultado, transformación o caso de éxito. Incluye un CTA fuerte y claro.

===================================================================
INSTRUCCIONES
===================================================================
Usa TODA la información del negocio y producto/servicio proporcionada para crear descripciones que:
1. Le den al algoritmo de Meta el máximo contexto posible sobre lo que se vende
2. Sean completamente diferentes al guión base
3. Incluyan un llamado a la acción en cada variación
4. Funcionen como texto de anuncio pagado (no como caption orgánico)`,

  en: `ACT AS: Specialist in descriptions for Instagram and Facebook ads and posts, optimized for Meta's algorithm.

IMPORTANT: Always respond in English.

===================================================================
YOUR MISSION
===================================================================
Write descriptions for Instagram and Facebook sales ads and posts.
These are NOT scripts. They are the text (caption) that accompanies the ad or post.

===================================================================
PRIMARY GOAL: OPTIMIZATION FOR META'S ALGORITHM
===================================================================
The description must be loaded with KEYWORDS that help Meta's AI (Instagram and Facebook) precisely understand:
- WHAT is being sold (product/service, category, type)
- WHO it's being sold to (ideal customer profile)
- WHERE it's sold (location, reach, shipping)
- HOW to buy (process, contact method)
- WHY it's different (differentiators, key benefits)

Meta's algorithm uses the description text to categorize the ad and show it to the right people. The more semantic context the description has, the better Meta will target the ad.

===================================================================
UNBREAKABLE RULES
===================================================================
1. The description must NOT be the same as or similar to the base script. It must be completely different content.
2. Do NOT use hashtags. They are prohibited in Meta paid ads.
3. Must include a clear, direct call to action.
4. Include keywords about the category, product, problem it solves, location, and target audience.
5. Write naturally and fluently — not a keyword list. Keywords must be organically integrated into meaningful sentences.
6. Maximum 200 words per variation.
7. Do NOT use excessive emojis. Maximum 2-3 only if they add value.
8. Clean structure with line breaks for easy reading.

===================================================================
DELIVERY FORMAT
===================================================================
Generate 4 variations, each with a different approach:

**VARIATION 1 — INFORMATIVE + KEYWORDS**
Direct, context-rich description. Mention category, product, benefits, location, and purchase method. Optimized so Meta's AI understands exactly what's being offered.

**VARIATION 2 — PROBLEM → SOLUTION**
Describe the ideal customer's problem and position the product/service as the solution. Use words the target audience would search for or identify with.

**VARIATION 3 — VALUE PROPOSITION**
Focus on differentiators and tangible benefits. Explain why to choose this product/service over alternatives. Rich in category context.

**VARIATION 4 — SOCIAL PROOF + ACTION**
Use result, transformation, or success story structure. Include a strong, clear CTA.

===================================================================
INSTRUCTIONS
===================================================================
Use ALL provided business and product/service information to create descriptions that:
1. Give Meta's algorithm maximum possible context about what's being sold
2. Are completely different from the base script
3. Include a call to action in each variation
4. Work as paid ad text (not organic caption)`
}

async function buildScriptTemplatesPrompt(
  userId: string,
  templateIds: string[] | undefined,
  language: 'en' | 'es'
): Promise<string> {
  if (!templateIds || templateIds.length === 0 || !memorySupabase) return ''

  try {
    const { data: templates, error } = await memorySupabase
      .from('script_templates')
      .select('name, content')
      .eq('user_id', userId)
      .in('id', templateIds.slice(0, 10))
      .eq('is_active', true)

    if (error || !templates || templates.length === 0) return ''

    const isEs = language === 'es'
    const header = isEs
      ? `\n\n===================================================================
PLANTILLAS DE GUIONES GANADORES (REFERENCIA)
===================================================================
El usuario ha guardado los siguientes guiones como ejemplos ganadores.
ESTUDIA su estructura, ritmo, ganchos, desarrollo y CTAs.
INSPÍRATE en estos patrones para generar guiones con calidad similar.
NO copies los guiones textualmente — adapta la estructura y estilo al producto/servicio actual.`
      : `\n\n===================================================================
WINNING SCRIPT TEMPLATES (REFERENCE)
===================================================================
The user has saved the following scripts as winning examples.
STUDY their structure, rhythm, hooks, development and CTAs.
BE INSPIRED by these patterns to generate scripts of similar quality.
Do NOT copy the scripts verbatim — adapt the structure and style to the current product/service.`

    const templatesText = templates.map((t, i) => {
      return `\n--- ${isEs ? 'Plantilla' : 'Template'} ${i + 1}: ${t.name} ---\n${t.content}`
    }).join('\n')

    return header + templatesText
  } catch (e) {
    console.warn('Failed to load script templates:', e)
    return ''
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify user authentication
  const user = await requireAuth(req, res)
  if (!user) return // Response already sent by requireAuth

  // Rate limit: 20 requests per 60 seconds per user
  const rateCheck = checkRateLimit(user.id, { maxRequests: 20, windowSeconds: 60 })
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Demasiadas solicitudes',
      message: `Por favor espera ${rateCheck.resetInSeconds} segundos antes de intentar de nuevo.`,
      retryAfter: rateCheck.resetInSeconds
    })
  }

  // Determine usage action: 'description' if feature param says so, otherwise 'script'
  const usageAction: 'script' | 'description' = req.body?.feature === 'description' ? 'description' : 'script'

  // Check usage limits
  const { allowed, remaining, limit } = await checkUsageLimit(user.id, usageAction)
  if (!allowed) {
    const label = usageAction === 'description' ? 'descripciones' : 'scripts'
    return res.status(429).json({ 
      error: `Límite de ${label} alcanzado`,
      message: `Has alcanzado el límite de ${limit} ${label} este mes. Actualiza tu plan para continuar.`,
      limit,
      remaining: 0
    })
  }

  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body is required' })
    }

    const { messages, businessDetails, businessContext, productContext, language = 'en', scriptSettings, contextDocuments, activeSalesChannel } = req.body as RequestBody

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' })
    }

    if (!['en', 'es'].includes(language)) {
      return res.status(400).json({ error: 'Language must be "en" or "es"' })
    }

    // Chat-shell: when sessionId is present, bind generation to that session's offer/product.
    // Require productId — one offer per call; client sequences up to five.
    // Legacy /scripts callers omit sessionId and keep prior behavior.
    const rawSessionId = (req.body as { sessionId?: unknown }).sessionId
    let authoritativeProductId: string | undefined
    if (rawSessionId != null && rawSessionId !== '') {
      if (!isUuid(rawSessionId)) {
        return res.status(400).json({ error: 'Invalid sessionId' })
      }
      const clientProductId = (req.body as { productId?: unknown }).productId
      if (typeof clientProductId !== 'string' || !clientProductId) {
        return res.status(400).json({
          error: 'productId is required',
          message: 'Chat-shell generation requires sessionId + productId for one offer.',
        })
      }
      const access = await resolveAuthorizedSessionProduct(
        user.id,
        rawSessionId,
        clientProductId
      )
      if (!access.ok) {
        return res.status(access.status).json({ error: access.error })
      }
      // Authoritative product from server-side session+offers — ignore spoofed brand fields for authz.
      authoritativeProductId = access.productId
    } else {
      // Legacy path: if productId provided, require product access (cheap hardening).
      const legacyProductId = (req.body as { productId?: unknown }).productId
      if (typeof legacyProductId === 'string' && legacyProductId) {
        if (!isUuid(legacyProductId)) {
          return res.status(400).json({ error: 'Invalid productId' })
        }
        if (!(await userHasProductAccess(user.id, legacyProductId))) {
          return res.status(403).json({ error: 'No access to product' })
        }
        authoritativeProductId = legacyProductId
      }
    }

    const MAX_MESSAGE_LENGTH = 50_000
    for (const msg of messages) {
      if (!msg.content || typeof msg.content !== 'string') {
        return res.status(400).json({ error: 'Each message must have a string content' })
      }
      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` })
      }
    }

    if (businessDetails && typeof businessDetails !== 'object') {
      return res.status(400).json({ error: 'businessDetails must be an object' })
    }

    const grokApiKey = process.env.GROK_API_KEY
    if (!grokApiKey) {
      return res.status(500).json({ error: 'Grok API key not configured' })
    }

    const contextDocsPrompt = buildContextDocumentsPrompt(contextDocuments, language)
    
    const feature = req.body.feature as string | undefined
    const productType = req.body.productType
    let basePrompt: string
    let settingsPrompt = ''

    // Check if reconocimiento scripts are requested (hoisted for use in businessRules suppression)
    const hasReconocimiento = scriptSettings?.generationMode === 'by_type' && (scriptSettings?.scriptTypeConfig?.reconocimiento ?? 0) > 0
    const onlyReconocimiento = hasReconocimiento && Object.entries(scriptSettings?.scriptTypeConfig ?? {}).every(([k, v]) => k === 'reconocimiento' || v === 0)

    // Detect organic-only vs organic-mixed runs.
    const cfg = scriptSettings?.scriptTypeConfig ?? ({} as Record<string, number>)
    const byType = scriptSettings?.generationMode === 'by_type'
    const hasAnyOrganic = byType && ORGANIC_FRAMEWORKS.some(k => (cfg as Record<string, number | undefined>)[k] && ((cfg as Record<string, number | undefined>)[k] ?? 0) > 0)
    const onlyOrganic = byType && hasAnyOrganic && Object.entries(cfg).every(([k, v]) => isOrganicKey(k) || (v ?? 0) === 0)
    const mixedOrganic = byType && hasAnyOrganic && !onlyOrganic

    // Effective CTA strength — organic-only defaults to 'soft' if the user didn't pick one; sales defaults to 'sales'.
    const effectiveCTAStrength: CTAStrength = scriptSettings?.ctaStrength
      ?? (onlyOrganic ? 'soft' : 'sales')

    // When CTA is NOT sales, suppress the aggressive channel-CTA rules in buildBusinessRulesPrompt.
    const suppressBusinessCTA = effectiveCTAStrength !== 'sales' || onlyReconocimiento

    if (feature === 'description') {
      basePrompt = DESCRIPTION_PROMPTS[language]
    } else {
      if (onlyReconocimiento) {
        basePrompt = RECONOCIMIENTO_PROMPTS[language]
      } else if (onlyOrganic) {
        // All requested types are organic — replace sales master with organic master.
        basePrompt = ORGANIC_MASTER_PROMPT[language]
      } else {
        basePrompt = MASTER_PROMPTS[language]

        if (productType === 'restaurant') {
          basePrompt = RESTAURANT_PROMPTS[language]
        } else if (productType === 'real_estate') {
          basePrompt = REAL_ESTATE_PROMPTS[language]
        } else if (productType === 'service') {
          basePrompt = SERVICE_PROMPTS[language]
        } else if (productType === 'indumentaria') {
          basePrompt = INDUMENTARIA_PROMPTS[language]
        }
      }

      settingsPrompt = buildScriptSettingsPrompt(scriptSettings, language)
    }

    // Build structured prompt sections from new businessContext/productContext
    const businessRulesPrompt = buildBusinessRulesPrompt(businessContext, language, activeSalesChannel, suppressBusinessCTA)
    const productRulesPrompt = buildProductRulesPrompt(productContext, language)
    const structuredContextPrompt = buildStructuredContext(businessContext, productContext, language)
    // Legacy fallback: if no structured context, use old businessDetails JSON dump
    let legacyContextPrompt = ''
    if (!businessContext && !productContext) {
      const cleanBusinessDetails = Object.fromEntries(
        Object.entries(businessDetails || {}).filter(([, v]) => {
          if (v === null || v === undefined || v === '') return false
          if (Array.isArray(v) && v.length === 0) return false
          return true
        })
      )
      if (Object.keys(cleanBusinessDetails).length > 0) {
        legacyContextPrompt = `\n\nCurrent business context:\n${JSON.stringify(cleanBusinessDetails, null, 2)}`
      }
    }

    // Build style memory prompt from hybrid AI memory system
    const productId = authoritativeProductId ?? (req.body.productId as string | undefined)
    const aiMemoryEnabled = req.body.aiMemoryEnabled !== false
    let styleMemoryPrompt = ''
    if (aiMemoryEnabled) {
      try {
        styleMemoryPrompt = await getMemoryInjection(
          user.id,
          productId || null,
          language as 'es' | 'en'
        )
        if (styleMemoryPrompt) {
          styleMemoryPrompt = '\n\n' + styleMemoryPrompt
        }
      } catch (e) {
        console.warn('Failed to load style memory:', e)
      }
    }

    // Brand Kit: inject brand voice if active
    const brandKitId = req.body.brandKitId as string | undefined
    let brandVoicePrompt = ''
    let resolvedBrandKit: Awaited<ReturnType<typeof resolveBrandKit>> = null
    try {
      resolvedBrandKit = await resolveBrandKit(user.id, brandKitId)
      if (resolvedBrandKit) {
        const bv = buildBrandVoicePrompt(resolvedBrandKit, language as 'es' | 'en')
        if (bv) brandVoicePrompt = '\n\n' + bv
      }
    } catch { /* ignore */ }

    // Script Templates: inject winning script references if active
    const scriptTemplateIds = req.body.scriptTemplateIds as string[] | undefined
    let scriptTemplatesPrompt = ''
    if (feature !== 'description') {
      try {
        scriptTemplatesPrompt = await buildScriptTemplatesPrompt(user.id, scriptTemplateIds, language as 'es' | 'en')
      } catch (e) {
        console.warn('Failed to build script templates prompt:', e)
      }
    }

    // Organic content layer: inject framework-specific rules + CTA strength control.
    // - onlyOrganic: append the single active framework's rules (for clarity / reinforcement).
    // - mixedOrganic: append per-framework override blocks so organic scripts don't inherit sales DNA.
    // - CTA strength: injected for any non-'sales' strength (including sales runs where the user picked 'soft').
    let organicRulesPrompt = ''
    if (feature !== 'description') {
      if (onlyOrganic) {
        const activeOrganic = ORGANIC_FRAMEWORKS.filter(k => ((cfg as Record<string, number | undefined>)[k] ?? 0) > 0)
        if (activeOrganic.length > 0) {
          const header = language === 'es'
            ? '\n\n===================================================================\nREGLAS ESPECÍFICAS POR TIPO DE GUIÓN ORGÁNICO\n==================================================================='
            : '\n\n===================================================================\nTYPE-SPECIFIC ORGANIC SCRIPT RULES\n==================================================================='
          organicRulesPrompt = header + '\n' + activeOrganic.map(t => ORGANIC_FRAMEWORK_RULES[t][language]).join('\n\n')
        }
      } else if (mixedOrganic) {
        const mixedCfg: Partial<Record<OrganicScriptFramework, number>> = {}
        for (const k of ORGANIC_FRAMEWORKS) {
          mixedCfg[k] = (cfg as Record<string, number | undefined>)[k] ?? 0
        }
        organicRulesPrompt = buildMixedOrganicOverrideBlock(mixedCfg, language)
      }
    }

    const ctaStrengthPrompt = feature === 'description' ? '' : buildCTAStrengthPrompt(effectiveCTAStrength, language)
    const winningScriptDnaPrompt = feature === 'description'
      ? ''
      : buildWinningScriptDnaPrompt({
          language,
          mode: onlyReconocimiento ? 'awareness' : onlyOrganic ? 'organic' : 'sales',
          business: businessContext,
          product: productContext,
          activeSalesChannel,
          ctaStrength: effectiveCTAStrength
        })

    const legacyBriefPrompt = feature === 'description' ? '' : LEGACY_SCRIPT_BRIEF_BLOCK[language]
    const systemPrompt = basePrompt + legacyBriefPrompt + structuredContextPrompt + legacyContextPrompt + businessRulesPrompt + productRulesPrompt + winningScriptDnaPrompt + styleMemoryPrompt + brandVoicePrompt + scriptTemplatesPrompt + organicRulesPrompt + ctaStrengthPrompt + settingsPrompt + contextDocsPrompt

    // Preview mode: return the prompt without calling the AI
    if (req.body.previewOnly) {
      return res.status(200).json({ preview: true, systemPrompt })
    }

    if (feature !== 'description' && scriptSettings?.useStructuredPipeline === true) {
      try {
        const structured = await runGuionesStructuredPipeline({
          apiKey: grokApiKey,
          businessContext: businessContext as Parameters<typeof runGuionesStructuredPipeline>[0]['businessContext'],
          productContext: productContext as Parameters<typeof runGuionesStructuredPipeline>[0]['productContext'],
          contextDocuments,
          activeSalesChannel,
          language,
          scriptSettings,
          styleMemoryPrompt,
          scriptTemplatesPrompt,
        })

        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: usageAction,
          model: GROK_TEXT_MODEL,
          inputTokens: estimateTokens(JSON.stringify(structured.contextProfile) + structured.promptPreview),
          outputTokens: estimateTokens(structured.content),
          success: true,
          metadata: {
            productType,
            variations: scriptSettings?.variations,
            structuredPipeline: true,
            briefs: structured.briefs.length,
          }
        })

        await incrementUsage(user.id, usageAction)

        return res.status(200).json({
          content: structured.content,
          remaining: remaining - 1,
          model: GROK_TEXT_MODEL,
          _debug: {
            systemPrompt: structured.promptPreview,
            contextProfile: structured.contextProfile,
            angleCandidates: structured.angleCandidates,
            briefs: structured.briefs,
            qualityReports: structured.qualityReports,
          }
        })
      } catch (structuredError) {
        console.warn('Structured guiones pipeline failed, falling back to legacy prompt:', structuredError)
      }
    }

    // =============================================
    // GROK API CALL
    // =============================================
    const grokMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))
    ]

    const chatModel = GROK_TEXT_MODEL

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${grokApiKey}`
      },
      body: JSON.stringify({
        model: chatModel,
        messages: grokMessages,
        temperature: 0.8,
        max_tokens: 4096
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Grok API error:', response.status, errorText)
      return res.status(response.status).json({ 
        error: `Grok API error: ${response.status}` 
      })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || 'No response generated'

    // Log Grok usage (use actual token counts from response if available)
    const usage = data.usage || {}
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: usageAction,
      model: chatModel,
      inputTokens: usage.prompt_tokens || estimateTokens(systemPrompt + messages.map(m => m.content).join('')),
      outputTokens: usage.completion_tokens || estimateTokens(content),
      success: true,
      metadata: { productType, variations: scriptSettings?.variations, brandKitId: resolvedBrandKit?.id, brandKitName: resolvedBrandKit?.name }
    })

    // Increment usage counter after successful generation
    await incrementUsage(user.id, usageAction)

    return res.status(200).json({ content, remaining: remaining - 1, model: chatModel, _debug: { systemPrompt } })
  } catch (error) {
    console.error('Chat API error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: usageAction,
      model: GROK_TEXT_MODEL,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    })
  }
}
