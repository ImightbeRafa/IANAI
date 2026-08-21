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

## Critical corrections (do not apply older pack revisions)

1. Offer FKs use **`ON DELETE SET NULL (session_id)`** (Postgres ≥ 15), not bare `SET NULL`. Bare composite `SET NULL` would also null `product_id` and break classic `NOT NULL` ownership on `posts` / `product_images`.
2. `product_images` INSERT/DELETE policies require **`can_write_product(product_id)`** so a null `session_id` cannot attach/remove another product’s images.

## Apply order (production SQL editor / reviewed ops)

1. Confirm the SQL editor is open on **AIIAN** `lstzfxsdmggkoaxfawny` (not IANAI-preview).
2. Run `01_preflight_read_only.sql` — save output. **Stop** if PG &lt; 15, unexpected kinds, enabled flag, or missing classic tables.
3. Review policy catalog from preflight against assumptions in `03_security_overlay.sql`.
4. In a single reviewed window:
   - `02_foundation_and_rollout.sql`
   - `03_security_overlay.sql` (only after policy review)
5. Run `04_postflight_read_only.sql` — confirm flag still **false**, objects present, offer FKs show `SET NULL (session_id)`.
6. Run `05_security_performance_audit.sql` **and** Dashboard Advisors (Security + Performance) on AIIAN.
7. Follow `docs/operations/chat-shell-aiian-canary.md` for code deploy + invite (later — needs explicit Phase B/C go).

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
| `05_security_performance_audit.sql` | RLS / grants / indexes / SECURITY DEFINER audit |
