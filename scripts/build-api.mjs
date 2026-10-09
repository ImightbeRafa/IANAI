#!/usr/bin/env node
// Compiles api/**/*.ts to dist-api/ as plain ESM, one file at a time (no bundling).
// api/ isn't typechecked by `tsc -b` (see root tsconfig.json), so this only strips
// types with esbuild; node_modules stays external so sharp and pdf-parse load
// natively, and the 1:1 file layout keeps the existing `.js`-suffixed relative
// imports valid at runtime.
import { build } from 'esbuild'
import { cp, rm, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkApiHandlers } from './parity/lib.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

// Vercel's Fluid-compute platform default when a function sets neither
// `export const maxDuration` nor `vercel.json`'s `functions[...].maxDuration`.
// vercel.json isn't shipped in the runtime image, so this manifest is the
// only way server.mjs can learn a route's deadline at startup.
const DEFAULT_MAX_DURATION_SECONDS = 300

function parseArgs(argv) {
  let outdir = 'dist-api'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--outdir' && argv[i + 1]) {
      outdir = argv[i + 1]
      i++
    }
  }
  return { outdir }
}

async function walkTsFiles(dir, root = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkTsFiles(full, root)))
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

// A manifest of route -> maxDuration (seconds), read by server.mjs at
// startup since vercel.json isn't shipped in the runtime image. The leading
// `_` means the segment regex that guards API routing (SEGMENT_RE in
// server.mjs) can never route to it — see test/cf-api-build.spec.ts.
async function writeRouteDeadlineManifest(outDir) {
  const vercelJson = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'))
  const routeFiles = await walkApiHandlers(ROOT)

  const manifest = {}
  for (const relTs of routeFiles) {
    const route = '/api/' + relTs.replace(/\.ts$/, '')
    manifest[route] = vercelJson.functions?.[`api/${relTs}`]?.maxDuration ?? DEFAULT_MAX_DURATION_SECONDS
  }

  await writeFile(join(outDir, '_route-deadlines.json'), JSON.stringify(manifest, null, 2) + '\n')
  return Object.keys(manifest).length
}

// Non-TS runtime assets that api/ code loads from disk relative to its own
// compiled module (`new URL('./fonts/x.ttf', import.meta.url)`). esbuild only
// emits .js, so these are copied 1:1 into the same relative spot under
// dist-api/ — e.g. api/lib/adpack/render/fonts/** -> dist-api/lib/adpack/
// render/fonts/** (TTFs plus their OFL license files). Every file under each
// listed directory is copied; a missing directory fails the build loudly
// rather than shipping a renderer that can't find its fonts.
const API_ASSET_DIRS = Object.freeze(['lib/adpack/render/fonts'])

async function copyApiAssets(apiDir, outDir) {
  let count = 0
  for (const rel of API_ASSET_DIRS) {
    const src = join(apiDir, rel)
    const info = await stat(src).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`asset dir missing: api/${rel}`)
    await cp(src, join(outDir, rel), { recursive: true })
    count += (await readdir(src, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length
  }
  return count
}

async function main() {
  const { outdir } = parseArgs(process.argv.slice(2))
  const apiDir = join(ROOT, 'api')
  const outDir = join(ROOT, outdir)

  await rm(outDir, { recursive: true, force: true })

  const entryPoints = await walkTsFiles(apiDir)

  // Build commit exposed by the MCP get_server_info tool (BUILD_COMMIT env wins; 'unknown' without git).
  let commit = (process.env.BUILD_COMMIT || '').trim()
  if (!commit) {
    try {
      const { execFileSync } = await import('node:child_process')
      commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch { commit = '' }
  }
  await build({
    entryPoints,
    define: { __ADVANCE_BUILD_COMMIT__: JSON.stringify(commit) },
    outdir: outDir,
    outbase: apiDir,
    bundle: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    logLevel: 'warning',
  })

  const routeCount = await writeRouteDeadlineManifest(outDir)
  const assetCount = await copyApiAssets(apiDir, outDir)

  console.log(
    `[build-api] ${entryPoints.length} files -> ${outdir} (${routeCount} route deadlines, ${assetCount} assets from ${API_ASSET_DIRS.map((d) => 'api/' + d).join(', ')})`,
  )
}

main().catch((err) => {
  console.error('[build-api] failed', err)
  process.exit(1)
})
