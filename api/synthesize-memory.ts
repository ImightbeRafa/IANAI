import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'

const GLOBAL_SYNTHESIS_SYSTEM = `You are a copywriting style analyst. You will receive a user's saved scripts, editing patterns, and behavioral signals across all their products.

Extract their GLOBAL WRITING STYLE as actionable instructions (~200 words max).

Cover these areas:
1. VOICE & TONE: How do they write? Aggressive/educational/casual/direct?
2. HOOK RHYTHM: Short punchy hooks or context-rich openers?
3. CTA PATTERNS: What call-to-action style do they prefer?
4. VOCABULARY: Recurring power words, phrases, or patterns?
5. EDIT TENDENCIES: What do they consistently change? What to avoid?
6. VISUAL PREFERENCES: If post data is available, preferred styles/colors?

Write as INSTRUCTIONS for another AI copywriter to follow.
Do NOT list observations. Write directives.
Keep it dense and actionable. No filler.`

const PRODUCT_SYNTHESIS_SYSTEM = `You are a copywriting style analyst. You will receive saved scripts and behavioral signals for ONE SPECIFIC PRODUCT.

Extract product-specific style instructions (~150 words max) that COMPLEMENT (not repeat) the user's global style.

Cover:
1. WINNING HOOKS: Which hook types/structures work best for this product?
2. STRUCTURE: Which script archetype gets saved/favorited?
3. KEY PHRASES: Product-specific vocabulary or selling points the user keeps?
4. WHAT DOESN'T WORK: Patterns edited out or never saved?

Include 2-3 example hooks from their best scripts if available.
Write as INSTRUCTIONS. Be specific to this product.
Do NOT repeat generic writing advice. Focus on what's unique to this product.`

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

  const grokApiKey = process.env.GROK_API_KEY
  if (!grokApiKey) {
    return res.status(500).json({ error: 'Grok API key not configured' })
  }

  try {
    const { productId } = req.body as SynthesisRequest
    const userId = user.id

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

    const globalUserContent = [
      globalHooks.length > 0 ? `SAMPLE HOOKS FROM SAVED SCRIPTS:\n${globalHooks.map((h: string, i: number) => `${i + 1}. ${h}`).join('\n')}` : '',
      globalCtas.length > 0 ? `SAMPLE CTAs FROM SAVED SCRIPTS:\n${globalCtas.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}` : '',
      globalPatterns.length > 0 ? `USER'S RECURRING INSTRUCTIONS/EDIT REQUESTS:\n${globalPatterns.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}` : '',
      Object.keys(globalSignals).length > 0 ? `BEHAVIORAL SIGNALS:\n${JSON.stringify(globalSignals, null, 2)}` : '',
      savedScripts.length > 0 ? `RECENT SAVED SCRIPTS (${savedScripts.length}):\n${savedScripts.slice(0, 5).map((s, i) => `--- Script ${i + 1} ${s.is_favorite ? '(FAVORITE)' : ''} ---\n${s.content.substring(0, 800)}`).join('\n\n')}` : ''
    ].filter(Boolean).join('\n\n')

    if (globalUserContent.trim().length > 50) {
      const globalResponse = await fetch(GROK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${grokApiKey}`
        },
        body: JSON.stringify({
          model: 'grok-3-mini-fast',
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
            feature: 'prompt_enhance',
            model: 'grok-3-mini-fast',
            inputTokens: usage.prompt_tokens || estimateTokens(GLOBAL_SYNTHESIS_SYSTEM + globalUserContent),
            outputTokens: usage.completion_tokens || estimateTokens(summary),
            success: true,
            metadata: { action: 'ai_memory_global_synthesis' }
          })
        }
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

      const productUserContent = [
        productHooks.length > 0 ? `SAMPLE HOOKS FOR THIS PRODUCT:\n${productHooks.map((h: string, i: number) => `${i + 1}. ${h}`).join('\n')}` : '',
        productCtas.length > 0 ? `SAMPLE CTAs FOR THIS PRODUCT:\n${productCtas.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}` : '',
        productInstructions.length > 0 ? `USER'S INSTRUCTIONS/REFINEMENTS FOR THIS PRODUCT:\n${productInstructions.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}` : '',
        Object.keys(productSignals).length > 0 ? `BEHAVIORAL SIGNALS:\n${JSON.stringify(productSignals, null, 2)}` : '',
        productScripts.length > 0 ? `SAVED SCRIPTS FOR THIS PRODUCT:\n${productScripts.map((s: string, i: number) => `--- Script ${i + 1} ---\n${s.substring(0, 800)}`).join('\n\n')}` : '',
        savedScripts.length > 0 ? `ADDITIONAL SAVED SCRIPTS:\n${savedScripts.slice(0, 3).map((s, i) => `--- Script ${i + 1} ${s.is_favorite ? '(FAVORITE)' : ''} ---\n${s.content.substring(0, 600)}`).join('\n\n')}` : ''
      ].filter(Boolean).join('\n\n')

      if (productUserContent.trim().length > 50) {
        const productResponse = await fetch(GROK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${grokApiKey}`
          },
          body: JSON.stringify({
            model: 'grok-3-mini-fast',
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
              feature: 'prompt_enhance',
              model: 'grok-3-mini-fast',
              inputTokens: usage.prompt_tokens || estimateTokens(PRODUCT_SYNTHESIS_SYSTEM + productUserContent),
              outputTokens: usage.completion_tokens || estimateTokens(summary),
              success: true,
              metadata: { action: 'ai_memory_product_synthesis', productId }
            })
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      ...results
    })

  } catch (error) {
    console.error('Memory synthesis error:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
