/**
 * Round 11 (MCP 0.24.0):
 *  1. mask coverage: the PH pouch's white top (light part on a light backdrop) is repaired, fidelity is measured vs the PHOTO
 *  2. clear sheet film kept around a patch grid
 *  3. pack OCR reads tiles: SP r9 small print "ingecdicates" fails
 *  4. low-fidelity fallback constant, quote resolves productFidelity, role clipped to the DB limit (60)
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { segmentProduct } from '../api/lib/adpack/fidelity/segment'
import { sheetFilm, FILM_ALPHA } from '../api/lib/adpack/fidelity/sheet-film'
import { PHOTO_IOU_REJECT, MASK_MISSED_MAX } from '../api/lib/adpack/fidelity/mask-coverage'
import { checkPackText, ocrAvailable } from '../api/lib/mcp/pack-ocr'
import { FIDELITY_FALLBACK_BELOW } from '../api/lib/mcp/web-image'
import { resolveQuotedProductFidelity } from '../api/lib/mcp/execute-tools'
import { clipWithNotice, ROLE_DB_MAX } from '../api/lib/mcp/text-limits'
import { MCP_VERSION } from '../api/lib/mcp/server-info'

vi.setConfig({ testTimeout: 90_000 })
const F11 = (n: string) => readFileSync(new URL(`./fixtures/round11/${n}`, import.meta.url))
const F10 = (n: string) => readFileSync(new URL(`./fixtures/round10/${n}`, import.meta.url))

describe('round 11 — 0.24.0', () => {
  it('version', () => { expect(MCP_VERSION).toBe('0.24.0') })

  it('PH energy pouch: the flood mask missed the white top → repaired, full pouch (IoU vs the photo ≥ 0.97)', async () => {
    const r = await segmentProduct({ bytes: F11('ph-energy.jpg'), role: 'front' as never })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.maskCoverage?.missedShare).toBeGreaterThan(MASK_MISSED_MAX)
    expect(r.maskCoverage?.repaired).toBe(true)
    expect(r.photoIoU!).toBeGreaterThanOrEqual(0.97)
    expect(r.height / r.width).toBeGreaterThan(1.3) // the tall pouch, not only its dark lower half
    expect(r.rejected.join(' ')).toMatch(/repaired/)
  })

  it('a flood mask that leaks into the backdrop is rejected (never delivered)', () => { expect(PHOTO_IOU_REJECT).toBe(0.7) })

  it('SP sleep02: six patches on a clear carrier → the film is kept (low alpha), not keyed out', async () => {
    const r = await segmentProduct({ bytes: F11('sp-sleep02.jpg'), role: 'front' as never, allowMulti: true } as never)
    expect(r.ok).toBe(true)
    if (r.ok) expect((r as unknown as { sheetFilm?: { pieces: number } }).sheetFilm?.pieces).toBe(6)
  })

  it('sheetFilm: a 2×2 grid of equal squares with narrow gaps gets a film box; a single blob does not', () => {
    const w = 200, h = 200
    const grid = new Uint8Array(w * h)
    for (const [x0, y0] of [[40, 40], [110, 40], [40, 110], [110, 110]]) for (let y = y0; y < y0 + 50; y++) for (let x = x0; x < x0 + 50; x++) grid[y * w + x] = 1
    const f = sheetFilm(grid, w, h)
    expect(f).not.toBeNull()
    expect(f!.pieces).toBe(4)
    expect(f!.box.x0).toBeLessThan(0.2)
    expect(f!.box.x1).toBeGreaterThan(0.8)
    expect(FILM_ALPHA).toBeLessThan(0.3)
    const blob = new Uint8Array(w * h)
    for (let y = 50; y < 150; y++) for (let x = 50; x < 150; x++) blob[y * w + x] = 1
    expect(sheetFilm(blob, w, h)).toBeNull()
  })

  it('pack OCR tiles: the SP r9 small print "ingecdicates" fails', async () => {
    if (!(await ocrAvailable())) { console.warn('tesseract not installed: OCR test skipped'); return }
    const r = await checkPackText({ reference: F11('sp-sleep02.jpg'), generated: F10('sp-scene-r9.jpg'), generatedBox: { x0: 0.12, y0: 0.38, x1: 0.6, y1: 0.95 } })
    expect(r.status).toBe('fail')
    if (r.status === 'fail') expect(r.misspelled.map((m) => m.found).join(' ')).toMatch(/ingecdicates/)
  })

  it('fidelity fallback threshold is 0.7', () => { expect(FIDELITY_FALLBACK_BELOW).toBe(0.7) })

  it('the quote binds the RESOLVED productFidelity (pack + photo → exact; explicit wins; box role → generated)', () => {
    const ctx = { offers: [{ id: 'o1', name: 'Energy Patches', type: 'producto', productDescription: 'sobre / bolsa de parches', technicalSpecs: null }] }
    const assets = [{ id: 'i1', imageUrl: 'u', tags: ['role:front'], isPrimary: true, label: 'frente' }] as never
    expect(resolveQuotedProductFidelity({ ctx, offerId: 'o1', productAssets: assets })).toBe('exact')
    expect(resolveQuotedProductFidelity({ explicit: 'generated', ctx, offerId: 'o1', productAssets: assets })).toBe('generated')
    expect(resolveQuotedProductFidelity({ ctx, offerId: 'o1', productAssets: [] })).toBe('generated')
  })

  it('role is clipped to the DB limit (product_images_role_len = 60) with a notice', () => {
    expect(ROLE_DB_MAX).toBe(60)
    const notices: Array<{ field: string; from: number; to: number }> = []
    const role = clipWithNotice('role', 'frente del sobre con el sello dorado y la tipografía pequeña del lote '.repeat(2), ROLE_DB_MAX, notices)
    expect(role.length).toBeLessThanOrEqual(60)
    expect(notices[0]).toMatchObject({ field: 'role', to: 60 })
  })
})
