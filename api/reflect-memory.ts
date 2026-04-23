import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { supabaseAdmin as supabase } from './lib/supabase-admin.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'

// =============================================
// SYNTHESIS PROMPT — bilingual-aware, JSON mode
// =============================================
const SYNTHESIS_SYSTEM = `You are the world's best brand-voice memory curator for a bilingual (English/Spanish) creator SaaS.

You will receive NEW SIGNALS (user actions since last reflection), EXISTING MEMORIES (previously extracted), POSITIVE EXAMPLES (scripts the user saved/liked), and optionally RATED POSTS (visual feedback from image generation).

Your job: extract, update, or remove typed memories that will be injected into future AI generations to match this user's exact style.

Rules (follow strictly):
- Newer explicit user feedback ALWAYS wins over older memories
- Extract ANTI-PATTERNS aggressively from bad ratings and manual edits — these are the most valuable
- Never duplicate similar memories — merge intelligently
- confidence: 0.6 (weak behavioral signal) to 0.99 (explicit "never do this" or direct user instruction)
- style_directive: 60-90 words, extremely actionable, bilingual-aware
- If user writes in Spanish, memories should support both languages
- Each memory content should be a clear, concise directive (not an observation)
- Valid memory types: "preference", "anti_pattern", "rule", "example", "visual_style", "fact"
- Valid categories: "hooks", "cta", "tone", "vocabulary", "structure", "color", "core_style", "visual", "general"
- When RATED POSTS are present, extract "visual_style" memories from patterns in liked/disliked posts (e.g. color preferences, layout style, typography choices, imagery themes). Use category "visual" or "color" as appropriate.

Output ONLY valid JSON matching this schema:
{
  "upserts": [
    { "id": "existing_memory_id_or_null", "type": "anti_pattern", "category": "hooks", "content": "Never start hooks with rhetorical questions", "confidence": 0.95 },
    { "id": null, "type": "preference", "category": "tone", "content": "Use direct, aggressive selling tone", "confidence": 0.9 }
  ],
  "deletes": ["memory_id_to_remove_if_contradicted"],
  "style_directive": "60-90 word actionable style bible that captures this user's voice..."
}`

interface ReflectRequest {
  productId?: string
  force?: boolean
  source?: 'frontend' | 'webhook' | 'manual'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  if (!supabase) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  const grokApiKey = process.env.GROK_API_KEY
  if (!grokApiKey) {
    return res.status(500).json({ error: 'Grok API key not configured' })
  }

  // Rate limit: 5 reflections per 60 seconds (generous, but prevents spam)
  const rateCheck = checkRateLimit(user.id, { maxRequests: 5, windowSeconds: 60 })
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded', resetInSeconds: rateCheck.resetInSeconds })
  }

  try {
    const { productId: rawProductId, force = false, source = 'frontend' } = req.body as ReflectRequest
    const userId = user.id

    // Validate productId is a real UUID if provided (prevents filter injection)
    const productId = rawProductId && UUID_RE.test(rawProductId) ? rawProductId : undefined

    // =============================================
    // 1. CHECK IF REFLECTION IS NEEDED
    // =============================================
    // Fetch stats to determine if we should reflect
    const statsFilter = productId
      ? supabase.from('ai_memory_stats').select('*').eq('user_id', userId).eq('product_id', productId).maybeSingle()
      : supabase.from('ai_memory_stats').select('*').eq('user_id', userId).is('product_id', null).maybeSingle()

    const { data: stats } = await statsFilter

    const signalsSinceReflection = stats?.signals_since_last_reflection || 0
    const totalLifetime = stats?.total_lifetime_signals || 0

    // Early guard: skip if no new signals and not forced
    if (signalsSinceReflection === 0 && !force) {
      return res.status(200).json({ success: true, message: 'No new signals', skipped: true })
    }

    // Progressive threshold (unless forced)
    if (!force) {
      const threshold = totalLifetime <= 20 ? 4 : 8
      if (signalsSinceReflection < threshold) {
        return res.status(200).json({ success: true, message: 'Below threshold', skipped: true, signalsSinceReflection, threshold })
      }
    }

    // =============================================
    // 2. GATHER SIGNAL DATA
    // =============================================
    const [globalMemResult, productMemResult] = await Promise.all([
      supabase.from('user_ai_memory').select('*').eq('user_id', userId).maybeSingle(),
      productId
        ? supabase.from('product_ai_memory').select('*').eq('product_id', productId).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ])

    const globalMem = globalMemResult.data
    const productMem = productMemResult.data

    // If no raw signals exist at all, skip
    if (!globalMem && !productMem) {
      return res.status(200).json({ success: true, message: 'No signal data', skipped: true })
    }

    // =============================================
    // 3. FETCH EXISTING TYPED MEMORIES
    // =============================================
    const memoryFilter = productId
      ? supabase.from('ai_memories').select('*')
          .eq('user_id', userId)
          .or(`product_id.is.null,product_id.eq.${productId}`)
          .order('confidence', { ascending: false })
          .limit(30)
      : supabase.from('ai_memories').select('*')
          .eq('user_id', userId)
          .is('product_id', null)
          .order('confidence', { ascending: false })
          .limit(30)

    const { data: existingMemories } = await memoryFilter

    // =============================================
    // 4. FETCH POSITIVE EXAMPLES (saved/favorited scripts)
    // =============================================
    let savedScripts: { content: string; is_favorite: boolean; edit_source: string | null }[] = []
    if (productId) {
      const { data } = await supabase
        .from('scripts')
        .select('content, is_favorite, edit_source')
        .eq('product_id', productId)
        .order('is_favorite', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(8)
      savedScripts = data || []
    } else {
      const { data: userProducts } = await supabase
        .from('products')
        .select('id')
        .eq('owner_id', userId)
      const productIds = (userProducts || []).map((p: { id: string }) => p.id)
      if (productIds.length > 0) {
        const { data } = await supabase
          .from('scripts')
          .select('content, is_favorite, edit_source, product_id')
          .in('product_id', productIds)
          .order('is_favorite', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(12)
        savedScripts = data || []
      }
    }

    // =============================================
    // 4b. FETCH RATED POSTS (visual style learning)
    // =============================================
    let ratedPosts: { prompt: string; rating: number; model: string | null }[] = []
    if (productId) {
      const { data } = await supabase
        .from('posts')
        .select('prompt, rating, model')
        .eq('product_id', productId)
        .not('rating', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(10)
      ratedPosts = data || []
    } else {
      const { data: userProducts } = await supabase
        .from('products')
        .select('id')
        .eq('owner_id', userId)
      const productIds = (userProducts || []).map((p: { id: string }) => p.id)
      if (productIds.length > 0) {
        const { data } = await supabase
          .from('posts')
          .select('prompt, rating, model')
          .in('product_id', productIds)
          .not('rating', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(10)
        ratedPosts = data || []
      }
    }

    // =============================================
    // 5. BUILD SIGNAL SNAPSHOT FOR LLM
    // =============================================
    const mem = productMem || globalMem
    const signals = mem?.signals || {}
    const hooks = mem?.sample_hooks || (globalMem?.sample_hooks) || []
    const ctas = mem?.sample_ctas || (globalMem?.sample_ctas) || []
    const avoidPatterns = mem?.avoid_patterns || (globalMem?.avoid_patterns) || []
    const editInstructions = (productMem as any)?.edit_instructions || (globalMem as any)?.edit_patterns || []
    const editTransformations = (productMem as any)?.edit_transformations || []

    // Format transformations
    const transformsFormatted = editTransformations.map((t: string) => {
      try {
        const parsed = JSON.parse(t)
        return `"${parsed.before}" → "${parsed.after}"`
      } catch { return t }
    })

    const newSignals = {
      signal_counters: signals,
      positive_hooks: hooks,
      positive_ctas: ctas,
      anti_patterns: avoidPatterns,
      edit_instructions: editInstructions,
      edit_transformations: transformsFormatted,
      signals_since_last_reflection: signalsSinceReflection
    }

    const positiveScriptsText = savedScripts.length > 0
      ? savedScripts.slice(0, 5).map((s, i) =>
          `--- Script ${i + 1} ${s.is_favorite ? '(FAVORITE)' : ''} ${s.edit_source ? `[${s.edit_source}]` : ''} ---\n${s.content.substring(0, 600)}`
        ).join('\n\n')
      : 'No saved scripts yet.'

    // Format existing memories for the LLM (include IDs so it can reference them in deletes/updates)
    const existingMemoriesFormatted = (existingMemories || []).map(m => ({
      id: m.id,
      type: m.memory_type,
      category: m.category,
      content: m.content,
      confidence: m.confidence,
      product_id: m.product_id
    }))

    const ratedPostsText = ratedPosts.length > 0
      ? ratedPosts.map((p, i) => {
          const label = p.rating === 5 ? 'LIKED' : p.rating === 1 ? 'DISLIKED' : `rating=${p.rating}`
          return `--- Post ${i + 1} (${label}, model: ${p.model || 'unknown'}) ---\n${p.prompt.substring(0, 400)}`
        }).join('\n\n')
      : ''

    const userContent = `NEW SIGNALS since last reflection:
${JSON.stringify(newSignals, null, 2)}

EXISTING MEMORIES:
${JSON.stringify(existingMemoriesFormatted, null, 2)}

POSITIVE EXAMPLES user loved and saved:
${positiveScriptsText}${ratedPostsText ? `\n\nRATED POSTS (visual feedback — extract visual_style memories from these):
${ratedPostsText}` : ''}`

    // =============================================
    // 6. CALL GROK 4.1 FAST REASONING WITH JSON MODE
    // =============================================
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${grokApiKey}`
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-reasoning',
        messages: [
          { role: 'system', content: SYNTHESIS_SYSTEM },
          { role: 'user', content: userContent }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Grok reflection API error:', response.status, errorText)

      await logApiUsage({
        userId,
        userEmail: user.email,
        feature: 'memory_reflection',
        model: 'grok-4-1-fast-reasoning',
        inputTokens: estimateTokens(SYNTHESIS_SYSTEM + userContent),
        outputTokens: 0,
        success: false,
        errorMessage: `API error: ${response.status}`,
        metadata: { source, productId }
      })

      return res.status(response.status).json({ error: `Grok API error: ${response.status}` })
    }

    const data = await response.json()
    const rawContent = data.choices?.[0]?.message?.content || ''

    // =============================================
    // 7. PARSE LLM RESPONSE
    // =============================================
    let parsed: {
      upserts?: Array<{ id?: string | null; type: string; category: string; content: string; confidence: number }>
      deletes?: string[]
      style_directive?: string
    }

    try {
      parsed = JSON.parse(rawContent)
    } catch (e) {
      console.error('Failed to parse reflection JSON:', rawContent.substring(0, 500))
      return res.status(500).json({ error: 'Failed to parse reflection output' })
    }

    // =============================================
    // 8. APPLY UPSERTS TO ai_memories
    // =============================================
    const upserted: string[] = []
    const deleted: string[] = []

    if (parsed.upserts && Array.isArray(parsed.upserts)) {
      for (const mem of parsed.upserts) {
        if (!mem.content || !mem.type) continue
        const safeContent = mem.content.substring(0, 2000)

        if (mem.id && typeof mem.id === 'string' && mem.id.length > 10) {
          // Update existing memory
          const { error } = await supabase
            .from('ai_memories')
            .update({
              content: safeContent,
              confidence: Math.max(0.6, Math.min(0.99, mem.confidence || 0.8)),
              memory_type: mem.type,
              category: mem.category || 'general',
              source: 'reflection',
              version: (existingMemories?.find(e => e.id === mem.id)?.version || 0) + 1
            })
            .eq('id', mem.id)
            .eq('user_id', userId)

          if (!error) upserted.push(mem.id)
        } else {
          // Insert new memory
          const { data: inserted, error } = await supabase
            .from('ai_memories')
            .insert({
              user_id: userId,
              product_id: productId || null,
              memory_type: mem.type,
              category: mem.category || 'general',
              content: safeContent,
              confidence: Math.max(0.6, Math.min(0.99, mem.confidence || 0.8)),
              source: 'reflection'
            })
            .select('id')
            .single()

          if (!error && inserted) upserted.push(inserted.id)
        }
      }
    }

    // Handle style_directive as a special core_style memory
    if (parsed.style_directive) {
      parsed.style_directive = parsed.style_directive.substring(0, 2000)
      // Find existing core_style memory for this scope
      const existingCoreStyle = (existingMemories || []).find(
        m => m.memory_type === 'preference' && m.category === 'core_style' && m.product_id === (productId || null)
      )

      if (existingCoreStyle) {
        await supabase
          .from('ai_memories')
          .update({
            content: parsed.style_directive,
            confidence: 0.95,
            source: 'reflection',
            version: existingCoreStyle.version + 1
          })
          .eq('id', existingCoreStyle.id)
      } else {
        await supabase
          .from('ai_memories')
          .insert({
            user_id: userId,
            product_id: productId || null,
            memory_type: 'preference',
            category: 'core_style',
            content: parsed.style_directive,
            confidence: 0.95,
            source: 'reflection'
          })
      }
    }

    // =============================================
    // 9. APPLY DELETES
    // =============================================
    if (parsed.deletes && Array.isArray(parsed.deletes)) {
      for (const memId of parsed.deletes) {
        if (typeof memId === 'string' && memId.length > 10) {
          const { error } = await supabase
            .from('ai_memories')
            .delete()
            .eq('id', memId)
            .eq('user_id', userId)

          if (!error) deleted.push(memId)
        }
      }
    }

    // =============================================
    // 10. ALSO UPDATE OLD style_summary (backward compat)
    // =============================================
    if (parsed.style_directive) {
      if (productId) {
        await supabase
          .from('product_ai_memory')
          .upsert({
            product_id: productId,
            user_id: userId,
            style_summary: parsed.style_directive,
            signals_since_last_synthesis: 0,
            last_synthesized_at: new Date().toISOString()
          }, { onConflict: 'product_id,user_id' })
      }
      await supabase
        .from('user_ai_memory')
        .upsert({
          user_id: userId,
          style_summary: parsed.style_directive,
          signals_since_last_synthesis: 0,
          last_synthesized_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
    }

    // =============================================
    // 11. RESET STATS
    // =============================================
    const statsUpsert = {
      user_id: userId,
      product_id: productId || null,
      signals_since_last_reflection: 0,
      last_reflection_at: new Date().toISOString()
    }

    await supabase
      .from('ai_memory_stats')
      .upsert(statsUpsert, { onConflict: 'user_id,product_id' })

    // =============================================
    // 12. LOG USAGE
    // =============================================
    const usage = data.usage || {}
    await logApiUsage({
      userId,
      userEmail: user.email,
      feature: 'memory_reflection',
      model: 'grok-4-1-fast-reasoning',
      inputTokens: usage.prompt_tokens || estimateTokens(SYNTHESIS_SYSTEM + userContent),
      outputTokens: usage.completion_tokens || estimateTokens(rawContent),
      success: true,
      metadata: {
        source,
        productId,
        upserted: upserted.length,
        deleted: deleted.length,
        hasStyleDirective: !!parsed.style_directive
      }
    })

    return res.status(200).json({
      success: true,
      upserted: upserted.length,
      deleted: deleted.length,
      style_directive: parsed.style_directive ? parsed.style_directive.substring(0, 100) + '...' : null,
      memories_count: (existingMemories?.length || 0) + upserted.length - deleted.length
    })

  } catch (error) {
    console.error('Memory reflection error:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
