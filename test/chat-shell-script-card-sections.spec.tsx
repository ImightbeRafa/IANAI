// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatShellScriptCard from '../src/features/chat-shell/ChatShellScriptCard'
import { parseScripts } from '../src/utils/scriptParser'

vi.mock('../src/services/database', () => ({
  getScriptsByMessage: vi.fn(async () => []),
  getScriptVersions: vi.fn(async () => []),
  recordAiSignal: vi.fn(),
}))

const clustered = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/scripts/sleeping-patches-clustered.txt'),
  'utf8'
)

describe('A5/A6 ChatShellScriptCard sections', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders two option cards with three labeled blocks and copies v2 text', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const scripts = parseScripts(clustered)
    expect(scripts).toHaveLength(2)

    const { rerender } = render(
      <ChatShellScriptCard script={scripts[0]} language="es" productName="Sleeping Patches" />
    )
    expect(document.querySelectorAll('.chat-shell__script-section')).toHaveLength(3)
    expect(screen.getByText('Gancho')).toBeTruthy()
    expect(screen.getByText('Desarrollo')).toBeTruthy()
    expect(screen.getByText('Cierre')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\[GANCHO/)
    expect(document.body.textContent).not.toMatch(/###/)
    fireEvent.click(screen.getByRole('button', { name: /Copiar/i }))
    expect(writeText).toHaveBeenCalled()
    const copied = String(writeText.mock.calls[0][0])
    expect(copied).toContain('[GANCHO · ~3 s]')
    expect(copied).not.toMatch(/###/)

    rerender(
      <ChatShellScriptCard script={scripts[1]} language="es" productName="Sleeping Patches" />
    )
    expect(document.querySelectorAll('.chat-shell__script-section')).toHaveLength(3)
    expect(screen.getByText(/30 noches de calma/)).toBeTruthy()
  })

  it('still splits legacy [GANCHO]: inline format into three blocks', () => {
    render(
      <ChatShellScriptCard
        script={{
          index: 1,
          title: 'Legacy',
          content: '[GANCHO]: Hook line\n[DESARROLLO]: Body line\n[CTA]: End line',
        }}
        language="es"
      />
    )
    expect(document.querySelectorAll('.chat-shell__script-section')).toHaveLength(3)
    expect(screen.getByText('Hook line')).toBeTruthy()
    expect(screen.getByText('Body line')).toBeTruthy()
    expect(screen.getByText('End line')).toBeTruthy()
  })
})
