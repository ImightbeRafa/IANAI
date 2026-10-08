/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatShellAdPackStudio from '../src/features/chat-shell/ChatShellAdPackStudio'
import ChatShellAdPackResults from '../src/features/chat-shell/ChatShellAdPackResults'
import { AdPackApiError, type AdPackClient, type AdPackItemView, type AdPackStatusResponse } from '../src/features/chat-shell/adPackApi'
import { adPackT } from '../src/features/chat-shell/chatShellLabels'
import {
  buildConfirmPayload,
  factRowsFromDna,
  selectionIsPrefix,
  shouldKeepPolling,
} from '../src/features/chat-shell/adPackStudioModel'
import type { AdAngle, BrandDna } from '../api/lib/adpack/types'

vi.mock('../src/features/chat-shell/chatShellDownload', () => ({ downloadShellImage: vi.fn(async () => {}) }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const DNA: BrandDna = {
  version: 1,
  brandName: 'Café Montaña',
  category: 'food_beverage',
  language: 'es',
  register: 'voseo',
  voice: 'Cálida',
  audience: ['Profesionales'],
  facts: [
    { key: 'brand_name', value: 'Café Montaña', source: 'website', confirmed: true },
    { key: 'price', value: '₡9.900', source: 'website', confirmed: false },
    { key: 'shipping', value: 'Envío gratis GAM', source: 'website', confirmed: false },
  ],
  visual: {},
  gaps: ['delivery_time'],
  sources: [{ kind: 'instagram', fetchedAt: '2026-10-07T00:00:00Z', ok: true, note: 'Instagram limitado: solo bio' }],
}

const ANGLES: AdAngle[] = Array.from({ length: 10 }, (_, i) => ({
  id: `a${i + 1}`,
  archetype: 'venta_directa',
  hookType: 'pain',
  format: 'offer_graphic',
  message: `Mensaje ${i + 1}`,
  target: 'Gente',
  factKeys: [],
}))

function item(partial: Partial<AdPackItemView> = {}): AdPackItemView {
  return {
    id: 'i1',
    index: 0,
    status: 'done',
    format: 'offer_graphic',
    archetype: 'venta_directa',
    hookType: 'pain',
    message: 'Café recién tostado',
    headline: 'Café recién tostado',
    copy: { headline: 'Café recién tostado', bullets: ['100% arábica'], cta: 'Comprar', caption: 'Caption larga del anuncio', sceneBrief: 'x', usedFactKeys: [] },
    renders: [{ ratio: '1:1', imageUrl: 'data:image/png;base64,AAAA', width: 10, height: 10 }],
    attempts: 1,
    charged: true,
    ...partial,
  }
}

function status(partial: Partial<AdPackStatusResponse> = {}, items: AdPackItemView[] = [item()]): AdPackStatusResponse {
  const done = items.filter((i) => i.status === 'done').length
  return {
    packId: 'p1',
    status: 'done',
    size: items.length,
    ratios: ['1:1'],
    source: 'web',
    quotedCredits: 6,
    chargedCredits: 6,
    progress: { total: items.length, done, failed: 0, pending: items.length - done, counts: { planned: 0, copy_ready: 0, scene_ready: 0, rendered: 0, done, failed: 0 } },
    items,
    moreWork: false,
    leaseActive: false,
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

function stubApi(overrides: Partial<AdPackClient> = {}): AdPackClient {
  return {
    ingestDna: vi.fn(async () => ({ dna: DNA, costUsd: 0, timingsMs: { total: 1 } })),
    confirm: vi.fn(async (body) => ({ dna: body.dna })),
    angles: vi.fn(async (body) => ({ size: body.size ?? 10, angles: ANGLES.slice(0, body.size ?? 10) })),
    quote: vi.fn(async (body) => ({ size: body.size ?? 10, credits: (body.size ?? 10) * 6, perAd: 6 })),
    start: vi.fn(async () => ({ packId: 'p1', status: 'planned' as const, quote: { size: 10, credits: 60, perAd: 6 }, existing: false })),
    status: vi.fn(async () => status()),
    editText: vi.fn(),
    regenerate: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  }
}

describe('adPackStudioModel', () => {
  it('only confirmed rows become confirm/edit edits; unconfirmed facts are sent unconfirmed', () => {
    const rows = factRowsFromDna({ ...DNA, facts: DNA.facts.map((f) => ({ ...f, confirmed: f.key !== 'shipping' ? f.confirmed : true })) })
    const edited = rows.map((r) => (r.key === 'price' ? { ...r, confirmed: true } : r.key === 'shipping' ? { ...r, confirmed: false } : r))
    const { dna, edits } = buildConfirmPayload(
      { ...DNA, facts: DNA.facts.map((f) => (f.key === 'shipping' ? { ...f, confirmed: true } : f)) },
      edited,
      [{ key: 'delivery_time', value: '24 h' }],
    )
    expect(edits).toEqual([
      { op: 'confirm', key: 'brand_name', value: 'Café Montaña' },
      { op: 'confirm', key: 'price', value: '₡9.900' },
      { op: 'add', key: 'delivery_time', value: '24 h' },
    ])
    expect(dna.facts.find((f) => f.key === 'shipping')?.confirmed).toBe(false)
  })

  it('edited values become edit ops with the previous value', () => {
    const rows = factRowsFromDna(DNA).map((r) => (r.key === 'price' ? { ...r, value: '₡8.900', confirmed: true } : r))
    const { edits } = buildConfirmPayload(DNA, rows, [])
    expect(edits).toContainEqual({ op: 'edit', key: 'price', value: '₡8.900', previousValue: '₡9.900' })
  })

  it('polling stops on terminal statuses without more work', () => {
    expect(shouldKeepPolling({ status: 'running', moreWork: true })).toBe(true)
    expect(shouldKeepPolling({ status: 'done', moreWork: false })).toBe(false)
    expect(shouldKeepPolling({ status: 'partial', moreWork: false })).toBe(false)
    expect(shouldKeepPolling({ status: 'cancelled', moreWork: true })).toBe(false)
  })

  it('detects whether the enabled angles are the generated prefix', () => {
    expect(selectionIsPrefix(ANGLES, new Set(['a1', 'a2']))).toBe(true)
    expect(selectionIsPrefix(ANGLES, new Set(['a1', 'a3']))).toBe(false)
  })
})

describe('ChatShellAdPackStudio', () => {
  it('walks Marca → Ángulos → Resultados, gating claims on confirmed facts', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    const onPackStarted = vi.fn()
    render(
      <ChatShellAdPackStudio
        open
        language="es"
        api={api}
        prefill={{ websiteUrl: 'https://cafe.cr', brandName: 'Café Montaña' }}
        onClose={vi.fn()}
        onPackStarted={onPackStarted}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Pack de anuncios' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Analizar' }))
    expect(await screen.findByText('Falta: tiempo de entrega')).toBeTruthy()
    expect(screen.getByText('Instagram limitado: solo bio')).toBeTruthy()
    expect(screen.getByText(/Solo los datos confirmados se usan como afirmaciones/)).toBeTruthy()
    expect(api.ingestDna).toHaveBeenCalledWith(expect.objectContaining({ websiteUrl: 'https://cafe.cr', language: 'es' }))

    await user.click(screen.getByRole('checkbox', { name: 'Confirmar: Precio' }))
    await user.type(screen.getByPlaceholderText('Escribí tiempo de entrega'), '24 h')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    const confirmBody = vi.mocked(api.confirm).mock.calls[0][0]
    expect(confirmBody.edits).toEqual(expect.arrayContaining([
      { op: 'confirm', key: 'price', value: '₡9.900' },
      { op: 'add', key: 'delivery_time', value: '24 h' },
    ]))
    expect(confirmBody.edits.some((e) => e.key === 'shipping')).toBe(false)
    expect(confirmBody.dna.facts.find((f) => f.key === 'shipping')?.confirmed).toBe(false)

    expect(await screen.findByRole('switch', { name: 'Incluir ángulo 10' })).toBeTruthy()
    const generate = await screen.findByRole('button', { name: 'Generar · 10 anuncios · 60 créditos' })
    await user.click(screen.getByRole('switch', { name: 'Incluir ángulo 10' }))
    expect(await screen.findByRole('button', { name: 'Generar · 9 anuncios · 54 créditos' })).toBeTruthy()
    expect(generate).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Generar · 9 anuncios · 54 créditos' }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ size: 9, ratios: ['1:1', '4:5', '9:16'] }))
    expect(onPackStarted).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('1/1 listos')).toBeTruthy()
  })

  it('shows a clear message when credits are insufficient', async () => {
    const user = userEvent.setup()
    const api = stubApi({
      start: vi.fn(async () => {
        throw new AdPackApiError(402, { error: 'Not enough', code: 'INSUFFICIENT_CREDITS', creditsRequired: 60, remaining: 12 })
      }),
    })
    render(<ChatShellAdPackStudio open language="es" api={api} prefill={{ websiteUrl: 'https://cafe.cr' }} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Analizar' }))
    await screen.findByText('Falta: tiempo de entrega')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.click(await screen.findByRole('button', { name: 'Generar · 10 anuncios · 60 créditos' }))
    expect((await screen.findByRole('alert')).textContent).toBe('No tenés créditos suficientes: este pack necesita 60 y te quedan 12.')
  })
})

describe('ChatShellAdPackResults', () => {
  const t = adPackT('es')

  it('stops polling once the pack is terminal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const running = status({ status: 'running', moreWork: true }, [item({ status: 'copy_ready', renders: [] })])
    const statusFn = vi.fn()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValue(status())
    const api = stubApi({ status: statusFn })
    render(
      <ChatShellAdPackResults api={api} packId="p1" language="es" labels={t} brandName="Café" ratios={['1:1']} perAd={6} onOpenImage={vi.fn()} onAnnounce={vi.fn()} />
    )
    await waitFor(() => expect(statusFn).toHaveBeenCalledTimes(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    await waitFor(() => expect(statusFn).toHaveBeenCalledTimes(3))
    expect(await screen.findByText('1/1 listos')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(statusFn).toHaveBeenCalledTimes(3)
  })

  it('backs off and keeps polling after a network error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const statusFn = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(status())
    const api = stubApi({ status: statusFn })
    render(
      <ChatShellAdPackResults api={api} packId="p1" language="es" labels={t} brandName="Café" ratios={['1:1']} perAd={6} onOpenImage={vi.fn()} onAnnounce={vi.fn()} />
    )
    expect(await screen.findByText(/Reconectando/)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    expect(statusFn).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    await waitFor(() => expect(statusFn).toHaveBeenCalledTimes(2))
  })

  it('explains why an edited text was rejected', async () => {
    const user = userEvent.setup()
    const editText = vi.fn(async () => {
      throw new AdPackApiError(422, {
        error: 'The edited text breaks the facts or length rules',
        code: 'COPY_REJECTED',
        issues: [{ code: 'unconfirmed_fact', field: 'headline', detail: 'Price "₡7.900" is not a confirmed fact' }],
      })
    })
    const api = stubApi({ editText })
    render(
      <ChatShellAdPackResults api={api} packId="p1" language="es" labels={t} brandName="Café" ratios={['1:1']} perAd={6} onOpenImage={vi.fn()} onAnnounce={vi.fn()} />
    )
    await user.click(await screen.findByRole('button', { name: 'Editar texto' }))
    const headline = screen.getByLabelText('Titular')
    await user.clear(headline)
    await user.type(headline, 'Solo ₡7.900')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(editText).toHaveBeenCalledWith({ packId: 'p1', itemId: 'i1', copy: { headline: 'Solo ₡7.900' } })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No se puede usar ese texto:')
    expect(alert.textContent).toContain('Titular: Usa un dato no confirmado — Price "₡7.900" is not a confirmed fact')
  })
})
