#!/usr/bin/env node
// Builds a route table from the actual api/**/*.ts source (not from memory),
// so it stays correct as handlers change. Read-only; no network access.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { walkApiHandlers } from './lib.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

function detectMethods(text) {
  const methods = new Set()
  for (const m of text.matchAll(/req\.method\s*===\s*'([A-Z]+)'/g)) methods.add(m[1])
  for (const m of text.matchAll(/req\.method\s*!==\s*'([A-Z]+)'/g)) methods.add(m[1])
  for (const m of text.matchAll(/case\s*'([A-Z]+)'\s*:/g)) methods.add(m[1])
  for (const m of text.matchAll(/\[\s*((?:'[A-Z]+'\s*,?\s*)+)\]\.includes\(req\.method\)/g)) {
    for (const verb of m[1].matchAll(/'([A-Z]+)'/g)) methods.add(verb[1])
  }
  return methods.size > 0 ? [...methods].sort() : ['ANY']
}

function detectBodyParser(text) {
  if (/bodyParser\s*:\s*false/.test(text)) return 'false (raw stream)'
  const sizeLimit = /sizeLimit\s*:\s*['"]([0-9.]+\s*(?:b|kb|mb|gb)?)['"]/i.exec(text)
  if (sizeLimit) return sizeLimit[1]
  return 'default (4.5mb)'
}

function detectWaitUntil(text) {
  return /@vercel\/functions/.test(text)
}

// Auth mechanism per handler, detected from source. A small number of routes
// are hardcoded below because their real behavior doesn't reduce to a single
// regex (verified by reading the handler, not guessed):
//   - /api/mcp-oauth-metadata has no auth check at all — it's the public
//     OAuth discovery endpoint, by design.
//   - /api/mcp uses the same requireAuth() as the rest of the app, but on
//     top of that returns a WWW-Authenticate challenge pointing at the
//     protected-resource metadata when unauthenticated (api/mcp.ts header
//     comment + mcpWwwAuthenticateHeader()).
//   - /api/ticket-events genuinely branches by method: GET accepts either
//     the TICKETS_WEBHOOK_SECRET bearer token or an admin JWT, POST requires
//     only a plain user JWT (api/ticket-events.ts authorizePoll()).
// Everything else is detected generically; when no pattern matches, this
// conservatively reports 'public (no auth)' rather than guessing a specific
// scheme — true today only for mcp-oauth-metadata, but a future handler with
// no recognized auth call would also (correctly, conservatively) land here
// rather than being mis-tagged as something more specific.
const AUTH_OVERRIDES = {
  '/api/mcp-oauth-metadata': 'public (no auth)',
  '/api/mcp': 'mcp OAuth bearer (401 + WWW-Authenticate)',
  '/api/ticket-events': 'mixed (see handler): GET = webhook bearer secret or admin JWT; POST = user JWT',
}

function detectAuth(text, route) {
  if (AUTH_OVERRIDES[route]) return AUTH_OVERRIDES[route]
  if (/process\.env\.CRON_SECRET/.test(text)) return 'CRON_SECRET bearer (401 without)'
  if (/req\.query\.secret/.test(text)) return 'query secret (403 without)'
  const hasAdminGate = /is_admin/.test(text) && /403/.test(text)
  if (hasAdminGate) return 'admin JWT (401 unauth, 403 non-admin)'
  const hasUserAuth = /requireAuth\(|requireBulkUser\(|\.auth\.getUser\(/.test(text)
  if (hasUserAuth) return 'user JWT (401 without)'
  return 'public (no auth)'
}

// Short, source-derived summary of what Vercel prod actually does today —
// used as the "Expected (Vercel prod)" column so the checklist states a
// falsifiable claim per row instead of "should work".
function expectedBehavior(auth, methods) {
  const methodNote = methods.includes('ANY') ? '' : `; non-matching method -> 405`
  switch (true) {
    case auth === 'public (no auth)':
      return `200 JSON, no auth required${methodNote}`
    case auth.startsWith('mcp OAuth bearer'):
      return `401 + WWW-Authenticate unauth; 200 JSON-RPC with a valid Supabase bearer${methodNote}`
    case auth.startsWith('CRON_SECRET bearer'):
      return `401 unauth; 200 JSON with Authorization: Bearer <CRON_SECRET>${methodNote}`
    case auth.startsWith('query secret'):
      return `403 missing/wrong ?secret=; 200 (writes DB) with the real secret${methodNote}`
    case auth.startsWith('admin JWT'):
      return `401 unauth; 403 non-admin; 200 JSON for an admin user${methodNote}`
    case auth.startsWith('user JWT'):
      return `401 unauth; 200 JSON for a signed-in user${methodNote}`
    default:
      return `see handler${methodNote}`
  }
}

// Which parity tag applies to this row: routes whose unauthenticated/wrong-
// method behavior is the thing worth checking can be fully exercised against
// the container with no secrets; everything that needs a real signed-in
// user to see the 200 path needs a human in a browser behind Access.
function parityTag(auth) {
  if (auth === 'public (no auth)' || auth.startsWith('CRON_SECRET bearer') || auth.startsWith('query secret')) {
    return '[local, identical image]'
  }
  return '[needs browser session behind Access]'
}

export function buildRouteTable(root) {
  const files = walkApiHandlers(root)
  const vercelJson = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'))

  return files.map((file) => {
    const text = readFileSync(resolve(root, 'api', file), 'utf8')
    const route = '/api/' + file.replace(/\.ts$/, '')
    const maxDuration = vercelJson.functions?.[`api/${file}`]?.maxDuration ?? 'default'
    const methods = detectMethods(text)
    const auth = detectAuth(text, route)
    return {
      route,
      file: `api/${file}`,
      methods,
      auth,
      bodyParser: detectBodyParser(text),
      maxDuration,
      waitUntil: detectWaitUntil(text),
      expected: expectedBehavior(auth, methods),
      cfResult: 'PENDING',
      tag: parityTag(auth),
    }
  })
}

function renderMarkdown(rows) {
  const lines = []
  lines.push('<!-- Generated by scripts/parity/route-table.mjs. Do not edit by hand. -->')
  lines.push('')
  lines.push('# Cloudflare route table')
  lines.push('')
  lines.push('Every `/api/*` route, derived from the current `api/**/*.ts` source and `vercel.json`.')
  lines.push('')
  lines.push('| Route | Methods | Auth (detected) | Body parser | Max duration (Vercel) | waitUntil |')
  lines.push('|---|---|---|---|---|---|')
  for (const row of rows) {
    lines.push(
      `| \`${row.route}\` | ${row.methods.join(', ')} | ${row.auth} | ${row.bodyParser} | ${row.maxDuration} | ${row.waitUntil ? 'yes' : 'no'} |`
    )
  }
  lines.push('')
  lines.push('## Rewrites (from `vercel.json`)')
  lines.push('')
  lines.push('- `/.well-known/oauth-protected-resource` → `/api/mcp-oauth-metadata`')
  lines.push('- `/.well-known/oauth-protected-resource/api/mcp` → `/api/mcp-oauth-metadata`')
  lines.push('- `/((?!api/|assets/).*)` → `/` (SPA fallback)')
  lines.push('')
  lines.push('## Cron (from `vercel.json`)')
  lines.push('')
  lines.push('- `* * * * *` → `/api/mcp-guide-analysis`')
  lines.push('')
  return lines.join('\n') + '\n'
}

// The parity-checklist variant: one row per route with the columns the
// operator checklist needs (Expected/CF result/Tag), for inlining into
// docs/operations/cloudflare-parity-checklist.md §1 between the BEGIN/END
// markers. `cfResult` is always the literal string 'PENDING' — this script
// never runs against a live container, so it cannot know the real result.
export function renderChecklistMarkdown(rows) {
  const lines = []
  lines.push('| Route | Methods | Auth (detected) | Body parser | Vercel maxDuration | waitUntil | Expected (Vercel prod) | CF result | Tag |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const row of rows) {
    lines.push(
      `| \`${row.route}\` | ${row.methods.join(', ')} | ${row.auth} | ${row.bodyParser} | ${row.maxDuration} | ${row.waitUntil ? 'yes' : 'no'} | ${row.expected} | ${row.cfResult} | ${row.tag} |`
    )
  }
  return lines.join('\n') + '\n'
}

const INLINE_BEGIN = '<!-- BEGIN route-table-checklist (generated by scripts/parity/route-table.mjs --checklist; do not hand-edit) -->'
const INLINE_END = '<!-- END route-table-checklist -->'

// Replaces everything between the BEGIN/END markers in `file` with the
// current checklist table. The markers themselves are preserved so this is
// re-runnable (`npm run parity:checklist`) without hand-editing the
// surrounding doc.
export function inlineChecklistTable(fileContents, rows) {
  const begin = fileContents.indexOf(INLINE_BEGIN)
  const end = fileContents.indexOf(INLINE_END)
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`markers not found: expected "${INLINE_BEGIN}" and "${INLINE_END}"`)
  }
  const before = fileContents.slice(0, begin + INLINE_BEGIN.length)
  const after = fileContents.slice(end)
  return `${before}\n\n${renderChecklistMarkdown(rows)}\n${after}`
}

function parseArgs(argv) {
  let out = null
  let checklist = false
  let inline = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out = argv[i + 1]
      i++
    } else if (argv[i] === '--checklist') {
      checklist = true
    } else if (argv[i] === '--inline' && argv[i + 1]) {
      inline = argv[i + 1]
      i++
    }
  }
  return { out, checklist, inline }
}

function main() {
  const { out, checklist, inline } = parseArgs(process.argv.slice(2))
  const rows = buildRouteTable(ROOT)

  if (inline) {
    const target = resolve(ROOT, inline)
    const updated = inlineChecklistTable(readFileSync(target, 'utf8'), rows)
    writeFileSync(target, updated)
    console.log(`[route-table] inlined ${rows.length} routes into ${inline}`)
    return
  }

  const markdown = checklist ? renderChecklistMarkdown(rows) : renderMarkdown(rows)
  if (out) {
    writeFileSync(resolve(ROOT, out), markdown)
    console.log(`[route-table] wrote ${rows.length} routes to ${out}`)
  } else {
    process.stdout.write(markdown)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
