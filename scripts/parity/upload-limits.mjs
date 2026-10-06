#!/usr/bin/env node
// Body-size-limit parity check: sends application/json bodies at exactly
// each handler's configured limit (expect the body to be ACCEPTED by the
// adapter — i.e. anything other than the adapter's own 413/503 — proof the
// full at-limit body was read and handed to the real handler) and at
// limit+1 byte (expect 413 — proof the adapter rejected it before the
// handler ever ran). No DB or AI calls (operator note, round 8: on a
// no-secrets box, an elevated-limit handler that gets past the adapter
// often answers 500 "not configured" rather than 401 — that's still proof
// the adapter let the body through, not a failure). Refuses non-local base
// URLs unless --allow-remote, and never touches the network until that
// guard has run.
import { execFileSync } from 'node:child_process'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal'])

// Matches server.mjs's DEFAULT_BODY_LIMIT exactly (duplicated here rather
// than imported — this script runs standalone against a remote base URL,
// not against the adapter's own module graph).
const DEFAULT_BODY_LIMIT = 4_718_592

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

// Round-6 operator review, item H: a dummy (never real, never validated by
// the adapter — only its shape matters) Bearer token is required to get
// PAST the adapter's own pre-auth gate on bodies over DEFAULT_BODY_LIMIT
// for elevated-limit routes, before the handler's own real auth check (or
// the 413 size check) ever runs. Routes at the default limit (/api/chat)
// don't need this — that gate never applies to them.
async function postJson(baseUrl, path, bytes, { withDummyAuth = false } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withDummyAuth ? { authorization: 'Bearer parity-script-dummy-token' } : {}),
    },
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
    // Only elevated-limit routes (above DEFAULT_BODY_LIMIT) ever hit the
    // adapter's pre-auth gate — /api/chat stays exactly as before.
    const withDummyAuth = target.limit > DEFAULT_BODY_LIMIT
    const atLimit = await postJson(args.baseUrl, target.path, target.limit, { withDummyAuth })
    const overLimit = await postJson(args.baseUrl, target.path, target.limit + 1, { withDummyAuth })
    // Operator-found bug (round 8): for an elevated-limit route, the
    // adapter's own pre-auth 401 body ({"error":"Missing authorization"})
    // is indistinguishable BY STATUS from a handler's own 401 — so
    // `atLimit === 401` can't tell "adapter let it through" apart from
    // "adapter rejected it" on status alone. The real criterion is
    // narrower and more honest: the at-limit probe only needs to prove the
    // FULL body was accepted and handed to the real handler, which is true
    // for ANY handler response (401 from the handler's real token check,
    // 500 "not configured" on a no-secrets box, 200, etc.) as long as it's
    // not the adapter's own 413 (body too large) or 503 (busy — the
    // semaphore, item H). /api/chat sends no dummy auth and never crosses
    // the elevated-limit gate at all, so it keeps the original, narrower
    // "must be exactly 401" criterion (the handler's own auth check is the
    // only thing that can answer there).
    const atLimitOk = withDummyAuth ? atLimit !== 413 && atLimit !== 503 : atLimit === 401
    const note = withDummyAuth
      ? 'any non-413/503 status proves the adapter accepted the full at-limit body'
      : 'default-limit route, no dummy auth sent: must be exactly 401 from the handler'
    rows.push({
      path: target.path,
      limit: target.limit,
      atLimit,
      atLimitOk,
      note,
      overLimit,
      overLimitOk: overLimit === 413,
    })
  }

  console.log('| route | limit (bytes) | at-limit status | +1 byte status | note |')
  console.log('|---|---|---|---|---|')
  for (const row of rows) {
    const atMark = row.atLimitOk ? 'PASS' : 'FAIL'
    const overMark = row.overLimitOk ? 'PASS' : 'FAIL'
    console.log(
      `| ${row.path} | ${row.limit} | ${row.atLimit} (${atMark}) | ${row.overLimit} (${overMark}) | ${row.note} |`
    )
  }

  if (rows.some((r) => !r.atLimitOk || !r.overLimitOk)) process.exit(1)
}

main()
