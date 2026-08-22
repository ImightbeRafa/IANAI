#!/usr/bin/env node
/**
 * Move posts.generated_image_url data: URIs into Supabase Storage (post-images),
 * then replace the column with the public HTTPS URL.
 *
 * Dry-run by default. Requires:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/backfill-post-data-urls.mjs --product <uuid>
 *   node scripts/backfill-post-data-urls.mjs --product <uuid> --apply
 *   node scripts/backfill-post-data-urls.mjs --all --apply --limit 50
 */
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(name)
  if (i === -1) return null
  return args[i + 1] ?? true
}

const apply = args.includes('--apply')
const all = args.includes('--all')
const productId = flag('--product')
const limit = Number(flag('--limit') || 25)

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!all && !productId) {
  console.error('Pass --product <uuid> or --all')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const BUCKET = 'post-images'

function parseDataUri(dataUri) {
  const m = String(dataUri).match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return null
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') }
}

function extForMime(mime) {
  if (/png/i.test(mime)) return 'png'
  if (/webp/i.test(mime)) return 'webp'
  return 'jpg'
}

async function main() {
  console.log(apply ? 'APPLY mode' : 'DRY-RUN mode (pass --apply to write)')
  let query = supabase
    .from('posts')
    .select('id, product_id, created_by, generated_image_url, carousel_group_id, slide_index')
    .like('generated_image_url', 'data:%')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (productId) query = query.eq('product_id', productId)

  const { data: rows, error } = await query
  if (error) throw error
  console.log(`Candidates: ${rows?.length || 0}`)

  let ok = 0
  let failed = 0
  for (const row of rows || []) {
    const parsed = parseDataUri(row.generated_image_url)
    if (!parsed) {
      console.warn(`skip ${row.id}: not a parseable data URI`)
      failed++
      continue
    }
    const ext = extForMime(parsed.mime)
    const slide = row.slide_index ?? 0
    const group = row.carousel_group_id || 'solo'
    const path = `${row.created_by}/${row.product_id}/backfill-${row.id}-g${group}-s${slide}.${ext}`
    console.log(`${apply ? 'upload' : 'would-upload'} ${row.id} -> ${path} (${parsed.buffer.length} bytes)`)

    if (!apply) {
      ok++
      continue
    }

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, parsed.buffer, {
      contentType: parsed.mime,
      upsert: true,
    })
    if (upErr) {
      console.error(`upload failed ${row.id}:`, upErr.message)
      failed++
      continue
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const { error: updErr } = await supabase
      .from('posts')
      .update({ generated_image_url: pub.publicUrl })
      .eq('id', row.id)
      .like('generated_image_url', 'data:%')
    if (updErr) {
      console.error(`update failed ${row.id}:`, updErr.message)
      failed++
      continue
    }
    ok++
  }
  console.log(`Done. ok=${ok} failed=${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
