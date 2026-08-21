# Chat-shell AIIAN inventory (read-only)

**Status:** snapshot for planning only. No migrations or data mutations were applied.  
**Queried at:** `2026-08-21T15:49:00Z` (approx.)  
**Production project:** AIIAN `lstzfxsdmggkoaxfawny`  
**Comparison project:** IANAI-preview `adrwkzibhfdpwuycnzaa` (Supabase MCP SQL)  
**Method (AIIAN):** PostgREST OpenAPI + authenticated REST `SELECT`/RPC probes with the paired service role. No `INSERT`/`UPDATE`/`DELETE`/DDL.  
**Method (Preview):** MCP `execute_sql` / `list_tables` (catalog reads).  
**Access note:** AIIAN is **not** linked in the Supabase MCP project list for this agent; inventory used env-paired credentials already present in the Cloud Agent environment.

Legend for each requirement:

| Status | Meaning |
|--------|---------|
| **present** | Exists and matches what chat-shell expects at a high level |
| **partial** | Exists but missing columns/constraints the shell needs |
| **missing** | Not found on AIIAN |
| **not verified** | Cannot confirm via REST alone (RLS policy text, triggers, storage policies, CHECK defs) |

This inventory does **not** claim migrations `062–068` were applied to AIIAN. Evidence says they were **not**.

---

## Executive summary

AIIAN can run **classic** today (businesses, products, scripts, posts, usage RPCs, logins). It **cannot** safely host chat-shell yet.

Blockers before any “preview UI → production DB” or production canary:

1. Shell foundation tables/columns (`chat_session_offers`, `message_artifacts`, nullable `chat_sessions.product_id` + `business_id`, thread links on posts/images, `brand_kits.business_id`).
2. Rollout controls (`app_feature_flags.chat_shell`, `profiles.chat_beta_access`, `profiles.preferred_ui`).
3. Human-reviewed production migration pack (do **not** replay Preview `062–066` RLS/seeds wholesale).
4. RLS / trigger / storage policy review on AIIAN (**not verified** in this pass).

**Good news for “usage together”:** classic usage RPCs (`get_usage_limits`, `increment_usage`, `check_usage_limit`, …) are **present** on AIIAN and respond. Chat-shell should keep using the same ledger once generation is enabled — no second usage system required at the RPC layer.

---

## Scale snapshot (AIIAN, service-role counts)

| Relation | Approx. rows |
|----------|----------------|
| `profiles` | 48 |
| `businesses` | 105 |
| `products` | 160 (153 with `business_id`, 7 null) |
| `chat_sessions` | 207 |
| `messages` | 1109 |
| `posts` | 2098 |
| `product_images` | 76 (`product` 69, `context` 7, `generated` 0) |
| `brand_kits` | 12 |
| `subscriptions` | 48 |

Real customer volume is non-trivial. Any canary must treat writes as production writes.

---

## Requirement matrix

### Rollout / invite

| Requirement | Expected (shell) | AIIAN | Preview | Notes |
|-------------|------------------|-------|---------|-------|
| `app_feature_flags` table | present; `chat_shell` row default **false** | **missing** | **present** (`chat_shell` **enabled=true**) | Without this table, shell fail-closes to classic. |
| `profiles.chat_beta_access` | boolean, default false, ops-only | **missing** | **present** (2/2 true on preview QA) | Needed for invite gate + Probar Chat. |
| `profiles.preferred_ui` | `classic` \| `chat`, default classic | **missing** | **present** | Home preference; must not grant access alone. |
| Classic ↔ chat jump UI | code on branch | code ready | works when invited | Blocked on AIIAN until columns + flag exist. |

### Chat session foundation (ADR 0001 / migration 062 shape)

| Requirement | Expected | AIIAN | Preview | Notes |
|-------------|----------|-------|---------|-------|
| `chat_sessions` | present | **present** | **present** | Legacy product-scoped sessions exist on AIIAN. |
| `chat_sessions.product_id` nullable | nullable + CHECK(product OR business) | **partial** — OpenAPI marks `product_id` **required**; null-filter returned `[]` | **present** (nullable) | Quick / brand sessions cannot be inserted on AIIAN as-is. |
| `chat_sessions.business_id` | uuid FK | **missing** | **present** | Shell folder sessions need this. |
| `chat_sessions.brand_kit_id` | optional uuid | **missing** | **present** | |
| `chat_sessions.primary_channel` / `awareness_level` | optional funnel | **missing** | **present** | |
| `chat_session_offers` | multi-offer (max 5) | **missing** | **present** | |
| `message_artifacts` | typed script/post/image links | **missing** | **present** | |
| `posts.session_id` / `message_id` | thread gallery links | **missing** | **present** | Carousel columns already exist on AIIAN. |
| `product_images.session_id` / `message_id` | thread gallery links | **missing** | **present** | |
| `brand_kits.business_id` | optional brand link | **missing** | **present** | |
| Ownership immutability triggers | sessions/artifacts | **not verified** | present on Preview (from migrations) | Must be in production-reviewed pack. |

### Images / storage

| Requirement | Expected | AIIAN | Preview | Notes |
|-------------|----------|-------|---------|-------|
| Bucket `post-images` | public bucket for uploads | **present** | expected present | Also `feedback-screenshots`, `brand-as…` (truncated name in listing). |
| `product_images.kind` includes `generated` | CHECK product\|context\|generated | **partial / not verified** — live rows only `product`/`context`; CHECK text not readable via REST | **present** (`product\|context\|generated`) | Migration `063_product_image_kind_generated.sql` is Preview-oriented; AIIAN needs an explicit reviewed change. |
| Storage INSERT/UPDATE/DELETE policies | owner-scoped | **not verified** | **not fully re-audited here** | Required before canary uploads/deletes. |

### Usage / billing (shared with classic)

| Requirement | Expected | AIIAN | Notes |
|-------------|----------|-------|-------|
| `get_usage_limits(p_user_id)` | present | **present** (sample returned plan limits JSON) | Keep as single source for scripts/images counts. |
| `increment_usage` / `check_usage_limit` | present | **present** (OpenAPI) | Generation must continue to call these. |
| `get_usage_summary` / `get_daily_usage` / `get_user_usage_stats` | present | **present** | Admin/analytics compatibility. |
| `deduct_bonus_image` | present | **present** | |
| `plan_limits` / `subscriptions` / `usage` | classic tables | **present** | Do **not** seed Preview `plan_limits` onto AIIAN. |
| TiloPay webhook target | production only | N/A | Any AIIAN-backed preview must **not** become a webhook destination. |

### Core classic entities (display readiness)

| Entity | AIIAN | Shell implication |
|--------|-------|-------------------|
| `profiles` (login identity) | **present** | Real Auth users exist; rollout columns still missing. |
| `businesses` (`owner_id`) | **present** | Matches app (`getBusinesses` filters `owner_id`). |
| `products` (`business_id`, `owner_id`) | **present** | Most products already brand-linked (153/160). |
| `scripts` / `posts` / `messages` | **present** | Classic content exists; shell artifact linking tables missing. |
| `brand_kits` | **present** | Kits are user-scoped; no `business_id` on AIIAN yet. |

---

## What Preview has that AIIAN does not (do not copy blindly)

Applied / present on IANAI-preview (evidence from MCP), **not** on AIIAN:

- Foundation from ADR/`062`-class objects: offers, artifacts, shell session columns, thread links.
- Rollout from `067`: flag table + invite/preference columns (Preview flag currently **on**).
- Image kind `generated` CHECK (`063`).
- Preview-only RLS/bootstrap notes in `docs/operations/chat-shell-preview-rls.md` — **never** dump onto AIIAN.

---

## Risks if we pointed a Vercel preview at AIIAN today

1. Chat-shell session create / Quick chat would fail or corrupt assumptions (`business_id` missing, `product_id` required).
2. Multi-offer and artifact UX cannot persist.
3. Invite/kill-switch cannot be enforced in DB (flag + beta columns missing) — unsafe for “only some users”.
4. Any write path that *does* succeed still hits **real** businesses/products/usage.
5. Mixing Preview frontend keys with AIIAN service role (or the reverse) can authorize the wrong project.

---

## Recommended next steps (still no AIIAN writes until you approve)

1. ~~Human review this inventory~~ — see pack below.
2. **Apply the reviewed pack** (human only): `supabase/production/aiian/chat-shell/` (`01` preflight → `02` foundation → `03` security after policy review → `04` postflight).
3. Follow canary: `docs/operations/chat-shell-aiian-canary.md` (flag off → deploy → invite one internal → classic ↔ chat).
4. **Optional later:** one protected Vercel branch with AIIAN env pairing + Deployment Protection (not all previews).

Pack status: **drafted in-repo, not applied.**

---

## Related docs

- `docs/operations/chat-shell-production-transition.md` — runbook / checklist
- `docs/operations/chat-shell-environments.md` — env pairing rules
- `docs/adr/0001-chat-shell-foundation.md` — schema intent
- `.cursor/skills/advance-ai/reference/chat-shell.md` — code map

## Explicit non-actions in this pass

- No SQL applied to AIIAN or Preview
- No flag flips
- No user invites
- No Vercel env changes
- No data backfill of `business_id` on sessions
