import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { supabaseAdmin as supabase } from './lib/supabase-admin.js'
import { GROK_API_URL, GROK_TEXT_MODEL_EFFICIENT } from './lib/grok-models.js'
import { userHasProductAccess } from './lib/product-access.js'

const GLOBAL_SYNTHESIS_SYSTEM = `You are a copywriting style analyst. You will receive a user's saved scripts, editing patterns, behavioral signals, and ANTI-PATTERNS (things the user explicitly rejects) across all their products.

Extract their GLOBAL WRITING STYLE as actionable instructions (~200 words max).

Cover these areas:
1. VOICE & TONE: How do they write? Aggressive/educational/casual/direct?
2. HOOK STYLE: What hook structures do they keep? Start hooks with declarations, NOT questions (unless proven otherwise).
3. CTA PATTERNS: What call-to-action style do they prefer?
4. VOCABULARY: Recurring power words, phrases, or patterns?
5. WHAT TO AVOID: Based on anti-patterns and edit history, what should NEVER appear? Be explicit.
6. VISUAL PREFERENCES: If post data is available, preferred styles/colors?

CRITICAL: The ANTI-PATTERNS section shows things the user has explicitly removed or rejected. These are HARD RULES — the AI must NEVER reproduce these patterns.
EDIT TRANSFORMATIONS show before→after changes — learn what the user corrects.

Write as INSTRUCTIONS for another AI copywriter to follow.
Do NOT list observations. Write directives.
Keep it dense and actionable. No filler.`

const PRODUCT_SYNTHESIS_SYSTEM = `You are a copywriting style analyst. You will receive saved scripts, behavioral signals, ANTI-PATTERNS, and EDIT TRANSFORMATIONS for ONE SPECIFIC PRODUCT.

Extract product-specific style instructions (~200 words max) that COMPLEMENT (not repeat) the user's global style.

Cover:
1. WINNING HOOKS: Which hook structures get saved? Provide 2-3 example hooks from their BEST (post-edit) versions.
2. STRUCTURE: Which script archetype gets saved/favorited? (e.g. [GANCHO]-[DESARROLLO]-[CTA] with bullets)
3. KEY PHRASES: Product-specific vocabulary or selling points the user keeps?
4. HARD RULES — NEVER DO: Based on anti-patterns and rejected content, list explicit prohibitions.
5. EDIT PATTERNS: Based on before→after transformations, what does the user consistently correct?

CRITICAL: 
- ANTI-PATTERNS are things the user EXPLICITLY removed or rated badly. These are absolute prohibitions.
- EDIT TRANSFORMATIONS show the user's corrections (before→after). Learn the direction of improvement.
- POSITIVE EXAMPLES are hooks/CTAs the user kept or rated well.
- Always prefer the AFTER version from transformations over raw samples.

Write as INSTRUCTIONS. Be specific to this product.
Do NOT repeat generic writing advice. Focus on what's unique.`

interface SynthesisRequest {
  userId?: string
  productId?: string
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

  try {
    const { productId: rawProductId } = req.body as SynthesisRequest
    const userId = user.id
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const productId = rawProductId && UUID_RE.test(rawProductId) ? rawProductId : undefined

    if (rawProductId && !productId) {
      return res.status(400).json({ error: 'Invalid productId format' })
    }

    if (productId) {
      const allowed = await userHasProductAccess(userId, productId)
      if (!allowed) {
        return res.status(403).json({ error: 'Access denied to this product' })
      }
    }

    // Fetch both memory rows
    const [globalMemResult, productMemResult] = await Promise.all([
      supabase.from('user_ai_memory').select('*').eq('user_id', userId).single(),
      productId
        ? supabase.from('product_ai_memory').select('*').eq('product_id', productId).eq('user_id', userId).single()
        : Promise.resolve({ data: null, error: null })
    ])

    const globalMem = globalMemResult.data
    const productMem = productMemResult.data

    // Fetch recent saved scripts (for synthesis material)
    let savedScripts: { content: string; is_favorite: boolean; edit_source: string | null }[] = []
    if (productId) {
      const { data } = await supabase
        .from('scripts')
        .select('content, is_favorite, edit_source')
        .eq('product_id', productId)
        .order('is_favorite', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10)
      savedScripts = data || []
    } else {
      // Global: get scripts across all of THIS USER's products only
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
          .limit(15)
        savedScripts = data || []
      }
    }

    const results: { globalSummary?: string; productSummary?: string } = {}

    // =============================================
    // GLOBAL SYNTHESIS
    // =============================================
    const globalSignals = globalMem?.signals || {}
    const globalHooks = globalMem?.sample_hooks || []
    const globalCtas = globalMem?.sample_ctas || []
    const globalPatterns = globalMem?.edit_patterns || []
    const globalAvoid = globalMem?.avoid_patterns || []

    const globalUserContent = [
      '=== POSITIVE EXAMPLES (what user keeps/likes) ===',
      globalHooks.length > 0 ? `HOOKS THAT WORK:\n${globalHooks.map((h: string, i: number) => `${i + 1}. ${h}`).join('\n')}` : '',
      globalCtas.length > 0 ? `CTAs THAT WORK:\n${globalCtas.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}` : '',
      savedScripts.length > 0 ? `RECENT SAVED SCRIPTS (${savedScripts.length}):\n${savedScripts.slice(0, 5).map((s, i) => `--- Script ${i + 1} ${s.is_favorite ? '(FAVORITE)' : ''} ---\n${s.content.substring(0, 800)}`).join('\n\n')}` : '',
      '\n=== ANTI-PATTERNS (what user REJECTS — NEVER reproduce) ===',
      globalAvoid.length > 0 ? `REJECTED PATTERNS:\n${globalAvoid.map((a: string, i: number) => `${i + 1}. ❌ ${a}`).join('\n')}` : 'No explicit rejections yet.',
      '\n=== USER INSTRUCTIONS ===',
      globalPatterns.length > 0 ? `EXPLICIT EDIT INSTRUCTIONS:\n${globalPatterns.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}` : '',
      Object.keys(globalSignals).length > 0 ? `BEHAVIORAL SIGNALS:\n${JSON.stringify(globalSignals, null, 2)}` : ''
    ].filter(Boolean).join('\n\n')

    if (globalUserContent.trim().length > 50) {
      const globalResponse = await fetch(GROK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${grokApiKey}`
        },
        body: JSON.stringify({
          model: GROK_TEXT_MODEL_EFFICIENT,
          messages: [
            { role: 'system', content: GLOBAL_SYNTHESIS_SYSTEM },
            { role: 'user', content: globalUserContent }
          ],
          temperature: 0.3,
          max_tokens: 500
        })
      })

      if (globalResponse.ok) {
        const data = await globalResponse.json()
        const summary = data.choices?.[0]?.message?.content || ''
        if (summary) {
          results.globalSummary = summary

          await supabase
            .from('user_ai_memory')
            .upsert({
              user_id: userId,
              style_summary: summary,
              signals_since_last_synthesis: 0,
              last_synthesized_at: new Date().toISOString()
            }, { onConflict: 'user_id' })

          const usage = data.usage || {}
          await logApiUsage({
            userId,
            userEmail: user.email,
            feature: 'memory_synthesis',
            model: GROK_TEXT_MODEL_EFFICIENT,
            inputTokens: usage.prompt_tokens || estimateTokens(GLOBAL_SYNTHESIS_SYSTEM + globalUserContent),
            outputTokens: usage.completion_tokens || estimateTokens(summary),
            success: true,
            metadata: { action: 'ai_memory_global_synthesis' }
          })
        }
      } else {
        await logApiUsage({
          userId,
          userEmail: user.email,
          feature: 'memory_synthesis',
          model: GROK_TEXT_MODEL_EFFICIENT,
          inputTokens: estimateTokens(GLOBAL_SYNTHESIS_SYSTEM + globalUserContent),
          success: false,
          errorMessage: `API error: ${globalResponse.status}`,
          metadata: { action: 'ai_memory_global_synthesis' }
        })
      }
    }

    // =============================================
    // PRODUCT SYNTHESIS
    // =============================================
    if (productId) {
      const productSignals = productMem?.signals || {}
      const productHooks = productMem?.sample_hooks || []
      const productCtas = productMem?.sample_ctas || []
      const productScripts = productMem?.sample_scripts || []
      const productInstructions = productMem?.edit_instructions || []
      const productAvoid = productMem?.avoid_patterns || []
      const productTransforms = productMem?.edit_transformations || []

      // Parse edit transformations into readable format
      const transformsFormatted = productTransforms.map((t: string) => {
        try {
          const parsed = JSON.parse(t)
          return `"${parsed.before}" → "${parsed.after}"`
        } catch { return null }
      }).filter(Boolean)

      const productUserContent = [
        '=== POSITIVE EXAMPLES (hooks/CTAs user keeps or rates well) ===',
        productHooks.length > 0 ? `HOOKS THAT WORK FOR THIS PRODUCT:\n${productHooks.map((h: string, i: number) => `${i + 1}. ✅ ${h}`).join('\n')}` : '',
        productCtas.length > 0 ? `CTAs THAT WORK FOR THIS PRODUCT:\n${productCtas.map((c: string, i: number) => `${i + 1}. ✅ ${c}`).join('\n')}` : '',
        productScripts.length > 0 ? `SAVED SCRIPTS:\n${productScripts.map((s: string, i: number) => `--- Script ${i + 1} ---\n${s.substring(0, 800)}`).join('\n\n')}` : '',
        savedScripts.length > 0 ? `ADDITIONAL SAVED SCRIPTS:\n${savedScripts.slice(0, 3).map((s, i) => `--- Script ${i + 1} ${s.is_favorite ? '(FAVORITE)' : ''} ---\n${s.content.substring(0, 600)}`).join('\n\n')}` : '',
        '\n=== ANTI-PATTERNS (NEVER reproduce these) ===',
        productAvoid.length > 0 ? `REJECTED/REMOVED CONTENT:\n${productAvoid.map((a: string, i: number) => `${i + 1}. ❌ ${a}`).join('\n')}` : 'No explicit rejections yet.',
        '\n=== EDIT TRANSFORMATIONS (before → after corrections) ===',
        transformsFormatted.length > 0 ? `USER CORRECTIONS:\n${transformsFormatted.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}` : 'No edit transformations tracked yet.',
        '\n=== USER INSTRUCTIONS ===',
        productInstructions.length > 0 ? `EXPLICIT INSTRUCTIONS:\n${productInstructions.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}` : '',
        Object.keys(productSignals).length > 0 ? `BEHAVIORAL SIGNALS:\n${JSON.stringify(productSignals, null, 2)}` : ''
      ].filter(Boolean).join('\n\n')

      if (productUserContent.trim().length > 50) {
        const productResponse = await fetch(GROK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${grokApiKey}`
          },
          body: JSON.stringify({
            model: GROK_TEXT_MODEL_EFFICIENT,
            messages: [
              { role: 'system', content: PRODUCT_SYNTHESIS_SYSTEM },
              { role: 'user', content: productUserContent }
            ],
            temperature: 0.3,
            max_tokens: 400
          })
        })

        if (productResponse.ok) {
          const data = await productResponse.json()
          const summary = data.choices?.[0]?.message?.content || ''
          if (summary) {
            results.productSummary = summary

            await supabase
              .from('product_ai_memory')
              .upsert({
                product_id: productId,
                user_id: userId,
                style_summary: summary,
                signals_since_last_synthesis: 0,
                last_synthesized_at: new Date().toISOString()
              }, { onConflict: 'product_id,user_id' })

            const usage = data.usage || {}
            await logApiUsage({
              userId,
              userEmail: user.email,
              feature: 'memory_synthesis',
              model: GROK_TEXT_MODEL_EFFICIENT,
              inputTokens: usage.prompt_tokens || estimateTokens(PRODUCT_SYNTHESIS_SYSTEM + productUserContent),
              outputTokens: usage.completion_tokens || estimateTokens(summary),
              success: true,
              metadata: { action: 'ai_memory_product_synthesis', productId }
            })
          }
        } else {
          await logApiUsage({
            userId,
            userEmail: user.email,
            feature: 'memory_synthesis',
            model: GROK_TEXT_MODEL_EFFICIENT,
            inputTokens: estimateTokens(PRODUCT_SYNTHESIS_SYSTEM + productUserContent),
            success: false,
            errorMessage: `API error: ${productResponse.status}`,
            metadata: { action: 'ai_memory_product_synthesis', productId }
          })
        }
      }
    }

    return res.status(200).json({
      success: true,
      ...results
    })

  } catch (error) {
    console.error('Memory synthesis error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'memory_synthesis',
      model: GROK_TEXT_MODEL_EFFICIENT,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
