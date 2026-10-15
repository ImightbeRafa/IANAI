/**
 * Round 12: cut-out QA metadata travels INSIDE the cached PNG (a tEXt chunk), so a storage-cache hit on a cold worker
 * still reports the fidelity vs the reference photo (photoIoU) and the mask repair — round 11 SP said
 * `silhouetteVs: "cutout"` because the storage hit had lost them. Pure bytes, no dependency (runs in the Worker too).
 */
export interface CutoutMeta {
  photoIoU?: number
  maskRepaired?: boolean
  recall?: number
  backgroundLeak?: number
  flatLay?: boolean
}

const KEY = 'ianai-cutout'
const SIG = [137, 80, 78, 71, 13, 10, 26, 10]
let table: Uint32Array | null = null
function crc32(buf: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const isPng = (b: Uint8Array) => b.length > 12 && SIG.every((v, i) => b[i] === v)
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

/** Insert (or replace) the metadata chunk before IEND. Non-PNG bytes are returned unchanged. */
export function writeCutoutMeta(png: Uint8Array, meta: CutoutMeta): Uint8Array {
  if (!isPng(png)) return png
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined))
  const text = new TextEncoder().encode(`${KEY}\0${JSON.stringify(clean)}`)
  const chunks: Uint8Array[] = [png.subarray(0, 8)]
  let o = 8
  while (o + 12 <= png.length) {
    const len = u32(png, o)
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7])
    const end = o + 12 + len
    if (type === 'IEND') {
      const body = new Uint8Array(4 + text.length)
      body.set([0x74, 0x45, 0x58, 0x74]) // tEXt
      body.set(text, 4)
      const chunk = new Uint8Array(12 + text.length)
      chunk.set([(text.length >>> 24) & 255, (text.length >>> 16) & 255, (text.length >>> 8) & 255, text.length & 255])
      chunk.set(body, 4)
      const c = crc32(body)
      chunk.set([(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255], 8 + text.length)
      chunks.push(chunk, png.subarray(o, end))
      break
    }
    const isOurs = type === 'tEXt' && new TextDecoder().decode(png.subarray(o + 8, o + 8 + Math.min(len, KEY.length + 1))) === `${KEY}\0`
    if (!isOurs) chunks.push(png.subarray(o, end))
    o = end
  }
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0))
  let p = 0
  for (const c of chunks) { out.set(c, p); p += c.length }
  return out
}

export function readCutoutMeta(png: Uint8Array): CutoutMeta | null {
  if (!isPng(png)) return null
  let o = 8
  while (o + 12 <= png.length) {
    const len = u32(png, o)
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7])
    if (type === 'tEXt') {
      const s = new TextDecoder().decode(png.subarray(o + 8, o + 8 + len))
      if (s.startsWith(`${KEY}\0`)) {
        try { return JSON.parse(s.slice(KEY.length + 1)) as CutoutMeta } catch { return null }
      }
    }
    if (type === 'IEND') break
    o += 12 + len
  }
  return null
}
