# Chat-shell API authorization tightening plan

Status: Checklist for later phases (P-1 documents only; no full route rewrites here).  
Related helpers today: `api/lib/auth.ts`, `api/lib/product-access.ts`.

## Goal

Every generation/edit route must enforce **no cross-brand** and **no wrong-product image/script** usage, even when the client sends spoofed IDs. RLS is necessary but not sufficient for service-role paths.

## Priority routes

| Route | Current risk | Required checks (later) |
|-------|--------------|-------------------------|
| `api/chat.ts` | Trusts client product/context payload | Resolve `session_id` server-side; verify `can_write_chat_session`; accept **exactly one** `product_id` that exists in `chat_session_offers` for that session; ignore client-supplied foreign brand fields |
| `api/generate-image.ts` | Product/image IDs from body | Verify user write access to product; if `session_id` present, product ∈ session offers; bind Flux/task polling IDs to `(user_id, session_id)` |
| `api/edit-script.ts` | May trust script content from client | Load script by id via admin client; verify product access + session membership; never accept a `product_id` that disagrees with the stored script |
| `api/streamline-script.ts` (post-optimize) | Same class of issue | Same as edit-script: authoritative row load, then mutate |
| Future shell post endpoints | N/A | Same offer + session binding; refuse images from another product/business |

## Hard rules

1. **UUID format validation** on every resource id before DB lookup.
2. **Authoritative context**: load session, offers, product, and source artifact from DB after auth. Do not trust client “context objects” for authorization.
3. **One offer per `/api/chat` call**; client sequences up to five. Each call increments usage once.
4. **Immutable product binding**: generated script/post/image rows keep the offer’s `product_id`; `message_artifacts.product_id` must match the target row (DB enforces).
5. **Image isolation**: reference / product photos used for generation must belong to the same `product_id` (and thus business) as the offer being generated.
6. **Flag gating**: when `app_feature_flags.chat_shell` is false, preserve legacy request contracts for `/scripts` UI.
7. Extend `userHasProductAccess` (or replace with shared server helpers mirroring SQL `can_read_product` / `can_write_product` / session helpers) and use them from **all** service-role routes.

## Suggested implementation order (post P-1)

1. Shared `api/lib/session-access.ts` wrapping admin queries for session + offers.
2. Tighten `api/chat.ts` offer binding behind flag.
3. Tighten image + edit/optimize routes.
4. Add negative tests: foreign `product_id`, foreign `session_id`, image from other brand, viewer role denied writes.

## Session ownership (RLS / S6)

DB layer (migration 062): `chat_sessions.user_id`, `business_id`, and `product_id` are **immutable after create** for `authenticated` via trigger `prevent_chat_session_ownership_mutation`. Team writers who pass `can_write_chat_session` may update title/status/context/funnel fields but cannot steal ownership or re-point the session to another business/product.

## Session+offer binding on `/api/chat` (C1b — Preview `chat-shell`)

When the client sends `sessionId`:

1. Require `productId` (one offer per call; client sequences ≤5).
2. Load session + `chat_session_offers` **server-side**; ignore spoofed brand/business fields for authz.
3. If offers exist: `productId` must ∈ that set (offers override stale `session.product_id`).
4. **Legacy:** if offers are empty AND `session.product_id` is set → allow that one product only.
5. Foreign `sessionId` / foreign `productId` → 4xx.

Helpers: `api/lib/session-access.ts`, `api/lib/session-offer-auth.ts`.

## Session+offer binding on `/api/generate-image` (C3 — Preview `chat-shell`)

When the client sends `sessionId`:

1. Require `productId` ∈ `chat_session_offers` (no empty-offers legacy fallback for images).
2. Optional `productImageId` for edit/optimize must belong to that product and either the same session or a reusable `session_id IS NULL` ref.
3. Shell `poll` without a bound task mapping is rejected (Flux task binding deferred).
4. Foreign session / product / product_image → 4xx.

Helpers: `api/lib/image-access.ts`, `resolveAuthorizedSessionImage` in `api/lib/session-access.ts`.

## P-1 stub note

No production route behavior changes ship in P-1. This document is the contract SecureDog / later phases should implement against. Preview `chat-shell` implements the `/api/chat` binding above and C3 `/api/generate-image` session+offer binding; other routes remain later.
