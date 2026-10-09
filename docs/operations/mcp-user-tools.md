# Advance MCP for Grok bot (`advanceai.studio`)

Primary client: **Grok Custom Connector** → `https://advanceai.studio/api/mcp`

## Locked decisions
| Topic | Decision |
|---|---|
| Modes | GUIDE = free (Grok’s own usage); EXECUTE = Advance credits |
| Approval | **In-chat** via `confirm_execute` (show `userPrompt`, user says sí/no). Neutral, structured payload `approval {items, unitCost, total, currency, expiresAt, summary}` — no persona, no web link (web fallback `/mcp/approve/:id` only when a caller passes `includeWebFallback`). **TTL = 1 hour**; single-use; input-bound; result replay after consume. **Plan guard (F1):** the approved plan is re-checked before running; any change in count or credits → `PLAN_CHANGED {approved, planned}`, nothing runs, approval retired |
| Intake | HTTPS URL + up to **5** PDF/image files → Chat upload dialog via `?intake=files\|asset` |
| External Grok images | Not imported; session `generated_outside` only |
| Advance images | Auto-saved to session/library at max API quality (`2k`/`medium`) |
| Brand delete | Delete everything under brand; **keep brand kits** (detach; delete kits separately) |
| Archive | Supported for folders |
| Social post | **No** |

## Live endpoints (this branch)
| URL | Role |
|---|---|
| `POST /api/mcp` | MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`) |
| `GET /api/mcp` | Health / discovery blurb |
| `GET/POST /api/mcp-approve` | Load / approve / deny EXECUTE requests (Bearer Supabase JWT) |
| `/mcp/approve/:id` | Optional Advance web consent fallback (prefer in-chat `confirm_execute`) |
| `GET /.well-known/oauth-protected-resource` | OAuth PRM → `/api/mcp-oauth-metadata` (AS = Supabase `/auth/v1`) |
| `/oauth/consent` | Advance consent UI (Supabase OAuth Server path) |

Auth: `Authorization: Bearer <Supabase user access token>`.  
401 responses include `WWW-Authenticate: Bearer resource_metadata="https://advanceai.studio/.well-known/oauth-protected-resource"`.

Enabled tools now:

**Reads:** `list_brands` (default hides `kitReady:false`; `includeIncomplete:true` for full list — always select by `brandId`), `get_brand_context` (optional `brandKitId`), `list_offers`, `list_assets`, **`list_scripts`** (full `content`), `list_brand_kits`, `get_brand_kit` (`kitId` **or** `brandId` → primary kit)

**Brand kits (sync write, no credits):** `create_brand_kit`, `update_brand_kit` (every kit field — see 0.11 below), `set_primary_brand_kit`, `link_brand_kit` (PatchHouse / explicit `business_id`; no cross-brand moves). `delete_brand_kit` requires typed name + in-chat `confirm_execute`.

**Brands (sync write, no credits, 0.13–0.14):** `create_brand` (+ primary kit), `update_brand`, `set_default_offer`, `import_image` / `import_images` (Drive/Dropbox/https → Advance storage, roles, quality, logo cleanup), `detach_style_dna` / `delete_style_dna`.

**Offers + photos (sync write, no credits, 0.11):** `create_offer`, `update_offer`, `set_primary_product_image`, `tag_product_image`, `create_upload_url` → PUT → `finalize_upload`.

### 0.14.0 — real-test fixes (packs without polling, plan before paying, Style DNA control)

Registry / server version **0.14.0**. **No migration** (085 columns only). Proofs: `test/adpack/background.spec.ts`, `test/adpack/approval-plan.spec.ts`, `test/mcp-tools-v014.spec.ts` (+ updated door / journey tests).

- **#13** `create_ads` / `adpack_start` answer `status: "running"` + `packId`, `etaSeconds`, `pollAfterSeconds` once work begins; never "completed" (or "Advance terminó …") until the pack is terminal. Replays and `get_execute_result` report the live state.
- **#14** Root cause of "only advances while polling" + `-32001`: a 50 s background slice ended and nothing resumed the pack until the next poll, and that poll advanced **inline** (a model step overran the 8 s budget). Now `kickPackAdvance` schedules self-continuing, bounded (30 slices), lease-safe slices through the existing scheduler (`waitUntil`, process-wide in the CF container via `server.mjs`); `adpack_status` / web `status` are cheap reads that at most kick a loop when nobody holds a lease (`retryAfterSeconds`, `etaSeconds`, `backgroundKicked`); the existing minute cron (`/api/mcp-guide-analysis`, `ENABLE_CRONS`) also sweeps stale unleased packs (≤ 3 per tick). Charges stay idempotent per item.
- **#15** `adpack_preview`, `adpack_quote` / the approval and the run share ONE planner (`prepareRun`): `plan[]` per ad (angle, rationale, layoutFamily, planned photo incl. the guaranteed hero — `photo.source` per_ad | hero | pool —, format after handheld substitution, ratios) + `planHash`. The approval is bound to the arguments (incl. `previewId`) and `planHash`; Ad Pack approvals last 24 h (`ADPACK_APPROVAL_TTL_HOURS`); identical arguments + price + plan reuse the open approval (`reused`, `approvalStatus`); an approved call whose plan changed answers `plan_changed` (`reason: "plan_changed"`) and runs nothing.
- **#16** Failed ads retry automatically up to 2× inside the approval, after the copy stage's 2 free repair rounds (copy: new copy with another hook and the checker's reason; fully rejected scene/fidelity/render: re-plate with another setting + light). A single failing ratio never uses an item retry: AI relight → deterministic fallback → one re-plate at that ratio → `rejectedRatios` (ad delivered with ≥ 1 ratio). `attempts` / `attemptLog` reported; credits only for delivered ads.
- **Ratio regenerate** `adpack_regenerate { packId, itemId, ratio }` (free) runs in the background: `status: "running"` + `pollAfterSeconds`; `adpack_status` lists `regenerating[]` until the new file lands (`BUSY` on a second request meanwhile). Proof: `test/adpack/merge-coherence.spec.ts`.
- **#9** Inter (OFL) bundled; `fontsUsed { heading, body, fallbacks[] }` per item / deliverable ad.
- **#12** `useStyleDna: false` (create_ads / adpack_start / adpack_from_brand / quote); kit `styleDnaIds: []` = none (no implicit `dna_1` notes); new `detach_style_dna` (free) and `delete_style_dna` (typed name + approval); kit views echo `styleDnaIds` / `activeStyleDnaIds`.
- **#18** `create_upload_url.role` = import_image enum (+ `variant`, `label`, `tags`, `setPrimary`; `sizeBytes` optional/0); `finalize_upload` returns the quality report, tags, primary, clean label; `tag_product_image { label }`.
- **#19** Labels / props 160, summaries 200, technicalSpecs 2000; over-limit input = clear `BAD_INPUT`, shortened derived values = `truncated[{field, from, to}]`; stored filenames shortened in the middle.
- **#20** `list_assets` returns `role`, `partName`, `tags`, `isPrimary`, `quality`, `sourceUrl`, `label` (+ `kitAssets`).
- **#22** `update_brand` (placeholder guard), `set_default_offer` (primary kit `brand_profile.defaultOfferId`, used when `offerId` is omitted; `list_brands` honors it); DNA audiences de-duplicated (max 3).

### 0.13.0 — a brand entirely via MCP (Content agent journey)

Registry / server version **0.13.0**. **No migration** (works with 085 applied or pending). Step-by-step call sequence: [`content-agent-runbook.md`](./content-agent-runbook.md). Proof: `test/mcp-journey-content-agent.spec.ts` (MCP entry only; real renderer + fidelity; 085 applied and pending).

| Tool / change | Inputs | Notes |
|---|---|---|
| `create_brand` (new) | `name`, `location?`, `salesChannels?` (website\|messages\|physical), `doesShipping?`, `shippingMethod?`, `icpDescription?`, `createKit?` (default true), `kit?` {update_brand_kit fields}, `allowDuplicate?` | Same `businesses` columns as the web brand form + primary kit in one call. A non-archived brand with the same normalized name is returned as `status: "exists"` (nothing created). |
| `import_image` / `import_images` (new) | `brandId`, `offerId?`, `url`, `kind` product_photo\|logo\|reference_ad\|winner_ad, `role?` hero\|part\|box\|contents\|in_use\|detail, `label?`, `variant?` (logo), `setPrimary?`; batch `items[]` ≤ 12 | Google Drive (every share shape incl. `drive.usercontent…`, large-file virus-scan confirm form, legacy confirm/cookie), Dropbox (`dl=1`), any public https. HTML from Drive → `DRIVE_NOT_PUBLIC`; folders/Docs/HEIC/GIF/oversize → coded errors. Magic-byte check, streaming size cap, `assertPublicHttpUrl` (+ DNS per redirect in prod). Bytes copied to `post-images/<userId>/uploads/…`; link kept as `sourceUrl` (`source_url` with 085). Product photo → `product_images` with 085 `tags`/`role`/`quality`/`source_url` (hero → `is_primary`); 085 pending → role as `[role] label` prefix parsed by the pack. Returns the C4 quality report. Logo → background removed (color key / alpha / SVG), cleaned transparent PNG set as kit logo, report returned. reference_ad + offerId → offer `context` image; winner_ad → kit winners + the `winners` Style DNA (`styleDnaId` for create_ads). |
| Rehost (C2) | — | `createRehoster` (kit logo/reference URLs, `workspace_save_artifact`) now uses the same downloader (Drive confirm, not-public detection). |
| Ad Pack | — | Every render also gets a full-res **`jpgUrl`** (q92, same pixels) next to the PNG `url`: `adpack_status` items/deliverable files, `adpack_resize`. `get_execute_result { jobId: packId }` returns the live pack status + deliverable. `immutableAttributes` now also reach the exact-mode plate prompt, plate (props) check and relight prompt, and the generated-mode scene prompt (plus "only the parts in the photos"). |
| Approvals (F2) | — | Unchanged builder; new `test/mcp-approval-neutral.spec.ts` scans every MCP module (no persona, no hand-rolled `approval_required`, no web fallback) and checks the builder for every approval tool. |

### 0.12.0 — ad-pack premium merge (WS1 exact fidelity × WS3 creative system)

Registry / server version **0.12.0**. No migration.

- `adpack_start` / `adpack_quote` / `create_ads` (pack/single): `angleIds` (adpack_angles board ids, catalog ids `<category>-<hookType>-<format>` from guide_bulk_angles `adpackAngleId`, legacy `aNN-…`), `angles` (guide adpackAngle objects), `variations` 1–3, `creativeFreedom`, `layoutFamily` (7 families), `styleDnaId`. One resolver: quote = ads × variations (relight — `auto` deterministic or `ai` — is included and free); the approval stores it; start recomputes and answers `PLAN_CHANGED` on any difference; unusable ids → `BAD_INPUT` `rejectedAngles` before approval.
- Every layout family runs in exact mode: the composite's placement of the real cut-out is the product box all families keep copy off (generated mode: the vision-check bbox). Brand fonts (kit font URL → bundled → disk cache → Google Fonts → GitHub; `ADPACK_FONT_FETCH=0` disables network) and WS1 logo variants on every family.
- Status / deliverable per ad: WS4 fields (files[], forbiddenHits, failures) + WS1 fidelity + `angleId`, `category`, `hookType`, `rationale`, `layoutFamily`, `variation`. `adpack_resize` keeps the item's layout family and brand fonts.

### 0.11.0 — premium round (owner feedback 2026-10-08: B1–B5, C1–C3, A2 data model, H7, G2)

Registry / server version **0.11.0**. Migration **`085_offer_profile_brand_profile_images.sql`** (additive, re-runnable; applied by the operator). Every tool works before 085 is applied and says what is pending.

| Tool / change | Inputs | Notes |
|---|---|---|
| `create_offer` / `update_offer` (B1) | `brandId`, (`offerId`), `name`, `type`, form fields (`description`, `differentiation`, `keyObjection`, `guarantee`, `mainProblem`, `realPain`, `expectedResult`, `result`, `bestCustomers`, `targetAudience`, `purchaseReason`, `shippingInfo`, `technicalSpecs`, `utility`, `offerText`, `callToAction`, `productCategory`) + structured `price {amount, currency CRC\|USD}`, `compareAtPrice`, `bundles [{qty, price, label}]`, `shipping {text, freeFromQty?, freeFromAmount?}`, `includes[]`, `excludes[]`, `allowedClaims[]`, `forbiddenClaims[]`, `verifiedClaims [{claim, source}]`, `cta {text, channels web\|whatsapp\|dm}`, `ageMin`, `immutableAttributes[]`, `lockProductAppearance`, `allowedProps[]`, `locale` | `products` row + `products.ad_profile`. Strict validation (numbers only, CRC whole colones, USD ≤ 2 decimals, lengths). Price mirrored into `re_price` and shipping text into `shipping_info` (web form + pre-085). Returns `confirmedFacts` = exact strings ads will use. Before 085: classic fields saved, `adProfileSaved:false`, `migrationPending`. |
| `update_brand_kit` / `create_brand_kit` (B3) | classic fields + `fonts {heading, body}`, `colors {primary, secondary, accent}` (hex), `audiences [{label, ageMin, ageMax, geo}]`, `locale`, `register` (voseo\|tuteo\|usted, hard rule), `do[]`, `dont[]`, `logoVariants [{url, variant}]`, `styleDnaIds[]` | New fields in `brand_kits.brand_profile`. **Placeholder guard** (`api/lib/placeholder-guard.ts`): "country", "todo el país", "Personas 18–65", "N/A", "TBD", "[…]", lorem, single generic words are never stored (scalar → cleared to null; list item → dropped) and reported in `ignoredPlaceholders`. The DNA builder ignores them on read too (so "Hecho para country" cannot reach an ad). |
| `set_primary_brand_kit` (B4) | `brandId`, `brandKitId` | Clears other primaries, links an unlinked kit, never moves a kit across brands. |
| `list_brands` (B4) | `includeIncomplete?`, `includeArchived?` | Adds `possibleDuplicates` (normalized-name groups + which one to keep). Never merges. Archived brands hidden by default. |
| `archive_brand` (B4) | unchanged (typed name + `confirm_execute`) | Sets `businesses.archived_at` (085) and keeps the `mcp_workspace_notes` marker (pre-085 fallback + backfill source). |
| `create_upload_url` / `finalize_upload` (C1) | `brandId`, `offerId?`, `kind` product_photo\|logo\|reference_ad\|winner_ad\|document, `role?`, `filename`, `contentType`, `sizeBytes?` → `uploadId` | Signed PUT URL in `post-images` at `<userId>/uploads/<uuid>-<safe-filename>` (2 h). Finalize checks existence, size (15 MB images, 5 MB logos, 20 MB PDF) and type, then creates a `product_images` row (product photo, `role`) or a kit asset (logo/variant, reference ad, winner ad, document). Idempotent. Upload intent = `mcp_workspace_notes` kind `mcp_upload` (no migration needed). |
| Rehost (C2) | — | `workspace_save_artifact` (product/context/image) and kit `logoUrl` / `referenceImageUrls` / `logoVariants` copy external links (Drive share links converted) into Advance storage via `assertPublicHttpUrl` + DNS check, 15 MB / 15 s caps, PNG/JPEG/WebP magic bytes. Original kept as `sourceUrl` (`product_images.source_url` after 085). On failure the original link is kept with a warning. |
| `set_primary_product_image` / `tag_product_image` (C3) | `offerId`, `productImageId` / `productImageId`, `tags` hero\|contenido-kit\|caja\|en-uso\|detalle\|part, `role?` | `product_images.is_primary/tags/role` (085; before it: `MIGRATION_PENDING`). Photo order everywhere (packs, bulk refs): primary → hero tag → sharper (`quality.sharpness`, filled by the quality workstream) → newest. |
| Ad Pack (C3, G2, B2) | `productImageIds` (pool, first = hero), `productImageIdsByAd {"1": [id]}`, `includeDna`, `saveToOffer` + `offerPatch`, `saveToBrandKit` + `brandKitPatch` | All adpack tools take `brandId/offerId`; `adpack_from_brand` returns `dnaSummary` unless `includeDna:true`. Corrections are written with the same owner-scoped writers as `update_offer` / `update_brand_kit` (on the first `adpack_start` call; bound to the approval) and reported in `saved`. Bulk/campaign accept `productImageIds` as alias of `productImageId` + `referenceImageIds`. |
| Verified claims (B5, H7) | offer `verifiedClaims`, `excludes`, `forbiddenClaims`, `ageMin`, price/bundles/shipping | Confirmed facts with exact strings (`₡14.900`, `2 kits por ₡29.800`, `Envío gratis desde 2 kits`, `Edad 8+`). `forbiddenClaims` → forbidden phrases; `excludes` → negative facts (copy saying "incluye papel" is rejected). With a verified-claims bank, every claim-like sentence must contain a confirmed fact verbatim (`untraceable_claim`); without one, previous behaviour. |

Web parity: `POST /api/ad-pack` (`angles`, `quote`, `dna_from_brand`, `start`) accepts the same `productImageIds` / `productImageIdsByAd`. Offer/kit CRUD and uploads are MCP-only (the studio keeps using the web forms, which write the same rows).

**GUIDE (no Advance credits):** `guide_script`, `guide_image` (clarify board for product/scene refs — do not quote EXECUTE until confirmed), `guide_brand_pack`, `guide_bulk_angles`

**Workspace sync (no credits):** `workspace_save_url_context` (analyzes inline ≤ ~25 s, no cron needed; else `jobId` → `workspace_url_context_status` / `get_execute_result`), `workspace_url_context_status`, `workspace_ingest_file`, `workspace_note_generated_outside`, `workspace_import_asset`, `workspace_save_artifact` (`kind=product|context` + https URL for product-shot ingest)

**EXECUTE (credits + in-chat approval):** `confirm_execute`, `get_execute_result`, `execute_script_generate`, `execute_image_generate`, `execute_bulk_scripts`, `execute_bulk_posts`, `execute_campaign_pack`, edit/enhance/carousel — first call returns `status: approval_required` with `userPrompt` (Grok shows this in chat; do **not** lead with a raw URL). After the user says yes, call `confirm_execute` then retry with `approvalRequestId`. **Script/image/bulk/carousel EXECUTE** return `status: running` + `jobId` immediately (background `waitUntil`); poll `get_execute_result` until `completed` (script text / `imageUrl` / slides). **Campaign packs** also schedule chunks off-request: poll is cheap (seconds) with `script N/total` / `image N/total` + partial scripts/posts; generate runs in `waitUntil` + CAS. Stale leases reclaim up to 3 times then terminal-fail. Image/post/pack/carousel **require confirmed product refs** (`productImageId` / `referenceImageIds`) unless `referenceMode:"none"`. Grok `aspectRatio` is fail-closed (no silent `4:5`→`3:4`; opt-in `aspectRatioFallback`). Bulk scripts return full `content`. Carousel returns per-slide `headline`/`body`/`copy` + `imageUrl`; preview binds billed slide count. Same `approvalRequestId` and stable per-artifact generation UUIDs prevent double charge. `chargedCredits` is always a number. **MCP caps:** bulk `count` ≤ 10; carousel `slideCount` ≤ 5. Host `maxDuration` for `/api/mcp` is **180s**. Registry **0.9.4**.

**Product lock:** When `execute_image_generate` / `execute_bulk_posts` (and shared web bulk) receive a confirmed product photo (`productImageId` or kind=product ref), first-gen uses Grok `/images/edits` with the website **PRODUCT LOCK** contract — the SKU must not be redrawn, reshaped, or relabeled. Without a product ref (`referenceMode:"none"` or context/logo only), first-gen stays `/images/generations` compose. Bulk does **not** invent or expand product photos; kit/offer uploads are the only SKU refs.

**Style DNA:** `list_style_dnas`, `set_style_dna` — JSON on `brand_kits.style_dnas` (`organic` | `ads`). Bulk posts accept `styleDnaId`.

**Admin (JWT admin only):** compact `admin_list_tickets` / `admin_get_ticket` / `admin_update_ticket` / `admin_get_usage` / `admin_request_cursor_fix` (scrubbed brief; Cursor is never auto-called).

Every `tools/call` is audited via `auditMcpToolCall` (`source=mcp`, lane from tool risk).

Registry / server version: **0.9.4**.

ChatShell shares the same libs via `POST /api/bulk-angles`, `/api/bulk-scripts`, `/api/bulk-posts`, `/api/bulk-campaign`.

### Chat-shell parity ladder (Grok must mirror)
1. Script clarify → GENERATE with full offer facts + brand voice (exact price e.g. ₡9.900; no `[PRECIO EXACTO]` / enum leaks)
2. Optional hook/enhance edits
3. Post: pick script → confirm product + scene/style refs → style/aspect/density → GENERATE
4. Credit `confirm_execute` is **in addition to** product confirms — never instead of them

**Style DNA:** `list_style_dnas`, `set_style_dna` — JSON on `brand_kits.style_dnas` (`organic` | `ads`). Bulk posts accept `styleDnaId`.

**Admin (JWT admin only):** compact `admin_list_tickets` / `admin_get_ticket` / `admin_update_ticket` / `admin_get_usage` / `admin_request_cursor_fix` (scrubbed brief; Cursor is never auto-called).

Every `tools/call` is audited via `auditMcpToolCall` (`source=mcp`, lane from tool risk).

Registry / server version: **0.9.0**.

ChatShell shares the same libs via `POST /api/bulk-angles`, `/api/bulk-scripts`, `/api/bulk-posts`, `/api/bulk-campaign`.

## Ads: one entry point, exact plans, verified copy (2026-10 premium fixes)

Source: owner test 2026-10-08 (`advance-mcp-limitaciones-premium`), items F1, F2, E1–E3, G1, G3, G4, H6.

### Decision table (also in the tool descriptions)
| Need | Tool | Product fidelity | Ratios | Style | Credits |
|---|---|---|---|---|---|
| N static ads (`create_ads mode:"pack"`) | `adpack_start` | Real product photo as scene reference + product check with retries (not pixel-exact; see A1) | **4:5 + 9:16 default**, 1:1 on request or free `adpack_resize` | Brand kit colors/fonts/logo/voice; text rendered exactly | 6 / finished ad |
| 1 static ad (`mode:"single"`) | `adpack_start {size:1}` | same | same | same | 6 |
| Carousel (`mode:"carousel"`) | `execute_carousel_generate` | product refs | one of 1:1/4:5/9:16/3:4 | `designDirection` = brief | 24 / slide |
| Edit an image (`mode:"edit"`) | `execute_image_edit` | edits the given image | one ratio | — | 18 |
| Free-form image | `execute_image_generate` | product lock via refs | 1:1/9:16/16:9 (4:5 needs `aspectRatioFallback`) | `guidePrompt` | 6 / 24 by model |
| Angle-board posts / scripts | `execute_bulk_posts`, `execute_campaign_pack`, `execute_bulk_scripts` | product refs | `aspectRatio` | `styleDnaId` | per item |

`create_ads {brandId, offerId?, mode, count?, ratios?, brief?, angleIds?, locale?, register?, forbiddenPhrases?, forbiddenClaims?, productImageIds?, productImageIdsByAd?, saveToOffer?+offerPatch?, saveToBrandKit?+brandKitPatch?, includeDna?, scriptId?/scriptContent?, editPrompt?, productImageId?/imageUrl?, approvalRequestId?}` only routes (`api/lib/mcp/create-ads.ts`): the approval is issued under the routed tool and the create_ads retry maps to identical arguments, so idempotency and credits are the routed tool's. Responses add `via:"create_ads"`, `mode`, `routedTo`. Old tools keep working; overlapping ones say "Prefer create_ads".

### F1 — approved quantity and cost are what runs
- Root cause of "2 approved for 12, got 1 for 6": the approval quoted `size` ignoring `angleIds`, and start filtered a re-plan of only `size` angles by ids taken from a bigger board (ids are index-based; `a05` does not exist in a 2-angle plan) → silent shrink.
- Now `resolvePackAngles` (plan-angles.ts) is the single resolver behind quote, approval and start: no `angleIds` → exactly `size` angles (the planner fills with diversified angles when hook×format pairs run out; impossible → `BAD_INPUT reason:infeasible` at quote time); `angleIds` → resolved against the full board (prefix-stable), unknown ids → `BAD_INPUT reason:unknown_angle_ids` before any approval.
- The approval stores the plan total (`quotedCreditCost`; items = total / unitCost). On retry the plan is recomputed; mismatch → `{status:"plan_changed", code:"PLAN_CHANGED", approved, planned}`; the approval is denied so it can never run the other plan. Web `start` accepts `approved {items,total}` → 409 `PLAN_CHANGED`.
- Bulk scripts/posts/campaign: `count` defaults to the number of selected `angleIds`; selected ids are never swapped for others; a smaller board → stored failed result `code:"PLAN_CHANGED"` (nothing generated, nothing charged).

### E1–E3 — copy rules
- **E1** `adpack_edit_text` rejection = `{status:"rejected", code:"COPY_REJECTED", issues:[{field:"bullets[2]", baseField, rule:"too_long", limit, actual, token?, detail}]}` (web 422 body has the same `issues`). Owner edits get chips up to 6 content words / 34 chars; step labels `01/02/03` (and a leading number equal to the chip position) are structure, not facts; an owner offer line passes when every part is a confirmed fact or a stated exclusion ("Kit ₡14.900 · Papel no incluido"); exclusions stated in the facts never count as claims.
- **E2** `forbiddenPhrases` (kit) + `forbiddenClaims` (request) are checked on image text, caption, script and scene brief; generation repairs once, else the ad fails (not charged, reason "frase prohibida"). Status items and `deliverable.ads[]` carry `forbiddenHits [{phrase, field}]` (verified empty for shipped ads).
- **E3** `locale` (e.g. `es-CR`, normalized; CR/AR/UY/… default to voseo) makes the register a hard rule: other-register forms (`tienes`, `pídelo`, sentence-initial `Descubre`, `usted`…) are `locale_register` issues — blocking, repaired once; the prompt states "REGLA DURA". Without a locale, register drift stays a soft note.

### G4 + H6 — downloads and formats
- Default ratios for adpack / create_ads: `["4:5","9:16"]` (feed + story). `deliverable.ads[].files[] = {ratio, url, width, height, format:"png", placement:"feed"|"story"|"square"}`; URLs are public storage URLs (never signed/expiring). Running rows carry `renders[] {ratio, imageUrl, width, height, format}`.
- `adpack_resize {packId, itemId, ratios}` (web `action:"resize"`): FREE — re-renders the stored scene + copy into new ratios (renderer only: no model, no credits, no approval); new renders go to the offer library.

### G3 — URL context without the cron
`workspace_save_url_context` inserts the intake and runs the analysis inline (`MCP_URL_INLINE_BUDGET_MS` = 25 s). Done → `ready` (analysis) / `failed`. Over budget → `processing` + `jobId` (work kept alive with `waitUntil`); `workspace_url_context_status {intakeId}` or `get_execute_result {jobId}` resolve it and re-run a pending / stale-lease intake inline (owner-scoped CAS claim by id, same lease guards as the cron). `wait:false` keeps the old queue-only behaviour. Cron config is unchanged.

### Migration needs (not applied here)
- None required. Optional later: `brand_kits.locale` + `brand_kits.forbidden_claims` to persist E2/E3 per brand (today they are per request / per pack via `pack.dna`).

## Operator step (required for Grok OAuth)
In **Supabase Dashboard → Authentication → OAuth Server** (AIIAN `lstzfxsdmggkoaxfawny`):
1. Enable OAuth 2.1 Server
2. Set authorization path to `/oauth/consent`
3. Enable Dynamic Client Registration
4. Site URL / redirect allowlist includes `https://advanceai.studio` and `/oauth/consent`

Without this, Custom Connector OAuth discovery fails (`feature_disabled`).

### Vercel env (Preview + Production)
PRM reads `SUPABASE_URL` / `VITE_SUPABASE_URL` at runtime. Both Preview and Production must point at **AIIAN** (`lstzfxsdmggkoaxfawny`), not the old IANAI-preview project. After changing env vars, redeploy.

Authorize always redirects to the Supabase **Site URL** (`https://advanceai.studio/oauth/consent`), so full Grok OAuth needs this branch **deployed to Production**. Preview can smoke PRM / MCP / consent SPA only.

## Code map
- Host: `api/mcp.ts`, `api/lib/mcp/protocol.ts`
- Registry: `api/lib/mcp/tool-registry.ts` (0.14.0)
- Offers / photos / uploads: `api/lib/mcp/offer-tools.ts`, `api/lib/mcp/upload-tools.ts`, `api/lib/mcp/asset-rehost.ts`, `api/lib/adpack/offer-profile.ts`, `api/lib/brand-profile.ts`, `api/lib/placeholder-guard.ts`, `api/lib/product-image-order.ts`, migration `085`
- Brand kits: `api/lib/mcp/brand-kit-tools.ts`, `api/lib/brand-kit-resolve.ts`, migration `081`
- Audit: `api/lib/mcp/tool-audit.ts`; MCP caps: `api/lib/mcp/limits.ts`
- Approval: `api/lib/mcp/approval.ts`, `api/lib/mcp/approval-store.ts`, `api/mcp-approve.ts`, `src/pages/McpApprove.tsx` + migrations `070`, `073`
- Workspace notes: `api/lib/mcp/workspace-ops.ts` + migration `074`
- GUIDE packs: `api/lib/mcp/guide-packs.ts`
- EXECUTE: `api/lib/mcp/execute-tools.ts`, `api/lib/grok-image-generate.ts`, `api/lib/mcp/artifact-store.ts`
- Chat intake UX: `src/features/chat-shell/ChatShellMcpIntakeDialog.tsx`, `chatShellMcpIntake.ts`
- Migration `075_mcp_e2e_intake_autosave.sql` (approval result_json + note updates)
- URL intake: `api/lib/mcp/url-intake.ts` + migration `071_mcp_url_intakes.sql`
- Intake validation: `api/lib/mcp/guide-intake.ts`
- Brand delete contract: `api/lib/mcp/brand-delete.ts` (+ web cascade detaches kits)
- Consent UI: `src/pages/OAuthConsent.tsx`

## Next
1. Confirm Production `CRON_SECRET` + `GEMINI_API_KEY` (required for URL analysis worker)
2. Carousel / edit / enhance EXECUTE tools (deferred)
3. Deletes / archive / admin tools (deferred)

## GUIDE URL analysis worker
- Save via `workspace_save_url_context` → `mcp_url_intakes.status=pending_analysis`, then analyzed inline (G3 above); the cron below is optional catch-up
- Cron `* * * * *` → `GET/POST /api/mcp-guide-analysis` (Bearer `CRON_SECRET`)
- Worker claims one row, runs shared site analyzer, fill-only merges into `businesses` + `brand_kits`
- `get_brand_context` returns richer kit + `latestGuideIntake`
- Deep link: `/chat?brand=<id>&intake=<id>`
- No Advance credits
