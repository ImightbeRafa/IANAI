/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  captureMcpIntakeFromUrl,
  clearStoredMcpIntake,
  CHAT_SHELL_MCP_INTAKE_KEY,
  isAllowedMcpIntakeFile,
  parseMcpIntakeValue,
  partitionMcpIntakeFiles,
} from '../src/features/chat-shell/chatShellMcpIntake'

describe('chatShellMcpIntake', () => {
  beforeEach(() => {
    clearStoredMcpIntake()
    sessionStorage.clear()
  })
  afterEach(() => {
    clearStoredMcpIntake()
  })

  it('parses files/asset/uuid and rejects junk', () => {
    expect(parseMcpIntakeValue('files')).toBe('files')
    expect(parseMcpIntakeValue('asset')).toBe('asset')
    expect(parseMcpIntakeValue('b74f3c2b-60ac-40a0-ad8b-14cf88b1cc22')).toBe('url_status')
    expect(parseMcpIntakeValue('nope')).toBeNull()
  })

  it('partitions pdf vs images and rejects others', () => {
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const png = new File(['x'], 'b.png', { type: 'image/png' })
    const txt = new File(['x'], 'c.txt', { type: 'text/plain' })
    expect(isAllowedMcpIntakeFile(pdf)).toBe(true)
    expect(isAllowedMcpIntakeFile(txt)).toBe(false)
    const parts = partitionMcpIntakeFiles([pdf, png, txt])
    expect(parts.pdfs).toHaveLength(1)
    expect(parts.images).toHaveLength(1)
    expect(parts.rejected).toHaveLength(1)
  })

  it('captures intake from search and stores it', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    const intent = captureMcpIntakeFromUrl({
      search: '?brand=b1&intake=files&request=req-1',
      brandId: 'b1',
      replaceUrl: true,
    })
    expect(intent?.mode).toBe('files')
    expect(intent?.requestId).toBe('req-1')
    expect(sessionStorage.getItem(CHAT_SHELL_MCP_INTAKE_KEY)).toContain('files')
    expect(replaceState).toHaveBeenCalled()
    replaceState.mockRestore()
  })
})
