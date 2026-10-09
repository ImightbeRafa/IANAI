# Advance MCP for Grok bot (`advanceai.studio`)

Primary client: **Grok Custom Connector** → `https://advanceai.studio/api/mcp`

## Locked decisions
| Topic | Decision |
|---|---|
| Modes | GUIDE = free (Grok’s own usage); EXECUTE = Advance credits |
| Approval | **In-chat** via `confirm_execute` (show `userPrompt`, user says sí/no). Optional fallback `/mcp/approve/:id`. **TTL = 1 hour**; single-use; input-bound; result replay after consume |
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

**Offers + photos (sync write, no credits, 0.11):** `create_offer`, `update_offer`, `set_primary_product_image`, `tag_product_image`, `create_upload_url` → PUT → `finalize_upload`.

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

**Workspace sync (no credits):** `workspace_save_url_context`, `workspace_ingest_file`, `workspace_note_generated_outside`, `workspace_import_asset`, `workspace_save_artifact` (`kind=product|context` + https URL for product-shot ingest)

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
- Registry: `api/lib/mcp/tool-registry.ts` (0.11.0)
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
- Save via `workspace_save_url_context` → `mcp_url_intakes.status=pending_analysis`
- Cron `* * * * *` → `GET/POST /api/mcp-guide-analysis` (Bearer `CRON_SECRET`)
- Worker claims one row, runs shared site analyzer, fill-only merges into `businesses` + `brand_kits`
- `get_brand_context` returns richer kit + `latestGuideIntake`
- Deep link: `/chat?brand=<id>&intake=<id>`
- No Advance credits
