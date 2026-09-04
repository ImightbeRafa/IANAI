# Kit refs used

Post / Foto / Pack generations must attach the brand kit **product photo** and **logo**. The browser must not `fetch()` storefront URLs (CSP `connect-src` is not the whole web). The server fetches kit/store images (`/api/fetch-image`, generate-image hydrate, Grok ref resolve).

## Sub-features

- `no-browser-store-fetch` `canBrowserFetchImageUrl` is false for hosts like `www.purasonrisa.shopping`.
- `server-proxy` copy/enhance/pack load those URLs via `fetchPublicUrl` (SSRF-safe) as data URLs.
- `product-lock-not-compose` when a product ref is selected, Grok should get refs (product_lock_scene), not an empty compose that invents the box.

## How to get to it (user POV)

- Complete kit with a real product photo + logo (uploaded or store URL stored on `product_images`).
- Post Paso 6: **Producto · Usar** (and logo if present) → **Generar**.
- Result should lock the real SKU, not a hallucinated box, unless the model ignores a successfully attached ref (then it is a model miss, not a skipped-refs path).

## Driving it with verify-advance

Preconditions:

- Do **not** open `connect-src` to the whole web. Do not weaken `script-src` for vercel.live feedback.js.
- **Do not spend image credits** on the default prove pass.

- `node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive kit-refs-used`
- Default path: unit proof only (`test/chat-shell-image-fetch-csp.spec.ts`, `test/fetch-image-data-url.spec.ts`) plus notes that Preview generate is skipped.
- Optional live proof (credits): generate once, confirm the request hits `/api/fetch-image` or generate-image hydrate rather than a blocked `connect` to the store host. Record CSP violations for `purasonrisa.shopping` **connect** as a fail if they come from our copy/generate path.

## Gotchas

- `img-src https:` lets thumbnails render while `connect-src` blocks `fetch()`. Copying via `urlToBase64` was the skip path.
- Empty `productImageIds: []` is an explicit list so the server does **not** auto-hydrate leftover generated posts. Do not “fix” refs by treating `[]` as auto-load.
- `vercel.live/feedback.js` blocked by `script-src` is Preview noise. Leave it.
- `auth/v1/token?grant_type=password` is `signInWithPassword` (real login). A 400 is a failed sign-in, not leftover grant code. Do not change live auth.
