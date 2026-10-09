#!/usr/bin/env node
// Vendor extra OFL Google Fonts into the Ad Pack renderer's bundled font folder.
//
//   node scripts/adpack-vendor-fonts.mjs ["Space Grotesk" "Another Family" ...]
//
// Default family: Space Grotesk (400 + 700). Downloads static TTF instances through the
// Google Fonts CSS2 API (legacy user agent → format('truetype')) plus the family's OFL.txt
// from github.com/google/fonts, into api/lib/adpack/render/fonts/. The renderer registers
// any extra TTF in that folder under the family name stored in the font (fonts.ts), and
// scripts/build-api.mjs copies the whole folder into dist-api for the Cloudflare container.
// Vercel: add "includeFiles": "api/lib/adpack/render/fonts/**" to the functions that render.
//
// Run by a person (network), never by tests. Only OFL families should be vendored.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'api', 'lib', 'adpack', 'render', 'fonts')
const UA = 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0'
const WEIGHTS = [400, 700]
const NAMES = { 400: 'Regular', 700: 'Bold' }

const families = process.argv.slice(2).length ? process.argv.slice(2) : ['Space Grotesk']

async function get(url, asText = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return asText ? res.text() : Buffer.from(await res.arrayBuffer())
}

for (const family of families) {
  const pascal = family.replace(/\s+/g, '')
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const css = await get(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${WEIGHTS.join(';')}`, true)
  const urls = new Map()
  for (const block of css.split('@font-face').slice(1)) {
    if (!/font-style:\s*normal/.test(block)) continue
    const weight = Number(/font-weight:\s*(\d{3})/.exec(block)?.[1] ?? 400)
    const url = /url\((https:\/\/[^)\s]+)\)\s*format\(['"]?truetype/.exec(block)?.[1]
    if (url && !urls.has(weight)) urls.set(weight, url)
  }
  if (!urls.size) throw new Error(`${family}: no TTF URLs in the CSS2 response`)
  await mkdir(FONTS_DIR, { recursive: true })
  for (const [weight, url] of urls) {
    const bytes = await get(url)
    const file = join(FONTS_DIR, `${pascal}-${NAMES[weight] ?? weight}.ttf`)
    await writeFile(file, bytes)
    console.log(`${family} ${weight} → ${file} (${bytes.length} bytes)`)
  }
  const ofl = await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${slug}/OFL.txt`, true)
  await writeFile(join(FONTS_DIR, `${slug}-OFL.txt`), ofl)
  console.log(`${family} license → ${slug}-OFL.txt`)
}
