/**
 * Copy the external photos a site analysis stores on a brand kit (`reference_images`) into Advance storage
 * (`post-images/<userId>/uploads/…`, the same bucket and downloader as `import_image`), so a shop redesign or a
 * 404 on the source site can never break generation later (PatchHouse's pouch photos did: "Could not load
 * product reference images"). A photo that cannot be copied keeps its original URL and is reported.
 * Never touches rows that already exist: it only rewrites URLs the analysis is about to write.
 */
import type { RehostFn } from './asset-rehost.js'

export type RehostReferencesResult = {
  urls: string[]
  rehosted: Array<{ url: string; sourceUrl: string }>
  warnings: string[]
}

export async function rehostReferenceImages(urls: string[], userId: string, rehost: RehostFn, max = 8): Promise<RehostReferencesResult> {
  const out: string[] = []
  const rehosted: RehostReferencesResult['rehosted'] = []
  const warnings: string[] = []
  for (const raw of urls.slice(0, max)) {
    const url = typeof raw === 'string' ? raw.trim() : ''
    if (!url) continue
    try {
      const res = await rehost({ userId, url })
      out.push(res.url)
      if (res.rehosted && res.sourceUrl) rehosted.push({ url: res.url, sourceUrl: res.sourceUrl })
      else if (res.warning) warnings.push(`${url.slice(0, 160)}: ${res.warning}`.slice(0, 300))
    } catch (err) {
      out.push(url)
      warnings.push(`${url.slice(0, 160)}: ${err instanceof Error ? err.message : 'rehost failed'}`.slice(0, 300))
    }
  }
  return { urls: out, rehosted, warnings }
}
