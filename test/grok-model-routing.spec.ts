import { describe, expect, it } from 'vitest'
import {
  GROK_TEXT_MODEL,
  GROK_TEXT_MODEL_BEST,
  GROK_TEXT_MODEL_EFFICIENT,
  extractGrokOutputText,
  grokTextProfileForModel,
  grokUsageFromPayload,
  resolveGrokTextModel,
} from '../api/lib/grok-models'

describe('resolveGrokTextModel', () => {
  it('defaults to Grok 4.6 Best', () => {
    expect(GROK_TEXT_MODEL).toBe('grok-4.6')
    expect(resolveGrokTextModel()).toBe(GROK_TEXT_MODEL_BEST)
    expect(resolveGrokTextModel(null)).toBe(GROK_TEXT_MODEL_BEST)
  })

  it('maps legacy grok/gemini/4.3 onto 4.6', () => {
    expect(resolveGrokTextModel('grok')).toBe('grok-4.6')
    expect(resolveGrokTextModel('gemini')).toBe('grok-4.6')
    expect(resolveGrokTextModel('grok-4.3')).toBe('grok-4.6')
    expect(resolveGrokTextModel('best')).toBe('grok-4.6')
  })

  it('maps efficient profile onto 4.5', () => {
    expect(resolveGrokTextModel('efficient')).toBe(GROK_TEXT_MODEL_EFFICIENT)
    expect(resolveGrokTextModel('grok-4.5')).toBe('grok-4.5')
    expect(grokTextProfileForModel('grok-4.5')).toBe('efficient')
    expect(grokTextProfileForModel('grok-4.6')).toBe('best')
  })

  it('never returns grok-4.3', () => {
    expect(resolveGrokTextModel('grok-4.3')).not.toBe('grok-4.3')
    expect(resolveGrokTextModel('unknown-model')).toBe('grok-4.6')
  })

  it('reads Responses API and Chat Completions payloads', () => {
    expect(extractGrokOutputText({ output_text: 'hola' })).toBe('hola')
    expect(extractGrokOutputText({
      output: [{ content: [{ type: 'output_text', text: 'desde responses' }] }],
    })).toBe('desde responses')
    expect(extractGrokOutputText({
      choices: [{ message: { content: 'desde completions' } }],
    })).toBe('desde completions')
    expect(grokUsageFromPayload({ usage: { input_tokens: 11, output_tokens: 7 } })).toEqual({
      prompt_tokens: 11,
      completion_tokens: 7,
    })
  })
})
