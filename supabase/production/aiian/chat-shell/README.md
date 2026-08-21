# AIIAN chat-shell production pack

**Human review + manual apply only.**  
This directory is **outside** `supabase/migrations/` so `supabase db push` / Preview migration replay cannot apply it by accident.

| Item | Value |
|------|--------|
| Target | Production AIIAN `lstzfxsdmggkoaxfawny` |
| Inventory | `docs/operations/chat-shell-aiian-inventory.md` |
| Canary | `docs/operations/chat-shell-aiian-canary.md` |
| Agent rule | Do **not** apply from Cloud Agent without explicit human approval |

## What this pack does

1. Adds chat-shell **foundation schema** (sessions/offers/artifacts/thread links) without rewriting Preview deny-all RLS.
2. Uses corrected delete semantics: offer/session unlink clears `session_id`/`message_id` on posts/images; **does not** delete customer assets.
3. Widens `product_images.kind` to allow `generated` (after preflight check).
4. Adds **rollout controls** (`app_feature_flags.chat_shell=false`, `chat_beta_access`, `preferred_ui=classic`).
5. Adds an AIIAN-specific **security overlay** (helpers + RLS + cascade/thread-clear policies).

## What this pack does **not** do

- Does not enable `chat_shell` or invite anyone
- Does not backfill `chat_sessions.business_id`
- Does not copy Preview `061–066` deny-all / plan_limits seeds
- Does not apply `068_profiles_select_own.sql` (AIIAN already has own-profile SELECT; confirm in preflight)
- Does not point Vercel Preview at AIIAN
- Does not mutate data beyond DDL + disabled flag seed

## Apply order (production SQL editor / reviewed ops)

1. Run `01_preflight_read_only.sql` — save output. **Stop** if unexpected kinds, enabled flag, or missing classic tables.
2. Review policy catalog from preflight against assumptions in `03_security_overlay.sql`.
3. In a single reviewed window:
   - `02_foundation_and_rollout.sql`
   - `03_security_overlay.sql` (only after policy review)
4. Run `04_postflight_read_only.sql` — confirm flag still **false**, objects present.
5. Follow `docs/operations/chat-shell-aiian-canary.md` for code deploy + invite (later).

## Rollback

Primary rollback for product cutover is **flag-off** (see canary doc).  
Schema rollback is not automatic; restore from PITR/backup if a migration must be undone. Prefer forward-fix + flag-off.

## File map

| File | Purpose |
|------|---------|
| `01_preflight_read_only.sql` | Read-only catalog checks |
| `02_foundation_and_rollout.sql` | Schema + triggers + helpers + rollout (transactional) |
| `03_security_overlay.sql` | RLS / grants / storage policy intents (transactional) |
| `04_postflight_read_only.sql` | Verification queries |
