// =============================================
// VENTA DIRECTA — Master Post Prompt
// Director de Arte + Diseñador Gráfico + Copywriter
// Built dynamically based on aspect ratio.
// CRITICAL: No pixel values, no dimension annotations — the AI renders them.
// =============================================
export type PostAspectRatio = '9:16' | '3:4'

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

  const productRefRule = hasProductImages
    ? `═══════════════════════════════════════════════
REGLA #1 — IMÁGENES DE PRODUCTO DE REFERENCIA (MÁXIMA PRIORIDAD)
═══════════════════════════════════════════════
Se adjuntan fotos del PRODUCTO REAL del usuario.
- El producto en el post DEBE verse EXACTAMENTE como en las fotos de referencia.
- USA las fotos de referencia como fuente de verdad para la forma, silueta, color, textura, ángulo y detalles reales del producto.
- NO inventes, NO rediseñes, NO reimagines el producto. Usa la referencia fielmente.
- Si necesitas mostrar el producto en acción, mantené su apariencia idéntica a la referencia.
- La forma del producto NO se modifica bajo ninguna circunstancia: no stylize, no cartoon, no 3D fake.
═══════════════════════════════════════════════

`
    : ''

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
    ? `VISUAL (OBLIGATORIO: USAR LAS FOTOS DE PRODUCTO PROPORCIONADAS):
Se te adjuntan fotos reales del producto. USÁLAS como base visual principal del post.
- El producto DEBE aparecer en el post con su apariencia REAL (forma, color, textura, ángulo de las fotos de referencia).
- Podés ubicar el producto en un contexto de uso o lifestyle, pero su forma DEBE ser fiel a la referencia.
- NO generes un producto inventado. NO cambies su silueta, proporciones ni detalles.
- Elegí el mejor ángulo/foto de las referencias para la composición.
- El producto debe ocupar un lugar prominente en la composición (60–80% del área visual).`
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
- ${hasProductImages ? 'Visual basada en las fotos de producto proporcionadas (producto REAL, fiel a la referencia)' : 'Visual en acción inferida inteligentemente del guión'}
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

  const productRefRule = hasProductImages
    ? `═══════════════════════════════════════════════
REGLA #1 — IMÁGENES DE PRODUCTO DE REFERENCIA (MÁXIMA PRIORIDAD)
═══════════════════════════════════════════════
Se adjuntan fotos del PRODUCTO REAL del usuario.
- El producto en el post DEBE verse EXACTAMENTE como en las fotos de referencia.
- USA las fotos de referencia como fuente de verdad para la forma, silueta, color, textura, ángulo y detalles reales del producto.
- NO inventes, NO rediseñes, NO reimagines el producto. Usa la referencia fielmente.
- La forma del producto NO se modifica bajo ninguna circunstancia: no stylize, no cartoon, no 3D fake.
═══════════════════════════════════════════════

`
    : ''

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
    ? `VISUAL — PRODUCTO REAL (OBLIGATORIO):
Se te adjuntan fotos reales del producto. USÁLAS como base visual principal del post.
- El producto DEBE aparecer con su apariencia REAL (forma, color, textura, ángulo de las fotos de referencia).
- Podés ubicar el producto en un contexto de uso o lifestyle, pero su forma DEBE ser fiel a la referencia.
- NO generes un producto inventado. NO cambies su silueta, proporciones ni detalles.
- El producto debe ocupar un lugar prominente en la composición.`
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

function buildProductFoundation(aspectRatio: PostAspectRatio, originalAR?: string): string {
  const isVertical = aspectRatio === '9:16'
  const isSquare = originalAR === '1:1'
  const formatLabel = isSquare ? 'cuadrado (1:1)' : isVertical ? 'vertical (9:16)' : 'vertical (3:4)'

  return `═══════════════════════════════════════════════
REGLA ABSOLUTA — FIDELIDAD DEL PRODUCTO (NO NEGOCIABLE)
═══════════════════════════════════════════════
Se adjuntan fotos del PRODUCTO REAL del usuario.
- El producto DEBE verse EXACTAMENTE como en las fotos de referencia: misma forma, silueta, color, textura, proporciones, detalles y acabados.
- NO inventes, NO rediseñes, NO reimagines, NO estilices el producto. Usa la referencia como fuente de verdad absoluta.
- NO cartoon, NO 3D fake, NO ilustración, NO vectorización. El resultado debe ser FOTORREALISTA.
- La forma del producto NO se modifica bajo ninguna circunstancia.
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

export function buildProductPrompt(
  subStyle: string,
  aspectRatio: PostAspectRatio | '1:1',
  language: string,
  backgroundDescription?: string
): string | null {
  const layoutBuilder = PRODUCT_LAYOUT_BUILDERS[subStyle]
  if (!layoutBuilder) return null

  const normalizedAR: PostAspectRatio = aspectRatio === '1:1' ? '3:4' : aspectRatio
  const foundation = buildProductFoundation(normalizedAR, aspectRatio)
  const layout = layoutBuilder(normalizedAR, backgroundDescription)

  const formatOverride = aspectRatio === '1:1'
    ? `FORMATO OBLIGATORIO: Cuadrado 1:1 (1080×1080). La imagen DEBE ser perfectamente cuadrada.\n\n`
    : ''

  return `${formatOverride}${foundation}${layout}

GENERA LA IMAGEN. NO generes texto descriptivo ni justificación. Devuelve SOLO la imagen resultante.`
}
