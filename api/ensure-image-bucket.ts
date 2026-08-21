import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { supabaseAdmin } from './lib/supabase-admin.js'

const IMAGE_BUCKET = 'post-images'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await requireAuth(req, res)
  if (!user) return
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Storage is not configured' })
  }

  const { data: existing, error: lookupError } = await supabaseAdmin.storage.getBucket(IMAGE_BUCKET)
  if (existing) {
    return res.status(200).json({ ok: true, bucket: IMAGE_BUCKET, created: false })
  }
  if (lookupError && !/not found/i.test(lookupError.message || '')) {
    console.error('Image bucket lookup failed:', lookupError)
  }

  const { error: createError } = await supabaseAdmin.storage.createBucket(IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
  })

  if (createError && !/already exists|duplicate/i.test(createError.message || '')) {
    console.error('Image bucket creation failed:', createError)
    return res.status(500).json({ error: 'Could not initialize image storage' })
  }

  return res.status(200).json({ ok: true, bucket: IMAGE_BUCKET, created: !createError })
}
