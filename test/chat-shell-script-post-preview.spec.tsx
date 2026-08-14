// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatShellScriptCard from '../src/features/chat-shell/ChatShellScriptCard'
import { collectImageScriptChoices, shouldReviewChosenScript } from '../src/features/chat-shell/useChatSessionThread'
import { getScriptsByMessage, getScriptVersions } from '../src/services/database'

vi.mock('../src/services/database', () => ({
  getScriptsByMessage: vi.fn(async () => []),
  getScriptVersions: vi.fn(async () => []),
  recordAiSignal: vi.fn(),
}))

describe('ChatShellScriptCard post preview', () => {
  afterEach(() => {
    cleanup()
  })
  beforeEach(() => {
    vi.mocked(getScriptsByMessage).mockResolvedValue([])
    vi.mocked(getScriptVersions).mockResolvedValue([])
  })
  it('optimizes first, shows visual references, allows editing, then generates the approved draft', async () => {
    const onGenerateImage = vi.fn()
    render(
      <ChatShellScriptCard
        script={{ index: 1, title: 'Venta directa', content: 'Guión original largo' }}
        language="es"
        productName="ForgeCR"
        referenceImageUrls={['https://example.com/product.webp', 'https://example.com/detail.webp']}
        onPreparePost={async () => 'Headline optimizado\nCTA optimizado'}
        onGenerateImage={onGenerateImage}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /crear post/i }))
    const editor = await screen.findByLabelText('Vista previa editable del post')
    expect((editor as HTMLTextAreaElement).value).toBe('Headline optimizado\nCTA optimizado')
    expect(screen.getAllByRole('img', { name: /Referencia/i })).toHaveLength(2)

    fireEvent.change(editor, { target: { value: 'Headline aprobado\nCTA por mensaje' } })
    fireEvent.click(screen.getByRole('button', { name: /continuar al tipo de post/i }))
    await waitFor(() => expect(onGenerateImage).toHaveBeenCalledWith(
      'Headline aprobado\nCTA por mensaje',
      { density: 'hard' }
    ))
  })

  it('shows a purpose-specific loading state while the script is being edited', async () => {
    let resolveEdit: (value: string) => void = () => {}
    const onEdit = vi.fn(() => new Promise<string>((resolve) => { resolveEdit = resolve }))
    render(
      <ChatShellScriptCard
        script={{ index: 1, title: 'Venta directa', content: 'Guión original largo' }}
        language="es"
        onEdit={onEdit}
        onGenerateImage={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /editar/i }))
    fireEvent.change(screen.getByLabelText('Instrucción de edición'), { target: { value: 'más CTA' } })
    fireEvent.click(screen.getByRole('button', { name: /aplicar edición/i }))
    expect(await screen.findByText(/Editando el guión: más CTA/)).toBeTruthy()
    expect(screen.getByRole('article').getAttribute('aria-busy')).toBe('true')
    resolveEdit('Guión editado con CTA')
    await waitFor(() => expect(screen.getByText('Guión editado con CTA')).toBeTruthy())
  })

  it('re-optimizes the visible draft when density changes', async () => {
    const onPreparePost = vi.fn(async (_script: string, density?: 'hard' | 'medium') => (
      density === 'medium' ? 'Texto medio condensado' : 'Poco texto condensado'
    ))
    const onGenerateImage = vi.fn()
    render(
      <ChatShellScriptCard
        script={{ index: 1, title: 'Venta directa', content: 'Guión original largo' }}
        language="es"
        onPreparePost={onPreparePost}
        onGenerateImage={onGenerateImage}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /crear post/i }))
    const editor = await screen.findByLabelText('Vista previa editable del post')
    expect((editor as HTMLTextAreaElement).value).toBe('Poco texto condensado')
    expect(onPreparePost).toHaveBeenCalledWith('Guión original largo', 'hard')

    fireEvent.click(screen.getByRole('radio', { name: /texto medio/i }))
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('Texto medio condensado'))
    expect(onPreparePost).toHaveBeenCalledWith('Guión original largo', 'medium')

    fireEvent.click(screen.getByRole('button', { name: /continuar al tipo de post/i }))
    await waitFor(() => expect(onGenerateImage).toHaveBeenCalledWith(
      'Texto medio condensado',
      { density: 'medium' }
    ))
  })

  it('opens the same editable post draft when asked from an image optimize signal', async () => {
    const onGenerateImage = vi.fn()
    const { rerender } = render(
      <ChatShellScriptCard
        script={{ index: 1, title: 'Venta directa', content: 'Guión original largo' }}
        language="es"
        productName="ForgeCR"
        onPreparePost={async () => 'Headline condensado\nCTA'}
        onGenerateImage={onGenerateImage}
        openPostPreviewNonce={0}
      />
    )

    rerender(
      <ChatShellScriptCard
        script={{ index: 1, title: 'Venta directa', content: 'Guión original largo' }}
        language="es"
        productName="ForgeCR"
        onPreparePost={async () => 'Headline condensado\nCTA'}
        onGenerateImage={onGenerateImage}
        openPostPreviewNonce={1}
      />
    )

    const editor = await screen.findByLabelText('Vista previa editable del post')
    expect((editor as HTMLTextAreaElement).value).toBe('Headline condensado\nCTA')
  })

  it('shows the latest script version as main and lets you open the original', async () => {
    vi.mocked(getScriptsByMessage).mockResolvedValue([
      { id: 'parent-1', script_index: 0 } as never,
    ])
    vi.mocked(getScriptVersions).mockResolvedValue([
      {
        id: 'v2',
        content: 'Guión con hook de dolor',
        version: 2,
        edit_source: 'hook',
        edit_label: 'Dolor tangible',
      } as never,
    ])

    render(
      <ChatShellScriptCard
        script={{ index: 0, title: 'Venta directa', content: 'Guión original largo' }}
        language="es"
        messageId="msg-1"
        scriptIndex={0}
        onEdit={async () => 'edited'}
      />
    )

    await waitFor(() => expect(screen.getByText('Guión con hook de dolor')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Última/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /v1/i }))
    expect(screen.getByText('Guión original largo')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Más acciones/i }))
    expect(screen.getByRole('menuitem', { name: /Mejorar/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Dolor tangible/i })).toBeTruthy()
  })

  it('prepares the post from the latest edited version, not the original artifact', async () => {
    vi.mocked(getScriptsByMessage).mockResolvedValue([
      { id: 'parent-1', script_index: 0 } as never,
    ])
    vi.mocked(getScriptVersions).mockResolvedValue([
      {
        id: 'v2',
        content: 'Guión editado para el post',
        version: 2,
        edit_source: 'manual',
        edit_label: 'Edición',
      } as never,
    ])
    const onPreparePost = vi.fn(async (script: string) => script)
    render(
      <ChatShellScriptCard
        script={{ index: 0, title: 'Venta directa', content: 'Guión original largo' }}
        language="es"
        messageId="msg-1"
        scriptIndex={0}
        onPreparePost={onPreparePost}
        onGenerateImage={vi.fn()}
        openPostPreviewNonce={1}
      />
    )

    const editor = await screen.findByLabelText('Vista previa editable del post')
    expect((editor as HTMLTextAreaElement).value).toBe('Guión editado para el post')
    expect(onPreparePost).toHaveBeenCalledWith('Guión editado para el post', 'hard')
    expect(screen.getByText(/Última · Edición/)).toBeTruthy()
  })
})

describe('collectImageScriptChoices', () => {
  it('prefers the latest edited snapshot over the original artifact text', () => {
    const messages = [{
      id: 'm1',
      session_id: 's1',
      role: 'assistant' as const,
      content: 'script',
      created_at: '',
      artifacts: [{
        id: 'art-1',
        artifact_type: 'script',
        product_id: 'p1',
        ordinal: 0,
        script: { content: 'Guión original', title: 'Venta directa' },
      }],
    }]
    const latest = new Map([['art-1', 'Guión editado para el post']])
    const choices = collectImageScriptChoices(messages as never, 'p1', latest)
    expect(choices[0]?.scriptText).toBe('Guión editado para el post')
    expect(choices[0]?.preview).toContain('Guión editado')
  })

  it('sends post composer flows through script review, not straight to type', () => {
    expect(shouldReviewChosenScript('Quiero crear un post', 'composer')).toBe(true)
    expect(shouldReviewChosenScript('Generar post', 'rail')).toBe(true)
    expect(shouldReviewChosenScript('Quiero crear un post', 'script_card')).toBe(false)
    expect(shouldReviewChosenScript('Hazme un logo', 'composer')).toBe(false)
  })
})
