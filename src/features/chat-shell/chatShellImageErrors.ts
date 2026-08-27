/** Map provider/API image errors to bilingual user copy. Never surface raw Grok strings. */

const KNOWN: Array<{
  match: RegExp
  code: string
  es: string
  en: string
}> = [
  {
    match: /prompt length exceeds|maximum allowed length of\s*8000|grok_prompt_too_long|no pudimos adaptar el prompt para grok|demasiado largo para grok/i,
    code: 'grok_prompt_too_long',
    es: 'No pudimos adaptar el prompt para Grok (límite de longitud). Reintentá; si sigue fallando, acortá el copy o las instrucciones de marca.',
    en: 'We could not fit the prompt under Grok’s length limit. Retry; if it keeps failing, shorten the copy or brand instructions.',
  },
  {
    match: /xai api key not configured|grok[_ ]?api[_ ]?key|api key not configured/i,
    code: 'provider_key_missing',
    es: 'La generación de imágenes no está configurada en este entorno (falta la clave del proveedor). Avisá al equipo o reintentá más tarde.',
    en: 'Image generation is not configured in this environment (provider key missing). Contact the team or try again later.',
  },
  {
    match: /grok imagine generation failed|grok imagine/i,
    code: 'grok_failed',
    es: 'No pudimos generar la imagen con Grok. Reintentá en unos segundos o subí una foto del producto y probá de nuevo.',
    en: 'We could not generate the image with Grok. Retry in a few seconds, or upload a product photo and try again.',
  },
  {
    match: /at least one product image is required|se requiere al menos una imagen del producto/i,
    code: 'product_photo_required',
    es: 'Subí una foto del producto para este modo, o elegí “Crear sin referencias” en Anuncio.',
    en: 'Upload a product photo for this mode, or choose “Create without references” for Ad.',
  },
  {
    match: /could not load product reference|re-upload/i,
    code: 'bad_reference',
    es: 'No pudimos cargar la foto de referencia. Volvé a subirla e intentá de nuevo.',
    en: 'Could not load the reference photo. Re-upload it and try again.',
  },
  {
    match: /image limit reached|límite de imágenes/i,
    code: 'limit',
    es: 'Llegaste al límite de imágenes de tu plan.',
    en: 'You reached your plan’s image limit.',
  },
  {
    match: /demasiadas solicitudes|too many requests/i,
    code: 'rate_limit',
    es: 'Demasiadas solicitudes. Esperá unos segundos e intentá de nuevo.',
    en: 'Too many requests. Wait a few seconds and try again.',
  },
]

export function friendlyImageError(
  raw: string | null | undefined,
  language: 'es' | 'en' = 'es'
): string {
  const text = (raw || '').trim()
  if (!text) {
    return language === 'es'
      ? 'No se pudo generar la imagen. Reintentá en unos segundos.'
      : 'Image generation failed. Try again in a few seconds.'
  }
  for (const row of KNOWN) {
    if (row.match.test(text)) return language === 'es' ? row.es : row.en
  }
  // Never leak raw English provider banners into Spanish UI.
  if (language === 'es' && /^[A-Za-z0-9][A-Za-z0-9 .,_:\-()/]*$/.test(text) && /failed|error|invalid|required/i.test(text)) {
    return 'No se pudo generar la imagen. Reintentá en unos segundos o subí una foto del producto.'
  }
  return text
}
