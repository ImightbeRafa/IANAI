import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions'

/**
 * BUILD AD PROMPT — 3-Module Pipeline
 * 
 * Module A: Visual DNA Processor (product photos → visual identity description)
 * Module B: Cinematic Script Transformer (winning script → shot-by-shot breakdown)
 * Module C: Mother Prompt Fusion (Visual DNA + Cinematic Script → final video prompt)
 */

async function callGrok(apiKey: string, systemPrompt: string, userMessage: string, maxTokens = 1500): Promise<string> {
  const response = await fetch(XAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'grok-3-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.4,
      max_tokens: maxTokens
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Grok API error: ${response.status} - ${errorText}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('Empty response from Grok')
  return content
}

// ─── MODULE A: VISUAL DNA PROCESSOR ───────────────────────────────────────────
// Input: Product photos (descriptions/context)
// Output: Product Visual DNA block

const MODULE_A_SYSTEM = `Eres un analista visual experto en productos para publicidad.

Tu tarea es extraer el ADN VISUAL del producto a partir de las fotos/descripción proporcionada.

Debes generar un bloque de texto llamado "Product Visual DNA" que defina:
1. QUÉ ES el producto (categoría, tipo, forma)
2. CÓMO SE VE (colores exactos, texturas, materiales, acabados, tamaño relativo)
3. CÓMO DEBE verse SIEMPRE en video (ángulos favorables, iluminación ideal, contexto visual)
4. QUÉ NO se puede alterar (características visuales inmutables del producto real)

REGLAS:
- Sé extremadamente específico y descriptivo
- Solo describe lo que SE VE, no lo que el producto hace
- No inventes características que no estén en las fotos/descripción
- Usa lenguaje técnico visual (composición, color, textura, forma)
- Máximo 200 palabras
- Responde SOLO con el bloque de texto, sin títulos ni explicaciones`

// ─── MODULE B: CINEMATIC SCRIPT TRANSFORMER ──────────────────────────────────
// Input: Winning script (exact text, not editable)
// Output: Cinematic script with shot-by-shot breakdown

const MODULE_B_SYSTEM = `Eres un director cinematográfico especializado en anuncios de venta directa para redes sociales.

Tu tarea es convertir un guión narrativo de venta en un GUIÓN CINEMATOGRÁFICO SINCRONIZADO.

REGLA DE ORO: Cuando el guión dice X, el video DEBE mostrar X. Correspondencia 1:1 entre narración → imagen → acción.

PROCESO:
1. Lee el guión línea por línea
2. Divídelo en segmentos narrativos con tiempos exactos
3. Para cada segmento define UNA o DOS tomas específicas

PARA CADA SEGMENTO debes especificar:
- Tiempo: (ej: 0-3s)
- Narración: línea exacta del guión (NO modificar)
- Tipo de plano: (close-up, POV, wide, macro, medium shot, etc.)
- Qué se ve exactamente: descripción literal de la imagen
- Acción concreta: qué movimiento o cambio ocurre
- Subtítulo en pantalla: qué fragmento del guión aparece como texto

RESTRICCIONES:
❌ NO inventar escenas que no correspondan al texto
❌ NO mostrar algo distinto a lo que se dice
❌ NO interpretar libremente el mensaje
❌ NO agregar texto nuevo que no esté en el guión
✅ Traducir palabras → imágenes literales
✅ Forzar coherencia semántica
✅ Asegurar comprensión visual inmediata

Al final incluye:
- Orden y ritmo de cortes
- Prioridad visual (qué se debe entender sí o sí)

Responde SOLO con el guión cinematográfico estructurado, sin explicaciones adicionales.`

// ─── MODULE C: MOTHER PROMPT FUSION ──────────────────────────────────────────
// Input: Visual DNA + Cinematic Script + Original Script
// Output: Final structured prompt for video generation AI

const MODULE_C_SYSTEM = `Eres un ingeniero de prompts especializado en generación de video con IA para anuncios de venta directa.

Tu tarea es fusionar tres inputs en UN SOLO PROMPT FINAL optimizado para una IA de generación de video.

El prompt final DEBE contener estas secciones exactas:

1. VIDEO SPECS
- Duración: [según el guión]
- Formato: 9:16 (vertical, para redes sociales)
- Tipo: video de venta directa
- Estilo: realista, comercial, alta calidad

2. PRODUCT VISUAL DNA
- Pegar el ADN visual tal cual, sin reinterpretar

3. CINEMATIC SCRIPT
- Guión técnico escena por escena, sincronizado con el texto
- Cada toma con su tiempo, plano, y acción

4. VOICEOVER
- Guión EXACTO como narración
- NO modificar palabras
- NO resumir ni reinterpretar

5. ON-SCREEN TEXT
- Fragmentos del guión como subtítulos grandes
- Solo apoyo visual, sin texto nuevo

6. NEGATIVE PROMPT / RESTRICCIONES
- No inconsistencias visuales con el producto real
- No escenas fuera de guión
- No elementos inventados
- No contradicciones texto-imagen
- No cambios en la apariencia del producto

REGLAS:
- El prompt debe ser claro, directo y técnico
- Cada palabra del guión debe tener su imagen correspondiente
- Prioriza la coherencia visual sobre la estética
- Responde SOLO con el prompt final, sin explicaciones
- Máximo 800 palabras`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const { 
      script,
      productContext,
      productPhotosDescription,
      duration = 15
    } = req.body

    if (!script || typeof script !== 'string' || script.trim().length === 0) {
      return res.status(400).json({ error: 'Script is required' })
    }

    const xaiApiKey = process.env.GROK_API_KEY
    if (!xaiApiKey) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    // ─── MODULE A: Extract Visual DNA ─────────────────────────────────
    let visualDNA = ''
    
    const moduleAInput = productPhotosDescription 
      ? `Fotos/descripción del producto:\n${productPhotosDescription}`
      : productContext 
        ? `Contexto del producto:\n${productContext}`
        : ''

    if (moduleAInput) {
      console.log('Module A: Extracting Visual DNA...')
      visualDNA = await callGrok(xaiApiKey, MODULE_A_SYSTEM, moduleAInput, 500)
      console.log('Module A complete:', visualDNA.substring(0, 100) + '...')
    }

    // ─── MODULE B: Cinematic Script Transformation ────────────────────
    console.log('Module B: Transforming to cinematic script...')
    
    const moduleBInput = `Guión ganador FINAL (NO modificar el texto, solo traducir a tomas cinematográficas):

"${script.trim()}"

Duración total del video: ${duration} segundos.
Divide el guión en segmentos que cubran los ${duration} segundos completos.`

    const cinematicScript = await callGrok(xaiApiKey, MODULE_B_SYSTEM, moduleBInput, 1500)
    console.log('Module B complete:', cinematicScript.substring(0, 100) + '...')

    // ─── MODULE C: Mother Prompt Fusion ───────────────────────────────
    console.log('Module C: Fusing into Mother Prompt...')

    const moduleCInput = `INPUTS PARA FUSIONAR:

${visualDNA ? `--- PRODUCT VISUAL DNA ---\n${visualDNA}\n` : ''}
--- CINEMATIC SCRIPT ---
${cinematicScript}

--- VOICEOVER (GUIÓN EXACTO - NO MODIFICAR) ---
"${script.trim()}"

--- SPECS ---
Duración: ${duration} segundos
Formato: 9:16 (vertical)
Tipo: Anuncio de venta directa para redes sociales`

    const motherPrompt = await callGrok(xaiApiKey, MODULE_C_SYSTEM, moduleCInput, 2000)
    console.log('Module C complete:', motherPrompt.substring(0, 100) + '...')

    // Calculate total token usage
    const totalInputTokens = estimateTokens(
      MODULE_A_SYSTEM + moduleAInput + 
      MODULE_B_SYSTEM + moduleBInput + 
      MODULE_C_SYSTEM + moduleCInput
    )
    const totalOutputTokens = estimateTokens(visualDNA + cinematicScript + motherPrompt)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'ad_prompt_build',
      model: 'grok-3-mini',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      success: true,
      metadata: { 
        duration,
        hasVisualDNA: !!visualDNA,
        scriptLength: script.length
      }
    })

    return res.status(200).json({
      motherPrompt,
      visualDNA,
      cinematicScript,
      originalScript: script.trim(),
      duration
    })

  } catch (error) {
    console.error('Build ad prompt error:', error)
    return res.status(500).json({ 
      error: 'Failed to build ad prompt',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
