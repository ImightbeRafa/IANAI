# Non-admin preview test user plan

Do **not** use Rafael’s admin account for chat-shell authorization QA.

## AIIAN-backed Vercel Preview QA (policy 2026-08-22)

Preview deployments share **AIIAN** (`lstzfxsdmggkoaxfawny`). After GO 2026-09-04 chat access is **kill-switch only** (invite not required):

1. Kill switch `app_feature_flags.chat_shell` must be `enabled` (already on for AIIAN).
2. Any signed-in AIIAN user can open `/chat`. Do not grant `chat_beta_access` from this doc.
3. CoS / WebDesigner login: **`sup.rafa0412@gmail.com`** → open `/chat`.
4. Demo folder for idle-bar / Pack-sheet after-shots (seeded for that account when missing): brand **IdleBar Demo**, session **Quiero crear guiones**, offer **Arnes Demo**.
5. Preview must **not** gift +100 (`VERCEL_ENV=preview`).

Deep-link form (fill brand/session ids from the live sidebar if the query params drift):

`/chat?brand=<IdleBar Demo id>&session=<Quiero crear guiones id>`

Do **not** invent a second auth model or email allowlist in code. Do not gift on Preview. Do not run live AIIAN SQL from the agent.

## Create user (preview project only)

Via Supabase Admin API (service role on **preview**):

```bash
curl -X POST "$PREVIEW_SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $PREVIEW_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $PREVIEW_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "chat-shell-qa@example.com",
    "password": "ReplaceMe1",
    "email_confirm": true
  }'
```

Password rules: ≥8 chars, upper, lower, digit.

Then ensure `profiles.is_admin = false` (and no privileged `role` / `account_type`) for that user.

## Seed data (preview)

1. Business A owned by QA user with products P1–P3 (`business_id` set).
2. Business B owned by a second non-admin user with product Q1.
3. Optional: collaborator viewer/editor invites on P2 for a third user.

If the QA user owns businesses but Brands stays empty, or Quick/New chat insert does not return a row, Preview RLS may still be incomplete — see `docs/operations/chat-shell-preview-rls.md` (do **not** apply those fixes on production AIIAN).

If send/generate is blocked immediately (usage limit 0) despite auth, Preview may be missing `plan_limits` rows or the QA user may lack an `active`/`trialing` subscription matching a seeded plan (ops used `pro`). Same bootstrap doc; **do not** seed `plan_limits` on production AIIAN.

Preview QA `pro` / high script quota via Preview `plan_limits` + subscription is **intentional tracked Preview QA access**, not production policy.

Also ensure:

- `plan_limits` has `free` / `pro` / `starter` / `enterprise` (column shape from `checkUsageLimit` in `api/lib/auth.ts` — copy numeric quotas from a known-good inventory; do not invent prod numbers in git).
- QA user `subscriptions.plan` matches one of those keys (e.g. `pro`).

## Authorization matrix to execute

| Actor | Action | Expected |
|-------|--------|----------|
| QA owner | Open legacy `/scripts` session for P1 | Success |
| QA owner | Create Quick session on Business A (`product_id` null) | Success |
| QA owner | Add offers P1..P3 positions 1..3 | Success |
| QA owner | Add P1 again / position 6 / Q1 | Fail |
| QA owner | Insert `message_artifacts` for P1 script | Success |
| Other owner (B) | SELECT Business A session/offers | Empty / denied |
| Viewer collab | SELECT session | Success |
| Viewer collab | INSERT message / offer | Denied |
| Admin Rafael | Not used for this matrix | — |

## Rollback

Delete the QA user from the **preview** project only. Never create this user against production unless explicitly requested.
