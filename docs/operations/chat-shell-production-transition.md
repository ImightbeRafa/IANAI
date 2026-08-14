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

## Do not

- Dump Preview RLS / plan_limits seeds onto AIIAN
- Auto-backfill `chat_sessions.business_id`
- Auto-enroll admins or new signups
- Turn the kill switch on for everyone as a “home” switch
