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
      model: 'grok-4-fast-non-reasoning',
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

Tu tarea es fusionar tres inputs en UN SOLO PROMPT FINAL COMPACTO optimizado para una IA de generación de video.

LÍMITE ESTRICTO: El prompt final debe tener MÁXIMO 3000 caracteres. Sé denso y directo.

Estructura del prompt (sin headers markdown, todo en texto corrido):

1. SPECS: Duración, formato 9:16 vertical, estilo realista comercial.
2. PRODUCTO: Descripción visual compacta del producto (colores, forma, materiales).
3. ESCENAS: Cada toma en una línea: [tiempo] [plano] [qué se ve] [acción].
4. VOICEOVER: Guión exacto como narración (NO modificar palabras).
5. RESTRICCIONES: No inconsistencias visuales, no escenas fuera de guión, no elementos inventados.

REGLAS:
- NO uses markdown (ni #, ni **, ni ---, ni bullets con -)
- Escribe en texto corrido, párrafos densos separados por líneas en blanco
- Cada palabra del guión debe tener su imagen correspondiente
- Prioriza coherencia visual sobre estética
- Responde SOLO con el prompt final
- MÁXIMO 3000 caracteres total`

// ─── MODULE C SPLIT: TWO-PART PROMPT FOR 30s VIDEOS ─────────────────────────
// When duration >= 25s, we split into 2×15s clips chained via last-frame image reference

const MODULE_C_SPLIT_SYSTEM = `Eres un ingeniero de prompts especializado en generación de video con IA para anuncios de venta directa.

Tu tarea es fusionar tres inputs en DOS PROMPTS FINALES optimizados para una IA de generación de video.

Se van a generar DOS clips de video POR SEPARADO (cada uno de 15 segundos) que luego se van a unir para crear UN VIDEO CONTINUO de 30 segundos. El segundo clip se generará usando el ÚLTIMO FRAME del primer clip como imagen de referencia, así que la continuidad visual es CRÍTICA.

REGLAS CRÍTICAS PARA CONTINUIDAD VISUAL:
- La última escena de PARTE 1 debe terminar en un encuadre estable y claro (no en movimiento brusco ni transición)
- PARTE 2 debe comenzar describiendo EXACTAMENTE el mismo encuadre, iluminación, colores, ambiente y composición donde PARTE 1 termina
- Ambas partes deben usar el mismo estilo visual, paleta de colores, tono y tipo de iluminación
- La primera frase de PARTE 2 debe describir la escena de continuación exacta
- NO cambiar el estilo, la paleta, ni el tipo de escena entre partes

FORMATO DE SALIDA (usa estos separadores EXACTOS, sin espacios extra):
===PART_1===
[Prompt para primeros 15 segundos: Hook visual, introducción del producto, primeras escenas del guión. Máximo 3500 caracteres]
===PART_2===
[Prompt para últimos 15 segundos: Continuación natural desde el último frame de PARTE 1, desarrollo, CTA, cierre. Máximo 3500 caracteres]

REGLAS:
- NO uses markdown (ni #, ni **, ni ---, ni bullets con -)
- Escribe en texto corrido, párrafos densos separados por líneas en blanco
- Cada palabra del guión debe tener su imagen correspondiente
- Prioriza coherencia visual sobre todo
- La transición entre partes debe ser IMPERCEPTIBLE
- Responde SOLO con las dos partes usando los separadores exactos
- MÁXIMO 3500 caracteres por parte`

function parseSplitPrompts(output: string): { part1: string; part2: string } {
  const marker = '===PART_2==='
  const idx = output.indexOf(marker)
  if (idx === -1) {
    // Fallback: split roughly in half at a sentence boundary
    const mid = Math.floor(output.length / 2)
    const sentenceEnd = output.indexOf('.', mid)
    const splitAt = sentenceEnd > mid ? sentenceEnd + 1 : mid
    return {
      part1: output.substring(0, splitAt).replace('===PART_1===', '').trim(),
      part2: output.substring(splitAt).trim()
    }
  }
  const part1 = output.substring(0, idx).replace('===PART_1===', '').trim()
  const part2 = output.substring(idx + marker.length).trim()
  return { part1, part2 }
}

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

    // ─── MODULE A + B: Run in PARALLEL to reduce latency ──────────────
    const moduleAInput = productPhotosDescription 
      ? `Fotos/descripción del producto:\n${productPhotosDescription}`
      : productContext 
        ? `Contexto del producto:\n${productContext}`
        : ''

    const moduleBInput = `Guión ganador FINAL (NO modificar el texto, solo traducir a tomas cinematográficas):

"${script.trim()}"

Duración total del video: ${duration} segundos.
Divide el guión en segmentos que cubran los ${duration} segundos completos.`

    console.log('Modules A+B: Running in parallel...')

    const [visualDNA, cinematicScript] = await Promise.all([
      moduleAInput 
        ? callGrok(xaiApiKey, MODULE_A_SYSTEM, moduleAInput, 500)
        : Promise.resolve(''),
      callGrok(xaiApiKey, MODULE_B_SYSTEM, moduleBInput, 1500)
    ])

    console.log('Module A complete:', visualDNA ? visualDNA.substring(0, 100) + '...' : '(skipped)')
    console.log('Module B complete:', cinematicScript.substring(0, 100) + '...')

    // ─── MODULE C: Mother Prompt Fusion ───────────────────────────────
    const is30sMode = duration >= 25
    const moduleCSystem = is30sMode ? MODULE_C_SPLIT_SYSTEM : MODULE_C_SYSTEM
    const moduleCMaxTokens = is30sMode ? 2500 : 1000

    console.log(`Module C: ${is30sMode ? 'Split 2×15s' : 'Single'} mode...`)

    const moduleCInput = `INPUTS PARA FUSIONAR:

${visualDNA ? `--- PRODUCT VISUAL DNA ---\n${visualDNA}\n` : ''}
--- CINEMATIC SCRIPT ---
${cinematicScript}

--- VOICEOVER (GUIÓN EXACTO - NO MODIFICAR) ---
"${script.trim()}"

--- SPECS ---
Duración: ${is30sMode ? '30 segundos (2 clips de 15s cada uno)' : `${duration} segundos`}
Formato: 9:16 (vertical)
Tipo: Anuncio de venta directa para redes sociales`

    const moduleCOutput = await callGrok(xaiApiKey, moduleCSystem, moduleCInput, moduleCMaxTokens)
    console.log('Module C complete:', moduleCOutput.substring(0, 100) + '...')

    // Calculate total token usage
    const totalInputTokens = estimateTokens(
      MODULE_A_SYSTEM + moduleAInput + 
      MODULE_B_SYSTEM + moduleBInput + 
      moduleCSystem + moduleCInput
    )
    const totalOutputTokens = estimateTokens(visualDNA + cinematicScript + moduleCOutput)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'ad_prompt_build',
      model: 'grok-4-fast-non-reasoning',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      success: true,
      metadata: { 
        duration,
        hasVisualDNA: !!visualDNA,
        scriptLength: script.length,
        splitMode: is30sMode
      }
    })

    if (is30sMode) {
      const { part1, part2 } = parseSplitPrompts(moduleCOutput)
      console.log(`Split prompts: Part1=${part1.length} chars, Part2=${part2.length} chars`)
      return res.status(200).json({
        motherPromptPart1: part1,
        motherPromptPart2: part2,
        splitMode: true,
        visualDNA,
        cinematicScript,
        originalScript: script.trim(),
        duration
      })
    }

    return res.status(200).json({
      motherPrompt: moduleCOutput,
      visualDNA,
      cinematicScript,
      originalScript: script.trim(),
      duration
    })

  } catch (error) {
    console.error('Build ad prompt error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'ad_prompt_build',
      model: 'grok-4-fast-non-reasoning',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({ 
      error: 'Failed to build ad prompt',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
