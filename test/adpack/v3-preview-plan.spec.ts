/**
 * Merge contract (ad-pack v3 × fidelity/logo): in exact mode the free copy preview shows the
 * formats and photos start actually runs — person formats substituted (no in-use photo) and the
 * hero photo guaranteed in at least one ad — and start reuses that preview (previewId).
 */
import { describe, expect, it } from 'vitest'
import { PERSON_FORMATS, resolvePackAngles } from '../../api/lib/adpack/plan-angles'
import type { OfferInput } from '../../api/lib/adpack/types'
import { createDoorEnv, serum, USER_A } from './door-harness'

const HERO = 'https://cdn.test/hero.jpg'
const KIT = 'https://cdn.test/kit-contents.jpg'

describe('exact-mode preview == start plan (hero + person-format substitution)', () => {
  it('preview formats/photos equal what start plans and runs; start reuses the preview', async () => {
    const offer: OfferInput = {
      ...serum.offer,
      productImageUrls: [KIT, HERO],
      productPhotos: [
        { url: KIT, role: 'contents', label: 'contenido' },
        { url: HERO, role: 'hero', label: 'frasco' },
      ],
    }
    const board = resolvePackAngles({ dna: serum.dna, offer, size: 12, productFidelity: 'generated' })
    const person = board.find((a) => PERSON_FORMATS.has(a.format))!
    const other = board.find((a) => !PERSON_FORMATS.has(a.format))!
    expect(person).toBeTruthy()

    const e = createDoorEnv()
    const args = { userId: USER_A, dna: serum.dna, offer, angleIds: [person.id, other.id], productFidelity: 'exact', creativeFreedom: 'guided' }
    const quote = await e.service.quote(args)
    const preview = await e.service.previewPack({ ...args, source: 'mcp' })
    expect(preview.chargedCredits).toBe(0)
    expect(preview.ads).toHaveLength(2)
    // Substituted before quote/preview: no hand-held format, same count, same category/hook.
    expect(preview.ads.some((a) => PERSON_FORMATS.has(a.format))).toBe(false)
    expect(preview.ads[0].hookType).toBe(person.hookType)
    expect(preview.quote.angleIds).toEqual(quote.angleIds)
    // Hero guaranteed in >= 1 ad (the first ad without a per-ad pick).
    expect(preview.ads.some((a) => a.photo?.url === HERO)).toBe(true)

    const started = await e.service.startPack({ ...args, expectedAds: preview.ads.length, source: 'mcp' })
    expect(started.previewId).toBe(preview.previewId)
    expect(started.angles!.map((a) => a.format)).toEqual(preview.ads.map((a) => a.format))
    expect(started.angles!.map((a) => a.angleId)).toEqual(preview.ads.map((a) => a.angleId))

    await e.service.advance({ userId: USER_A, packId: started.packId })
    const status = await e.service.getStatus({ userId: USER_A, packId: started.packId })
    const items = [...status.items].sort((a, b) => a.index - b.index)
    expect(items.map((i) => i.format)).toEqual(preview.ads.map((a) => a.format))
    for (const [i, item] of items.entries()) {
      expect(item.status, item.error).toBe('done')
      expect(item.photo?.url).toBe(preview.ads[i].photo?.url)
    }
    expect(items.some((i) => i.photo?.url === HERO)).toBe(true)
  })
})
