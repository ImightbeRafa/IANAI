# Chat-shell production transition

Human-reviewed runbook. Do **not** apply Preview SQL (062–066 RLS notes) to AIIAN. This agent does not apply SQL to production.

## Goal (mass cutover 2026-09-04)

When this lands on **master**, every signed-in Advance user opens chat-shell immediately. No invite wait. First **production** `/chat` open gifts **100** pack credits once (CREDITS_V1 lot; Preview fail-closed). Classic `/dashboard` stays reachable via **Volver al panel clásico** — `/dashboard` must not bounce back to `/chat`.

This agent does **not** merge to master and does **not** apply live AIIAN SQL. AIIAN `chat_shell` is already enabled (ops, 2026-08-21). Shipping the invite-all code is the cutover.

## Controls

| Layer | Source | After cutover | Who changes it |
|-------|--------|---------------|----------------|
| Kill switch | `app_feature_flags.chat_shell` | **on** = product open for every authenticated user; **off** / unreadable = fail closed (classic, “Chat aún no está habilitado”) | Ops / service role — no deploy needed |
| Invite | `profiles.chat_beta_access` | **Not a gate.** Kept on the profile for history; clients still cannot self-grant | Ops only if you still write it |
| Home | `effectiveHome` | `chat` when the kill switch is on | Code; preference no longer denies `/chat` |
| Welcome gift | `credit_lots` id `chatShellOpenGiftLotId(userId)` | **+100** pack, 12-month TTL, once per user, **only** `VERCEL_ENV=production` | Code; opt out with `CHAT_SHELL_OPEN_GIFT=0` |

Rollback without a deploy: set `chat_shell` false. Do not claw back gifted lots. Do not dump Preview SQL onto AIIAN.

## 1. Inventory AIIAN (before any apply)

**Latest read-only snapshot:** [`docs/operations/chat-shell-aiian-inventory.md`](./chat-shell-aiian-inventory.md) (2026-08-21). Summary: classic entities + usage RPCs are present; chat-shell foundation tables/columns and rollout controls are **missing**. Do not point a preview at AIIAN until that gap is closed with a production-reviewed migration pack.

Confirm, do not invent:

- `chat_sessions.product_id` nullability, `business_id`, `brand_kit_id`
- `chat_session_offers`, `message_artifacts`
- `app_feature_flags`
- `get_usage_limits` / admin usage RPCs
- owner RLS on `businesses`, `brand_kits`, `chat_sessions`
- canonical image bucket

If foundation tables are missing, apply a **production-reviewed** chat foundation first. Do not reuse Preview deny-all patches.

## 2. Apply production pack (additive, human-only)

**Do not** `supabase db push` Preview migrations onto AIIAN.  
**Do not** apply this pack from the agent without explicit approval.

Pack (outside `supabase/migrations/`):

`supabase/production/aiian/chat-shell/`

| Step | File |
|------|------|
| Preflight | `01_preflight_read_only.sql` |
| Foundation + rollout (`chat_shell=false`) | `02_foundation_and_rollout.sql` |
| RLS / storage overlay | `03_security_overlay.sql` (after policy-catalog review) |
| Postflight | `04_postflight_read_only.sql` |

Canary runbook: [`docs/operations/chat-shell-aiian-canary.md`](./chat-shell-aiian-canary.md).

`068_profiles_select_own.sql` is **not** part of this pack — AIIAN already has own-profile SELECT; confirm in preflight before inventing a second policy.

### Legacy note (superseded)

Older drafts mentioned applying repo migration `067` alone and maybe `068`. Prefer the consolidated pack above (foundation + corrected offer SET NULL delete semantics + rollout + security).

## 3. Deploy code (invite-all)

Production `advanceai.studio` / `ianai-omega.vercel.app` → AIIAN. Kill switch already on. After merge, every authenticated user can open `/chat`. Login / homepage / signup land on `/chat`. Unauthenticated `/chat` still goes to login.

Preview uses the same gate (flag on = all signed-in users). Preview must **not** gift +100 (`VERCEL_ENV=preview` fail-closed).

## 4. First-open gift (production only)

`POST /api/chat-shell-open` `{ action: "ensure" }` after access check:

- `VERCEL_ENV=production` and CREDITS_V1 on → insert pack lot of **100** if missing.
- Existing lot → `already: true`, no second insert, no clawback.
- Preview / `vercel dev` / unset env → skip insert; keep real `tourDone` so the wizard still mounts.

## 5. Wizard

`ChatShellTourWizard` mounts when `tour_done` is false (including when open-gift fails). Skip only writes `chat_shell_tour_done`. Existing brands/kits stay. Soft kit: offer present + incomplete → named **Falta:** gaps; glass stays usable.

## Rollback

```sql
UPDATE public.app_feature_flags
SET enabled = false, updated_at = now()
WHERE key = 'chat_shell';
```

No data rollback. Gifted production lots stay. Preference rows can stay.

## Production readiness checklist

Do **not** merge to `master` or enable the kill switch until a human signs this list.

### Schema / security (AIIAN)

- [ ] Inventory production tables vs ADR 0001 (`chat_sessions.product_id` nullability, `business_id`, `chat_session_offers`, `message_artifacts`, `app_feature_flags`).
- [ ] Apply only production-reviewed migrations. Do not copy Preview deny-all / plan_limits seeds.
- [ ] Confirm owner RLS on businesses, brand kits, sessions, offers, artifacts, product images / storage.
- [ ] Offer FK `ON DELETE SET NULL` (or equivalent) and child delete/update policies reviewed.
- [ ] Null-link / ownership-immutability triggers present.
- [ ] `edit-script` and `streamline-script` authorization coverage + foreign session/product/image negative tests.

### Rollout controls (GO 2026-09-04)

- [ ] Kill switch `app_feature_flags.chat_shell` stays **on** on AIIAN unless you need to turn the product off.
- [ ] Invite (`chat_beta_access`) is **not** required. Signed-in users must not see “Chat es por invitación”.
- [ ] Authenticated home is `/chat` when the flag is on. `/dashboard` still loads (no bounce).
- [ ] Production first `/chat` open gifts **100** once. Preview gifts **0**.

### Preview gates (this branch)

- [ ] `npm test` and `npm run build` green.
- [ ] Preview env vars all target **AIIAN** (never mix frontend URL with a production service role from a different project).
- [ ] Signed-in QA can open `/chat` without an invite. Unauthenticated `/chat` is login. Unauth `POST /api/chat-shell-open` is 401.
- [ ] Wizard mounts on first open when `tour_done` is false. Skip does not wipe brands/kits.
- [ ] Smoke: scripts, posts, image generate/edit, save, usage increment, folder delete, classic dashboard still loads.
- [ ] Desktop + mobile (390×844 and 768×1024), dark + light.
- [ ] Folder switch does not blank/jump the thread (cached and uncached). Create widget shows the **current** folder’s offer, never the previous brand.
- [ ] Create widget survives reload; hide persists; topbar restores it without setup.
- [ ] Error-log scan after smoke. Rollback = set `chat_shell` false.

### Known blockers

- Production pack is **drafted** at `supabase/production/aiian/chat-shell/` but **not applied**. Human must run preflight → review policies → apply → postflight.
- Canary runbook: `docs/operations/chat-shell-aiian-canary.md`.
- AIIAN is not linked in Supabase MCP for this agent — REST/OpenAPI inventory only until pack apply.
- No Playwright `/chat` smoke in CI yet.

## Do not

- Dump Preview RLS / plan_limits seeds onto AIIAN
- Auto-backfill `chat_sessions.business_id`
- Auto-enroll via SQL (code invite-all is the cutover; do not dump Preview invites)
- Gift credits on Preview
- Claw back existing credit lots
