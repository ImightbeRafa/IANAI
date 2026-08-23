export const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'
/** Preferred xAI endpoint. Chat Completions remains the documented fallback. */
export const GROK_RESPONSES_URL = 'https://api.x.ai/v1/responses'

/** Text-to-image / edit provider model (app id remains `grok-imagine`). */
export const GROK_IMAGE_PROVIDER_MODEL = 'grok-imagine-image-2.0'
export const GROK_IMAGE_GENERATIONS_URL = 'https://api.x.ai/v1/images/generations'
export const GROK_IMAGE_EDITS_URL = 'https://api.x.ai/v1/images/edits'
/** Documented base output price used when provider usage is unavailable. */
export const GROK_IMAGE_COST_USD = 0.04

/** Flagship — scripts, assistant, edits. */
export const GROK_TEXT_MODEL_BEST = 'grok-4.6'
/** Efficient — autofill, memory, planning. Same list price; lower reasoning cost in practice. */
export const GROK_TEXT_MODEL_EFFICIENT = 'grok-4.5'

/** Default interactive text model (scripts + assistant). */
export const GROK_TEXT_MODEL = GROK_TEXT_MODEL_BEST

export type GrokTextProfile = 'best' | 'efficient'
export type GrokTextModelId = typeof GROK_TEXT_MODEL_BEST | typeof GROK_TEXT_MODEL_EFFICIENT

export interface GrokChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GrokChatCompleteResult {
  content: string
  usage: { prompt_tokens: number; completion_tokens: number }
  endpoint: 'responses' | 'chat_completions'
}

/**
 * Map UI/legacy model fields onto the allowlist.
 * `grok` / `gemini` / `best` / `grok-4.6` → 4.6
 * `efficient` / `grok-4.5` → 4.5
 * Unknown values fall back to Best (never grok-4.3).
 */
export function resolveGrokTextModel(
  input?: string | null,
  fallback: GrokTextModelId = GROK_TEXT_MODEL
): GrokTextModelId {
  const value = (input || '').trim().toLowerCase()
  if (
    value === 'efficient'
    || value === 'grok-4.5'
    || value === '4.5'
  ) {
    return GROK_TEXT_MODEL_EFFICIENT
  }
  if (
    value === 'best'
    || value === 'grok-4.6'
    || value === '4.6'
    || value === 'grok'
    || value === 'gemini'
    || value === 'grok-4.3'
  ) {
    return GROK_TEXT_MODEL_BEST
  }
  if (value === GROK_TEXT_MODEL_BEST || value === GROK_TEXT_MODEL_EFFICIENT) {
    return value
  }
  return fallback
}

export function grokTextProfileForModel(model: GrokTextModelId): GrokTextProfile {
  return model === GROK_TEXT_MODEL_EFFICIENT ? 'efficient' : 'best'
}

export function extractGrokOutputText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const rec = data as Record<string, unknown>
  if (typeof rec.output_text === 'string' && rec.output_text.trim()) return rec.output_text

  const choices = rec.choices
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const message = (choices[0] as { message?: { content?: unknown } }).message
    if (typeof message?.content === 'string' && message.content.trim()) return message.content
  }

  const texts: string[] = []
  if (Array.isArray(rec.output)) {
    for (const item of rec.output) {
      if (!item || typeof item !== 'object') continue
      const content = (item as { content?: unknown }).content
      if (!Array.isArray(content)) continue
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        const row = part as { type?: unknown; text?: unknown }
        if (
          (row.type === 'output_text' || row.type === 'text')
          && typeof row.text === 'string'
          && row.text
        ) {
          texts.push(row.text)
        }
      }
    }
  }
  return texts.join('')
}

export function grokUsageFromPayload(data: unknown): { prompt_tokens: number; completion_tokens: number } {
  if (!data || typeof data !== 'object') return { prompt_tokens: 0, completion_tokens: 0 }
  const usage = (data as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') return { prompt_tokens: 0, completion_tokens: 0 }
  const row = usage as Record<string, unknown>
  return {
    prompt_tokens: Number(row.prompt_tokens ?? row.input_tokens ?? 0) || 0,
    completion_tokens: Number(row.completion_tokens ?? row.output_tokens ?? 0) || 0,
  }
}

/**
 * Prefer the Responses API (`store: false` so brand copy is not kept on xAI).
 * Fall back to Chat Completions if Responses is unavailable.
 */
export async function grokChatComplete(options: {
  apiKey: string
  model: string
  messages: GrokChatMessage[]
  temperature?: number
  maxTokens?: number
}): Promise<GrokChatCompleteResult> {
  const { apiKey, model, messages, temperature = 0.8, maxTokens = 4096 } = options
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  try {
    const responsesRes = await fetch(GROK_RESPONSES_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        input: messages,
        temperature,
        max_output_tokens: maxTokens,
        store: false,
      }),
    })
    if (responsesRes.ok) {
      const payload: unknown = await responsesRes.json()
      const content = extractGrokOutputText(payload)
      if (content.trim()) {
        return { content, usage: grokUsageFromPayload(payload), endpoint: 'responses' }
      }
    }
  } catch {
    // Responses unavailable — Chat Completions still works for grok-4.6.
  }

  const completionsRes = await fetch(GROK_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  })
  if (!completionsRes.ok) {
    const errorText = await completionsRes.text()
    throw new Error(`Grok API error: ${completionsRes.status}${errorText ? ` ${errorText.slice(0, 240)}` : ''}`)
  }
  const payload: unknown = await completionsRes.json()
  return {
    content: extractGrokOutputText(payload) || 'No response generated',
    usage: grokUsageFromPayload(payload),
    endpoint: 'chat_completions',
  }
}
