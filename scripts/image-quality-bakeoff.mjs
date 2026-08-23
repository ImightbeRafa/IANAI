#!/usr/bin/env node
/**
 * Premium social image bakeoff: Nano Banana Pro (4K) vs Grok Imagine 2.0 (2k/medium).
 * Budget soft-cap: $2.00. Logs into api_usage_logs so Admin Dashboard reflects spend.
 *
 * Usage: node scripts/image-quality-bakeoff.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const BUDGET_USD = 2.0
const OUT_DIR = '/opt/cursor/artifacts/bakeoff_premium_social'
const USER_ID = '723bf159-32b9-4094-a9e5-c883041736af'
const USER_EMAIL = 'ralauas@gmail.com'
const BAKEOFF_ID = `bakeoff-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`

const GROK_MODEL = 'grok-imagine-image-2.0'
const GROK_COST = 0.04
const NANO_FALLBACK_4K = 0.24
const NANO_INPUT_PER_1M = 2.0
const NANO_IMAGE_OUT_PER_1M = 120.0
const NANO_THINK_PER_1M = 12.0

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

mkdirSync(OUT_DIR, { recursive: true })

const BRIEFS = [
  {
    id: 'ad-direct-3x4',
    aspectRatio: '3:4',
    needsProductRef: false,
    prompt: `Premium Instagram feed ad (3:4), photoreal studio lighting, soft shadow, clean luxury feel.
Brand: Pura Sonrisa CR. Product: whitening strips in a minimal matte white pouch with soft mint accent.
Large readable Spanish headline at top: "Sonrisa de clínica en casa".
Subline: "Resultados visibles en 7 días".
Bottom CTA pill: "Pedí el tuyo".
No fake logos, no watermark, no clutter. High-end dental aesthetic, premium social-ready.`,
  },
  {
    id: 'organic-editorial-1x1',
    aspectRatio: '1:1',
    needsProductRef: false,
    prompt: `Premium organic brand post (1:1), editorial lifestyle photography.
Morning bathroom vanity with natural window light, soft steam, linen towel, jade plant.
Subtle centered Spanish quote in elegant modern sans: "Tu sonrisa cuenta una historia".
Small brand mark text bottom-right: "Pura Sonrisa".
No hard sell, no price, no CTA button. Magical, calm, Instagram-premium.`,
  },
  {
    id: 'product-hero-3x4',
    aspectRatio: '3:4',
    needsProductRef: true,
    prompt: `Premium product hero for social (3:4). Keep the PRODUCT packaging identity exact from the reference image — shape, colors, label layout must match.
Place it on a polished marble surface with soft mint gradient backdrop, subtle reflection, cinematic key light.
Minimal caption space at bottom for Spanish text "Whitening strips · Costa Rica".
Ultra sharp, e-commerce premium, ready to post.`,
  },
]

function estimateGrokCost(referenceCount) {
  return GROK_COST * (1 + Math.max(0, referenceCount))
}

function estimateNanoCost({ inputTokens = 0, outputTokens = 0, thinkingTokens = 0 }) {
  if (outputTokens > 0) {
    return (
      (inputTokens / 1e6) * NANO_INPUT_PER_1M
      + (outputTokens / 1e6) * NANO_IMAGE_OUT_PER_1M
      + (thinkingTokens / 1e6) * NANO_THINK_PER_1M
    )
  }
  return NANO_FALLBACK_4K
    + (inputTokens / 1e6) * NANO_INPUT_PER_1M
    + (thinkingTokens / 1e6) * NANO_THINK_PER_1M
}

async function logUsage(row) {
  const { error } = await supabase.from('api_usage_logs').insert(row)
  if (error) throw new Error(`usage log failed: ${error.message}`)
}

async function ensureProductRef() {
  const refPath = join(OUT_DIR, '00_product_ref.jpg')
  if (existsSync(refPath)) {
    const b64 = readFileSync(refPath).toString('base64')
    return { path: refPath, dataUrl: `data:image/jpeg;base64,${b64}` }
  }
  const prompt = 'Studio product photo of a matte white dental whitening strips pouch with soft mint accent stripe and clean typography "PURA SONRISA", centered on seamless light gray background, sharp packaging details, no hands, no lifestyle.'
  const res = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROK_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      prompt,
      n: 1,
      response_format: 'b64_json',
      aspect_ratio: '1:1',
      resolution: '2k',
      quality: 'medium',
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`product ref failed: ${JSON.stringify(json).slice(0, 400)}`)
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error('product ref missing b64')
  writeFileSync(refPath, Buffer.from(b64, 'base64'))
  const generationId = randomUUID()
  const cost = estimateGrokCost(0)
  await logUsage({
    user_id: USER_ID,
    user_email: USER_EMAIL,
    feature: 'image',
    model: 'grok-imagine',
    generation_id: generationId,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: cost,
    success: true,
    metadata: {
      provider: 'xai',
      providerModel: GROK_MODEL,
      action: 'generate',
      resolution: '2k',
      quality: 'medium',
      costSource: 'documented_image_rate',
      bakeoffId: BAKEOFF_ID,
      briefId: 'product-ref',
    },
  })
  return { path: refPath, dataUrl: `data:image/jpeg;base64,${b64}`, cost, generationId }
}

async function generateGrok(brief, productRef, spent) {
  const refs = brief.needsProductRef ? 1 : 0
  const est = estimateGrokCost(refs)
  if (spent + est > BUDGET_USD) return { skipped: true, reason: 'budget' }

  const generationId = randomUUID()
  const body = {
    model: GROK_MODEL,
    prompt: brief.prompt,
    n: 1,
    response_format: 'b64_json',
    aspect_ratio: brief.aspectRatio,
    resolution: '2k',
    quality: 'medium',
  }
  let url = 'https://api.x.ai/v1/images/generations'
  if (brief.needsProductRef) {
    url = 'https://api.x.ai/v1/images/edits'
    body.image = { url: productRef.dataUrl, type: 'image_url' }
  }

  const started = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROK_API_KEY}`,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  const ms = Date.now() - started
  if (!res.ok) {
    await logUsage({
      user_id: USER_ID,
      user_email: USER_EMAIL,
      feature: 'image',
      model: 'grok-imagine',
      generation_id: generationId,
      estimated_cost_usd: 0,
      success: false,
      error_message: JSON.stringify(json).slice(0, 500),
      metadata: {
        provider: 'xai',
        providerModel: GROK_MODEL,
        bakeoffId: BAKEOFF_ID,
        briefId: brief.id,
        resolution: '2k',
        quality: 'medium',
        referenceCount: refs,
        costSource: 'unavailable',
        latencyMs: ms,
      },
    })
    return { ok: false, error: json, ms, generationId }
  }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) return { ok: false, error: 'no b64', ms, generationId }
  const file = join(OUT_DIR, `grok_${brief.id}.jpg`)
  writeFileSync(file, Buffer.from(b64, 'base64'))
  await logUsage({
    user_id: USER_ID,
    user_email: USER_EMAIL,
    feature: 'image',
    model: 'grok-imagine',
    generation_id: generationId,
    estimated_cost_usd: est,
    success: true,
    metadata: {
      provider: 'xai',
      providerModel: GROK_MODEL,
      action: refs ? 'edit' : 'generate',
      bakeoffId: BAKEOFF_ID,
      briefId: brief.id,
      resolution: '2k',
      quality: 'medium',
      referenceCount: refs,
      costSource: 'documented_image_rate',
      latencyMs: ms,
      artifact: file,
    },
  })
  return { ok: true, file, cost: est, ms, generationId }
}

async function generateNano(brief, productRef, spent) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const generationId = randomUUID()
  const parts = [{ text: brief.prompt }]
  if (brief.needsProductRef && productRef?.dataUrl) {
    const raw = productRef.dataUrl.split(',')[1]
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: raw } })
  }

  const started = Date.now()
  let response
  try {
    response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: parts,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: brief.aspectRatio, imageSize: '4K' },
      },
    })
  } catch (err) {
    const ms = Date.now() - started
    await logUsage({
      user_id: USER_ID,
      user_email: USER_EMAIL,
      feature: 'image',
      model: 'nano-banana-pro',
      generation_id: generationId,
      estimated_cost_usd: 0,
      success: false,
      error_message: err instanceof Error ? err.message : String(err),
      metadata: {
        provider: 'google',
        providerModel: 'gemini-3-pro-image-preview',
        bakeoffId: BAKEOFF_ID,
        briefId: brief.id,
        imageSize: '4K',
        costSource: 'unavailable',
        latencyMs: ms,
      },
    })
    return { ok: false, error: err, ms, generationId }
  }
  const ms = Date.now() - started
  const candParts = response.candidates?.[0]?.content?.parts || []
  let imageB64 = null
  let mime = 'image/png'
  for (const part of candParts) {
    if (part.inlineData?.data) {
      imageB64 = part.inlineData.data
      mime = part.inlineData.mimeType || mime
      break
    }
  }
  const usage = response.usageMetadata || {}
  const inputTokens = usage.promptTokenCount || 0
  const outputTokens = usage.candidatesTokenCount || 0
  const thinkingTokens = usage.thoughtsTokenCount || 0
  const cost = estimateNanoCost({ inputTokens, outputTokens, thinkingTokens })
  if (spent + cost > BUDGET_USD + 0.05) {
    // Still log actual billable success if provider already charged.
  }
  if (!imageB64) {
    await logUsage({
      user_id: USER_ID,
      user_email: USER_EMAIL,
      feature: 'image',
      model: 'nano-banana-pro',
      generation_id: generationId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens + thinkingTokens,
      estimated_cost_usd: 0,
      success: false,
      error_message: 'No image in Gemini response',
      metadata: {
        provider: 'google',
        providerModel: 'gemini-3-pro-image-preview',
        bakeoffId: BAKEOFF_ID,
        briefId: brief.id,
        imageSize: '4K',
        rawUsage: usage,
        costSource: 'unavailable',
        latencyMs: ms,
      },
    })
    return { ok: false, error: 'no image', ms, generationId }
  }
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
  const file = join(OUT_DIR, `nano_${brief.id}.${ext}`)
  writeFileSync(file, Buffer.from(imageB64, 'base64'))
  await logUsage({
    user_id: USER_ID,
    user_email: USER_EMAIL,
    feature: 'image',
    model: 'nano-banana-pro',
    generation_id: generationId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens + thinkingTokens,
    estimated_cost_usd: cost,
    success: true,
    metadata: {
      provider: 'google',
      providerModel: 'gemini-3-pro-image-preview',
      bakeoffId: BAKEOFF_ID,
      briefId: brief.id,
      imageSize: '4K',
      rawUsage: usage,
      costSource: outputTokens > 0 ? 'provider_usage' : 'documented_image_size_fallback',
      latencyMs: ms,
      artifact: file,
    },
  })
  return { ok: true, file, cost, ms, generationId, tokens: { inputTokens, outputTokens, thinkingTokens } }
}

async function main() {
  let spent = 0
  const results = []

  console.log(JSON.stringify({ bakeoffId: BAKEOFF_ID, budget: BUDGET_USD }, null, 2))

  const productRef = await ensureProductRef()
  if (productRef.cost) {
    spent += productRef.cost
    results.push({ model: 'grok-imagine', briefId: 'product-ref', ...productRef })
  }

  // Pair each brief: Nano then Grok so spend stays balanced.
  for (const brief of BRIEFS) {
    for (const model of ['nano-banana-pro', 'grok-imagine']) {
      if (spent >= BUDGET_USD - 0.02) {
        results.push({ model, briefId: brief.id, skipped: true, reason: 'budget' })
        continue
      }
      const out = model === 'nano-banana-pro'
        ? await generateNano(brief, productRef, spent)
        : await generateGrok(brief, productRef, spent)
      if (out.skipped) {
        results.push({ model, briefId: brief.id, ...out })
        continue
      }
      if (out.ok) spent += out.cost
      results.push({ model, briefId: brief.id, ...out, spentSoFar: Number(spent.toFixed(4)) })
      console.log(JSON.stringify({
        model,
        briefId: brief.id,
        ok: out.ok,
        cost: out.cost,
        ms: out.ms,
        spent: Number(spent.toFixed(4)),
        file: out.file,
      }))
    }
  }

  // Second pass (duplicates of same briefs) only if budget remains — fills toward 6/model.
  for (const brief of BRIEFS) {
    for (const model of ['nano-banana-pro', 'grok-imagine']) {
      const already = results.filter((r) => r.model === model && r.briefId === brief.id && r.ok).length
      if (already >= 2) continue
      if (spent >= BUDGET_USD - 0.05) continue
      const passBrief = { ...brief, id: `${brief.id}-b` }
      const out = model === 'nano-banana-pro'
        ? await generateNano(passBrief, productRef, spent)
        : await generateGrok(passBrief, productRef, spent)
      if (out.ok) spent += out.cost
      results.push({ model, briefId: passBrief.id, pass: 2, ...out, spentSoFar: Number(spent.toFixed(4)) })
      console.log(JSON.stringify({
        pass: 2,
        model,
        briefId: passBrief.id,
        ok: out.ok,
        cost: out.cost,
        ms: out.ms,
        spent: Number(spent.toFixed(4)),
        file: out.file,
      }))
    }
  }

  const summary = {
    bakeoffId: BAKEOFF_ID,
    budgetUsd: BUDGET_USD,
    spentUsd: Number(spent.toFixed(4)),
    remainingUsd: Number((BUDGET_USD - spent).toFixed(4)),
    byModel: {},
    results: results.map((r) => ({
      model: r.model,
      briefId: r.briefId,
      ok: r.ok,
      skipped: r.skipped,
      cost: r.cost,
      ms: r.ms,
      file: r.file,
      generationId: r.generationId,
      tokens: r.tokens,
      error: r.error ? String(r.error?.message || r.error).slice(0, 240) : undefined,
    })),
  }
  for (const model of ['nano-banana-pro', 'grok-imagine']) {
    const rows = results.filter((r) => r.model === model && r.ok)
    summary.byModel[model] = {
      successes: rows.length,
      costUsd: Number(rows.reduce((s, r) => s + (r.cost || 0), 0).toFixed(4)),
      avgCostUsd: rows.length ? Number((rows.reduce((s, r) => s + (r.cost || 0), 0) / rows.length).toFixed(4)) : 0,
      avgLatencyMs: rows.length ? Math.round(rows.reduce((s, r) => s + (r.ms || 0), 0) / rows.length) : 0,
    }
  }

  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
