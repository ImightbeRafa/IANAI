#!/usr/bin/env node
// Vendor extra OFL Google Fonts into the Ad Pack renderer's bundled font folder.
//
//   node scripts/adpack-vendor-fonts.mjs ["Space Grotesk" "Another Family" ...]
//
// Default family: Space Grotesk (400 + 700). Source: the official google/fonts GitHub repo
// (ofl/<slug>/): the family's OFL.txt plus either its static TTFs or its variable font
// (<Family>[wght].ttf), which is instanced locally into static Regular (400) / Bold (700)
// TTFs with fontTools (`python -m fontTools.varLib.instancer`, satori cannot draw variable
// axes). Files land in api/lib/adpack/render/fonts/. The renderer registers any extra TTF in
// that folder under the family name stored in the font (fonts.ts); families listed in the
// fonts.ts manifest are bundled system fonts. scripts/build-api.mjs copies the whole folder
// into dist-api for the Cloudflare container.
// Vercel: add "includeFiles": "api/lib/adpack/render/fonts/**" to the functions that render.
//
// Run by a person (network), never by tests. Only OFL families should be vendored.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'api', 'lib', 'adpack', 'render', 'fonts')
const RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl'
const WEIGHTS = [400, 700]
const NAMES = { 400: 'Regular', 700: 'Bold' }

const families = process.argv.slice(2).length ? process.argv.slice(2) : ['Space Grotesk']

async function get(url, asText = false) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return asText ? res.text() : Buffer.from(await res.arrayBuffer())
}

async function tryGet(url) {
  try {
    return await get(url)
  } catch {
    return null
  }
}

function python() {
  for (const bin of ['python', 'python3', 'py']) {
    try {
      execFileSync(bin, ['-c', 'import fontTools.varLib.instancer'], { stdio: 'ignore' })
      return bin
    } catch {
      // try the next one
    }
  }
  throw new Error('fontTools is required to instance a variable font (pip install fonttools)')
}

for (const family of families) {
  const pascal = family.replace(/\s+/g, '')
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '')
  await mkdir(FONTS_DIR, { recursive: true })
  // 1) Static instances when the repo ships them.
  let wrote = 0
  for (const w of WEIGHTS) {
    const bytes = await tryGet(`${RAW}/${slug}/${pascal}-${NAMES[w]}.ttf`)
    if (!bytes) continue
    const file = join(FONTS_DIR, `${pascal}-${NAMES[w]}.ttf`)
    await writeFile(file, bytes)
    console.log(`${family} ${w} → ${file} (${bytes.length} bytes)`)
    wrote++
  }
  // 2) Otherwise the variable font, instanced locally.
  if (!wrote) {
    // Variable font: "[wght]" or multi-axis files like Inter's "[opsz,wght]" (other axes are
    // pinned to their default with `axis=drop`, satori needs fully static instances).
    let vf = null
    let axes = []
    for (const tag of ['wght', 'opsz,wght', 'wdth,wght', 'opsz,wdth,wght']) {
      vf = await tryGet(`${RAW}/${slug}/${encodeURIComponent(`${pascal}[${tag}]`)}.ttf`)
      if (vf) {
        axes = tag.split(',').filter((a) => a !== 'wght')
        break
      }
    }
    if (!vf) throw new Error(`${family}: no static TTFs and no variable font found in google/fonts ofl/${slug}`)
    const tmp = await mkdtemp(join(tmpdir(), 'adpack-font-'))
    try {
      const src = join(tmp, `${pascal}-VF.ttf`)
      await writeFile(src, vf)
      const py = python()
      for (const w of WEIGHTS) {
        const file = join(FONTS_DIR, `${pascal}-${NAMES[w]}.ttf`)
        execFileSync(py, ['-m', 'fontTools.varLib.instancer', src, `wght=${w}`, ...axes.map((a) => `${a}=drop`), '--static', '--update-name-table', '-q', '-o', file], { stdio: 'inherit' })
        console.log(`${family} ${w} → ${file} (instanced from the variable font)`)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
  const ofl = await get(`${RAW}/${slug}/OFL.txt`, true)
  await writeFile(join(FONTS_DIR, `${slug}-OFL.txt`), ofl)
  console.log(`${family} license → ${slug}-OFL.txt`)
}
