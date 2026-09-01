import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, incrementUsage } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import {
  GROK_TEXT_MODEL_EFFICIENT,
  grokChatComplete,
} from './lib/grok-models.js'
import {
  DENSITY_CONFIG,
  getStreamlineSystemPrompt,
  normalizeTextDensity,
} from './lib/streamline-copy.js'
import { isUuid, resolveAuthorizedSessionProduct } from './lib/session-access.js'
import { userHasProductAccess } from './lib/product-access.js'
import { requireChatShellAccess } from './lib/chat-shell-access.js'
import { resolveChatGenerationId } from './lib/credits/chat-generation-id.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    let generationId: string | undefined
    const {
      script,
      postStyle = 'venta-directa',
      language = 'es',
      productContext,
      sessionId,
      productId,
    } = req.body || {}
    const textDensity = normalizeTextDensity(req.body?.textDensity)

    if (!script || typeof script !== 'string' || script.trim().length === 0) {
      return res.status(400).json({ error: 'Script text is required' })
    }

    // Chat-shell: when sessionId is present, bind product to that session's offer.
    // Classic /posts callers omit sessionId and keep prior behavior.
    if (sessionId != null && sessionId !== '') {
      if (!(await requireChatShellAccess(res, user.id))) return
      if (!isUuid(sessionId)) return res.status(400).json({ error: 'Invalid sessionId' })
      const access = await resolveAuthorizedSessionProduct(
        user.id,
        sessionId,
        typeof productId === 'string' ? productId : null
      )
      if (!access.ok) return res.status(access.status).json({ error: access.error })
    } else if (typeof productId === 'string' && productId) {
      if (!isUuid(productId)) return res.status(400).json({ error: 'Invalid productId' })
      if (!(await userHasProductAccess(user.id, productId))) {
        return res.status(403).json({ error: 'No access to product' })
      }
    }

    const sessionBound = sessionId != null && sessionId !== ''
    const generationIdResult = resolveChatGenerationId({
      sessionBound,
      incoming: req.body?.generationId,
    })
    if (!generationIdResult.ok) {
      return res.status(400).json({
        error: generationIdResult.error,
        code: 'generation_id_required',
      })
    }
    generationId = generationIdResult.generationId

    const xaiApiKey = process.env.GROK_API_KEY
    if (!xaiApiKey) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const safeContext = productContext && typeof productContext === 'object'
      ? {
          name: typeof productContext.name === 'string' ? productContext.name.trim().slice(0, 200) : undefined,
          description: typeof productContext.description === 'string' ? productContext.description.trim().slice(0, 800) : undefined,
          niche: typeof productContext.niche === 'string' ? productContext.niche.trim().slice(0, 200) : undefined,
          differentiation: typeof productContext.differentiation === 'string' ? productContext.differentiation.trim().slice(0, 400) : undefined,
        }
      : undefined

    const densityConfig = DENSITY_CONFIG[textDensity]
    const systemPrompt = getStreamlineSystemPrompt(postStyle, language, safeContext, textDensity)

    // Efficient model for speed — Hook / Desarrollo / CTA structure stays in the prompt contract.
    const completion = await grokChatComplete({
      apiKey: xaiApiKey,
      model: GROK_TEXT_MODEL_EFFICIENT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: script.trim() },
      ],
      temperature: densityConfig.temperature,
      maxTokens: densityConfig.maxTokens,
    })

    const rawStreamlined = completion.content.trim()
    const streamlined = rawStreamlined
      .replace(/\[[^\]\n]{2,80}\]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (!streamlined) {
      return res.status(500).json({ error: 'Empty response from AI' })
    }

    const inputTokens = completion.usage.prompt_tokens || estimateTokens(systemPrompt + script)
    const outputTokens = completion.usage.completion_tokens || estimateTokens(streamlined)
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'prompt_condense',
      model: GROK_TEXT_MODEL_EFFICIENT,
      inputTokens,
      outputTokens,
      generationId,
      success: true,
      metadata: {
        action: 'streamline_script',
        postStyle,
        language,
        textDensity,
        hasProductContext: !!safeContext,
        endpoint: completion.endpoint,
        sessionBound,
      }
    })

    if (sessionBound) {
      await incrementUsage(user.id, 'condense', { generationId })
    }

    return res.status(200).json({ streamlined, textDensity, generationId })

  } catch (error) {
    console.error('Streamline script error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'prompt_condense',
      model: GROK_TEXT_MODEL_EFFICIENT,
      generationId,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
