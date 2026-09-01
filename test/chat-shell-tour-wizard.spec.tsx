/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatShellTourWizard from '../src/features/chat-shell/ChatShellTourWizard'
import ChatShellWelcomeGiftModal from '../src/features/chat-shell/ChatShellWelcomeGiftModal'

afterEach(cleanup)

describe('ChatShellTourWizard', () => {
  it('mounts the first step and skip persists via onSkipForever', async () => {
    const user = userEvent.setup()
    const onFinish = vi.fn()
    const onSkipForever = vi.fn()
    render(
      <ChatShellTourWizard language="es" onFinish={onFinish} onSkipForever={onSkipForever} />
    )
    expect(screen.getByRole('dialog', { name: 'Un chat para todo' })).toBeTruthy()
    expect(screen.getByText('Paso 1 de 6')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Saltar y no volver a mostrar' }))
    expect(onSkipForever).toHaveBeenCalledTimes(1)
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('advances to the last step then finish', async () => {
    const user = userEvent.setup()
    const onFinish = vi.fn()
    render(
      <ChatShellTourWizard language="es" onFinish={onFinish} onSkipForever={vi.fn()} />
    )
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    }
    expect(screen.getByRole('heading', { name: 'Créditos y feedback' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Listo, a crear' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('renders English copy when language is en', () => {
    render(
      <ChatShellTourWizard language="en" onFinish={vi.fn()} onSkipForever={vi.fn()} />
    )
    expect(screen.getByRole('heading', { name: 'One chat for everything' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Skip and never show again' })).toBeTruthy()
  })
})

describe('ChatShellWelcomeGiftModal', () => {
  it('sends Ver cómo funciona to continue (tour), not dismiss', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    const onDismiss = vi.fn()
    render(
      <ChatShellWelcomeGiftModal
        credits={100}
        granted
        language="es"
        onContinue={onContinue}
        onDismiss={onDismiss}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Ver cómo funciona' }))
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
