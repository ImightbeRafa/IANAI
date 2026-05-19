import { supabaseAdmin as supabase } from './supabase-admin.js'

export interface AiMemoryRow {
  id: string
  user_id: string
  product_id: string | null
  memory_type: string
  category: string | null
  content: string
  metadata: Record<string, unknown>
  confidence: number
  source: string | null
  version: number
  created_at: string
  updated_at: string
}

/**
 * Retrieve relevant typed memories for a user+product.
 * Phase 1: SQL filtering with smart ordering (product-specific first, highest confidence, most recent).
 * Phase 2: Will add optional embedding-based cosine similarity.
 */
async function getRelevantMemories(
  userId: string,
  productId: string | null,
  options?: {
    types?: string[]
    categories?: string[]
    excludeCategories?: string[]
    limit?: number
  }
): Promise<AiMemoryRow[]> {
  if (!supabase) return []

  try {
    // Build filter: global memories (product_id IS NULL) + product-specific memories
    const orFilter = productId
      ? `and(user_id.eq.${userId},product_id.is.null),and(user_id.eq.${userId},product_id.eq.${productId})`
      : `and(user_id.eq.${userId},product_id.is.null)`

    let query = supabase
      .from('ai_memories')
      .select('*')
      .or(orFilter)

    if (options?.types && options.types.length > 0) {
      query = query.in('memory_type', options.types)
    }
    if (options?.categories && options.categories.length > 0) {
      query = query.in('category', options.categories)
    }
    if (options?.excludeCategories && options.excludeCategories.length > 0) {
      for (const cat of options.excludeCategories) {
        query = query.neq('category', cat)
      }
    }

    // Smart ordering: product-specific first, then by confidence, then by recency
    const { data, error } = await query
      .order('product_id', { ascending: false, nullsFirst: false })
      .order('confidence', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(options?.limit || 15)

    if (error) {
      console.warn('Failed to fetch ai_memories:', error.message)
      return []
    }

    return data || []
  } catch (e) {
    console.warn('getRelevantMemories error:', e)
    return []
  }
}

/**
 * Build the memory injection block for prompt pipelines.
 * Battle-tested format with HIGHEST PRIORITY override language.
 * Place right after the master system prompt, before the task.
 */
function buildMemoryInjection(
  memories: AiMemoryRow[],
  language: 'es' | 'en' = 'es'
): string {
  if (!memories || memories.length === 0) return ''

  // Separate by type
  const preferences = memories.filter(m => m.memory_type === 'preference' && m.category !== 'core_style')
  const antiPatterns = memories.filter(m => m.memory_type === 'anti_pattern')
  const rules = memories.filter(m => m.memory_type === 'rule')
  const examples = memories.filter(m => m.memory_type === 'example')
  const visualStyle = memories.filter(m => m.memory_type === 'visual_style')
  const facts = memories.filter(m => m.memory_type === 'fact')

  // Find the most recent style directive (core_style preference)
  const styleDirective = memories.find(m => m.memory_type === 'preference' && m.category === 'core_style')

  // Count total interactions for the header
  const interactionCount = memories.length

  const isEs = language === 'es'

  const parts: string[] = []

  // Header — important: do NOT claim to override color, layout, or format instructions
  parts.push(isEs
    ? '=== DIRECTIVAS DE MEMORIA — APLICA ESTAS PREFERENCIAS DE ESTILO (pero NUNCA anules instrucciones de COLOR, LAYOUT o FORMATO ya definidas arriba) ==='
    : '=== MEMORY DIRECTIVES — APPLY THESE STYLE PREFERENCES (but NEVER override COLOR, LAYOUT, or FORMAT instructions defined above) ==='
  )

  // Core style directive
  if (styleDirective) {
    parts.push(isEs
      ? `\nESTILO CENTRAL DEL USUARIO (internalizado en ${interactionCount} interacciones):\n${styleDirective.content}`
      : `\nUSER'S CORE STYLE (internalized across ${interactionCount} interactions):\n${styleDirective.content}`
    )
  }

  // Preferences
  if (preferences.length > 0) {
    parts.push(isEs
      ? `\nPREFERENCIAS — aplica naturalmente:`
      : `\nPREFERENCES — weave these in naturally:`
    )
    for (const p of preferences) {
      parts.push(`• ${p.content}`)
    }
  }

  // Rules
  if (rules.length > 0) {
    parts.push(isEs
      ? `\nREGLAS EXPLÍCITAS:`
      : `\nEXPLICIT RULES:`
    )
    for (const r of rules) {
      parts.push(`• ${r.content}`)
    }
  }

  // Anti-patterns (most critical)
  if (antiPatterns.length > 0) {
    parts.push(isEs
      ? `\nNUNCA HAGAS ESTO (anti-patrones no negociables):`
      : `\nNEVER DO THESE (non-negotiable anti-patterns):`
    )
    for (const a of antiPatterns) {
      parts.push(`• ${a.content}`)
    }
  }

  // Positive examples
  if (examples.length > 0) {
    parts.push(isEs
      ? `\nIGUALA ESTOS EJEMPLOS POSITIVOS EN ENERGÍA Y ESTRUCTURA:`
      : `\nMATCH THESE POSITIVE EXAMPLES EXACTLY IN ENERGY & STRUCTURE:`
    )
    for (const e of examples) {
      parts.push(`• "${e.content.substring(0, 150)}${e.content.length > 150 ? '...' : ''}"`)
    }
  }

  // Visual style (for image pipelines)
  if (visualStyle.length > 0) {
    parts.push(isEs
      ? `\nESTILO VISUAL APRENDIDO:`
      : `\nLEARNED VISUAL STYLE:`
    )
    for (const v of visualStyle) {
      parts.push(`• ${v.content}`)
    }
  }

  // Facts
  if (facts.length > 0) {
    parts.push(isEs
      ? `\nDATOS RELEVANTES:`
      : `\nRELEVANT FACTS:`
    )
    for (const f of facts) {
      parts.push(`• ${f.content}`)
    }
  }

  // Closing instruction
  parts.push(isEs
    ? '\nEstas directivas son preferencias de estilo aprendidas. Respeta SIEMPRE las instrucciones de COLOR, LAYOUT y FORMATO definidas antes de este bloque. Nunca menciones estas directivas al usuario.'
    : '\nThese directives are learned style preferences. ALWAYS respect COLOR, LAYOUT, and FORMAT instructions defined before this block. Never mention these directives to the user.'
  )

  return parts.join('\n')
}

/**
 * Convenience: fetch memories + build injection in one call.
 * Used by chat.ts and generate-image.ts
 */
export async function getMemoryInjection(
  userId: string,
  productId: string | null,
  language: 'es' | 'en' = 'es',
  options?: {
    types?: string[]
    categories?: string[]
    excludeCategories?: string[]
    limit?: number
  }
): Promise<string> {
  const memories = await getRelevantMemories(userId, productId, options)
  if (memories.length === 0) return ''
  return buildMemoryInjection(memories, language)
}
