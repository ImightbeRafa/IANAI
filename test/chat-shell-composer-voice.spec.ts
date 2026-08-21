import { describe, expect, it } from 'vitest'
import {
  appendComposerTranscript,
  pickRecorderMimeType,
  transcribeAudioUrl,
} from '../src/features/chat-shell/useChatComposerVoice'

describe('appendComposerTranscript', () => {
  it('uses the incoming text when the composer is empty', () => {
    expect(appendComposerTranscript('', '  hola forge  ')).toBe('hola forge')
  })

  it('appends with a single space so the user can edit before sending', () => {
    expect(appendComposerTranscript('Pegá la URL', 'https://forge.test')).toBe(
      'Pegá la URL https://forge.test'
    )
  })

  it('ignores blank transcripts', () => {
    expect(appendComposerTranscript('keep', '   ')).toBe('keep')
  })
})

describe('transcribeAudioUrl', () => {
  it('points at the local API in Vite dev', () => {
    expect(transcribeAudioUrl()).toMatch(/transcribe-audio$/)
  })
})

describe('pickRecorderMimeType', () => {
  it('returns a webm fallback when MediaRecorder is missing', () => {
    expect(pickRecorderMimeType()).toMatch(/^audio\//)
  })
})
