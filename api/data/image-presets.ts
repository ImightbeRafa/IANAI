// =============================================
// VENTA DIRECTA — Master Post Prompt
// Director de Arte + Diseñador Gráfico + Copywriter
// Built dynamically based on aspect ratio.
// CRITICAL: No pixel values, no dimension annotations — the AI renders them.
// =============================================
export type PostAspectRatio = '9:16' | '3:4'

function buildProductReferenceRoleRule(langLabel: string): string {
  return `========================================================================
REGLA #1 - REFERENCIAS VISUALES DEL PRODUCTO / OFERTA (MAXIMA PRIORIDAD)
========================================================================
Se adjuntan una o mas imagenes relacionadas con el producto/oferta real del usuario.

NO asumas automaticamente que todas las imagenes son el mismo objeto.
NO fusiones varias fotos en un producto hibrido.

Antes de disenar, clasifica mentalmente cada referencia:
- PRODUCTO HEROE: objeto vendible real, empaque, prenda, plato, dispositivo o set. Debe verse fiel a la foto.
- VARIANTE / SABOR / COLOR: otro item real de la misma linea. Mostrarlo separado o como lineup limpio, no mezclado.
- RESULTADO / PRUEBA / DETALLE: antes-despues, dientes, piel, textura, close-up, ingrediente, captura o evidencia. Usarlo como inset, panel de prueba, textura sutil o apoyo visual; no convertirlo en parte del empaque.
- CONTEXTO / ESTILO: escena, fondo, mood, lifestyle o composicion. Usarlo para ambiente y direccion de arte.

El post final debe tener UNA idea visual coherente: un heroe claro y referencias secundarias usadas solo en su rol correcto.
El idioma de cualquier texto visible sigue siendo ${langLabel}.
========================================================================

`
}

export function buildPostPrompt(aspectRatio: PostAspectRatio, language: string = 'es', hasProductImages: boolean = false): string {
  const isVertical = aspectRatio === '9:16'
  const formatLabel = isVertical ? 'vertical (story/reel)' : 'cuadrado (post de feed)'
  const layoutTip = isVertical
    ? 'La composición es alta y estrecha: headline arriba, bullets en el medio, CTA abajo. La imagen de fondo ocupa todo el canvas.'
    : 'La composición es casi cuadrada: headline arriba, bullets compactos, CTA abajo. Aprovechá el ancho para un layout más editorial con la imagen de producto al lado o como fondo.'

  const langLabel = language === 'es' ? 'ESPAÑOL' : 'ENGLISH'

  const langRule = `═══════════════════════════════════════════════
REGLA #0 — IDIOMA Y TEXTO (NO NEGOCIABLE)
═══════════════════════════════════════════════
- El idioma de TODOS los textos visibles en la imagen (headline, bullets, CTA, badges, sellos) DEBE ser: ${langLabel}.
- COPIA el texto del guión TAL CUAL está escrito — NO traduzcas, NO parafrasees, NO cambies el idioma.
- Si el guión está en español, TODO el texto del post DEBE estar en español.
- Si el guión está en inglés, TODO el texto del post DEBE estar en inglés.
- PROHIBIDO mezclar idiomas. PROHIBIDO usar texto placeholder o lorem ipsum.
- VIOLACIÓN DE ESTA REGLA = RESULTADO INVÁLIDO.
═══════════════════════════════════════════════

`

  const productRefRule = hasProductImages ? buildProductReferenceRoleRule(langLabel) : ''

  return `${langRule}${productRefRule}ACTÚA COMO: Director de Arte + Diseñador Gráfico Senior + Copywriter de Performance (venta directa). Tu única meta es crear un post que convierta.

CONTEXTO FIJO (NO PREGUNTAR NADA):
En tu contexto ya recibiste un guión escrito con esta estructura:
- [GANCHO]
- [DESARROLLO]
- [CTA]
Ese guión NO incluye instrucciones visuales. Vos debés inferirlas de forma inteligente.

OBJETIVO:
Transformar ese guión en UN (1) post publicitario de venta directa en un solo slide, formato ${formatLabel}, con:
1) Gancho (headline)
2) Desarrollo (bullets ultra tangibles)
3) CTA (acción única tipo botón)
Todo en el MISMO slide, con diseño profesional, legible y ordenado.
${layoutTip}

REGLAS DE COPY (PERFORMANCE):
- Cero saludos.
- 2–3 segundos de gancho (headline corto).
- No párrafos largos en el diseño.
- Convertí el [DESARROLLO] del guión a 3–5 bullets máximos.
- Cada bullet debe ser tangible: entrega, logística, garantía, tiempo, cobertura, pago, proceso, "qué recibís".
- Eliminá adjetivos vacíos ("premium", "alta calidad") si no vienen con evidencia. Si el guión trae adjetivos, aterrizalos a hechos.
- CTA debe ser UNO solo, directo, operativo. No mezclar acciones.

EXTRACCIÓN AUTOMÁTICA DESDE EL GUION (OBLIGATORIO):
1) Del [GANCHO] extraé:
   - Qué se vende (producto/servicio literal)
   - Público buyer (segmento implícito)
   - Función/propuesta principal (1 sola)
   - Ángulo/diferenciador (1) (garantía, entrega, rapidez, anti-alternativa, variedad, certeza)
2) Del [DESARROLLO] extraé y priorizá:
   - 3–5 hechos verificables (máximo) que eliminan dudas.
   - Si el guión menciona una alternativa/competidor (ej "supermercados"), convertí eso en 1 bullet de contraste máximo (sin explicar de más).
   - Si el guión menciona garantía, reposición, devolución o riesgo cero, eso va sí o sí como bullet.
3) Del [CTA] extraé:
   - Acción única (mensaje, WhatsApp, DM, pedir, agendar, cotizar)
   - Resultado inmediato (qué pasa después de que escribe)

REGLAS DE DISEÑO (CALIDAD VISUAL PRO):

MÁRGENES OBLIGATORIOS (ESTRICTO):
- Dejá un margen generoso arriba (aprox 12% del alto) libre de texto importante.
- Dejá un margen generoso abajo (aprox 14% del alto) libre de texto importante.
- Dejá márgenes laterales amplios (aprox 10% del ancho) sin texto importante.
Todo lo crítico (headline, bullets, CTA) debe quedar dentro de estas zonas seguras.
PROHIBIDO: texto pegado a bordes.
PROHIBIDO: número de slide (1/1, 2/2, etc.).
PROHIBIDO: mostrar dimensiones, medidas, píxeles, resolución o cualquier anotación técnica dentro de la imagen.

DIRECCIÓN DE ARTE (LOOK & FEEL PREMIUM) — ESTILO APPLE/IG/SPOTIFY:
El diseño debe verse como una marca grande: minimalista premium + editorial + quiet luxury.
Objetivo visual: aunque haya texto (headline + 3–5 bullets + CTA), el post se siente limpio, caro, ordenado y ultra intencional.

Reglas visuales (estrictas):
- No saturación: máximo 1 imagen principal + 1 badge opcional + texto + CTA.
- Mucho aire: espacios generosos entre bloques (headline / bullets / CTA).
- Alineación perfecta: todo basado en grid, márgenes consistentes, baseline visual estable.
- Consistencia: radios de esquina, sombras, grosor de líneas, estilos de badges e íconos coherentes.
- Cero "plantilla barata": NO bursts, NO stickers, NO íconos caricaturescos, NO flechas exageradas, NO emojis, NO outlines pesados.

GRID Y JERARQUÍA:
- Alineación principal: izquierda.
- Máximo 2 bloques de texto arriba/medio: (Headline + Bullets).
- CTA en una barra tipo "botón" al final (pero dentro del margen inferior seguro).
- Headline: 8–12 palabras ideal (máximo 14). Si el gancho es largo, reescribilo sin perder sentido.
- Bullets: 3–5. 1 línea cada uno (máximo 2 si es inevitable).
- Interlineado headline: compacto.
- Interlineado bullets: que respire y se lea bien.
- Espaciado vertical entre bullets: consistente, uniforme, "editorial".
- El texto debe ser legible en pantalla de celular.

TIPOGRAFÍA (SOLO 2 FAMILIAS) — APPLE-LIKE:
- Mantener solo 2 familias.
- Elegí tipografías sans de estética sistema / tech premium (estilo SF / Inter / Helvetica / Neue).
- Tracking levemente cerrado o neutro (evitar letras "infladas").
- Jerarquía fuerte: headline realmente domina; bullets limpios; CTA sólido.
PROHIBIDO: tipografías decorativas, condensadas extremas o "futuristas baratas".

COLOR SYSTEM (SOBRIO + 1 ACENTO) — ESTILO SPOTIFY/IG:
- Mantener: 1 color primario + 1 acento + neutrales.
- Paletas recomendadas:
  - Apple-like: blanco/negro/grises + acento mínimo.
  - Instagram-like: degradado MUY sutil y controlado (no arcoíris), solo como wash/overlay.
  - Spotify-like: base oscura + 1 acento vibrante controlado (solo para CTA o 1 palabra clave).
- El acento solo puede usarse para UNA de estas cosas: 1) Botón CTA o 2) Badge o 3) 1–3 palabras clave (NO usar el acento en todo a la vez si compite).
PROHIBIDO: múltiples acentos, fondos chillones, combinaciones neón sin control.

TRATAMIENTO DE IMAGEN (70–80% del post) — PRODUCT-LED:
- Calidad premium: iluminación limpia, sombras suaves, contraste controlado, recorte perfecto.
- Fondo limpio y moderno: sin ruido visual, sin elementos irrelevantes.
- Profundidad sutil: blur leve o separación por luz/sombra; nada agresivo.
- Overlay para texto: degradado suave, elegante, casi imperceptible (para legibilidad sin tapar el producto).
PROHIBIDO: filtros fuertes, HDR exagerado, texturas baratas, collages.

${hasProductImages
    ? `VISUAL (OBLIGATORIO: USAR LAS REFERENCIAS POR ROL):
Se te adjuntan referencias reales del producto/oferta. Primero identifica cual imagen muestra el producto heroe vendible y cuales muestran variantes, resultado, prueba, detalle, contexto o estilo.
- El producto heroe DEBE aparecer con apariencia REAL si existe una referencia clara (forma, color, textura, angulo, proporciones).
- Si hay variantes/sabores/colores, mostralos como items separados o lineup limpio; nunca los mezcles en un solo producto.
- Si hay resultado/prueba/detalle (ej. dientes, piel, close-up, ingrediente), usalo como inset, panel secundario, textura sutil o apoyo visual; no lo pegues encima del producto.
- NO generes un producto inventado. NO cambies silueta, proporciones ni detalles del producto real.
- Elegi una composicion coherente donde cada referencia cumple una funcion clara.`
    : `VISUAL (OBLIGATORIO: PRODUCTO/SERVICIO EN ACCIÓN, NO EN EXHIBICIÓN):
Como el guión no trae visuales, vos debés inferir la mejor escena que demuestre la función principal del guión.
Elegí UNA escena y construí la imagen alrededor:
- Si el guión habla de entrega/rutas/puerta: mostrar acción de entrega (mano recibiendo, caja/bolsa en puerta, timbre, etc.).
- Si el guión habla de frescura/punto perfecto: mostrar acción de uso (cortar/abrir/preparar/servir/comer).
- Si el guión habla de garantía/reposición: incluir un sello visual de garantía y una escena que refuerce "cero riesgo" (sin saturar).
- Si el guión compara contra alternativa (supermercado): que la escena muestre claramente el beneficio opuesto (producto intacto, bien seleccionado, listo para usar).`}

BULLETS CON MUCHA INFO — PERO QUE SE LEA "CARO" (NO REDUCIR PALABRAS):
- Los bullets deben ser escaneables:
  - iniciar con palabra clave (Entrega / Garantía / Pago / Tiempo / Cobertura / Proceso) y luego el dato.
  - usar separadores sutiles (•, —, |) solo si mejora lectura.
  - máximo 1–2 líneas por bullet, con espacio vertical constante.
- Checkmarks opcionales: si se usan, deben ser minimalistas, mismo grosor, mismo estilo, sin color fuerte (a menos que el acento sea exactamente para eso).

BADGE / SELLOS — QUIET LUXURY:
- Badge opcional solo si refuerza la promesa principal del guión.
- Estilo: pill o escudo minimalista, borde fino o relleno sutil.
- Texto en mayúsculas, corto, sin sombras duras.
- Nunca compite con headline ni con CTA.

CTA BOTÓN — SISTEMA / UI PREMIUM (OBLIGATORIO):
- Botón con radio consistente, sombra suave o borde fino.
- Alta legibilidad: texto grande, peso fuerte, sin efectos.
- Ícono del canal solo si aplica, en estilo lineal minimalista.
PROHIBIDO: brillos, biseles, contornos dobles, gradientes fuertes, estilos "baratos".

COMPOSICIÓN FINAL (RECOMENDADA):
- Área superior (dentro safe): Headline + badge (opcional).
- Área media: bullets (3–5) con checkmarks minimalistas opcional.
- Área inferior: botón CTA.
- Imagen de acción ocupa 70–80% del post, con overlay elegante donde haya texto.
- Nada debe quedar pegado al borde.

ENTREGABLE:
Generá el arte final (UNA imagen) del post, cumpliendo TODO:
- Headline + 3–5 bullets + CTA en un solo slide
- ${hasProductImages ? 'Visual basada en las referencias proporcionadas, usadas por rol y sin amalgamar imagenes distintas' : 'Visual en acción inferida inteligentemente del guión'}
- Márgenes generosos respetados estrictamente
- Dirección de arte premium (Apple/IG/Spotify) con mucho aire y coherencia visual
- Sin número de slide
- Sin texto tapable por la UI de Instagram
- NUNCA incluir anotaciones técnicas, dimensiones, píxeles o medidas visibles en la imagen

GUIÓN DEL USUARIO:
`
}

// =============================================
// SHARED QUALITY FOUNDATION
// Universal design rules extracted from Venta Directa,
// used by all preset types for consistent premium output.
// =============================================

function buildQualityFoundation(aspectRatio: PostAspectRatio, language: string, hasProductImages: boolean): {
  langRule: string
  productRefRule: string
  designRules: string
  visualRule: string
  deliverable: string
} {
  const isVertical = aspectRatio === '9:16'
  const langLabel = language === 'es' ? 'ESPAÑOL' : 'ENGLISH'
  const formatLabel = isVertical ? 'vertical (story/reel)' : 'cuadrado (post de feed)'

  const langRule = `═══════════════════════════════════════════════
REGLA #0 — IDIOMA Y TEXTO (NO NEGOCIABLE)
═══════════════════════════════════════════════
- El idioma de TODOS los textos visibles en la imagen (headline, etiquetas, CTA, badges, sellos) DEBE ser: ${langLabel}.
- COPIA el texto del guión TAL CUAL está escrito — NO traduzcas, NO parafrasees, NO cambies el idioma.
- PROHIBIDO mezclar idiomas. PROHIBIDO usar texto placeholder o lorem ipsum.
- VIOLACIÓN DE ESTA REGLA = RESULTADO INVÁLIDO.
═══════════════════════════════════════════════

`

  const productRefRule = hasProductImages ? buildProductReferenceRoleRule(langLabel) : ''

  const designRules = `REGLAS DE DISEÑO (CALIDAD VISUAL PRO):

MÁRGENES OBLIGATORIOS (ESTRICTO):
- Margen superior generoso (aprox 12% del alto) libre de texto importante.
- Margen inferior generoso (aprox 14% del alto) libre de texto importante.
- Márgenes laterales amplios (aprox 10% del ancho) sin texto importante.
Todo lo crítico debe quedar dentro de estas zonas seguras.
PROHIBIDO: texto pegado a bordes.
PROHIBIDO: número de slide (1/1, 2/2, etc.).
PROHIBIDO: mostrar dimensiones, medidas, píxeles, resolución o cualquier anotación técnica dentro de la imagen.

DIRECCIÓN DE ARTE (LOOK & FEEL PREMIUM) — ESTILO APPLE/IG/SPOTIFY:
El diseño debe verse como una marca grande: minimalista premium + editorial + quiet luxury.
Objetivo visual: el post se siente limpio, caro, ordenado y ultra intencional.

Reglas visuales (estrictas):
- No saturación visual: máximo 1 imagen principal + 1 badge opcional + texto + CTA.
- Mucho aire: espacios generosos entre bloques de contenido.
- Alineación perfecta: todo basado en grid, márgenes consistentes, baseline visual estable.
- Consistencia: radios de esquina, sombras, grosor de líneas, estilos de badges e íconos coherentes.
- Cero "plantilla barata": NO bursts, NO stickers, NO íconos caricaturescos, NO flechas exageradas, NO emojis, NO outlines pesados.

TIPOGRAFÍA (SOLO 2 FAMILIAS) — APPLE-LIKE:
- Mantener solo 2 familias tipográficas.
- Elegí tipografías sans de estética sistema / tech premium (estilo SF / Inter / Helvetica / Neue).
- Tracking levemente cerrado o neutro (evitar letras "infladas").
- Jerarquía fuerte: headline domina; cuerpo limpio; CTA sólido.
PROHIBIDO: tipografías decorativas, condensadas extremas o "futuristas baratas".

COLOR SYSTEM (SOBRIO + 1 ACENTO):
- Mantener: 1 color primario + 1 acento + neutrales.
- Si el usuario proporcionó una paleta de colores específica, USÁLA estrictamente. NO inventes otros colores.
- Si NO hay paleta, elegí colores sobrios y coherentes con estética premium.
- El acento solo puede usarse para UNA cosa: 1) Botón CTA o 2) Badge o 3) 1–3 palabras clave.
- NO uses colores hardcodeados de ninguna plantilla genérica. Respetá SIEMPRE la paleta del usuario si existe.
PROHIBIDO: múltiples acentos, fondos chillones, combinaciones neón sin control.

TRATAMIENTO DE IMAGEN — PRODUCT-LED:
- Calidad premium: iluminación limpia, sombras suaves, contraste controlado, recorte perfecto.
- Fondo limpio y moderno: sin ruido visual, sin elementos irrelevantes.
- Profundidad sutil: blur leve o separación por luz/sombra; nada agresivo.
- Overlay para texto: degradado suave, elegante, casi imperceptible (para legibilidad sin tapar el producto).
PROHIBIDO: filtros fuertes, HDR exagerado, texturas baratas, collages.

CTA BOTÓN — SISTEMA / UI PREMIUM (OBLIGATORIO):
- Botón con radio consistente, sombra suave o borde fino.
- Alta legibilidad: texto grande, peso fuerte, sin efectos.
PROHIBIDO: brillos, biseles, contornos dobles, gradientes fuertes, estilos "baratos".

BADGE / SELLOS — QUIET LUXURY:
- Badge opcional solo si refuerza la promesa principal.
- Estilo: pill o escudo minimalista, borde fino o relleno sutil.
- Texto en mayúsculas, corto, sin sombras duras.
- Nunca compite con headline ni con CTA.`

  const visualRule = hasProductImages
    ? `VISUAL - REFERENCIAS REALES (OBLIGATORIO):
Se te adjuntan referencias reales del producto/oferta. Usalas por rol, no como collage aleatorio.
- Producto heroe: apariencia real, fiel a la referencia.
- Variantes: items separados o lineup limpio.
- Resultado/prueba/detalle: inset, panel secundario, textura sutil o apoyo visual.
- Contexto/estilo: ambiente y direccion de arte.
- NO generes un producto inventado. NO mezcles varias referencias en un producto hibrido.`
    : `VISUAL — PRODUCTO/SERVICIO EN ACCIÓN:
Como el guión no trae visuales, inferí la mejor escena que demuestre la función principal del guión.
Elegí UNA escena relevante y construí la imagen alrededor del producto/servicio en uso real.
La escena debe sentirse auténtica, con contexto de uso real (no producto flotando en el vacío).`

  const deliverable = `ENTREGABLE:
Generá el arte final (UNA imagen) del post en formato ${formatLabel}, cumpliendo TODO:
- Márgenes generosos respetados estrictamente
- Dirección de arte premium (Apple/IG/Spotify) con mucho aire y coherencia visual
- Sin número de slide
- Sin texto tapable por la UI de Instagram
- NUNCA incluir anotaciones técnicas, dimensiones, píxeles o medidas visibles en la imagen

GUIÓN DEL USUARIO:
`

  return { langRule, productRefRule, designRules, visualRule, deliverable }
}

// =============================================
// PRESET LAYOUT DEFINITIONS
// Each preset's unique role, layout, content extraction, and composition.
// These get combined with buildQualityFoundation for the final prompt.
// =============================================

type PresetLayoutBuilder = (aspectRatio: PostAspectRatio, hasProductImages: boolean) => string

const PRESET_LAYOUT_BUILDERS: Record<string, PresetLayoutBuilder> = {

  'features-benefits': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const layoutTip = isVertical
      ? 'Composición vertical: producto arriba/centro, callouts distribuidos verticalmente alrededor.'
      : 'Composición cuadrada: producto a un lado, callouts al otro lado en columna limpia.'
    return `ACTÚA COMO: Director de Arte Senior especializado en layouts de Features & Benefits para publicidad de producto.

OBJETIVO:
Transformar el guión del usuario en UN (1) post estilo "Features & Benefits" — donde el producto es héroe visual y sus características/beneficios clave se señalan con etiquetas (callouts) elegantes.
${layoutTip}

LAYOUT ESPECÍFICO — FEATURES & BENEFITS:
- Producto como héroe visual central (60–70% del área), ligeramente descentrado para dar espacio a callouts.
- 3–4 etiquetas de llamada (callouts) con forma de rectángulo redondeado o pill, conectadas al producto por líneas finas o flechas minimalistas.
- Cada callout = 1 beneficio/característica extraído del guión, texto ultra conciso (máx 6–8 palabras).
- Headline corto arriba (extraído del gancho del guión).
- CTA tipo botón abajo.

EXTRACCIÓN DE CONTENIDO DESDE EL GUIÓN:
1) Del texto del usuario, identificá el PRODUCTO y sus 3–4 BENEFICIOS/CARACTERÍSTICAS principales.
2) Convertí cada beneficio en una etiqueta corta y concreta (ej: "Entrega en 24h", "Garantía 30 días", "100% orgánico").
3) El headline debe ser el gancho principal del guión, máximo 10 palabras.
4) CTA directo extraído del llamado a la acción del guión.

COMPOSICIÓN:
- Flechas/líneas: delgadas, minimalistas, mismo grosor, apuntando del callout al feature del producto.
- Callouts: todos del mismo tamaño, mismo estilo, alineados limpiamente.
- Íconos opcionales dentro de callouts: lineal, minimalista, coherentes entre sí.
- El producto debe tener iluminación premium, sombra sutil, recorte limpio.
- Headline arriba del producto, callouts alrededor, CTA abajo.`
  },

  'product-showcase': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const layoutTip = isVertical
      ? 'Composición vertical: producto grande arriba/centro, features listadas abajo.'
      : 'Composición cuadrada: producto a la izquierda/centro, features a la derecha o abajo.'
    return `ACTÚA COMO: Director de Arte Senior especializado en Product Showcase — exhibición limpia y aspiracional de producto.

OBJETIVO:
Transformar el guión del usuario en UN (1) post estilo "Product Showcase" — un layout limpio, editorial, donde el producto es la estrella absoluta con features clave destacadas.
${layoutTip}

LAYOUT ESPECÍFICO — PRODUCT SHOWCASE:
- El producto ocupa 65–80% del área visual, con iluminación de estudio premium.
- Headline aspiracional arriba (extraído del gancho del guión).
- 2–4 puntos de feature destacados en texto limpio, cada uno en 1 línea.
- CTA tipo botón al final.
- Fondo limpio, sin distracciones — puede ser degradado suave o color sólido.

EXTRACCIÓN DE CONTENIDO DESDE EL GUIÓN:
1) Identificá el producto y su propuesta de valor principal.
2) Extraé 2–4 características o beneficios clave del desarrollo del guión.
3) El headline debe transmitir el beneficio principal o diferenciador.
4) CTA directo del llamado a la acción.

COMPOSICIÓN:
- El producto debe verse premium: iluminación controlada, ángulo atractivo, sombra sutil.
- Features como texto limpio (no bullets pesados), tipografía más pequeña que el headline.
- Espaciado generoso entre producto, features y CTA.
- Sensación editorial de revista o catálogo de lujo.`
  },

  'social-proof': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const layoutTip = isVertical
      ? 'Composición vertical: producto arriba, testimonio/review abajo con tarjeta de cita.'
      : 'Composición cuadrada: split-screen — producto a la izquierda, testimonio a la derecha.'
    return `ACTÚA COMO: Director de Arte Senior especializado en Social Proof — diseño que genera confianza a través de testimonios y prueba social.

OBJETIVO:
Transformar el guión del usuario en UN (1) post estilo "Social Proof" — donde se combina el producto con un testimonio o review que genera confianza y credibilidad.
${layoutTip}

LAYOUT ESPECÍFICO — SOCIAL PROOF:
- Layout split-screen o apilado: un área para el producto, otra para el testimonio.
- Área de producto (40–50%): foto del producto con iluminación profesional.
- Área de testimonio (50–60%): tarjeta de cita con el testimonio extraído del guión.
- Calificación de estrellas (★★★★★) encima o debajo del testimonio.
- Nombre del "cliente" (inventar un nombre genérico apropiado si el guión no lo incluye).
- Foto de perfil circular placeholder para el cliente (generar una cara genérica profesional).
- CTA tipo botón al final.

EXTRACCIÓN DE CONTENIDO DESDE EL GUIÓN:
1) Del guión, extraé la frase más poderosa que suene como testimonio de cliente (beneficio experimentado, resultado obtenido).
2) Si el guión no tiene testimonio literal, convertí el beneficio principal en una cita en primera persona: "Desde que uso [producto], [resultado]..."
3) El headline debe reforzar la credibilidad (ej: "Lo que dicen nuestros clientes").
4) CTA del guión.

COMPOSICIÓN:
- La tarjeta de testimonio debe tener sombra suave, bordes redondeados, fondo ligeramente diferente al principal.
- Comillas sutiles (" ") decorativas alrededor del testimonio.
- Estrellas en color acento, estilo lineal o relleno sutil.
- El split debe sentirse equilibrado, ningún lado domina agresivamente.`
  },

  'comparison': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const layoutTip = isVertical
      ? 'Composición vertical: dos secciones apiladas con divisor VS en el medio.'
      : 'Composición cuadrada: dos columnas lado a lado con VS al centro.'
    return `ACTÚA COMO: Director de Arte Senior especializado en layouts de Comparación — diseño que contrasta opciones para resaltar el producto.

OBJETIVO:
Transformar el guión del usuario en UN (1) post estilo "Comparison" — un layout VS que contrasta el producto/servicio contra la alternativa, resaltando la superioridad.
${layoutTip}

LAYOUT ESPECÍFICO — COMPARISON:
- Layout dividido en 2 secciones iguales con elemento "VS" al centro (círculo con "VS" en texto bold).
- Sección izquierda: la ALTERNATIVA inferior (competidor, opción genérica, el "antes").
- Sección derecha: el PRODUCTO/SERVICIO del usuario (el ganador).
- Cada sección tiene: título corto + 3–4 puntos de comparación.
- Puntos positivos con checkmark (✓), puntos negativos con cruz (✗).
- El lado del producto del usuario debe verse visualmente superior (más luminoso, más limpio).
- CTA tipo botón al final, alineado con el lado ganador.

EXTRACCIÓN DE CONTENIDO DESDE EL GUIÓN:
1) Identificá qué se compara: producto vs competidor, servicio vs alternativa, antes vs después.
2) Del desarrollo del guión, extraé 3–4 puntos de contraste.
3) Para el lado "perdedor": reformulá como puntos negativos breves.
4) Para el lado "ganador" (el producto): reformulá como puntos positivos breves.
5) CTA del guión.

COMPOSICIÓN:
- Las dos secciones deben tener fondos ligeramente diferentes (sutil, no agresivo — ej: una más clara, otra más limpia).
- El elemento VS debe ser compacto, elegante, no exagerado.
- Checkmarks y cruces: minimalistas, mismo tamaño, color coherente.
- El lado ganador puede tener un badge sutil tipo "Mejor opción" o "Recomendado".`
  },

  'before-after': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const layoutTip = isVertical
      ? 'Composición vertical: "Antes" arriba, "Después" abajo, con transición visual en el medio.'
      : 'Composición cuadrada: "Antes" a la izquierda, "Después" a la derecha, con divisor central.'
    return `ACTÚA COMO: Director de Arte Senior especializado en layouts Before & After — diseño que muestra transformación y resultados.

OBJETIVO:
Transformar el guión del usuario en UN (1) post estilo "Before & After" — un layout que muestra claramente la transformación o mejora que ofrece el producto/servicio.
${layoutTip}

LAYOUT ESPECÍFICO — BEFORE & AFTER:
- Layout dividido en 2 secciones claras: ANTES y DESPUÉS.
- Etiquetas "Antes" / "Después" (o "Before" / "After" según idioma) sobre cada sección.
- Sección ANTES: visualización del problema, dolor o situación sin el producto. Tono más apagado.
- Sección DESPUÉS: visualización del resultado con el producto. Tono más brillante, aspiracional.
- Flecha sutil o línea de transición entre ambas secciones.
- Badge con resultado cuantificable si el guión lo menciona (ej: "+40%", "2x más rápido").
- Headline arriba que enmarque la transformación.
- CTA tipo botón al final.

EXTRACCIÓN DE CONTENIDO DESDE EL GUIÓN:
1) Identificá el PROBLEMA (antes) y el RESULTADO (después) del guión.
2) El headline debe capturar la transformación en una frase.
3) Si el guión menciona números o porcentajes, usálos en un badge prominente.
4) CTA del guión.

COMPOSICIÓN:
- El lado "Antes" puede tener un tono ligeramente desaturado o más frío.
- El lado "Después" debe verse más vibrante, limpio y premium.
- La transición debe ser elegante (línea diagonal, flecha minimalista, o degradado sutil).
- El contraste visual entre ambos lados debe ser evidente pero no exagerado.`
  },

  'collage': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const layoutTip = isVertical
      ? 'Composición vertical: grid de 3–4 paneles apilados o en disposición asimétrica vertical.'
      : 'Composición cuadrada: grid 2x2 o layout asimétrico con panel hero + paneles secundarios.'
    return `ACTÚA COMO: Director de Arte Senior especializado en layouts Collage — diseño multi-panel editorial y dinámico.

OBJETIVO:
Transformar el guión del usuario en UN (1) post estilo "Collage" — un layout multi-panel que muestra múltiples ángulos, beneficios o escenas del producto/servicio.
${layoutTip}

LAYOUT ESPECÍFICO — COLLAGE:
- 3–4 paneles distintos en disposición de grid o layout editorial asimétrico.
- 1 panel hero (más grande, ~50% del área) con el producto/escena principal.
- 2–3 paneles secundarios con: otro ángulo del producto, escena de uso/lifestyle, detalle close-up, o texto con beneficio clave.
- Headline superpuesto sobre el panel hero o en una franja dedicada.
- Cada panel puede tener una etiqueta corta (1–3 palabras) describiendo lo que muestra.
- CTA tipo botón al final o superpuesto en el panel inferior.

EXTRACCIÓN DE CONTENIDO DESDE EL GUIÓN:
1) Del guión, identificá 3–4 aspectos distintos del producto/servicio para mostrar en cada panel.
2) El headline viene del gancho principal del guión.
3) Cada panel secundario muestra un beneficio o ángulo diferente mencionado en el desarrollo.
4) CTA del guión.

COMPOSICIÓN:
- Los paneles deben tener separadores finos (2–4px) o estar separados por espacio blanco.
- Todos los paneles deben tener bordes redondeados consistentes.
- El panel hero domina visualmente, los secundarios complementan.
- Sensación de catálogo editorial premium, no collage desordenado de fotos.
- Colores coherentes entre paneles, iluminación consistente.`
  },

  'deals-discounts': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const layoutTip = isVertical
      ? 'Composición vertical: badge de descuento arriba, producto en el medio, CTA urgente abajo.'
      : 'Composición cuadrada: producto a un lado, info de oferta al otro, badge de descuento prominente.'
    return `ACTÚA COMO: Director de Arte Senior especializado en Deals & Discounts — diseño promocional que genera urgencia y destaca valor.

OBJETIVO:
Transformar el guión del usuario en UN (1) post estilo "Deals & Discounts" — un layout que destaque una oferta, descuento o promoción de forma impactante pero manteniendo estética premium.
${layoutTip}

LAYOUT ESPECÍFICO — DEALS & DISCOUNTS:
- Badge de descuento/oferta prominente (ej: "-30%", "2x1", "OFERTA") en esquina superior o posición llamativa.
- El badge debe ser grande, legible, con el color de acento (NO inventar colores propios).
- Producto como héroe visual central.
- Headline que comunica la oferta de forma directa y urgente.
- 2–3 puntos de valor (qué incluye, ahorro, beneficio de la oferta).
- CTA con urgencia ("Comprar ahora", "Solo hoy", "Últimas unidades").
- Elemento de urgencia visual si aplica (timer icon, "Tiempo limitado").

EXTRACCIÓN DE CONTENIDO DESDE EL GUIÓN:
1) Identificá la OFERTA específica del guión (descuento, precio, promoción, bundle).
2) El headline debe comunicar el ahorro o beneficio de la oferta de forma directa.
3) Extraé 2–3 razones de valor del desarrollo del guión.
4) CTA del guión, reforzando urgencia.

COMPOSICIÓN:
- El badge de descuento es el segundo punto focal después del headline (NO debe competir con CTA).
- Sensación de promoción premium, NO de liquidación barata.
- El diseño debe generar urgencia sin parecer spam o "gritón".
- Mantener estética limpia a pesar del contenido promocional.
- Contraste fuerte para el badge, pero integrado con la paleta general.`
  },

  'testimonial': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const layoutTip = isVertical
      ? 'Composición vertical: imagen de producto arriba, tarjeta de testimonio grande abajo.'
      : 'Composición cuadrada: split-screen — producto a un lado, tarjeta de testimonio prominente al otro.'
    return `ACTÚA COMO: Director de Arte Senior especializado en layouts de Testimonial — diseño centrado en la voz del cliente que genera confianza.

OBJETIVO:
Transformar el guión del usuario en UN (1) post estilo "Testimonial" — un layout donde el testimonio del cliente es el protagonista, acompañado del producto.
${layoutTip}

LAYOUT ESPECÍFICO — TESTIMONIAL:
- Tarjeta de testimonio como elemento principal (60% del área).
- La tarjeta incluye: comillas decorativas grandes, texto del testimonio, calificación 5 estrellas, nombre del cliente, foto circular del cliente.
- Producto visible pero secundario (30–40% del área), con iluminación premium.
- Headline corto arriba que enmarca la credibilidad (ej: "Resultados reales").
- CTA tipo botón al final.

EXTRACCIÓN DE CONTENIDO DESDE EL GUIÓN:
1) Convertí el beneficio principal del guión en un testimonio en primera persona: "Desde que [acción con el producto], [resultado positivo]...".
2) Si el guión ya contiene una cita o testimonio, usálo directamente.
3) El testimonio debe ser 2–3 oraciones máximo, impactante y específico.
4) Inventar un nombre genérico apropiado para el "cliente" (ej: "María G.", "Carlos R.").
5) CTA del guión.

COMPOSICIÓN:
- La tarjeta de testimonio debe tener: fondo ligeramente diferente, sombra suave, bordes redondeados.
- Comillas tipográficas grandes (" ") como elemento decorativo, en color de acento sutil.
- Estrellas en fila, estilo minimalista, color de acento.
- Foto de perfil circular con borde fino.
- El producto complementa pero no compite con la tarjeta de testimonio.
- Sensación de confianza y autenticidad, no de publicidad agresiva.`
  },
}

// =============================================
// PUBLIC API: Build dynamic preset prompt
// Combines shared quality foundation + preset-specific layout
// =============================================

export function buildPresetPrompt(
  presetId: string,
  aspectRatio: PostAspectRatio,
  language: string,
  hasProductImages: boolean
): string | null {
  const layoutBuilder = PRESET_LAYOUT_BUILDERS[presetId]
  if (!layoutBuilder) return null

  const { langRule, productRefRule, designRules, visualRule, deliverable } = buildQualityFoundation(aspectRatio, language, hasProductImages)
  const layout = layoutBuilder(aspectRatio, hasProductImages)

  return `${langRule}${productRefRule}${layout}

${visualRule}

${designRules}

${deliverable}`
}

// =============================================
// PRODUCT PHOTOGRAPHY — Sub-style Layout Builders
// Professional product photography without text overlays.
// Each sub-style targets a different visual treatment
// while preserving absolute product fidelity.
// =============================================

export type ProductSubStyle = 'studio-hero' | 'lifestyle' | 'background-swap' | 'pure-enhance' | 'splash-action' | 'podium'

type ProductLayoutBuilder = (aspectRatio: PostAspectRatio, backgroundDescription?: string) => string

function buildProductFoundation(
  aspectRatio: PostAspectRatio,
  originalAR?: string,
  hasReferenceImages = true
): string {
  const isVertical = aspectRatio === '9:16'
  const isSquare = originalAR === '1:1'
  const formatLabel = isSquare ? 'cuadrado (1:1)' : isVertical ? 'vertical (9:16)' : 'vertical (3:4)'

  const fidelityBlock = hasReferenceImages
    ? `Se adjuntan fotos del PRODUCTO REAL del usuario.
- El producto DEBE verse EXACTAMENTE como en las fotos de referencia: misma forma, silueta, color, textura, proporciones, detalles y acabados.
- NO inventes, NO rediseñes, NO reimagines, NO estilices el producto. Usa la referencia como fuente de verdad absoluta.
- NO cartoon, NO 3D fake, NO ilustración, NO vectorización. El resultado debe ser FOTORREALISTA.
- La forma del producto NO se modifica bajo ninguna circunstancia.`
    : `No hay fotos de referencia adjuntas.
- Generá el producto FOTORREALISTA descrito en CONTEXTO DEL PRODUCTO (nombre, categoría, descripción, oferta).
- Mostrá la forma real del producto (ej. lámina/plancha de parches, frasco, prenda) — NO una caja sellada genérica si la descripción no es una caja.
- Debe verse como foto de catálogo premium coherente con la marca y la oferta — NO cartel tipográfico, NO UI de app, NO texto "Generar post" ni "Professional product photograph".
- NO cartoon, NO 3D fake, NO ilustración. Fotografía real de producto.`

  return `═══════════════════════════════════════════════
REGLA ABSOLUTA — FIDELIDAD DEL PRODUCTO (NO NEGOCIABLE)
═══════════════════════════════════════════════
${fidelityBlock}
═══════════════════════════════════════════════

═══════════════════════════════════════════════
REGLA — CERO TEXTO EN LA IMAGEN (NO NEGOCIABLE)
═══════════════════════════════════════════════
- NO incluir NINGÚN texto, título, headline, subtítulo, CTA, botón, badge, sello, etiqueta, watermark o anotación.
- La imagen debe ser PURAMENTE VISUAL — solo el producto y su entorno/fondo.
- Si el producto tiene texto impreso (etiqueta, marca, packaging), ese texto SÍ se preserva tal cual.
- PROHIBIDO agregar cualquier elemento tipográfico que no sea parte física del producto.
═══════════════════════════════════════════════

FORMATO DE SALIDA: ${formatLabel}
CALIDAD: Fotografía profesional de producto, nivel catálogo / e-commerce premium / campaña de marca.
RESOLUCIÓN: Máxima calidad disponible, detalles nítidos, sin artefactos.

`
}

// =============================================
// PRODUCT PROMPT — Smart context & niche overlay
// Injects product intelligence into ANY sub-style so
// the AI adapts composition, props and lighting to the
// actual product (food, fashion, tech, beauty, etc.)
// =============================================

export interface ProductPromptContext {
  name?: string
  brandName?: string
  category?: string
  description?: string
  targetAudience?: string
  niche?: AnuncioNiche
  priceOffer?: string
  differentiation?: string
  market?: string
}

function buildProductContextBlock(ctx: ProductPromptContext | undefined, language: string): string {
  if (!ctx) return ''
  const hasAny = !!(ctx.name || ctx.brandName || ctx.category || ctx.description || ctx.targetAudience || ctx.niche || ctx.priceOffer || ctx.differentiation)
  if (!hasAny) return ''
  const isES = language === 'es'
  const lines: string[] = []
  if (ctx.brandName) lines.push(isES ? `- MARCA: ${ctx.brandName}` : `- BRAND: ${ctx.brandName}`)
  if (ctx.name) lines.push(isES ? `- PRODUCTO: ${ctx.name}` : `- PRODUCT: ${ctx.name}`)
  if (ctx.category) lines.push(isES ? `- CATEGORÍA: ${ctx.category}` : `- CATEGORY: ${ctx.category}`)
  if (ctx.description) lines.push(isES ? `- DESCRIPCIÓN: ${ctx.description.slice(0, 400)}` : `- DESCRIPTION: ${ctx.description.slice(0, 400)}`)
  if (ctx.priceOffer) lines.push(isES ? `- OFERTA / PRECIO: ${ctx.priceOffer.slice(0, 120)}` : `- OFFER / PRICE: ${ctx.priceOffer.slice(0, 120)}`)
  if (ctx.differentiation) lines.push(isES ? `- DIFERENCIADOR: ${ctx.differentiation.slice(0, 200)}` : `- DIFFERENTIATOR: ${ctx.differentiation.slice(0, 200)}`)
  if (ctx.targetAudience) lines.push(isES ? `- AUDIENCIA: ${ctx.targetAudience}` : `- AUDIENCE: ${ctx.targetAudience}`)
  if (ctx.market) lines.push(isES ? `- MERCADO: ${ctx.market}` : `- MARKET: ${ctx.market}`)
  if (ctx.niche) lines.push(isES ? `- NICHO DETECTADO: ${ctx.niche}` : `- DETECTED NICHE: ${ctx.niche}`)
  const header = isES
    ? '═══════════════════════════════════════════════\nCONTEXTO DEL PRODUCTO (USA ESTA INFORMACIÓN PARA CALIBRAR TODAS LAS DECISIONES VISUALES)\n═══════════════════════════════════════════════'
    : '═══════════════════════════════════════════════\nPRODUCT CONTEXT (USE THIS TO CALIBRATE EVERY VISUAL DECISION)\n═══════════════════════════════════════════════'
  const footer = isES
    ? 'Adaptá superficies, props, iluminación, paleta y mood a la naturaleza específica de este producto — NO uses defaults genéricos ni empaques/cajas que no correspondan a la descripción.'
    : 'Adapt surfaces, props, lighting, palette and mood to the specific nature of this product — do NOT use generic defaults or packaging/boxes that do not match the description.'
  return `${header}\n${lines.join('\n')}\n\n${footer}\n═══════════════════════════════════════════════\n\n`
}

function buildProductNicheOverlay(niche: AnuncioNiche | undefined, language: string): string {
  if (!niche) return ''
  const isES = language === 'es'
  const header = isES
    ? '═══════════════════════════════════════════════\nAJUSTE POR NICHO (SE APLICA SOBRE EL ESTILO BASE)\n═══════════════════════════════════════════════'
    : '═══════════════════════════════════════════════\nNICHE-SPECIFIC ADJUSTMENTS (LAYER ON TOP OF BASE STYLE)\n═══════════════════════════════════════════════'
  let body = ''
  if (isES) {
    switch (niche) {
      case 'food':
        body = `- Superficies coherentes con gastronomía: madera natural, mármol, lino crudo, cerámica rústica, tabla de pan.
- Temperatura cálida (golden/ámbar sutil). Micro-detalles de frescura: condensación, vapor, gotas, brillo en líquidos.
- 0–4 ingredientes complementarios como garnish visual — NUNCA saturar.
- Si es bebida/líquido: implicá frescura con condensación o vertido congelado.
- Evitar: fondos fríos estériles, iluminación neutra plana, props no relacionados con la cocina.`
        break
      case 'fashion':
        body = `- Texturas premium cerca del producto: tela con drape, cuero, mármol pulido, metal cepillado.
- Iluminación editorial (key angular + rim light), colores saturados pero controlados, negros profundos.
- Si aplica, mostrar micro-detalles: costura, textura de tejido, tacto visible.
- Mood aspiracional (referencias: Vogue, Net-a-Porter, SSENSE, Jacquemus).
- Evitar: fondos genéricos de estudio amateur, iluminación plana sin dirección, props de catálogo barato.`
        break
      case 'digital':
        body = `- Mostrar el producto digital dentro de un mockup FÍSICO real: laptop, tablet, smartphone con interfaz coherente.
- Entorno: escritorio aspiracional, espacio de trabajo limpio, luz de ventana o golden hour.
- Pantalla nítida, sin moiré, con resplandor realista (no artificial).
- Puede incluir devices secundarios o props de oficio (cuaderno, café, planta) que refuercen el contexto de uso.
- Evitar: íconos flotantes, "código" volando, estética "AI genérica" de stock.`
        break
      case 'service':
        body = `- Enfoque en el RESULTADO o el ENTORNO donde se entrega el servicio, no en iconos o logos del servicio.
- Si existe un objeto físico asociado (herramienta, envase, uniforme), ese objeto ES el hero; si no, enfocá el espacio limpio post-servicio.
- Luz natural confiable, estética profesional impecable.
- Evitar: handshakes, personas sonriendo sin contexto, íconos genéricos de servicio.`
        break
      case 'physical':
      default:
        body = `- Elegí superficies coherentes con la categoría: mármol/piedra para belleza/lujo, madera/concreto para hogar, metal cepillado para tech, acrílico para gadgets.
- Iluminación que revele materialidad: producto brillante → rim light + control de reflejo; producto mate → soft diffuse.
- Si la categoría lo sugiere (skincare, beauty), agregar micro-detalles sensoriales (brillo de envase, gota, polvo sutil).
- Evitar: props irrelevantes a la categoría, superficies que undersell el tier premium del producto.`
    }
  } else {
    switch (niche) {
      case 'food':
        body = `- Kitchen/food-coherent surfaces: natural wood, marble, raw linen, rustic ceramic, bread board.
- Warm temperature (subtle golden/amber). Freshness micro-details: condensation, steam, droplets, liquid glint.
- 0–4 complementary ingredients as visual garnish — NEVER oversaturate.
- If beverage/liquid: imply freshness via condensation or frozen pour.
- Avoid: cold sterile backgrounds, flat neutral lighting, non-kitchen props.`
        break
      case 'fashion':
        body = `- Premium textures near product: draped fabric, leather, polished marble, brushed metal.
- Editorial lighting (angular key + rim light), saturated-but-controlled colors, deep blacks.
- Where applicable, show micro-details: stitching, weave texture, visible tactility.
- Aspirational mood (refs: Vogue, Net-a-Porter, SSENSE, Jacquemus).
- Avoid: amateur studio backdrops, flat directionless lighting, cheap-catalog props.`
        break
      case 'digital':
        body = `- Show the digital product inside a real PHYSICAL mockup: laptop, tablet, smartphone with coherent interface.
- Environment: aspirational desk, clean workspace, window light or golden hour.
- Sharp screen, no moiré, realistic glow (not artificial).
- May include secondary devices or craft props (notebook, coffee, plant) that reinforce usage context.
- Avoid: floating icons, flying "code", generic stock "AI" aesthetic.`
        break
      case 'service':
        body = `- Focus on the RESULT or the ENVIRONMENT where the service is delivered — not on service icons/logos.
- If there's an associated physical object (tool, bottle, uniform), that object IS the hero; otherwise, focus on the clean post-service space.
- Trustworthy natural light, flawless professional aesthetic.
- Avoid: handshakes, context-less smiling people, generic service icons.`
        break
      case 'physical':
      default:
        body = `- Pick surfaces coherent with the category: marble/stone for beauty/luxury, wood/concrete for home, brushed metal for tech, acrylic for gadgets.
- Lighting that reveals materiality: glossy product → rim light + reflection control; matte product → soft diffuse.
- If the category suggests it (skincare, beauty), add sensory micro-details (bottle sheen, droplet, subtle powder).
- Avoid: category-irrelevant props, surfaces that undersell the product's premium tier.`
    }
  }
  return `${header}\n${body}\n═══════════════════════════════════════════════\n\n`
}

function buildProductRenderBlock(language: string): string {
  const isES = language === 'es'
  if (isES) {
    return `═══════════════════════════════════════════════
CALIDAD DE RENDER (NO NEGOCIABLE)
═══════════════════════════════════════════════
- OUTPUT MULTIUSO: El render debe funcionar SIN retoque adicional como (1) hero de sitio web, (2) imagen principal de página de producto (PDP), (3) post de redes sociales, (4) banner de marketplace, (5) catálogo impreso.
- RESOLUCIÓN: Máxima disponible. Densidad de detalle nivel 4K+.
- NITIDEZ: Macro-sharp en el producto. Bordes limpios. Texturas reales visibles (grano, fibra, brillo, poros, relieve de materiales). CERO suavizado tipo AI.
- COLOR: Fiel al producto real. Sin filtros vintage, sin teal/orange grading artificial, sin HDR exagerado, sin sobre-saturación.
- PACKAGING/ETIQUETA: Si el producto tiene texto impreso, marca o etiqueta — DEBE quedar perfectamente legible, sin deformación ni invención.
- ARTEFACTOS: CERO halo de recorte, CERO blur sobre el producto, CERO compresión visible, CERO ghosting, CERO doble contorno.
- COMPOSICIÓN: Espacio negativo intencional para permitir crops (16:9 para hero web, 1:1 para feed, 4:5 para PDP) sin perder al producto.
═══════════════════════════════════════════════

`
  }
  return `═══════════════════════════════════════════════
RENDER QUALITY (NON-NEGOTIABLE)
═══════════════════════════════════════════════
- MULTI-USE OUTPUT: The render must work WITHOUT further retouching as (1) website hero, (2) product detail page (PDP) main image, (3) social feed post, (4) marketplace banner, (5) print catalog.
- RESOLUTION: Maximum available. 4K+-level detail density.
- SHARPNESS: Macro-sharp on the product. Clean edges. Real textures visible (grain, fiber, sheen, pores, material relief). ZERO AI-smoothing.
- COLOR: Faithful to the real product. No vintage filters, no artificial teal/orange grade, no overblown HDR, no oversaturation.
- PACKAGING/LABEL: If the product has printed text, brand mark or label — it MUST remain perfectly legible, no deformation, no invention.
- ARTIFACTS: ZERO cutout halo, ZERO product blur, ZERO visible compression, ZERO ghosting, ZERO double contour.
- COMPOSITION: Intentional negative space so the image can be cropped (16:9 website hero, 1:1 feed, 4:5 PDP) without losing the product.
═══════════════════════════════════════════════

`
}

const PRODUCT_LAYOUT_BUILDERS: Record<string, ProductLayoutBuilder> = {

  'studio-hero': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const compositionTip = isVertical
      ? 'Composición vertical: el producto ocupa el tercio central-inferior, con espacio negativo generoso arriba.'
      : 'Composición cuadrada/casi-cuadrada: el producto centrado o ligeramente descentrado, aire generoso en todos los lados.'
    return `ACTÚA COMO: Fotógrafo profesional de producto especializado en fotografía de estudio premium — nivel Apple, Glossier, Aesop, Bang & Olufsen.

OBJETIVO:
Crear UNA (1) fotografía de producto de estudio con calidad de campaña de marca global. El producto debe verse como la estrella absoluta, flotando o posado sobre un fondo limpio con iluminación de estudio impecable.
${compositionTip}

DIRECCIÓN DE FOTOGRAFÍA — STUDIO HERO:
- El producto levita ligeramente (~2-5cm) sobre la superficie o descansa elegantemente sobre ella.
- Sombra: sombra de contacto suave y difusa debajo del producto (no drop shadow duro). Si levita, sombra caustic sutil en el suelo.
- Fondo: gradiente suave y limpio (de claro a ligeramente más oscuro, o viceversa) O color sólido neutro. El fondo NO compite con el producto.
- Iluminación: setup de estudio profesional con softbox principal (key light) lateral o 45°, fill light opuesto suave, rim light/backlight sutil en los bordes del producto para separarlo del fondo.
- Reflejo: si la superficie es reflectante, incluir un reflejo sutil y elegante (no espejo perfecto, sino difuminado).

TRATAMIENTO VISUAL:
- Nitidez: focus perfecto en el producto, profundidad de campo controlada (f/5.6 - f/8 look).
- Colores: fieles al producto real, saturación natural, white balance neutro.
- Contraste: medio-alto, con negros profundos y highlights controlados.
- El producto debe ocupar 50-70% del área del frame.
- CERO elementos adicionales: solo el producto, su sombra, y el fondo.

REFERENCIA ESTÉTICA:
Piensa en las fotos de producto de apple.com, el catálogo de Aesop, o la campaña de producto de Dyson.
Limpieza absoluta. Intención absoluta. Cada elemento tiene un propósito.`
  },

  'lifestyle': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const compositionTip = isVertical
      ? 'Composición vertical: el producto en el tercio inferior o central, entorno lifestyle visible arriba y a los lados.'
      : 'Composición cuadrada: el producto descentrado con regla de tercios, entorno contextual llenando el frame.'
    return `ACTÚA COMO: Fotógrafo profesional de lifestyle y producto editorial — nivel Kinfolk, Cereal Magazine, Architectural Digest.

OBJETIVO:
Crear UNA (1) fotografía de producto en contexto lifestyle. El producto debe estar colocado naturalmente en un entorno de uso real, como si fuera una foto editorial de revista.
${compositionTip}

DIRECCIÓN DE FOTOGRAFÍA — LIFESTYLE CONTEXT:
- INFIERE el entorno más natural para el tipo de producto: cocina, baño, escritorio, dormitorio, gym, exterior, café, etc.
- El producto debe estar COLOCADO naturalmente en la escena (no flotando, no pegado): sobre una mesa, en un estante, en una mano, junto a objetos complementarios.
- Profundidad de campo: shallow DOF (efecto f/1.8 - f/2.8), producto nítido, fondo con bokeh suave y agradable.
- Iluminación: luz ambiente natural (golden hour, luz de ventana suave, luz cálida interior). Evitar flash directo.
- Elementos de contexto: 2-3 objetos complementarios sutiles que refuercen la escena (taza de café, libreta, planta, tela, fruta — según el producto). NO saturar la escena.

TRATAMIENTO VISUAL:
- Color grading: cálido y acogedor, tonos earth/naturales. Puede tener un leve tinte warm (ámbar sutil).
- El producto ocupa 35-55% del frame — es protagonista pero vive en un contexto.
- Textura visible: madera, mármol, lino, cerámica — superficies que aporten calidez y táctil.
- Sensación editorial: la foto podría estar en una revista de lifestyle o en un feed de Instagram aspiracional.

REFERENCIA ESTÉTICA:
Fotos editoriales de Kinfolk Magazine, feeds de marcas DTC como Glossier o Byredo, catálogo de MUJI.
Natural, cálido, intencional, aspiracional sin ser pretencioso.`
  },

  'background-swap': (aspectRatio, backgroundDescription) => {
    const isVertical = aspectRatio === '9:16'
    const compositionTip = isVertical
      ? 'Composición vertical: producto centrado o en tercio inferior, nuevo fondo ocupando todo el canvas.'
      : 'Composición cuadrada: producto centrado o con regla de tercios, nuevo fondo ocupando todo el canvas.'
    const bgInstruction = backgroundDescription
      ? `FONDO SOLICITADO POR EL USUARIO: "${backgroundDescription}"
Usa esta descripción como guía principal para el fondo. Interpreta creativamente pero respeta la intención.`
      : `FONDO: Elige un fondo premium que complemente el producto. Opciones sugeridas:
- Mármol blanco o gris con vetas sutiles
- Madera natural clara o oscura
- Superficie de concreto pulido
- Naturaleza suave (hojas verdes desenfocadas, flores)
- Gradiente de color sofisticado
- Textura de tela o lino
Elige el que mejor complemente el color y estética del producto.`

    return `ACTÚA COMO: Fotógrafo profesional y retocador digital especializado en composición de producto — nivel de post-producción de agencia top.

OBJETIVO:
Crear UNA (1) fotografía donde el producto se EXTRAE de su fondo actual y se coloca sobre un NUEVO FONDO profesional. El resultado debe ser indistinguible de una foto real de estudio.
${compositionTip}

DIRECCIÓN DE FOTOGRAFÍA — BACKGROUND SWAP:
- EXTRAE el producto de su fondo actual con precisión perfecta (bordes limpios, sin halo, sin artefactos).
- Colócalo sobre el nuevo fondo manteniendo la perspectiva y escala coherentes.
${bgInstruction}

INTEGRACIÓN VISUAL (CRÍTICO):
- La DIRECCIÓN DE LUZ en el producto debe coincidir con la del nuevo fondo. Si el fondo tiene luz de la izquierda, las sombras del producto deben ser consistentes.
- La TEMPERATURA DE COLOR debe ser uniforme entre producto y fondo.
- Genera una SOMBRA DE CONTACTO nueva coherente con el nuevo fondo y la iluminación.
- Los BORDES del producto deben integrarse naturalmente — sin recorte duro, con micro-interacción con el fondo (sombra suave, reflejo sutil si aplica).
- El resultado debe verse como si el producto REALMENTE estuviera en ese fondo, no como un collage.

TRATAMIENTO VISUAL:
- El producto ocupa 45-65% del frame.
- Fondo con profundidad sutil (leve desenfoque si es textura, gradiente si es color sólido).
- Nitidez del producto: perfecta, todos los detalles visibles.
- Color grading uniforme entre producto y fondo.`
  },

  'pure-enhance': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const compositionTip = isVertical
      ? 'Mantener la composición vertical exacta de la imagen original.'
      : 'Mantener la composición exacta de la imagen original.'
    return `ACTÚA COMO: Retocador digital profesional de producto — nivel retoque de catálogo de lujo (Net-a-Porter, Mr Porter, Farfetch).

OBJETIVO:
MEJORAR la calidad de la foto del producto SIN cambiar la composición, el fondo, el ángulo ni el encuadre. Es un retoque de calidad, NO una reinterpretación.
${compositionTip}

DIRECCIÓN — PURE ENHANCEMENT (NO DESTRUCTIVO):
- MISMA composición exacta: mismo ángulo, mismo encuadre, mismo fondo, misma posición del producto.
- MISMOS colores base del producto — solo corregir si hay desviación de white balance.

MEJORAS PERMITIDAS:
1. NITIDEZ: Aumentar la nitidez y definición de detalles del producto (texturas, bordes, letras en packaging).
2. RUIDO: Reducir ruido/grain si la foto fue tomada con poca luz.
3. ILUMINACIÓN: Mejorar la distribución de luz — recuperar detalles en sombras, controlar highlights quemados.
4. WHITE BALANCE: Corregir tinte de color si la foto tiene cast amarillo/azul/verde.
5. FONDO: Limpiar distracciones menores del fondo (objetos pequeños, manchas, sombras no deseadas).
6. PRODUCTO: Eliminar polvo, huellas dactilares, pequeñas imperfecciones de superficie.
7. CONTRASTE: Ajustar para que el producto "pop" sin verse artificial.
8. SATURACIÓN: Ajuste fino para colores fieles y atractivos.

PROHIBIDO:
- NO cambiar el fondo por otro diferente.
- NO mover, rotar o reencuadrar el producto.
- NO agregar elementos nuevos (sombras, reflejos, objetos).
- NO cambiar la perspectiva o el ángulo.
- NO estilizar ni aplicar filtros artísticos.
- El resultado debe verse como "la misma foto pero tomada con mejor equipo y mejor luz".`
  },

  'splash-action': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const compositionTip = isVertical
      ? 'Composición vertical: producto centrado, elementos dinámicos explotando desde el centro hacia los bordes.'
      : 'Composición cuadrada: producto centrado, elementos dinámicos irradiando en todas las direcciones.'
    return `ACTÚA COMO: Fotógrafo de producto de alto impacto y artista de CGI — nivel campañas de Nike, Red Bull, Dyson, cosmética de lujo.

OBJETIVO:
Crear UNA (1) fotografía de producto de ALTO IMPACTO con elementos dinámicos que rodean al producto: salpicaduras, partículas, explosiones de materiales, rayos de luz, humo. El producto es el héroe inmóvil en el centro del caos controlado.
${compositionTip}

DIRECCIÓN DE FOTOGRAFÍA — SPLASH / ACTION:
- El producto está en el CENTRO, nítido y estático — es el ancla visual inmóvil.
- Elementos dinámicos RODEAN al producto de forma simétrica o radial.
- INFIERE los elementos dinámicos más apropiados según el tipo de producto:
  * Bebidas/líquidos → salpicaduras de agua, gotas en movimiento, hielo
  * Cosméticos/skincare → polvos, cremas en movimiento, pétalos, gotas de sérum
  * Tecnología → partículas de luz, chispas eléctricas, ondas de energía
  * Alimentos → ingredientes flotando, salpicaduras, vapor
  * Moda/accesorios → partículas doradas/plateadas, tela en movimiento, humo suave
  * General → luz volumétrica, partículas bokeh, humo sutil
- Motion blur SOLO en los elementos dinámicos (freeze-frame). El producto NUNCA tiene blur.

TRATAMIENTO VISUAL:
- Iluminación dramática: backlight fuerte, rim light en producto, iluminación volumétrica en partículas.
- Fondo oscuro preferentemente (negro, gris muy oscuro, o gradiente oscuro) para que los elementos dinámicos brillen.
- Contraste alto, colores vibrantes en los elementos dinámicos.
- El producto ocupa 30-50% del frame, los elementos dinámicos ocupan el resto.
- Sensación de HIGH ENERGY y movimiento congelado en el tiempo.

REFERENCIA ESTÉTICA:
Campañas de producto de Beats by Dre, publicidad de perfumes de lujo, shots de Red Bull, fotos de producto de Dyson.
Dramático, cinematográfico, de alto impacto.`
  },

  'podium': (aspectRatio) => {
    const isVertical = aspectRatio === '9:16'
    const compositionTip = isVertical
      ? 'Composición vertical: podio en el tercio inferior, producto sobre el podio, espacio limpio arriba.'
      : 'Composición cuadrada: podio centrado, producto prominente, ambiente de estudio limpio alrededor.'
    return `ACTÚA COMO: Director de arte de e-commerce premium y artista 3D — nivel catálogo de Net-a-Porter, presentaciones de producto de Apple, tiendas de lujo.

OBJETIVO:
Crear UNA (1) fotografía de producto sobre un PODIO o PEDESTAL 3D con iluminación de catálogo premium. El look es de exhibición de producto en tienda de lujo o presentación de lanzamiento.
${compositionTip}

DIRECCIÓN DE FOTOGRAFÍA — PODIUM DISPLAY:
- PEDESTAL/PODIO: forma geométrica limpia (cilindro, cubo, hexágono) con acabado premium.
  * Materiales sugeridos: mármol blanco, concreto pulido, acrílico transparente, madera clara, metal brushed.
  * El podio debe tener proporciones elegantes — no demasiado alto ni demasiado ancho.
- SUPERFICIE: ligeramente reflectante para crear un reflejo sutil del producto (no espejo perfecto, sino un reflejo difuso elegante).
- ILUMINACIÓN: spotlight suave desde arriba y lateral, creando sombras definidas pero no duras.
  * Key light: desde arriba-izquierda, suave
  * Fill: ambient bounce sutil
  * Accent light: toque de color de marca si hay paleta disponible (LED de acento en la base del podio o en el fondo)
- FONDO: estudio infinito (cyclorama) en tono neutro (blanco, gris claro, beige) o gradiente suave oscuro.

TRATAMIENTO VISUAL:
- El producto sobre el podio ocupa 50-70% del frame total.
- El podio eleva el producto, dándole presencia y "importancia".
- Profundidad de campo media (f/4 - f/5.6): producto y podio nítidos, fondo con suave falloff.
- Color grading: limpio, neutro, premium. Sin filtros.
- Opcional: 2-3 elementos decorativos mínimos alrededor de la base del podio (hojas, piedras, tela) si complementan el producto — NUNCA saturar.

REFERENCIA ESTÉTICA:
Renders 3D de Behance/Dribbble de product display, vitrinas de tiendas de lujo (Hermès, Cartier), presentaciones de producto de Apple.
Elegante, elevado, premium, con presencia escultórica.`
  },
}

// =============================================
// PUBLIC API: Build dynamic product photography prompt
// Combines product foundation + sub-style-specific direction
// =============================================

export interface ProductPromptOptions {
  backgroundDescription?: string
  productContext?: ProductPromptContext
  userInstructions?: string
  hasReferenceImages?: boolean
}

export function buildProductPrompt(
  subStyle: string,
  aspectRatio: PostAspectRatio | '1:1',
  language: string,
  options?: ProductPromptOptions | string
): string | null {
  const layoutBuilder = PRODUCT_LAYOUT_BUILDERS[subStyle]
  if (!layoutBuilder) return null

  // Back-compat: old signature passed backgroundDescription as 4th arg (string)
  const opts: ProductPromptOptions = typeof options === 'string'
    ? { backgroundDescription: options }
    : (options || {})

  const normalizedAR: PostAspectRatio = aspectRatio === '1:1' ? '3:4' : aspectRatio
  const hasReferenceImages = opts.hasReferenceImages !== false
  const foundation = buildProductFoundation(normalizedAR, aspectRatio, hasReferenceImages)
  const contextBlock = buildProductContextBlock(opts.productContext, language)
  const nicheOverlay = buildProductNicheOverlay(opts.productContext?.niche, language)
  const renderBlock = buildProductRenderBlock(language)
  const layout = layoutBuilder(normalizedAR, opts.backgroundDescription)

  const isES = language === 'es'
  const userInstrTrim = opts.userInstructions?.trim()
  const userBlock = userInstrTrim
    ? `═══════════════════════════════════════════════\n${isES ? 'INSTRUCCIONES ADICIONALES DEL USUARIO (MÁXIMA PRIORIDAD — SOBRESCRIBE DEFAULTS GENÉRICOS)' : 'ADDITIONAL USER INSTRUCTIONS (HIGHEST PRIORITY — OVERRIDE GENERIC DEFAULTS)'}\n═══════════════════════════════════════════════\n${userInstrTrim}\n═══════════════════════════════════════════════\n\n`
    : ''

  const formatOverride = aspectRatio === '1:1'
    ? `FORMATO OBLIGATORIO: Cuadrado 1:1 (1080×1080). La imagen DEBE ser perfectamente cuadrada.\n\n`
    : ''

  const closing = isES
    ? 'GENERA LA IMAGEN. NO generes texto descriptivo ni justificación. Devuelve SOLO la imagen resultante.'
    : 'GENERATE THE IMAGE. Do NOT output descriptive text or justification. Return ONLY the resulting image.'

  return `${formatOverride}${foundation}${contextBlock}${nicheOverlay}${layout}

${renderBlock}${userBlock}${closing}`
}

// =============================================
// ANUNCIO DE CONVERSIÓN — Niche Detection
// Maps product type + category to a visual strategy niche
// =============================================

export type AnuncioNiche = 'physical' | 'food' | 'service' | 'fashion' | 'digital'

const FOOD_KEYWORDS = ['comida', 'food', 'bebida', 'drink', 'alimento', 'snack', 'café', 'coffee', 'tea', 'té', 'juice', 'jugo', 'cerveza', 'beer', 'vino', 'wine', 'panadería', 'bakery', 'repostería', 'pastelería', 'helado', 'ice cream', 'restaurante', 'cocina', 'kitchen', 'gourmet', 'orgánico', 'organic', 'suplemento', 'supplement', 'proteína', 'protein']
const FASHION_KEYWORDS = ['ropa', 'clothing', 'moda', 'fashion', 'accesorio', 'accessory', 'joyería', 'jewelry', 'zapato', 'shoe', 'bolso', 'bag', 'reloj', 'watch', 'lentes', 'glasses', 'sombrero', 'hat', 'camiseta', 'shirt', 'vestido', 'dress', 'pantalón', 'pants', 'calzado', 'footwear', 'textil', 'textile']
const DIGITAL_KEYWORDS = ['curso', 'course', 'ebook', 'e-book', 'digital', 'online', 'software', 'app', 'aplicación', 'plantilla', 'template', 'membership', 'membresía', 'suscripción', 'subscription', 'coaching', 'mentoría', 'mentoring', 'webinar', 'taller online', 'workshop', 'descargable', 'downloadable']

export function detectProductNiche(product: {
  type?: string
  product_category?: string
  product_category_custom?: string
  product_description?: string
  svc_service_type?: string
}): AnuncioNiche {
  const pType = (product.type || '').toLowerCase()

  // Direct type mapping
  if (pType === 'servicio') return 'service'
  if (pType === 'indumentaria') return 'fashion'
  if (pType === 'restaurante') return 'food'

  // For 'producto' and others, check category + description keywords
  const searchText = [
    product.product_category || '',
    product.product_category_custom || '',
    product.product_description || '',
    product.svc_service_type || ''
  ].join(' ').toLowerCase()

  if (FOOD_KEYWORDS.some(kw => searchText.includes(kw))) return 'food'
  if (FASHION_KEYWORDS.some(kw => searchText.includes(kw))) return 'fashion'
  if (DIGITAL_KEYWORDS.some(kw => searchText.includes(kw))) return 'digital'

  // Default fallback
  return 'physical'
}

// =============================================
// ANUNCIO DE CONVERSIÓN — Master Prompt Builder
// High-conversion Instagram ad image generator
// =============================================

function buildNicheStrategy(niche: AnuncioNiche): string {
  switch (niche) {
    case 'physical':
      return `ESTRATEGIA VISUAL — PRODUCTO FÍSICO (Electrónica, Salud, Belleza, Hogar):
- Hero shot: Producto sobre superficie premium (mármol, madera, negro mate) con iluminación dramática.
- Ángulo preferido: 45° — muestra dimensión y sensación premium.
- Glow sutil del entorno o rim lighting en los bordes del producto.
- Badge de precio: bold, alto contraste, esquina inferior-derecha o superior-izquierda.
- Máximo 4-6 palabras de texto superpuesto.
- Si hay descuento: usar formato diagonal tachado o "antes/ahora".`

    case 'food':
      return `ESTRATEGIA VISUAL — ALIMENTOS Y BEBIDAS:
- Ángulo cenital u overhead, o 30° — ingredientes esparcidos artísticamente alrededor del producto.
- Vapor, condensación o desenfoque de movimiento para implicar frescura.
- Temperatura de color cálida (sensación golden hour).
- Texto superpuesto mínimo — que la comida se venda sola.
- Precio u oferta en badge limpio que NO compita con la comida.
- Texturas visibles: gotas, brillo, textura de superficie.`

    case 'service':
      return `ESTRATEGIA VISUAL — SERVICIOS (Limpieza, Consultoría, Fitness, Belleza):
- Antes/después split (si aplica) — formato más poderoso para servicios.
- O: persona EXPERIMENTANDO el resultado (no el proceso).
- Elementos de confianza integrados: calificación de estrellas, número de clientes, badge de garantía.
- El texto CTA es más prominente aquí ya que no hay producto físico como ancla.
- Mostrar el RESULTADO, no el servicio en sí.`

    case 'fashion':
      return `ESTRATEGIA VISUAL — MODA Y ACCESORIOS:
- Preferir modelo usando el producto sobre flat lay.
- Contexto lifestyle: la persona USANDO el artículo en un entorno deseable.
- Texto mínimo — el styling ES el anuncio.
- Precio y CTA en barra translúcida en la parte inferior.
- Iluminación editorial, sensación aspiracional.`

    case 'digital':
      return `ESTRATEGIA VISUAL — PRODUCTOS DIGITALES Y CURSOS:
- Mockup en dispositivo (laptop, teléfono) en un entorno lifestyle.
- Mostrar un screenshot o resultado convincente, NO la miniatura del curso.
- Elemento de prueba social: "500+ estudiantes" o snippet de testimonio.
- Más texto es aceptable aquí — la propuesta de valor necesita palabras.
- Enfoque en el RESULTADO que el cliente obtiene, no en el producto digital en sí.`
  }
}

// =============================================
// LOGO GENERATOR & ENHANCER — Master Prompt Builder
// Creates distinctive, functional, timeless logos across 5 archetypes.
// Two modes: "generate" (new concepts) and "enhance" (refine uploaded logo).
// =============================================

export type LogoArchetype = 'wordmark' | 'lettermark' | 'pictorial' | 'abstract' | 'emblem' | 'auto'
export type LogoMode = 'generate' | 'enhance'
export type LogoEnhanceTier = 'refine' | 'modernize' | 'rebuild'
export type LogoBackground = 'transparent' | 'white' | 'dark'

export interface LogoPromptOptions {
  mode: LogoMode
  businessName: string
  industry?: string
  description?: string
  brandValues?: string
  targetAudience?: string
  archetype?: LogoArchetype
  stylePreference?: string
  colorPreferences?: string
  avoid?: string
  background?: LogoBackground
  enhanceTier?: LogoEnhanceTier
  userKeeps?: string
  userChanges?: string
  language?: string
}

function logoSystemPrompt(language: string): string {
  const isES = language === 'es'
  if (!isES) {
    return `You are a senior brand identity designer with 15 years of experience creating logos for companies ranging from local businesses to global brands. You think like Michael Bierut, Paula Scher, and Sagi Haviv — not like an AI that generates generic emblems.

Your job is to create a logo that is DISTINCTIVE, FUNCTIONAL, and TIMELESS. Not trendy. Not generic. Not cluttered.

## CORE PRINCIPLES (NON-NEGOTIABLE)

1. **Reduction test.** The logo must remain recognizable at 16x16px (favicon), in single color, when photocopied, embroidered, or viewed from across a room. If it needs fine detail, gradients, or color to be recognized, it fails.

2. **A logo is not an illustration.** AVOID: literal pictures of what the business does, detailed scenery, realistic objects with shadows and highlights, clip-art aesthetics. EMBRACE: geometric abstraction, clever negative space, typographic wit, symbolic reduction, unexpected letterform treatments.

3. **Typography is 80% of great logos.** Before reaching for symbols, consider a wordmark with a distinctive typographic treatment (Google, Coca-Cola, FedEx, IBM, Disney are all "just type done well").

4. **Distinctiveness over prettiness.** A "pretty" logo that looks like 500 others in the same industry is a failed logo.

## WHAT NOT TO GENERATE (INSTANT REJECTION)

- Globes with swooshes around them
- Lightbulbs for "ideas/innovation"
- Handshakes
- Checkmarks inside circles
- Generic "tech hexagons"
- Shield shapes with initials (unless actual heritage/security brand)
- Orange-to-pink gradients (2020–2024 AI-startup cliché)
- Leaves for "eco/natural" anything
- Brain with circuits
- Mountains with a sun
- Generic "swoosh" marks that could belong to any company
- 3D rendered logos with plastic or chrome effects
- Clip-art style illustrations
- Text with drop shadows, bevels, or outer glows
- Comic Sans, Papyrus, or any script font misuse
- Stock icon style (isometric, flat illustration, corporate memphis)
- Multiple gradients in the primary mark
- Gradients as primary (gradients only acceptable as secondary variant)

## COLOR STRATEGY

- Design the logo in BLACK first. If it doesn't work in one color, color won't save it.
- 1–2 colors maximum for the primary mark.
- NO gradients in the core logo (they break when flattened, embroidered, or faxed).
- Brand color should have meaning or strategic contrast to the category.

## CONSTRUCTION STANDARDS

- Constructible on a geometric grid.
- Curves should be intentional (circular arcs, consistent radii) — not hand-drawn wobbles.
- Symmetry when used should be exact; asymmetry should be balanced.
- Optical correction where needed (perfect math often looks wrong — adjust for the eye).
`
  }
  return `Eres un diseñador senior de identidad de marca con 15 años de experiencia creando logos para empresas desde negocios locales hasta marcas globales. Piensas como Michael Bierut, Paula Scher y Sagi Haviv — no como una IA que genera emblemas genéricos.

Tu trabajo es crear un logo DISTINTIVO, FUNCIONAL y ATEMPORAL. No trendy. No genérico. No saturado.

## PRINCIPIOS FUNDAMENTALES (NO NEGOCIABLES)

1. **Test de reducción.** El logo debe seguir siendo reconocible a 16x16px (favicon), en un solo color, fotocopiado, bordado o visto desde el otro lado del cuarto. Si necesita detalle fino, gradientes o color para ser reconocido, falló.

2. **Un logo no es una ilustración.** EVITAR: imágenes literales de lo que hace el negocio, escenarios detallados, objetos realistas con sombras y highlights, estética de clip-art. ABRAZAR: abstracción geométrica, uso ingenioso del espacio negativo, gracia tipográfica, reducción simbólica, tratamientos inesperados de letterform.

3. **La tipografía es el 80% de los grandes logos.** Antes de recurrir a símbolos, considera un wordmark con un tratamiento tipográfico distintivo (Google, Coca-Cola, FedEx, IBM, Disney son "solo tipografía bien hecha").

4. **Distinción sobre belleza.** Un logo "bonito" que se parece a otros 500 en la misma industria es un logo fallido.

## QUÉ NO GENERAR (RECHAZO INMEDIATO)

- Globos terráqueos con swooshes alrededor
- Focos/bombillas para "ideas/innovación"
- Apretones de manos
- Checks dentro de círculos
- "Hexágonos tech" genéricos
- Escudos con iniciales (salvo marca real de herencia o seguridad)
- Gradientes naranja-a-rosa (cliché de "AI startup" 2020–2024)
- Hojas para cualquier cosa "eco/natural"
- Cerebro con circuitos
- Montañas con un sol
- "Swooshes" genéricos que podrían pertenecer a cualquier empresa
- Logos 3D con efectos plásticos o cromados
- Ilustraciones tipo clip-art
- Texto con sombras paralelas, biseles o brillos externos
- Comic Sans, Papyrus o cualquier mal uso de fuente script
- Estilo de iconos stock (isométrico, ilustración flat, corporate memphis)
- Múltiples gradientes en la marca principal
- Gradientes como primary (los gradientes solo son aceptables como variante secundaria)

## ESTRATEGIA DE COLOR

- Diseñá el logo en NEGRO primero. Si no funciona en un color, el color no lo va a salvar.
- Máximo 1–2 colores para la marca principal.
- NADA de gradientes en el logo core (se rompen al aplanarlos, bordarlos o faxearlos).
- El color de marca debe tener significado o contraste estratégico con la categoría.

## ESTÁNDARES DE CONSTRUCCIÓN

- Construible sobre una grilla geométrica.
- Las curvas deben ser intencionales (arcos circulares, radios consistentes) — no wobbles hechos a mano.
- Simetría exacta cuando se usa; asimetría balanceada cuando se usa.
- Corrección óptica cuando sea necesario (la matemática perfecta a menudo se ve mal — ajustá para el ojo).
`
}

function archetypeInstruction(archetype: LogoArchetype, language: string): string {
  const isES = language === 'es'
  switch (archetype) {
    case 'wordmark':
      return isES
        ? `ARQUETIPO OBLIGATORIO: **WORDMARK (LOGOTIPO)**.
Pura tipografía. El nombre de la empresa renderizado en una tipografía distintiva, custom, o cuidadosamente elegida con espaciado, peso y tratamiento de carácter intencional.
Referencias: Google, Coca-Cola, Visa, FedEx.
Movimientos clave: letterforms custom, ligaduras inesperadas, contraste de pesos, UNA sola letra "trick".
PROHIBIDO agregar ningún símbolo, ícono o marca pictórica. SOLO TEXTO.`
        : `REQUIRED ARCHETYPE: **WORDMARK (LOGOTYPE)**.
Pure typography. The company name rendered in a distinctive, custom, or carefully-chosen typeface with intentional spacing, weight, and character treatment.
References: Google, Coca-Cola, Visa, FedEx.
Key moves: custom letterforms, unexpected ligatures, weight contrast, a single "trick" letter.
FORBIDDEN to add any symbol, icon, or pictorial mark. TEXT ONLY.`
    case 'lettermark':
      return isES
        ? `ARQUETIPO OBLIGATORIO: **LETTERMARK (MONOGRAMA)**.
Usa iniciales o una sola letra como marca principal.
Referencias: IBM, HP, CNN, HBO, CC de Chanel.
Movimientos clave: construcción geométrica, letras entrelazadas, juegos de espacio negativo.
Podés usar un contenedor geométrico sutil (círculo, cuadrado) pero sin convertirlo en escudo.`
        : `REQUIRED ARCHETYPE: **LETTERMARK (MONOGRAM)**.
Uses initials or a single letter as the primary mark.
References: IBM, HP, CNN, HBO, Chanel's CC.
Key moves: geometric construction, interlocking letters, negative space plays.
You may use a subtle geometric container (circle, square) but don't turn it into a shield.`
    case 'pictorial':
      return isES
        ? `ARQUETIPO OBLIGATORIO: **PICTORIAL MARK (ÍCONO + WORDMARK)**.
Un símbolo simple e icónico emparejado con el nombre de la empresa.
Referencias: Apple, pájaro de Twitter, Shell, Target.
Movimientos clave: simplificación extrema, forma continua única, ingenio en espacio negativo.
El símbolo debe ser construible con UN solo trazo conceptual. Nada de ilustración detallada.`
        : `REQUIRED ARCHETYPE: **PICTORIAL MARK (ICON + WORDMARK)**.
A simple, iconic symbol paired with the company name.
References: Apple, Twitter bird, Shell, Target.
Key moves: extreme simplification, single continuous shape, negative space cleverness.
The symbol must be constructible with ONE conceptual stroke. No detailed illustration.`
    case 'abstract':
      return isES
        ? `ARQUETIPO OBLIGATORIO: **ABSTRACT MARK**.
Forma geométrica o abstracta que no representa nada literalmente.
Referencias: Nike swoosh, Pepsi, trébol de Adidas, octágono de Chase.
Movimientos clave: geometría dinámica, construcción en golden ratio, movimiento implícito en la forma.
Debe verse intencional y construido — no un garabato genérico.`
        : `REQUIRED ARCHETYPE: **ABSTRACT MARK**.
Geometric or abstract shape that doesn't represent anything literally.
References: Nike swoosh, Pepsi, Adidas trefoil, Chase octagon.
Key moves: dynamic geometry, golden ratio construction, motion implied through form.
Must look intentional and constructed — not a generic squiggle.`
    case 'emblem':
      return isES
        ? `ARQUETIPO OBLIGATORIO: **EMBLEM / BADGE**.
Texto integrado dentro de un símbolo o forma contenedora.
Referencias: Starbucks, Harley-Davidson, logos de equipos de la NFL.
Movimientos clave: contenedor circular o tipo escudo, tipografía balanceada adentro, restricción con el detalle.
Apropiado para marcas heritage, F&B, oficios artesanales.`
        : `REQUIRED ARCHETYPE: **EMBLEM / BADGE**.
Text integrated inside a symbol or container shape.
References: Starbucks, Harley-Davidson, NFL team logos.
Key moves: circular or shield container, balanced typography within, restraint with detail.
Appropriate for heritage brands, F&B, craft trades.`
    case 'auto':
    default:
      return isES
        ? `ARQUETIPO: **LA IA DECIDE**.
Elegí el arquetipo más apropiado para este negocio entre: wordmark, lettermark, pictorial mark, abstract mark, o emblem. Basá la decisión en:
- Largo del nombre (nombres cortos → wordmark; nombres largos → lettermark)
- Industria (tech/services → wordmark o abstract; F&B/heritage → emblem; retail/consumer → pictorial)
- Tono de marca
Justificá tu elección con la ejecución visual, no con texto.`
        : `ARCHETYPE: **AI CHOOSES**.
Pick the most appropriate archetype for this business from: wordmark, lettermark, pictorial mark, abstract mark, or emblem. Base the decision on:
- Name length (short names → wordmark; long names → lettermark)
- Industry (tech/services → wordmark or abstract; F&B/heritage → emblem; retail/consumer → pictorial)
- Brand tone
Justify your choice through the visual execution, not through text.`
  }
}

function nicheGuidance(industry: string | undefined, language: string): string {
  if (!industry) return ''
  const isES = language === 'es'
  const lower = industry.toLowerCase()

  // Heuristic industry matching
  let guidance = ''
  if (/tech|saas|software|app|digital|platform/.test(lower)) {
    guidance = isES
      ? `GUÍA DE INDUSTRIA — TECH / SAAS / SOFTWARE:
- Inclinación: wordmark o abstract mark.
- Estilo: geométrico, limpio, a menudo sans-serif.
- Evitá: engranajes, circuitos, globos, manos estrechándose.
- Hacé: considerá letterforms custom, símbolos geométricos sutiles.`
      : `INDUSTRY GUIDANCE — TECH / SAAS / SOFTWARE:
- Lean: wordmark or abstract mark.
- Style: geometric, clean, often sans-serif.
- Avoid: gears, circuits, globes, people shaking hands.
- Do: consider custom letterforms, subtle geometric symbols.`
  } else if (/food|restaurant|cafe|bakery|coffee|comida|bebida|resto|pasteler/.test(lower)) {
    guidance = isES
      ? `GUÍA DE INDUSTRIA — COMIDA Y BEBIDA:
- Inclinación: emblem, pictorial, o wordmark con personalidad.
- Estilo: más cálido, más personalidad, script OK para feel artesanal.
- Evitá: gorros de chef genéricos, tenedores/cuchillos, espigas de trigo (a menos que uses real ingenio).
- Hacé: evocar sabor y experiencia, no el ingrediente.`
      : `INDUSTRY GUIDANCE — FOOD & BEVERAGE:
- Lean: emblem, pictorial, or wordmark with character.
- Style: warmer, more personality, script OK for artisan feel.
- Avoid: generic chef hats, forks/knives, wheat stalks (unless done with real wit).
- Do: evoke taste and experience, not the ingredient.`
  } else if (/health|medical|clinic|wellness|salud|médic|clínic|fitness/.test(lower)) {
    guidance = isES
      ? `GUÍA DE INDUSTRIA — SALUD / MEDICINA:
- Inclinación: pictorial o abstract mark.
- Estilo: confiable, limpio, a menudo geométrico.
- Evitá: cruces rojas (marca registrada), estetoscopios, caduceus genérico.
- Hacé: considerá simbolismo sutil de cuidado, balance o vitalidad.`
      : `INDUSTRY GUIDANCE — HEALTH / MEDICAL:
- Lean: pictorial or abstract mark.
- Style: trustworthy, clean, often geometric.
- Avoid: red crosses (trademarked), stethoscopes, generic caduceus.
- Do: consider subtle symbolism of care, balance, or vitality.`
  } else if (/fashion|beauty|cosmet|moda|belleza|ropa|apparel|jewel/.test(lower)) {
    guidance = isES
      ? `GUÍA DE INDUSTRIA — MODA Y BELLEZA:
- Inclinación: wordmark o lettermark.
- Estilo: elegante, a menudo serif o sans-serif refinado, letterspacing ajustado.
- Evitá: mariposas, flourishes genéricos, clichés femeninos.
- Hacé: dejá que la tipografía haga el trabajo, pensá editorial.`
      : `INDUSTRY GUIDANCE — FASHION & BEAUTY:
- Lean: wordmark or lettermark.
- Style: elegant, often serif or refined sans-serif, tight letterspacing.
- Avoid: butterflies, generic flourishes, feminine clichés.
- Do: let type do the work, think editorial.`
  } else if (/consult|law|legal|finance|advisor|account|consult|abogad|financ|contador/.test(lower)) {
    guidance = isES
      ? `GUÍA DE INDUSTRIA — SERVICIOS PROFESIONALES:
- Inclinación: lettermark o wordmark.
- Estilo: confiado, establecido, a menudo serif o geometric sans.
- Evitá: edificios, apretones de manos, balanzas de justicia, flechas hacia arriba.
- Hacé: confianza tipográfica, detalles custom sutiles.`
      : `INDUSTRY GUIDANCE — PROFESSIONAL SERVICES:
- Lean: lettermark or wordmark.
- Style: confident, established, often serif or geometric sans.
- Avoid: buildings, handshakes, scales of justice, upward arrows.
- Do: typographic confidence, subtle custom details.`
  } else if (/retail|ecommerce|shop|tienda|e-commerce|store/.test(lower)) {
    guidance = isES
      ? `GUÍA DE INDUSTRIA — E-COMMERCE / RETAIL:
- Inclinación: wordmark o pictorial.
- Estilo: amigable, memorable, versátil a través de contextos de producto.
- Evitá: bolsas de compras, carritos, dibujos literales del producto.
- Hacé: crear una marca que viva en productos Y en storefronts.`
      : `INDUSTRY GUIDANCE — E-COMMERCE / RETAIL:
- Lean: wordmark or pictorial.
- Style: friendly, memorable, versatile across product contexts.
- Avoid: shopping bags, carts, literal product drawings.
- Do: create a mark that can live on products AND storefronts.`
  } else if (/clean|construc|delivery|plumb|electric|limpiez|construc|entrega|plomer/.test(lower)) {
    guidance = isES
      ? `GUÍA DE INDUSTRIA — OFICIOS Y SERVICIOS:
- Inclinación: emblem o pictorial con wordmark.
- Estilo: bold, legible desde lejos (estos van en camiones y uniformes).
- Evitá: personajes de dibujos animados haciendo el trabajo, herramientas genéricas.
- Hacé: silueta fuerte, funciona en un color, legible a 50 metros.`
      : `INDUSTRY GUIDANCE — TRADES & SERVICES:
- Lean: emblem or pictorial with wordmark.
- Style: bold, legible from distance (these go on trucks and uniforms).
- Avoid: cartoon characters doing the job, generic tools.
- Do: strong silhouette, works in one color, readable at 50 meters.`
  }
  return guidance ? guidance + '\n\n' : ''
}

function backgroundInstruction(bg: LogoBackground, language: string): string {
  const isES = language === 'es'
  switch (bg) {
    case 'white':
      return isES
        ? `FONDO: BLANCO PURO (#FFFFFF). Logo en su versión primaria, centrado con márgenes generosos (min 20% de padding en todos los lados).`
        : `BACKGROUND: PURE WHITE (#FFFFFF). Logo in its primary version, centered with generous margins (min 20% padding on all sides).`
    case 'dark':
      return isES
        ? `FONDO: GRIS OSCURO / NEGRO (#0F0F11). Logo en su versión reversa (blanco o colores invertidos), centrado con márgenes generosos. Probar contraste.`
        : `BACKGROUND: DARK GRAY / BLACK (#0F0F11). Logo in its reverse version (white or inverted colors), centered with generous margins. Test contrast.`
    case 'transparent':
    default:
      return isES
        ? `FONDO: BLANCO NEUTRO (#FAFAFA) — simulando fondo transparente/neutral. Logo en su versión primaria, centrado con márgenes generosos (min 20% padding). NO decorado. NO escenas. NO texturas.`
        : `BACKGROUND: NEUTRAL WHITE (#FAFAFA) — simulating transparent/neutral background. Logo in its primary version, centered with generous margins (min 20% padding). NO decoration. NO scenes. NO textures.`
  }
}

export function buildLogoPrompt(opts: LogoPromptOptions): string {
  const lang = opts.language || 'es'
  const isES = lang === 'es'
  const bg = opts.background || 'transparent'

  const system = logoSystemPrompt(lang)
  const archetype = archetypeInstruction(opts.archetype || 'auto', lang)
  const niche = nicheGuidance(opts.industry, lang)
  const bgRule = backgroundInstruction(bg, lang)

  const businessBlock = isES
    ? `CONTEXTO DEL NEGOCIO:
- NOMBRE DE LA EMPRESA: ${opts.businessName || '(no proporcionado)'}
- INDUSTRIA / NICHO: ${opts.industry || '(no especificado — inferí del contexto)'}${opts.description ? `\n- DESCRIPCIÓN: ${opts.description}` : ''}${opts.brandValues ? `\n- VALORES DE MARCA: ${opts.brandValues}` : ''}${opts.targetAudience ? `\n- AUDIENCIA OBJETIVO: ${opts.targetAudience}` : ''}${opts.stylePreference ? `\n- PREFERENCIA DE ESTILO: ${opts.stylePreference}` : ''}${opts.colorPreferences ? `\n- PREFERENCIAS DE COLOR: ${opts.colorPreferences}` : '\n- PREFERENCIAS DE COLOR: elección del diseñador (siempre empezar monocromo)'}${opts.avoid ? `\n- EVITAR: ${opts.avoid}` : ''}

IMPORTANTE: El texto del logo DEBE ser exactamente "${opts.businessName}" — deletreado tal cual, sin abreviaturas, sin cambios de mayúsculas/minúsculas no intencionales.`
    : `BUSINESS CONTEXT:
- BUSINESS NAME: ${opts.businessName || '(not provided)'}
- INDUSTRY / NICHE: ${opts.industry || '(not specified — infer from context)'}${opts.description ? `\n- DESCRIPTION: ${opts.description}` : ''}${opts.brandValues ? `\n- BRAND VALUES: ${opts.brandValues}` : ''}${opts.targetAudience ? `\n- TARGET AUDIENCE: ${opts.targetAudience}` : ''}${opts.stylePreference ? `\n- STYLE PREFERENCE: ${opts.stylePreference}` : ''}${opts.colorPreferences ? `\n- COLOR PREFERENCES: ${opts.colorPreferences}` : '\n- COLOR PREFERENCES: designer\'s choice (always start monochrome)'}${opts.avoid ? `\n- AVOID: ${opts.avoid}` : ''}

IMPORTANT: The logo text MUST be exactly "${opts.businessName}" — spelled as-is, no abbreviations, no unintended case changes.`

  const outputRule = isES
    ? `═══════════════════════════════════════════════
SALIDA REQUERIDA — UNA (1) IMAGEN
═══════════════════════════════════════════════
- Formato: CUADRADO 1:1 (1024×1024 o superior), alta resolución
- ${bgRule}
- El logo ocupa el centro con márgenes generosos (mínimo 18–22% de padding en cada lado)
- CERO texto adicional más allá del nombre del negocio (nada de tagline, slogan, año de fundación, o texto de prueba)
- CERO elementos decorativos alrededor (nada de marcos, fondos texturizados, grids visibles, regla/guías, mockups, rótulos, sombras dramáticas)
- El logo se ve como un ENTREGABLE FINAL listo para colocar en un deck, web, o tarjeta — no un proceso o exploración
- Nitidez vectorial: bordes limpios, curvas suaves, sin artifacts ni bordes pixelados
- Proporciones intencionales: la construcción debe verse pensada, no algorítmica
═══════════════════════════════════════════════

GENERÁ LA IMAGEN FINAL DEL LOGO.`
    : `═══════════════════════════════════════════════
REQUIRED OUTPUT — ONE (1) IMAGE
═══════════════════════════════════════════════
- Format: SQUARE 1:1 (1024×1024 or higher), high resolution
- ${bgRule}
- Logo occupies the center with generous margins (minimum 18–22% padding on each side)
- ZERO additional text beyond the business name (no tagline, slogan, founding year, or test text)
- ZERO decorative elements around (no frames, textured backgrounds, visible grids, rulers/guides, mockups, labels, dramatic shadows)
- The logo should look like a FINAL DELIVERABLE ready to place on a deck, website, or card — not a process or exploration
- Vector sharpness: clean edges, smooth curves, no artifacts or pixelated borders
- Intentional proportions: the construction must look thought-out, not algorithmic
═══════════════════════════════════════════════

GENERATE THE FINAL LOGO IMAGE.`

  if (opts.mode === 'enhance') {
    const tier = opts.enhanceTier || 'modernize'
    const tierDetail = isES
      ? (tier === 'refine'
          ? `- **REFINE (cambio mínimo):** Mantené el concepto core. Arreglá problemas obvios de ejecución (mejor tipografía, geometría más limpia, forma más simple). El resultado debe ser reconocible como "el mismo logo, pero mejor hecho".`
          : tier === 'modernize'
            ? `- **MODERNIZE (actualización significativa):** Mantené la idea core pero traducila al lenguaje de diseño actual. Eliminá efectos dated. Actualizá la tipografía. Simplificá la geometría. El resultado debe sentirse "fresco pero familiar".`
            : `- **REBUILD (reconstrucción):** Preservá el equity de marca (iniciales, símbolo clave, color si es icónico) pero reconstruí con ejecución completamente nueva. Mismo DNA, nueva ejecución.`)
      : (tier === 'refine'
          ? `- **REFINE (minimal change):** Keep the core concept. Fix obvious execution issues (better typography, cleaner geometry, simpler form). The result must be recognizable as "the same logo, but better executed".`
          : tier === 'modernize'
            ? `- **MODERNIZE (meaningful update):** Keep the core idea but translate it to current design language. Remove dated effects. Update typography. Simplify geometry. The result should feel "fresh but familiar".`
            : `- **REBUILD (reconstruction):** Preserve brand equity (initials, key symbol, color if iconic) but rebuild with completely new execution. Same DNA, new execution.`)
    const enhanceIntro = isES
      ? `MODO: MEJORAR LOGO EXISTENTE.

Se adjunta una imagen del logo actual del usuario. Tu trabajo NO es reemplazarlo completamente — es mejorar su ejecución preservando su equity de marca.

PRIMERO ANALIZÁ el logo adjunto:
1. Identificá el arquetipo actual (wordmark, mark, combinación).
2. Diagnosticá problemas: ¿pasa el test de reducción? ¿La tipografía es débil o genérica? ¿Demasiados elementos? ¿Proporciones raras? ¿Está anticuado (gradientes, biseles, efectos 2010)? ¿Demasiado similar a competidores?
3. Determiná la estrategia de mejora.

NIVEL DE MEJORA SOLICITADO: **${tier.toUpperCase()}**.

${tierDetail}${opts.userKeeps ? `\n\nEL USUARIO QUIERE MANTENER: ${opts.userKeeps}` : ''}${opts.userChanges ? `\nEL USUARIO QUIERE CAMBIAR: ${opts.userChanges}` : ''}
`
      : `MODE: ENHANCE EXISTING LOGO.

An image of the user's current logo is attached. Your job is NOT to replace it entirely — it's to improve its execution while preserving its brand equity.

FIRST ANALYZE the attached logo:
1. Identify the current archetype (wordmark, mark, combination).
2. Diagnose problems: does it pass the reduction test? Is the typography weak or generic? Too many elements? Off proportions? Dated (gradients, bevels, 2010-era effects)? Too similar to competitors?
3. Determine the enhancement strategy.

REQUESTED ENHANCEMENT TIER: **${tier.toUpperCase()}**.

${tierDetail}${opts.userKeeps ? `\n\nUSER WANTS TO KEEP: ${opts.userKeeps}` : ''}${opts.userChanges ? `\nUSER WANTS TO CHANGE: ${opts.userChanges}` : ''}
`
    const archetypeBlock = (opts.archetype && opts.archetype !== 'auto') ? archetype + '\n\n' : ''
    return `${enhanceIntro}\n${system}\n${archetypeBlock}${niche}${businessBlock}\n\n${outputRule}`
  }

  // Generate new mode
  return `${system}\n${archetype}\n\n${niche}${businessBlock}\n\n${outputRule}`
}

export function buildAnuncioPrompt(
  aspectRatio: PostAspectRatio,
  language: string,
  hasProductImages: boolean,
  niche: AnuncioNiche
): string {
  const langLabel = language === 'es' ? 'ESPAÑOL' : 'ENGLISH'
  const isSquare = aspectRatio === '3:4' ? false : true // 1:1 treated via override
  const formatLabel = isSquare ? '1:1 cuadrado (1080×1080, post de feed)' : '3:4 vertical (1080×1350, feed + stories optimizado)'

  const langRule = `═══════════════════════════════════════════════
REGLA #0 — IDIOMA Y TEXTO (NO NEGOCIABLE)
═══════════════════════════════════════════════
- El idioma de TODOS los textos visibles en la imagen DEBE ser: ${langLabel}.
- COPIA el texto del guión TAL CUAL está escrito — NO traduzcas, NO parafrasees.
- PROHIBIDO mezclar idiomas. PROHIBIDO usar texto placeholder o lorem ipsum.
- VIOLACIÓN DE ESTA REGLA = RESULTADO INVÁLIDO.
═══════════════════════════════════════════════

`

  const productRefRule = hasProductImages ? buildProductReferenceRoleRule(langLabel) : ''

  const nicheStrategy = buildNicheStrategy(niche)

  return `${langRule}${productRefRule}Eres un director creativo de performance especializado en anuncios de respuesta directa para Instagram Ads, enfocado en pequeñas y medianas empresas en Latinoamérica. Tu trabajo es generar imágenes publicitarias que CONVIERTEN — no solo que se vean bonitas.

OBJETIVO:
Generar UNA (1) imagen publicitaria de alto impacto optimizada para conversión en Instagram Ads. Formato: ${formatLabel}.
La imagen debe DETENER el scroll, crear DESEO y dirigir al CLIC.

CONTEXTO DE NEGOCIO:
Recibirás un guión/script con estructura Gancho/Desarrollo/CTA más información del producto. USARÁS TODO este contexto. El anuncio debe sentirse como si perteneciera a ESTA marca específica — no como una plantilla genérica.

${nicheStrategy}

═══════════════════════════════════════════════
REGLAS DE COMPOSICIÓN (TODAS LAS CATEGORÍAS)
═══════════════════════════════════════════════

1. **UN SOLO PUNTO FOCAL.** Un producto, un mensaje, una acción. Nunca saturar.
2. **Test de 3 segundos.** Si alguien no puede entender qué se vende y por qué debería importarle en 3 segundos a tamaño miniatura, rediseñar.
3. **Jerarquía de texto:**
   - Línea gancho (más grande): máximo 4-6 palabras, responde "¿por qué debería importarme?"
   - Detalle de apoyo (más pequeño): precio, oferta o beneficio clave
   - CTA (elemento tipo botón): "Comprar Ahora", "Ver Más", "Pedir Ya"
4. **Zonas seguras:** Mantener texto/elementos críticos alejados de los bordes. Usar margen de ~60px en todos los lados.
5. **Integración de marca:** Logo pequeño, ubicación en esquina (inferior-derecha preferida). Colores de marca solo en elementos de acento — nunca abrumador.
6. **Nada de estética stock.** Si se usan las imágenes de referencia del producto, integrarlas en una escena que se sienta fotografiada con propósito.

═══════════════════════════════════════════════
PRINCIPIOS DE COLOR Y CONTRASTE
═══════════════════════════════════════════════

- El fondo debe contrastar con el feed de Instagram (evitar blanco puro para feeds en modo claro).
- Fondos oscuros y moody funcionan universalmente para sensación premium.
- Usar color de acento de marca para el elemento CTA y el precio.
- Texto: blanco sobre fondos oscuros, oscuro sobre claros — NUNCA texto de color sobre fondos de color.
- Si el producto es oscuro, usar superficie clara/contrastante o rim lighting.

═══════════════════════════════════════════════
TEXTO EN IMAGEN — REGLAS DE COPY
═══════════════════════════════════════════════

Extraer del guión/script pero COMPRIMIR sin piedad:

- **Gancho:** Extraer el beneficio más convincente o punto de dolor del script.
  - Bien: "Presión arterial en 30 segundos"
  - Mal: "Monitor Digital de Presión Arterial de Muñeca con Pantalla LED"
- **Precio/Oferta:** Hacerlo escaneable.
  - Bien: "₡14,900" o "50% OFF — Solo Hoy"
  - Mal: "Precio especial de catorce mil novecientos colones"
- **CTA:** Verbo de acción + urgencia.
  - Bien: "Pedí el tuyo →"
  - Mal: "Haga clic aquí para obtener más información"

═══════════════════════════════════════════════
ESPECIFICACIONES DE SALIDA
═══════════════════════════════════════════════

- Formato: ${formatLabel}
- Estilo: Render fotorrealista de producto con elementos de diseño superpuestos
- SIN watermarks, SIN texto placeholder, SIN lorem ipsum
- Todo el texto en ${langLabel}
- Archivo: PNG, alta calidad

═══════════════════════════════════════════════
QUÉ EVITAR
═══════════════════════════════════════════════

- Layouts saturados con más de 3 elementos de texto
- Fondos de gradiente genéricos sin relación al producto
- Texto ilegible a tamaño de pantalla de teléfono
- Personas con aspecto de stock con expresiones exageradas
- Emojis en la imagen (reservar para el caption)
- Códigos QR (no funcionan en anuncios de feed)
- Múltiples productos en una imagen
- Bordes o marcos que desperdicien espacio
- Número de slide (1/1, 2/2, etc.)
- Anotaciones técnicas, dimensiones o medidas visibles

DIRECCIÓN DE ARTE PREMIUM:
El diseño debe verse como una marca grande: minimalista premium + editorial + alto impacto.
Tipografía: máximo 2 familias sans-serif premium (estilo SF/Inter/Helvetica).
El anuncio debe detener el scroll INMEDIATAMENTE y comunicar valor en 3 segundos.

${hasProductImages
    ? `VISUAL (OBLIGATORIO: USAR LAS REFERENCIAS POR ROL):
Se adjuntan referencias reales del producto/oferta. Clasifica cada una antes de componer.
- Producto heroe: apariencia real y fiel a la referencia.
- Variantes: separadas o en lineup limpio.
- Resultado/prueba/detalle: inset, panel secundario, textura sutil o apoyo visual.
- Contexto/estilo: ambiente y direccion de arte.
- NO generes un producto inventado. NO mezcles varias referencias en un producto hibrido.`
    : `VISUAL (INFERIR DEL GUIÓN):
Como no hay fotos del producto, inferí la mejor escena visual que represente la propuesta de valor del guión.
- La escena debe comunicar el beneficio principal inmediatamente.
- Elegí UN escenario que muestre el producto/servicio en su mejor contexto de uso.
- La imagen debe sentirse auténtica, profesional y aspiracional.`}

GUIÓN DEL USUARIO:
`
}
