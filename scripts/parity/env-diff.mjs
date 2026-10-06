#!/usr/bin/env node
// Compares env var NAMES (never values) across three sources: the real
// Vercel project, the api/ and src/ source code, and the Cloudflare side
// (CONTAINER_ENV_KEYS + wrangler.jsonc vars). Read-only, no network access,
// never reads process.env values.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseJsonc, scanProcessEnvNames, scanViteEnvNames } from './lib.mjs'
import { VERCEL_ENV_NAMES } from './vercel-env-names.mjs'
import { CONTAINER_ENV_KEYS } from '../../cf/container-env.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

// Vars that exist in wrangler.jsonc but are deliberately never forwarded to
// the container — they're consumed by the Worker itself (cf/access-jwt.ts,
// via cf/worker-core.ts's handleFetch) before a request ever reaches
// containerFetch. Listed here, not in CONTAINER_ENV_KEYS, so
// wranglerVarsNotForwarded's "must be empty" invariant stays meaningful
// (an *unexpected* unforwarded var is still a real finding) instead of
// being satisfied by accident.
export const WORKER_ONLY_VAR_NAMES = Object.freeze(['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'])

function sortedUnique(names) {
  return [...new Set(names)].sort()
}

export function diffEnv(root) {
  const apiNames = scanProcessEnvNames(resolve(root, 'api'))
  const viteNames = scanViteEnvNames(resolve(root, 'src'))
  const wrangler = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'))

  const containerKeys = new Set(CONTAINER_ENV_KEYS)
  const workerOnlyKeys = new Set(WORKER_ONLY_VAR_NAMES)
  const relevantNames = sortedUnique([...VERCEL_ENV_NAMES, ...apiNames])

  const missingFromContainer = relevantNames.filter(
    (name) => name !== 'VERCEL_ENV' && !containerKeys.has(name)
  )

  const wranglerVarNames = sortedUnique([
    ...Object.keys(wrangler.vars ?? {}),
    ...Object.keys(wrangler.env?.preview?.vars ?? {}),
  ])
  const wranglerVarsNotForwarded = wranglerVarNames.filter(
    (name) => !containerKeys.has(name) && !workerOnlyKeys.has(name)
  )
  const workerOnlyVarsPresent = wranglerVarNames.filter((name) => workerOnlyKeys.has(name))

  const usedNames = new Set([...apiNames, ...viteNames])
  const unusedVercelNames = sortedUnique(VERCEL_ENV_NAMES.filter((name) => !usedNames.has(name)))

  return { missingFromContainer, wranglerVarsNotForwarded, unusedVercelNames, workerOnlyVarsPresent }
}

// Per-name table for the 17 audited Vercel names: is it forwarded to the
// container (CONTAINER_ENV_KEYS), and is it actually read in code (api/
// via process.env, src/ via import.meta.env, both, or neither)? Used by the
// CLI and by docs/operations/cloudflare-parity-checklist.md §11.
export function buildVercelNameTable(root) {
  const apiNames = new Set(scanProcessEnvNames(resolve(root, 'api')))
  const viteNames = new Set(scanViteEnvNames(resolve(root, 'src')))
  const containerKeys = new Set(CONTAINER_ENV_KEYS)

  return VERCEL_ENV_NAMES.map((name) => {
    const inApi = apiNames.has(name)
    const inVite = viteNames.has(name)
    const readInCode = inApi && inVite ? 'api+src' : inApi ? 'api' : inVite ? 'src' : 'no'
    return {
      name,
      forwardedToContainer: containerKeys.has(name),
      readInCode,
    }
  })
}

function renderNameTable(rows) {
  const lines = []
  lines.push('| Vercel env name | Forwarded to container? | Read in code? |')
  lines.push('|---|---|---|')
  for (const row of rows) {
    lines.push(`| \`${row.name}\` | ${row.forwardedToContainer ? 'yes' : 'no'} | ${row.readInCode} |`)
  }
  return lines.join('\n')
}

function main() {
  const { missingFromContainer, wranglerVarsNotForwarded, unusedVercelNames, workerOnlyVarsPresent } = diffEnv(ROOT)
  const nameTable = buildVercelNameTable(ROOT)

  console.log(renderNameTable(nameTable))
  console.log('')
  console.log('[env-diff] missingFromContainer:', missingFromContainer)
  console.log('[env-diff] wranglerVarsNotForwarded:', wranglerVarsNotForwarded)
  console.log('[env-diff] unusedVercelNames:', unusedVercelNames)
  console.log('[env-diff] workerOnlyVarsPresent (expected, never forwarded):', workerOnlyVarsPresent)

  if (missingFromContainer.length > 0 || wranglerVarsNotForwarded.length > 0) {
    console.error('[env-diff] FAIL: missingFromContainer and wranglerVarsNotForwarded must both be empty')
    process.exit(1)
  }
  console.log('[env-diff] OK')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
