// Shared helpers for the Cloudflare parity scripts and their tests. Plain ESM,
// read-only, no network access.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export function walkApiHandlers(root) {
  const apiDir = join(root, 'api')
  const out = []

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['lib', 'data', 'types'].includes(entry.name)) continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue
      if (entry.name.startsWith('_')) continue
      out.push(relative(apiDir, full).split('\\').join('/'))
    }
  }

  walk(apiDir)
  return out.sort()
}

function walkFiles(dir, ext) {
  const out = []
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.isFile() && entry.name.endsWith(ext)) out.push(full)
    }
  }
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) walk(dir)
  return out
}

export function scanProcessEnvNames(dir) {
  const names = new Set()
  const re = /process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/g
  for (const file of walkFiles(dir, '.ts')) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) {
      names.add(m[1] || m[2])
    }
  }
  return [...names].sort()
}

export function scanViteEnvNames(dir) {
  const names = new Set()
  const re = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g
  for (const ext of ['.ts', '.tsx']) {
    for (const file of walkFiles(dir, ext)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(re)) {
        names.add(m[1])
      }
    }
  }
  return [...names].sort()
}

// A small string-aware stripper for `//` and `/* */` comments plus trailing
// commas, then JSON.parse. Good enough for our own wrangler.jsonc, not a
// general-purpose JSONC parser.
export function parseJsonc(text) {
  let out = ''
  let i = 0
  let inString = false
  let stringQuote = ''
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === stringQuote) inString = false
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      stringQuote = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  // Strip trailing commas before `}` or `]`.
  out = out.replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(out)
}
