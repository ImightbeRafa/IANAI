# Advance MCP for Content bot — plan, gap list, acceptance-test matrix

**Status:** PLAN ONLY. No production code in this PR. Implementation is locked to Grok 4.6 (Cursor cloud executor) after Rafael GO. Sol / Codex are not to be used on this work.
**Date:** 2026-09-17 · **Advisor:** Fable 5.1 · **Baseline audited:** `master` @ `6dcea3f` (registry / server `0.9.5`)
**Inputs:** `advance-mcp-upgrade-plan-2026-09-16.md`, PatchHouse `content-readiness.md`, `docs/operations/mcp-user-tools.md`, `api/lib/mcp/*`, `api/generate-image.ts`, `api/lib/bulk/*`, `src/features/chat-shell/*`.

## 0. Executive summary

The 09-16 plan assumed the Advance MCP was "parked / flaky, tools=0". That is only the **client** state (Grok connector `needsAuth`). The **server** already ships a 0.9.5 MCP at `POST /api/mcp` with 40+ tools: brand kit CRUD, asset listing, product/context ingest by URL, script / image / bulk / campaign EXECUTE with in-chat approval, async jobs, JPEG-only artifacts, audit, and tenant scoping by Supabase JWT.

Two things block the Content bot from producing PatchHouse Story 9:16 posts "the way the website does":

1. **P0 (ops, no code):** re-authenticate the connector. Everything in §4 A-series is testable the moment a valid Bearer token exists.
2. **P2 (code, Grok 4.6):** `execute_image_generate` and `execute_bulk_posts` do **not** run the website's product pixel-lock path. The web post path routes product refs to Grok `/images/edits` (`product_lock_scene`) with the `PRODUCT LOCK` contract and the script copy as the only visible text; the MCP/bulk path calls `/images/generations` with a thin "lifestyle ad still" prompt and no lock. Runtime probe (vitest, fetch mocked) on `master`:

   ```
   PROBE endpoint used by MCP path: https://api.x.ai/v1/images/generations
   PROBE pixel-lock language present: false
   PROBE aspect_ratio sent: 9:16 resolution: 2k quality: medium
   ```

   This is exactly the failure mode the 2026-08-30 changelog entry ("Product pixel-lock scene (PR #33)") fixed for the web: `/generations` "soft-references the packshot → Grok redraws/manipulates the SKU". The MCP never got that fix. **Until P2 lands, MCP-generated posts violate the existing Advance product lock and must not be used for PatchHouse Stories.**

Secondary gaps: MCP has no "post with copy" tool (only lifestyle stills), no offer CRUD, product/logo ingest stores hot-linked external URLs instead of copying bytes into Advance Storage, and `docs/operations/mcp-user-tools.md` has drifted (duplicated sections, `0.9.0` vs `0.9.5`, "may expand product refs" that no longer happens).

## 1. What exists today (server side, `master`)

### 1.1 Host and auth

| Item | Value | Source |
|---|---|---|
| Endpoint | `POST https://advanceai.studio/api/mcp` (JSON-RPC `initialize`, `tools/list`, `tools/call`); `GET` = discovery blurb | `api/mcp.ts` |
| Auth | `Authorization: Bearer <Supabase user access token>` via `requireAuth` → `supabaseAdmin.auth.getUser(token)`. 401 carries `WWW-Authenticate … resource_metadata=/.well-known/oauth-protected-resource` | `api/mcp.ts`, `api/lib/auth.ts`, `api/lib/mcp/www-authenticate.ts` |
| OAuth | Supabase OAuth 2.1 server on AIIAN, consent at `/oauth/consent`, DCR enabled (operator step in `mcp-user-tools.md`) | `api/mcp-oauth-metadata.ts`, `src/pages/OAuthConsent.tsx` |
| Limits | 60 req/min per user; body ≤ 256 KB; `maxDuration` 180 s; bulk `count` ≤ 10; carousel ≤ 5 slides | `api/mcp.ts`, `api/lib/mcp/limits.ts`, `vercel.json` |
| Audit | every `tools/call` → `auditMcpToolCall` (`source=mcp`, lane = tool risk) | `api/lib/mcp/tool-audit.ts` |
| Tenant scope | every store method takes `userId` and re-checks ownership (`assertOwnsBrand`, `getOwnedProductImage` joins `products.owner_id`, `business_id`); no service-role bypass reachable from a tool | `api/lib/mcp/supabase-adapter.ts`, `artifact-store.ts` |
| Social posting | none. `MCP_MUTATION_POLICY.socialAutoPost = false`; no publish/Meta/IG tool in registry | `api/lib/mcp/user-tools.ts`, `tool-registry.ts` |

### 1.2 Tool inventory relevant to the Content bot

| Capability (09-16 plan) | Existing tool(s) | Credits | Notes |
|---|---|---|---|
| 1. Auth as Rafael | Bearer JWT (OAuth or password grant + refresh) | — | Token TTL = Supabase default (1 h); bot must refresh |
| 2a. List / get brand kits | `list_brands` (`includeIncomplete`), `get_brand_context` (`brandKitId`), `list_brand_kits`, `get_brand_kit` (`kitId` or `brandId`) | 0 | `list_brands` hides `kitReady:false` by default |
| 2b. Update kit colors / logo / voice | `create_brand_kit`, `update_brand_kit` (`primaryColor`, `secondaryColor`, `accentColor`, `logoUrl`, `fontPrimary`, `brandVoice`, `toneKeywords`, `mustUsePhrases`, `forbiddenPhrases`, `referenceImageUrls`, `visualStyleNotes`, `setAsPrimary` …), `link_brand_kit`, `set_style_dna` | 0 | `logoUrl` / `referenceImageUrls` must be **public https**; stored as-is (no copy to Storage) |
| 3. Upload / attach product + context images | `list_assets` (`kind=product\|context\|generated` → `productImageId`), `workspace_save_artifact` (`kind=product\|context` + https `imageUrl`), `workspace_import_asset` / `workspace_ingest_file` (deep link to `/chat?intake=…` for real file bytes) | 0 | Requires an existing offer on the brand; URL is hot-linked into `product_images.image_url` |
| 4. Create script (guión) | `guide_script` (free brief), `execute_script_generate` (`framework`, `variations`, `ctaStrength`, `buyerStage`, `language`, `guidePrompt`), `list_scripts` (full `content`) | 3 / script | Async: `approval_required` → `confirm_execute` → `running` + `jobId` → `get_execute_result` |
| 5a. Individual post | `execute_image_generate` (`aspectRatio` default `9:16`, `productImageId`, `referenceImageIds ≤4`, `referenceMode`, `scene`, `guidePrompt`, `aspectRatioFallback`) | 6 (`image_standard`, grok-imagine) | **Lifestyle still, not a post**: no script copy, no `postStyle`/`textDensity`/`ctaStrength`, no pixel-lock, `/generations` endpoint |
| 5b. Bulk posts | `guide_bulk_angles` → `execute_bulk_scripts` / `execute_bulk_posts` / `execute_campaign_pack` (`aspectRatio` enum `1:1\|4:5\|9:16\|3:4`, `styleDnaId`, product refs) | 3 / script, 6 / image | Same `/generations` + thin prompt via `runBulkPosts` (shared with web `/api/bulk-posts`) |
| 6. Status + download | `get_execute_result` (`jobId`) → `imageUrl` (public https, JPEG q92 in `post-images`), `deepLink` | 0 | `saveImageArtifact` always transcodes to JPEG (`generated-image-jpeg.ts`) |
| 7. Never mutate Meta/IG | no tool exists | — | Keep it that way (see §5) |
| Edit / enhance / carousel | `execute_image_edit`, `execute_image_enhance` (18), `execute_carousel_generate` (24/slide) | 18 / 24 | Enhance path **does** carry the lock (`image-enhance.ts`) |
| Deletes | `archive_brand`, `delete_offer`, `delete_brand`, `delete_asset`, `delete_brand_kit` (typed confirm + `confirm_execute`) | 0 | Brand delete keeps kits |

## 2. Website vs MCP comparison

| Flow | Website (chat-shell → API) | MCP today | Parity |
|---|---|---|---|
| Create brand / offer | `useChatBrandSetup` → `database.ts` (`businesses`, `products`) | **none** (`list_brands`, `list_offers` only) | GAP-05 |
| Brand kit colors / voice / fonts | `/api/brand-kit` upsert, `database.ts` `updateBrandKit` | `update_brand_kit` (same columns, camelCase) | OK |
| Logo upload | `uploadBrandKitAsset` → compress to 512 px WebP → `post-images/<uid>/brand-kit/logo-*.webp` | `update_brand_kit.logoUrl` = external https URL, hot-linked | GAP-04 |
| Product / context photo | `createProductImage` after upload to `post-images` (`kind=product\|context`) | `workspace_save_artifact kind=product` inserts external URL; file bytes only via `/chat?intake=asset` deep link | GAP-04 |
| Script | `/api/chat` structured pipeline | `execute_script_generate` (same pipeline via `runStructuredScript`) | OK |
| **Post (ad with copy) 9:16** | `/api/generate-image mode=post`: `postStyle` (`venta-directa`/`anuncio-conversion`/preset/organic/product/logo), `textDensity`, `ctaStrength`, `scriptContext`, `productImageIds`, `kitReferenceUrls`, `brandLogoUrl`, `brandKitId`, `customColors`, `insights`; slim prompt with **PRODUCT LOCK**; product refs → `/images/edits` `product_lock_scene`; logo stamp rules; locked price (no strikethrough) | `execute_image_generate`: scene + palette prompt, no copy, `/images/generations`, no lock, logo never attached | **GAP-01 / GAP-02** |
| Foto de producto (no text) | `postStyle=product` + `productSubStyle` | `execute_image_generate` ≈ closest match (still no lock) | GAP-01 |
| Bulk posts | `/api/bulk-posts` → `runBulkPosts` | `execute_bulk_posts` → same `runBulkPosts` | GAP-01 (both sides lack lock) |
| Aspect | `9:16 / 3:4 / 4:5 / 1:1` (`resolvePostModeAspect`; 4:5 mapped for Grok in web) | fail-closed; `4:5` needs `aspectRatioFallback:true` | OK (documented) |
| Output format | JPEG to `post-images` | JPEG q92 to `post-images/<uid>/<offer>/product-refs/mcp-*.jpg` | OK |
| Credits + approval | client quote + server charge | server quote in `userPrompt`; `confirm_execute`; idempotent per `approvalRequestId` | OK |
| Publish to Meta | not in product | none | OK (must stay) |

## 3. Gap list (ordered by risk)

| ID | Severity | Gap | Evidence | Fix owner / phase |
|---|---|---|---|---|
| **GAP-01** | **Blocker (lock violation)** | MCP `execute_image_generate` + `runBulkPosts` (MCP and web bulk) send product refs to `/images/generations` with no `buildProductPixelLockContract`; Grok may redraw the SKU | `api/lib/mcp/execute-tools.ts` `runImageGenerateBody` → `runGrokImageGenerate`; `api/lib/grok-image-generate.ts` never calls its own `resolveGrokImageApiMode`; probe log above | Grok 4.6 · P2 |
| **GAP-02** | High (functional) | No MCP tool produces a *post* (copy on canvas). Missing inputs: `scriptId`/`copy`, `postStyle`, `textDensity`, `ctaStrength`, `language`, `brandKitId`, logo stamp, locked price | compare `buildShellImageBody` (`chatShellImageIntent.ts`) vs `toolInputSchema('execute_image_generate')` | Grok 4.6 · P2 |
| **GAP-03** | High (ops) | Grok connector `needsAuth`; no bot-side token refresh story documented. Access tokens expire ~1 h | `api/mcp.ts` Bearer only; `mcp-user-tools.md` operator step | Rafael / CoS · P0 |
| GAP-04 | Medium (durability / lock hygiene) | MCP product/context/logo ingest hot-links external URLs (`saveReferenceImageFromPublicUrl`, `update_brand_kit.logoUrl`). Web copies bytes into `post-images`. External host changes = silent ref drift; Grok ref fetch depends on third-party uptime | `artifact-store.ts` L312-339; `brand-kit-tools.ts` `buildWritableFields` | Grok 4.6 · P2 |
| GAP-05 | Medium (functional) | No `create_brand` / `create_offer` / `update_offer`. `workspace_save_artifact` fails with "Brand has no offers" on a fresh brand. Content bot cannot set price (₡9.900) or `do_not_claim` facts | `workspace-ops.ts` L140; registry | Grok 4.6 · P2 (offer CRUD first; brand create optional) |
| GAP-06 | Low (docs drift) | `mcp-user-tools.md` duplicates sections, says `0.9.0` and `0.9.4`; `execute_bulk_posts` description and `quoteBulkPosts.expand_ref` still say "may expand product refs" but `countExpandNeeded` is hard-wired to 0 | `tool-registry.ts` L335-344, `expand-product-refs.ts` L9-19 | Grok 4.6 · P2 (same PR) |
| GAP-07 | Low (test coverage) | No test asserts endpoint/lock for the MCP image path; existing tests cover gate, aspect, quotes, schemas only | `test/mcp-*.spec.ts` | Grok 4.6 · P2 (matrix rows C1–C6 become vitest) |
| GAP-08 | Info | `list_brands` hides brands without a ready kit by default; a bot that forgets `includeIncomplete:true` will think PatchHouse is missing before the kit is linked | `user-tools.ts` `mcpListBrands` | Content bot prompt / runbook |

## 4. Acceptance-test matrix

Legend — **Now:** result on `master` 0.9.5 with a valid token (`PASS` = expected to pass today based on code + existing tests; `FAIL` = known to fail today; `BLOCKED` = needs P0 auth). **Auto:** vitest spec Grok 4.6 must add/extend, or `manual` (CoS runbook against Production; never Preview for credit-bearing runs unless Preview credits are gifted).

### A. Auth and tenant isolation

| ID | Steps | Expected | Now | Auto |
|---|---|---|---|---|
| A1 | `POST /api/mcp` `initialize` with no `Authorization` | `401`, `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`; `GET /.well-known/oauth-protected-resource` returns AS = AIIAN `/auth/v1` | PASS | `test/mcp-host.spec.ts` (exists) |
| A2 | Same with expired / garbage token | `401` "Invalid or expired token", no tool executes, audit row absent | PASS | manual |
| A3 | Valid Rafael token → `tools/list` | ≥ 35 tools; no `admin_*` unless Rafael is admin; **no** tool whose name matches `/publish|meta|instagram|facebook|social/i` | PASS | new: `mcp-content-bot-parity.spec.ts` |
| A4 | Rafael token calls `get_brand_context` with a `brandId` owned by another user | tool error "Brand not found" (not "Access denied" leaking existence), no data | PASS | `mcp-user-tools.spec.ts` (extend) |
| A5 | Rafael token calls `execute_image_generate` with `productImageId` owned by another user | error "Reference image … not found for this brand/offer" **before** `approval_required` | PASS | new |
| A6 | 61 calls in 60 s from one user | `429` + `retryAfter` | PASS | manual |
| A7 | Bot token refresh: call after 61 min with refreshed token | `200`; old token `401` | BLOCKED (P0) | manual runbook |

### B. Brand kit (PatchHouse)

| ID | Steps | Expected | Now | Auto |
|---|---|---|---|---|
| B1 | `list_brands {includeIncomplete:true}` | PatchHouse row with `id`, `kitReady`, `offerCount`, `defaultOfferId`; no duplicate-name merge | BLOCKED | `mcp-user-tools.spec.ts` |
| B2 | `get_brand_kit {brandId}` before sync | primary kit or "No brand kit linked" | BLOCKED | exists |
| B3 | `update_brand_kit {brandId, kitId, primaryColor:"#3A8F6A", secondaryColor:"#7C9E8E", accentColor:"#1A1A2E", fontPrimary:"Plus Jakarta Sans", tagline, brandVoice, forbiddenPhrases:[…do-not-claim…]}` | `status:"updated"`, `kit.primaryColor === "#3A8F6A"`, `creditsNote` = no credits; web `/chat` Brand Kit card shows same values | BLOCKED | `mcp-brand-kits-complete.spec.ts` (extend with colors) |
| B4 | `update_brand_kit {logoUrl:"https://patchhouse.shopping/images/logo.png"}` | accepted (`assertPublicHttpsUrl`), `kit.logoUrl` echoes URL, `hasLogo:true`. **After GAP-04 fix:** `logoUrl` is an `advanceai`/Supabase Storage URL and the original bytes hash matches the source | BLOCKED (today hot-link) | new |
| B5 | `update_brand_kit {logoUrl:"http://…"}` or `data:image/png;base64,…` | rejected (https only / no base64) | PASS | new |
| B6 | `update_brand_kit` with `kitId` linked to a **different** brand | error "Cannot move a linked kit…" | PASS | exists |
| B7 | `create_brand_kit` on a brand with 0 kits → `list_brands` | new kit `isPrimaryForBusiness:true`; `kitReady:true` | PASS | exists |

### C. Product / context attach (no mutation)

| ID | Steps | Expected | Now | Auto |
|---|---|---|---|---|
| C1 | `list_assets {brandId, offerId, kind:"product"}` | array with `productImageId`, `imageUrl` (https), `kind:"product"` | BLOCKED | exists (`mcp-full-tools.spec.ts`) |
| C2 | `workspace_save_artifact {kind:"product", imageUrl:"https://…/focus.jpg", title:"Focus packshot"}` | `status:"saved"`, new `productImageId`; `product_images.kind='product'`. **After GAP-04:** stored URL is in `post-images`, SHA-256 of stored bytes == SHA-256 of source (no resize, no re-encode) | PASS (hot-link) / FAIL (byte copy) | new |
| C3 | Same with `data:` URL or `http://` | rejected | PASS | exists |
| C4 | `workspace_save_artifact {kind:"product"}` on brand with no offers | error "Brand has no offers…". **After GAP-05:** `create_offer` first, then C2 passes | PASS (error) | new |
| C5 | Snapshot `product_images` row (`id`, `image_url`, `updated_at`) + stored bytes hash **before** any EXECUTE; re-read **after** D-series | identical row and hash; generated artifacts appear only as new rows `kind='generated'` at new paths `…/product-refs/mcp-<uuid>.jpg` | PASS (by construction; make explicit) | new (store-level test) |
| C6 | `delete_asset` on the product photo | requires `confirm:"DELETE"` + `confirm_execute`; nothing deleted before approval | PASS | exists |

### D. Generate Story 9:16 JPEG (individual) — the PatchHouse gate

| ID | Steps | Expected | Now | Auto |
|---|---|---|---|---|
| D1 | `execute_image_generate {brandId, offerId, aspectRatio:"9:16"}` with product assets present but **no** `productImageId` | error "product images exist but none were confirmed…" (gate) — no approval issued | PASS | `mcp-reference-aspect-quality.spec.ts` |
| D2 | Same with `referenceMode:"none"` | error "skips product fidelity" | PASS | exists |
| D3 | `execute_image_generate {…, productImageId}` → `approval_required` | `userPrompt` (ES/EN) quotes **6** credits, `approvalRequestId` UUID, no charge yet | PASS | `mcp-inbot-approve.spec.ts` |
| D4 | `confirm_execute {approvalRequestId, action:"approve"}` → retry same tool | `status:"running"`, `jobId === approvalRequestId`, returns < 5 s | PASS | `mcp-execute-jobs.spec.ts` |
| D5 | Poll `get_execute_result {jobId}` until `completed` | `imageUrl` https in `post-images`, `Content-Type: image/jpeg`, `appliedAspectRatio:"9:16"`, `width/height ≈ 0.5625 ± 0.02`, `resolution:"2k"`, `quality:"medium"`, `chargedCredits === 6`, `productImageId` (new generated row), `deepLink` | BLOCKED (E2E) | manual + `generated-image-jpeg.spec.ts` |
| **D6** | **Lock: Grok request shape** — with ≥1 product ref, the outbound xAI request is `POST /v1/images/edits`, prompt satisfies `hasProductPixelLockLanguage() === true`, product ref is the first `image` | **FAIL today** (`/images/generations`, no lock — see probe) | FAIL | new (fetch mock) |
| D7 | Lock: **no** product ref (`productRefCount 0` + explicit context ref only) | `/images/generations` compose mode; silhouette/typographic rules; still no invented SKU | PASS | new |
| D8 | Replay: call the EXECUTE tool again with same `approvalRequestId` | `replayed:true`, same `imageUrl`, **no second charge** (ledger count unchanged) | PASS | `mcp-charge-uuid-reclaim.spec.ts` |
| D9 | `aspectRatio:"4:5"` without fallback | fail-closed error before approval; with `aspectRatioFallback:true` → `appliedAspectRatio:"3:4"` and `requestedAspectRatio:"4:5"` in result | PASS | exists |
| D10 | Visual QA (CreativeDirector): product in output vs `focus.jpg` | same label text, shape, colours, cap; scene may change; no extra/missing parts | BLOCKED (E2E, after D6 fix) | manual, keep both files as proof artifacts |
| D11 | **Post with copy (after GAP-02):** `execute_post_generate {brandId, offerId, scriptId, postStyle:"venta-directa", textDensity:"hard", aspectRatio:"9:16", productImageId}` | visible text == script copy (ES, ₡9.900 exact, no `[PRECIO]` placeholders, no strikethrough); D5–D8 invariants hold | N/A (tool missing) | new |

### E. Bulk posts

| ID | Steps | Expected | Now | Auto |
|---|---|---|---|---|
| E1 | `guide_bulk_angles {brandId, offerId, count:4}` | 4 distinct niches, free | BLOCKED | `bulk-orchestrator.spec.ts` |
| E2 | `execute_bulk_posts {count:4, aspectRatio:"9:16", productImageId}` → approve → poll | `quote.totalCredits === 24`, **no** `expand_ref` line, per-item `imageUrl` JPEG, `chargedCredits` == 6 × succeeded | PASS except quote line naming | `mcp-prod-regression-0.9.5.spec.ts` (extend) |
| E3 | Lock in bulk: each xAI request uses `/images/edits` + lock language when product refs confirmed | **FAIL today** (`runBulkPosts` → `runGrokImageGenerate`) | FAIL | new (shared helper test covers web + MCP) |
| E4 | `count: 11` | rejected by MCP cap (≤ 10) | PASS | exists |
| E5 | Host killed mid-pack → poll | lease reclaim ≤ 3, partial `posts` + `chargedCredits` preserved | PASS | `mcp-campaign-resume.spec.ts` |

### F. Non-goals (must stay false)

| ID | Steps | Expected | Now | Auto |
|---|---|---|---|---|
| F1 | grep registry + `tools/list` for publish/Meta/IG | none | PASS | A3 |
| F2 | Any tool with service-role reach across users | none — every store method requires `userId` | PASS | code review checklist |
| F3 | Preview as webhook / payment target | never (policy) | PASS | docs |

## 5. Security notes

- **No Meta / Instagram posting from MCP.** Nothing to remove; add A3/F1 as a regression test so a future tool cannot slip in. Content bot posts through Rafael's manual GO only.
- **Tenant isolation is by Supabase user id, not by API key.** The bot must run as Rafael's user (OAuth or password grant on AIIAN). Never give the bot `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`; the MCP does not accept them and the policy in `.cursor/rules/api-backend.mdc` forbids exposing them. Store the refresh token in the bot's secret store, rotate on refresh, and scope the OAuth client to `advanceai.studio` redirect only.
- **Credits are the blast radius.** Every EXECUTE needs `confirm_execute`; approvals are single-use, input-bound, 1 h TTL. For an unattended bot, recommend a **per-run credit ceiling** in the bot (e.g. ≤ 60 credits / brief) and require Rafael GO before `confirm_execute` for anything over one Story.
- **URL ingest is the only SSRF surface.** `assertPublicHttpUrl` / `fetchPublicUrl` already block private ranges and redirects > 3; keep it when adding byte-copy (GAP-04). Cap at 10 MB (web parity) and accept only `image/jpeg|png|webp`.
- **Product photo lock is a content-safety property, not just quality.** Treat D6/E3 as release blockers for the Content-bot phase; do not ship P3 (bot wired) before they are green in Production.
- **Audit:** `auditMcpToolCall` already tags `source=mcp`. Add `clientName` (from `initialize.params.clientInfo.name`) so Grok vs Content-bot calls can be separated in `/admin` usage.

## 6. Recommended MCP surface changes (for Grok 4.6, P2)

Keep all existing tool names (Grok connector prompts already depend on them). Registry → `0.10.0`.

### 6.1 Shared server helper (root fix for GAP-01)

Extract the web post first-gen into one function and make **web single**, **web bulk**, **MCP single** and **MCP bulk** call it:

```ts
// api/lib/grok-post-first-gen.ts (new)
export async function runGrokPostFirstGen(options: {
  apiKey: string
  prompt: string                    // built by buildSlimGrokPostPrompt({ hasProductRefs, … })
  aspectRatio: string               // resolved via resolveGrokAspectRatio (fail-closed)
  productReferenceUrls: string[]    // role=product, first is the edit base
  supportReferenceUrls?: string[]   // scene/style/logo, ≤ 2
}): Promise<GrokImageGenerateResult & { mode: GrokImageApiMode; endpoint: string }>
```

Rules inside: `resolveGrokImageApiMode({ action:'generate', productReferenceCount, referenceCount })` → `/images/edits` when product refs > 0, `/images/generations` otherwise; prompt must pass `hasProductPixelLockLanguage` whenever product refs > 0 (assert, do not trust caller); logo is never the sole edit base. `runGrokImageGenerate` stays for compose-only callers or is removed.

### 6.2 New tool: `execute_post_generate`

| Field | Type | Notes |
|---|---|---|
| `brandId` * | string | owner-checked |
| `offerId` | string | default = first offer |
| `scriptId` \| `copy` | string | one required; `scriptId` from `list_scripts`; `copy` ≤ 1 200 chars; rejects `[PLACEHOLDER]` tokens (`hasUnresolvedScriptPlaceholder`) |
| `postStyle` | `venta-directa` \| `anuncio-conversion` \| `organic-single` \| `product` | default `venta-directa`; `product` = Foto sin texto |
| `textDensity` | `hard` \| `medium` \| `standard` | default `hard` |
| `ctaStrength` | `none` \| `soft` \| `brand_mention` \| `sales` | default `sales` |
| `aspectRatio` | `9:16` \| `3:4` \| `1:1` \| `4:5` | default `9:16`; `4:5` needs `aspectRatioFallback` |
| `aspectRatioFallback` | boolean | default false |
| `productImageId` * unless `referenceMode:"none"` | string | must be `kind=product` owned by brand/offer |
| `referenceImageIds` | string[] ≤ 4 | context/style refs; product ids allowed |
| `referenceMode` | `use` \| `none` | `none` only for typographic/organic |
| `brandKitId` | string | else primary kit |
| `includeLogo` | boolean | default true → stamp kit `logoUrl` as-is (never redraw) |
| `language` | `es` \| `en` | default `es` |
| `sessionId`, `approvalRequestId` | string | as today |

Output (`get_execute_result` when `completed`): existing image job fields **plus** `grokMode: 'product_lock_scene' | 'compose'`, `endpoint`, `visibleCopySource: 'script' | 'copy'`, `postStyle`, `textDensity`, `lockApplied: boolean` (must be `true` when `grokMode === 'product_lock_scene'`). Credits: 6 (`image_standard`), quoted in `userPrompt` as today.

Optionally deprecate `execute_image_generate` to an alias of `execute_post_generate {postStyle:"product"}` after one release.

### 6.3 Existing tools — behaviour changes

| Tool | Change |
|---|---|
| `execute_bulk_posts`, `execute_campaign_pack` | route through `runGrokPostFirstGen`; add `postStyle`, `textDensity`, `ctaStrength`; description drops "may expand product refs"; `quoteBulkPosts` drops the `expand_ref` line when `expandCount` is 0 (already always 0) |
| `workspace_save_artifact kind=product\|context` | server fetches the https URL (SSRF-safe), stores **original bytes unmodified** to `post-images/<uid>/<offer>/product-refs/src-<uuid>.<ext>` (no resize / re-encode; ≤ 10 MB; jpeg/png/webp), returns `imageUrl` in Storage + `sourceUrl` + `sha256`. Same for `create_brand_kit` / `update_brand_kit` `logoUrl` and `referenceImageUrls` (path `<uid>/brand-kit/…`) |
| `list_assets` | add `sha256` and `sourceUrl` when known (supports C5 without DB access) |
| `get_execute_result` | expose `grokMode`, `endpoint`, `lockApplied` for image/post/bulk jobs |
| `list_brands` | no change; runbook must pass `includeIncomplete:true` on first sync |

### 6.4 New sync-write tools (GAP-05)

| Tool | Inputs | Notes |
|---|---|---|
| `create_offer` | `brandId` *, `name` *, `type` (`product`\|`service`\|…), `price` (exact string, e.g. `₡9.900`), `priceRange`, `productDescription`, `differentiation`, `mainProblem`, `result`, `technicalSpecs`, `doNotClaim: string[]` | mirrors `products` columns used by `listOffersForBrand`; owner = user; 0 credits |
| `update_offer` | `brandId` *, `offerId` *, same optional fields | owner-checked |
| `create_brand` (optional, Rafael call) | `name` *, `type`, `location`, `salesChannels`, `icpDescription` | same as web brand setup minimal; consider leaving to web |

### 6.5 Docs

Rewrite `docs/operations/mcp-user-tools.md` into a single non-duplicated page for `0.10.0`; add a "Content bot runbook" section (token refresh, `includeIncomplete`, product confirm, credit ceiling, GO gates). Add `docs/agent/CHANGELOG.md` entry.

## 7. Phase mapping (from the 09-16 plan)

| Phase | Owner | Exit criteria |
|---|---|---|
| P0 Unblock | Rafael / CoS | Connector shows tools; A1–A3, B1, C1 pass against Production |
| P1 Plan + matrix | Fable 5.1 (this doc) | done |
| P2 Implement | Grok 4.6 | §6 shipped in one fat PR; vitest for D6/D7/E3/C5/A3 green; `npm run build` + `npm test` green; registry `0.10.0`; local verify before push; SecureDog review; Rafael merges |
| P3 Content bot wired | CoS | Runbook: `list_brands includeIncomplete` → `update_brand_kit` (PatchHouse hex/font/voice/logo) → `workspace_save_artifact kind=product` × 6 SKUs → `list_assets` → `execute_post_generate 9:16` → `get_execute_result` → CreativeDirector D10 → Rafael GO to post (manual, outside MCP). Content-readiness item 12 flips to OK only after D6 is green in Production |

## 8. Out of scope (unchanged)

Instagram / Meta posting; unfreezing Social / Media Buyer; PIL / collage fallbacks; changing credit prices; new image providers via MCP (`imageModel` stays `grok-imagine`).
