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

// ─── CINEMATIC SCRIPT SPLITTER (30s → 2×15s) ────────────────────────────────
// Module B's cinematic script has time markers (e.g. "Tiempo: 15-20s").
// We split at the 15s boundary and run Module C on each half separately.

function splitCinematicScript(script: string): { part1: string; part2: string } {
  // Look for time markers at or near the 15s boundary
  const patterns = [
    /\n\s*-\s*\*\*Tiempo:\s*15/i,
    /\n\*\*Tiempo:\s*15/i,
    /\nTiempo:\s*15/i,
    /\n\s*-\s*\*\*Time:\s*15/i,
    /\nTime:\s*15/i,
  ]

  for (const pattern of patterns) {
    const match = script.search(pattern)
    if (match !== -1) {
      return {
        part1: script.substring(0, match).trim(),
        part2: script.substring(match).trim()
      }
    }
  }

  // Fallback: split at the nearest blank line near the middle
  const lines = script.split('\n')
  const mid = Math.floor(lines.length / 2)
  let splitLine = mid
  for (let i = mid; i < Math.min(mid + 10, lines.length); i++) {
    if (lines[i].trim() === '') { splitLine = i; break }
  }
  return {
    part1: lines.slice(0, splitLine).join('\n').trim(),
    part2: lines.slice(splitLine).join('\n').trim()
  }
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

    if (is30sMode) {
      // 30s mode: skip Module C, just split cinematic script at 15s and use directly
      console.log('30s mode: splitting cinematic script at 15s boundary...')
      const { part1, part2 } = splitCinematicScript(cinematicScript)
      console.log(`Split: Part1=${part1.length} chars, Part2=${part2.length} chars`)

      const totalInputTokens = estimateTokens(
        MODULE_A_SYSTEM + moduleAInput +
        MODULE_B_SYSTEM + moduleBInput
      )
      const totalOutputTokens = estimateTokens(visualDNA + cinematicScript)

      await logApiUsage({
        userId: user.id,
        userEmail: user.email,
        feature: 'ad_prompt_build',
        model: 'grok-4-fast-non-reasoning',
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        success: true,
        metadata: { duration, hasVisualDNA: !!visualDNA, scriptLength: script.length, splitMode: true }
      })

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

    // Normal single-clip mode
    console.log('Module C: Single mode...')

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

    const motherPrompt = await callGrok(xaiApiKey, MODULE_C_SYSTEM, moduleCInput, 1000)
    console.log('Module C complete:', motherPrompt.substring(0, 100) + '...')

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
      model: 'grok-4-fast-non-reasoning',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      success: true,
      metadata: { duration, hasVisualDNA: !!visualDNA, scriptLength: script.length, splitMode: false }
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
