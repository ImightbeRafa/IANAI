// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectComposerDropFiles,
  composerAttachmentGate,
  createComposerAttachment,
  isAllowedComposerImage,
  MAX_COMPOSER_ATTACHMENT_BYTES,
  MAX_COMPOSER_ATTACHMENTS,
  scriptClarifyOpensModal,
} from '../src/features/chat-shell/chatShellComposerAttachments'
import ChatShellThreadClarify from '../src/features/chat-shell/ChatShellThreadClarify'
import ChatShellClarifySheet from '../src/features/chat-shell/ChatShellClarifySheet'
import type { ScriptClarifyState } from '../src/features/chat-shell/useChatSessionThread'
import { DEFAULT_SCRIPT_SETTINGS } from '../src/services/grokApi'

function fakeImageFile(name: string, type = 'image/png', size = 4): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('composer attachment SecureDog gate', () => {
  it('allows only MIME allowlist (no extension fallback)', () => {
    expect(isAllowedComposerImage(fakeImageFile('a.png', 'image/png'))).toBe(true)
    expect(isAllowedComposerImage(fakeImageFile('b.jpg', 'image/jpeg'))).toBe(true)
    // Extension says png but MIME missing/wrong → reject
    expect(isAllowedComposerImage(fakeImageFile('sneaky.png', ''))).toBe(false)
    expect(isAllowedComposerImage(fakeImageFile('notes.pdf', 'application/pdf'))).toBe(false)
  })

  it('rejects oversized files before data URL staging', async () => {
    const oversized = fakeImageFile('big.png', 'image/png', MAX_COMPOSER_ATTACHMENT_BYTES + 1)
    expect(composerAttachmentGate(oversized)).toBe('size')
    const attachment = await createComposerAttachment(oversized, 'product')
    expect(attachment).toBeNull()

    const { attachments, reject } = await collectComposerDropFiles([oversized], 0, 'product')
    expect(attachments).toHaveLength(0)
    expect(reject).toBe('size')
  })

  it('stages allowed images and caps count', async () => {
    const files = Array.from({ length: 6 }, (_, i) => fakeImageFile(`p${i}.png`))
    const { attachments } = await collectComposerDropFiles(files, 0, 'product')
    expect(attachments).toHaveLength(MAX_COMPOSER_ATTACHMENTS)
  })
})

describe('NL clarify surface — no Guiones modal', () => {
  afterEach(() => cleanup())

  const threadState: ScriptClarifyState = {
    sessionId: 's1',
    step: 'cta',
    originText: 'Generame 2 posts',
    settings: DEFAULT_SCRIPT_SETTINGS,
    remaining: [],
    history: [],
    surface: 'thread',
    postCampaign: true,
  }

  const sheetState: ScriptClarifyState = {
    ...threadState,
    surface: 'sheet',
    originText: 'Quiero crear guiones',
  }

  it('scriptClarifyOpensModal is false for thread NL surface', () => {
    expect(scriptClarifyOpensModal(threadState)).toBe(false)
    expect(scriptClarifyOpensModal(sheetState)).toBe(true)
    expect(scriptClarifyOpensModal(null)).toBe(false)
  })

  it('thread clarify renders chips without modal-root / Paso sheet', () => {
    render(
      <ChatShellThreadClarify
        language="es"
        state={threadState}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByTestId('thread-nl-clarify')).toBeTruthy()
    expect(screen.getByText(/CTA web, mensaje o sin CTA/i)).toBeTruthy()
    expect(document.querySelector('.chat-shell__modal-root')).toBeNull()
    expect(screen.queryByText(/Paso \d+ de \d+/i)).toBeNull()
    expect(screen.queryByText(/^Guiones$/i)).toBeNull()
  })

  it('sheet clarify still opens FlowSheet modal for glass Guiones', () => {
    render(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={sheetState}
        imageClarify={null}
        onAnswerScriptClarify={() => {}}
        onCancelScriptClarify={() => {}}
      />
    )
    expect(document.querySelector('.chat-shell__modal-root')).toBeTruthy()
    expect(document.querySelector('.chat-shell__modal-backdrop')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Guiones$/i })).toBeTruthy()
  })

  it('picking CTA on thread clarify invokes answer without mounting modal', async () => {
    const onAnswer = vi.fn()
    render(
      <ChatShellThreadClarify
        language="es"
        state={threadState}
        onAnswer={onAnswer}
        onCancel={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /enviar mensaje/i }))
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith({ ctaChannel: 'messages' })
    })
    expect(document.querySelector('.chat-shell__modal-root')).toBeNull()
  })
})
