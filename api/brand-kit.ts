import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { supabaseAdmin } from './lib/supabase-admin.js'

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await requireAuth(req, res)
  if (!user) return
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Brand Kit storage is not configured' })
  }

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('brand_kits')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (error) {
      console.warn('brand-kit list failed:', error.message)
      return res.status(500).json({ error: 'Could not load brand kits' })
    }
    return res.status(200).json({ kits: data || [] })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = (req.body || {}) as Record<string, unknown>
  const kitId = typeof body.id === 'string' ? body.id.trim() : ''
  const payload: Record<string, unknown> = { user_id: user.id }
  const copyKeys = [
    'name', 'logo_url', 'primary_color', 'secondary_color', 'accent_color',
    'font_primary', 'font_secondary', 'tagline', 'industry', 'target_audience',
    'brand_voice', 'tone_keywords', 'must_use_phrases', 'forbidden_phrases',
    'visual_style_notes', 'reference_images', 'style_dnas', 'is_active', 'is_default', 'business_id',
  ] as const
  for (const key of copyKeys) {
    if (key in body) payload[key] = body[key]
  }
  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    payload.name = 'My Brand'
  }

  if (kitId) {
    const { data, error } = await supabaseAdmin
      .from('brand_kits')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', kitId)
      .eq('user_id', user.id)
      .select()
      .maybeSingle()
    if (data) return res.status(200).json({ kit: data })
    if (error) {
      console.warn('brand-kit update failed, creating a new kit:', error.message)
    }
  }

  const { count } = await supabaseAdmin
    .from('brand_kits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (count === 0) payload.is_default = true

  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .insert(payload)
    .select()
    .single()
  if (!error && data) return res.status(200).json({ kit: data })

  const core = {
    user_id: user.id,
    name: payload.name,
    logo_url: payload.logo_url || null,
    primary_color: payload.primary_color || null,
    secondary_color: payload.secondary_color || null,
    accent_color: payload.accent_color || null,
    brand_voice: payload.brand_voice || null,
    tone_keywords: payload.tone_keywords || [],
    must_use_phrases: payload.must_use_phrases || [],
    forbidden_phrases: payload.forbidden_phrases || [],
    is_active: true,
    ...(payload.business_id ? { business_id: payload.business_id } : {}),
  }
  const fallback = await supabaseAdmin.from('brand_kits').insert(core).select().single()
  if (fallback.error || !fallback.data) {
    console.warn('brand-kit insert failed:', error?.message || fallback.error?.message)
    return res.status(400).json({ error: 'Could not save brand kit' })
  }
  return res.status(200).json({ kit: fallback.data })
}
