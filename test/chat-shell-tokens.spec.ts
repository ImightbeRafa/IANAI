import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PUBLIC = readFileSync('public/design/chat-shell-obsidian-tokens.css', 'utf8')
const MIRROR = readFileSync('docs/design/chat-shell-obsidian-tokens.css', 'utf8')

function declarations(css: string, selector: string): Record<string, string> {
  const block = css.split(selector)[1]?.split('}')[0] || ''
  const out: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const match = line.trim().match(/^--([a-z0-9-]+):\s*(.+);$/i)
    if (match) out[match[1]] = match[2]
  }
  return out
}

describe('chat-shell obsidian tokens', () => {
  it('keeps the public file and docs mirror in sync for theme values', () => {
    expect(declarations(PUBLIC, '[data-theme="obsidian-dark"]')).toEqual(
      declarations(MIRROR, '[data-theme="obsidian-dark"]')
    )
    expect(declarations(PUBLIC, '[data-theme="obsidian-light"]')).toEqual(
      declarations(MIRROR, '[data-theme="obsidian-light"]')
    )
  })

  it('uses a faint blue-black stage and a live blue accent in dark', () => {
    const dark = declarations(PUBLIC, '[data-theme="obsidian-dark"]')
    const root = declarations(PUBLIC, ':root {')
    expect(dark.bg).toBe('#0b0f14')
    expect(dark.sidebar).toBe('#121922')
    expect(dark['bg-elevated']).toBe('#18212c')
    expect(root.accent).toBe('#4f8cff')
    expect(root['send-from']).toBe('#0284c7')
  })

  it('uses classic live blue accents in light', () => {
    const light = declarations(PUBLIC, '[data-theme="obsidian-light"]')
    expect(light.accent).toBe('#0284c7')
    expect(light['accent-muted']).toBe('#0369a1')
    expect(light['send-to']).toBe('#4f8cff')
  })
})
