#!/usr/bin/env node
// Compiles api/**/*.ts to dist-api/ as plain ESM, one file at a time (no bundling).
// api/ isn't typechecked by `tsc -b` (see root tsconfig.json), so this only strips
// types with esbuild; node_modules stays external so sharp and pdf-parse load
// natively, and the 1:1 file layout keeps the existing `.js`-suffixed relative
// imports valid at runtime.
import { build } from 'esbuild'
import { rm, readdir, readFile, writeFile } from 'node:fs/promises'
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

async function main() {
  const { outdir } = parseArgs(process.argv.slice(2))
  const apiDir = join(ROOT, 'api')
  const outDir = join(ROOT, outdir)

  await rm(outDir, { recursive: true, force: true })

  const entryPoints = await walkTsFiles(apiDir)

  await build({
    entryPoints,
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

  console.log(`[build-api] ${entryPoints.length} files -> ${outdir} (${routeCount} route deadlines)`)
}

main().catch((err) => {
  console.error('[build-api] failed', err)
  process.exit(1)
})
