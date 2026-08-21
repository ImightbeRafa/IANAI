# AIIAN chat-shell apply record

**Applied at (UTC):** 2026-08-21T23:08–23:14Z  
**Project:** AIIAN `lstzfxsdmggkoaxfawny`  
**Method:** Supabase MCP `apply_migration` (execute_sql is read-only)  
**Pack commit:** `597ca16` (+ this apply-record commit)

## Clarification (LAPLACELAB vs AIIAN)

| Name in dashboard | Ref | Role |
|-------------------|-----|------|
| **AIIAN** | `lstzfxsdmggkoaxfawny` | Production app DB (this apply) |
| **IANAI-preview** | `adrwkzibhfdpwuycnzaa` | Preview / migration replay |
| **LAPLACELAB** | `bdofjelcimoxrmlrqbmm` | Separate inactive project — **not** AIIAN |

AIIAN is a different Supabase **project** in the same org family; it is not the LAPLACELAB project. MCP `list_projects` omits AIIAN, but `execute_sql` / `apply_migration` with ref `lstzfxsdmggkoaxfawny` work.

## Migrations applied (in order)

1. `aiian_chat_shell_02a_sessions_foundation`
2. `aiian_chat_shell_02b_offers_thread_links`
3. `aiian_chat_shell_02c_message_artifacts`
4. `aiian_chat_shell_02d_access_helpers`
5. `aiian_chat_shell_02e_rollout_controls`
6. `aiian_chat_shell_03_security_overlay`
7. `aiian_chat_shell_06_audit_hardening` (revoke trigger RPC + FK covering indexes)

## Postflight

| Check | Result |
|-------|--------|
| `chat_shell.enabled` | **false** |
| `profiles.chat_beta_access` true | **0** |
| `preferred_ui = chat` | **0** |
| Offer FKs | `ON DELETE SET NULL (session_id)` |
| `product_images` INSERT | requires `can_write_product` |
| `chat_sessions.product_id` | nullable; `business_id` present |
| Row counts | unchanged (48 / 105 / 160 / 207 / 2098 / 76) |
| Classic REST | 200 on profiles/businesses/products/sessions/posts/images |
| Storage | `chat_shell_post_images_{select,insert,update,delete}_own` present |

## Security / performance audit

- **Security advisors:** WARN only (no ERROR). New `can_*` helpers are intentionally executable by `authenticated` for RLS. Trigger functions revoked from `authenticated` after hardening.
- **Performance advisors:** INFO unused indexes expected (no shell traffic yet). INFO unindexed FKs reduced via `06`. WARN `auth_rls_initplan` / multiple permissive policies are known Supabase patterns; classic policies retained where additive.

## Not done (needs your go)

- ~~Phase B: enable `chat_shell` kill switch~~ — **done** 2026-08-21 (`enabled=true`)
- ~~Phase C: invite canary email~~ — **done** `ralauas@gmail.com` (`chat_beta_access=true`, `preferred_ui=classic`); only 1 beta user
- Production frontend deploy / protected AIIAN preview (UI must include chat-shell code for Probar Chat)

See `docs/operations/chat-shell-aiian-canary.md`.

## Canary snapshot

| Item | Value |
|------|--------|
| Flag `chat_shell` | enabled = true |
| Canary | `ralauas@gmail.com` (admin) |
| `chat_beta_access` | true (1 of 48 profiles) |
| `preferred_ui` | classic (home stays classic until Probar Chat) |
| Protect trigger | re-enabled after invite |
