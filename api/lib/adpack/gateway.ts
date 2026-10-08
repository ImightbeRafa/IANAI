/**
 * Ad Pack engine — real ModelGateway.
 *
 * - json:       Grok text (grokChatComplete), robust JSON extraction, one retry.
 * - visionJson: Gemini 2.5 Flash, JSON mime type, no thinking, images inline.
 * - scene:      Grok Imagine first-gen (product lock via /images/edits when a
 *               product ref exists, compose otherwise), draft = 1k/medium.
 *
 * Costs are list-price estimates from api/lib/model-pricing.ts.
 * `withCostLedger` wraps any gateway and records every call for benchmarks.
 */
import { GoogleGenAI } from '@google/genai'
import { fetchPublicImageAsDataUrl, sniffImageMime } from '../fetch-image-data-url.js'
import { runGrokPostFirstGen } from '../grok-image-generate.js'
import { GROK_TEXT_MODEL_EFFICIENT, grokChatComplete, type GrokChatMessage } from '../grok-models.js'
import { estimateApiCostUsd } from '../model-pricing.js'
import type { ModelGateway } from './types.js'

export const ADPACK_VISION_MODEL = 'gemini-2.5-flash'
/** Max images per vision call and max bytes per inlined image. */
export const VISION_MAX_IMAGES = 4
export const VISION_MAX_IMAGE_BYTES = 6_000_000

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

function balancedSlice(text: string, start: number): string | null {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Parse model output as JSON: strips code fences, falls back to the first balanced {...} / [...]. */
export function extractJson<T = unknown>(raw: string): T {
  const text = (raw ?? '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fenced?.[1]?.trim(), text].filter((x): x is string => Boolean(x))
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T
    } catch {
      // fall through
    }
    for (let i = 0; i < c.length; i++) {
      if (c[i] !== '{' && c[i] !== '[') continue
      const slice = balancedSlice(c, i)
      if (!slice) continue
      try {
        return JSON.parse(slice) as T
      } catch {
        // keep scanning
      }
    }
  }
  throw new Error('model_output_not_json')
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/** Decode a data URL to bytes + mime. */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!m) throw new Error('invalid_data_url')
  const bytes = m[2] ? new Uint8Array(Buffer.from(m[3], 'base64')) : new TextEncoder().encode(decodeURIComponent(m[3]))
  return { bytes, mimeType: m[1] || sniffImageMime(bytes) || 'application/octet-stream' }
}

async function toInlinePart(image: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  const dataUrl = image.startsWith('data:') ? image : await fetchPublicImageAsDataUrl(image)
  if (!dataUrl) return null
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) return null
  if ((m[2].length * 3) / 4 > VISION_MAX_IMAGE_BYTES) return null
  return { inlineData: { mimeType: m[1], data: m[2] } }
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export interface ModelGatewayEnv {
  XAI_API_KEY?: string
  GROK_API_KEY?: string
  GEMINI_API_KEY?: string
  [key: string]: string | undefined
}

export interface CreateModelGatewayOptions {
  env?: ModelGatewayEnv
  /** Default text model for `json`. */
  textModel?: string
  visionModel?: string
}

export function createModelGateway(options: CreateModelGatewayOptions = {}): ModelGateway {
  const env = options.env ?? (process.env as ModelGatewayEnv)
  const xaiKey = (env.XAI_API_KEY || env.GROK_API_KEY || '').trim()
  const geminiKey = (env.GEMINI_API_KEY || '').trim()
  const missing = [!xaiKey && 'XAI_API_KEY (or GROK_API_KEY)', !geminiKey && 'GEMINI_API_KEY'].filter(Boolean)
  if (missing.length) throw new Error(`adpack_gateway_missing_env: ${missing.join(', ')}`)
  const textModel = options.textModel ?? GROK_TEXT_MODEL_EFFICIENT
  const visionModel = options.visionModel ?? ADPACK_VISION_MODEL
  let genai: GoogleGenAI | null = null
  const gemini = () => (genai ??= new GoogleGenAI({ apiKey: geminiKey }))

  return {
    async json<T>(input: { system: string; user: string; model?: string; maxTokens?: number; temperature?: number }) {
      const model = input.model || textModel
      let costUsd = 0
      const messages: GrokChatMessage[] = [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ]
      let lastError: unknown
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await grokChatComplete({
          apiKey: xaiKey,
          model,
          messages,
          temperature: input.temperature ?? 0.7,
          maxTokens: input.maxTokens ?? 1200,
        })
        costUsd += estimateApiCostUsd({ model, inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens })
        try {
          return { data: extractJson<T>(res.content), costUsd, model }
        } catch (error) {
          lastError = error
          messages.push({ role: 'assistant', content: res.content.slice(0, 4000) })
          messages.push({
            role: 'user',
            content: 'Your previous reply was not valid JSON. Return ONLY the JSON object, no prose, no code fences.',
          })
        }
      }
      throw lastError instanceof Error ? lastError : new Error('model_output_not_json')
    },

    async visionJson<T>(input: { system: string; user: string; images: string[]; model?: string }) {
      const model = input.model || visionModel
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { text: input.system },
        { text: input.user },
      ]
      let attached = 0
      for (const img of input.images.slice(0, VISION_MAX_IMAGES)) {
        const part = await toInlinePart(img)
        if (part) {
          parts.push(part)
          attached++
        }
      }
      if (input.images.length && !attached) throw new Error('vision_images_unavailable')
      const response = await gemini().models.generateContent({
        model,
        contents: parts,
        config: { temperature: 0.2, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      })
      const usage = response.usageMetadata
      const costUsd = estimateApiCostUsd({
        model,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        thinkingTokens: usage?.thoughtsTokenCount ?? 0,
      })
      return { data: extractJson<T>(response.text ?? ''), costUsd, model }
    },

    async scene(input) {
      const generated = await runGrokPostFirstGen({
        apiKey: xaiKey,
        prompt: input.prompt,
        aspectRatio: input.ratio,
        aspectRatioFallback: true,
        productReferenceUrls: input.refs.filter(Boolean).slice(0, 2),
        supportReferenceUrls: (input.styleRefs ?? []).filter(Boolean),
        language: input.language ?? null,
        resolution: input.draft ? '1k' : '2k',
        quality: 'medium',
      })
      let dataUrl = generated.imageDataUrl
      if (!dataUrl.startsWith('data:')) {
        const fetched = await fetchPublicImageAsDataUrl(dataUrl)
        if (!fetched) throw new Error('scene_image_download_failed')
        dataUrl = fetched
      }
      const { bytes, mimeType } = decodeDataUrl(dataUrl)
      return {
        bytes,
        mimeType: sniffImageMime(bytes) ?? mimeType,
        costUsd: generated.estimatedCostUsd,
        model: generated.providerModel,
        productLocked: generated.lockApplied,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Cost ledger
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  kind: 'json' | 'visionJson' | 'scene'
  model: string
  ms: number
  costUsd: number
  ok: boolean
  error?: string
}

export interface LedgeredGateway extends ModelGateway {
  ledger: LedgerEntry[]
  totalCostUsd(): number
}

/** Wrap a gateway and record every call (kind, model, ms, cost). */
export function withCostLedger(gateway: ModelGateway, onEntry?: (entry: LedgerEntry) => void): LedgeredGateway {
  const ledger: LedgerEntry[] = []
  const record = (e: LedgerEntry) => {
    ledger.push(e)
    onEntry?.(e)
  }
  async function track<R extends { costUsd: number; model: string }>(
    kind: LedgerEntry['kind'],
    fallbackModel: string | undefined,
    run: () => Promise<R>
  ): Promise<R> {
    const t0 = Date.now()
    try {
      const res = await run()
      record({ kind, model: res.model, ms: Date.now() - t0, costUsd: res.costUsd ?? 0, ok: true })
      return res
    } catch (error) {
      record({ kind, model: fallbackModel ?? 'unknown', ms: Date.now() - t0, costUsd: 0, ok: false, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
  return {
    ledger,
    totalCostUsd: () => ledger.reduce((s, e) => s + e.costUsd, 0),
    json<T>(input: Parameters<ModelGateway['json']>[0]) {
      return track('json', input.model, () => gateway.json<T>(input))
    },
    visionJson<T>(input: Parameters<ModelGateway['visionJson']>[0]) {
      return track('visionJson', input.model, () => gateway.visionJson<T>(input))
    },
    scene(input) {
      return track('scene', undefined, () => gateway.scene(input))
    },
  }
}
