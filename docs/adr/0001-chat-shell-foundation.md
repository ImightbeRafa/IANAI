# ADR 0001 — Chat-shell foundation (P-1)

Status: Accepted (2026-08-12)  
Scope: Schema / RLS / docs only. No `/chat` UI cutover in this phase.

## Context

IANAI’s live product (`ianai-omega.vercel.app`) uses product-scoped `chat_sessions` with **required** `product_id`. The chat-shell initiative needs:

- Brand/business-scoped sessions (including **Quick** sessions with no primary product)
- Multi-offer selection (up to 5 products under one business)
- Typed thread artifacts (script / post / image) bound immutably to a product
- Thread gallery links from posts/images back to session + message
- Safe RLS so users cannot read cross-brand data
- A runtime feature flag for later `/chat` cutover

Out of scope forever for this initiative: Descriptions, Respuestas, Memoria UI, carousel, all video/B-roll generators.

## Decision

### 1) Nullable `product_id` + nullable `business_id` (no sentinel product)

`chat_sessions.product_id` becomes **nullable**. New columns:

| Column | Purpose |
|--------|---------|
| `business_id` | Brand association (required for shell Quick + multi-offer) |
| `brand_kit_id` | Optional kit; composite FK ties kit to same business |
| `primary_channel` | Funnel channel: `messages` \| `website` \| `physical` |
| `awareness_level` | Optional: `cold` \| `warm` \| `hot` |

Invariant:

```text
product_id IS NOT NULL OR business_id IS NOT NULL
```

**Rejected alternative:** a sentinel “Quick” product row. It would pollute product lists, ownership, memory, analytics, and `ON DELETE CASCADE` behavior.

**Legacy compatibility proof:**

- `createChatSession(productId, …)` always inserts a real `product_id` (`src/services/database.ts`).
- `ProductWorkspace` / `DescriptionsWorkspace` always pass a product id.
- `getChatSessions` filters by `product_id`; existing rows remain non-null after migration.
- Composite FKs use PostgreSQL `MATCH SIMPLE`: when `business_id` is null (legacy), product↔business consistency checks are skipped.

**Backfill:** do **not** auto-set `business_id` from `products.business_id` in 062. Product reassignment would become constrained once shell FKs exist. See `docs/schema/chat-shell-backfill.md`.

**Ownership immutability (S6):** after insert, authenticated clients cannot change `chat_sessions.user_id`, `business_id`, or `product_id`. Enforced by `BEFORE UPDATE` trigger `trg_chat_sessions_ownership_immutable` (RLS cannot compare OLD/NEW). INSERT still requires `user_id = auth.uid()`. Service role may still mutate for controlled backfills. Safe client updates remain title/status/context/funnel/settings fields only.

### 2) Funnel definition

Funnel = **primary channel** (required for shell UX later) + **optional awareness**:

- Channel: where the CTA sends the prospect (`messages` / `website` / `physical`)
- Awareness: temperature of the audience (`cold` / `warm` / `hot`)

Schema stores both on the session; application validation for “channel required when flag on” lands with the shell UI.

### 3) Multi-offer semantics (`chat_session_offers`)

- Max **5** offers per session (`position` ∈ 1..5, unique per session).
- All offers must share the session’s `business_id` (composite FKs to `chat_sessions` and `products`).
- Position `1` is the primary offer.
- **Generation contract (app-level):** sequential calls — **1 offer per API call**, **1 usage increment per call**, **1 script card per offer** (enforced in DB for scripts via partial unique on `message_artifacts(message_id, product_id) WHERE artifact_type = 'script'`).

Legacy sessions without `business_id` cannot receive offers until backfilled (FK requires non-null session business).

### 4) Typed artifacts (`message_artifacts`)

Append-oriented link table: message ↔ script | post | image with:

- Immutable `product_id` (trigger blocks identity mutation)
- `ordinal` ordering within the message
- `action_type` + `action_metadata` for generate/edit/enhance/optimize provenance
- Exactly one target FK matching `artifact_type`
- Must reference a row in `chat_session_offers`

### 5) Thread gallery links

Additive nullable `session_id` / `message_id` on `posts` and `product_images`. Existing unlinked rows unchanged. When `session_id` is set, `(session_id, product_id)` must exist in `chat_session_offers`.

### 6) Runtime feature flag

Table `app_feature_flags` with seeded key `chat_shell = false`.

- **Authoritative at runtime** (DB or server read). Do not treat `VITE_*` as the source of truth for cutover.
- Authenticated clients may read; only service role mutates.
- While `false`, keep `/scripts` and `/posts` behavior unchanged.

### 7) Preview environment

Prefer a **separate Supabase project** for Vercel Preview. Same-project preview sharing prod data is explicitly discouraged for shell RLS experiments. Credentials are **TBD — Rafael actions**; never invent keys. See `docs/operations/chat-shell-environments.md`.

## Consequences

- Migration `062_chat_shell_foundation.sql` must be applied to preview/local before shell UI work (P0+).
- Production apply is a **human-reviewed** step; this agent does not apply 062 to prod.
- API routes still need server-side authz tightening in a later phase (`docs/security/chat-shell-api-authorization.md`).
- Legacy TypeScript types still type `product_id: string`; widening types waits until shell client code lands.
