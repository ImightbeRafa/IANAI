/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, useLocation, useSearchParams } from 'react-router-dom'
import ChatShellAdPackStudio from '../src/features/chat-shell/ChatShellAdPackStudio'
import { AdPackApiError, type AdPackClient, type AdPackItemView, type AdPackStatusResponse } from '../src/features/chat-shell/adPackApi'
import { readAdPackParam, useAdPackDeepLink, withoutAdPackParam } from '../src/features/chat-shell/chatShellAdPackDeepLink'

vi.mock('../src/features/chat-shell/chatShellDownload', () => ({ downloadShellImage: vi.fn(async () => {}) }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const PACK = '11111111-1111-4111-8111-111111111111'

function item(index: number): AdPackItemView {
  return {
    id: `i${index}`,
    index,
    status: 'done',
    format: 'offer_graphic',
    archetype: 'venta_directa',
    hookType: 'pain',
    message: `Mensaje ${index + 1}`,
    headline: `Titular ${index + 1}`,
    copy: { headline: `Titular ${index + 1}`, bullets: [], cta: 'Comprar', caption: `Caption ${index + 1}`, sceneBrief: 'x', usedFactKeys: [] },
    renders: [{ ratio: '1:1', imageUrl: 'data:image/png;base64,AAAA', width: 10, height: 10 }],
    attempts: 1,
    charged: true,
  }
}

function doneStatus(): AdPackStatusResponse {
  const items = [item(0), item(1)]
  return {
    packId: PACK,
    status: 'done',
    size: 2,
    ratios: ['1:1'],
    source: 'mcp',
    quotedCredits: 12,
    chargedCredits: 12,
    progress: { total: 2, done: 2, failed: 0, pending: 0, counts: { planned: 0, copy_ready: 0, scene_ready: 0, rendered: 0, done: 2, failed: 0 } },
    items,
    moreWork: false,
    leaseActive: false,
    language: 'es',
    summary: '2/2 listos · pack terminado',
    createdAt: '',
    updatedAt: '',
  }
}

function stubApi(overrides: Partial<AdPackClient> = {}): AdPackClient {
  return {
    ingestDna: vi.fn(),
    confirm: vi.fn(),
    angles: vi.fn(),
    quote: vi.fn(),
    start: vi.fn(),
    status: vi.fn(async () => doneStatus()),
    editText: vi.fn(),
    regenerate: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  }
}

describe('?adpack= param helpers', () => {
  it('reads the pack id and strips only that param', () => {
    expect(readAdPackParam(`?brand=b1&adpack=${PACK}`)).toBe(PACK)
    expect(readAdPackParam('?brand=b1')).toBeNull()
    expect(readAdPackParam('?adpack=%20')).toBeNull()
    expect(withoutAdPackParam(new URLSearchParams(`brand=b1&session=s1&adpack=${PACK}`)).toString()).toBe('brand=b1&session=s1')
  })
})

describe('ChatShellAdPackStudio deep link (initialPackId)', () => {
  it('opens straight on Resultados, polls adPackStatus and shows the pack', async () => {
    const api = stubApi()
    render(<ChatShellAdPackStudio open language="es" api={api} initialPackId={PACK} allowNewPack={false} onClose={vi.fn()} />)
    expect(screen.getByText('Resultados', { selector: '.chat-shell__adpack-step-label' }).closest('li')?.getAttribute('aria-current')).toBe('step')
    await waitFor(() => expect(api.status).toHaveBeenCalledWith({ packId: PACK }))
    expect(await screen.findByText('2/2 listos')).toBeTruthy()
    expect(api.ingestDna).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    // Studio entry points flagged off: no "Nuevo pack" from a deep link.
    expect(screen.queryByRole('button', { name: 'Nuevo pack' })).toBeNull()
  })

  it('offers "Nuevo pack" when the studio flag is on', async () => {
    render(<ChatShellAdPackStudio open language="es" api={stubApi()} initialPackId={PACK} onClose={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Nuevo pack' })).toBeTruthy()
  })

  it("shows a clear message for a bad / other user's pack (NOT_FOUND) and stops polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const statusFn = vi.fn(async () => {
      throw new AdPackApiError(404, { error: 'Pack not found', code: 'NOT_FOUND' })
    })
    render(<ChatShellAdPackStudio open language="es" api={stubApi({ status: statusFn })} initialPackId="not-a-pack" onClose={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/No encontramos este pack de anuncios/)
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(statusFn).toHaveBeenCalledTimes(1)
  })
})

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

function DeepLinkHarness({ ready, api }: { ready: boolean; api: AdPackClient }) {
  const link = useAdPackDeepLink(ready)
  return (
    <>
      <LocationProbe />
      {link.packId ? <ChatShellAdPackStudio open language="es" api={api} initialPackId={link.packId} allowNewPack={false} onClose={link.close} /> : null}
    </>
  )
}

describe('useAdPackDeepLink', () => {
  it('waits for the brand, opens the pack, strips ?adpack= (keeps brand) and closes cleanly', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    const { rerender } = render(
      <MemoryRouter initialEntries={[`/chat?brand=b1&adpack=${PACK}`]}>
        <DeepLinkHarness ready={false} api={api} />
      </MemoryRouter>
    )
    // Brand not loaded yet: nothing opens, the param stays.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('search').textContent).toBe(`?brand=b1&adpack=${PACK}`)

    rerender(
      <MemoryRouter initialEntries={[`/chat?brand=b1&adpack=${PACK}`]}>
        <DeepLinkHarness ready api={api} />
      </MemoryRouter>
    )
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?brand=b1'))
    expect(await screen.findByText('2/2 listos')).toBeTruthy()
    expect(api.status).toHaveBeenCalledWith({ packId: PACK })

    await user.click(screen.getAllByRole('button', { name: 'Cerrar' })[0])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('search').textContent).toBe('?brand=b1')
  })

  it('a reload of the stripped URL does not reopen the pack', () => {
    render(
      <MemoryRouter initialEntries={['/chat?brand=b1']}>
        <DeepLinkHarness ready api={stubApi()} />
      </MemoryRouter>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the captured pack when the workspace rewrites the URL before the brand loads', async () => {
    // Like useChatShellWorkspace.syncUrlAndStorage: replaces the query with ?brand= only.
    function WorkspaceSync() {
      const [, setSearchParams] = useSearchParams()
      useEffect(() => {
        setSearchParams(new URLSearchParams('brand=b1'), { replace: true })
      }, [setSearchParams])
      return null
    }
    function Harness({ ready }: { ready: boolean }) {
      return (
        <>
          <WorkspaceSync />
          <DeepLinkHarness ready={ready} api={api} />
        </>
      )
    }
    const api = stubApi()
    const { rerender } = render(
      <MemoryRouter initialEntries={[`/chat?brand=b1&adpack=${PACK}`]}>
        <Harness ready={false} />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?brand=b1'))
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <MemoryRouter initialEntries={[`/chat?brand=b1&adpack=${PACK}`]}>
        <Harness ready />
      </MemoryRouter>
    )
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(api.status).toHaveBeenCalledWith({ packId: PACK }))
  })
})
