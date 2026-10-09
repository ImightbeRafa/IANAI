import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { McpOwnedImage } from '../api/lib/mcp/artifact-store'
import { buildCaption } from '../api/lib/mcp/copy-layout'
import { splitAccessoryRefs } from '../api/lib/mcp/execute-tools'
import { checkGeneratedProductFidelity, checkSafeZones, countCtaButtons, runMcpImageQa } from '../api/lib/mcp/image-postcheck'
import { enforceSafeZones } from '../api/lib/mcp/safe-zone-fix'
import { pickAccessoryPhotos } from '../api/lib/mcp/web-image'
import { buildMcpPromptRules, selectWebPostReferenceUrls } from '../api/lib/web-post-image'

const R5 = (name: string) => readFileSync(new URL(`./fixtures/round5/${name}`, import.meta.url))
const durl = (b: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${b.toString('base64')}`

/** A simple opaque logo plate like the kit logo (wordmark on a navy plate). */
async function logoPng(): Promise<Buffer> {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect x="6" y="6" width="588" height="228" rx="20" fill="#15263E" stroke="#fff" stroke-width="6"/><text x="300" y="150" font-size="90" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">Prototipo</text></svg>'
  return sharp(Buffer.from(svg)).png().toBuffer()
}

describe('round 5 raw image: deterministic safe-zone fix (4:5)', () => {
  it('the Prototipo ad (clipped logo in the top band + CTA 1% from the bottom edge) violates, and is FIXED in code: passes every time, same pixel size, logo re-stamped whole', async () => {
    const raw = R5('proto-saturday-4x5.jpg')
    const before = await checkSafeZones(raw, '4:5')
    expect(before.some((i) => i.edge === 'bottom' && i.kind === 'block_touches_edge')).toBe(true)
    expect(before.some((i) => i.edge === 'top')).toBe(true)
    const fixed = await enforceSafeZones({ bytes: raw, ratio: '4:5', logo: await logoPng() })
    expect(fixed.fix.applied).toBe(true)
    expect(fixed.fix.after).toEqual([])
    expect(fixed.fix.logoRestored).toBe(true)
    const [m0, m1] = [await sharp(raw).metadata(), await sharp(fixed.bytes).metadata()]
    expect([m1.width, m1.height]).toEqual([m0.width, m0.height]) // ratio exact
    const qa = await runMcpImageQa({ generatedDataUrl: durl(fixed.bytes), requestedRatio: '4:5', copyRequested: true, logoAttached: true, logoExpected: true })
    expect(qa.safeZones).toBe('ok')
    expect(qa.ratioOk).toBe(true)
  })

  it('without a logo the scale-in alone still passes (no clipping or distortion: uniform scale of the whole picture)', async () => {
    const raw = R5('proto-saturday-4x5.jpg')
    const fixed = await enforceSafeZones({ bytes: raw, ratio: '4:5', logo: null })
    expect(fixed.fix.logoRestored).toBe(false)
    expect(fixed.fix.after).toEqual([])
    expect(fixed.fix.scale).toBeGreaterThan(0.7)
    expect(fixed.fix.scale).toBeLessThan(1)
  })

  it('a clean image is returned untouched (no-op)', async () => {
    const clean = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#223344' } }).jpeg().toBuffer()
    const r = await enforceSafeZones({ bytes: clean, ratio: '4:5' })
    expect(r.fix.applied).toBe(false)
    expect(r.bytes).toBe(clean)
  })

  it('9:16: a violating picture is fixed within the larger story margins (14% top / 20% bottom) and keeps its pixel size', async () => {
    const raw = R5('proto-saturday-4x5.jpg')
    const story = await sharp(raw).resize(720, 1280, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer()
    const issues = await checkSafeZones(story, '9:16')
    expect(issues.length).toBeGreaterThan(0)
    const fixed = await enforceSafeZones({ bytes: story, ratio: '9:16', logo: await logoPng() })
    expect(fixed.fix.after).toEqual([])
    const meta = await sharp(fixed.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([720, 1280])
    expect(fixed.fix.scale).toBeLessThan(0.75)
  })
})

describe('ctaButtons: logo plate and scene surfaces are not buttons', () => {
  // Round 5 reported ctaButtons 2: the extra block was the wooden table edge touching the left border, not the logo plate.
  it('the round-5 ad shows ONE button (the CTA), not two; extraCtaRisk stays false', async () => {
    const raw = R5('proto-saturday-4x5.jpg')
    expect(await countCtaButtons(raw)).toBe(1)
    const qa = await runMcpImageQa({ generatedDataUrl: durl(raw), requestedRatio: '4:5', copyRequested: true, logoAttached: true, logoExpected: true })
    expect(qa.ctaButtons).toBe(1)
    expect(qa.extraCtaRisk).toBe(false)
  })
  it('a located logo box is excluded explicitly', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#334"/><rect x="520" y="400" width="200" height="70" rx="12" fill="#e91e63"/><rect x="250" y="800" width="300" height="90" rx="14" fill="#2ec4b6"/></svg>'
    const img = await sharp(Buffer.from(svg)).jpeg().toBuffer()
    expect(await countCtaButtons(img)).toBe(2)
    expect(await countCtaButtons(img, { logoBox: { x0: 0.62, y0: 0.38, x1: 0.92, y1: 0.5 } })).toBe(1)
  })
})

describe('accessory references (MCP only) and the plane lock', () => {
  it('selectWebPostReferenceUrls: the web keeps 3 slots, the MCP path can raise it to 5 for real accessory photos', () => {
    const p = ['p1', 'p2', 'acc1', 'acc2']
    expect(selectWebPostReferenceUrls({ productUrls: p, logoDataUrl: 'logo' })).toHaveLength(3)
    const five = selectWebPostReferenceUrls({ productUrls: p, logoDataUrl: 'logo', max: 5 })
    expect(five).toHaveLength(5)
    expect(five).toContain('acc2')
    expect(five).toContain('logo')
  })
  it('splitAccessoryRefs lifts box / controller photos out of the product refs (never the SKU photo, never all of them)', () => {
    const imgs = [
      { id: 'a', imageUrl: 'u1', kind: 'product', label: 'avión lado', offerId: 'o' },
      { id: 'b', imageUrl: 'u2', kind: 'product', label: 'caja TOPGT', offerId: 'o' },
      { id: 'c', imageUrl: 'u3', kind: 'product', label: '[part] control gamepad', offerId: 'o' },
    ] as McpOwnedImage[]
    const r = splitAccessoryRefs(imgs, 'a')
    expect(r.rest.map((i) => i.id)).toEqual(['a'])
    expect(r.accessories.map((a) => a.id)).toEqual(['b', 'c'])
    // only accessories selected → they stay as product refs (a product photo is always needed)
    expect(splitAccessoryRefs([imgs[1]], undefined).accessories).toEqual([])
  })
  it('pickAccessoryPhotos onlyMatching: only photos named by allowedProps are attached (default no props = no accessory photos)', () => {
    const assets = [
      { id: 'b', imageUrl: 'u2', label: 'caja TOPGT', tags: ['caja'] },
      { id: 'c', imageUrl: 'u3', label: 'control', tags: ['part'] },
    ]
    expect(pickAccessoryPhotos(assets, { excludeIds: [], lockText: '', onlyMatching: true })).toEqual([])
    expect(pickAccessoryPhotos(assets, { excludeIds: [], lockText: 'control gamepad negro real', onlyMatching: true }).map((a) => a.id)).toEqual(['c'])
    expect(pickAccessoryPhotos(assets, { excludeIds: [], lockText: 'caja TOPGT real; control gamepad', onlyMatching: true }).map((a) => a.id)).toEqual(['b', 'c'])
  })
  it('the prompt says: do not add or remove wings, fins, flaps or parts; accessories keep their relative size', () => {
    const es = buildMcpPromptRules('es', { strict: true, requestedRatio: '4:5', accessoryLabels: ['caja', 'control'] }, { hasProductRefs: true })
    expect(es).toMatch(/No agregues ni quites alas, aletas, flaps ni piezas/)
    expect(es).toMatch(/tamaño relativo/)
    const en = buildMcpPromptRules('en', { strict: true, requestedRatio: '4:5' }, { hasProductRefs: true })
    expect(en).toMatch(/Do not add or remove wings, fins, flaps or parts/)
  })
})

describe('caption', () => {
  it('is deterministic: headline, facts, overflow lines (punctuated), CTA last', () => {
    const c = buildCaption({ onImage: 'Doblá, armá y volá\n₡14.900\nEnvío gratis\nEscribinos por DM', overflow: ['Papel y 3 pilas AA no incluidos', 'Desde 8 años con adulto.'], cta: 'Escribinos por DM' })
    expect(c).toBe('Doblá, armá y volá\n\n₡14.900.\nEnvío gratis.\nPapel y 3 pilas AA no incluidos.\nDesde 8 años con adulto.\n\n👉 Escribinos por DM')
    expect(buildCaption({ onImage: 'Hola', overflow: [] })).toBe('Hola')
  })
})

describe('fidelity fallback when the feature match fails (dark / low-texture product, different angle)', () => {
  const ref = () => durl(R5('plane-side-ref.jpg'))
  it('round-5 plane (angle differs from the photo): no longer "unverified" — its distinctive part colours are all present → ok (palette)', async () => {
    const r = await checkGeneratedProductFidelity({ referenceDataUrls: [ref()], generatedDataUrl: durl(R5('proto-saturday-4x5.jpg')) })
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.details.method).toBe('palette')
      expect(r.details.confident).toBe(false)
      expect(r.details.parts?.missing).toEqual([])
    }
  })
  it('the same picture with the coloured parts gone (greyscale) → fidelity_warning naming the missing part colour', async () => {
    const grey = await sharp(R5('proto-saturday-4x5.jpg')).greyscale().jpeg().toBuffer()
    const r = await checkGeneratedProductFidelity({ referenceDataUrls: [ref()], generatedDataUrl: durl(grey) })
    expect(r.status).toBe('warning')
    if (r.status === 'warning') expect(r.warning.reason).toMatch(/missing/)
  })
})
