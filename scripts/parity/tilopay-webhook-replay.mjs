#!/usr/bin/env node
// Tilopay webhook parity replay — NON-WRITING CHECKS ONLY.
//
// api/tilopay/webhook.ts authenticates with `?secret=` query-string equality
// against TILOPAY_WEBHOOK_SECRET, not an HMAC signature (the stale
// scripts/test-tilopay-webhook.js describes HMAC that does not exist in this
// handler — leave that script alone, it predates this one).
//
// There is deliberately NO `--write` mode in this script. A request that
// passes the real secret writes a row to `payment_transactions` on the
// shared AIIAN database (even a "no email" request writes an
// `error_no_email` audit row) — see api/tilopay/webhook.ts. Exercising that
// success path needs an explicit Orchestrator OK and a dedicated test
// identity (email with no Advance profile or pending subscription), planned
// for Phase 2, done by a human against a real deployment — never from this
// script. This script only ever sends GET and wrong/missing-secret POSTs,
// none of which reach the database (the secret check runs before any DB
// access).
//
// Refuses non-local base URLs unless --allow-remote is passed, and never
// touches the network until that guard has run.
import { execFileSync } from 'node:child_process'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal'])

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
      console.error('[tilopay-webhook-replay] docker image inspect failed', err?.message ?? err)
    }
  }
  console.log('image: (unknown)')
}

function assertLocalBaseUrl(baseUrl, allowRemote) {
  const url = new URL(baseUrl)
  if (!allowRemote && !LOCAL_HOSTS.has(url.hostname)) {
    console.error(`[tilopay-webhook-replay] refusing non-local base URL: ${url.hostname} (pass --allow-remote to override)`)
    process.exit(1)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.baseUrl) {
    console.error('[tilopay-webhook-replay] --base-url is required')
    process.exit(1)
  }

  // Guard runs before any network call.
  assertLocalBaseUrl(args.baseUrl, args.allowRemote)

  printImageDigest(args.image)

  const results = []

  {
    const res = await fetch(`${args.baseUrl}/api/tilopay/webhook`, { method: 'GET' })
    const body = await res.json().catch(() => null)
    const ok = res.status === 200 && body?.status === 'ok' && body?.handler === 'tilopay-webhook'
    results.push({ step: 'GET health-ish', ok, status: res.status })
  }

  {
    const randomSecret = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    const res = await fetch(
      `${args.baseUrl}/api/tilopay/webhook?event=payment&secret=${randomSecret}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'email=test%40example.test',
      }
    )
    const body = await res.json().catch(() => null)
    const ok = res.status === 403 && body?.error === 'Forbidden'
    results.push({ step: 'POST with wrong secret=*** (printed, never the real value)', ok, status: res.status })
  }

  {
    const res = await fetch(`${args.baseUrl}/api/tilopay/webhook?event=payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=test%40example.test',
    })
    const body = await res.json().catch(() => null)
    const ok = res.status === 403 && body?.error === 'Forbidden'
    results.push({ step: 'POST with no secret', ok, status: res.status })
  }

  for (const r of results) {
    console.log(`[tilopay-webhook-replay] ${r.ok ? 'PASS' : 'FAIL'} ${r.step} (status ${r.status})`)
  }

  if (results.some((r) => !r.ok)) process.exit(1)
}

main()
