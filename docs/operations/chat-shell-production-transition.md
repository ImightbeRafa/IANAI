# Chat-shell production transition

Human-reviewed runbook. Do **not** apply Preview SQL (062–066 RLS notes) to AIIAN. This agent does not apply SQL to production.

## Goal

Ship chat-shell code to master with **zero user cutover**. Classic stays home until a person is invited and opts in.

## Controls

| Layer | Source | Default | Who changes it |
|-------|--------|---------|----------------|
| Kill switch | `app_feature_flags.chat_shell` | `false` | Ops / service role |
| Invite | `profiles.chat_beta_access` | `false` | Ops / service role only (trigger blocks clients) |
| Home UI | `profiles.preferred_ui` | `classic` | The invited user |

Enabling the kill switch alone must not redirect anyone. Preference never grants access.

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

## 2. Apply 067 (additive)

File: `supabase/migrations/067_chat_shell_rollout_controls.sql`

Adds `chat_beta_access` and `preferred_ui`. Seeds `chat_shell = false` if the flag row is missing. Does not rewrite sessions.

If invited users still see the invite gate and no Admin item while SQL shows the flags true, apply `068_profiles_select_own.sql` (own-row `profiles` SELECT). Preview needed this after 061 dropped the global dump policy. Do not apply 068 to AIIAN from the agent.

## 3. Deploy code with the flag off

Production `ianai-omega.vercel.app` → AIIAN. Keep `chat_shell` false. Every user stays on `/dashboard`.

## 4. Preview / first tester

On IANAI-preview, after 067:

```sql
-- Preview only. Replace the email.
UPDATE public.app_feature_flags
SET enabled = true, updated_at = now()
WHERE key = 'chat_shell';

UPDATE public.profiles
SET chat_beta_access = true
WHERE email = 'you@example.com';
-- Leave preferred_ui = 'classic' so home does not jump.
```

Smoke: classic still loads. `/chat` works for that email. A second account without invite stays classic and cannot open `/chat`.

## 5. Production canary (later)

Same SQL on AIIAN, one internal email, `preferred_ui` still classic. They use **Probar Chat** / **Volver al panel clásico**.

Stop if: another user’s data, recurring 403/406/FK, usage miscount, failed script/image generate.

## Rollback

```sql
UPDATE public.app_feature_flags
SET enabled = false, updated_at = now()
WHERE key = 'chat_shell';
```

No data rollback. Preference rows can stay.

## Production readiness checklist

Do **not** merge to `master` or enable the kill switch until a human signs this list.

### Schema / security (AIIAN)

- [ ] Inventory production tables vs ADR 0001 (`chat_sessions.product_id` nullability, `business_id`, `chat_session_offers`, `message_artifacts`, `app_feature_flags`).
- [ ] Apply only production-reviewed migrations. Do not copy Preview deny-all / plan_limits seeds.
- [ ] Confirm owner RLS on businesses, brand kits, sessions, offers, artifacts, product images / storage.
- [ ] Offer FK `ON DELETE SET NULL` (or equivalent) and child delete/update policies reviewed.
- [ ] Null-link / ownership-immutability triggers present.
- [ ] `edit-script` and `streamline-script` authorization coverage + foreign session/product/image negative tests.

### Rollout controls

- [ ] `app_feature_flags.chat_shell` is **false** on AIIAN until canary approval.
- [ ] Invite path: `profiles.chat_beta_access` + `preferred_ui` (classic default).
- [ ] Enabling the flag alone does not redirect anyone.

### Preview gates (this branch)

- [ ] `npm test` and `npm run build` green.
- [ ] Preview env vars all target IANAI-preview (never mix frontend URL with a production service role).
- [ ] Invited account can open `/chat`; uninvited stays classic and 403s `/chat`.
- [ ] Smoke: scripts, posts, image generate/edit, save, usage increment, folder delete, classic dashboard still loads.
- [ ] Desktop + mobile (390×844 and 768×1024), dark + light.
- [ ] Folder switch does not blank/jump the thread (cached and uncached). Create widget shows the **current** folder’s offer, never the previous brand.
- [ ] Create widget survives reload; hide persists; topbar restores it without setup.
- [ ] Error-log scan after smoke. Rollback = set `chat_shell` false.

### Known blockers

- Production AIIAN schema/RLS inventory snapshot: `docs/operations/chat-shell-aiian-inventory.md` (foundation + rollout controls missing; usage RPCs present).
- Production cutover SQL is human-applied only.
- No Playwright `/chat` smoke in CI yet.
- AIIAN is not linked in Supabase MCP for this agent — REST/OpenAPI inventory only; RLS policy text still **not verified**.

## Do not

- Dump Preview RLS / plan_limits seeds onto AIIAN
- Auto-backfill `chat_sessions.business_id`
- Auto-enroll admins or new signups
- Turn the kill switch on for everyone as a “home” switch
