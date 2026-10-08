import { describe, expect, it } from 'vitest'
import { createDoorEnv } from './door-harness'
import { BENCHMARK_OFFERS } from '../fixtures/adpack/benchmark-offers'

const OWNED_BIZ = '11111111-1111-4111-8111-111111111111'
const FOREIGN_BIZ = '22222222-2222-4222-8222-222222222222'

describe('startPack linked ids', () => {
  const fixture = BENCHMARK_OFFERS[0]

  it('accepts a business the user owns', async () => {
    const env = createDoorEnv({ ownedIds: [OWNED_BIZ] })
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna: fixture.dna, offer: fixture.offer, size: 2, businessId: OWNED_BIZ })
    expect(res.packId).toBeTruthy()
  })

  it('rejects a business the user does not own', async () => {
    const env = createDoorEnv({ ownedIds: [OWNED_BIZ] })
    await expect(
      env.service.startPack({ userId: 'u1', source: 'web', dna: fixture.dna, offer: fixture.offer, size: 2, businessId: FOREIGN_BIZ }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(env.charges).toHaveLength(0)
  })
})

describe('startPack angle selection', () => {
  const fixture = BENCHMARK_OFFERS[0]

  it('generates exactly the selected angles, renumbered, and quotes only those', async () => {
    const env = createDoorEnv()
    const board = await env.service.planAngles({ userId: 'u1', dna: fixture.dna, offer: fixture.offer, size: 10 })
    const pick = [board.angles[1].id, board.angles[4].id, board.angles[8].id]
    const res = await env.service.startPack({ userId: 'u1', source: 'web', dna: fixture.dna, offer: fixture.offer, size: 10, angleIds: pick })
    expect(res.quote.size).toBe(3)
    const status = await env.service.getStatus({ userId: 'u1', packId: res.packId })
    const byId = new Map(board.angles.map((a) => [a.id, a]))
    expect(status.items.map((i) => i.message)).toEqual(pick.map((id) => byId.get(id)!.message))
    expect(status.items.map((i) => i.index)).toEqual([0, 1, 2])
  })

  it('rejects malformed angleIds', async () => {
    const env = createDoorEnv()
    await expect(
      env.service.startPack({ userId: 'u1', source: 'web', dna: fixture.dna, offer: fixture.offer, size: 10, angleIds: 'a01' }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' })
  })
})
