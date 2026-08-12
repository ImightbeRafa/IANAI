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

## P-1 stub note

No production route behavior changes ship in P-1. This document is the contract SecureDog / later phases should implement against.
