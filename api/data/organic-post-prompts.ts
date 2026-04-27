// =============================================
// ORGANIC POST PROMPTS
// Carousel (2–10 slides) + single image formats for top-of-funnel content.
// Driven by brand_voice from the brand kit for typography/color/layout direction.
// Separate from image-presets.ts (which is sales-oriented headline+bullets+CTA cards).
// =============================================

import type { CTAStrength } from './organic-script-prompts.js'

// Organic posts support square (for carousels) in addition to the existing 9:16 / 3:4.
export type OrganicAspectRatio = '1:1' | '4:5' | '9:16' | '3:4'

export type OrganicCarouselSubtype =
  | 'educational-list'
  | 'how-to-steps'
  | 'before-after'
  | 'myth-vs-fact'

export type OrganicSingleSubtype =
  | 'quote-motivational'
  | 'infographic'
  | 'product-showcase-organic'
  | 'aesthetic-brand'

export type OrganicSubtype = OrganicCarouselSubtype | OrganicSingleSubtype

export type SlideRole = 'hook' | 'body' | 'cta' | 'recap'

export interface CarouselSlidePlan {
  index: number
  role: SlideRole
  headline: string
  body?: string
  note?: string
}

export type BrandVoice = 'professional' | 'playful' | 'luxury' | 'bold' | 'minimal' | 'warm'

// =============================================
// BRAND VOICE → VISUAL DIRECTION
// Drives typography, layout rhythm, color treatment, textures per voice.
// Source of truth for the "don't output generic" rule.
// =============================================
const BRAND_VOICE_STYLE: Record<BrandVoice, { es: string; en: string }> = {
  professional: {
    es: `DIRECCIÓN VISUAL — VOZ PROFESIONAL:
- Tipografía: sans geométrica o serif moderna (estilo Inter / Söhne / Tiempos). Tracking cerrado, jerarquía marcada con peso, no con tamaño extremo.
- Layout: grid limpio, abundante whitespace, alineación izquierda estricta, sin asimetrías.
- Color: dominante (60–70%) en color primario sobrio, 1 acento reservado para dato clave o icono.
- Textura: sombras sutiles, divisores finos, iconos linear-weight. PROHIBIDO stickers, emojis o bursts.
- Feeling: consultoría senior, tech editorial, LinkedIn premium.`,
    en: `VISUAL DIRECTION — PROFESSIONAL VOICE:
- Typography: geometric sans or modern serif (Inter / Söhne / Tiempos style). Tight tracking, hierarchy through weight, not extreme size.
- Layout: clean grid, abundant whitespace, strict left alignment, no asymmetry.
- Color: dominant (60–70%) in a sober primary color, 1 accent reserved for key data or icon.
- Texture: subtle shadows, thin dividers, linear-weight icons. NO stickers, emojis, or bursts.
- Feeling: senior consulting, tech editorial, premium LinkedIn.`,
  },
  playful: {
    es: `DIRECCIÓN VISUAL — VOZ PLAYFUL:
- Tipografía: rounded sans o display amigable (estilo Nunito / Bricolage Grotesque / Recoleta). Tamaños jugosos, variación de peso entre líneas.
- Layout: off-grid controlado, capas suaves, rotaciones leves (2–4°), elementos superpuestos con orden.
- Color: paleta saturada pero armónica, 2–3 colores activos, acento cálido.
- Textura: stickers mínimos, doodles finos, squiggles, highlights tipo marker. PROHIBIDO bursts agresivos o clipart barato.
- Feeling: brand moderno tipo Notion / Duolingo / Mailchimp.`,
    en: `VISUAL DIRECTION — PLAYFUL VOICE:
- Typography: rounded sans or friendly display (Nunito / Bricolage Grotesque / Recoleta style). Juicy sizes, weight variation between lines.
- Layout: controlled off-grid, soft layers, slight rotations (2–4°), overlapping elements with order.
- Color: saturated but harmonic palette, 2–3 active colors, warm accent.
- Texture: minimal stickers, thin doodles, squiggles, marker-style highlights. NO aggressive bursts or cheap clipart.
- Feeling: modern brand like Notion / Duolingo / Mailchimp.`,
  },
  luxury: {
    es: `DIRECCIÓN VISUAL — VOZ LUXURY:
- Tipografía: serif editorial de alto contraste (estilo Cormorant Garamond / Playfair / Canela). Espaciado amplio, cursivas controladas.
- Layout: composición asimétrica, whitespace generoso, elementos anclados fuera del centro, rule-of-thirds.
- Color: paleta mutada (cream, off-black, dusty tones), acento en dorado / bronce / burgundy.
- Textura: grano sutil, degradados casi imperceptibles, sombras suaves editoriales.
- Feeling: Vogue / Aesop / Fenty / Net-a-Porter. Menos es muchísimo más.`,
    en: `VISUAL DIRECTION — LUXURY VOICE:
- Typography: high-contrast editorial serif (Cormorant Garamond / Playfair / Canela style). Ample letter-spacing, controlled italics.
- Layout: asymmetric composition, generous whitespace, elements anchored off-center, rule-of-thirds.
- Color: muted palette (cream, off-black, dusty tones), accent in gold / bronze / burgundy.
- Texture: subtle grain, nearly imperceptible gradients, soft editorial shadows.
- Feeling: Vogue / Aesop / Fenty / Net-a-Porter. Less is way more.`,
  },
  bold: {
    es: `DIRECCIÓN VISUAL — VOZ BOLD:
- Tipografía: display pesado o condensado (estilo Syne / Bebas Neue / Drukaria / Fraunces Black). Tamaños grandes, tracking ajustado.
- Layout: full-bleed color, bloques de texto ocupando 50%+ del área, contraste agresivo.
- Color: primario saturado dominante, acento complementario alto contraste.
- Textura: sombras duras / drop-shadow offset, formas cortadas (cut-out), stickers geométricos, sin gradientes suaves.
- Feeling: streetwear, brand statement, Off-White / Patagonia cover / bold editorial.`,
    en: `VISUAL DIRECTION — BOLD VOICE:
- Typography: heavy display or condensed (Syne / Bebas Neue / Drukaria / Fraunces Black style). Large sizes, tight tracking.
- Layout: full-bleed color, text blocks taking 50%+ of area, aggressive contrast.
- Color: saturated dominant primary, high-contrast complementary accent.
- Texture: hard shadows / drop-shadow offset, cut-out shapes, geometric stickers, no soft gradients.
- Feeling: streetwear, brand statement, Off-White / Patagonia cover / bold editorial.`,
  },
  minimal: {
    es: `DIRECCIÓN VISUAL — VOZ MINIMAL:
- Tipografía: sans thin / light (estilo Neue Haas / ABC Favorit Light). Tracking amplio, 2 tamaños máximo.
- Layout: whitespace máximo, único foco visual por slide, alineación central o a un tercio.
- Color: monocromo o bicolor extremo (blanco + 1 color), sin gradientes.
- Textura: NADA. Sin sombras, sin stickers, sin bordes. Planitud absoluta.
- Feeling: Muji / Apple / Kinfolk. Respirar, no llenar.`,
    en: `VISUAL DIRECTION — MINIMAL VOICE:
- Typography: thin / light sans (Neue Haas / ABC Favorit Light style). Ample tracking, 2 sizes max.
- Layout: max whitespace, one visual focus per slide, center or third alignment.
- Color: monochrome or extreme bi-color (white + 1 color), no gradients.
- Texture: NOTHING. No shadows, no stickers, no borders. Absolute flatness.
- Feeling: Muji / Apple / Kinfolk. Breathe, don't fill.`,
  },
  warm: {
    es: `DIRECCIÓN VISUAL — VOZ WARM:
- Tipografía: humanist sans con curvas orgánicas (estilo Söhne / General Sans / PP Neue Montreal).
- Layout: curvas suaves en contenedores, radios de esquina generosos, sin bordes duros.
- Color: paleta cálida (terracota, crema, oliva, arena), gradientes suaves sutiles.
- Textura: iluminación cálida sutil, imperfecciones orgánicas leves (no grunge).
- Feeling: wellness, slow-brand, comunidad, Nike Run Club / Glossier / Oatly humano.`,
    en: `VISUAL DIRECTION — WARM VOICE:
- Typography: humanist sans with organic curves (Söhne / General Sans / PP Neue Montreal style).
- Layout: soft curves in containers, generous corner radii, no hard borders.
- Color: warm palette (terracotta, cream, olive, sand), subtle soft gradients.
- Texture: warm subtle lighting, slight organic imperfections (not grunge).
- Feeling: wellness, slow-brand, community, human Nike Run Club / Glossier / Oatly.`,
  },
}

/**
 * Returns the brand-voice direction block. Falls back to 'minimal' when voice is unknown/null.
 */
export function buildBrandVoiceDirection(voice: string | null | undefined, language: 'en' | 'es'): string {
  const key = (voice && (voice.toLowerCase() as BrandVoice)) || 'minimal'
  const resolved: BrandVoice = (['professional', 'playful', 'luxury', 'bold', 'minimal', 'warm'] as BrandVoice[]).includes(key) ? key : 'minimal'
  return BRAND_VOICE_STYLE[resolved][language]
}

// =============================================
// CTA STRENGTH → VISUAL CTA DIRECTIVE
// Organic CTAs are visually softer than sales CTAs — no aggressive button bars.
// =============================================
function buildCTAVisualDirective(strength: CTAStrength, language: 'en' | 'es'): string {
  const isEs = language === 'es'
  switch (strength) {
    case 'none':
      return isEs
        ? `CTA VISUAL: NO incluir botón, badge de CTA ni barra de acción. El slide final cierra con un payoff textual breve o una imagen conclusiva. PROHIBIDO dibujar botones "Comprá", "Mandá mensaje", "Click aquí".`
        : `VISUAL CTA: Do NOT include a button, CTA badge, or action bar. The final slide closes with a short textual payoff or a conclusive image. FORBIDDEN to draw "Buy", "Message us", "Click here" buttons.`
    case 'soft':
      return isEs
        ? `CTA VISUAL SUAVE: si el subtipo pide un CTA visible, úsalo como texto pequeño en el último slide — "Seguí para más", "Guardá este post", "Compartí con alguien". NUNCA como botón grande estilo ad. Sin chevrons agresivos, sin "→ YA".`
        : `SOFT VISUAL CTA: if the subtype calls for a visible CTA, use small text on the final slide — "Follow for more", "Save this post", "Share with someone". NEVER a large ad-style button. No aggressive chevrons, no "→ NOW".`
    case 'brand_mention':
      return isEs
        ? `CTA VISUAL — MENCIÓN DE MARCA: en el último slide colocá el logo + una línea corta ("Así lo hacemos en [marca]"). Presentación editorial, NO botón comercial. El espectador debe sentirlo como firma, no como llamado a comprar.`
        : `VISUAL CTA — BRAND MENTION: on the final slide place the logo + one short line ("That's how we do it at [brand]"). Editorial presentation, NOT a commercial button. The viewer should feel it as a signature, not a sales call.`
    case 'sales':
    default:
      return isEs
        ? `CTA VISUAL DE VENTA: botón claro, legible, con acción directa ("Envianos un mensaje", "Pedí acá"). Mantenelo elegante pero funcional.`
        : `SALES VISUAL CTA: clear button, legible, with direct action ("Message us", "Order here"). Keep it elegant but functional.`
  }
}

// =============================================
// FOUNDATION (ORGANIC)
// Universal rules for organic posts — softer than the sales foundation.
// =============================================
function buildOrganicFoundation(
  aspectRatio: OrganicAspectRatio,
  language: 'en' | 'es',
  hasProductImages: boolean,
  voice: string | null | undefined,
  ctaStrength: CTAStrength
): string {
  const isEs = language === 'es'
  const langLabel = isEs ? 'ESPAÑOL' : 'ENGLISH'

  const arLabel = {
    '1:1': isEs ? 'cuadrado (1080×1080)' : 'square (1080×1080)',
    '4:5': isEs ? 'portrait 4:5 (1080×1350)' : 'portrait 4:5 (1080×1350)',
    '9:16': isEs ? 'vertical 9:16 (1080×1920)' : 'vertical 9:16 (1080×1920)',
    '3:4': isEs ? 'portrait 3:4 (1080×1440)' : 'portrait 3:4 (1080×1440)',
  }[aspectRatio]

  const langRule = isEs
    ? `═══════════════════════════════════════════════
REGLA #0 — IDIOMA (NO NEGOCIABLE)
═══════════════════════════════════════════════
TODOS los textos visibles en la imagen DEBEN estar en: ${langLabel}.
PROHIBIDO mezclar idiomas, PROHIBIDO placeholder / lorem ipsum.
═══════════════════════════════════════════════`
    : `═══════════════════════════════════════════════
RULE #0 — LANGUAGE (NON-NEGOTIABLE)
═══════════════════════════════════════════════
ALL visible text in the image MUST be in: ${langLabel}.
FORBIDDEN to mix languages, FORBIDDEN placeholder / lorem ipsum.
═══════════════════════════════════════════════`

  const productRefRule = hasProductImages
    ? (isEs
      ? `═══════════════════════════════════════════════
REGLA #1 — FIDELIDAD DE PRODUCTO
═══════════════════════════════════════════════
Se adjuntan fotos del producto real. Reprodúcelo fielmente: forma, color, textura.
NO rediseñes, NO estilices, NO caricaturices. En contenido orgánico el producto se integra naturalmente (no como hero de anuncio).
═══════════════════════════════════════════════`
      : `═══════════════════════════════════════════════
RULE #1 — PRODUCT FIDELITY
═══════════════════════════════════════════════
Real product photos are attached. Reproduce them faithfully: form, color, texture.
Do NOT redesign, stylize, or cartoonify. In organic content the product integrates naturally (not as an ad hero).
═══════════════════════════════════════════════`)
    : ''

  const formatRule = isEs
    ? `FORMATO OBLIGATORIO: ${arLabel}. No uses otro aspect ratio.`
    : `MANDATORY FORMAT: ${arLabel}. Do not use any other aspect ratio.`

  const organicPhilosophy = isEs
    ? `FILOSOFÍA VISUAL — CONTENIDO ORGÁNICO:
Esto NO es un anuncio. NO es una tarjeta de venta con headline + bullets + botón CTA grande.
Es contenido nativo de Instagram/TikTok: editorial, aesthetic, shareable.
El espectador debe sentir valor antes que presión de compra.

REGLAS FUNDAMENTALES:
- Jerarquía tipográfica clara: 3 niveles (display / subhead / body). Sin excepciones.
- UN ancla visual por imagen: un elemento que atrape el ojo primero.
- Padding generoso: mínimo 8–10% de inset en todos los bordes (zona segura móvil).
- Color dominante: el primario ocupa 60%+ del peso visual. El acento SOLO en un foco.
- NO distribuyas colores uniformemente. UNO domina, los demás apoyan.
- PROHIBIDO textura pesada, bursts, gradientes arcoíris, clipart barato, múltiples fuentes decorativas.
- PROHIBIDO número de slide visible (1/N), dimensiones, anotaciones técnicas.`
    : `VISUAL PHILOSOPHY — ORGANIC CONTENT:
This is NOT an ad. NOT a sales card with headline + bullets + big CTA button.
It is native Instagram/TikTok content: editorial, aesthetic, shareable.
The viewer should feel value before purchase pressure.

FUNDAMENTAL RULES:
- Clear typographic hierarchy: 3 levels (display / subhead / body). No exceptions.
- ONE visual anchor per image: one element the eye goes to first.
- Generous padding: min 8–10% inset on all edges (mobile-safe zone).
- Dominant color: primary occupies 60%+ of visual weight. Accent ONLY on one focal point.
- Do NOT distribute colors evenly. ONE dominates, others support.
- FORBIDDEN heavy textures, bursts, rainbow gradients, cheap clipart, multiple decorative fonts.
- FORBIDDEN visible slide number (1/N), dimensions, technical annotations.`

  const voiceDirection = buildBrandVoiceDirection(voice, language)
  const ctaDirective = buildCTAVisualDirective(ctaStrength, language)

  return `${langRule}

${formatRule}

${productRefRule}

${organicPhilosophy}

${voiceDirection}

${ctaDirective}
`
}

// =============================================
// CAROUSEL SUBTYPE LAYOUTS
// Each builder returns the layout block for ONE slide of that subtype.
// =============================================
function buildCarouselSlideLayout(
  subtype: OrganicCarouselSubtype,
  role: SlideRole,
  slideIndex: number,
  totalSlides: number,
  language: 'en' | 'es'
): string {
  const isEs = language === 'es'
  const roleLabel = {
    hook: isEs ? 'SLIDE DE GANCHO (parar el scroll)' : 'HOOK SLIDE (stop the scroll)',
    body: isEs ? `SLIDE DE CUERPO (${slideIndex} de ${totalSlides})` : `BODY SLIDE (${slideIndex} of ${totalSlides})`,
    cta: isEs ? 'SLIDE DE CIERRE / CTA' : 'CLOSING / CTA SLIDE',
    recap: isEs ? 'SLIDE DE RECAP' : 'RECAP SLIDE',
  }[role]

  const hookContrastNote = role === 'hook'
    ? (isEs
      ? 'Este slide DEBE tener el mayor contraste visual de todo el carrusel. Es la parada del scroll.'
      : 'This slide MUST have the highest visual contrast of the entire carousel. It is the scroll stopper.')
    : ''

  const consistencyNote = slideIndex > 1
    ? (isEs
      ? `CONSISTENCIA VISUAL: este slide forma parte de un carrusel. Mantené IDÉNTICO el grid, tipografías, colores, tamaños y estilos respecto al slide 1 adjunto como referencia. SOLO cambia el contenido textual y el acento específico de este rol.`
      : `VISUAL CONSISTENCY: this slide is part of a carousel. Keep IDENTICAL the grid, typography, colors, sizes, and styles relative to slide 1 attached as reference. ONLY change the textual content and the role-specific accent.`)
    : ''

  // Subtype-specific composition guidance
  const SUBTYPE_COMPOSITION: Record<OrganicCarouselSubtype, { es: string; en: string }> = {
    'educational-list': {
      es: `SUBTIPO: LISTA EDUCATIVA.
- Slide hook: título bold con número destacado ("7 cosas que no sabías sobre X"). El número vive como elemento visual (no como texto plano).
- Slides body: UN número grande (1, 2, 3...) como ancla visual + título corto del punto + 1–2 líneas de desarrollo. Máximo 25 palabras.
- Slide CTA: síntesis memorable + CTA suave textual.
- Grid obligatorio idéntico entre slides body (solo cambia el número y el texto).`,
      en: `SUBTYPE: EDUCATIONAL LIST.
- Hook slide: bold title with prominent number ("7 things you didn't know about X"). The number lives as a visual element (not flat text).
- Body slides: ONE large number (1, 2, 3...) as visual anchor + short point title + 1–2 lines of development. Max 25 words.
- CTA slide: memorable synthesis + soft textual CTA.
- Mandatory identical grid across body slides (only the number and text change).`,
    },
    'how-to-steps': {
      es: `SUBTIPO: HOW-TO / PASOS.
- Slide hook: problema o promesa en verbo de acción ("Así enseñas X en 4 pasos").
- Slides body: icono o miniatura arriba + "PASO N" tag + verbo de acción en headline + 1–2 líneas descriptivas. Los pasos deben sentirse secuenciales.
- Opcional visual de continuación (flecha fina / línea) sugiriendo el paso siguiente.
- Slide CTA: resultado prometido + CTA suave.`,
      en: `SUBTYPE: HOW-TO / STEPS.
- Hook slide: problem or promise with action verb ("How to X in 4 steps").
- Body slides: icon or thumbnail on top + "STEP N" tag + action-verb headline + 1–2 descriptive lines. Steps must feel sequential.
- Optional continuation visual (thin arrow / line) suggesting the next step.
- CTA slide: promised result + soft CTA.`,
    },
    'before-after': {
      es: `SUBTIPO: ANTES / DESPUÉS.
- Slide 1 (ANTES): visual apagado, baja saturación, problema claro. Tag "ANTES" discreto.
- Slide 2 (opcional TRANSICIÓN): "Esto cambió todo" o similar, con elemento de transición visual.
- Slide final (DESPUÉS): visual elevado, alta saturación del color primario, solución clara. Tag "DESPUÉS" con acento.
- CTA: mínimo, editorial.`,
      en: `SUBTYPE: BEFORE / AFTER.
- Slide 1 (BEFORE): muted visual, low saturation, clear problem. Subtle "BEFORE" tag.
- Slide 2 (optional TRANSITION): "This changed everything" or similar, with a visual transition element.
- Final slide (AFTER): elevated visual, high saturation of the primary color, clear solution. "AFTER" tag with accent.
- CTA: minimal, editorial.`,
    },
    'myth-vs-fact': {
      es: `SUBTIPO: MITO vs REALIDAD.
- Slide hook: título "Mitos sobre X — desmentidos" con iconografía sutil de check/cross.
- Slides body: alternan. Cada slide dividido en 2 zonas:
    • "MITO" (zona superior, color de alerta suave tipo terracota / coral, NO rojo chillón)
    • "REALIDAD" (zona inferior, color primario de marca, más peso visual)
- UN slide por par mito-realidad (o 2 si el contenido lo amerita, pero mantené consistencia).
- Slide final: takeaway + CTA suave.`,
      en: `SUBTYPE: MYTH vs FACT.
- Hook slide: title "Myths about X — debunked" with subtle check/cross iconography.
- Body slides: alternate. Each slide split in 2 zones:
    • "MYTH" (top zone, soft warning color like terracotta / coral, NOT loud red)
    • "FACT" (bottom zone, brand primary color, more visual weight)
- ONE slide per myth-fact pair (or 2 if content warrants, but keep consistency).
- Final slide: takeaway + soft CTA.`,
    },
  }

  return `${isEs ? 'ROL DEL SLIDE' : 'SLIDE ROLE'}: ${roleLabel}
${hookContrastNote}

${SUBTYPE_COMPOSITION[subtype][language]}

${consistencyNote}`
}

// =============================================
// SINGLE IMAGE SUBTYPE LAYOUTS
// =============================================
function buildSingleLayout(subtype: OrganicSingleSubtype, language: 'en' | 'es'): string {
  const isEs = language === 'es'
  const layouts: Record<OrganicSingleSubtype, { es: string; en: string }> = {
    'quote-motivational': {
      es: `SUBTIPO: CITA / MOTIVACIONAL.
- El texto de la cita OCUPA 60–70% del canvas. Es el protagonista absoluto.
- Atribución pequeña, discreta, abajo-derecha.
- Fondo: color primario de marca, gradiente atmosférico sutil, o textura mínima.
- Opcional: forma geométrica sutil o línea fina detrás del texto como ancla visual.
- ZERO bullets, ZERO CTA grande. La cita habla sola.`,
      en: `SUBTYPE: QUOTE / MOTIVATIONAL.
- Quote text TAKES 60–70% of canvas. It is the absolute protagonist.
- Attribution small, discreet, bottom-right.
- Background: brand primary color, subtle atmospheric gradient, or minimal texture.
- Optional: subtle geometric shape or thin line behind the text as visual anchor.
- ZERO bullets, ZERO large CTA. The quote speaks alone.`,
    },
    'infographic': {
      es: `SUBTIPO: INFOGRAFÍA.
- Titular claro arriba. No más de 8 palabras.
- Contenido en jerarquía visual: números grandes como ancla, etiquetas pequeñas.
- Usá colores de marca para categorizar (no para decorar).
- Iconos line-weight consistente. Si hay números, ellos dominan visualmente.
- Crédito de fuente minúsculo, abajo.`,
      en: `SUBTYPE: INFOGRAPHIC.
- Clear title on top. No more than 8 words.
- Content in visual hierarchy: large numbers as anchor, small labels.
- Use brand colors for categorization (not decoration).
- Consistent line-weight icons. If there are numbers, they dominate visually.
- Tiny source credit at bottom.`,
    },
    'product-showcase-organic': {
      es: `SUBTIPO: PRODUCT SHOWCASE ORGÁNICO.
- Producto como héroe (centrado o regla de tercios), iluminación editorial cálida.
- Headline corto y punchy encima (máximo 6 palabras). No bullets.
- UN callout de beneficio o precio, discreto.
- Logo de marca en posición consistente (abajo-izquierda o arriba-derecha).
- Feeling lifestyle, NO feeling ad card. El producto se ve como editorial de revista, no como publicidad.`,
      en: `SUBTYPE: ORGANIC PRODUCT SHOWCASE.
- Product as hero (centered or rule-of-thirds), warm editorial lighting.
- Short, punchy headline on top (max 6 words). No bullets.
- ONE benefit or price callout, discreet.
- Brand logo in consistent position (bottom-left or top-right).
- Lifestyle feeling, NOT ad-card feeling. The product looks like magazine editorial, not advertising.`,
    },
    'aesthetic-brand': {
      es: `SUBTIPO: AESTHETIC / BRAND STATEMENT.
- Full-bleed: color primario de marca cubre todo el canvas.
- Texto mínimo: logo + UNA línea (frase, palabra de marca, o statement).
- Alto craft: grano sutil, forma geométrica única, o layout editorial (split, tercios).
- El slide debe sentirse como una portada de magazine o cover art.
- ZERO bullets, ZERO descripción, ZERO CTA.`,
      en: `SUBTYPE: AESTHETIC / BRAND STATEMENT.
- Full-bleed: brand primary color covers the whole canvas.
- Minimal text: logo + ONE line (phrase, brand word, or statement).
- High craft: subtle grain, one geometric shape, or editorial layout (split, thirds).
- The slide must feel like a magazine cover or cover art.
- ZERO bullets, ZERO description, ZERO CTA.`,
    },
  }
  return layouts[subtype][language]
}

// =============================================
// PUBLIC API: CAROUSEL SLIDE PROMPT
// =============================================
export interface CarouselSlidePromptInput {
  subtype: OrganicCarouselSubtype
  slideIndex: number                     // 1-based
  totalSlides: number                    // 2..10
  slideRole: SlideRole
  slideContent: { headline: string; body?: string; note?: string }
  scriptContext?: string                 // raw script/idea text the user wants turned into a carousel
  productContext?: {
    name?: string
    type?: string
    category?: string
    description?: string
    audience?: string
    differentiation?: string
    result?: string
    objection?: string
    logistics?: string
  }
  aspectRatio: OrganicAspectRatio
  language: 'en' | 'es'
  hasProductImages: boolean
  brandVoice: string | null | undefined
  ctaStrength: CTAStrength
  hasReferenceSlide: boolean             // true for slides 2..N when slide 1 is passed as inline reference
}

export function buildOrganicCarouselPrompt(input: CarouselSlidePromptInput): string {
  const {
    subtype, slideIndex, totalSlides, slideRole, slideContent, scriptContext,
    productContext, aspectRatio, language, hasProductImages, brandVoice, ctaStrength, hasReferenceSlide,
  } = input
  const isEs = language === 'es'

  const foundation = buildOrganicFoundation(aspectRatio, language, hasProductImages, brandVoice, ctaStrength)
  const slideLayout = buildCarouselSlideLayout(subtype, slideRole, slideIndex, totalSlides, language)

  const referenceNote = hasReferenceSlide
    ? (isEs
      ? `\nIMAGEN DE REFERENCIA ADJUNTA: el slide 1 del carrusel se adjunta como referencia visual. COPIÁ su sistema (tipografía, paleta, grid, jerarquía). Solo cambia el contenido textual de este slide.`
      : `\nREFERENCE IMAGE ATTACHED: slide 1 of the carousel is attached as visual reference. COPY its system (typography, palette, grid, hierarchy). Only change this slide's textual content.`)
    : ''

  const contentBlock = isEs
    ? `CONTENIDO DE ESTE SLIDE:
- Titular: "${slideContent.headline}"${slideContent.body ? `\n- Cuerpo: "${slideContent.body}"` : ''}${slideContent.note ? `\n- Nota de diseño: ${slideContent.note}` : ''}`
    : `THIS SLIDE'S CONTENT:
- Headline: "${slideContent.headline}"${slideContent.body ? `\n- Body: "${slideContent.body}"` : ''}${slideContent.note ? `\n- Design note: ${slideContent.note}` : ''}`

  const scriptBlock = scriptContext
    ? (isEs
      ? `\nIDEA / GUIÓN FUENTE (para contexto, NO para renderizar literal):\n${scriptContext.slice(0, 1500)}`
      : `\nSOURCE IDEA / SCRIPT (for context, NOT to render literally):\n${scriptContext.slice(0, 1500)}`)
    : ''

  const productFacts = productContext ? [
    productContext.name ? (isEs ? `- Producto/marca: ${productContext.name}` : `- Product/brand: ${productContext.name}`) : '',
    productContext.type ? (isEs ? `- Tipo: ${productContext.type}` : `- Type: ${productContext.type}`) : '',
    productContext.category ? (isEs ? `- Categoria: ${productContext.category}` : `- Category: ${productContext.category}`) : '',
    productContext.description ? (isEs ? `- Descripcion: ${productContext.description}` : `- Description: ${productContext.description}`) : '',
    productContext.audience ? (isEs ? `- Audiencia: ${productContext.audience}` : `- Audience: ${productContext.audience}`) : '',
    productContext.differentiation ? (isEs ? `- Diferencial: ${productContext.differentiation}` : `- Differentiation: ${productContext.differentiation}`) : '',
    productContext.result ? (isEs ? `- Resultado prometido: ${productContext.result}` : `- Promised result: ${productContext.result}`) : '',
    productContext.objection ? (isEs ? `- Objecion clave: ${productContext.objection}` : `- Key objection: ${productContext.objection}`) : '',
    productContext.logistics ? (isEs ? `- Logistica/oferta: ${productContext.logistics}` : `- Logistics/offer: ${productContext.logistics}`) : '',
  ].filter(Boolean).join('\n') : ''

  const productBlock = productFacts
    ? (isEs
      ? `\nCONTEXTO REAL DEL PRODUCTO (usar para exactitud, NO inventar claims):\n${productFacts.slice(0, 1800)}`
      : `\nREAL PRODUCT CONTEXT (use for accuracy, do NOT invent claims):\n${productFacts.slice(0, 1800)}`)
    : ''

  const deliverable = isEs
    ? `ENTREGABLE:
Generá UNA imagen — el slide ${slideIndex} de ${totalSlides} — cumpliendo todo lo anterior. Sin número de slide visible, sin anotaciones técnicas, sin texto placeholder.`
    : `DELIVERABLE:
Generate ONE image — slide ${slideIndex} of ${totalSlides} — meeting all of the above. No visible slide number, no technical annotations, no placeholder text.`

  return `${foundation}

${slideLayout}
${referenceNote}

${contentBlock}
${scriptBlock}
${productBlock}

${deliverable}
`
}

// =============================================
// PUBLIC API: SINGLE IMAGE PROMPT
// =============================================
export interface SingleOrganicPromptInput {
  subtype: OrganicSingleSubtype
  content: { headline?: string; body?: string; quote?: string; attribution?: string }
  scriptContext?: string
  aspectRatio: OrganicAspectRatio
  language: 'en' | 'es'
  hasProductImages: boolean
  brandVoice: string | null | undefined
  ctaStrength: CTAStrength
}

export function buildOrganicSinglePrompt(input: SingleOrganicPromptInput): string {
  const { subtype, content, scriptContext, aspectRatio, language, hasProductImages, brandVoice, ctaStrength } = input
  const isEs = language === 'es'

  const foundation = buildOrganicFoundation(aspectRatio, language, hasProductImages, brandVoice, ctaStrength)
  const layout = buildSingleLayout(subtype, language)

  const contentParts: string[] = []
  if (content.quote) contentParts.push(isEs ? `- Cita: "${content.quote}"` : `- Quote: "${content.quote}"`)
  if (content.headline) contentParts.push(isEs ? `- Titular: "${content.headline}"` : `- Headline: "${content.headline}"`)
  if (content.body) contentParts.push(isEs ? `- Cuerpo: "${content.body}"` : `- Body: "${content.body}"`)
  if (content.attribution) contentParts.push(isEs ? `- Atribución: "${content.attribution}"` : `- Attribution: "${content.attribution}"`)

  const contentBlock = contentParts.length > 0
    ? (isEs ? `CONTENIDO:\n${contentParts.join('\n')}` : `CONTENT:\n${contentParts.join('\n')}`)
    : (isEs ? 'CONTENIDO: inferí del contexto abajo.' : 'CONTENT: infer from context below.')

  const scriptBlock = scriptContext
    ? (isEs
      ? `\nCONTEXTO (NO renderizar literal):\n${scriptContext.slice(0, 1500)}`
      : `\nCONTEXT (do NOT render literally):\n${scriptContext.slice(0, 1500)}`)
    : ''

  const deliverable = isEs
    ? `ENTREGABLE:\nGenerá UNA imagen cumpliendo todo lo anterior. Sin anotaciones técnicas, sin texto placeholder.`
    : `DELIVERABLE:\nGenerate ONE image meeting all of the above. No technical annotations, no placeholder text.`

  return `${foundation}

${layout}

${contentBlock}
${scriptBlock}

${deliverable}
`
}
