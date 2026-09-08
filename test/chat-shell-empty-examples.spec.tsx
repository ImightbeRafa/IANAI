/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ChatThread from '../src/features/chat-shell/ChatThread'
import type { ChatSession, Message, Product } from '../src/types'

const session: ChatSession = {
  id: 'sess-1',
  user_id: 'u1',
  business_id: 'b1',
  title: 'Test',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const product: Product = {
  id: 'prod-1',
  name: 'Café Especial',
  type: 'product',
}

const emptyMessages: Message[] = []

describe('chat-shell empty-state example prompts', () => {
  afterEach(cleanup)

  it('shows Spanish example prompts and fills the composer when clicked', () => {
    render(
      <ChatThread
        brand={null}
        session={session}
        messages={emptyMessages}
        loadingMessages={false}
        sending={false}
        savingScript={false}
        activeProduct={product}
        offerProductId="prod-1"
        offerCount={1}
        latestImagesByOffer={new Map()}
        imageBusy={false}
        error={null}
        notice={null}
        failedBatch={null}
        onRetryFailedOffers={() => {}}
        language="es"
        onSend={async () => undefined}
        onSaveScript={async () => null}
        onEditScript={async () => ''}
        onSaveVersion={async () => null}
        onOpenOfferImage={() => {}}
        onEditOfferImage={async () => {}}
        kitReady
        hasOfferName
      />
    )

    expect(screen.getByText('Probalo así')).toBeTruthy()
    const prompt = 'Generame 2 guiones de venta directa'
    const chip = screen.getByRole('button', { name: prompt })
    expect(chip).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Armá un post con foto del producto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Contame un storytelling corto con CTA' })).toBeTruthy()

    fireEvent.click(chip)
    const textarea = screen.getByRole('textbox', { name: /escribir mensaje/i }) as HTMLTextAreaElement
    expect(textarea.value).toBe(prompt)
  })

  it('does not show example prompts during first-run brand CTA', () => {
    render(
      <ChatThread
        brand={null}
        session={session}
        messages={emptyMessages}
        loadingMessages={false}
        sending={false}
        savingScript={false}
        activeProduct={null}
        offerProductId={null}
        offerCount={0}
        latestImagesByOffer={new Map()}
        imageBusy={false}
        error={null}
        notice={null}
        failedBatch={null}
        onRetryFailedOffers={() => {}}
        language="es"
        onSend={async () => undefined}
        onSaveScript={async () => null}
        onEditScript={async () => ''}
        onSaveVersion={async () => null}
        onOpenOfferImage={() => {}}
        onEditOfferImage={async () => {}}
        kitReady={false}
        hasOfferName={false}
        onStartBrandKit={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: 'Empezá por tu marca' })).toBeTruthy()
    expect(screen.queryByText('Probalo así')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Generame 2 guiones de venta directa' })).toBeNull()
  })
})
