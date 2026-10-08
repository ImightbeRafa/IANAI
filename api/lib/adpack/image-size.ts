/** Read width/height from PNG, JPEG or WebP headers (no decode). Null when unknown. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const u8 = bytes
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  // PNG: IHDR at offset 16.
  if (u8.length >= 24 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) }
  }
  // JPEG: scan for SOFn.
  if (u8.length >= 4 && u8[0] === 0xff && u8[1] === 0xd8) {
    let i = 2
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xff) {
        i++
        continue
      }
      const marker = u8[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2
        continue
      }
      const len = dv.getUint16(i + 2)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) }
      i += 2 + len
    }
    return null
  }
  // WebP (RIFF....WEBP)
  if (u8.length >= 30 && u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57 && u8[9] === 0x45) {
    const chunk = String.fromCharCode(u8[12], u8[13], u8[14], u8[15])
    if (chunk === 'VP8X') return { width: 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16)), height: 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16)) }
    if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
    if (chunk === 'VP8L') {
      const b = dv.getUint32(21, true)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
  }
  return null
}
