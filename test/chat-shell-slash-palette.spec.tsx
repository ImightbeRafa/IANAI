/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatSlashCommandPalette from '../src/features/chat-shell/ChatSlashCommandPalette'
import { matchSlashCommands } from '../src/features/chat-shell/chatShellCommands'

describe('ChatSlashCommandPalette', () => {
  it('selecting a command calls onSelect and does not submit a parent form', async () => {
    const onSelect = vi.fn()
    const onSubmit = vi.fn((e: SubmitEvent) => e.preventDefault())
    const commands = matchSlashCommands('/')
    const user = userEvent.setup()

    render(
      <form onSubmit={onSubmit}>
        <ChatSlashCommandPalette
          commands={commands}
          activeIndex={0}
          language="es"
          listId="slash-test"
          onHover={() => undefined}
          onSelect={onSelect}
        />
      </form>
    )

    await user.click(screen.getByRole('option', { name: /Guion/i }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0]?.[0]?.insert).toBe('/guion ')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
