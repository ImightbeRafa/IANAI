/**
 * Deterministic SCENE RECIPE for ad/post first-gen and enhance scene passes.
 * Derives a complete photographed place from niche / offer / script —
 * not a random gym/office, and never a studio void / podium void.
 */

export type SceneNiche =
  | 'beauty'
  | 'skincare'
  | 'food'
  | 'fashion'
  | 'fitness'
  | 'home'
  | 'tech'
  | 'service'
  | 'digital'
  | 'physical'

export type SceneRecipeInput = {
  language?: string | null
  postStyle?: string | null
  productSubStyle?: string | null
  hasSceneRef?: boolean
  niche?: string | null
  category?: string | null
  offerName?: string | null
  scriptContext?: string | null
  businessContext?: string | null
}

const STUDIO_VOID_BAN_ES =
  'PROHIBIDO: fondo limpio / papel seamless / blanco puro / cyclorama / podio de mármol en vacío oscuro / bokeh de stock solo / producto flotando sin lugar completo.'
const STUDIO_VOID_BAN_EN =
  'FORBIDDEN: seamless paper / pure white / cyclorama / marble podium in a dark void / stock bokeh alone / floating product without a complete place.'

const BEAUTY_RE =
  /\b(beauty|belleza|skincare|piel|acne|acn[eé]|parche|patch|serum|crema|cosmetic|maquillaje|makeup|dermal|rostro|cara)\b/i
const FOOD_RE =
  /\b(food|comida|restaurant|restaurante|caf[eé]|bebida|drink|cocina|kitchen|chef|snack)\b/i
const FASHION_RE =
  /\b(fashion|moda|ropa|indumentaria|apparel|zapat|shoe|accesorio|jewelry|joyer)\b/i
const FITNESS_RE =
  /\b(fitness|gym|gimnasio|workout|entrenamiento|yoga|deporte|sport|protein)\b/i
const HOME_RE =
  /\b(home|hogar|casa|limpieza|cleaning|muebles|furniture|decor)\b/i
const TECH_RE =
  /\b(tech|gadget|electr[oó]nic|phone|tel[eé]fono|laptop|aud[ií]fono|headphones)\b/i
const DIGITAL_RE =
  /\b(curso|course|digital|saas|app|software|ebook|online)\b/i
const SERVICE_RE =
  /\b(servicio|service|consulta|coach|cl[ií]nica|clinic|spa|sal[oó]n)\b/i

export function inferSceneNiche(options: {
  niche?: string | null
  category?: string | null
  offerName?: string | null
  scriptContext?: string | null
  businessContext?: string | null
}): SceneNiche {
  const explicit = (options.niche || '').toLowerCase().trim()
  if (explicit === 'food') return 'food'
  if (explicit === 'fashion') return 'fashion'
  if (explicit === 'service') return 'service'
  if (explicit === 'digital') return 'digital'
  if (explicit === 'physical' || explicit === 'beauty' || explicit === 'skincare') {
    // Fall through to text cues for physical; beauty keywords win.
  }

  const blob = [
    options.category,
    options.offerName,
    options.scriptContext,
    options.businessContext,
    explicit,
  ]
    .filter(Boolean)
    .join(' ')

  if (BEAUTY_RE.test(blob)) return /parche|patch|acne|acn[eé]|dermal|piel|skincare/i.test(blob)
    ? 'skincare'
    : 'beauty'
  if (FOOD_RE.test(blob)) return 'food'
  if (FASHION_RE.test(blob)) return 'fashion'
  if (FITNESS_RE.test(blob)) return 'fitness'
  if (HOME_RE.test(blob)) return 'home'
  if (TECH_RE.test(blob)) return 'tech'
  if (DIGITAL_RE.test(blob)) return 'digital'
  if (SERVICE_RE.test(blob)) return 'service'
  if (explicit === 'physical') return 'physical'
  return 'physical'
}

type PlaceSpec = {
  locationEs: string
  locationEn: string
  timeEs: string
  timeEn: string
  keyEs: string
  keyEn: string
  fillEs: string
  fillEn: string
  rimEs: string
  rimEn: string
  objectsEs: string[]
  objectsEn: string[]
}

const PLACE_BY_NICHE: Record<SceneNiche, PlaceSpec> = {
  skincare: {
    locationEs: 'tocador de baño real con espejo y mesada',
    locationEn: 'real bathroom vanity with mirror and counter',
    timeEs: 'noche temprana, luz cálida de interior',
    timeEn: 'early night, warm interior light',
    keyEs: 'lámpara de tocador / luz de espejo a 45°',
    keyEn: 'vanity / mirror light at 45°',
    fillEs: 'rebote suave desde la pared opuesta',
    fillEn: 'soft bounce from the opposite wall',
    rimEs: 'borde sutil desde la luz del pasillo / ventana',
    rimEn: 'subtle rim from hallway / window spill',
    objectsEs: ['espejo con marco', 'vaso con cepillos', 'toalla doblada', 'frasco de crema', 'luz de tocador', 'azulejo o mármol real'],
    objectsEn: ['framed mirror', 'cup with brushes', 'folded towel', 'cream jar', 'vanity light', 'real tile or marble'],
  },
  beauty: {
    locationEs: 'vanity de dormitorio / tocador con espejo',
    locationEn: 'bedroom vanity with mirror',
    timeEs: 'atardecer interior, luz cálida',
    timeEn: 'indoor dusk, warm light',
    keyEs: 'luz de ventana lateral suave',
    keyEn: 'soft side window light',
    fillEs: 'fill cálido de lámpara de mesa',
    fillEn: 'warm table-lamp fill',
    rimEs: 'rim tenue en bordes del producto',
    rimEn: 'soft rim on product edges',
    objectsEs: ['espejo', 'joyero', 'perfume', 'tela de lino', 'planta chica', 'lámpara de mesa'],
    objectsEn: ['mirror', 'jewelry tray', 'perfume', 'linen cloth', 'small plant', 'table lamp'],
  },
  food: {
    locationEs: 'mesada de cocina real con utensilios',
    locationEn: 'real kitchen counter with utensils',
    timeEs: 'mañana o golden hour de cocina',
    timeEn: 'morning or kitchen golden hour',
    keyEs: 'luz de ventana de cocina',
    keyEn: 'kitchen window key',
    fillEs: 'rebote desde la mesada clara',
    fillEn: 'bounce from a light countertop',
    rimEs: 'highlight en vapor / bordes',
    rimEn: 'edge highlight / steam catchlight',
    objectsEs: ['tabla de madera', 'utensilio', 'servilleta de tela', 'ingrediente fresco', 'vaso', 'luz natural'],
    objectsEn: ['wood board', 'utensil', 'cloth napkin', 'fresh ingredient', 'glass', 'natural light'],
  },
  fashion: {
    locationEs: 'dormitorio / boutique con percheros',
    locationEn: 'bedroom / boutique with racks',
    timeEs: 'luz de día editorial',
    timeEn: 'editorial daylight',
    keyEs: 'luz de ventana grande',
    keyEn: 'large window key',
    fillEs: 'fill suave de pared clara',
    fillEn: 'soft fill from a light wall',
    rimEs: 'rim en texturas de tela',
    rimEn: 'rim on fabric textures',
    objectsEs: ['percha', 'espejo de cuerpo', 'bolso', 'zapatos', 'planta', 'silla'],
    objectsEn: ['hanger', 'full-length mirror', 'bag', 'shoes', 'plant', 'chair'],
  },
  fitness: {
    locationEs: 'rincón de gym en casa / locker con mat',
    locationEn: 'home-gym corner / locker with mat',
    timeEs: 'mañana activa, luz fresca',
    timeEn: 'active morning, cool light',
    keyEs: 'luz de techo / ventana alta',
    keyEn: 'overhead / high window key',
    fillEs: 'fill neutro del espacio',
    fillEn: 'neutral room fill',
    rimEs: 'rim en botella / equipo',
    rimEn: 'rim on bottle / gear',
    objectsEs: ['mat', 'toalla', 'botella de agua', 'pesas livianas', 'locker', 'zapatillas'],
    objectsEn: ['mat', 'towel', 'water bottle', 'light weights', 'locker', 'sneakers'],
  },
  home: {
    locationEs: 'living / estantería de hogar real',
    locationEn: 'real living room / shelf',
    timeEs: 'tarde con luz de ventana',
    timeEn: 'afternoon window light',
    keyEs: 'luz lateral de ventana',
    keyEn: 'side window key',
    fillEs: 'fill cálido de ambiente',
    fillEn: 'warm ambient fill',
    rimEs: 'rim suave en bordes',
    rimEn: 'soft edge rim',
    objectsEs: ['estante', 'libro', 'planta', 'marco', 'tela', 'lámpara'],
    objectsEn: ['shelf', 'book', 'plant', 'frame', 'fabric', 'lamp'],
  },
  tech: {
    locationEs: 'escritorio de trabajo real',
    locationEn: 'real work desk',
    timeEs: 'noche de trabajo con lámpara',
    timeEn: 'evening desk with lamp',
    keyEs: 'lámpara de escritorio a 45°',
    keyEn: 'desk lamp at 45°',
    fillEs: 'luz de pantalla / monitor suave',
    fillEn: 'soft monitor spill',
    rimEs: 'rim cool en metal / plástico',
    rimEn: 'cool rim on metal / plastic',
    objectsEs: ['laptop', 'cuaderno', 'cable ordenado', 'taza', 'lámpara', 'mouse pad'],
    objectsEn: ['laptop', 'notebook', 'tidy cable', 'mug', 'lamp', 'mouse pad'],
  },
  digital: {
    locationEs: 'escritorio con laptop abierta mostrando resultado',
    locationEn: 'desk with open laptop showing a result',
    timeEs: 'tarde de estudio',
    timeEn: 'afternoon study light',
    keyEs: 'luz de ventana + pantalla',
    keyEn: 'window + screen key',
    fillEs: 'fill neutro de habitación',
    fillEn: 'neutral room fill',
    rimEs: 'rim en bordes del dispositivo',
    rimEn: 'rim on device edges',
    objectsEs: ['laptop', 'cuaderno', 'auriculares', 'planta', 'lámpara', 'taza'],
    objectsEn: ['laptop', 'notebook', 'headphones', 'plant', 'lamp', 'mug'],
  },
  service: {
    locationEs: 'recepción / consultorio limpio y real',
    locationEn: 'real clean reception / consulting room',
    timeEs: 'día laboral, luz suave',
    timeEn: 'workday soft light',
    keyEs: 'luz de techo difusa',
    keyEn: 'soft overhead key',
    fillEs: 'fill de ventana lateral',
    fillEn: 'side window fill',
    rimEs: 'rim sutil en objetos de confianza',
    rimEn: 'subtle rim on trust props',
    objectsEs: ['silla', 'escritorio', 'planta', 'carpeta', 'luz', 'detalle de marca'],
    objectsEn: ['chair', 'desk', 'plant', 'folder', 'light', 'brand detail'],
  },
  physical: {
    locationEs: 'mesada / estante de uso real del producto',
    locationEn: 'real-use counter / shelf for the product',
    timeEs: 'luz de día natural',
    timeEn: 'natural daylight',
    keyEs: 'luz de ventana a 45°',
    keyEn: 'window key at 45°',
    fillEs: 'rebote suave del entorno',
    fillEn: 'soft environmental bounce',
    rimEs: 'rim que separa el producto del fondo real',
    rimEn: 'rim separating product from the real background',
    objectsEs: ['superficie de uso', 'objeto complementario', 'planta o tela', 'luz de ambiente', 'detalle de profundidad', 'sombra de contacto'],
    objectsEn: ['use-surface', 'supporting object', 'plant or cloth', 'ambient light', 'depth detail', 'contact shadow'],
  },
}

export function wantsStudioHeroScene(options: {
  postStyle?: string | null
  productSubStyle?: string | null
}): boolean {
  return options.productSubStyle === 'studio-hero' || options.productSubStyle === 'podium'
}

export function wantsCompletePhotographedEnvironment(options: {
  postStyle?: string | null
  productSubStyle?: string | null
}): boolean {
  if (wantsStudioHeroScene(options)) return false
  const style = (options.postStyle || '').trim()
  if (style === 'product' || style === 'logo') return false
  // Ads / organic / default (including unset) → complete place.
  return true
}

/**
 * Emit a SCENE RECIPE block. Empty string for studio-hero / logo-only paths.
 */
export function buildSceneRecipe(options: SceneRecipeInput): string {
  if (!wantsCompletePhotographedEnvironment(options)) return ''

  const es = options.language !== 'en'
  const niche = inferSceneNiche(options)
  const place = PLACE_BY_NICHE[niche]
  const objects = (es ? place.objectsEs : place.objectsEn).slice(0, 6)
  const ban = es ? STUDIO_VOID_BAN_ES : STUDIO_VOID_BAN_EN

  const sceneRefLine = options.hasSceneRef
    ? (es
      ? 'Escena ref: adaptá lugar/luz/gente de la referencia de escena; no robes su producto.'
      : 'Scene ref: adapt place/light/people from the scene reference; do not steal its product.')
    : (es
      ? 'Sin ref de escena: usá ESTA receta (derivada del nicho/oferta/guion). No inventes un gym u oficina al azar.'
      : 'No scene ref: use THIS recipe (from niche/offer/script). Do not invent a random gym or office.')

  if (es) {
    return `SCENE RECIPE (NO RENDERIZAR COMO TEXTO):
- Lugar: ${place.locationEs}
- Momento del día: ${place.timeEs}
- Key light: ${place.keyEs}
- Fill: ${place.fillEs}
- Rim: ${place.rimEs}
- Props de set (3–6): ${objects.join(', ')}
- Planos de profundidad: primer plano / medio / fondo con aire real
- Sombras de contacto: suaves, anclando el producto al set
- Luz del producto: DEBE coincidir con el entorno (misma dirección y temperatura)
${sceneRefLine}
${ban}
Objetivo: entorno fotografiado completo — un lugar real, no un vacío de estudio.
`
  }

  return `SCENE RECIPE (DO NOT RENDER AS TEXT):
- Location: ${place.locationEn}
- Time of day: ${place.timeEn}
- Key light: ${place.keyEn}
- Fill: ${place.fillEn}
- Rim: ${place.rimEn}
- Set objects (3–6): ${objects.join(', ')}
- Depth planes: foreground / mid / background with real air
- Contact shadows: soft, grounding the product in the set
- Product light: MUST match the environment (same direction and color temperature)
${sceneRefLine}
${ban}
Goal: a complete photographed environment — a real place, not a studio void.
`
}

export function studioVoidLanguageAbsent(text: string): boolean {
  // Affirmative studio-void *instructions* must be absent. Ban/goal lines that
  // forbid voids are expected and filtered out.
  const affirmative = text
    .split('\n')
    .filter((line) => {
      const l = line.toLowerCase()
      if (/prohibido|forbidden|no un |not a |nunca |never /i.test(l)) return false
      if (/objetivo:|goal:/i.test(l)) return false
      return true
    })
    .join('\n')
    .toLowerCase()

  const forbidden = [
    'fondo limpio',
    'seamless paper',
    'pure white',
    'cyclorama',
    'studio void',
    'vacío de estudio',
    'marble podium in a dark void',
    'podio de mármol en vacío',
  ]
  return !forbidden.some((phrase) => affirmative.includes(phrase))
}
