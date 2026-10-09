# Content agent runbook — a brand from zero to 2 ads, only via MCP

For an agent ("Content") connected to the Advance AI MCP (`POST https://advanceai.studio/api/mcp`, registry **0.14.0**).
Everything below is a `tools/call`. All brand data (names, prices, photos, claims) comes from the owner at runtime — the values here are **placeholders**.

Proven end to end (offline fakes, real renderer + real fidelity pipeline) by `test/mcp-journey-content-agent.spec.ts`, with migration 085 applied **and** pending.

## 0. Rules of the road

- Never invent ids. Use the `brandId` / `kitId` / `offerId` / `productImageId` / `approvalRequestId` that tools return.
- Free tools (no credits, no approval): everything except `create_ads` / `adpack_start` / `adpack_regenerate` and the other `execute_*` tools.
- Paid tools answer first with `status: "approval_required"`. Show `userPrompt` to the user **as written** (neutral, no links). Only after the user says yes: `confirm_execute`, then repeat the same call with `approvalRequestId`.
- Drive links must be shared as **"Cualquier persona con el enlace" (lector)**. Files are copied into Advance storage; the Drive link is kept only as `sourceUrl`, so later permission changes never break the ads.

## 1. Brand (skip if `list_brands` already has it)

```json
{ "name": "create_brand", "arguments": {
  "name": "Marca Demo",
  "location": "San José, Costa Rica",
  "salesChannels": ["website", "messages"],
  "doesShipping": true
} }
```

Expected: `{ status: "created", brand: { brandId }, brandKit: { brandKitId, isPrimary: true } }`.
If the name already exists (accent/case/space-insensitive): `{ status: "exists", brand: { brandId } }` — use that id (nothing was created). `allowDuplicate: true` only if the owner really wants a second brand.

Fix brand fields later (0.14): `update_brand { brandId, name?, location?, salesChannels?, doesShipping?, shippingMethod?, icpDescription? }` — a placeholder (`"country"`) is never stored (`ignoredPlaceholders`), `null` clears a field, over-long text is an error (never cut). With several offers, pick the one tools use when `offerId` is omitted: `set_default_offer { brandId, offerId }` (`list_brands` reports it as `defaultOfferId`, resolution `set_default_offer`).

## 2. Brand kit

```json
{ "name": "update_brand_kit", "arguments": {
  "brandId": "<brandId>", "kitId": "<brandKitId>",
  "fonts": { "heading": "Space Grotesk", "body": "Inter" },
  "colors": { "primary": "#1E3A8A", "secondary": "#F8FAFC", "accent": "#F59E0B" },
  "locale": "es-CR", "register": "voseo",
  "brandVoice": "cercana, clara, sin exageraciones",
  "forbiddenPhrases": ["armado en minutos"],
  "audiences": [{ "label": "Familias con niños que juegan al aire libre", "ageMin": 30, "ageMax": 45, "geo": "Costa Rica" }]
} }
```

Placeholder values (`"country"`, `"todo el país"`, `"Personas 18–65"`, `"N/A"`…) are not stored and are listed in `ignoredPlaceholders`.

Fonts: Space Grotesk and **Inter** are bundled (OFL), so `{ heading: "Space Grotesk", body: "Inter" }` is drawn exactly; every finished ad reports `fontsUsed { heading, body, fallbacks[] }` (a brand font that had to be mapped, or glyphs drawn with Fira Sans, show up in `fallbacks`).

Style DNA (0.14): the kit's `styleDnaIds` selects which Style DNAs shape ads — `[]` = none (never an implicit `dna_1`), omitted/`null` = every kit Style DNA. `update_brand_kit` echoes `styleDnaIds` + `activeStyleDnaIds`. `detach_style_dna { brandKitId, styleDnaId }` stops one from shaping ads (kept on the kit); `delete_style_dna { brandKitId, styleDnaId, confirm: "<exact name>" }` removes it (in-chat approval). For one pack only: `create_ads { …, useStyleDna: false }`.

## 3. Logo (Drive / Dropbox / https)

```json
{ "name": "import_image", "arguments": {
  "brandId": "<brandId>", "kind": "logo",
  "url": "https://drive.google.com/file/d/<fileId>/view?usp=sharing"
} }
```

Expected: `{ status: "imported", target: "brand_kit", url, sourceUrl, logo: { cleanedUrl, method, backgroundRemoved, transparent, darkVariant } }`.
A logo on a solid (e.g. white) background is cleaned automatically (`backgroundRemoved: true`) and the transparent PNG becomes the kit logo — no box around it in the ads. `method: "as_is"` + warning = the background could not be separated: ask for a PNG with transparency.

## 4. Offer (product)

```json
{ "name": "create_offer", "arguments": {
  "brandId": "<brandId>",
  "name": "Avión RC Demo",
  "description": "Avión de papel con motor y control remoto",
  "price": { "amount": 14900, "currency": "CRC" },
  "bundles": [{ "qty": 2, "price": 26000, "label": "2 kits" }],
  "shipping": { "text": "Envío gratis desde 2 kits", "freeFromQty": 2 },
  "includes": ["Chasis con motor", "Control tipo gamepad"],
  "excludes": ["Papel no incluido"],
  "verifiedClaims": [{ "claim": "Envío gratis desde 2 kits", "source": "política de envíos" }],
  "forbiddenClaims": ["armado en minutos"],
  "ageMin": 8,
  "immutableAttributes": ["alas blancas", "chasis negro", "hélice blanca"],
  "allowedProps": ["caja del kit"],
  "lockProductAppearance": true,
  "locale": "es-CR"
} }
```

Expected: `{ status: "created", offer: { offerId, confirmedFacts: [...] }, adProfileSaved: true }` — `confirmedFacts` are the exact strings ads will use (`₡14.900`, `2 kits por ₡26.000`, `Envío gratis desde 2 kits`, `Edad 8+`).
Fix anything later with `update_offer { brandId, offerId, …only the fields to change }` (null clears a structured field).

**Migration 085 pending:** the answer has `adProfileSaved: false` + `migrationPending`. Name, description, price (→ `re_price`) and shipping text (→ `shipping_info`) are saved; the structured profile is not. Until 085 is applied, pass `immutableAttributes`, `allowedProps`, `forbiddenClaims` directly to `create_ads` (step 6).

## 5. Product photos with roles

```json
{ "name": "import_images", "arguments": {
  "brandId": "<brandId>", "offerId": "<offerId>",
  "items": [
    { "url": "https://drive.google.com/open?id=<heroId>", "kind": "product_photo", "role": "hero", "label": "avión" },
    { "url": "https://drive.google.com/uc?id=<partId>&export=download", "kind": "product_photo", "role": "part", "label": "control tipo gamepad" },
    { "url": "https://drive.usercontent.google.com/download?id=<boxId>&export=download", "kind": "product_photo", "role": "box", "label": "caja" }
  ]
} }
```

Roles: `hero` (the product; becomes the primary photo), `part` (a separate kit part), `box`, `contents` (everything in the kit), `in_use`, `detail`.
Expected: `{ status: "imported" | "partial", imported, failed, results: [{ status, productImageId, url, sourceUrl, role, tags, quality: { width, height, sharpness, backgroundClean, lowResolution, blurry, warnings }, roleStoredAs }] }`.

- Ads only show product parts that have a real photo; the real pixels of each photo are composited (never redrawn).
- `quality.warnings` (e.g. "baja resolución, se verá blanda", "foto borrosa", "fondo con ruido") → ask the owner for a better original; the sharpest photo is preferred automatically.
- Large Drive files (virus-scan page) are handled (`driveLargeFileConfirmed: true`).
- 085 pending: `roleStoredAs: "label"` (role kept as a `[part] …` label prefix) — roles still reach the ads.
- Labels up to 160 characters (longer = clear error, never cut). Audit the setup any time: `list_assets { brandId, offerId }` → per photo `role`, `partName`, `tags`, `isPrimary`, `quality`, `sourceUrl`, `label` (+ `kitAssets`: logo, variants, references, winners, documents).
- Direct uploads: `create_upload_url { brandId, offerId, kind: "product_photo", role: "hero"|"part"|…, label?, tags?, filename, contentType }` (`sizeBytes` optional, 0 = unknown) → PUT → `finalize_upload { uploadId }` returns the same `quality` report, `role`, `tags`, `isPrimary` and the label (given, else a clean name from the file). Rename later with `tag_product_image { productImageId, tags, label }`.

Optional: winners as style reference — `import_image { brandId, kind: "winner_ad", url }` → returns `styleDnaId: "winners"`; pass it to `create_ads` to make layouts follow the brand's winning ads (style only, never copied).

## 6. Make 2 ads, feed + story

```json
{ "name": "create_ads", "arguments": {
  "brandId": "<brandId>", "offerId": "<offerId>",
  "count": 2, "ratios": ["4:5", "9:16"]
} }
```

Expected first answer (nothing runs yet):

```json
{ "status": "approval_required", "approvalRequestId": "<id>",
  "approval": { "items": 2, "unitCost": 6, "total": 12, "currency": "credits", "expiresAt": "…", "summary": "2 anuncios estáticos — Avión RC Demo (Marca Demo) · formatos 4:5 + 9:16" },
  "userPrompt": "Confirmación requerida — Advance AI\nAcción: …\nCosto: 2 × 6 = 12 créditos\nVence: … UTC · un solo uso\nPara aprobar: sí. Para cancelar: no.",
  "quote": { … }, "gaps": [ … ], "notes": [ … ] }
```

Show `userPrompt` **and the per-ad `plan[]`** (0.14: `{ index, angleId, category, hookType, format, layoutFamily, rationale, photo: { productImageId, role, label, url }, ratios }` — the same deterministic plan the approved run follows; the photo is the planned pick, a blurry one is swapped for the next best at run time). Mention `gaps` (missing facts are simply not mentioned in the ads). The approval is valid **24 h**; calling `create_ads` again with the same arguments returns the same open approval (`reused: true`, and `approvalStatus: "approved"` once confirmed — then just retry with its `approvalRequestId`). When the user says yes:

```json
{ "name": "confirm_execute", "arguments": { "approvalRequestId": "<id>", "action": "approve" } }
{ "name": "create_ads", "arguments": { "brandId": "<brandId>", "offerId": "<offerId>", "count": 2, "ratios": ["4:5", "9:16"], "approvalRequestId": "<id>" } }
```

Expected (0.14): `{ status: "running", packStatus: "planned", moreWork: true, packId: "<id>", etaSeconds, pollAfterSeconds, creativeFreedom: "high", plan: [{ index, angleId, category, hookType, format, layoutFamily, rationale, photo, ratios }], statusMessage: "Advance está generando un pack de anuncios…" }` — work has begun; it is **not** finished. Never tell the user it is done until `adpack_status` says `moreWork: false`.
With only brandId + offerId, Advance picks angle, hook, scene and layout and says why (`rationale`). To steer: `angleIds` (from `adpack_angles` / `guide_bulk_angles`), `layoutFamily`, `styleDnaId`, `variations` (1–3), `brief` (theme only, never a fact).

## 7. Poll and deliver

```json
{ "name": "adpack_status", "arguments": { "packId": "<id>" } }
```

The pack advances **in the background without polling** (self-continuing slices; the minute cron also resumes a stalled pack). `adpack_status` is a cheap read (< 2 s, never runs generation inline): check again after `retryAfterSeconds` (10–30 s, from the ETA) until `moreWork: false` (or `get_execute_result { jobId: "<id>" }`, which returns the same pack status + deliverable and says `status: "running"` until the pack is terminal). Relay `summary` while it runs.

A failed ad is **retried automatically up to 2 times inside the same approval** (new copy for copy failures, a new plate / light for scene or fidelity failures) before it is reported; `attempts` / `attemptLog` say how many tries it took. Only delivered ads are charged.

Finished:

```json
{ "status": "done", "chargedCredits": 12,
  "deliverable": { "ads": [ {
    "index": 1, "angleId": "…", "category": "regalo", "hookType": "…", "layoutFamily": "…", "rationale": "…",
    "headline": "…", "caption": "…",
    "files": [
      { "ratio": "4:5", "url": "https://…/render-4x5-….png", "jpgUrl": "https://…/render-4x5-jpg-….jpg", "width": 1080, "height": 1350, "placement": "feed", "fidelity": { "score": 0.98, "passed": true, "method": "composite" } },
      { "ratio": "9:16", "url": "…png", "jpgUrl": "…jpg", "width": 1080, "height": 1920, "placement": "story", "fidelity": { "passed": true } }
    ],
    "forbiddenHits": [], "fidelity": { "passed": true } } ],
    "captionsText": "1. Anuncio 1 — …", "deepLink": "https://advanceai.studio/chat?brand=…&adpack=…" } }
```

Present each ad: headline, angle + rationale, PNG/JPG links per ratio, caption. URLs are stable public storage links (never expiring). Credits charged = the approved total (one ad of credits per finished ad; a failed ad is not charged). Another ratio later is free: `adpack_resize { packId, itemId, ratios: ["1:1"] }`. Fix text for free: `adpack_edit_text`.

## Common errors and fixes

| Error (`error.code`) | Meaning | Fix |
|---|---|---|
| `DRIVE_NOT_PUBLIC` ("el archivo de Drive no es público") | Drive answered with a sign-in / request-access page or 401/403/404 | Owner shares the file as "Cualquier persona con el enlace (lector)", then import again |
| `DRIVE_FOLDER` | A folder link was sent | Send each file's link (`import_images` takes up to 12) |
| `NOT_AN_IMAGE` | The link returns a web page / not PNG-JPEG-WebP (SVG only for logos) | Use the direct file link, or `create_upload_url` → PUT → `finalize_upload` |
| `UNSUPPORTED_IMAGE_TYPE` | HEIC/AVIF/GIF | Export as JPG/PNG |
| `TOO_LARGE` | > 15 MB (logos 5 MB) | Send a smaller export |
| `BAD_URL` | Not public http(s) (private IP, localhost, data: URL) | Use a public https link |
| `BAD_INPUT` `product_photo needs offerId (…offers…)` | The brand has several offers | Pass `offerId` (the message lists them) |
| `BAD_INPUT` `brandId must be a UUID` | An invented / name-based id | Use ids returned by `list_brands` / `create_brand` |
| `status: "exists"` on `create_brand` | Same brand name already exists | Use the returned `brandId` |
| `migrationPending: "085_…"` | Structured offer/kit fields not stored yet | Pass `immutableAttributes` / `allowedProps` / `forbiddenClaims` to `create_ads`; re-run `update_offer` after 085 is applied |
| `PLAN_CHANGED` (`status: "plan_changed"`) | The plan differs from what was approved (count or credits) — nothing ran, nothing charged | Show approved vs planned and ask again (call without `approvalRequestId`) |
| `INSUFFICIENT_CREDITS` | Not enough credits for the quoted total | Top up, or fewer ads |
| `failures[]` in `adpack_status` | An ad failed even after 2 automatic retries (`attempts: 3`, `attemptLog`) — not charged | Explain `reason`; offer `failures[].retry.call` (paid, needs approval) |
| `reused: true` on an approval | Same arguments as an open approval (24 h) | Do not ask twice: if `approvalStatus: "approved"`, retry with its `approvalRequestId` |
| `BAD_INPUT` `… is N characters; the maximum is …` | Text over a limit (labels 160, props 160, technical specs 2000) — nothing was cut | Shorten it and send again |
| `truncated: [{ field, from, to }]` (adpack_from_brand) | A saved value is longer than the ads use | Shorten the saved field if the cut part matters |
| `forbiddenHits` non-empty | A forbidden phrase reached the copy | Do not publish; fix with `adpack_edit_text` |
