import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdPackLibrary, isUniqueViolation } from '../../api/lib/adpack/library'

const USER = '00000000-0000-4000-8000-00000000000a'
const PRODUCT = 'aaaaaaaa-0000-4000-8000-0000000000f1'
const PACK = '11111111-1111-4111-8111-111111111111'

interface Row { id: string; product_id: string; user_id: string; image_url: string; label: string; kind: string }

/**
 * Minimal PostgREST-shaped fake for the calls library.ts makes. `uniqueIndex` mimics
 * migration 084 (a conflicting row fails the whole insert with 23505); `racer` inserts a
 * row right after the first existence read, like a concurrent worker.
 */
function fakeDb(options: { uniqueIndex: boolean; racer?: (rows: Row[]) => void; insertError?: { code: string; message: string } }) {
  const rows: Row[] = []
  let reads = 0
  let inserts = 0
  let nextId = 1
  const db = {
    from(table: string) {
      if (table === 'products') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: PRODUCT }, error: null }) }) }) }),
        }
      }
      return {
        select: () => ({
          eq: (_c1: string, productId: string) => ({
            eq: (_c2: string, userId: string) => ({
              in: async (_c3: string, urls: string[]) => {
                reads++
                const data = rows.filter((r) => r.product_id === productId && r.user_id === userId && urls.includes(r.image_url)).map((r) => ({ id: r.id, image_url: r.image_url }))
                if (reads === 1 && options.racer) options.racer(rows)
                return { data, error: null }
              },
            }),
          }),
        }),
        insert: (payload: Omit<Row, 'id'> | Array<Omit<Row, 'id'>>) => ({
          select: async () => {
            inserts++
            if (options.insertError) return { data: null, error: options.insertError }
            const list = Array.isArray(payload) ? payload : [payload]
            if (options.uniqueIndex && list.some((p) => rows.some((r) => r.product_id === p.product_id && r.user_id === p.user_id && r.image_url === p.image_url))) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "product_images_adpack_render_unique"' } }
            }
            const created = list.map((p) => ({ ...p, id: `img-${nextId++}` }))
            rows.push(...created)
            return { data: created.map((r) => ({ id: r.id, image_url: r.image_url })), error: null }
          },
        }),
      }
    },
  }
  return { db: db as unknown as SupabaseClient, rows, stats: () => ({ reads, inserts }) }
}

const renders = (['1:1', '4:5', '9:16'] as const).map((ratio) => ({ ratio, imageUrl: `https://cdn.example/${ratio}.png` }))
const input = { userId: USER, productId: PRODUCT, packId: PACK, itemIndex: 0, headline: 'Titular', renders }

describe('Supabase ad pack library', () => {
  it('inserts missing renders as kind generated with the Ad Pack label', async () => {
    const env = fakeDb({ uniqueIndex: true })
    const saved = await createSupabaseAdPackLibrary(env.db).saveRenders(input)
    expect(saved.map((s) => s.ratio)).toEqual(['1:1', '4:5', '9:16'])
    expect(env.rows).toHaveLength(3)
    expect(env.rows.every((r) => r.kind === 'generated' && r.label.startsWith('Ad Pack 11111111 #1'))).toBe(true)
  })

  it('treats a unique violation (23505, concurrent save) as already saved: no error, no duplicates, existing ids returned', async () => {
    // Another worker saves the 4:5 render between our existence check and our insert.
    const env = fakeDb({
      uniqueIndex: true,
      racer: (rows) => rows.push({ id: 'racer-45', product_id: PRODUCT, user_id: USER, image_url: renders[1].imageUrl, label: 'Ad Pack x', kind: 'generated' }),
    })
    const saved = await createSupabaseAdPackLibrary(env.db).saveRenders(input)
    expect(saved).toHaveLength(3)
    expect(saved.find((s) => s.ratio === '4:5')?.productImageId).toBe('racer-45')
    expect(env.rows).toHaveLength(3)
    expect(new Set(env.rows.map((r) => r.image_url)).size).toBe(3)

    // Saving again is a pure read: nothing inserted.
    const before = env.stats().inserts
    const again = await createSupabaseAdPackLibrary(env.db).saveRenders(input)
    expect(again.map((s) => s.productImageId)).toEqual(saved.map((s) => s.productImageId))
    expect(env.stats().inserts).toBe(before)
  })

  it('still throws on other insert errors', async () => {
    const env = fakeDb({ uniqueIndex: true, insertError: { code: '42501', message: 'permission denied' } })
    await expect(createSupabaseAdPackLibrary(env.db).saveRenders(input)).rejects.toThrow(/adpack_library_failed: permission denied/)
  })

  it('recognises unique violations by code or message', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "x"' })).toBe(true)
    expect(isUniqueViolation({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
