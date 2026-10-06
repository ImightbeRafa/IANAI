#!/usr/bin/env node
// Body-size-limit parity check: sends unauthenticated application/json
// bodies at exactly each handler's configured limit (expect 401 — proof the
// adapter let the request through and the handler's own auth check ran
// first) and at limit+1 byte (expect 413 — proof the adapter rejected it
// before the handler ever ran). No Authorization header, no DB or AI calls.
// Refuses non-local base URLs unless --allow-remote, and never touches the
// network until that guard has run.
import { execFileSync } from 'node:child_process'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal'])

const TARGETS = [
  { path: '/api/extract-pdf', limit: 10_485_760 },
  { path: '/api/analyze-style', limit: 26_214_400 },
  { path: '/api/chat', limit: 4_718_592 },
]

function parseArgs(argv) {
  const args = { allowRemote: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url') args.baseUrl = argv[++i]
    else if (argv[i] === '--allow-remote') args.allowRemote = true
    else if (argv[i] === '--image') args.image = argv[++i]
  }
  return args
}

function printImageDigest(image) {
  if (process.env.IMAGE_DIGEST) {
    console.log(`image: ${process.env.IMAGE_DIGEST}`)
    return
  }
  if (image) {
    try {
      const id = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
        encoding: 'utf8',
      }).trim()
      console.log(`image: ${id}`)
      return
    } catch (err) {
      console.error('[upload-limits] docker image inspect failed', err?.message ?? err)
    }
  }
  console.log('image: (unknown)')
}

function assertLocalBaseUrl(baseUrl, allowRemote) {
  const url = new URL(baseUrl)
  if (!allowRemote && !LOCAL_HOSTS.has(url.hostname)) {
    console.error(`[upload-limits] refusing non-local base URL: ${url.hostname} (pass --allow-remote to override)`)
    process.exit(1)
  }
}

// A JSON body of exactly `bytes` bytes: {"a":"<padding>"} with ASCII padding
// so byte length equals char length.
function jsonBodyOfSize(bytes) {
  const OVERHEAD = '{"a":""}'.length
  const padding = 'x'.repeat(Math.max(0, bytes - OVERHEAD))
  return `{"a":"${padding}"}`
}

async function postJson(baseUrl, path, bytes) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: jsonBodyOfSize(bytes),
  })
  await res.arrayBuffer().catch(() => undefined)
  return res.status
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.baseUrl) {
    console.error('[upload-limits] --base-url is required')
    process.exit(1)
  }

  assertLocalBaseUrl(args.baseUrl, args.allowRemote)
  printImageDigest(args.image)

  const rows = []
  for (const target of TARGETS) {
    const atLimit = await postJson(args.baseUrl, target.path, target.limit)
    const overLimit = await postJson(args.baseUrl, target.path, target.limit + 1)
    rows.push({
      path: target.path,
      limit: target.limit,
      atLimit,
      atLimitOk: atLimit === 401,
      overLimit,
      overLimitOk: overLimit === 413,
    })
  }

  console.log('| route | limit (bytes) | at-limit status | +1 byte status |')
  console.log('|---|---|---|---|')
  for (const row of rows) {
    const atMark = row.atLimitOk ? 'PASS' : 'FAIL'
    const overMark = row.overLimitOk ? 'PASS' : 'FAIL'
    console.log(`| ${row.path} | ${row.limit} | ${row.atLimit} (${atMark}) | ${row.overLimit} (${overMark}) |`)
  }

  if (rows.some((r) => !r.atLimitOk || !r.overLimitOk)) process.exit(1)
}

main()
