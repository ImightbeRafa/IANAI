/**
 * `/chat?brand=<id>&adpack=<packId>` — the deep link the Ad Pack engine returns
 * (status `deepLink`, also handed to the user by Grok). Opens the studio straight
 * on Resultados for that pack. Always honoured, even with `VITE_ADPACK_STUDIO`
 * off: only the composer / slash entry points are gated by that flag.
 *
 * The param is stripped from the URL once the pack is opened (same idea as the
 * `?session=` handling), so a reload does not reopen it in a loop.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export const ADPACK_DEEP_LINK_PARAM = 'adpack'

/** Pack id from a query string / params, or null. Malformed ids are kept (the server answers NOT_FOUND). */
export function readAdPackParam(params: URLSearchParams | string): string | null {
  const search = typeof params === 'string' ? new URLSearchParams(params) : params
  const raw = search.get(ADPACK_DEEP_LINK_PARAM)?.trim()
  return raw ? raw.slice(0, 64) : null
}

/** Copy of `params` without the `adpack` param (brand / session kept). */
export function withoutAdPackParam(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete(ADPACK_DEEP_LINK_PARAM)
  return next
}

/**
 * @param ready true once the workspace can show the studio (brand loaded, or brands
 *   finished loading — a foreign brand never loads, and the pack then shows NOT_FOUND).
 * @returns the pack to open (null until ready / after close) and a close handler.
 */
export function useAdPackDeepLink(ready: boolean): { packId: string | null; close: () => void } {
  const [searchParams, setSearchParams] = useSearchParams()
  // Captured at first render: the workspace may rewrite ?brand/&session before the brand loads.
  const [packId, setPackId] = useState<string | null>(() => readAdPackParam(searchParams))
  const urlPackId = readAdPackParam(searchParams)

  // A later in-app navigation to an ?adpack= link (or the same one again) opens that pack.
  useEffect(() => {
    if (urlPackId) setPackId(urlPackId)
  }, [urlPackId])

  const open = Boolean(packId) && ready
  // Strip the param once the pack is open so a reload does not reopen it in a loop.
  useEffect(() => {
    if (open && urlPackId) setSearchParams((prev) => withoutAdPackParam(prev), { replace: true })
  }, [open, urlPackId, setSearchParams])

  const close = useCallback(() => setPackId(null), [])
  return { packId: open ? packId : null, close }
}
