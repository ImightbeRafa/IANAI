import { describe, expect, it } from 'vitest'
import { parseShellCommand, matchSlashCommands, slashPaletteQuery } from '../src/features/chat-shell/chatShellCommands'
import {
  emptyThreadSnapshot,
  readThreadCache,
  writeThreadCache,
} from '../src/features/chat-shell/chatShellThreadCache'

describe('parseShellCommand', () => {
  it('parses Spanish and English aliases', () => {
    expect(parseShellCommand('/guion 2 de venta')?.id).toBe('script')
    expect(parseShellCommand('/logo wordmark')?.id).toBe('logo')
    expect(parseShellCommand('/post')?.id).toBe('post')
    expect(parseShellCommand('/producto')?.id).toBe('product')
    expect(parseShellCommand('/descripciones')?.href).toBe('/descriptions')
  })

  it('does not treat settings or admin as slash commands', () => {
    expect(parseShellCommand('/config')).toBeNull()
    expect(parseShellCommand('/settings')).toBeNull()
    expect(parseShellCommand('/admin')).toBeNull()
    expect(parseShellCommand('/uso')).toBeNull()
  })

  it('returns null for normal chat', () => {
    expect(parseShellCommand('generame 2 de venta')).toBeNull()
    expect(parseShellCommand('/unknown')).toBeNull()
  })
})

describe('slash command palette', () => {
  it('lists all commands for a bare slash', () => {
    expect(slashPaletteQuery('/')).toBe('')
    expect(matchSlashCommands('/').map((c) => c.id)).toEqual([
      'script', 'post', 'product', 'logo', 'brand', 'descriptions', 'replies',
    ])
  })

  it('filters by alias prefix and hides once args start', () => {
    expect(matchSlashCommands('/gu').map((c) => c.id)).toEqual(['script'])
    expect(matchSlashCommands('/post').map((c) => c.insert)).toEqual(['/post '])
    expect(matchSlashCommands('/guion 2 de venta')).toEqual([])
    expect(matchSlashCommands('hola')).toEqual([])
  })

  it('inserts command text instead of firing a generation token', () => {
    const selected = matchSlashCommands('/logo')[0]
    expect(selected.insert).toBe('/logo ')
    expect(parseShellCommand(selected.insert)?.id).toBe('logo')
    expect(parseShellCommand(selected.insert)?.rest).toBe('')
  })
})

describe('thread cache', () => {
  it('round-trips a snapshot', () => {
    const cache = new Map()
    const snap = emptyThreadSnapshot()
    snap.messages = [{ id: 'm1', session_id: 's1', role: 'user', content: 'hi', created_at: '' }]
    writeThreadCache(cache, 's1', snap)
    expect(readThreadCache(cache, 's1')?.messages[0]?.id).toBe('m1')
    expect(readThreadCache(cache, 'missing')).toBeNull()
  })
})
