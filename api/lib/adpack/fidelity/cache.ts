/**
 * Product fidelity — content-addressed blob cache for cut-outs and logo variants.
 *
 * Deterministic storage paths (no DB rows): `<userId>/adpack/cutouts/<sha256>.png`,
 * `<userId>/adpack/logos/<sha256>-<variant>.png`. Reused across packs. Storage without
 * `uploadAt`/`download` (older fakes) → a pass-through cache that always misses and uploads
 * with a generated path.
 */
import type { AdPackStorage } from '../runner-types.js'

export interface BlobCache {
  get(key: string): Promise<{ bytes: Uint8Array; url: string } | null>
  put(key: string, bytes: Uint8Array, contentType?: 'image/png' | 'image/jpeg'): Promise<{ url: string }>
}

export type CacheFolder = 'cutouts' | 'logos'

export function cachePath(userId: string, folder: CacheFolder, key: string): string {
  const safeKey = key.replace(/[^a-z0-9_-]/gi, '_').slice(0, 120)
  return `${userId}/adpack/${folder}/${safeKey}.png`
}

export function storageBlobCache(storage: AdPackStorage, userId: string, folder: CacheFolder): BlobCache {
  return {
    async get(key) {
      if (!storage.download) return null
      try {
        const path = cachePath(userId, folder, key)
        const found = await storage.download(path)
        return found ? { bytes: found.bytes, url: found.url } : null
      } catch {
        return null
      }
    },
    async put(key, bytes, contentType = 'image/png') {
      const path = cachePath(userId, folder, key)
      if (storage.uploadAt) return storage.uploadAt({ path, bytes, contentType })
      return storage.upload({ userId, packId: folder, itemIndex: 0, kind: `cache-${folder}`, bytes, contentType })
    },
  }
}

export function memoryBlobCache(): BlobCache & { entries: Map<string, Uint8Array>; hits: number } {
  const entries = new Map<string, Uint8Array>()
  const cache = {
    entries,
    hits: 0,
    async get(key: string) {
      const bytes = entries.get(key)
      if (!bytes) return null
      cache.hits++
      return { bytes, url: `mem://cache/${key}.png` }
    },
    async put(key: string, bytes: Uint8Array) {
      entries.set(key, bytes)
      return { url: `mem://cache/${key}.png` }
    },
  }
  return cache
}
