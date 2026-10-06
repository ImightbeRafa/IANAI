#!/usr/bin/env node
// Compiles api/**/*.ts to dist-api/ as plain ESM, one file at a time (no bundling).
// api/ isn't typechecked by `tsc -b` (see root tsconfig.json), so this only strips
// types with esbuild; node_modules stays external so sharp and pdf-parse load
// natively, and the 1:1 file layout keeps the existing `.js`-suffixed relative
// imports valid at runtime.
import { build } from 'esbuild'
import { rm, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

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

  console.log(`[build-api] ${entryPoints.length} files -> ${outdir}`)
}

main().catch((err) => {
  console.error('[build-api] failed', err)
  process.exit(1)
})
