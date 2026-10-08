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
